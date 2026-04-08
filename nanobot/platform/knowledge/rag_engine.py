"""RAG Engine — LightRAG Core embedded adapter for nanobot.

Each knowledge base gets its own LightRAG instance with an independent
workspace.  LLM and embedding functions are constructed from nanobot's
``Config.model_bindings`` so they reuse the same model-center settings
that the rest of the platform relies on.

Architecture:
    Nanobot Process (LightRAG Core embedded)
        ├── llm_model_func  → reads nanobot config → calls provider API
        ├── embedding_func  → reads nanobot config → calls provider API
        ├── Neo4j (Docker)  ← graph_storage="Neo4JStorage"
        └── Milvus (Docker) ← vector_storage="MilvusVectorDBStorage"
"""

from __future__ import annotations

import asyncio
import collections
import os
import re
import shutil
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from loguru import logger

# ---------------------------------------------------------------------------
# Lazy imports — heavy libraries are only loaded when actually needed
# ---------------------------------------------------------------------------
_lightrag_available: bool | None = None


def _check_lightrag() -> bool:
    global _lightrag_available
    if _lightrag_available is None:
        try:
            import lightrag  # noqa: F401
            _lightrag_available = True
        except ImportError:
            _lightrag_available = False
    return _lightrag_available


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class IndexResult:
    """Outcome of a document indexing operation."""
    success: bool
    doc_id: str | None = None
    track_id: str | None = None
    chunks_count: int = 0
    error: str | None = None


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
    """Adapter layer between nanobot and LightRAG Core.

    * Creates one ``LightRAG`` instance per knowledge base (lazy).
    * Injects nanobot's ``modelBindings`` as LLM / embedding functions.
    * Uses Milvus for vector storage, Neo4j for graph storage.
    * Exposes ``insert_text``, ``query_structured``, ``get_knowledge_graph``
      as the public API consumed by ``KnowledgeBaseService``.
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
        llm_timeout: float = 180.0,
        embedding_timeout: float = 60.0,
        lightrag_base_kwargs: dict[str, Any] | None = None,
        storage_env: dict[str, str] | None = None,
        max_cached_instances: int = 5,
    ) -> None:
        self._storage_root = storage_root
        self._storage_root.mkdir(parents=True, exist_ok=True)

        # LLM config
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
        self._llm_timeout = max(float(llm_timeout or 0), 1.0)
        self._embedding_timeout = max(float(embedding_timeout or 0), 1.0)

        self._lightrag_base_kwargs = dict(lightrag_base_kwargs or {})
        self._storage_env = {k: v for k, v in dict(storage_env or {}).items() if str(v or "").strip()}

        # Per-KB instances (lazy loaded)
        self._instances: collections.OrderedDict[str, Any] = collections.OrderedDict()  # kb_id -> LightRAG
        self._locks: dict[str, asyncio.Lock] = {}
        self._kb_runtime_resolver: Callable[[str], dict[str, Any] | None] | None = None
        self._max_cached_instances = max(1, max_cached_instances)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _await_request(coro: Any, *, timeout: float, operation: str) -> Any:
        try:
            return await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise TimeoutError(f"{operation} timed out after {timeout:.0f}s") from exc

    @staticmethod
    def _sanitize_workspace_id(value: str) -> str:
        normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip()).strip("_")
        return normalized or "knowledge"

    def _kb_storage_workspace(self, kb_id: str) -> str:
        return f"kb_{self._sanitize_workspace_id(kb_id)}"

    def _kb_working_dir(self, kb_id: str) -> Path:
        return self._storage_root / kb_id

    def _get_lock(self, kb_id: str) -> asyncio.Lock:
        if kb_id not in self._locks:
            self._locks[kb_id] = asyncio.Lock()
        return self._locks[kb_id]

    @staticmethod
    def _normalize_query_mode(mode: str | None) -> str:
        return {
            "keyword": "naive", "semantic": "local", "hybrid": "hybrid",
            "local": "local", "global": "global", "naive": "naive", "mix": "mix",
        }.get(str(mode or "").strip().lower(), "hybrid")

    @staticmethod
    def _is_timeout_like_error(exc: Exception) -> bool:
        msg = str(exc).lower()
        return isinstance(exc, (TimeoutError, asyncio.TimeoutError)) or "timeout" in msg

    @contextmanager
    def _storage_env_scope(self):
        """Temporarily set storage env vars (Neo4j/Milvus connection)."""
        if not self._storage_env:
            yield
            return
        original: dict[str, str | None] = {}
        try:
            for key, value in self._storage_env.items():
                original[key] = os.environ.get(key)
                os.environ[key] = value
            yield
        finally:
            for key, previous in original.items():
                if previous is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = previous

    def set_kb_runtime_resolver(
        self,
        resolver: Callable[[str], dict[str, Any] | None] | None,
    ) -> None:
        """Set a callback to resolve per-KB model overrides."""
        self._kb_runtime_resolver = resolver

    # ------------------------------------------------------------------
    # Model function builders
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_litellm_runtime(
        *,
        model: str,
        provider_name: str | None,
        api_key: str | None,
        api_base: str | None,
        request_type: str = "chat",
    ) -> tuple[str, str | None, str | None]:
        """Resolve model string and provider for LiteLLM calls."""
        from nanobot.providers.registry import find_by_model, find_by_name, find_gateway

        resolved_model = str(model or "").strip()
        resolved_provider_name = str(provider_name or "").strip() or None
        resolved_api_base = str(api_base or "").strip() or None
        custom_llm_provider: str | None = None

        # DashScope embeddings use OpenAI-compatible endpoint
        if request_type == "embedding" and resolved_provider_name == "dashscope":
            return (
                resolved_model.split("/", 1)[-1],
                "openai",
                resolved_api_base or "https://dashscope.aliyuncs.com/compatible-mode/v1",
            )

        spec = find_gateway(resolved_provider_name, api_key, resolved_api_base)
        if spec is None and resolved_provider_name:
            candidate = find_by_name(resolved_provider_name)
            if candidate and not (candidate.is_gateway or candidate.is_local or candidate.is_oauth or candidate.is_direct):
                spec = candidate
        if spec is None and resolved_model:
            spec = find_by_model(resolved_model)

        if spec and spec.litellm_prefix:
            if spec.strip_model_prefix:
                resolved_model = resolved_model.split("/", 1)[-1]
            if not any(resolved_model.startswith(p) for p in spec.skip_prefixes):
                resolved_model = f"{spec.litellm_prefix}/{resolved_model}"
        elif resolved_api_base and "/" not in resolved_model:
            custom_llm_provider = "openai"

        return resolved_model, custom_llm_provider, resolved_api_base

    def _build_llm_func(self, runtime: dict[str, Any] | None = None):
        """Build the async LLM function for LightRAG."""
        from litellm import acompletion

        rt = dict(runtime or {})
        api_key = str(rt.get("llm_api_key") or self._api_key or "")
        api_base = str(rt.get("llm_api_base") or self._api_base or "").strip() or None
        model = str(rt.get("llm_model") or self._default_model or "").strip()
        provider_name = str(rt.get("llm_provider_name") or self._provider_name or "").strip()
        extra_headers = dict(rt.get("llm_extra_headers") or self._extra_headers or {}) or None

        resolved_model, custom_llm_provider, resolved_api_base = self._resolve_litellm_runtime(
            model=model, provider_name=provider_name, api_key=api_key, api_base=api_base,
        )

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

            kw: dict[str, Any] = {"model": resolved_model, "messages": messages}
            if api_key:
                kw["api_key"] = api_key
            if resolved_api_base:
                kw["api_base"] = resolved_api_base
            if custom_llm_provider:
                kw["custom_llm_provider"] = custom_llm_provider
            if extra_headers:
                kw["extra_headers"] = extra_headers
            kw["timeout"] = self._llm_timeout
            for pt in ("temperature", "max_tokens"):
                if pt in kwargs:
                    kw[pt] = kwargs[pt]

            # Retry with exponential backoff for rate limit errors (429)
            max_retries = 5
            for attempt in range(max_retries):
                try:
                    response = await self._await_request(
                        acompletion(**kw), timeout=self._llm_timeout, operation="LightRAG LLM request",
                    )
                    return response.choices[0].message.content or ""
                except Exception as exc:
                    is_rate_limit = "429" in str(exc) or "rate" in str(exc).lower() or "quota" in str(exc).lower()
                    if is_rate_limit and attempt < max_retries - 1:
                        wait = min(2 ** attempt * 5, 60)  # 5s, 10s, 20s, 40s, 60s
                        logger.warning(
                            "RAGEngine: LLM rate limited (attempt {}/{}), retrying in {:.0f}s",
                            attempt + 1, max_retries, wait,
                        )
                        await asyncio.sleep(wait)
                        continue
                    raise

        return llm_model_func

    def _build_embedding_func(self, runtime: dict[str, Any] | None = None):
        """Build the embedding function for LightRAG."""
        from litellm import aembedding
        import numpy as np
        from lightrag.utils import EmbeddingFunc

        rt = dict(runtime or {})
        api_key = str(rt.get("embedding_api_key") or self._embedding_api_key or "")
        api_base = str(rt.get("embedding_api_base") or self._embedding_api_base or "").strip() or None
        model = str(rt.get("embedding_model") or self._embedding_model or "").strip()
        provider_name = str(rt.get("embedding_provider_name") or self._embedding_provider_name or "").strip()
        extra_headers = dict(rt.get("embedding_extra_headers") or self._embedding_extra_headers or {}) or None
        dim = int(rt.get("embedding_dim") or self._embedding_dim)
        max_tokens = int(rt.get("embedding_max_tokens") or self._embedding_max_tokens)

        async def _embed(texts: list[str]) -> np.ndarray:
            resolved_model, custom_llm_provider, resolved_api_base = self._resolve_litellm_runtime(
                model=model, provider_name=provider_name, api_key=api_key,
                api_base=api_base, request_type="embedding",
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
            kw["timeout"] = self._embedding_timeout

            # Retry with exponential backoff for rate limit errors (429)
            max_retries = 5
            for attempt in range(max_retries):
                try:
                    response = await self._await_request(
                        aembedding(**kw), timeout=self._embedding_timeout, operation="LightRAG embedding request",
                    )
                    return np.array([item["embedding"] for item in response.data])
                except Exception as exc:
                    is_rate_limit = "429" in str(exc) or "rate" in str(exc).lower() or "quota" in str(exc).lower()
                    if is_rate_limit and attempt < max_retries - 1:
                        wait = min(2 ** attempt * 5, 60)  # 5s, 10s, 20s, 40s, 60s
                        logger.warning(
                            "RAGEngine: embedding rate limited (attempt {}/{}), retrying in {:.0f}s",
                            attempt + 1, max_retries, wait,
                        )
                        await asyncio.sleep(wait)
                        continue
                    raise

        return EmbeddingFunc(
            embedding_dim=dim,
            max_token_size=max_tokens,
            model_name=model,
            func=_embed,
        )

    # ------------------------------------------------------------------
    # Instance lifecycle
    # ------------------------------------------------------------------

    async def _create_instance(self, kb_id: str) -> Any:
        """Create and initialize a LightRAG instance for a KB."""
        from lightrag import LightRAG

        working_dir = self._kb_working_dir(kb_id)
        working_dir.mkdir(parents=True, exist_ok=True)

        runtime = self._resolve_kb_runtime(kb_id)
        
        rt = dict(runtime or {})
        provider_name = str(rt.get("embedding_provider_name") or self._embedding_provider_name or "").strip()
        
        kwargs = {
            **self._lightrag_base_kwargs,
            "working_dir": str(working_dir),
            "workspace": self._kb_storage_workspace(kb_id),
            "llm_model_func": self._build_llm_func(runtime),
            "embedding_func": self._build_embedding_func(runtime),
        }
        
        # DashScope has a strict batch size limit for text embedding requests
        if provider_name == "dashscope":
            kwargs["embedding_batch_num"] = min(kwargs.get("embedding_batch_num", 10), 10)

        with self._storage_env_scope():
            rag = LightRAG(**kwargs)
            await rag.initialize_storages()

        return rag

    def _resolve_kb_runtime(self, kb_id: str) -> dict[str, Any] | None:
        """Try to get per-KB model overrides from the resolver."""
        if self._kb_runtime_resolver is None:
            return None
        try:
            return self._kb_runtime_resolver(kb_id)
        except Exception as exc:
            logger.warning("RAGEngine: failed to resolve kb runtime for kb_id={}: {}", kb_id, exc)
            return None

    async def ensure_instance(self, kb_id: str) -> Any:
        """Get or create the ready-to-use LightRAG instance for a KB."""
        lock = self._get_lock(kb_id)
        async with lock:
            if kb_id in self._instances:
                self._instances.move_to_end(kb_id)
                return self._instances[kb_id]
            logger.info("RAGEngine: initializing LightRAG for kb_id={}", kb_id)
            rag = await self._create_instance(kb_id)
            self._instances[kb_id] = rag
            
            if len(self._instances) > self._max_cached_instances:
                await self._evict_lru_instance(exclude=kb_id)
                
            return rag
            
    async def _evict_lru_instance(self, *, exclude: str | None = None) -> None:
        """Evict the least recently used LightRAG instance to free up memory."""
        evict_id = None
        for kb_id in self._instances.keys():
            if kb_id != exclude:
                evict_id = kb_id
                break
                
        if evict_id is None:
            return
            
        rag = self._instances.pop(evict_id)
        logger.info("RAGEngine: evicting LRU LightRAG instance for kb_id={}", evict_id)
        try:
            await rag.finalize_storages()
        except Exception as exc:
            logger.warning("RAGEngine: finalize failed during eviction for kb_id={}: {}", evict_id, exc)

    async def health_check(self) -> dict[str, Any]:
        """Return health status and basic stats of the RAG engine."""
        return {
            "status": "healthy" if _check_lightrag() else "degraded",
            "active_instances": len(self._instances),
            "max_instances": self._max_cached_instances,
            "lightrag_available": _check_lightrag(),
        }

    async def reset_kb(self, kb_id: str) -> None:
        """Finalize and evict a cached per-KB RAG instance."""
        rag = self._instances.pop(kb_id, None)
        if rag is None:
            return
        try:
            await rag.finalize_storages()
        except Exception as exc:
            logger.warning("RAGEngine: finalize failed during reset for kb_id={}: {}", kb_id, exc)

    async def shutdown_async(self) -> None:
        """Shut down all LightRAG instances."""
        for kb_id, rag in list(self._instances.items()):
            try:
                await rag.finalize_storages()
            except Exception as exc:
                logger.warning("RAGEngine: finalize failed for kb_id={}: {}", kb_id, exc)
        self._instances.clear()
        self._locks.clear()

    # ------------------------------------------------------------------
    # Public API: Insert
    # ------------------------------------------------------------------

    async def insert_text(
        self,
        kb_id: str,
        text: str,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> IndexResult:
        """Insert text into a knowledge base via LightRAG."""
        rag = await self.ensure_instance(kb_id)
        content = str(text or "").strip()
        if not content:
            return IndexResult(success=False, doc_id=doc_id, error="text is required.")

        try:
            ids = [doc_id] if doc_id else None
            file_paths = [file_path or f"{kb_id}.txt"] if file_path or doc_id else None
            # Dynamic timeout: base 540s + 15s per 1000 chars (large docs need hours)
            insert_timeout = max(self._llm_timeout * 3, len(content) / 1000 * 15)
            await self._await_request(
                rag.ainsert(content, ids=ids, file_paths=file_paths),
                timeout=insert_timeout,
                operation=f"insert_text(kb={kb_id})",
            )

            # Check doc status for chunks_count
            chunks_count = 0
            if doc_id:
                doc_status_store = getattr(rag, "doc_status", None)
                if doc_status_store:
                    try:
                        status = await doc_status_store.get_by_id(doc_id)
                        if status:
                            chunks_count = int(status.get("chunks_count") or 0)
                    except Exception:
                        pass

            return IndexResult(
                success=True,
                doc_id=doc_id,
                chunks_count=chunks_count,
            )
        except Exception as exc:
            logger.error("RAGEngine: insert_text failed for kb_id={}: {}", kb_id, exc)
            return IndexResult(success=False, doc_id=doc_id, error=str(exc))

    # ------------------------------------------------------------------
    # Public API: Query
    # ------------------------------------------------------------------

    async def query_structured(
        self,
        kb_id: str,
        query_text: str,
        *,
        mode: str = "mix",
        top_k: int = 10,
        chunk_top_k: int = 20,
        response_type: str = "Multiple Paragraphs",
        only_need_context: bool = False,
        only_need_prompt: bool = False,
        enable_rerank: bool = True,
    ) -> dict[str, Any]:
        """Query a knowledge base and return structured results."""
        from lightrag import QueryParam

        rag = await self.ensure_instance(kb_id)
        normalized_mode = self._normalize_query_mode(mode)

        query_kwargs = {
            "mode": normalized_mode,
            "top_k": max(1, int(top_k)),
            "chunk_top_k": max(1, int(chunk_top_k)),
            "response_type": response_type,
            "only_need_context": bool(only_need_context),
            "only_need_prompt": bool(only_need_prompt),
            "enable_rerank": bool(enable_rerank),
        }

        # Filter to only supported QueryParam fields
        import dataclasses
        param_fields = {f.name for f in dataclasses.fields(QueryParam)}
        filtered_kwargs = {k: v for k, v in query_kwargs.items() if k in param_fields}

        try:
            result = await rag.aquery_data(query_text, QueryParam(**filtered_kwargs))

            # Fallback to naive mode if no evidence found
            if normalized_mode != "naive" and not _has_structured_evidence(result):
                logger.warning(
                    "RAGEngine: query returned no evidence for kb_id={} mode={}, retrying with naive",
                    kb_id, normalized_mode,
                )
                fallback_kwargs = dict(filtered_kwargs)
                fallback_kwargs["mode"] = "naive"
                result = await rag.aquery_data(query_text, QueryParam(**fallback_kwargs))

            return result
        except Exception as exc:
            # Fallback to naive on timeout
            if normalized_mode != "naive" and self._is_timeout_like_error(exc):
                logger.warning(
                    "RAGEngine: query timeout for kb_id={} mode={}, retrying with naive",
                    kb_id, normalized_mode,
                )
                fallback_kwargs = dict(filtered_kwargs)
                fallback_kwargs["mode"] = "naive"
                return await rag.aquery_data(query_text, QueryParam(**fallback_kwargs))
            raise

    # ------------------------------------------------------------------
    # Public API: Knowledge Graph
    # ------------------------------------------------------------------

    async def get_graph_labels(self, kb_id: str) -> list[str]:
        """Return graph labels for a knowledge base."""
        rag = await self.ensure_instance(kb_id)
        try:
            labels = await rag.get_graph_labels()
            if isinstance(labels, dict):
                values = labels.get("labels") or labels.get("data") or []
                return [str(item) for item in values]
            if isinstance(labels, list):
                return [str(item) for item in labels]
        except Exception as exc:
            logger.warning("RAGEngine: get_graph_labels failed for kb_id={}: {}", kb_id, exc)
        return []

    async def get_knowledge_graph(
        self,
        kb_id: str,
        *,
        label: str = "*",
        max_depth: int = 2,
        max_nodes: int = 50,
    ) -> dict[str, Any]:
        """Return a normalized knowledge graph payload."""
        rag = await self.ensure_instance(kb_id)
        labels = await self.get_graph_labels(kb_id)
        try:
            graph = await rag.get_knowledge_graph(
                node_label=label,
                max_depth=max(1, int(max_depth)),
                max_nodes=max(10, int(max_nodes)),
            )
            return self._normalize_graph(graph, labels=labels)
        except Exception as exc:
            logger.warning("RAGEngine: get_knowledge_graph failed for kb_id={}: {}", kb_id, exc)
            return {"nodes": [], "edges": [], "labels": labels, "isTruncated": False}

    @staticmethod
    def _normalize_graph(graph: Any, *, labels: list[str]) -> dict[str, Any]:
        """Normalize LightRAG graph objects to frontend-compatible dicts."""
        nodes = []
        edges = []
        for item in getattr(graph, "nodes", []) or []:
            properties = dict(getattr(item, "properties", {}) or {})
            nodes.append({
                "id": str(getattr(item, "id", "")),
                "labels": [str(lbl) for lbl in (getattr(item, "labels", []) or [])],
                "properties": properties,
                "title": str(
                    properties.get("entity_name")
                    or properties.get("name")
                    or getattr(item, "id", "")
                ),
            })
        for item in getattr(graph, "edges", []) or []:
            properties = dict(getattr(item, "properties", {}) or {})
            edges.append({
                "id": str(getattr(item, "id", "")),
                "type": str(
                    getattr(item, "type", "")
                    or properties.get("keywords")
                    or "related"
                ),
                "source": str(getattr(item, "source", "")),
                "target": str(getattr(item, "target", "")),
                "properties": properties,
            })
        return {
            "nodes": nodes,
            "edges": edges,
            "labels": labels,
            "isTruncated": bool(getattr(graph, "is_truncated", False)),
        }

    # ------------------------------------------------------------------
    # Public API: Delete
    # ------------------------------------------------------------------

    async def delete_document(self, kb_id: str, doc_id: str) -> bool:
        """Delete a single document from the KB."""
        try:
            rag = await self.ensure_instance(kb_id)
            await rag.adelete_by_doc_id(doc_id)
            return True
        except Exception as exc:
            logger.warning("RAGEngine: delete_document failed for kb_id={} doc_id={}: {}", kb_id, doc_id, exc)
            return False

    async def delete_kb(self, kb_id: str) -> bool:
        """Delete all data for a knowledge base."""
        try:
            rag = self._instances.get(kb_id)
            if rag is None:
                try:
                    rag = await self.ensure_instance(kb_id)
                except Exception as exc:
                    logger.warning(
                        "RAGEngine: failed to init kb_id={} during delete, cleaning workspace only: {}",
                        kb_id, exc,
                    )
                    rag = None

            if rag is not None:
                try:
                    await self._drop_kb_storage_data(rag)
                finally:
                    try:
                        await rag.finalize_storages()
                    except Exception as exc:
                        logger.warning("RAGEngine: finalize failed during delete for kb_id={}: {}", kb_id, exc)

            # Clean up workspace directory
            working_dir = self._kb_working_dir(kb_id)
            if working_dir.exists():
                shutil.rmtree(working_dir, ignore_errors=True)

            # Evict instance
            self._instances.pop(kb_id, None)
            self._locks.pop(kb_id, None)
            return True
        except Exception as exc:
            logger.error("RAGEngine: delete_kb failed for kb_id={}: {}", kb_id, exc)
            return False

    @staticmethod
    async def _drop_storage_data(storage: Any) -> None:
        if storage is None:
            return
        drop = getattr(storage, "drop", None)
        if callable(drop):
            await drop()

    @staticmethod
    async def _drop_vector_storage_data(storage: Any) -> None:
        if storage is None:
            return
        client = getattr(storage, "_client", None)
        namespace = str(
            getattr(storage, "final_namespace", None) or getattr(storage, "namespace", None) or ""
        ).strip()
        has_collection = getattr(client, "has_collection", None)
        drop_collection = getattr(client, "drop_collection", None)
        if namespace and callable(has_collection) and callable(drop_collection):
            if has_collection(namespace):
                drop_collection(namespace)
            return
        await RAGEngine._drop_storage_data(storage)

    async def _drop_kb_storage_data(self, rag: Any) -> None:
        """Drop all LightRAG storage data for a KB."""
        for label in (
            "full_docs", "text_chunks", "full_entities", "full_relations",
            "entity_chunks", "relation_chunks", "chunk_entity_relation_graph",
            "llm_response_cache", "doc_status",
        ):
            storage = getattr(rag, label, None)
            if storage:
                try:
                    await self._drop_storage_data(storage)
                except Exception as exc:
                    logger.warning("RAGEngine: failed to drop {} during kb cleanup: {}", label, exc)

        for label in ("entities_vdb", "relationships_vdb", "chunks_vdb"):
            storage = getattr(rag, label, None)
            if storage:
                try:
                    await self._drop_vector_storage_data(storage)
                except Exception as exc:
                    logger.warning("RAGEngine: failed to drop {} during kb cleanup: {}", label, exc)

    # ------------------------------------------------------------------
    # Public API: Prepare ingest (prune stale docs)
    # ------------------------------------------------------------------

    async def prepare_document_ingest(self, kb_id: str, doc_id: str) -> dict[str, list[str]]:
        """Delete existing doc and prune any retryable docs before re-ingest."""
        rag = await self.ensure_instance(kb_id)
        deleted_doc_ids: list[str] = []
        pruned_doc_ids: list[str] = []

        # Delete the target doc
        if await self.delete_document(kb_id, doc_id):
            deleted_doc_ids.append(doc_id)

        # Prune failed/pending/processing docs
        doc_status_store = getattr(rag, "doc_status", None)
        if doc_status_store and hasattr(doc_status_store, "get_docs_by_status"):
            from lightrag.utils import DocStatus
            for status_enum in (DocStatus.FAILED, DocStatus.PENDING, DocStatus.PROCESSING):
                try:
                    docs = await doc_status_store.get_docs_by_status(status_enum)
                    for stale_id in docs:
                        pruned_doc_ids.append(stale_id)
                        if await self.delete_document(kb_id, stale_id):
                            deleted_doc_ids.append(stale_id)
                except Exception:
                    pass

        return {"deletedDocIds": deleted_doc_ids, "prunedDocIds": pruned_doc_ids}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _has_structured_evidence(result: Any) -> bool:
    """Check if a query result contains meaningful evidence."""
    data = result.get("data", {}) if isinstance(result, dict) else {}
    chunks = data.get("chunks") or []
    refs = data.get("references") or []
    return bool(chunks or refs)


def _provider_default_api_base(provider_name: str | None) -> str | None:
    """Return the default API base for well-known providers."""
    name = str(provider_name or "").strip().lower()
    return {
        "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "moonshot": "https://api.moonshot.cn/v1",
        "deepseek": "https://api.deepseek.com",
    }.get(name)


def _resolve_binding_runtime(
    config: Any,
    *,
    binding_name: str | None,
    model: str | None,
) -> dict[str, Any]:
    """Resolve a model binding to concrete runtime parameters."""
    from nanobot.providers.registry import find_by_name

    requested_binding = str(binding_name or "").strip() or None
    binding = None
    provider_name: str | None = None

    if requested_binding:
        binding = getattr(config, "model_bindings", {}).get(requested_binding)
        if binding is not None:
            provider_name = str(getattr(binding, "provider", "") or "").strip() or None

    if binding is None:
        binding = config.get_binding(model)
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
        "binding_name": binding_name,
        "provider_name": provider_name,
        "api_key": api_key,
        "api_base": api_base,
        "extra_headers": extra_headers,
    }


def _first_binding_name_by_capability(config: Any, capability_type: str) -> str | None:
    """Find the first model binding with a given capability type."""
    for name, binding in getattr(config, "model_bindings", {}).items():
        if str(getattr(binding, "capability_type", "") or "").strip() == capability_type:
            return str(name)
    return None


def _infer_embedding_dim(model: str | None, provider_name: str | None = None) -> int:
    """Infer embedding dimensions from model name."""
    model_name = str(model or "").strip().lower()
    provider = str(provider_name or "").strip().lower()
    if provider == "dashscope" and "text-embedding-v4" in model_name:
        return 1024
    if "text-embedding-3-small" in model_name or "text-embedding-ada-002" in model_name:
        return 1536
    return 3072


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_rag_engine_from_config(
    config: Any,
    instance_dir: Path,
) -> RAGEngine | None:
    """Create a RAGEngine from a nanobot Config object.

    Returns None if the required libraries are not installed.
    """
    if not _check_lightrag():
        logger.warning(
            "LightRAG not installed — knowledge bases will not be available. "
            "Install with: pip install lightrag-hku"
        )
        return None

    rag_config = config.rag

    # Resolve LLM binding
    llm_binding_name = str(rag_config.llm_binding or "").strip() or None
    llm_runtime = _resolve_binding_runtime(config, binding_name=llm_binding_name, model=None)
    default_model = str(
        getattr(llm_runtime.get("binding"), "model", None)
        or config.agents.defaults.model
        or "gpt-4o-mini"
    )

    # Resolve Embedding binding
    embedding_binding_name = (
        str(rag_config.embedding_binding or "").strip()
        or _first_binding_name_by_capability(config, "embedding")
        or llm_binding_name
    )
    embedding_runtime = _resolve_binding_runtime(config, binding_name=embedding_binding_name, model=None)
    embedding_model = str(
        getattr(embedding_runtime.get("binding"), "model", None) or "text-embedding-3-large"
    )
    embedding_dim = _infer_embedding_dim(embedding_model, embedding_runtime["provider_name"])

    # Storage: always Milvus (no fallback — Milvus must be running)
    graph_store = getattr(rag_config, "graph_store", None)
    use_neo4j = bool(
        graph_store
        and getattr(graph_store, "enabled", False)
        and str(getattr(graph_store, "provider", "") or "").strip().lower() == "neo4j"
    )

    milvus_uri = str(getattr(rag_config.milvus, "uri", "") or "http://127.0.0.1:19530").strip()
    vector_db_kwargs: dict[str, Any] = {
        "index_type": str(getattr(rag_config.milvus, "index_type", "AUTOINDEX") or "AUTOINDEX"),
        "metric_type": str(getattr(rag_config.milvus, "metric_type", "COSINE") or "COSINE"),
    }
    logger.info("RAG vector storage: Milvus ({})", milvus_uri)

    lightrag_base_kwargs: dict[str, Any] = {
        "kv_storage": "JsonKVStorage",
        "vector_storage": "MilvusVectorDBStorage",
        "graph_storage": "Neo4JStorage" if use_neo4j else "NetworkXStorage",
        "doc_status_storage": "JsonDocStatusStorage",
        "default_llm_timeout": int(getattr(rag_config, "llm_timeout", 180) or 180),
        "default_embedding_timeout": int(getattr(rag_config, "embedding_timeout", 60) or 60),
        "llm_model_max_async": max(1, int(getattr(rag_config, "max_async", 16) or 16)),
        "max_parallel_insert": max(1, int(getattr(rag_config, "max_parallel_insert", 4) or 4)),
        "embedding_func_max_async": max(1, int(getattr(rag_config, "embedding_func_max_async", 4) or 4)),
        "chunk_token_size": max(200, int(getattr(rag_config, "chunk_token_size", 2400) or 2400)),
        "chunk_overlap_token_size": max(0, int(getattr(rag_config, "chunk_overlap_token_size", 100) or 100)),
        "embedding_batch_num": max(1, int(getattr(rag_config, "embedding_batch_num", 32) or 32)),
    }
    lightrag_base_kwargs["vector_db_storage_cls_kwargs"] = vector_db_kwargs

    # Storage connection env vars
    storage_env: dict[str, str] = {
        "MILVUS_URI": milvus_uri,
        "MILVUS_DB_NAME": str(getattr(rag_config.milvus, "db_name", "") or "").strip(),
        "MILVUS_USER": str(getattr(rag_config.milvus, "user", "") or "").strip(),
        "MILVUS_PASSWORD": str(getattr(rag_config.milvus, "password", "") or "").strip(),
        "MILVUS_TOKEN": str(getattr(rag_config.milvus, "token", "") or "").strip(),
    }
    if use_neo4j and graph_store is not None:
        storage_env.update({
            "NEO4J_URI": str(getattr(graph_store, "uri", "") or "").strip(),
            "NEO4J_USERNAME": str(getattr(graph_store, "username", "") or "").strip(),
            "NEO4J_PASSWORD": str(getattr(graph_store, "password", "") or "").strip(),
            "NEO4J_DATABASE": str(getattr(graph_store, "database", "") or "").strip(),
        })

    logger.info(
        "RAGEngine: model={}, embedding={} (dim={}), vector=Milvus, graph={}",
        default_model, embedding_model, embedding_dim,
        "Neo4J" if use_neo4j else "NetworkX",
    )

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
        llm_timeout=float(getattr(rag_config, "llm_timeout", 180) or 180),
        embedding_timeout=float(getattr(rag_config, "embedding_timeout", 60) or 60),
        lightrag_base_kwargs=lightrag_base_kwargs,
        storage_env=storage_env,
    )
