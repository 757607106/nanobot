"""Knowledge query, retrieval, and answer synthesis service.

Extracted from KnowledgeBaseService (Phase 4) to encapsulate:
- Query parameter management
- LightRAG query orchestration
- Chunk enrichment / file-token filtering
- Answer synthesis from retrieval context
- Agent-facing fast-context retrieval
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from loguru import logger

from nanobot.platform.knowledge.models import (
    KnowledgeBaseDefinition,
    KnowledgeFile,
    KnowledgeQueryParams,
    KNOWLEDGE_ARCHITECTURE_TYPE,
    default_query_params_payload,
    now_iso,
)
from nanobot.platform.knowledge.store import KnowledgeBaseStore
from nanobot.platform.knowledge.service import (
    KnowledgeBaseNotFoundError,
    KnowledgeBaseValidationError,
)
from nanobot.platform.knowledge.utils import (
    DEFAULT_BEST_EFFORT_RETRIEVE_TIMEOUT_SECONDS,
    normalize_text,
    normalize_string_list,
)

if TYPE_CHECKING:
    from nanobot.platform.knowledge.artifacts import KnowledgeArtifactStore
    from nanobot.platform.knowledge.rag_engine import RAGEngine

_BEST_EFFORT_QUERY_TIMEOUT_KEY = "__best_effort_timeout_seconds__"


class KnowledgeQueryService:
    """Handles all knowledge-base query, retrieval, and answer synthesis."""

    def __init__(
        self,
        *,
        store: KnowledgeBaseStore,
        artifacts: KnowledgeArtifactStore,
        rag_engine: RAGEngine | None,
        run_async_fn: Any,
        require_kb_fn: Any,
        resolve_bound_kbs_fn: Any,
        extract_requested_file_ids_fn: Any,
        generate_with_llm_fn: Any,
        best_effort_timeout: float = DEFAULT_BEST_EFFORT_RETRIEVE_TIMEOUT_SECONDS,
    ) -> None:
        self.store = store
        self.artifacts = artifacts
        self.rag_engine = rag_engine
        self._run_async = run_async_fn
        self.require_kb = require_kb_fn
        self._resolve_bound_kbs = resolve_bound_kbs_fn
        self._extract_requested_file_ids = extract_requested_file_ids_fn
        self._generate_with_llm = generate_with_llm_fn
        self._best_effort_retrieve_timeout_seconds = best_effort_timeout

    # ── Internal helpers ───────────────────────────────────────────────────

    def _ensure_lightrag(self, kb: KnowledgeBaseDefinition, *, feature: str) -> None:
        if self.rag_engine is None:
            raise KnowledgeBaseValidationError(f"{feature} is unavailable because the RAG engine is not configured.")

    @staticmethod
    def _merge_query_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
        merged = dict(payload or {})
        meta = merged.pop("meta", None)
        if isinstance(meta, dict):
            return {**meta, **merged}
        return merged

    def _matching_file_tokens(self, kb_id: str, file_ids: list[str] | None = None, file_name: str | None = None) -> set[str]:
        tokens: set[str] = set()
        files = self.store.list_files(kb_id)
        for file in files:
            if file_ids and file.file_id not in set(file_ids):
                continue
            if file_name and file_name.lower() not in file.filename.lower():
                continue
            tokens.add(file.file_id)
            tokens.add(file.filename)
            if file.raw_path:
                tokens.add(file.raw_path)
                tokens.add(Path(file.raw_path).name)
        return {token for token in tokens if token}

    @staticmethod
    def _filter_query_result(raw: dict[str, Any], *, tokens: set[str]) -> dict[str, Any]:
        if not tokens:
            return raw
        result = json.loads(json.dumps(raw, ensure_ascii=False))
        data = result.get("data") or {}
        references = list(data.get("references") or [])
        filtered_references = [
            item for item in references
            if any(token in str(item.get("file_path") or "") or token == str(item.get("reference_id") or "") for token in tokens)
        ]
        reference_ids = {str(item.get("reference_id") or "") for item in filtered_references}
        filtered_chunks = [
            item for item in (data.get("chunks") or [])
            if str(item.get("reference_id") or "") in reference_ids
            or any(token in str(item.get("file_path") or "") for token in tokens)
        ]
        filtered_entities = [
            item for item in (data.get("entities") or [])
            if any(token in str(item.get("file_path") or "") for token in tokens)
            or any(token in str(item.get("source_id") or "") for token in tokens)
        ]
        filtered_relationships = [
            item for item in (data.get("relationships") or [])
            if any(token in str(item.get("file_path") or "") for token in tokens)
            or any(token in str(item.get("source_id") or "") for token in tokens)
        ]
        data["references"] = filtered_references
        data["chunks"] = filtered_chunks
        data["entities"] = filtered_entities
        data["relationships"] = filtered_relationships
        result["data"] = data
        result.setdefault("metadata", {})
        result["metadata"]["fileFilterApplied"] = True
        result["metadata"]["filteredReferenceCount"] = len(filtered_references)
        return result

    @staticmethod
    def _normalize_chunk_match_text(text: Any) -> str:
        return re.sub(r"\s+", " ", str(text or "").strip())

    @staticmethod
    def _has_meaningful_query_message(value: Any) -> bool:
        message = str(value or "").strip()
        if not message:
            return False
        normalized = re.sub(r"\s+", " ", message).strip().lower()
        if any(
            marker in normalized
            for marker in (
                "error calling llm",
                "llm error",
                "litellm.",
                "authentication fails",
                "invalid api key",
                "invalid_request_error",
                "deepseekexception",
                "openaierror",
                "badrequesterror",
            )
        ):
            return False
        return normalized not in {
            "query processed successfully",
            "query completed successfully",
            "retrieval completed successfully",
            "success",
            "ok",
        }

    def _match_chunk_entry(
        self,
        chunk: dict[str, Any],
        entries: list[dict[str, Any]],
        *,
        used_chunk_ids: set[str],
    ) -> dict[str, Any] | None:
        explicit_chunk_id = str(chunk.get("chunk_id") or chunk.get("chunkId") or "").strip()
        reference_tokens = {
            str(chunk.get("reference_id") or "").strip(),
            str(chunk.get("file_id") or chunk.get("fileId") or "").strip(),
            str(chunk.get("filename") or "").strip(),
            str(chunk.get("file_path") or "").strip(),
        }
        file_path = str(chunk.get("file_path") or "").strip()
        if file_path:
            reference_tokens.add(Path(file_path).name)
        reference_tokens = {item for item in reference_tokens if item}

        candidates = entries
        if reference_tokens:
            scoped = []
            for item in entries:
                item_tokens = {
                    str(item.get("chunkId") or "").strip(),
                    str(item.get("fileId") or "").strip(),
                    str(item.get("filename") or "").strip(),
                    str(item.get("path") or "").strip(),
                    str(item.get("filePath") or "").strip(),
                }
                item_path = str(item.get("filePath") or "").strip()
                if item_path:
                    item_tokens.add(Path(item_path).name)
                if any(token and any(token == candidate or token in candidate for candidate in item_tokens) for token in reference_tokens):
                    scoped.append(item)
            if scoped:
                candidates = scoped

        if explicit_chunk_id:
            for item in candidates:
                if str(item.get("chunkId") or "") == explicit_chunk_id:
                    return item

        query_text = self._normalize_chunk_match_text(chunk.get("content"))
        if not query_text:
            return candidates[0] if candidates else None
        query_terms = set(query_text.lower().split())

        best_item: dict[str, Any] | None = None
        best_score = -1
        for item in candidates:
            chunk_id = str(item.get("chunkId") or "")
            if chunk_id and chunk_id in used_chunk_ids:
                continue
            candidate_text = self._normalize_chunk_match_text(item.get("content"))
            score = 0
            if candidate_text == query_text:
                score += 1000
            elif query_text in candidate_text or candidate_text in query_text:
                score += 600 - abs(len(candidate_text) - len(query_text))
            score += len(query_terms & set(candidate_text.lower().split()))
            if score > best_score:
                best_score = score
                best_item = item
        return best_item

    def _enrich_query_chunks(self, kb_id: str, chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        entries = self.artifacts.load_chunk_entries(kb_id)
        if not entries:
            return chunks
        used_chunk_ids: set[str] = set()
        enriched: list[dict[str, Any]] = []
        for chunk in chunks:
            payload = dict(chunk)
            match = self._match_chunk_entry(payload, entries, used_chunk_ids=used_chunk_ids)
            if match is not None:
                matched_chunk_id = str(match.get("chunkId") or "")
                if matched_chunk_id:
                    used_chunk_ids.add(matched_chunk_id)
                file_id = str(match.get("fileId") or "")
                payload["chunk_id"] = matched_chunk_id
                payload["chunkId"] = matched_chunk_id
                payload["chunk_index"] = match.get("chunkIndex")
                payload["chunkIndex"] = match.get("chunkIndex")
                payload["file_id"] = file_id
                payload["fileId"] = file_id
                payload["filename"] = match.get("filename")
                payload["file_path"] = match.get("path") or match.get("filePath")
                payload["reference_id"] = file_id or str(payload.get("reference_id") or "")
                metadata = dict(payload.get("metadata") or {})
                metadata["chunk_id"] = matched_chunk_id
                metadata["file_id"] = file_id
                metadata["source"] = match.get("path") or match.get("filePath")
                payload["metadata"] = metadata
            enriched.append(payload)
        return enriched

    def _synthesize_answer_from_chunks(
        self,
        kb: KnowledgeBaseDefinition,
        query_text: str,
        chunks: list[dict[str, Any]],
    ) -> str | None:
        if not chunks:
            return None
        excerpts = [
            {
                "chunkId": item.get("chunk_id") or item.get("chunkId"),
                "file": item.get("file_path") or item.get("filename") or item.get("filePath"),
                "content": str(item.get("content") or "").strip()[:1600],
            }
            for item in chunks[:6]
        ]
        llm_answer = self._generate_with_llm(
            system_prompt=(
                "你是知识库问答助手。只能依据提供的检索片段回答。"
                "如果片段不足以支持结论，要明确说信息不足。"
            ),
            user_prompt=json.dumps(
                {
                    "knowledgeBase": kb.name,
                    "query": query_text,
                    "chunks": excerpts,
                },
                ensure_ascii=False,
            ),
        )
        if llm_answer:
            return llm_answer
        fallback = "\n\n".join(str(item.get("content") or "").strip() for item in chunks[:2]).strip()
        return fallback[:1600] if fallback else None

    # ── Query param management ─────────────────────────────────────────────

    def get_query_params(self, kb_id: str) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        return kb.query_params.to_dict()

    def get_query_param_schema(self, kb_id: str) -> dict[str, Any]:
        self.require_kb(kb_id)
        return {
            "type": "lightrag",
            "options": [
                {
                    "key": "mode",
                    "label": "检索模式",
                    "type": "select",
                    "default": "mix",
                    "options": [
                        {"value": "local", "label": "Local"},
                        {"value": "global", "label": "Global"},
                        {"value": "hybrid", "label": "Hybrid"},
                        {"value": "naive", "label": "Naive"},
                        {"value": "mix", "label": "Mix"},
                    ],
                },
                {
                    "key": "top_k",
                    "label": "TopK",
                    "type": "number",
                    "default": 10,
                    "min": 1,
                    "max": 100,
                },
                {
                    "key": "chunk_top_k",
                    "label": "Chunk TopK",
                    "type": "number",
                    "default": 12,
                    "min": 1,
                    "max": 100,
                },
                {
                    "key": "response_type",
                    "label": "回答格式",
                    "type": "select",
                    "default": "Multiple Paragraphs",
                    "options": [
                        {"value": "Single Paragraph", "label": "Single Paragraph"},
                        {"value": "Multiple Paragraphs", "label": "Multiple Paragraphs"},
                        {"value": "Bullet Points", "label": "Bullet Points"},
                    ],
                },
                {
                    "key": "only_need_context",
                    "label": "只返回上下文",
                    "type": "boolean",
                    "default": True,
                },
                {
                    "key": "only_need_prompt",
                    "label": "只返回提示词",
                    "type": "boolean",
                    "default": False,
                },
                {
                    "key": "enable_rerank",
                    "label": "启用重排",
                    "type": "boolean",
                    "default": False,
                },
            ],
        }

    def update_query_params(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        existing = kb.query_params.to_dict()
        merged_options = dict(kb.query_params.options)
        merged_payload: dict[str, Any] = {**existing, "options": merged_options}

        for key, value in dict(payload or {}).items():
            if key == "options" and isinstance(value, dict):
                merged_options.update(value)
                continue
            if value is None:
                continue
            if key in {
                "mode",
                "top_k",
                "chunk_top_k",
                "response_type",
                "only_need_context",
                "only_need_prompt",
                "enable_rerank",
                "rerank_model",
            }:
                merged_payload[key] = value
                continue
            merged_options[key] = value

        updated = self.store.update_kb(
            replace(
                kb,
                query_params=KnowledgeQueryParams.from_dict(
                    merged_payload,
                    defaults=default_query_params_payload(),
                ),
                updated_at=now_iso(),
            )
        )
        if updated is None:
            raise KnowledgeBaseNotFoundError(kb_id)
        return updated.query_params.to_dict()

    # ── Core query API ─────────────────────────────────────────────────────

    def query_database(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        merged_payload = self._merge_query_payload(payload)
        raw_timeout = merged_payload.pop(_BEST_EFFORT_QUERY_TIMEOUT_KEY, None)
        query_timeout: float | None = None
        if raw_timeout is not None:
            try:
                query_timeout = max(0.001, float(raw_timeout))
            except (TypeError, ValueError):
                query_timeout = None
        query_text = normalize_text(
            merged_payload.get("query"),
            required=True,
            field_name="query",
        )
        file_ids = self._extract_requested_file_ids(merged_payload) or []
        file_name = normalize_text(
            merged_payload.get("file_name"),
            field_name="file_name",
        ) or None
        params = KnowledgeQueryParams.from_dict(
            {
                **kb.query_params.to_dict(),
                **merged_payload,
            },
            defaults=default_query_params_payload(),
        )

        # Ensure RAG engine is available
        self._ensure_lightrag(kb, feature="Knowledge query")

        # Query via LightRAG Core (single path: vector + graph + rerank)
        lightrag_result = self._run_async(
            self.rag_engine.query_structured(
                kb_id,
                query_text,
                mode=params.mode,
                top_k=params.top_k,
                chunk_top_k=params.chunk_top_k,
                response_type=params.response_type,
                only_need_context=params.only_need_context,
                only_need_prompt=params.only_need_prompt,
                enable_rerank=params.enable_rerank,
                rerank_model=params.rerank_model,
                extra_query_params=params.options,
            ),
            timeout=query_timeout,
        )

        # Extract structured data
        lr_data = lightrag_result.get("data") or {}
        chunks = list(lr_data.get("chunks") or [])
        references = list(lr_data.get("references") or [])
        entities = list(lr_data.get("entities") or [])
        relationships = list(lr_data.get("relationships") or [])

        # Enrich and filter
        tokens = self._matching_file_tokens(kb_id, file_ids=file_ids or None, file_name=file_name)
        raw = {
            "data": {
                "chunks": chunks,
                "references": references,
                "entities": entities,
                "relationships": relationships,
            },
            "message": str(lightrag_result.get("message") or ""),
        }
        filtered = self._filter_query_result(raw, tokens=tokens)
        data = dict(filtered.get("data") or {})
        enriched_chunks = self._enrich_query_chunks(kb_id, list(data.get("chunks") or []))
        data["chunks"] = enriched_chunks
        references_map: dict[str, dict[str, Any]] = {}
        for ref in list(data.get("references") or []):
            ref_id = str(ref.get("reference_id") or "").strip()
            if ref_id:
                references_map[ref_id] = ref

        # Re-build references from enriched chunks
        for chunk in enriched_chunks:
            reference_id = str(chunk.get("reference_id") or chunk.get("file_id") or chunk.get("chunk_id") or "").strip()
            if not reference_id:
                continue
            references_map.setdefault(
                reference_id,
                {
                    "reference_id": reference_id,
                    "file_path": chunk.get("file_path"),
                    "file_name": chunk.get("filename"),
                },
            )
        data["references"] = list(references_map.values())
        data["entities"] = list(data.get("entities") or [])
        data["relationships"] = list(data.get("relationships") or [])
        filtered["data"] = data
        if (
            not self._has_meaningful_query_message(filtered.get("message"))
            and not params.only_need_context
            and not params.only_need_prompt
        ):
            filtered["message"] = self._synthesize_answer_from_chunks(kb, query_text, enriched_chunks)
        metadata = dict(filtered.get("metadata") or {})
        metadata["kbType"] = KNOWLEDGE_ARCHITECTURE_TYPE
        metadata["backend"] = "lightrag"
        metadata["mode"] = params.mode
        metadata["graphEnhanced"] = True
        filtered["metadata"] = metadata
        filtered["query"] = query_text
        filtered["query_params"] = params.to_dict()
        return filtered

    def retrieve(
        self,
        kb_ids: list[str],
        query: str,
        *,
        limit: int | None = None,
        filters: dict[str, Any] | None = None,
        requested_mode: str | None = None,
    ) -> dict[str, Any]:
        resolved = self._resolve_bound_kbs(kb_ids)
        if not query.strip():
            raise KnowledgeBaseValidationError("query is required.")
        files_by_kb = {
            item.kb_id: self.store.list_files(item.kb_id)
            for item in resolved
        }

        def _match_file(kb_id: str, file_path: str | None) -> KnowledgeFile | None:
            candidate = str(file_path or "")
            if not candidate:
                return None
            for item in files_by_kb.get(kb_id, []):
                if item.raw_path and candidate in {item.raw_path, Path(item.raw_path).name}:
                    return item
                if item.file_id in candidate or item.filename in candidate:
                    return item
            return None

        items: list[dict[str, Any]] = []
        effective_modes: list[str] = []
        for kb in resolved:
            resolved_mode = str(requested_mode or kb.query_params.mode or "mix").strip() or "mix"
            effective_modes.append(resolved_mode)
            try:
                query_result = self.query_database(
                    kb.kb_id,
                    {
                        "query": query,
                        "mode": resolved_mode,
                        "top_k": max(1, int(limit or 8)),
                        "only_need_context": True,
                        _BEST_EFFORT_QUERY_TIMEOUT_KEY: self._best_effort_retrieve_timeout_seconds,
                    },
                )
            except Exception as exc:
                logger.warning("Knowledge retrieve skipped for {}: {}", kb.kb_id, exc)
                continue
            for chunk in list((query_result.get("data") or {}).get("chunks") or [])[:max(1, int(limit or 8))]:
                file = _match_file(kb.kb_id, str(chunk.get("file_path") or ""))
                content = str(chunk.get("content") or "")
                items.append(
                    {
                        "kbId": kb.kb_id,
                        "kbName": kb.name,
                        "docId": file.file_id if file is not None else None,
                        "title": file.filename if file is not None else kb.name,
                        "content": content,
                        "preview": content[:280],
                        "score": float(chunk.get("score") or 0.0),
                        "metadata": {
                            "mode": query_result.get("metadata", {}).get("mode"),
                            "kb_id": kb.kb_id,
                            "file_path": chunk.get("file_path"),
                            "chunk_id": chunk.get("chunk_id"),
                        },
                        "citation": {
                            "kbId": kb.kb_id,
                            "kbName": kb.name,
                            "docId": file.file_id if file is not None else None,
                            "title": file.filename if file is not None else kb.name,
                            "sourceType": file.file_type if file is not None else "knowledge",
                            "sourceUri": (file.processing_params or {}).get("sourceUrl") if file is not None else None,
                            "fileName": file.filename if file is not None else None,
                            "mimeType": file.content_type if file is not None else None,
                            "chunkOrdinal": chunk.get("chunk_index") or chunk.get("chunkIndex"),
                        },
                    }
                )

        items.sort(key=lambda item: float(item.get("score") or 0.0), reverse=True)
        if limit:
            items = items[:max(1, int(limit))]

        return {
            "hits": items,
            "requestedMode": requested_mode or "auto",
            "effectiveMode": (
                effective_modes[0]
                if effective_modes and len(set(effective_modes)) == 1
                else (requested_mode or "mixed")
            ),
            "filters": dict(filters or {}),
        }

    def query_kb_for_agent(
        self,
        kb_id: str,
        query_text: str,
        *,
        file_name: str | None = None,
        limit: int = 6,
    ) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        resolved_mode = str(kb.query_params.mode or "mix").strip() or "mix"
        payload: dict[str, Any] = {
            "query": query_text,
            "top_k": limit,
            "chunk_top_k": max(12, limit),
            "mode": resolved_mode,
            "only_need_context": True,
        }
        if file_name:
            payload["file_name"] = file_name
        return self.query_database(kb_id, payload)
