"""RAG Engine adapter bridging RAG-Anything/LightRAG with the nanobot platform.

Each knowledge base gets its own RAGAnything + LightRAG instance with an
independent working directory.  LLM and embedding functions are constructed
from the nanobot configuration so they reuse the same model-center settings
that the rest of the platform relies on.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import shutil
import zipfile
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


@dataclass
class MineruParseArtifacts:
    """Normalized parse artifacts returned by the official MinerU API."""

    content_list: list[dict[str, Any]]
    output_dir: Path
    markdown: str = ""
    batch_id: str | None = None
    model_version: str | None = None
    full_zip_url: str | None = None


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
        provider_name: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
        extra_headers: dict[str, str] | None = None,
        embedding_provider_name: str | None = None,
        embedding_api_key: str | None = None,
        embedding_api_base: str | None = None,
        embedding_extra_headers: dict[str, str] | None = None,
        embedding_model: str = "text-embedding-3-large",
        embedding_dim: int = 3072,
        embedding_max_tokens: int = 8192,
        mineru_api_base: str = "",
        mineru_api_token: str = "",
        mineru_model_version: str = "pipeline",
    ) -> None:
        self._storage_root = storage_root
        self._storage_root.mkdir(parents=True, exist_ok=True)

        # Provider config for LLM / embedding calls
        self._default_model = default_model
        self._provider_name = provider_name or ""
        self._api_key = api_key or ""
        self._api_base = api_base or ""
        self._extra_headers = extra_headers or {}

        # Embedding config
        self._embedding_provider_name = (
            self._provider_name if embedding_provider_name is None else (embedding_provider_name or "")
        )
        self._embedding_api_key = self._api_key if embedding_api_key is None else embedding_api_key
        self._embedding_api_base = self._api_base if embedding_api_base is None else embedding_api_base
        self._embedding_extra_headers = (
            dict(self._extra_headers) if embedding_extra_headers is None else dict(embedding_extra_headers)
        )
        self._embedding_model = embedding_model
        self._embedding_dim = embedding_dim
        self._embedding_max_tokens = embedding_max_tokens

        # Document parsing config
        self._mineru_api_base = mineru_api_base
        self._mineru_api_token = mineru_api_token
        self._mineru_model_version = mineru_model_version or "pipeline"

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
                parser="mineru",
                parse_method="auto",
                enable_image_processing=True,
                enable_table_processing=True,
                enable_equation_processing=True,
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

    @staticmethod
    def _canonicalize_provider_prefix(model: str, spec_name: str, canonical_prefix: str) -> str:
        if "/" not in model:
            return model
        prefix, remainder = model.split("/", 1)
        if prefix.lower().replace("-", "_") != spec_name:
            return model
        return f"{canonical_prefix}/{remainder}"

    @staticmethod
    def _resolve_litellm_runtime(
        *,
        model: str,
        provider_name: str | None,
        api_key: str | None,
        api_base: str | None,
        request_type: str = "chat",
    ) -> tuple[str, str | None, str | None]:
        from nanobot.providers.registry import find_by_model, find_by_name, find_gateway

        resolved_model = str(model or "").strip()
        resolved_provider_name = str(provider_name or "").strip() or None
        resolved_api_key = str(api_key or "").strip() or None
        resolved_api_base = str(api_base or "").strip() or None
        custom_llm_provider: str | None = None

        # DashScope embeddings use the OpenAI-compatible embeddings endpoint
        # according to Alibaba Cloud's official docs.
        if request_type == "embedding" and resolved_provider_name == "dashscope":
            return (
                resolved_model.split("/", 1)[-1],
                "openai",
                resolved_api_base or "https://dashscope.aliyuncs.com/compatible-mode/v1",
            )

        spec = find_gateway(resolved_provider_name, resolved_api_key, resolved_api_base)
        if spec is None and resolved_provider_name:
            candidate = find_by_name(resolved_provider_name)
            if candidate and not (candidate.is_gateway or candidate.is_local or candidate.is_oauth or candidate.is_direct):
                spec = candidate
        if spec is None and resolved_model:
            spec = find_by_model(resolved_model)

        if spec and spec.litellm_prefix:
            resolved_model = RAGEngine._canonicalize_provider_prefix(
                resolved_model,
                spec.name,
                spec.litellm_prefix,
            )
            if spec.strip_model_prefix:
                resolved_model = resolved_model.split("/", 1)[-1]
            if not any(resolved_model.startswith(prefix) for prefix in spec.skip_prefixes):
                resolved_model = f"{spec.litellm_prefix}/{resolved_model}"
        elif resolved_api_base and "/" not in resolved_model:
            # OpenAI-compatible custom endpoints still need a provider hint when the
            # model id itself does not include a LiteLLM provider prefix.
            custom_llm_provider = "openai"

        return resolved_model, custom_llm_provider, resolved_api_base or None

    def _build_llm_func(self):
        """Build the async LLM function for RAG-Anything / LightRAG."""
        from litellm import acompletion

        api_key = self._api_key
        api_base = self._api_base or None
        model = self._default_model
        provider_name = self._provider_name
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

            resolved_model, custom_llm_provider, resolved_api_base = self._resolve_litellm_runtime(
                model=model,
                provider_name=provider_name,
                api_key=api_key,
                api_base=api_base,
            )
            kw: dict[str, Any] = {"model": resolved_model, "messages": messages}
            if api_key:
                kw["api_key"] = api_key
            if resolved_api_base:
                kw["api_base"] = resolved_api_base
            if custom_llm_provider:
                kw["custom_llm_provider"] = custom_llm_provider
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
        import numpy as np
        from lightrag.utils import EmbeddingFunc

        api_key = self._embedding_api_key
        api_base = self._embedding_api_base or None
        model = self._embedding_model
        provider_name = self._embedding_provider_name
        extra_headers = self._embedding_extra_headers or None

        async def _embed(texts: list[str]) -> list[list[float]]:
            resolved_model, custom_llm_provider, resolved_api_base = self._resolve_litellm_runtime(
                model=model,
                provider_name=provider_name,
                api_key=api_key,
                api_base=api_base,
                request_type="embedding",
            )
            kw: dict[str, Any] = {"model": resolved_model, "input": texts}
            if api_key:
                kw["api_key"] = api_key
            if resolved_api_base:
                kw["api_base"] = resolved_api_base
            if custom_llm_provider:
                kw["custom_llm_provider"] = custom_llm_provider
            if provider_name == "dashscope" and custom_llm_provider == "openai":
                kw["encoding_format"] = "float"
            if extra_headers:
                kw["extra_headers"] = extra_headers

            response = await aembedding(**kw)
            return np.asarray([item["embedding"] for item in response.data], dtype=float)

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
        provider_name = self._provider_name
        extra_headers = self._extra_headers or None

        async def vision_model_func(
            prompt: str,
            system_prompt: str | None = None,
            history_messages: list | None = None,
            image_data: str | None = None,
            messages: list | None = None,
            **kwargs: Any,
        ) -> str:
            resolved_model, custom_llm_provider, resolved_api_base = self._resolve_litellm_runtime(
                model=model,
                provider_name=provider_name,
                api_key=api_key,
                api_base=api_base,
            )
            kw: dict[str, Any] = {"model": resolved_model}
            if api_key:
                kw["api_key"] = api_key
            if resolved_api_base:
                kw["api_base"] = resolved_api_base
            if custom_llm_provider:
                kw["custom_llm_provider"] = custom_llm_provider
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

    @staticmethod
    def _supported_mineru_api_extensions() -> set[str]:
        return {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".html"}

    @staticmethod
    def _office_like_extensions() -> set[str]:
        return {".doc", ".docx", ".ppt", ".pptx", ".html"}

    def _mineru_api_enabled(self) -> bool:
        return bool(str(self._mineru_api_token or "").strip())

    def _mineru_api_base_url(self) -> str:
        return str(self._mineru_api_base or "").strip().rstrip("/") or "https://mineru.net"

    def _mineru_model_version_for_file(self, file_path: str) -> str:
        suffix = Path(file_path).suffix.lower()
        configured = str(self._mineru_model_version or "pipeline").strip() or "pipeline"
        if suffix == ".html":
            return "MinerU-HTML"
        if configured == "MinerU-HTML":
            logger.warning(
                "RAGEngine: MinerU-HTML only applies to .html files, fallback to pipeline for {}",
                file_path,
            )
            return "pipeline"
        return configured

    def _should_use_mineru_api(self, file_path: str) -> bool:
        return self._mineru_api_enabled() and Path(file_path).suffix.lower() in self._supported_mineru_api_extensions()

    def _requires_official_mineru_api(self, file_path: str) -> bool:
        return Path(file_path).suffix.lower() in self._office_like_extensions()

    def _mineru_headers(self) -> dict[str, str]:
        token = str(self._mineru_api_token or "").strip()
        if not token:
            raise RuntimeError("MinerU API token is not configured.")
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    @staticmethod
    def _require_mineru_success(payload: Any, *, operation: str) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise RuntimeError(f"MinerU {operation} returned an invalid response payload.")
        raw_code = payload.get("code")
        try:
            code = int(raw_code)
        except (TypeError, ValueError):
            code = -1
        if code != 0:
            raise RuntimeError(f"MinerU {operation} failed: {payload.get('msg') or 'unknown error'}")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise RuntimeError(f"MinerU {operation} returned no data payload.")
        return data

    @staticmethod
    def _normalize_mineru_content_list(
        content_list: Any,
        *,
        asset_root: Path,
    ) -> list[dict[str, Any]]:
        if not isinstance(content_list, list):
            return []

        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(content_list):
            if not isinstance(item, dict):
                continue
            next_item = dict(item)
            img_path = str(next_item.get("img_path") or "").strip()
            if img_path and not Path(img_path).is_absolute():
                next_item["img_path"] = str((asset_root / img_path).resolve())
            if next_item.get("page_idx") is None:
                next_item["page_idx"] = 0
            if next_item.get("type") == "text":
                next_item["text"] = str(next_item.get("text") or "").strip()
                if not next_item["text"]:
                    continue
            normalized.append(next_item)
            if index > 100_000:
                break
        return normalized

    @staticmethod
    def _load_mineru_artifacts(output_dir: Path) -> tuple[list[dict[str, Any]], str, Path]:
        content_file = next(output_dir.rglob("*_content_list.json"), None)
        markdown_file = next(output_dir.rglob("full.md"), None)
        asset_root = content_file.parent if content_file is not None else (
            markdown_file.parent if markdown_file is not None else output_dir
        )

        content_list: list[dict[str, Any]] = []
        if content_file is not None:
            try:
                loaded = json.loads(content_file.read_text(encoding="utf-8"))
                if isinstance(loaded, list):
                    content_list = loaded
            except Exception as exc:
                raise RuntimeError(f"Failed to read MinerU content_list output: {exc}") from exc

        markdown = ""
        if markdown_file is not None:
            markdown = markdown_file.read_text(encoding="utf-8").strip()

        return content_list, markdown, asset_root

    async def _parse_file_with_mineru_api(
        self,
        file_path: str,
        *,
        output_dir: Path,
        doc_id: str | None = None,
    ) -> MineruParseArtifacts:
        import httpx

        source_path = Path(file_path)
        if not source_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        headers = self._mineru_headers()
        base_url = self._mineru_api_base_url()
        model_version = self._mineru_model_version_for_file(file_path)
        data_id = str(doc_id or source_path.stem).strip() or source_path.stem
        payload = {
            "files": [{"name": source_path.name, "data_id": data_id}],
            "model_version": model_version,
        }
        if model_version != "MinerU-HTML":
            payload["enable_formula"] = True
            payload["enable_table"] = True

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=15.0, read=60.0, write=60.0, pool=60.0),
            follow_redirects=True,
        ) as client:
            create_response = await client.post(
                f"{base_url}/api/v4/file-urls/batch",
                headers=headers,
                json=payload,
            )
            create_response.raise_for_status()
            create_data = self._require_mineru_success(
                create_response.json(),
                operation="file upload URL request",
            )
            batch_id = str(create_data.get("batch_id") or "").strip()
            file_urls = create_data.get("file_urls")
            if not batch_id or not isinstance(file_urls, list) or not file_urls:
                raise RuntimeError("MinerU file upload URL request returned no batch_id or file_urls.")

            upload_response = await client.put(str(file_urls[0]), content=source_path.read_bytes())
            upload_response.raise_for_status()

            result: dict[str, Any] | None = None
            for _ in range(180):
                poll_response = await client.get(
                    f"{base_url}/api/v4/extract-results/batch/{batch_id}",
                    headers=headers,
                )
                poll_response.raise_for_status()
                poll_data = self._require_mineru_success(
                    poll_response.json(),
                    operation="batch result query",
                )
                extract_result = poll_data.get("extract_result")
                if not isinstance(extract_result, list) or not extract_result:
                    await asyncio.sleep(1.0)
                    continue
                result = next(
                    (
                        item for item in extract_result
                        if str(item.get("data_id") or "").strip() == data_id
                    ),
                    extract_result[0],
                )
                state = str(result.get("state") or "").strip().lower()
                if state == "done":
                    break
                if state == "failed":
                    raise RuntimeError(str(result.get("err_msg") or "MinerU parsing failed."))
                await asyncio.sleep(1.0)
            else:
                raise RuntimeError(f"MinerU batch {batch_id} did not finish within the polling window.")

            if not isinstance(result, dict):
                raise RuntimeError(f"MinerU batch {batch_id} returned no extract result.")
            full_zip_url = str(result.get("full_zip_url") or "").strip()
            if not full_zip_url:
                raise RuntimeError(f"MinerU batch {batch_id} finished without full_zip_url.")

            zip_response = await client.get(full_zip_url)
            zip_response.raise_for_status()

        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(zip_response.content)) as archive:
            archive.extractall(output_dir)

        raw_content_list, markdown, asset_root = self._load_mineru_artifacts(output_dir)
        content_list = self._normalize_mineru_content_list(raw_content_list, asset_root=asset_root)
        if not content_list and markdown:
            content_list = [{"type": "text", "text": markdown, "page_idx": 0}]
        if not content_list:
            raise RuntimeError("MinerU output did not contain content_list.json or full.md.")

        return MineruParseArtifacts(
            content_list=content_list,
            output_dir=output_dir,
            markdown=markdown,
            batch_id=batch_id,
            model_version=model_version,
            full_zip_url=full_zip_url,
        )

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
            output_root = Path(output_dir) if output_dir else (working_dir / "parsed_output")
            output_dir_path = output_root if output_dir else output_root / str(doc_id or Path(file_path).stem or "document")
            output_dir_path.mkdir(parents=True, exist_ok=True)

            parser_name = "mineru"
            use_mineru_api = self._should_use_mineru_api(file_path)
            if not use_mineru_api and self._requires_official_mineru_api(file_path):
                raise RuntimeError(
                    "Office/HTML documents require the official MinerU API path. "
                    "Please configure MinerU API Token and restart the Web backend to apply the new RAG engine."
                )

            logger.info(
                "RAGEngine: parse route for kb_id={} file_path={} -> {}",
                kb_id,
                file_path,
                "official MinerU API" if use_mineru_api else "local RAG-Anything parser",
            )

            if use_mineru_api:
                parser_name = "mineru_api"
                artifacts = await self._parse_file_with_mineru_api(
                    file_path,
                    output_dir=output_dir_path,
                    doc_id=doc_id,
                )
                await rag.insert_content_list(
                    artifacts.content_list,
                    file_path=file_path,
                    doc_id=doc_id,
                )
                metadata: dict[str, Any] = {
                    "output_dir": str(artifacts.output_dir),
                    "file_path": file_path,
                    "mineru_batch_id": artifacts.batch_id,
                    "mineru_model_version": artifacts.model_version,
                    "mineru_full_zip_url": artifacts.full_zip_url,
                }
                if doc_id:
                    metadata["doc_id"] = doc_id
            else:
                processed = await rag.process_document_complete(
                    file_path=file_path,
                    output_dir=str(output_dir_path),
                    parse_method="auto",
                    doc_id=doc_id,
                    **kwargs,
                )
                if processed is False:
                    raise RuntimeError(
                        f"RAGAnything reported unsuccessful document processing for kb_id={kb_id}, "
                        f"file_path={file_path}."
                    )
                metadata = {
                    "output_dir": str(output_dir_path),
                    "file_path": file_path,
                }
                if doc_id:
                    metadata["doc_id"] = doc_id

            status = await self._require_processed_status(
                rag,
                kb_id=kb_id,
                operation="parse_and_index",
                doc_id=doc_id,
                file_path=file_path,
            )

            return ParseResult(
                success=True,
                parser_name=parser_name,
                metadata={
                    **metadata,
                    "chunks_count": int(status.get("chunks_count") or 0),
                },
            )
        except Exception as exc:
            logger.error("RAGEngine: parse_and_index failed for kb_id={}: {}", kb_id, exc)
            return ParseResult(
                success=False,
                parser_name="mineru_api" if self._should_use_mineru_api(file_path) else "mineru",
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

    async def insert_chunks(
        self,
        kb_id: str,
        chunks: list[str],
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> ParseResult:
        """Insert pre-split chunks for cases where the caller controls chunking."""
        try:
            rag = await self._ensure_ready(kb_id)
            normalized_chunks = [str(item or "").strip() for item in chunks if str(item or "").strip()]
            if not normalized_chunks:
                raise ValueError("chunks are required.")
            await rag.insert_content_list(
                [
                    {"type": "text", "text": item, "page_idx": index}
                    for index, item in enumerate(normalized_chunks)
                ],
                file_path=file_path or f"{kb_id}.txt",
                doc_id=doc_id,
            )
            status = await self._require_processed_status(
                rag,
                kb_id=kb_id,
                operation="insert_chunks",
                doc_id=doc_id,
                file_path=file_path,
            )
            return ParseResult(
                success=True,
                parser_name="chunk_insert",
                metadata={
                    "doc_id": doc_id,
                    "file_path": file_path,
                    "chunks_count": int(status.get("chunks_count") or len(normalized_chunks)),
                },
            )
        except Exception as exc:
            logger.error("RAGEngine: insert_chunks failed for kb_id={}: {}", kb_id, exc)
            return ParseResult(
                success=False,
                parser_name="chunk_insert",
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
            "mix": "mix",
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

    async def query_structured(
        self,
        kb_id: str,
        query_text: str,
        *,
        mode: str = "hybrid",
        top_k: int = 8,
        chunk_top_k: int = 12,
        response_type: str = "Multiple Paragraphs",
        only_need_context: bool = False,
        only_need_prompt: bool = False,
        enable_rerank: bool = False,
    ) -> dict[str, Any]:
        """Return structured LightRAG query data for a single knowledge base."""
        from lightrag import QueryParam

        rag = await self._ensure_ready(kb_id)
        param_fields = getattr(QueryParam, "__annotations__", {})
        query_kwargs: dict[str, Any] = {
            "mode": {
                "keyword": "naive",
                "semantic": "local",
                "hybrid": "hybrid",
                "local": "local",
                "global": "global",
                "naive": "naive",
                "mix": "mix",
            }.get(str(mode or "").strip().lower(), "hybrid"),
            "top_k": max(1, int(top_k)),
            "chunk_top_k": max(1, int(chunk_top_k)),
            "response_type": response_type,
            "only_need_context": bool(only_need_context),
            "only_need_prompt": bool(only_need_prompt),
            "enable_rerank": bool(enable_rerank),
            "include_references": True,
        }
        filtered_kwargs = {key: value for key, value in query_kwargs.items() if key in param_fields}
        return await rag.lightrag.aquery_data(query_text, QueryParam(**filtered_kwargs))

    async def get_graph_labels(self, kb_id: str) -> list[str]:
        """Return graph labels for a knowledge base."""
        rag = await self._ensure_ready(kb_id)
        labels = await rag.lightrag.get_graph_labels()
        if isinstance(labels, dict):
            values = labels.get("labels") or labels.get("data") or []
            return [str(item) for item in values]
        if isinstance(labels, list):
            return [str(item) for item in labels]
        return []

    @staticmethod
    def _normalize_graph(graph: Any, *, labels: list[str]) -> dict[str, Any]:
        nodes = []
        edges = []
        for item in getattr(graph, "nodes", []) or []:
            properties = dict(getattr(item, "properties", {}) or {})
            nodes.append(
                {
                    "id": str(getattr(item, "id", "")),
                    "labels": [str(label) for label in (getattr(item, "labels", []) or [])],
                    "properties": properties,
                    "title": str(properties.get("entity_name") or properties.get("name") or getattr(item, "id", "")),
                }
            )
        for item in getattr(graph, "edges", []) or []:
            properties = dict(getattr(item, "properties", {}) or {})
            edges.append(
                {
                    "id": str(getattr(item, "id", "")),
                    "type": str(getattr(item, "type", "") or properties.get("keywords") or "related"),
                    "source": str(getattr(item, "source", "")),
                    "target": str(getattr(item, "target", "")),
                    "properties": properties,
                }
            )
        return {
            "nodes": nodes,
            "edges": edges,
            "labels": labels,
            "isTruncated": bool(getattr(graph, "is_truncated", False)),
        }

    async def get_knowledge_graph(
        self,
        kb_id: str,
        *,
        label: str = "*",
        max_depth: int = 2,
        max_nodes: int = 50,
    ) -> dict[str, Any]:
        """Return a normalized LightRAG graph payload."""
        rag = await self._ensure_ready(kb_id)
        labels = await self.get_graph_labels(kb_id)
        graph = await rag.lightrag.get_knowledge_graph(
            node_label=label,
            max_depth=max(1, int(max_depth)),
            max_nodes=max(10, int(max_nodes)),
        )
        return self._normalize_graph(graph, labels=labels)

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
    from nanobot.providers.registry import find_by_name

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
    provider_spec = find_by_name(provider_name) if provider_name else None
    api_key = str(
        getattr(binding, "api_key", None)
        or getattr(provider_cfg, "api_key", None)
        or (os.getenv(provider_spec.env_key) if provider_spec and provider_spec.env_key else None)
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


def _first_binding_name_by_capability(config: Any, capability_type: str) -> str | None:
    for binding_name, binding in getattr(config, "model_bindings", {}).items():
        if str(getattr(binding, "capability_type", "") or "").strip() == capability_type:
            return str(binding_name)
    return None


def _infer_embedding_dim(model: str | None, provider_name: str | None = None) -> int:
    model_name = str(model or "").strip().lower()
    provider = str(provider_name or "").strip().lower()
    if provider == "dashscope" and "text-embedding-v4" in model_name:
        return 1024
    if "text-embedding-3-small" in model_name or "text-embedding-ada-002" in model_name:
        return 1536
    return 3072

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
    llm_binding_name = str(rag_config.llm_binding or "").strip() or None
    llm_runtime = _resolve_binding_runtime(
        config,
        binding_name=llm_binding_name,
        model=None,
    )
    default_model = str(
        getattr(llm_runtime.get("binding"), "model", None)
        or config.agents.defaults.model
        or "gpt-4o-mini"
    )

    embedding_binding_name = (
        str(rag_config.embedding_binding or "").strip()
        or _first_binding_name_by_capability(config, "embedding")
        or llm_binding_name
    )
    embedding_runtime = _resolve_binding_runtime(
        config,
        binding_name=embedding_binding_name,
        model=None,
    )
    embedding_model = str(
        getattr(embedding_runtime.get("binding"), "model", None)
        or "text-embedding-3-large"
    )
    embedding_dim = _infer_embedding_dim(embedding_model, embedding_runtime["provider_name"])

    return RAGEngine(
        storage_root=instance_dir / "knowledge" / "lightrag",
        default_model=default_model,
        provider_name=llm_runtime["provider_name"],
        api_key=llm_runtime["api_key"],
        api_base=llm_runtime["api_base"],
        extra_headers=llm_runtime["extra_headers"],
        embedding_provider_name=embedding_runtime["provider_name"],
        embedding_api_key=embedding_runtime["api_key"],
        embedding_api_base=embedding_runtime["api_base"],
        embedding_extra_headers=embedding_runtime["extra_headers"],
        embedding_model=embedding_model,
        embedding_dim=embedding_dim,
        mineru_api_base=rag_config.mineru_api_base,
        mineru_api_token=rag_config.mineru_api_token,
        mineru_model_version=rag_config.mineru_model_version,
    )
