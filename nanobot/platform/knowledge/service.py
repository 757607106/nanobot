"""Service layer for the rebuilt knowledge-base subsystem."""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import textwrap
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import replace
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Any

from loguru import logger

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge.artifacts import KnowledgeArtifactStore
from nanobot.platform.knowledge.models import (
    KnowledgeBaseDefinition,
    KnowledgeFile,
    KnowledgeIngestJob,
    KnowledgeJobStatus,
    KnowledgeQueryParams,
    KNOWLEDGE_ARCHITECTURE_TYPE,
    default_query_params_payload,
    now_iso,
)
from nanobot.platform.knowledge.store import KnowledgeBaseStore
from nanobot.platform.tenant_scope import clone_service_with_overrides
from nanobot.utils.helpers import ensure_dir, safe_filename

if TYPE_CHECKING:
    from nanobot.config.schema import Config
    from nanobot.platform.knowledge.rag_engine import RAGEngine


class KnowledgeBaseNotFoundError(KeyError):
    """Raised when a knowledge base does not exist."""


class KnowledgeBaseConflictError(RuntimeError):
    """Raised when a knowledge base name would conflict."""


class KnowledgeBaseValidationError(ValueError):
    """Raised when the payload or source data is invalid."""


class KnowledgeSourceNotFoundError(KeyError):
    """Raised when a knowledge file or folder does not exist."""


from nanobot.platform.knowledge.llm_helpers import KnowledgeLLMHelper
from nanobot.platform.knowledge.utils import (
    DEFAULT_KNOWLEDGE_CHUNK_SIZE,
    DEFAULT_KNOWLEDGE_CHUNK_OVERLAP,
    DEFAULT_BEST_EFFORT_RETRIEVE_TIMEOUT_SECONDS,
    slugify as _slugify,
    short_id as _short_id,
    get_value as _get_value_fn,
    normalize_text as _normalize_text_fn,
    normalize_string_list as _normalize_string_list_fn,
    normalize_object as _normalize_object_fn,
    knowledge_model_value as _knowledge_model_value_fn,
    split_large_block as _split_large_block_fn,
)


class KnowledgeBaseService:
    """Instance-scoped knowledge-base CRUD, file tree, retrieval, and agent bindings."""

    def __init__(
        self,
        store: KnowledgeBaseStore,
        *,
        instance: PlatformInstance | None = None,
        instance_id: str = "default",
        tenant_id: str = "default",
        rag_engine: RAGEngine | None = None,
        max_background_jobs: int = 4,
        config: Config | None = None,
    ) -> None:
        self.store = store
        self.instance = instance
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.rag_engine = None
        self.config = config
        self._executor = ThreadPoolExecutor(
            max_workers=max(1, max_background_jobs),
            thread_name_prefix=f"knowledge-{instance_id}",
        )
        self._futures: set[Future[Any]] = set()
        self._futures_lock = Lock()
        self._rag_engine_lock = Lock()
        self._retired_rag_engines: list[Any] = []
        self._job_options_lock = Lock()
        self._job_options: dict[str, dict[str, Any]] = {}
        self._best_effort_retrieve_timeout_seconds = DEFAULT_BEST_EFFORT_RETRIEVE_TIMEOUT_SECONDS
        self.artifacts = KnowledgeArtifactStore(
            vector_dir_factory=self._kb_vector_dir,
            evaluation_dir_factory=self._kb_eval_dir,
        )
        self.llm_helper = KnowledgeLLMHelper(config, self._run_async)
        
        from nanobot.platform.knowledge.file_manager import KnowledgeFileManager
        from nanobot.platform.knowledge.document_pipeline import DocumentPipeline

        self.doc_pipeline = DocumentPipeline(
            store=self.store,
            artifacts=self.artifacts,
            rag_engine=self.rag_engine,
            run_async_fn=self._run_async,
            file_storage_paths_fn=self._file_storage_paths,
            require_kb_fn=self.require_kb,
            require_file_fn=self._require_file,
            update_file_fn=self._update_file,
            create_job_fn=self._create_job,
            start_job_fn=self._start_job,
            finish_job_fn=self._finish_job,
            submit_job_fn=self._submit_background_job,
            serialize_file_fn=self._serialize_file,
            serialize_job_fn=self._serialize_job,
            store_job_options_fn=self._store_job_options,
            consume_job_options_fn=self._consume_job_options,
            move_file_fn=self.move_file,
            generate_questions_fn=self.generate_sample_questions,
            resolve_vision_runtime_fn=self._resolve_vision_runtime_from_info,
        )

        self.file_manager = KnowledgeFileManager(
            store=self.store,
            instance=self.instance,
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            artifacts=self.artifacts,
            rag_engine=self.rag_engine,
            run_async_fn=self._run_async,
            raw_dir_fn=self._kb_raw_dir,
            parsed_dir_fn=self._kb_parsed_dir,
            create_job_fn=self._create_job,
            start_job_fn=self._start_job,
            submit_job_fn=self._submit_background_job,
            parse_job_fn=self.doc_pipeline.run_parse_job,
            require_kb_fn=self.require_kb,
            ingest_files_fn=self.ingest_files,
        )

        from nanobot.platform.knowledge.query_service import KnowledgeQueryService
        self.query_service = KnowledgeQueryService(
            store=self.store,
            artifacts=self.artifacts,
            rag_engine=self.rag_engine,
            run_async_fn=self._run_async,
            require_kb_fn=self.require_kb,
            resolve_bound_kbs_fn=self.resolve_bound_kbs,
            extract_requested_file_ids_fn=self._extract_requested_file_ids,
            generate_with_llm_fn=self._generate_with_llm,
            best_effort_timeout=self._best_effort_retrieve_timeout_seconds,
        )

        from nanobot.platform.knowledge.evaluation_service import KnowledgeEvaluationService
        self.eval_service = KnowledgeEvaluationService(
            store=self.store,
            artifacts=self.artifacts,
            rag_engine=self.rag_engine,
            run_async_fn=self._run_async,
            require_kb_fn=self.require_kb,
            submit_job_fn=self._submit_background_job,
            generate_with_llm_fn=self._generate_with_llm,
            extract_json_fn=self._extract_json_text,
            query_database_fn=lambda kb_id, payload: self.query_database(kb_id, payload),
            normalize_text_fn=self._normalize_text,
            normalize_string_list_fn=self._normalize_string_list,
        )

        import threading

        self._loop = asyncio.new_event_loop()
        self._loop_thread = threading.Thread(
            target=self._execute_loop,
            name=f"knowledge-loop-{instance_id}",
            daemon=True,
        )
        self._loop_thread.start()
        self.set_rag_engine(rag_engine)

    def _execute_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _run_async(self, coro: Any, *, timeout: float | None = None) -> Any:
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        try:
            return future.result(timeout=timeout)
        except FutureTimeoutError as exc:
            future.cancel()
            if timeout is None:
                raise
            raise TimeoutError(f"Knowledge async task timed out after {timeout:.1f}s") from exc

    def shutdown(self) -> None:
        if self.rag_engine is not None and self._loop.is_running():
            try:
                self._run_async(self.rag_engine.shutdown_async())
            except Exception:
                logger.exception("Failed to shut down knowledge RAG engine")
        for retired in list(self._retired_rag_engines):
            if retired is None or not self._loop.is_running():
                continue
            try:
                self._run_async(retired.shutdown_async())
            except Exception:
                logger.exception("Failed to shut down retired knowledge RAG engine")
        if self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._loop_thread.is_alive():
            self._loop_thread.join(timeout=1.0)
        self._executor.shutdown(wait=False, cancel_futures=True)

    def set_rag_engine(self, rag_engine: RAGEngine | None) -> None:
        with self._rag_engine_lock:
            previous = self.rag_engine
            self.rag_engine = rag_engine
            self.file_manager.rag_engine = rag_engine
            self.doc_pipeline.rag_engine = rag_engine
            self.query_service.rag_engine = rag_engine
            self.eval_service.rag_engine = rag_engine
            if previous is not None and previous is not rag_engine:
                self._retired_rag_engines.append(previous)

    def set_config(self, config: Config | None) -> None:
        self.config = config
        self.llm_helper.config = config

    def with_tenant(self, tenant_id: str | None) -> KnowledgeBaseService:
        """Return a lightweight tenant-scoped view over the shared service runtime."""
        normalized = str(tenant_id or "default").strip() or "default"
        if normalized == self.tenant_id:
            return self
        return clone_service_with_overrides(self, tenant_id=normalized)

    @staticmethod
    def _knowledge_model_value(info: dict[str, Any] | None, *keys: str) -> str:
        return _knowledge_model_value_fn(info, *keys)

    def _resolve_binding_runtime(
        self,
        *,
        binding_name: str | None,
        model_name: str | None,
        capability_type: str,
    ) -> dict[str, Any]:
        return self.llm_helper.resolve_binding_runtime(
            binding_name=binding_name,
            model_name=model_name,
            capability_type=capability_type,
        )

    def _resolve_vision_runtime_from_info(self, vision_info: dict[str, Any]) -> dict[str, Any]:
        """Resolve a visionInfo dict (from KB additional_params) to a runtime dict.

        Called by DocumentPipeline when parsing PDF files with multimodal enabled.
        """
        return self._resolve_binding_runtime(
            binding_name=self._knowledge_model_value(vision_info, "bindingName", "binding_name"),
            model_name=self._knowledge_model_value(vision_info, "modelName", "model_name", "model"),
            capability_type="multimodal",
        )

    def _resolve_kb_runtime_overrides(self, kb_id: str) -> dict[str, Any]:
        kb = self.store.get_kb(kb_id)
        if kb is None or kb.instance_id != self.instance_id or kb.tenant_id != self.tenant_id:
            return {}

        llm_runtime = self._resolve_binding_runtime(
            binding_name=self._knowledge_model_value(kb.llm_info, "bindingName", "binding_name"),
            model_name=self._knowledge_model_value(kb.llm_info, "modelName", "model_name", "model"),
            capability_type="text_chat",
        )
        embedding_runtime = self._resolve_binding_runtime(
            binding_name=self._knowledge_model_value(kb.embed_info, "bindingName", "binding_name"),
            model_name=self._knowledge_model_value(kb.embed_info, "modelName", "model_name", "model"),
            capability_type="embedding",
        )

        # Vision binding stored in additional_params.visionInfo (set by frontend shared.ts)
        vision_info = kb.additional_params.get("visionInfo") or {}
        vision_runtime = self._resolve_binding_runtime(
            binding_name=self._knowledge_model_value(vision_info, "bindingName", "binding_name"),
            model_name=self._knowledge_model_value(vision_info, "modelName", "model_name", "model"),
            capability_type="multimodal",
        )

        # Rerank binding stored in additional_params.rerankInfo (set by frontend shared.ts)
        rerank_info = kb.additional_params.get("rerankInfo") or {}
        rerank_runtime = self._resolve_binding_runtime(
            binding_name=self._knowledge_model_value(rerank_info, "bindingName", "binding_name"),
            model_name=self._knowledge_model_value(rerank_info, "modelName", "model_name", "model"),
            capability_type="rerank",
        )

        overrides: dict[str, Any] = {}
        if llm_runtime:
            overrides.update({
                "llm_model": llm_runtime["model"],
                "llm_provider_name": llm_runtime["provider_name"],
                "llm_api_key": llm_runtime["api_key"],
                "llm_api_base": llm_runtime["api_base"],
                "llm_extra_headers": llm_runtime["extra_headers"],
            })
        if embedding_runtime:
            overrides.update({
                "embedding_model": embedding_runtime["model"],
                "embedding_provider_name": embedding_runtime["provider_name"],
                "embedding_api_key": embedding_runtime["api_key"],
                "embedding_api_base": embedding_runtime["api_base"],
                "embedding_extra_headers": embedding_runtime["extra_headers"],
                "embedding_dim": embedding_runtime["embedding_dim"],
            })
        if vision_runtime:
            overrides.update({
                "vision_model": vision_runtime["model"],
                "vision_provider_name": vision_runtime["provider_name"],
                "vision_api_key": vision_runtime["api_key"],
                "vision_api_base": vision_runtime["api_base"],
                "vision_extra_headers": vision_runtime["extra_headers"],
            })
        if rerank_runtime:
            overrides.update({
                "rerank_model": rerank_runtime["model"],
                "rerank_provider_name": rerank_runtime["provider_name"],
                "rerank_api_key": rerank_runtime["api_key"],
                "rerank_api_base": rerank_runtime["api_base"],
                "rerank_extra_headers": rerank_runtime["extra_headers"],
            })
        return overrides

    @staticmethod
    def _knowledge_model_signature(info: dict[str, Any] | None) -> tuple[str, str]:
        return (
            KnowledgeBaseService._knowledge_model_value(info, "bindingName", "binding_name"),
            KnowledgeBaseService._knowledge_model_value(info, "modelName", "model_name", "model"),
        )

    def _effective_model_signature(
        self,
        info: dict[str, Any] | None,
        *,
        capability_type: str,
    ) -> tuple[str, str]:
        binding_name = self._knowledge_model_value(info, "bindingName", "binding_name")
        model_name = self._knowledge_model_value(info, "modelName", "model_name", "model")
        runtime = self._resolve_binding_runtime(
            binding_name=binding_name,
            model_name=model_name,
            capability_type=capability_type,
        )
        if runtime:
            return (
                str(runtime.get("binding_name") or binding_name or "").strip(),
                str(runtime.get("model") or model_name or "").strip(),
            )
        if self.config is None:
            return binding_name, model_name

        fallback_binding_name = str(
            getattr(self.config.rag, "embedding_binding" if capability_type == "embedding" else "llm_binding", "")
            or ""
        ).strip()
        fallback_runtime = self._resolve_binding_runtime(
            binding_name=fallback_binding_name or None,
            model_name=None,
            capability_type=capability_type,
        )
        if fallback_runtime:
            return (
                str(fallback_runtime.get("binding_name") or fallback_binding_name or "").strip(),
                str(fallback_runtime.get("model") or "").strip(),
            )
        return binding_name, model_name

    def _track_future(self, future: Future[Any]) -> None:
        with self._futures_lock:
            self._futures.add(future)

        def _cleanup(done: Future[Any]) -> None:
            with self._futures_lock:
                self._futures.discard(done)
            try:
                done.result()
            except Exception:
                logger.exception("Knowledge background job crashed")

        future.add_done_callback(_cleanup)

    def _submit_background_job(self, fn: Any, *args: Any) -> None:
        future = self._executor.submit(fn, *args)
        self._track_future(future)

    def _store_job_options(self, job_id: str, payload: dict[str, Any]) -> None:
        with self._job_options_lock:
            self._job_options[job_id] = dict(payload)

    def _consume_job_options(self, job_id: str) -> dict[str, Any]:
        with self._job_options_lock:
            return dict(self._job_options.pop(job_id, {}))

    @staticmethod
    def _get_value(payload: dict[str, Any], *keys: str) -> Any:
        return _get_value_fn(payload, *keys)

    @staticmethod
    def _normalize_text(value: Any, *, required: bool = False, field_name: str = "value") -> str:
        return _normalize_text_fn(value, required=required, field_name=field_name)

    @staticmethod
    def _normalize_string_list(value: Any, *, field_name: str) -> list[str]:
        return _normalize_string_list_fn(value, field_name=field_name)

    @staticmethod
    def _normalize_object(value: Any, *, field_name: str) -> dict[str, Any]:
        return _normalize_object_fn(value, field_name=field_name)

    @staticmethod
    def _normalize_kb_type(value: Any) -> str:
        kb_type = str(value or "").strip().lower()
        if kb_type in {"", "lightrag", "milvus"}:
            return KNOWLEDGE_ARCHITECTURE_TYPE
        if kb_type not in {KNOWLEDGE_ARCHITECTURE_TYPE}:
            raise KnowledgeBaseValidationError(f"Unsupported knowledge base type: {kb_type}.")
        return KNOWLEDGE_ARCHITECTURE_TYPE

    def _next_kb_id(self, name: str) -> str:
        base = _slugify(name)
        candidate = base
        counter = 2
        while self.store.get_kb(candidate) is not None:
            candidate = f"{base}-{counter}"
            counter += 1
        return candidate

    def _ensure_unique_name(self, name: str, *, exclude_kb_id: str | None = None) -> None:
        existing = self.store.get_kb_by_name(name, tenant_id=self.tenant_id, instance_id=self.instance_id)
        if existing is None:
            return
        if exclude_kb_id and existing.kb_id == exclude_kb_id:
            return
        raise KnowledgeBaseConflictError(f"Knowledge base name '{name}' already exists.")

    def _kb_raw_dir(self, kb_id: str) -> Path:
        if self.instance is not None:
            return ensure_dir(self.instance.knowledge_files_dir() / kb_id)
        raise KnowledgeBaseValidationError("Platform instance is required for knowledge files.")

    def _kb_parsed_dir(self, kb_id: str) -> Path:
        if self.instance is not None:
            return ensure_dir(self.instance.knowledge_parsed_dir() / kb_id)
        raise KnowledgeBaseValidationError("Platform instance is required for parsed knowledge files.")

    def _kb_vector_dir(self, kb_id: str) -> Path:
        if self.instance is not None:
            return ensure_dir(self.instance.runtime_dir("knowledge-vectors") / kb_id)
        raise KnowledgeBaseValidationError("Platform instance is required for vector knowledge files.")

    def _kb_eval_dir(self, kb_id: str) -> Path:
        if self.instance is not None:
            return ensure_dir(self.instance.runtime_dir("knowledge-evaluation") / kb_id)
        raise KnowledgeBaseValidationError("Platform instance is required for evaluation files.")

    def _file_storage_paths(self, kb_id: str, file_id: str, filename: str) -> tuple[Path, Path]:
        safe_name = safe_filename(filename or f"{file_id}.txt")
        raw_path = self._kb_raw_dir(kb_id) / f"{file_id}-{safe_name}"
        parsed_path = self._kb_parsed_dir(kb_id) / f"{file_id}.md"
        return raw_path, parsed_path

    def require_kb(self, kb_id: str) -> KnowledgeBaseDefinition:
        kb = self.store.get_kb(kb_id)
        if kb is None or kb.instance_id != self.instance_id or kb.tenant_id != self.tenant_id:
            raise KnowledgeBaseNotFoundError(kb_id)
        return kb

    def _serialize_kb(self, kb: KnowledgeBaseDefinition) -> dict[str, Any]:
        payload = kb.to_dict()
        payload["stats"] = self.store.get_kb_stats(kb.kb_id)
        return payload

    def _serialize_file(self, file: KnowledgeFile) -> dict[str, Any]:
        return file.to_dict()

    def _serialize_job(self, job: KnowledgeIngestJob) -> dict[str, Any]:
        return job.to_dict()

    def _ensure_lightrag(self, kb: KnowledgeBaseDefinition, *, feature: str) -> None:
        if self.rag_engine is None:
            raise KnowledgeBaseValidationError(f"{feature} is unavailable because the RAG engine is not configured.")

    def _ensure_evaluation_supported(self, kb: KnowledgeBaseDefinition) -> None:
        self._ensure_lightrag(kb, feature="Evaluation")


    def _require_file(self, kb_id: str, file_id: str) -> KnowledgeFile:
        return self.file_manager._require_file(kb_id, file_id)


    def _update_file(self, file: KnowledgeFile) -> KnowledgeFile:
        return self.file_manager._update_file(file)


    def _create_job(self, kb_id: str, job_kind: str, target_file_ids: list[str]) -> KnowledgeIngestJob:
        now = now_iso()
        return self.store.insert_job(
            KnowledgeIngestJob(
                job_id=_short_id("job"),
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_id=kb_id,
                job_kind=job_kind,
                target_file_ids=list(target_file_ids),
                status=KnowledgeJobStatus.QUEUED,
                track_id=_short_id("track"),
                created_at=now,
                updated_at=now,
            )
        )

    def _start_job(self, job: KnowledgeIngestJob) -> KnowledgeIngestJob:
        updated = replace(job, status=KnowledgeJobStatus.RUNNING, updated_at=now_iso())
        persisted = self.store.update_job(updated)
        if persisted is None:
            raise RuntimeError(f"Failed to start knowledge job {job.job_id}")
        return persisted

    def _finish_job(self, job: KnowledgeIngestJob, *, error_summary: str | None = None) -> KnowledgeIngestJob:
        updated = replace(
            job,
            status=KnowledgeJobStatus.FAILED if error_summary else KnowledgeJobStatus.SUCCEEDED,
            error_summary=error_summary,
            updated_at=now_iso(),
        )
        persisted = self.store.update_job(updated)
        if persisted is None:
            raise RuntimeError(f"Failed to finish knowledge job {job.job_id}")
        return persisted

    def list_available_models(self) -> dict[str, list[dict[str, Any]]]:
        if not self.config:
            return {}
        bindings = getattr(self.config, "model_bindings", {})
        result: dict[str, list[dict[str, Any]]] = {
            "text_chat": [],
            "embedding": [],
            "multimodal": [],
            "rerank": []
        }
        for binding_name, binding in bindings.items():
            cap = str(getattr(binding, "capability_type", "text_chat") or "text_chat").strip()
            if cap in result:
                result[cap].append({
                    "binding_name": binding_name,
                    "model": getattr(binding, "model", None),
                    "label": getattr(binding, "label", None) or binding_name,
                    "provider": getattr(binding, "provider", None)
                })
        return result

    def list_knowledge_bases(self, enabled: bool | None = None) -> list[dict[str, Any]]:
        return [self._serialize_kb(item) for item in self.store.list_kbs(
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            enabled=enabled,
        )]

    def list_accessible_knowledge_bases(self, enabled: bool | None = True) -> list[dict[str, Any]]:
        return self.list_knowledge_bases(enabled=enabled)

    def get_knowledge_base(self, kb_id: str) -> dict[str, Any]:
        return self._serialize_kb(self.require_kb(kb_id))

    def create_knowledge_base(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = self._normalize_text(self._get_value(payload, "name"), required=True, field_name="name")
        self._ensure_unique_name(name)
        now = now_iso()
        kb_type = self._normalize_kb_type(self._get_value(payload, "kbType", "kb_type"))
        query_payload = self._get_value(payload, "queryParams", "query_params", "retrievalProfile", "retrieval_profile")
        kb = self.store.create_kb(
            KnowledgeBaseDefinition(
                kb_id=self._next_kb_id(name),
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                name=name,
                description=self._normalize_text(self._get_value(payload, "description"), field_name="description"),
                enabled=True if self._get_value(payload, "enabled") is None else bool(self._get_value(payload, "enabled")),
                kb_type=kb_type,
                embed_info=self._normalize_object(
                    self._get_value(payload, "embedInfo", "embed_info") or {},
                    field_name="embedInfo",
                ),
                llm_info=self._normalize_object(
                    self._get_value(payload, "llmInfo", "llm_info") or {},
                    field_name="llmInfo",
                ),
                query_params=KnowledgeQueryParams.from_dict(
                    query_payload,
                    defaults=default_query_params_payload(),
                ),
                additional_params=self._normalize_object(
                    self._get_value(payload, "additionalParams", "additional_params") or {},
                    field_name="additionalParams",
                ),
                share_config=self._normalize_object(
                    self._get_value(payload, "shareConfig", "share_config") or {},
                    field_name="shareConfig",
                ),
                sample_questions=self._normalize_string_list(
                    self._get_value(payload, "sampleQuestions", "sample_questions"),
                    field_name="sampleQuestions",
                ),
                tags=self._normalize_string_list(self._get_value(payload, "tags"), field_name="tags"),
                created_at=now,
                updated_at=now,
            )
        )
        return self._serialize_kb(kb)

    def update_knowledge_base(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.require_kb(kb_id)
        name = self._normalize_text(
            self._get_value(payload, "name") if "name" in payload else existing.name,
            required=True,
            field_name="name",
        )
        self._ensure_unique_name(name, exclude_kb_id=kb_id)
        next_embed_info = (
            self._normalize_object(self._get_value(payload, "embedInfo", "embed_info"), field_name="embedInfo")
        ) if ("embedInfo" in payload or "embed_info" in payload) else existing.embed_info
        next_llm_info = (
            self._normalize_object(self._get_value(payload, "llmInfo", "llm_info"), field_name="llmInfo")
        ) if ("llmInfo" in payload or "llm_info" in payload) else existing.llm_info
        embed_changed = (
            self._effective_model_signature(next_embed_info, capability_type="embedding")
            != self._effective_model_signature(existing.embed_info, capability_type="embedding")
        )
        llm_changed = (
            self._effective_model_signature(next_llm_info, capability_type="text_chat")
            != self._effective_model_signature(existing.llm_info, capability_type="text_chat")
        )
        if embed_changed:
            stats = self.store.get_kb_stats(kb_id)
            if int(stats.get("indexedCount") or 0) > 0:
                raise KnowledgeBaseValidationError(
                    "Embedding 模型在已有索引数据时不能直接修改。请先删除知识库索引数据后重建，"
                    "因为 LightRAG 要求索引和查询阶段使用同一套 embedding 维度。"
                )
        next_kb_type = KNOWLEDGE_ARCHITECTURE_TYPE
        has_query_params_update = (
            "queryParams" in payload
            or "query_params" in payload
            or "retrievalProfile" in payload
            or "retrieval_profile" in payload
        )
        updated = replace(
            existing,
            name=name,
            description=(
                self._normalize_text(self._get_value(payload, "description"), field_name="description")
                if "description" in payload
                else existing.description
            ),
            enabled=bool(self._get_value(payload, "enabled")) if "enabled" in payload else existing.enabled,
            kb_type=next_kb_type,
            embed_info=next_embed_info,
            llm_info=next_llm_info,
            query_params=(
                KnowledgeQueryParams.from_dict(
                    self._get_value(payload, "queryParams", "query_params", "retrievalProfile", "retrieval_profile"),
                    defaults=default_query_params_payload(),
                )
            ) if has_query_params_update else (
                existing.query_params
            ),
            additional_params=(
                self._normalize_object(self._get_value(payload, "additionalParams", "additional_params"), field_name="additionalParams")
            ) if ("additionalParams" in payload or "additional_params" in payload) else existing.additional_params,
            share_config=(
                self._normalize_object(self._get_value(payload, "shareConfig", "share_config"), field_name="shareConfig")
            ) if ("shareConfig" in payload or "share_config" in payload) else existing.share_config,
            mindmap=self._get_value(payload, "mindmap") if "mindmap" in payload else existing.mindmap,
            sample_questions=(
                self._normalize_string_list(self._get_value(payload, "sampleQuestions", "sample_questions"), field_name="sampleQuestions")
            ) if ("sampleQuestions" in payload or "sample_questions" in payload) else existing.sample_questions,
            tags=(
                self._normalize_string_list(self._get_value(payload, "tags"), field_name="tags")
            ) if "tags" in payload else existing.tags,
            updated_at=now_iso(),
        )
        persisted = self.store.update_kb(updated)
        if persisted is None:
            raise KnowledgeBaseNotFoundError(kb_id)
        if (embed_changed or llm_changed) and self.rag_engine is not None and hasattr(self.rag_engine, "reset_kb"):
            self._run_async(self.rag_engine.reset_kb(kb_id))
        return self._serialize_kb(persisted)

    def delete_knowledge_base(self, kb_id: str) -> bool:
        self.require_kb(kb_id)
        # Delete data from LightRAG Server
        if self.rag_engine is not None:
            try:
                self._run_async(self.rag_engine.delete_kb(kb_id))
            except Exception:
                logger.exception("Failed to delete RAG data for knowledge base {}", kb_id)
        for root in (
            self._kb_raw_dir(kb_id),
            self._kb_parsed_dir(kb_id),
            self._kb_vector_dir(kb_id),
            self._kb_eval_dir(kb_id),
        ):
            if root.exists():
                shutil.rmtree(root, ignore_errors=True)
        return self.store.delete_kb(kb_id)

    def resolve_bound_kbs(self, kb_ids: list[str]) -> list[KnowledgeBaseDefinition]:
        result: list[KnowledgeBaseDefinition] = []
        missing: list[str] = []
        for kb_id in kb_ids:
            kb = self.store.get_kb(kb_id)
            if kb is None or kb.instance_id != self.instance_id or kb.tenant_id != self.tenant_id or not kb.enabled:
                missing.append(kb_id)
                continue
            result.append(kb)
        if missing:
            raise KnowledgeBaseValidationError(
                f"Agent references unknown or disabled knowledge bases: {', '.join(missing)}"
            )
        return result

    def list_files(self, kb_id: str) -> dict[str, Any]:
        return self.file_manager.list_files(kb_id)

    def create_folder(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.file_manager.create_folder(kb_id, payload)

    def upload_files(self, kb_id: str, files: list[dict[str, Any]], *, parent_id: str | None = None) -> dict[str, Any]:
        return self.file_manager.upload_files(kb_id, files, parent_id=parent_id)

    def fetch_url_file(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.file_manager.fetch_url_file(kb_id, payload)

    def add_source_file(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.file_manager.add_source_file(kb_id, payload)

    def list_sources(self, kb_id: str) -> list[dict[str, Any]]:
        return self.file_manager.list_sources(kb_id)

    def update_source(self, kb_id: str, source_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.file_manager.update_source(kb_id, source_id, payload)

    def sync_source(self, kb_id: str, source_id: str) -> dict[str, Any]:
        return self.file_manager.sync_source(kb_id, source_id)

    def move_file(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.file_manager.move_file(kb_id, payload)

    def delete_file(self, kb_id: str, file_id: str) -> bool:
        return self.file_manager.delete_file(kb_id, file_id)

    def delete_files(self, kb_id: str, file_ids: list[str]) -> dict[str, Any]:
        return self.file_manager.delete_files(kb_id, file_ids)

    def list_jobs(self, kb_id: str) -> list[dict[str, Any]]:
        self.require_kb(kb_id)
        return [self._serialize_job(job) for job in self.store.list_jobs(kb_id)]


    def _extract_requested_file_ids(self, payload: dict[str, Any] | None) -> list[str] | None:
        return self.doc_pipeline._extract_requested_file_ids(payload)


    def _decode_text(self, content: bytes) -> str:
        return self.doc_pipeline._decode_text(content)



    def parse_files(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.doc_pipeline.parse_files(kb_id, payload)

    def index_files(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.doc_pipeline.index_files(kb_id, payload)

    def ingest_files(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.doc_pipeline.ingest_files(kb_id, payload)

    def get_query_params(self, kb_id: str) -> dict[str, Any]:
        return self.query_service.get_query_params(kb_id)

    def get_query_param_schema(self, kb_id: str) -> dict[str, Any]:
        return self.query_service.get_query_param_schema(kb_id)

    def update_query_params(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.query_service.update_query_params(kb_id, payload)

    def generate_description(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = self._normalize_text(payload.get("name"), required=True, field_name="name")
        current_description = self._normalize_text(
            payload.get("currentDescription") if "currentDescription" in payload else payload.get("current_description"),
            field_name="currentDescription",
        )
        file_list = self._normalize_string_list(
            payload.get("fileList") if "fileList" in payload else payload.get("file_list"),
            field_name="fileList",
        )
        kb_id = self._normalize_text(payload.get("kbId") if "kbId" in payload else payload.get("kb_id"), field_name="kbId")
        if kb_id and not file_list:
            kb = self.require_kb(kb_id)
            file_list = [
                item.path
                for item in self.store.list_files(kb.kb_id)
                if not item.is_folder and str(item.path or "").strip()
            ]
        display_files = file_list[:50]
        file_text = "\n".join(f"- {item}" for item in display_files)
        more_text = f"\n... (还有 {len(file_list) - len(display_files)} 个文件)" if len(file_list) > len(display_files) else ""
        file_rule = "5. 请结合提供的文件列表来概括知识范围。" if display_files else ""
        file_section = f"文件列表:\n{file_text}{more_text}" if display_files else ""

        prompt = textwrap.dedent(
            f"""
            请帮我优化以下知识库的描述。

            知识库名称: {name}
            当前描述: {current_description or "暂无描述"}

            要求:
            1. 这个描述将作为智能体工具的描述使用。
            2. 要清晰说明知识库包含什么内容、适合解答什么问题。
            3. 描述保持简洁有力，通常 2 到 4 句话。
            4. 不要使用 Markdown，不要添加前缀说明。
            {file_rule}

            {file_section}
            """
        ).strip()
        description = self._generate_with_llm(
            system_prompt="你是知识库信息架构专家，擅长为 AI Agent 编写清晰、准确、可检索的知识库描述。",
            user_prompt=prompt,
        )
        if description:
            return {"description": description}

        display_names = [Path(item).name or item for item in display_files[:6]]
        if display_names:
            summary = f"{name}知识库，主要包含{'、'.join(display_names)}等资料。适合用于回答与这些资料相关的操作说明、事实查询和流程问题。"
        elif current_description:
            summary = current_description
        else:
            summary = f"{name}知识库，适合用于回答与{name}相关的文档检索、流程说明和事实问答。"
        return {"description": summary}


    @staticmethod
    def _extract_json_text(raw: str) -> str | None:
        return KnowledgeLLMHelper.extract_json(raw)

    def _generate_with_llm(self, *, system_prompt: str, user_prompt: str) -> str | None:
        return self.llm_helper.generate(system_prompt=system_prompt, user_prompt=user_prompt)

    @staticmethod
    def _split_large_block(text: str, *, chunk_size: int, chunk_overlap: int) -> list[str]:
        return _split_large_block_fn(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap)




    def query_database(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.query_service.query_database(kb_id, payload)

    def retrieve(
        self,
        kb_ids: list[str],
        query: str,
        *,
        limit: int | None = None,
        filters: dict[str, Any] | None = None,
        requested_mode: str | None = None,
    ) -> dict[str, Any]:
        return self.query_service.retrieve(kb_ids, query, limit=limit, filters=filters, requested_mode=requested_mode)
    @staticmethod
    def _extract_headings(text: str, *, limit: int = 6) -> list[str]:
        from nanobot.platform.knowledge.evaluation_service import KnowledgeEvaluationService
        return KnowledgeEvaluationService._extract_headings(text, limit=limit)


    def _build_chunk_texts(self, kb, file, text):
        return self.eval_service._build_chunk_texts(kb, file, text)

    def generate_mindmap(self, kb_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.eval_service.generate_mindmap(kb_id, payload)

    def get_mindmap(self, kb_id: str) -> dict[str, Any]:
        return self.eval_service.get_mindmap(kb_id)

    def generate_sample_questions(self, kb_id: str, count: int = 10) -> dict[str, Any]:
        return self.eval_service.generate_sample_questions(kb_id, count)

    def get_sample_questions(self, kb_id: str) -> dict[str, Any]:
        return self.eval_service.get_sample_questions(kb_id)

    def get_graph_labels(self, kb_id: str) -> dict[str, Any]:
        return self.eval_service.get_graph_labels(kb_id)

    def get_graph(self, kb_id: str, *, node_label: str = "*", max_depth: int = 2, max_nodes: int = 50) -> dict[str, Any]:
        return self.eval_service.get_graph(kb_id, node_label=node_label, max_depth=max_depth, max_nodes=max_nodes)

    def get_graph_stats(self, kb_id: str) -> dict[str, Any]:
        return self.eval_service.get_graph_stats(kb_id)

    def _save_benchmark(self, kb_id: str, benchmark_id: str, *, name: str, description: str, questions: list[dict[str, Any]], created_by: str | None = None) -> dict[str, Any]:
        return self.artifacts.save_benchmark(kb_id, benchmark_id, name=name, description=description, questions=questions, created_by=created_by)

    def list_benchmarks(self, kb_id: str) -> list[dict[str, Any]]:
        return self.eval_service.list_benchmarks(kb_id)

    def upload_benchmark(self, kb_id: str, *, file_content: bytes, filename: str, name: str, description: str, created_by: str | None = None) -> dict[str, Any]:
        return self.eval_service.upload_benchmark(kb_id, file_content=file_content, filename=filename, name=name, description=description, created_by=created_by)

    def get_benchmark_detail(self, kb_id: str, benchmark_id: str, *, page: int = 1, page_size: int = 10) -> dict[str, Any]:
        return self.eval_service.get_benchmark_detail(kb_id, benchmark_id, page=page, page_size=page_size)

    def delete_benchmark(self, kb_id: str, benchmark_id: str) -> bool:
        return self.eval_service.delete_benchmark(kb_id, benchmark_id)

    def get_benchmark_download_path(self, kb_id: str, benchmark_id: str) -> Path:
        return self.eval_service.get_benchmark_download_path(kb_id, benchmark_id)

    def generate_benchmark(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.eval_service.generate_benchmark(kb_id, payload)

    def _load_evaluation_result(self, kb_id: str, task_id: str) -> dict[str, Any]:
        return self.eval_service._load_evaluation_result(kb_id, task_id)

    def _save_evaluation_result(self, kb_id: str, task_id: str, payload: dict[str, Any]) -> None:
        self.eval_service._save_evaluation_result(kb_id, task_id, payload)

    def run_evaluation(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.eval_service.run_evaluation(kb_id, payload)

    def _run_evaluation_task(self, kb_id: str, task_id: str) -> None:
        return self.eval_service._run_evaluation_task(kb_id, task_id)

    def get_evaluation_history(self, kb_id: str) -> list[dict[str, Any]]:
        return self.eval_service.get_evaluation_history(kb_id)

    def get_evaluation_result(self, kb_id: str, task_id: str, *, page: int = 1, page_size: int = 20, error_only: bool = False) -> dict[str, Any]:
        return self.eval_service.get_evaluation_result(kb_id, task_id, page=page, page_size=page_size, error_only=error_only)

    def delete_evaluation_result(self, kb_id: str, task_id: str) -> bool:
        return self.eval_service.delete_evaluation_result(kb_id, task_id)


    def get_download_path(self, kb_id: str, file_id: str, *, variant: str = "raw") -> Path:
        self.require_kb(kb_id)
        file = self._require_file(kb_id, file_id)
        candidate = file.raw_path if variant != "parsed" else (file.markdown_file or file.raw_path)
        if not candidate:
            raise KnowledgeBaseValidationError("Requested download artifact is not available.")
        path = Path(candidate)
        if not path.exists():
            raise KnowledgeBaseValidationError("Requested download artifact is missing from disk.")
        return path

    def get_file_detail(self, kb_id: str, file_id: str) -> dict[str, Any]:
        self.require_kb(kb_id)
        file = self._require_file(kb_id, file_id)
        if file.is_folder:
            raise KnowledgeBaseValidationError("Folder detail preview is not supported.")

        content = ""
        if file.markdown_file and Path(file.markdown_file).exists():
            content = Path(file.markdown_file).read_text(encoding="utf-8")
        elif file.raw_path and Path(file.raw_path).exists():
            raw_bytes = Path(file.raw_path).read_bytes()
            suffix = Path(file.raw_path).suffix.lower()
            is_text_like = (
                str(file.content_type or "").startswith("text/")
                or suffix in {".md", ".txt", ".json", ".csv", ".html", ".htm", ".xml", ".yaml", ".yml"}
            )
            if is_text_like:
                content = self._decode_text(raw_bytes)

        chunks = [
            {
                "chunkId": item.get("chunkId"),
                "chunk_id": item.get("chunkId"),
                "chunkIndex": item.get("chunkIndex"),
                "chunk_index": item.get("chunkIndex"),
                "content": item.get("content"),
                "fileId": item.get("fileId"),
                "file_id": item.get("fileId"),
                "filename": item.get("filename"),
                "file_path": item.get("path") or item.get("filePath"),
                "metadata": {
                    "path": item.get("path"),
                    "filePath": item.get("filePath"),
                },
            }
            for item in self.artifacts.load_chunk_entries(kb_id)
            if str(item.get("fileId") or "") == file.file_id
        ]
        chunks.sort(key=lambda item: int(item.get("chunkIndex") or 0))

        return {
            "file": self._serialize_file(file),
            "content": content,
            "chunks": chunks,
            "chunkCount": len(chunks) or int(file.processing_params.get("chunksCount") or 0),
        }

    def query_kb_for_agent(
        self,
        kb_id: str,
        query_text: str,
        *,
        file_name: str | None = None,
        limit: int = 6,
    ) -> dict[str, Any]:
        return self.query_service.query_kb_for_agent(kb_id, query_text, file_name=file_name, limit=limit)

    def get_mindmap_text(self, kb_id: str) -> str:
        return self.eval_service.get_mindmap_text(kb_id)
