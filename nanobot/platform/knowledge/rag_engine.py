"""RAG Engine adapter bridging RAG-Anything/LightRAG with the nanobot platform.

Each knowledge base gets its own RAGAnything + LightRAG instance with an
independent working directory.  LLM and embedding functions are constructed
from the nanobot configuration so they reuse the same model-center settings
that the rest of the platform relies on.
"""

from __future__ import annotations

import asyncio
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from loguru import logger

# ---------------------------------------------------------------------------
# Lazy imports – heavy libraries are only loaded when actually needed
# ---------------------------------------------------------------------------
_rag_anything_available: bool | None = None


def _check_rag_anything() -> bool:
    global _rag_anything_available
    if _rag_anything_available is None:
        try:
            import raganything  # noqa: F401
            import lightrag  # noqa: F401
            _rag_anything_available = True
        except ImportError:
            _rag_anything_available = False
    return _rag_anything_available


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ParseResult:
    """Result of document parsing and indexing."""
    success: bool
    parser_name: str = ""
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievalHit:
    """A single retrieval result."""
    content: str
    score: float = 0.0
    source: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# RAG Engine
# ---------------------------------------------------------------------------

class RAGEngine:
    """Adapter layer between nanobot and RAG-Anything/LightRAG.

    *   Creates one ``RAGAnything`` instance per knowledge base (lazy).
    *   Adapts nanobot's ``Config`` into the LLM / embedding / vision
        functions that RAG-Anything expects.
    *   Exposes ``parse_and_index``, ``insert_text``, ``query``, and
        ``delete_kb`` as the public API consumed by ``KnowledgeBaseService``.
    """

    def __init__(
        self,
        *,
        storage_root: Path,
        default_model: str,
        api_key: str | None = None,
        api_base: str | None = None,
        extra_headers: dict[str, str] | None = None,
        embedding_api_key: str | None = None,
        embedding_api_base: str | None = None,
        embedding_extra_headers: dict[str, str] | None = None,
        embedding_model: str = "text-embedding-3-large",
        embedding_dim: int = 3072,
        embedding_max_tokens: int = 8192,
        parser: str = "auto",
        mineru_api_base: str = "",
        parse_method: str = "auto",
        enable_image_processing: bool = True,
        enable_table_processing: bool = True,
        enable_equation_processing: bool = True,
    ) -> None:
        self._storage_root = storage_root
        self._storage_root.mkdir(parents=True, exist_ok=True)

        # Provider config for LLM / embedding calls
        self._default_model = default_model
        self._api_key = api_key or ""
        self._api_base = api_base or ""
        self._extra_headers = extra_headers or {}

        # Embedding config
        self._embedding_api_key = self._api_key if embedding_api_key is None else embedding_api_key
        self._embedding_api_base = self._api_base if embedding_api_base is None else embedding_api_base
        self._embedding_extra_headers = (
            dict(self._extra_headers) if embedding_extra_headers is None else dict(embedding_extra_headers)
        )
        self._embedding_model = embedding_model
        self._embedding_dim = embedding_dim
        self._embedding_max_tokens = embedding_max_tokens

        # Parser config
        self._parser = parser
        self._mineru_api_base = mineru_api_base
        self._parse_method = parse_method

        # Multimodal switches
        self._enable_image_processing = enable_image_processing
        self._enable_table_processing = enable_table_processing
        self._enable_equation_processing = enable_equation_processing

        # Per-KB instances (lazy loaded)
        self._instances: dict[str, Any] = {}  # kb_id -> RAGAnything
        self._locks: dict[str, asyncio.Lock] = {}

    @staticmethod
    def _normalize_status(value: Any) -> str:
        raw = getattr(value, "value", value)
        return str(raw or "").strip().lower()

    @staticmethod
    def _status_detail(status: dict[str, Any] | None) -> str:
        if not status:
            return "missing doc_status record"
        parts = [f"status={RAGEngine._normalize_status(status.get('status')) or 'unknown'}"]
        if "multimodal_processed" in status:
            parts.append(f"multimodal_processed={status.get('multimodal_processed')}")
        if status.get("chunks_count") is not None:
            parts.append(f"chunks_count={status.get('chunks_count')}")
        error_msg = str(status.get("error_msg") or "").strip()
        if error_msg:
            parts.append(f"error={error_msg}")
        return ", ".join(parts)

    def _resolve_file_reference(self, rag: Any, file_path: str | None) -> str | None:
        candidate = str(file_path or "").strip()
        if not candidate:
            return None
        try:
            if hasattr(rag, "_get_file_reference"):
                return str(rag._get_file_reference(candidate)).strip() or None
        except Exception:
            pass
        return candidate

    async def _lookup_doc_status(
        self,
        rag: Any,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> dict[str, Any] | None:
        doc_status_store = getattr(getattr(rag, "lightrag", None), "doc_status", None)
        if doc_status_store is None:
            return None

        normalized_doc_id = str(doc_id or "").strip()
        if normalized_doc_id:
            status = await doc_status_store.get_by_id(normalized_doc_id)
            if status is not None:
                return status

        reference = self._resolve_file_reference(rag, file_path)
        if reference and hasattr(doc_status_store, "get_doc_by_file_path"):
            for candidate in (reference, Path(reference).name):
                normalized_candidate = str(candidate or "").strip()
                if not normalized_candidate:
                    continue
                status = await doc_status_store.get_doc_by_file_path(normalized_candidate)
                if status is not None:
                    return status
        return None

    async def _require_processed_status(
        self,
        rag: Any,
        *,
        kb_id: str,
        operation: str,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> dict[str, Any]:
        status = await self._lookup_doc_status(rag, doc_id=doc_id, file_path=file_path)
        if status is None:
            identity = str(doc_id or file_path or "<unknown>").strip()
            raise RuntimeError(
                f"RAGAnything {operation} finished without a persisted doc_status record "
                f"for kb_id={kb_id}, identity={identity}."
            )

        normalized_status = self._normalize_status(status.get("status"))
        error_msg = str(status.get("error_msg") or "").strip()
        if normalized_status == "failed":
            detail = error_msg or self._status_detail(status)
            raise RuntimeError(
                f"RAGAnything {operation} failed for kb_id={kb_id}: {detail}"
            )
        if normalized_status != "processed":
            raise RuntimeError(
                f"RAGAnything {operation} did not reach a fully processed state for kb_id={kb_id}: "
                f"{self._status_detail(status)}"
            )
        if status.get("multimodal_processed") is False:
            raise RuntimeError(
                f"RAGAnything {operation} left multimodal processing incomplete for kb_id={kb_id}: "
                f"{self._status_detail(status)}"
            )
        return status

    async def _get_or_create_instance(self, kb_id: str):
        """Get or create the RAGAnything instance for a knowledge base."""
        if kb_id in self._instances:
            return self._instances[kb_id]

        async with self._get_lock(kb_id):
            if kb_id in self._instances:
                return self._instances[kb_id]

            if not _check_rag_anything():
                raise RuntimeError(
                    "raganything or lightrag is not installed. "
                    "Install with: pip install raganything lightrag-hku"
                )

            from raganything import RAGAnything, RAGAnythingConfig

            working_dir = self._kb_working_dir(kb_id)
            working_dir.mkdir(parents=True, exist_ok=True)

            config = RAGAnythingConfig(
                working_dir=str(working_dir),
                parser=self._parser if self._parser != "auto" else "mineru",
                parse_method=self._parse_method,
                enable_image_processing=self._enable_image_processing,
                enable_table_processing=self._enable_table_processing,
                enable_equation_processing=self._enable_equation_processing,
            )

            rag = RAGAnything(
                config=config,
                llm_model_func=self._build_llm_func(),
                vision_model_func=self._build_vision_func(),
                embedding_func=self._build_embedding_func(),
            )

            self._instances[kb_id] = rag
            logger.info("RAGEngine: created RAGAnything instance for kb_id={}", kb_id)
            return rag

    async def _ensure_ready(self, kb_id: str):
        """Return an initialized RAGAnything instance with LightRAG storages ready."""
        rag = await self._get_or_create_instance(kb_id)
        if getattr(rag, "lightrag", None) is not None:
            return rag

        init = await rag._ensure_lightrag_initialized()
        if not isinstance(init, dict) or not init.get("success"):
            self._instances.pop(kb_id, None)
            detail = init.get("error") if isinstance(init, dict) else "Unknown initialization error."
            raise RuntimeError(f"RAGAnything initialization failed for kb_id={kb_id}: {detail}")
        if getattr(rag, "lightrag", None) is None:
            self._instances.pop(kb_id, None)
            raise RuntimeError(f"RAGAnything did not expose a LightRAG instance for kb_id={kb_id}.")
        return rag

    # ------------------------------------------------------------------
    # LLM / Embedding / Vision function builders
    # ------------------------------------------------------------------

    def _build_llm_func(self):
        """Build the async LLM function for RAG-Anything / LightRAG."""
        from litellm import acompletion

        api_key = self._api_key
        api_base = self._api_base or None
        model = self._default_model
        extra_headers = self._extra_headers or None

        async def llm_model_func(
            prompt: str,
            system_prompt: str | None = None,
            history_messages: list | None = None,
            **kwargs: Any,
        ) -> str:
            messages: list[dict[str, Any]] = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            if history_messages:
                messages.extend(history_messages)
            messages.append({"role": "user", "content": prompt})

            kw: dict[str, Any] = {"model": model, "messages": messages}
            if api_key:
                kw["api_key"] = api_key
            if api_base:
                kw["api_base"] = api_base
                if "/" not in model:
                    kw["custom_llm_provider"] = "openai"
            elif "/" not in model:
                # If no api_base is provided but it's a known model without prefix, litellm needs a prefix.
                # deepseek-chat -> deepseek/deepseek-chat
                if model.startswith("deepseek"):
                    kw["model"] = f"deepseek/{model}"
            if extra_headers:
                kw["extra_headers"] = extra_headers

            # Forward supported kwargs
            for passthrough in ("temperature", "max_tokens"):
                if passthrough in kwargs:
                    kw[passthrough] = kwargs[passthrough]

            response = await acompletion(**kw)
            return response.choices[0].message.content or ""

        return llm_model_func

    def _build_embedding_func(self):
        """Build the embedding function for LightRAG."""
        from litellm import aembedding
        from lightrag.utils import EmbeddingFunc

        api_key = self._embedding_api_key
        api_base = self._embedding_api_base or None
        model = self._embedding_model
        extra_headers = self._embedding_extra_headers or None

        async def _embed(texts: list[str]) -> list[list[float]]:
            kw: dict[str, Any] = {"model": model, "input": texts}
            if api_key:
                kw["api_key"] = api_key
            if api_base:
                kw["api_base"] = api_base
                if "/" not in model:
                    kw["custom_llm_provider"] = "openai"
            elif "/" not in model and model.startswith("deepseek"):
                kw["model"] = f"deepseek/{model}"
            if extra_headers:
                kw["extra_headers"] = extra_headers

            response = await aembedding(**kw)
            return [item["embedding"] for item in response.data]

        return EmbeddingFunc(
            embedding_dim=self._embedding_dim,
            max_token_size=self._embedding_max_tokens,
            func=_embed,
        )

    def _build_vision_func(self):
        """Build the vision model function for multimodal processing."""
        from litellm import acompletion

        api_key = self._api_key
        api_base = self._api_base or None
        model = self._default_model
        extra_headers = self._extra_headers or None

        async def vision_model_func(
            prompt: str,
            system_prompt: str | None = None,
            history_messages: list | None = None,
            image_data: str | None = None,
            messages: list | None = None,
            **kwargs: Any,
        ) -> str:
            kw: dict[str, Any] = {"model": model}
            if api_key:
                kw["api_key"] = api_key
            if api_base:
                kw["api_base"] = api_base
                if "/" not in model:
                    kw["custom_llm_provider"] = "openai"
            elif "/" not in model:
                if model.startswith("deepseek"):
                    kw["model"] = f"deepseek/{model}"
            if extra_headers:
                kw["extra_headers"] = extra_headers

            # VLM enhanced query: pre-built messages
            if messages:
                kw["messages"] = messages
                response = await acompletion(**kw)
                return response.choices[0].message.content or ""

            # Single image analysis
            if image_data:
                kw["messages"] = [
                    *([{"role": "system", "content": system_prompt}] if system_prompt else []),
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                            },
                        ],
                    },
                ]
                response = await acompletion(**kw)
                return response.choices[0].message.content or ""

            # Pure text fallback
            text_msgs: list[dict[str, Any]] = []
            if system_prompt:
                text_msgs.append({"role": "system", "content": system_prompt})
            if history_messages:
                text_msgs.extend(history_messages)
            text_msgs.append({"role": "user", "content": prompt})
            kw["messages"] = text_msgs
            response = await acompletion(**kw)
            return response.choices[0].message.content or ""

        return vision_model_func

    def _default_parse_kwargs(self) -> dict[str, Any]:
        """Build parser kwargs derived from engine configuration."""
        if self._parser == "docling":
            return {}

        mineru_api_base = str(self._mineru_api_base or "").strip()
        if not mineru_api_base:
            return {}

        return {
            "backend": "vlm-http-client",
            "vlm_url": mineru_api_base,
        }

    # ------------------------------------------------------------------
    # Instance management
    # ------------------------------------------------------------------

    def _kb_working_dir(self, kb_id: str) -> Path:
        """Return the per-KB LightRAG working directory."""
        return self._storage_root / kb_id

    def _get_lock(self, kb_id: str) -> asyncio.Lock:
        if kb_id not in self._locks:
            self._locks[kb_id] = asyncio.Lock()
        return self._locks[kb_id]

    async def ensure_instance(self, kb_id: str):
        """Get or create the ready-to-use RAGAnything instance for a knowledge base."""
        return await self._ensure_ready(kb_id)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def parse_and_index(
        self,
        kb_id: str,
        file_path: str,
        *,
        doc_id: str | None = None,
        output_dir: str | None = None,
        **kwargs: Any,
    ) -> ParseResult:
        """Parse a document and build KG + vector index via RAG-Anything.

        Args:
            kb_id: Knowledge base identifier.
            file_path: Path to the document file.
            output_dir: Optional output directory for parsed artifacts.
            **kwargs: Additional arguments passed to process_document_complete.

        Returns:
            ParseResult indicating success or failure.
        """
        try:
            rag = await self._ensure_ready(kb_id)
            working_dir = self._kb_working_dir(kb_id)
            effective_output_dir = output_dir or str(working_dir / "parsed_output")
            Path(effective_output_dir).mkdir(parents=True, exist_ok=True)
            parser_kwargs = self._default_parse_kwargs()
            parser_kwargs.update(kwargs)

            processed = await rag.process_document_complete(
                file_path=file_path,
                output_dir=effective_output_dir,
                parse_method=self._parse_method,
                doc_id=doc_id,
                **parser_kwargs,
            )
            if processed is False:
                raise RuntimeError(
                    f"RAGAnything reported unsuccessful document processing for kb_id={kb_id}, "
                    f"file_path={file_path}."
                )

            status = await self._require_processed_status(
                rag,
                kb_id=kb_id,
                operation="parse_and_index",
                doc_id=doc_id,
                file_path=file_path,
            )

            return ParseResult(
                success=True,
                parser_name=self._parser,
                metadata={
                    "output_dir": effective_output_dir,
                    "doc_id": doc_id,
                    "file_path": file_path,
                    "chunks_count": int(status.get("chunks_count") or 0),
                } if doc_id else {
                    "output_dir": effective_output_dir,
                    "file_path": file_path,
                    "chunks_count": int(status.get("chunks_count") or 0),
                },
            )
        except Exception as exc:
            logger.error("RAGEngine: parse_and_index failed for kb_id={}: {}", kb_id, exc)
            return ParseResult(
                success=False,
                parser_name=self._parser,
                error=str(exc),
            )

    async def insert_text(
        self,
        kb_id: str,
        text: str,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> ParseResult:
        """Insert plain text via RAG-Anything direct content insertion.

        Args:
            kb_id: Knowledge base identifier.
            text: Text content to insert.
            doc_id: Optional document identifier.

        Returns:
            ParseResult indicating success or failure.
        """
        try:
            rag = await self._ensure_ready(kb_id)
            content = str(text or "").strip()
            if not content:
                raise ValueError("text is required.")
            await rag.insert_content_list(
                [{"type": "text", "text": content, "page_idx": 0}],
                file_path=file_path or f"{kb_id}.txt",
                doc_id=doc_id,
            )
            status = await self._require_processed_status(
                rag,
                kb_id=kb_id,
                operation="insert_text",
                doc_id=doc_id,
                file_path=file_path,
            )

            return ParseResult(
                success=True,
                parser_name="text_insert",
                metadata=(
                    {
                        "doc_id": doc_id,
                        "file_path": file_path,
                        "chunks_count": int(status.get("chunks_count") or 0),
                    }
                    if doc_id or file_path
                    else {"chunks_count": int(status.get("chunks_count") or 0)}
                ),
            )
        except Exception as exc:
            logger.error("RAGEngine: insert_text failed for kb_id={}: {}", kb_id, exc)
            return ParseResult(
                success=False,
                parser_name="text_insert",
                error=str(exc),
            )

    async def query(
        self,
        kb_ids: list[str],
        query_text: str,
        *,
        mode: str = "hybrid",
        top_k: int = 8,
        vlm_enhanced: bool = False,
    ) -> list[RetrievalHit]:
        """Query across one or more knowledge bases.

        Args:
            kb_ids: List of knowledge base identifiers to query.
            query_text: The query string.
            mode: LightRAG retrieval mode (local, global, hybrid, naive).
            top_k: Maximum number of results.
            vlm_enhanced: Whether to enable VLM-enhanced query.

        Returns:
            List of RetrievalHit results.
        """
        if not kb_ids:
            return []

        from lightrag import QueryParam

        mode = {
            "keyword": "naive",
            "semantic": "local",
            "hybrid": "hybrid",
            "local": "local",
            "global": "global",
            "naive": "naive",
            "mix": "hybrid",
        }.get(str(mode or "").strip().lower(), "hybrid")

        all_hits: list[RetrievalHit] = []
        failures: list[tuple[str, str]] = []

        for kb_id in kb_ids:
            try:
                rag = await self._ensure_ready(kb_id)
                result = await rag.lightrag.aquery_data(
                    query_text,
                    QueryParam(
                        mode=mode,
                        top_k=max(1, int(top_k)),
                        include_references=True,
                    ),
                )
                data = result.get("data") or {}
                references = {
                    str(item.get("reference_id")): str(item.get("file_path") or "")
                    for item in (data.get("references") or [])
                    if item.get("reference_id")
                }
                chunks = list(data.get("chunks") or [])
                for index, chunk in enumerate(chunks):
                    content = str(chunk.get("content") or "").strip()
                    if not content:
                        continue
                    reference_id = str(chunk.get("reference_id") or "")
                    file_path = str(chunk.get("file_path") or references.get(reference_id) or "")
                    all_hits.append(
                        RetrievalHit(
                            content=content,
                            score=max(0.0, 1.0 - (index * 0.01)),
                            source=kb_id,
                            metadata={
                                "mode": mode,
                                "kb_id": kb_id,
                                "chunk_id": chunk.get("chunk_id"),
                                "reference_id": reference_id or None,
                                "file_path": file_path or None,
                                "vlm_enhanced": bool(vlm_enhanced),
                            },
                        )
                    )
            except Exception as exc:
                logger.warning("RAGEngine: query failed for kb_id={}: {}", kb_id, exc)
                failures.append((kb_id, str(exc)))

        if failures and not all_hits:
            detail = "; ".join(f"{kb_id}: {message}" for kb_id, message in failures)
            raise RuntimeError(f"RAGEngine query failed for all knowledge bases: {detail}")

        return all_hits[:top_k]

    async def delete_kb(self, kb_id: str) -> bool:
        """Delete all LightRAG data for a knowledge base.

        Args:
            kb_id: Knowledge base identifier.

        Returns:
            True if deleted successfully.
        """
        try:
            # Remove from instances cache
            self._instances.pop(kb_id, None)
            self._locks.pop(kb_id, None)

            # Remove working directory
            working_dir = self._kb_working_dir(kb_id)
            if working_dir.exists():
                shutil.rmtree(working_dir)
                logger.info("RAGEngine: deleted working dir for kb_id={}", kb_id)

            return True
        except Exception as exc:
            logger.error("RAGEngine: delete_kb failed for kb_id={}: {}", kb_id, exc)
            return False

    async def delete_document(self, kb_id: str, doc_id: str) -> bool:
        """Delete a specific document from the knowledge base index.

        Note: LightRAG does not natively support per-document deletion in all
        storage backends.  When the feature is unavailable we log a warning
        and return False — the caller should still delete the metadata record.
        """
        try:
            rag = await self._ensure_ready(kb_id)
            # Attempt to use LightRAG's delete_by_doc_id if available
            if hasattr(rag.lightrag, "adelete_by_doc_id"):
                await rag.lightrag.adelete_by_doc_id(doc_id)
                return True
            elif hasattr(rag.lightrag, "delete_by_doc_id"):
                rag.lightrag.delete_by_doc_id(doc_id)
                return True
            else:
                logger.warning(
                    "RAGEngine: delete_document not supported for this LightRAG version "
                    "(kb_id={}, doc_id={})",
                    kb_id,
                    doc_id,
                )
                return False
        except Exception as exc:
            logger.warning("RAGEngine: delete_document failed: {}", exc)
            return False

    async def shutdown_async(self) -> None:
        """Finalize all initialized RAG-Anything storages."""
        for kb_id, rag in list(self._instances.items()):
            try:
                await rag.finalize_storages()
            except Exception as exc:
                logger.warning("RAGEngine: finalize failed for kb_id={}: {}", kb_id, exc)


# ---------------------------------------------------------------------------
# Factory helper
# ---------------------------------------------------------------------------

def _provider_default_api_base(provider_name: str | None) -> str | None:
    if not provider_name:
        return None

    from nanobot.providers.registry import find_by_name

    spec = find_by_name(provider_name)
    if spec and (spec.is_gateway or spec.is_local) and spec.default_api_base:
        return spec.default_api_base
    return None


def _resolve_binding_runtime(
    config: Any,
    *,
    binding_name: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    requested_binding = str(binding_name or "").strip()
    provider_name: str | None = None
    matched_binding_name: str | None = None
    binding = None

    if requested_binding:
        binding = getattr(config, "model_bindings", {}).get(requested_binding)
        if binding is not None:
            matched_binding_name = requested_binding
            provider_name = str(getattr(binding, "provider", "") or "").strip() or None

    if binding is None:
        binding = config.get_binding(model)
        matched_binding_name = config.get_binding_name(model)
        provider_name = config.get_provider_name(model)

    provider_cfg = getattr(getattr(config, "providers", None), provider_name, None) if provider_name else None
    api_key = str(
        getattr(binding, "api_key", None)
        or getattr(provider_cfg, "api_key", None)
        or ""
    )
    api_base = str(
        getattr(binding, "api_base", None)
        or getattr(provider_cfg, "api_base", None)
        or _provider_default_api_base(provider_name)
        or ""
    )
    extra_headers = dict(
        getattr(binding, "extra_headers", None)
        or getattr(provider_cfg, "extra_headers", None)
        or {}
    )

    return {
        "binding": binding,
        "binding_name": matched_binding_name,
        "provider_name": provider_name,
        "api_key": api_key,
        "api_base": api_base,
        "extra_headers": extra_headers,
    }

def create_rag_engine_from_config(
    config: Any,
    instance_dir: Path,
) -> RAGEngine | None:
    """Create a RAGEngine from a nanobot Config object.

    Returns None if the required libraries are not installed.
    """
    if not _check_rag_anything():
        logger.warning(
            "RAG-Anything / LightRAG not installed — "
            "knowledge bases will not be available. "
            "Install with: pip install raganything lightrag-hku"
        )
        return None

    rag_config = config.rag
    llm_model = str(rag_config.llm_model or "").strip()
    llm_runtime = _resolve_binding_runtime(
        config,
        binding_name=rag_config.llm_binding,
        model=llm_model or None,
    )
    default_model = llm_model or str(
        getattr(llm_runtime.get("binding"), "model", None)
        or config.agents.defaults.model
        or "gpt-4o-mini"
    )

    embedding_binding_name = rag_config.embedding_binding or rag_config.llm_binding
    embedding_runtime = _resolve_binding_runtime(
        config,
        binding_name=embedding_binding_name,
        model=rag_config.embedding_model,
    )

    return RAGEngine(
        storage_root=instance_dir / "knowledge" / "lightrag",
        default_model=default_model,
        api_key=llm_runtime["api_key"],
        api_base=llm_runtime["api_base"],
        extra_headers=llm_runtime["extra_headers"],
        embedding_api_key=embedding_runtime["api_key"],
        embedding_api_base=embedding_runtime["api_base"],
        embedding_extra_headers=embedding_runtime["extra_headers"],
        embedding_model=rag_config.embedding_model,
        embedding_dim=rag_config.embedding_dim,
        embedding_max_tokens=rag_config.embedding_max_tokens,
        parser=rag_config.parser,
        mineru_api_base=rag_config.mineru_api_base,
        parse_method=rag_config.parse_method,
        enable_image_processing=rag_config.enable_image_processing,
        enable_table_processing=rag_config.enable_table_processing,
        enable_equation_processing=rag_config.enable_equation_processing,
    )
