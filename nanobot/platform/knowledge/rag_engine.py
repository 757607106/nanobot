"""RAG Engine adapter bridging RAG-Anything/LightRAG with the nanobot platform.

Each knowledge base gets its own RAGAnything + LightRAG instance with an
independent working directory.  LLM and embedding functions are constructed
from the nanobot configuration so they reuse the same model-center settings
that the rest of the platform relies on.
"""

from __future__ import annotations

import asyncio
import functools
import json
import os
import re
import shutil
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from loguru import logger

from nanobot.platform.knowledge.utils import (
    binding_supports_capability,
    first_binding_name_by_capability,
    infer_embedding_dim,
)

# ---------------------------------------------------------------------------
# Lazy imports – heavy libraries are only loaded when actually needed
# ---------------------------------------------------------------------------
_rag_anything_available: bool | None = None


def _check_rag_anything() -> bool:
    global _rag_anything_available
    if _rag_anything_available is None:
        try:
            import lightrag  # noqa: F401
            import raganything  # noqa: F401
            _rag_anything_available = True
        except ImportError:
            _rag_anything_available = False
    return _rag_anything_available


@functools.lru_cache(maxsize=1)
def _lightrag_query_param_fields() -> frozenset[str]:
    from lightrag import QueryParam

    return frozenset(getattr(QueryParam, "__annotations__", {}))


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class IndexResult:
    """Common index result shape used across knowledge services/tests."""

    success: bool
    doc_id: str | None = None
    track_id: str | None = None
    chunks_count: int = 0
    error: str | None = None


@dataclass
class ParseResult(IndexResult):
    """Extended parse/index result for embedded LightRAG Core flow."""

    parser_name: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievalHit:
    """A single retrieval result."""
    content: str
    score: float = 0.0
    source: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class _InitFailureState:
    """Track transient initialization failures so we can fail fast briefly."""

    error: str
    retry_after_monotonic: float


# ---------------------------------------------------------------------------
# RAG Engine
# ---------------------------------------------------------------------------

class RAGEngine:
    """Adapter layer between nanobot and RAG-Anything/LightRAG.

    *   Creates one ``RAGAnything`` instance per knowledge base (lazy).
    *   Adapts nanobot's ``Config`` into the LLM / embedding / vision
        functions that RAG-Anything expects.
    *   Exposes ``insert_text``, ``query``, and
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
        llm_timeout: float = 60.0,
        embedding_timeout: float = 30.0,
        vision_provider_name: str | None = None,
        vision_api_key: str | None = None,
        vision_api_base: str | None = None,
        vision_extra_headers: dict[str, str] | None = None,
        vision_model: str | None = None,
        rerank_provider_name: str | None = None,
        rerank_api_key: str | None = None,
        rerank_api_base: str | None = None,
        rerank_extra_headers: dict[str, str] | None = None,
        rerank_model: str | None = None,
        document_parser: str = "mineru",
        parser_kwargs: dict[str, Any] | None = None,
        verify_parser_installation: bool = True,
        lightrag_base_kwargs: dict[str, Any] | None = None,
        storage_env: dict[str, str] | None = None,
        max_cached_instances: int = 5,
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
        self._llm_timeout = max(float(llm_timeout or 0), 0.001)
        self._embedding_timeout = max(float(embedding_timeout or 0), 0.001)
        self._vision_provider_name = (
            self._provider_name if vision_provider_name is None else (vision_provider_name or "")
        )
        self._vision_api_key = self._api_key if vision_api_key is None else vision_api_key
        self._vision_api_base = self._api_base if vision_api_base is None else vision_api_base
        self._vision_extra_headers = (
            dict(self._extra_headers) if vision_extra_headers is None else dict(vision_extra_headers)
        )
        self._vision_model = str(vision_model or default_model or "").strip()
        self._rerank_provider_name = (
            self._provider_name if rerank_provider_name is None else (rerank_provider_name or "")
        )
        self._rerank_api_key = self._api_key if rerank_api_key is None else rerank_api_key
        self._rerank_api_base = self._api_base if rerank_api_base is None else rerank_api_base
        self._rerank_extra_headers = (
            dict(self._extra_headers) if rerank_extra_headers is None else dict(rerank_extra_headers)
        )
        self._rerank_model = str(rerank_model or "").strip()
        self._document_parser = str(document_parser or "mineru").strip().lower() or "mineru"
        self._parser_kwargs = {
            str(key): value
            for key, value in dict(parser_kwargs or {}).items()
            if value is not None and str(value).strip() != ""
        }
        self._verify_parser_installation = bool(verify_parser_installation)

        self._lightrag_base_kwargs = dict(lightrag_base_kwargs or {})
        self._storage_env = {key: value for key, value in dict(storage_env or {}).items() if str(value or "").strip()}
        self._max_cached_instances = max(1, int(max_cached_instances or 1))

        # Per-KB instances (lazy loaded)
        self._instances: dict[str, Any] = {}  # kb_id -> RAGAnything
        self._locks: dict[str, asyncio.Lock] = {}
        self._instance_runtime_keys: dict[str, str] = {}
        self._kb_runtime_resolver: Callable[[str], dict[str, Any] | None] | None = None
        self._init_failures: dict[str, _InitFailureState] = {}
        self._init_failure_cooldown_seconds = 30.0

    @staticmethod
    async def _await_request(coro: Any, *, timeout: float, operation: str) -> Any:
        """Apply a hard timeout to external LiteLLM requests."""
        try:
            return await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise TimeoutError(f"{operation} timed out after {timeout:.0f}s") from exc

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

    @staticmethod
    def _sanitize_workspace_id(value: str) -> str:
        normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip()).strip("_")
        return normalized or "knowledge"

    def _kb_storage_workspace(self, kb_id: str) -> str:
        return f"kb_{self._sanitize_workspace_id(kb_id)}"

    @staticmethod
    def _normalize_query_mode(mode: str | None) -> str:
        return {
            "keyword": "naive",
            "semantic": "local",
            "hybrid": "hybrid",
            "local": "local",
            "global": "global",
            "naive": "naive",
            "mix": "mix",
        }.get(str(mode or "").strip().lower(), "hybrid")

    @staticmethod
    def _is_timeout_like_error(exc: Exception | str) -> bool:
        message = str(exc or "").strip().lower()
        return any(
            token in message
            for token in (
                "timed out",
                "timeout",
                "worker execution timeout",
                "worker timeout",
            )
        )

    @staticmethod
    def _is_backend_unavailable_error(exc: Exception | str) -> bool:
        message = str(exc or "").strip().lower()
        return any(
            token in message
            for token in (
                "fail connecting to server",
                "failed to connect",
                "connection refused",
                "connection reset",
                "server unavailable",
                "service unavailable",
                "name or service not known",
                "temporary failure in name resolution",
                "nodename nor servname provided",
                "failed to establish a new connection",
            )
        )

    def _get_active_init_failure(self, kb_id: str) -> _InitFailureState | None:
        failure = self._init_failures.get(kb_id)
        if failure is None:
            return None
        if time.monotonic() >= failure.retry_after_monotonic:
            self._init_failures.pop(kb_id, None)
            return None
        return failure

    def _record_init_failure(self, kb_id: str, error: str) -> None:
        self._init_failures[kb_id] = _InitFailureState(
            error=str(error or "Unknown initialization error.").strip() or "Unknown initialization error.",
            retry_after_monotonic=time.monotonic() + self._init_failure_cooldown_seconds,
        )

    def _clear_init_failure(self, kb_id: str) -> None:
        self._init_failures.pop(kb_id, None)

    async def _insert_chunks_without_graph_extraction(
        self,
        rag: Any,
        chunks: list[str],
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> dict[str, Any]:
        """Persist chunk vectors/text when graph extraction times out."""
        from lightrag.base import DocStatus
        from lightrag.utils import compute_mdhash_id, sanitize_text_for_encoding

        lightrag = getattr(rag, "lightrag", None)
        if lightrag is None:
            raise RuntimeError("LightRAG instance is not initialized.")

        normalized_chunks = [
            sanitize_text_for_encoding(str(item or "").strip())
            for item in chunks
            if str(item or "").strip()
        ]
        if not normalized_chunks:
            raise ValueError("chunks are required for chunk-only fallback.")

        doc_key = str(doc_id or compute_mdhash_id("\n\n".join(normalized_chunks), prefix="doc-")).strip()
        resolved_file_path = (
            self._resolve_file_reference(rag, file_path)
            or str(file_path or f"{doc_key}.txt").strip()
            or f"{doc_key}.txt"
        )

        delete_by_doc_id = getattr(lightrag, "adelete_by_doc_id", None)
        if callable(delete_by_doc_id):
            try:
                await delete_by_doc_id(doc_key)
            except Exception:
                logger.warning(
                    "RAGEngine: chunk-only fallback cleanup failed for doc_id={} file_path={}",
                    doc_key,
                    resolved_file_path,
                )

        full_text = "\n\n".join(normalized_chunks)
        now_iso = datetime.now(timezone.utc).isoformat()
        started_at = int(time.time())
        tokenizer = getattr(lightrag, "tokenizer", None)
        encode = getattr(tokenizer, "encode", None)

        chunk_payloads: dict[str, dict[str, Any]] = {}
        for index, chunk_text in enumerate(normalized_chunks):
            chunk_key = compute_mdhash_id(f"{doc_key}:{index}:{chunk_text}", prefix="chunk-")
            tokens = len(encode(chunk_text)) if callable(encode) else len(chunk_text)
            chunk_payloads[chunk_key] = {
                "content": chunk_text,
                "full_doc_id": doc_key,
                "tokens": tokens,
                "chunk_order_index": index,
                "file_path": resolved_file_path,
                "status": DocStatus.PROCESSED,
                "llm_cache_list": [],
            }

        await asyncio.gather(
            lightrag.chunks_vdb.upsert(chunk_payloads),
            lightrag.full_docs.upsert(
                {
                    doc_key: {
                        "content": full_text,
                        "file_path": resolved_file_path,
                        "create_time": started_at,
                        "update_time": started_at,
                    }
                }
            ),
            lightrag.text_chunks.upsert(chunk_payloads),
        )

        finished_at = int(time.time())
        await lightrag.doc_status.upsert(
            {
                doc_key: {
                    "status": DocStatus.PROCESSED,
                    "chunks_count": len(chunk_payloads),
                    "chunks_list": list(chunk_payloads.keys()),
                    "content_summary": full_text,
                    "content_length": len(full_text),
                    "created_at": now_iso,
                    "updated_at": now_iso,
                    "file_path": resolved_file_path,
                    "track_id": "",
                    "multimodal_processed": False,
                    "metadata": {
                        "processing_start_time": started_at,
                        "processing_end_time": finished_at,
                        "fallback_mode": "chunk_only",
                    },
                }
            }
        )

        insert_done = getattr(lightrag, "_insert_done", None)
        if callable(insert_done):
            await insert_done()

        return {
            "doc_id": doc_key,
            "file_path": resolved_file_path,
            "chunks_count": len(chunk_payloads),
            "fallback_mode": "chunk_only",
        }

    def _build_lightrag_kwargs(self, kb_id: str) -> dict[str, Any]:
        return {
            **self._lightrag_base_kwargs,
            "workspace": self._kb_storage_workspace(kb_id),
        }

    def set_kb_runtime_resolver(
        self,
        resolver: Callable[[str], dict[str, Any] | None] | None,
    ) -> None:
        self._kb_runtime_resolver = resolver

    def _default_runtime_config(self) -> dict[str, Any]:
        return {
            "llm_model": self._default_model,
            "llm_provider_name": self._provider_name,
            "llm_api_key": self._api_key,
            "llm_api_base": self._api_base,
            "llm_extra_headers": dict(self._extra_headers),
            "embedding_model": self._embedding_model,
            "embedding_provider_name": self._embedding_provider_name,
            "embedding_api_key": self._embedding_api_key,
            "embedding_api_base": self._embedding_api_base,
            "embedding_extra_headers": dict(self._embedding_extra_headers),
            "embedding_dim": self._embedding_dim,
            "embedding_max_tokens": self._embedding_max_tokens,
            "vision_model": self._vision_model,
            "vision_provider_name": self._vision_provider_name,
            "vision_api_key": self._vision_api_key,
            "vision_api_base": self._vision_api_base,
            "vision_extra_headers": dict(self._vision_extra_headers),
            "rerank_model": self._rerank_model,
            "rerank_provider_name": self._rerank_provider_name,
            "rerank_api_key": self._rerank_api_key,
            "rerank_api_base": self._rerank_api_base,
            "rerank_extra_headers": dict(self._rerank_extra_headers),
        }

    def _kb_runtime_config(self, kb_id: str) -> dict[str, Any]:
        runtime = self._default_runtime_config()
        if self._kb_runtime_resolver is None:
            return runtime
        try:
            overrides = dict(self._kb_runtime_resolver(kb_id) or {})
        except Exception as exc:
            logger.warning("RAGEngine: failed to resolve kb runtime for kb_id={}: {}", kb_id, exc)
            return runtime
        for key, value in overrides.items():
            if value is not None:
                runtime[key] = value
        return runtime

    @staticmethod
    def _runtime_cache_key(runtime: dict[str, Any]) -> str:
        return json.dumps(runtime, ensure_ascii=False, sort_keys=True, default=str)

    @contextmanager
    def _storage_env_scope(self):
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

    _STATUS_POLL_MAX_WAIT: float = 120.0  # seconds
    _STATUS_POLL_INITIAL_INTERVAL: float = 1.0  # seconds
    _STATUS_POLL_MAX_INTERVAL: float = 4.0  # seconds
    _STATUS_POLL_BACKOFF_FACTOR: float = 2.0

    async def _require_processed_status(
        self,
        rag: Any,
        *,
        kb_id: str,
        operation: str,
        doc_id: str | None = None,
        file_path: str | None = None,
        max_wait: float | None = None,
    ) -> dict[str, Any]:
        """Wait for a document to reach 'processed' status with polling.

        When LightRAG uses a background document queue, ``insert_content_list``
        may return before the document is fully processed (status='pending').
        This method polls ``doc_status`` with exponential back-off until the
        status becomes 'processed', 'failed', or the timeout is reached.
        """
        effective_max_wait = max_wait if max_wait is not None else self._STATUS_POLL_MAX_WAIT
        poll_interval = self._STATUS_POLL_INITIAL_INTERVAL
        elapsed = 0.0

        while True:
            status = await self._lookup_doc_status(rag, doc_id=doc_id, file_path=file_path)
            if status is None:
                # On the first check the record may not be persisted yet;
                # allow the polling loop to retry until timeout.
                if elapsed >= effective_max_wait:
                    identity = str(doc_id or file_path or "<unknown>").strip()
                    raise RuntimeError(
                        f"RAGAnything {operation} finished without a persisted doc_status record "
                        f"for kb_id={kb_id}, identity={identity}."
                    )
            else:
                normalized_status = self._normalize_status(status.get("status"))
                error_msg = str(status.get("error_msg") or "").strip()

                if normalized_status == "failed":
                    detail = error_msg or self._status_detail(status)
                    raise RuntimeError(
                        f"RAGAnything {operation} failed for kb_id={kb_id}: {detail}"
                    )

                if normalized_status == "processed":
                    if status.get("multimodal_processed") is False:
                        raise RuntimeError(
                            f"RAGAnything {operation} left multimodal processing incomplete for kb_id={kb_id}: "
                            f"{self._status_detail(status)}"
                        )
                    return status

                # Status is still pending/processing — continue polling unless timed out
                if elapsed >= effective_max_wait:
                    raise RuntimeError(
                        f"RAGAnything {operation} did not reach a fully processed state for kb_id={kb_id} "
                        f"after {elapsed:.0f}s: {self._status_detail(status)}"
                    )

            logger.debug(
                "RAGEngine: {} status not ready for kb_id={}, polling in {:.1f}s (elapsed {:.1f}s/{:.0f}s)",
                operation, kb_id, poll_interval, elapsed, effective_max_wait,
            )
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            poll_interval = min(poll_interval * self._STATUS_POLL_BACKOFF_FACTOR, self._STATUS_POLL_MAX_INTERVAL)

    async def _evict_cached_instance_if_needed(self, keep_kb_id: str) -> None:
        if len(self._instances) < self._max_cached_instances:
            return
        for candidate in list(self._instances.keys()):
            if candidate != keep_kb_id:
                await self.reset_kb(candidate)
                logger.info(
                    "RAGEngine: evicted cached RAG instance for kb_id={} (max_cached_instances={})",
                    candidate,
                    self._max_cached_instances,
                )
                return

    async def _get_or_create_instance(self, kb_id: str):
        """Get or create the RAGAnything instance for a knowledge base."""
        runtime = self._kb_runtime_config(kb_id)
        runtime_key = self._runtime_cache_key(runtime)

        if kb_id in self._instances and self._instance_runtime_keys.get(kb_id) == runtime_key:
            return self._instances[kb_id]

        # Runtime config changed — evict stale instance
        if kb_id in self._instances:
            await self.reset_kb(kb_id)

        if not _check_rag_anything():
            raise RuntimeError(
                "raganything or lightrag is not installed. "
                "Install with: pip install raganything lightrag-hku"
            )

        from raganything import RAGAnything, RAGAnythingConfig

        working_dir = self._kb_working_dir(kb_id)
        working_dir.mkdir(parents=True, exist_ok=True)
        await self._evict_cached_instance_if_needed(kb_id)

        config = RAGAnythingConfig(
            working_dir=str(working_dir),
            parser=self._document_parser,
            parse_method="auto",
            enable_image_processing=True,
            enable_table_processing=True,
            enable_equation_processing=True,
        )

        rag = RAGAnything(
            config=config,
            llm_model_func=self._build_llm_func(runtime),
            vision_model_func=self._build_vision_func(runtime),
            embedding_func=self._build_embedding_func(runtime),
            lightrag_kwargs={
                **self._build_lightrag_kwargs(kb_id),
                "llm_model_name": str(runtime.get("llm_model") or self._default_model or "").strip(),
                "rerank_model_func": self._build_rerank_func(runtime),
            },
        )
        if not self._verify_parser_installation and hasattr(rag, "_parser_installation_checked"):
            rag._parser_installation_checked = True

        self._instances[kb_id] = rag
        self._instance_runtime_keys[kb_id] = runtime_key
        logger.info("RAGEngine: created RAGAnything instance for kb_id={}", kb_id)
        return rag

    @staticmethod
    def _lightrag_readiness(rag: Any) -> tuple[bool, str]:
        """Check whether a cached RAGAnything instance is safe to use."""
        lightrag = getattr(rag, "lightrag", None)
        if lightrag is None:
            return False, "LightRAG instance missing"

        status = str(getattr(getattr(lightrag, "_storages_status", None), "name", "") or "").upper()
        if status != "INITIALIZED":
            return False, f"LightRAG storages status is {status or 'UNKNOWN'}"

        graph_storage = getattr(lightrag, "chunk_entity_relation_graph", None)
        if graph_storage is not None:
            if getattr(graph_storage, "_storage_lock", None) is None:
                return False, "graph storage lock missing"
            if getattr(graph_storage, "storage_updated", None) is None:
                return False, "graph storage update flag missing"

        if getattr(rag, "parse_cache", None) is None:
            return False, "parse cache missing"

        return True, ""

    async def _ensure_ready(self, kb_id: str):
        """Return an initialized RAGAnything instance with LightRAG storages ready."""
        async with self._get_lock(kb_id):
            active_failure = self._get_active_init_failure(kb_id)
            if active_failure is not None:
                retry_in = max(active_failure.retry_after_monotonic - time.monotonic(), 0.0)
                raise RuntimeError(
                    f"RAGAnything initialization temporarily paused for kb_id={kb_id} "
                    f"(retry in {retry_in:.0f}s): {active_failure.error}"
                )

            last_error = "Unknown initialization error."
            for attempt in range(2):
                rag = await self._get_or_create_instance(kb_id)
                ready, detail = self._lightrag_readiness(rag)
                if ready:
                    self._clear_init_failure(kb_id)
                    return rag

                with self._storage_env_scope():
                    init = await rag._ensure_lightrag_initialized()

                ready, detail = self._lightrag_readiness(rag)
                if isinstance(init, dict) and init.get("success") and ready:
                    self._clear_init_failure(kb_id)
                    return rag

                init_error = init.get("error") if isinstance(init, dict) else None
                last_error = str(init_error or detail or "Unknown initialization error.")
                logger.warning(
                    "RAGEngine: LightRAG was not ready for kb_id={} after init attempt {}: {}",
                    kb_id,
                    attempt + 1,
                    last_error,
                )
                await self.reset_kb(kb_id)
                if self._is_backend_unavailable_error(last_error):
                    logger.warning(
                        "RAGEngine: backend unavailable for kb_id={}, skipping immediate retry: {}",
                        kb_id,
                        last_error,
                    )
                    break

            self._record_init_failure(kb_id, last_error)
            raise RuntimeError(f"RAGAnything initialization failed for kb_id={kb_id}: {last_error}")

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

    def _resolve_llm_completion_kwargs(
        self,
        runtime: dict[str, Any] | None = None,
    ) -> tuple[str, str, str | None, str | None, dict | None]:
        """Resolve LLM runtime parameters and return (model, provider_name, api_key, api_base, extra_headers)."""
        resolved_runtime = dict(runtime or {})
        api_key = str(resolved_runtime.get("llm_api_key") or self._api_key or "")
        api_base = str(resolved_runtime.get("llm_api_base") or self._api_base or "").strip() or None
        model = str(resolved_runtime.get("llm_model") or self._default_model or "").strip()
        provider_name = str(resolved_runtime.get("llm_provider_name") or self._provider_name or "").strip()
        extra_headers = dict(resolved_runtime.get("llm_extra_headers") or self._extra_headers or {}) or None
        return model, provider_name, api_key, api_base, extra_headers

    def _resolve_vision_completion_kwargs(
        self,
        runtime: dict[str, Any] | None = None,
    ) -> tuple[str, str, str | None, str | None, dict | None]:
        """Resolve VLM runtime parameters and fall back to the LLM runtime when needed."""
        resolved_runtime = dict(runtime or {})
        model = str(
            resolved_runtime.get("vision_model")
            or self._vision_model
            or resolved_runtime.get("llm_model")
            or self._default_model
            or ""
        ).strip()
        provider_name = str(
            resolved_runtime.get("vision_provider_name")
            or self._vision_provider_name
            or resolved_runtime.get("llm_provider_name")
            or self._provider_name
            or ""
        ).strip()
        api_key = str(
            resolved_runtime.get("vision_api_key")
            or self._vision_api_key
            or resolved_runtime.get("llm_api_key")
            or self._api_key
            or ""
        )
        api_base = str(
            resolved_runtime.get("vision_api_base")
            or self._vision_api_base
            or resolved_runtime.get("llm_api_base")
            or self._api_base
            or ""
        ).strip() or None
        extra_headers = dict(
            resolved_runtime.get("vision_extra_headers")
            or self._vision_extra_headers
            or resolved_runtime.get("llm_extra_headers")
            or self._extra_headers
            or {}
        ) or None
        return model, provider_name, api_key, api_base, extra_headers

    def _build_completion_kw(
        self,
        *,
        model: str,
        provider_name: str,
        api_key: str,
        api_base: str | None,
        extra_headers: dict | None,
    ) -> dict[str, Any]:
        """Build the common kwargs dict for litellm acompletion calls."""
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
        kw["timeout"] = self._llm_timeout
        return kw

    def _build_llm_func(self, runtime: dict[str, Any] | None = None):
        """Build the async LLM function for RAG-Anything / LightRAG."""
        from litellm import acompletion

        model, provider_name, api_key, api_base, extra_headers = self._resolve_llm_completion_kwargs(runtime)

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

            kw = self._build_completion_kw(
                model=model, provider_name=provider_name,
                api_key=api_key, api_base=api_base, extra_headers=extra_headers,
            )
            kw["messages"] = messages

            # Forward supported kwargs
            for passthrough in ("temperature", "max_tokens"):
                if passthrough in kwargs:
                    kw[passthrough] = kwargs[passthrough]

            response = await self._await_request(
                acompletion(**kw),
                timeout=self._llm_timeout,
                operation="LightRAG LLM request",
            )
            return response.choices[0].message.content or ""

        return llm_model_func

    def _build_embedding_func(self, runtime: dict[str, Any] | None = None):
        """Build the embedding function for LightRAG."""
        import numpy as np
        from lightrag.utils import EmbeddingFunc
        from litellm import aembedding

        resolved_runtime = dict(runtime or {})
        api_key = str(resolved_runtime.get("embedding_api_key") or self._embedding_api_key or "")
        api_base = str(resolved_runtime.get("embedding_api_base") or self._embedding_api_base or "").strip() or None
        model = str(resolved_runtime.get("embedding_model") or self._embedding_model or "").strip()
        provider_name = str(
            resolved_runtime.get("embedding_provider_name")
            or self._embedding_provider_name
            or self._provider_name
            or ""
        ).strip()
        extra_headers = dict(
            resolved_runtime.get("embedding_extra_headers")
            or self._embedding_extra_headers
            or {}
        ) or None

        # Maximum texts per single embedding API call.
        # DashScope/Volcengine enforce a hard limit of 10; most other providers
        # accept much more but 10 is the safe common denominator.
        _EMBED_BATCH_LIMIT = 10

        async def _embed(texts: list[str]) -> list[list[float]]:
            resolved_model, custom_llm_provider, resolved_api_base = self._resolve_litellm_runtime(
                model=model,
                provider_name=provider_name,
                api_key=api_key,
                api_base=api_base,
                request_type="embedding",
            )

            async def _call_embedding(batch: list[str]) -> list[list[float]]:
                kw: dict[str, Any] = {"model": resolved_model, "input": batch}
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

                response = await self._await_request(
                    aembedding(**kw),
                    timeout=self._embedding_timeout,
                    operation="LightRAG embedding request",
                )
                return [item["embedding"] for item in response.data]

            # Split into sub-batches to respect provider limits
            if len(texts) <= _EMBED_BATCH_LIMIT:
                all_embeddings = await _call_embedding(texts)
            else:
                batches = [
                    texts[i : i + _EMBED_BATCH_LIMIT]
                    for i in range(0, len(texts), _EMBED_BATCH_LIMIT)
                ]
                results = await asyncio.gather(*[_call_embedding(b) for b in batches])
                all_embeddings = [emb for batch_result in results for emb in batch_result]

            return np.asarray(all_embeddings, dtype=float)

        return EmbeddingFunc(
            embedding_dim=int(resolved_runtime.get("embedding_dim") or self._embedding_dim),
            max_token_size=int(resolved_runtime.get("embedding_max_tokens") or self._embedding_max_tokens),
            func=_embed,
        )

    def _build_vision_func(self, runtime: dict[str, Any] | None = None):
        """Build the vision model function for multimodal processing."""
        from litellm import acompletion

        model, provider_name, api_key, api_base, extra_headers = self._resolve_vision_completion_kwargs(runtime)

        async def vision_model_func(
            prompt: str,
            system_prompt: str | None = None,
            history_messages: list | None = None,
            image_data: str | None = None,
            messages: list | None = None,
            **kwargs: Any,
        ) -> str:
            kw = self._build_completion_kw(
                model=model, provider_name=provider_name,
                api_key=api_key, api_base=api_base, extra_headers=extra_headers,
            )

            # VLM enhanced query: pre-built messages
            if messages:
                kw["messages"] = messages
                response = await self._await_request(
                    acompletion(**kw),
                    timeout=self._llm_timeout,
                    operation="LightRAG VLM request",
                )
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
                response = await self._await_request(
                    acompletion(**kw),
                    timeout=self._llm_timeout,
                    operation="LightRAG VLM request",
                )
                return response.choices[0].message.content or ""

            # Pure text fallback
            text_msgs: list[dict[str, Any]] = []
            if system_prompt:
                text_msgs.append({"role": "system", "content": system_prompt})
            if history_messages:
                text_msgs.extend(history_messages)
            text_msgs.append({"role": "user", "content": prompt})
            kw["messages"] = text_msgs
            response = await self._await_request(
                acompletion(**kw),
                timeout=self._llm_timeout,
                operation="LightRAG VLM request",
            )
            return response.choices[0].message.content or ""

        return vision_model_func

    def _build_rerank_func(self, runtime: dict[str, Any] | None = None):
        """Build the rerank function for LightRAG."""
        from litellm import arerank

        resolved_runtime = dict(runtime or {})
        model = str(resolved_runtime.get("rerank_model") or self._rerank_model or "").strip()
        if not model:
            return None

        provider_name = str(
            resolved_runtime.get("rerank_provider_name")
            or self._rerank_provider_name
            or self._provider_name
            or ""
        ).strip()
        api_key = str(resolved_runtime.get("rerank_api_key") or self._rerank_api_key or "")
        api_base = str(resolved_runtime.get("rerank_api_base") or self._rerank_api_base or "").strip() or None
        extra_headers = dict(
            resolved_runtime.get("rerank_extra_headers")
            or self._rerank_extra_headers
            or {}
        ) or None

        async def rerank_model_func(
            query: str,
            documents: list[str],
            top_n: int | None = None,
            **kwargs: Any,
        ) -> list[dict[str, Any]]:
            if not documents:
                return []

            resolved_model, custom_llm_provider, resolved_api_base = self._resolve_litellm_runtime(
                model=model,
                provider_name=provider_name,
                api_key=api_key,
                api_base=api_base,
            )
            kw: dict[str, Any] = {
                "model": resolved_model,
                "query": str(query or ""),
                "documents": list(documents),
                "timeout": self._llm_timeout,
            }
            if top_n is not None:
                kw["top_n"] = max(1, int(top_n))
            if api_key:
                kw["api_key"] = api_key
            if resolved_api_base:
                kw["api_base"] = resolved_api_base
            if custom_llm_provider:
                kw["custom_llm_provider"] = custom_llm_provider
            if extra_headers:
                kw["extra_headers"] = extra_headers
            for passthrough in (
                "rank_fields",
                "return_documents",
                "max_chunks_per_doc",
                "max_tokens_per_doc",
            ):
                value = kwargs.get(passthrough)
                if value is not None:
                    kw[passthrough] = value

            response = await self._await_request(
                arerank(**kw),
                timeout=self._llm_timeout,
                operation="LightRAG rerank request",
            )

            results = getattr(response, "results", None)
            if results is None and isinstance(response, dict):
                results = response.get("results")

            normalized: list[dict[str, Any]] = []
            for item in list(results or []):
                if isinstance(item, dict):
                    index = item.get("index")
                    relevance_score = item.get("relevance_score")
                else:
                    index = getattr(item, "index", None)
                    relevance_score = getattr(item, "relevance_score", None)
                if index is None:
                    continue
                try:
                    normalized.append(
                        {
                            "index": int(index),
                            "relevance_score": float(relevance_score or 0.0),
                        }
                    )
                except (TypeError, ValueError):
                    continue
            return normalized

        return rerank_model_func

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

    async def reset_kb(self, kb_id: str) -> None:
        """Finalize and evict a cached per-KB RAG instance."""
        rag = self._instances.pop(kb_id, None)
        self._instance_runtime_keys.pop(kb_id, None)
        self._clear_init_failure(kb_id)
        if rag is None:
            return
        try:
            await rag.finalize_storages()
        except Exception as exc:
            logger.warning("RAGEngine: finalize failed during reset for kb_id={}: {}", kb_id, exc)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

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
        rag = await self._ensure_ready(kb_id)
        content = str(text or "").strip()
        if not content:
            raise ValueError("text is required.")
        try:
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
            if self._is_timeout_like_error(exc):
                try:
                    metadata = await self._insert_chunks_without_graph_extraction(
                        rag,
                        [content],
                        doc_id=doc_id,
                        file_path=file_path or f"{kb_id}.txt",
                    )
                    logger.warning(
                        "RAGEngine: insert_text used chunk-only fallback for kb_id={} doc_id={} file_path={}",
                        kb_id,
                        doc_id,
                        file_path,
                    )
                    return ParseResult(
                        success=True,
                        parser_name="text_insert_fallback",
                        metadata=metadata,
                    )
                except Exception as fallback_exc:
                    logger.error(
                        "RAGEngine: insert_text fallback failed for kb_id={}: {}",
                        kb_id,
                        fallback_exc,
                    )
                    exc = fallback_exc
            logger.error("RAGEngine: insert_text failed for kb_id={}: {}", kb_id, exc)
            return ParseResult(
                success=False,
                parser_name="text_insert",
                error=str(exc),
            )

    async def insert_text_segments(
        self,
        kb_id: str,
        segments: list[tuple[str, str]],
        *,
        file_path: str | None = None,
        max_concurrency: int = 0,
        on_segment_done: Any = None,
    ) -> ParseResult:
        """Insert multiple text segments with fault-isolated concurrency.

        Each ``(text, segment_doc_id)`` tuple is indexed independently so that
        a failure in one segment does not discard the graph data from others.

        Args:
            kb_id: Knowledge base identifier.
            segments: List of ``(text, segment_doc_id)`` tuples.
            file_path: Logical file path shared by all segments.
            max_concurrency: Concurrent segment limit (0 = use
                ``max_parallel_insert`` from LightRAG config).
            on_segment_done: Optional ``callable(index, total, segment_doc_id, success, error)``
                invoked after each segment completes.

        Returns:
            Aggregated ParseResult.  ``success`` is True when **at least one**
            segment succeeded (partial success is not a hard failure).
        """
        if not segments:
            raise ValueError("segments are required.")

        rag = await self._ensure_ready(kb_id)
        lightrag_kwargs = self._build_lightrag_kwargs(kb_id)
        concurrency = max_concurrency or int(lightrag_kwargs.get("max_parallel_insert", 2))
        concurrency = max(1, concurrency)
        sem = asyncio.Semaphore(concurrency)

        total = len(segments)
        results: list[tuple[str, bool, int, str | None]] = []  # (doc_id, ok, chunks, error)

        async def _process(index: int, text: str, seg_doc_id: str) -> None:
            async with sem:
                result = await self.insert_text(
                    kb_id, text, doc_id=seg_doc_id, file_path=file_path,
                )
                chunks_count = int(result.chunks_count or 0)
                results.append((seg_doc_id, result.success, chunks_count, result.error))
                if callable(on_segment_done):
                    try:
                        on_segment_done(index, total, seg_doc_id, result.success, result.error)
                    except Exception:
                        pass

        tasks = [
            asyncio.create_task(_process(i, text, doc_id))
            for i, (text, doc_id) in enumerate(segments)
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

        succeeded = [(d, c) for d, ok, c, _ in results if ok]
        failed = [(d, e) for d, ok, _, e in results if not ok]
        total_chunks = sum(c for _, c in succeeded)

        if failed:
            logger.warning(
                "RAGEngine: insert_text_segments partial failure for kb_id={}: {}/{} segments failed: {}",
                kb_id,
                len(failed),
                total,
                "; ".join(f"{d}: {e}" for d, e in failed),
            )

        return ParseResult(
            success=len(succeeded) > 0,
            parser_name="text_segments",
            chunks_count=total_chunks,
            metadata={
                "file_path": file_path,
                "total_segments": total,
                "succeeded_segments": len(succeeded),
                "failed_segments": len(failed),
                "chunks_count": total_chunks,
                "failed_details": [
                    {"doc_id": d, "error": e} for d, e in failed
                ] if failed else [],
            },
            error=(
                f"{len(failed)}/{total} segments failed"
                if failed and not succeeded
                else None
            ),
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
        rag = await self._ensure_ready(kb_id)
        normalized_chunks = [str(item or "").strip() for item in chunks if str(item or "").strip()]
        if not normalized_chunks:
            raise ValueError("chunks are required.")
        try:
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
            if self._is_timeout_like_error(exc):
                try:
                    metadata = await self._insert_chunks_without_graph_extraction(
                        rag,
                        normalized_chunks,
                        doc_id=doc_id,
                        file_path=file_path or f"{kb_id}.txt",
                    )
                    logger.warning(
                        "RAGEngine: insert_chunks used chunk-only fallback for kb_id={} doc_id={} file_path={}",
                        kb_id,
                        doc_id,
                        file_path,
                    )
                    return ParseResult(
                        success=True,
                        parser_name="chunk_insert_fallback",
                        metadata=metadata,
                    )
                except Exception as fallback_exc:
                    logger.error(
                        "RAGEngine: insert_chunks fallback failed for kb_id={}: {}",
                        kb_id,
                        fallback_exc,
                    )
                    exc = fallback_exc
            cleanup_doc_id = str(doc_id or "").strip()
            if cleanup_doc_id:
                try:
                    await self.delete_document(kb_id, cleanup_doc_id)
                except Exception:
                    logger.warning(
                        "RAGEngine: failed to clean partial chunk data for kb_id={} doc_id={}",
                        kb_id,
                        cleanup_doc_id,
                    )
            logger.error("RAGEngine: insert_chunks failed for kb_id={}: {}", kb_id, exc)
            return ParseResult(
                success=False,
                parser_name="chunk_insert",
                error=str(exc),
            )

    async def insert_document_file(
        self,
        kb_id: str,
        file_path: str,
        *,
        doc_id: str | None = None,
        file_name: str | None = None,
    ) -> ParseResult:
        """Process a raw document file through RAGAnything's full ingest flow."""
        resolved_file_path = str(file_path or "").strip()
        if not resolved_file_path:
            raise ValueError("file_path is required.")
        source_path = Path(resolved_file_path)
        if not source_path.exists():
            raise FileNotFoundError(f"Knowledge source file is missing: {resolved_file_path}")

        normalized_doc_id = str(doc_id or "").strip() or None
        normalized_file_name = str(file_name or "").strip() or None

        rag = await self._ensure_ready(kb_id)
        if normalized_doc_id:
            await self.prepare_document_ingest(kb_id, normalized_doc_id)

        try:
            await rag.process_document_complete(
                file_path=resolved_file_path,
                parse_method="auto",
                doc_id=normalized_doc_id,
                file_name=normalized_file_name,
                **self._parser_kwargs,
            )
            status = await self._require_processed_status(
                rag,
                kb_id=kb_id,
                operation="insert_document_file",
                doc_id=normalized_doc_id,
                file_path=resolved_file_path,
            )
            return ParseResult(
                success=True,
                doc_id=normalized_doc_id,
                chunks_count=int(status.get("chunks_count") or 0),
                parser_name="raganything_file",
                metadata={
                    "doc_id": normalized_doc_id,
                    "file_path": normalized_file_name or resolved_file_path,
                    "chunks_count": int(status.get("chunks_count") or 0),
                    "multimodal_processed": bool(status.get("multimodal_processed") is not False),
                },
            )
        except Exception as exc:
            if normalized_doc_id:
                try:
                    await self.delete_document(kb_id, normalized_doc_id)
                except Exception:
                    logger.warning(
                        "RAGEngine: failed to clean partial raw document data for kb_id={} doc_id={}",
                        kb_id,
                        normalized_doc_id,
                    )
            logger.error(
                "RAGEngine: insert_document_file failed for kb_id={} doc_id={} file_path={}: {}",
                kb_id,
                normalized_doc_id,
                resolved_file_path,
                exc,
            )
            return ParseResult(
                success=False,
                doc_id=normalized_doc_id,
                parser_name="raganything_file",
                error=str(exc),
            )

    async def query(
        self,
        kb_ids: list[str],
        query_text: str,
        *,
        mode: str = "hybrid",
        top_k: int = 8,
    ) -> list[RetrievalHit]:
        """Query across one or more knowledge bases.

        Args:
            kb_ids: List of knowledge base identifiers to query.
            query_text: The query string.
            mode: LightRAG retrieval mode (local, global, hybrid, naive).
            top_k: Maximum number of results.
        Returns:
            List of RetrievalHit results.
        """
        if not kb_ids:
            return []

        from lightrag import QueryParam

        mode = self._normalize_query_mode(mode)

        all_hits: list[RetrievalHit] = []
        failures: list[tuple[str, str]] = []

        for kb_id in kb_ids:
            try:
                rag = await self._ensure_ready(kb_id)
                query_param = QueryParam(
                    mode=mode,
                    top_k=max(1, int(top_k)),
                    include_references=True,
                )
                try:
                    result = await rag.lightrag.aquery_data(query_text, query_param)
                except Exception as exc:
                    if mode != "naive" and self._is_timeout_like_error(exc):
                        logger.warning(
                            "RAGEngine: query timeout for kb_id={} mode={}, retrying with naive mode",
                            kb_id,
                            mode,
                        )
                        result = await rag.lightrag.aquery_data(
                            query_text,
                            QueryParam(
                                mode="naive",
                                top_k=max(1, int(top_k)),
                                include_references=True,
                            ),
                        )
                    else:
                        raise
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
        max_entity_tokens: int = 6000,
        max_relation_tokens: int = 8000,
        max_total_tokens: int = 30000,
        history_turns: int = 0,
        enable_rerank: bool = False,
        rerank_model: str | None = None,
        extra_query_params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return structured LightRAG query data for a single knowledge base."""
        from lightrag import QueryParam

        def _has_structured_evidence(result: Any) -> bool:
            if not isinstance(result, dict):
                return False
            data = result.get("data") or {}
            if not isinstance(data, dict):
                return False
            return any(
                data.get(key)
                for key in ("chunks", "entities", "relationships", "references")
            )

        rag = await self._ensure_ready(kb_id)
        filtered_kwargs = self._build_query_param_kwargs(
            mode=mode,
            top_k=top_k,
            chunk_top_k=chunk_top_k,
            response_type=response_type,
            only_need_context=only_need_context,
            only_need_prompt=only_need_prompt,
            max_entity_tokens=max_entity_tokens,
            max_relation_tokens=max_relation_tokens,
            max_total_tokens=max_total_tokens,
            history_turns=history_turns,
            enable_rerank=enable_rerank,
            include_references=True,
            extra_query_params=extra_query_params,
        )
        try:
            result = await rag.lightrag.aquery_data(query_text, QueryParam(**filtered_kwargs))
            if filtered_kwargs.get("mode") != "naive" and not _has_structured_evidence(result):
                fallback_kwargs = dict(filtered_kwargs)
                fallback_kwargs["mode"] = "naive"
                logger.warning(
                    "RAGEngine: structured query returned no evidence for kb_id={} mode={}, retrying with naive mode",
                    kb_id,
                    filtered_kwargs.get("mode"),
                )
                return await rag.lightrag.aquery_data(query_text, QueryParam(**fallback_kwargs))
            return result
        except Exception as exc:
            if filtered_kwargs.get("mode") != "naive" and self._is_timeout_like_error(exc):
                fallback_kwargs = dict(filtered_kwargs)
                fallback_kwargs["mode"] = "naive"
                logger.warning(
                    "RAGEngine: structured query timeout for kb_id={} mode={}, retrying with naive mode",
                    kb_id,
                    filtered_kwargs.get("mode"),
                )
                return await rag.lightrag.aquery_data(query_text, QueryParam(**fallback_kwargs))
            raise

    def _build_query_param_kwargs(
        self,
        *,
        mode: str,
        top_k: int,
        chunk_top_k: int,
        response_type: str,
        only_need_context: bool,
        only_need_prompt: bool,
        max_entity_tokens: int,
        max_relation_tokens: int,
        max_total_tokens: int,
        history_turns: int,
        enable_rerank: bool,
        include_references: bool | None = None,
        extra_query_params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        query_kwargs: dict[str, Any] = {
            "mode": self._normalize_query_mode(mode),
            "top_k": max(1, int(top_k)),
            "chunk_top_k": max(1, int(chunk_top_k)),
            "response_type": response_type,
            "only_need_context": bool(only_need_context),
            "only_need_prompt": bool(only_need_prompt),
            "max_entity_tokens": max(1, int(max_entity_tokens)),
            "max_relation_tokens": max(1, int(max_relation_tokens)),
            "max_total_tokens": max(1, int(max_total_tokens)),
            "history_turns": max(0, int(history_turns)),
            "enable_rerank": bool(enable_rerank),
        }
        if include_references is not None:
            query_kwargs["include_references"] = bool(include_references)
        if extra_query_params:
            query_kwargs.update(extra_query_params)
        param_fields = _lightrag_query_param_fields()
        return {key: value for key, value in query_kwargs.items() if key in param_fields}

    async def query_multimodal(
        self,
        kb_id: str,
        query_text: str,
        *,
        multimodal_content: list[dict[str, Any]],
        mode: str = "hybrid",
        top_k: int = 8,
        chunk_top_k: int = 12,
        response_type: str = "Multiple Paragraphs",
        only_need_context: bool = False,
        only_need_prompt: bool = False,
        max_entity_tokens: int = 6000,
        max_relation_tokens: int = 8000,
        max_total_tokens: int = 30000,
        history_turns: int = 0,
        enable_rerank: bool = False,
        rerank_model: str | None = None,
        extra_query_params: dict[str, Any] | None = None,
    ) -> str:
        """Run LightRAG's multimodal query path for a single knowledge base."""
        del rerank_model
        rag = await self._ensure_ready(kb_id)
        filtered_kwargs = self._build_query_param_kwargs(
            mode=mode,
            top_k=top_k,
            chunk_top_k=chunk_top_k,
            response_type=response_type,
            only_need_context=only_need_context,
            only_need_prompt=only_need_prompt,
            max_entity_tokens=max_entity_tokens,
            max_relation_tokens=max_relation_tokens,
            max_total_tokens=max_total_tokens,
            history_turns=history_turns,
            enable_rerank=enable_rerank,
            include_references=False,
            extra_query_params=extra_query_params,
        )
        result = await rag.aquery_with_multimodal(
            query_text,
            multimodal_content=multimodal_content,
            **filtered_kwargs,
        )
        return str(result or "")

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
    def _normalize_graph(
        graph: Any,
        *,
        labels: list[str],
        workspace: str | None = None,
    ) -> dict[str, Any]:
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

        # ── Workspace-based filtering for shared graph backends (Neo4J) ──
        # When multiple KBs share the same graph database, nodes may carry a
        # workspace label (e.g. "kb_knowledge_base_1").  Filter to keep only
        # nodes belonging to the current KB and prune orphaned edges.
        if workspace and nodes:
            ws_lower = workspace.strip().lower()
            filtered_nodes = [
                node for node in nodes
                if any(
                    lbl.strip().lower() == ws_lower
                    for lbl in node.get("labels", [])
                )
            ]
            # If filtering produced results, apply it; otherwise assume the
            # backend already provides isolated data (e.g. NetworkXStorage).
            if filtered_nodes:
                valid_ids = {node["id"] for node in filtered_nodes}
                filtered_edges = [
                    edge for edge in edges
                    if edge["source"] in valid_ids and edge["target"] in valid_ids
                ]
                nodes = filtered_nodes
                edges = filtered_edges

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
        workspace = self._kb_storage_workspace(kb_id)
        graph = await rag.lightrag.get_knowledge_graph(
            node_label=label,
            max_depth=max(1, int(max_depth)),
            max_nodes=max(10, int(max_nodes)),
        )
        return self._normalize_graph(graph, labels=labels, workspace=workspace)

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
            getattr(storage, "final_namespace", None)
            or getattr(storage, "namespace", None)
            or ""
        ).strip()
        has_collection = getattr(client, "has_collection", None)
        drop_collection = getattr(client, "drop_collection", None)
        if namespace and callable(has_collection) and callable(drop_collection):
            if has_collection(namespace):
                drop_collection(namespace)
            return

        await RAGEngine._drop_storage_data(storage)

    async def _drop_kb_storage_data(self, rag: Any) -> None:
        lightrag = getattr(rag, "lightrag", None)
        if lightrag is None:
            return

        failures: list[str] = []

        async def _run(label: str, storage: Any, *, vector: bool = False) -> None:
            if storage is None:
                return
            try:
                if vector:
                    await self._drop_vector_storage_data(storage)
                else:
                    await self._drop_storage_data(storage)
            except Exception as exc:
                logger.warning("RAGEngine: failed to drop {} for kb cleanup: {}", label, exc)
                failures.append(label)

        for label, storage in (
            ("full_docs", getattr(lightrag, "full_docs", None)),
            ("text_chunks", getattr(lightrag, "text_chunks", None)),
            ("full_entities", getattr(lightrag, "full_entities", None)),
            ("full_relations", getattr(lightrag, "full_relations", None)),
            ("entity_chunks", getattr(lightrag, "entity_chunks", None)),
            ("relation_chunks", getattr(lightrag, "relation_chunks", None)),
            ("chunk_entity_relation_graph", getattr(lightrag, "chunk_entity_relation_graph", None)),
            ("llm_response_cache", getattr(lightrag, "llm_response_cache", None)),
            ("doc_status", getattr(lightrag, "doc_status", None)),
        ):
            await _run(label, storage)

        for label, storage in (
            ("entities_vdb", getattr(lightrag, "entities_vdb", None)),
            ("relationships_vdb", getattr(lightrag, "relationships_vdb", None)),
            ("chunks_vdb", getattr(lightrag, "chunks_vdb", None)),
        ):
            await _run(label, storage, vector=True)

        if failures:
            raise RuntimeError(f"failed to drop storages: {', '.join(failures)}")

    async def delete_kb(self, kb_id: str) -> bool:
        """Delete all LightRAG data for a knowledge base.

        Args:
            kb_id: Knowledge base identifier.

        Returns:
            True if deleted successfully.
        """
        try:
            rag = self._instances.get(kb_id)
            if rag is None:
                try:
                    rag = await self._ensure_ready(kb_id)
                except Exception as exc:
                    logger.warning(
                        "RAGEngine: failed to initialize kb_id={} during delete, continuing with workspace cleanup only: {}",
                        kb_id,
                        exc,
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

            # Remove from instances cache
            self._instances.pop(kb_id, None)
            self._instance_runtime_keys.pop(kb_id, None)
            self._clear_init_failure(kb_id)
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

    async def prepare_document_ingest(self, kb_id: str, doc_id: str) -> dict[str, list[str]]:
        """Clean the target doc and any retryable leftovers before a scoped ingest.

        LightRAG re-queues all FAILED/PENDING/PROCESSING docs when enqueueing a new
        document. We keep Nanobot's file selection deterministic by removing stale
        retryable docs from LightRAG first; the SQLite knowledge-file metadata
        remains the source of truth and can explicitly re-index those docs later.
        """
        rag = await self._ensure_ready(kb_id)
        lightrag = getattr(rag, "lightrag", None)
        if lightrag is None:
            return {"deletedDocIds": [], "prunedDocIds": []}

        retryable_doc_ids: set[str] = set()
        doc_status_store = getattr(lightrag, "doc_status", None)
        get_docs_by_status = getattr(doc_status_store, "get_docs_by_status", None)
        if callable(get_docs_by_status):
            try:
                from lightrag.base import DocStatus

                processing_docs, failed_docs, pending_docs = await asyncio.gather(
                    get_docs_by_status(DocStatus.PROCESSING),
                    get_docs_by_status(DocStatus.FAILED),
                    get_docs_by_status(DocStatus.PENDING),
                )
                for payload in (processing_docs, failed_docs, pending_docs):
                    retryable_doc_ids.update(str(item).strip() for item in payload.keys() if str(item).strip())
            except Exception as exc:
                logger.warning(
                    "RAGEngine: failed to inspect retryable doc queue for kb_id={}: {}",
                    kb_id,
                    exc,
                )

        normalized_doc_id = str(doc_id or "").strip()
        cleanup_doc_ids: list[str] = []
        if normalized_doc_id:
            cleanup_doc_ids.append(normalized_doc_id)
        pruned_doc_ids = sorted(
            item
            for item in retryable_doc_ids
            if item and item != normalized_doc_id
        )
        cleanup_doc_ids.extend(pruned_doc_ids)

        deleted_doc_ids: list[str] = []
        for candidate in cleanup_doc_ids:
            if await self.delete_document(kb_id, candidate):
                deleted_doc_ids.append(candidate)

        if pruned_doc_ids:
            logger.warning(
                "RAGEngine: pruned retryable LightRAG docs before ingest for kb_id={} keep_doc_id={} pruned={}",
                kb_id,
                normalized_doc_id,
                pruned_doc_ids,
            )

        return {
            "deletedDocIds": deleted_doc_ids,
            "prunedDocIds": pruned_doc_ids,
        }

    async def shutdown_async(self) -> None:
        """Finalize all initialized RAG-Anything storages."""
        for kb_id, rag in list(self._instances.items()):
            try:
                await rag.finalize_storages()
            except Exception as exc:
                logger.warning("RAGEngine: finalize failed for kb_id={}: {}", kb_id, exc)
        self._instances.clear()
        self._instance_runtime_keys.clear()


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
    capability_type: str | None = None,
) -> dict[str, Any]:
    from nanobot.providers.registry import find_by_name

    requested_binding = str(binding_name or "").strip()
    provider_name: str | None = None
    matched_binding_name: str | None = None
    binding = None

    if requested_binding:
        candidate = getattr(config, "model_bindings", {}).get(requested_binding)
        if candidate is not None and binding_supports_capability(
            getattr(candidate, "capability_type", None),
            capability_type,
        ):
            binding = candidate
            matched_binding_name = requested_binding
            provider_name = str(getattr(binding, "provider", "") or "").strip() or None

    if binding is None:
        candidate = config.get_binding(model)
        if candidate is not None and binding_supports_capability(
            getattr(candidate, "capability_type", None),
            capability_type,
        ):
            binding = candidate
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
        model=None if llm_binding_name else getattr(config.agents.defaults, "model", None),
        capability_type="text_chat",
    )
    default_model = str(
        getattr(llm_runtime.get("binding"), "model", None)
        or config.agents.defaults.model
        or "gpt-4o-mini"
    )

    embedding_binding_name = (
        str(rag_config.embedding_binding or "").strip()
        or first_binding_name_by_capability(getattr(config, "model_bindings", {}), "embedding")
        or None
    )
    embedding_runtime = _resolve_binding_runtime(
        config,
        binding_name=embedding_binding_name,
        model=None,
        capability_type="embedding",
    )
    embedding_model = str(
        getattr(embedding_runtime.get("binding"), "model", None)
        or "text-embedding-3-large"
    )
    embedding_dim = infer_embedding_dim(embedding_model, embedding_runtime["provider_name"])

    vision_binding_name = (
        str(getattr(rag_config, "vision_binding", "") or "").strip()
        or first_binding_name_by_capability(getattr(config, "model_bindings", {}), "multimodal")
        or None
    )
    vision_runtime = (
        _resolve_binding_runtime(
            config,
            binding_name=vision_binding_name,
            model=None,
            capability_type="multimodal",
        )
        if vision_binding_name
        else {}
    )
    vision_model = str(
        getattr(vision_runtime.get("binding"), "model", None)
        or default_model
    ).strip() or default_model

    rerank_binding_name = (
        str(rag_config.rerank_binding or "").strip()
        or first_binding_name_by_capability(getattr(config, "model_bindings", {}), "rerank")
        or None
    )
    rerank_runtime = (
        _resolve_binding_runtime(
            config,
            binding_name=rerank_binding_name,
            model=None,
            capability_type="rerank",
        )
        if rerank_binding_name
        else {}
    )
    rerank_model = str(
        getattr(rerank_runtime.get("binding"), "model", None)
        or ""
    ).strip() or None

    rag_postgres = getattr(rag_config, "postgres", None)
    use_pg_lightrag_storage = bool(
        rag_postgres is not None
        and getattr(rag_postgres, "enabled", False)
    )
    rag_graph_store = getattr(rag_config, "graph_store", None)
    use_neo4j_graph = bool(
        rag_graph_store
        and getattr(rag_graph_store, "enabled", False)
        and str(getattr(rag_graph_store, "provider", "") or "").strip().lower() == "neo4j"
        and str(getattr(rag_graph_store, "uri", "") or "").strip()
    )

    # --- Vector storage selection ---
    # Use Milvus only when explicitly configured (non-default URI).
    # Otherwise fall back to NanoVectorDBStorage (zero-dependency local files).
    milvus_uri = str(getattr(rag_config.milvus, "uri", "") or "").strip()
    _default_milvus_uri = "http://127.0.0.1:19530"
    use_milvus = bool(milvus_uri and milvus_uri != _default_milvus_uri)

    if not use_milvus and milvus_uri == _default_milvus_uri:
        # Check if Milvus is actually reachable at the default address
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex(("127.0.0.1", 19530))
            sock.close()
            use_milvus = result == 0
        except Exception:
            use_milvus = False

    if use_milvus:
        vector_storage = "MilvusVectorDBStorage"
        vector_db_kwargs: dict[str, Any] = {
            "index_type": str(getattr(rag_config.milvus, "index_type", "AUTOINDEX") or "AUTOINDEX").strip()
            or "AUTOINDEX",
            "metric_type": str(getattr(rag_config.milvus, "metric_type", "COSINE") or "COSINE").strip()
            or "COSINE",
        }
        logger.info("RAG vector storage: Milvus ({})", milvus_uri)
    else:
        vector_storage = "NanoVectorDBStorage"
        vector_db_kwargs = {}
        logger.info("RAG vector storage: NanoVectorDB (local file storage)")

    lightrag_base_kwargs: dict[str, Any] = {
        "kv_storage": "PGKVStorage" if use_pg_lightrag_storage else "JsonKVStorage",
        "vector_storage": vector_storage,
        "graph_storage": "Neo4JStorage" if use_neo4j_graph else "NetworkXStorage",
        "doc_status_storage": "PGDocStatusStorage" if use_pg_lightrag_storage else "JsonDocStatusStorage",
        "default_llm_timeout": int(getattr(rag_config, "llm_timeout", 60) or 60),
        "default_embedding_timeout": int(getattr(rag_config, "embedding_timeout", 30) or 30),
        "llm_model_max_async": max(1, int(getattr(rag_config, "max_async", 4) or 4)),
        "max_parallel_insert": max(1, int(getattr(rag_config, "max_parallel_insert", 2) or 2)),
        "embedding_func_max_async": max(
            1,
            int(getattr(rag_config, "embedding_func_max_async", 8) or 8),
        ),
        "chunk_token_size": max(200, int(getattr(rag_config, "chunk_token_size", 1200) or 1200)),
        "chunk_overlap_token_size": max(
            0,
            int(getattr(rag_config, "chunk_overlap_token_size", 100) or 100),
        ),
        "embedding_batch_num": max(1, int(getattr(rag_config, "embedding_batch_num", 10) or 10)),
        "embedding_cache_config": {
            "enabled": bool(getattr(rag_config, "embedding_cache_enabled", False)),
            "similarity_threshold": float(
                getattr(rag_config, "embedding_cache_similarity_threshold", 0.95) or 0.95
            ),
            "use_llm_check": bool(getattr(rag_config, "embedding_cache_use_llm_check", False)),
        },
        "enable_llm_cache": bool(getattr(rag_config, "enable_llm_cache", True)),
        "enable_llm_cache_for_entity_extract": bool(
            getattr(rag_config, "enable_llm_cache_for_entity_extract", True)
        ),
        "min_rerank_score": float(getattr(rag_config, "min_rerank_score", 0.0) or 0.0),
    }
    if vector_db_kwargs:
        lightrag_base_kwargs["vector_db_storage_cls_kwargs"] = vector_db_kwargs

    storage_env: dict[str, str] = {}
    if use_milvus:
        storage_env = {
            "MILVUS_URI": milvus_uri,
            "MILVUS_DB_NAME": str(getattr(rag_config.milvus, "db_name", "") or "").strip(),
            "MILVUS_USER": str(getattr(rag_config.milvus, "user", "") or "").strip(),
            "MILVUS_PASSWORD": str(getattr(rag_config.milvus, "password", "") or "").strip(),
            "MILVUS_TOKEN": str(getattr(rag_config.milvus, "token", "") or "").strip(),
        }
    if use_pg_lightrag_storage and rag_postgres is not None:
        # Nanobot uses Milvus or NanoVectorDB for vector storage, NOT PGVectorStorage.
        # LightRAG's ClientManager.get_config() reads POSTGRES_ENABLE_VECTOR (default "true")
        # to decide whether to register pgvector codecs on the PG connection pool.
        # When pgvector extension is not installed in PostgreSQL, this causes:
        #   "unknown type: public.vector"
        # Setting this to "false" tells the PG pool to skip pgvector initialization.
        pg_needs_vector = vector_storage == "PGVectorStorage"
        storage_env.update(
            {
                "POSTGRES_HOST": str(getattr(rag_postgres, "host", "127.0.0.1") or "127.0.0.1"),
                "POSTGRES_PORT": str(getattr(rag_postgres, "port", 5432) or 5432),
                "POSTGRES_USER": str(getattr(rag_postgres, "user", "postgres") or "postgres"),
                "POSTGRES_PASSWORD": str(getattr(rag_postgres, "password", "") or ""),
                "POSTGRES_DATABASE": str(getattr(rag_postgres, "database", "nanobot") or "nanobot"),
                "POSTGRES_MAX_CONNECTIONS": str(getattr(rag_postgres, "max_connections", 50) or 50),
                "POSTGRES_ENABLE_VECTOR": "true" if pg_needs_vector else "false",
                "POSTGRES_SSL_MODE": str(getattr(rag_postgres, "ssl_mode", "") or "").strip(),
                "POSTGRES_SSL_CERT": str(getattr(rag_postgres, "ssl_cert", "") or "").strip(),
                "POSTGRES_SSL_KEY": str(getattr(rag_postgres, "ssl_key", "") or "").strip(),
                "POSTGRES_SSL_ROOT_CERT": str(getattr(rag_postgres, "ssl_root_cert", "") or "").strip(),
                "POSTGRES_SSL_CRL": str(getattr(rag_postgres, "ssl_crl", "") or "").strip(),
            }
        )
    if use_neo4j_graph and rag_graph_store is not None:
        storage_env.update(
            {
                "NEO4J_URI": str(getattr(rag_graph_store, "uri", "") or "").strip(),
                "NEO4J_USERNAME": str(getattr(rag_graph_store, "username", "") or "").strip(),
                "NEO4J_PASSWORD": str(getattr(rag_graph_store, "password", "") or "").strip(),
                "NEO4J_DATABASE": str(getattr(rag_graph_store, "database", "") or "").strip(),
            }
        )

    parser_name = str(getattr(rag_config, "parser", "mineru") or "mineru").strip().lower() or "mineru"
    if parser_name != "mineru":
        raise ValueError("rag.parser only supports 'mineru'.")

    verify_parser_installation = bool(getattr(rag_config, "verify_parser_installation", True))
    mineru_config = getattr(rag_config, "mineru", None)
    parser_kwargs: dict[str, Any] = {}
    if mineru_config is not None:
        backend = str(getattr(mineru_config, "backend", "") or "").strip()
        vlm_url = str(getattr(mineru_config, "vlm_url", "") or "").strip()
        source = str(getattr(mineru_config, "source", "") or "").strip()
        if backend:
            parser_kwargs["backend"] = backend
        if vlm_url:
            parser_kwargs["vlm_url"] = vlm_url
        if source:
            parser_kwargs["source"] = source
        if backend.lower() == "vlm-http-client" and not vlm_url:
            raise ValueError("rag.mineru.vlm_url is required when rag.mineru.backend is 'vlm-http-client'.")

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
        vision_provider_name=vision_runtime.get("provider_name"),
        vision_api_key=vision_runtime.get("api_key"),
        vision_api_base=vision_runtime.get("api_base"),
        vision_extra_headers=vision_runtime.get("extra_headers"),
        vision_model=vision_model,
        rerank_provider_name=rerank_runtime.get("provider_name"),
        rerank_api_key=rerank_runtime.get("api_key"),
        rerank_api_base=rerank_runtime.get("api_base"),
        rerank_extra_headers=rerank_runtime.get("extra_headers"),
        rerank_model=rerank_model,
        llm_timeout=float(getattr(rag_config, "llm_timeout", 60) or 60),
        embedding_timeout=float(getattr(rag_config, "embedding_timeout", 30) or 30),
        document_parser=parser_name,
        parser_kwargs=parser_kwargs,
        verify_parser_installation=verify_parser_installation,
        lightrag_base_kwargs=lightrag_base_kwargs,
        storage_env=storage_env,
        max_cached_instances=max(1, int(getattr(rag_config, "max_cached_instances", 5) or 5)),
    )
