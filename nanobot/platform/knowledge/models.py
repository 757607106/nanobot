"""Knowledge-base models aligned with the Yuxi-Know style data shape."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class KnowledgeDocumentStatus(StrEnum):
    UPLOADED = "uploaded"
    PARSING = "parsing"
    PARSED = "parsed"
    INDEXING = "indexing"
    INDEXED = "indexed"
    FOLDER = "folder"
    ERROR_PARSING = "error_parsing"
    ERROR_INDEXING = "error_indexing"


class KnowledgeJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(slots=True)
class KnowledgeQueryParams:
    mode: str = "mix"
    top_k: int = 10
    chunk_top_k: int = 12
    response_type: str = "Multiple Paragraphs"
    only_need_context: bool = True
    only_need_prompt: bool = False
    enable_rerank: bool = False
    rerank_model: str | None = None
    options: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(
        cls,
        payload: dict[str, Any] | None,
        *,
        defaults: dict[str, Any] | None = None,
    ) -> "KnowledgeQueryParams":
        base = dict(defaults or {})
        data = {
            **base,
            **dict(payload or {}),
        }
        known_keys = {
            "mode",
            "top_k",
            "chunk_top_k",
            "response_type",
            "only_need_context",
            "only_need_prompt",
            "enable_rerank",
            "rerank_model",
            "options",
        }
        extra_options = {
            key: value
            for key, value in data.items()
            if key not in known_keys and value is not None
        }
        options = {
            **dict(base.get("options") or {}),
            **dict(data.get("options") or {}),
        }
        options.update(extra_options)
        raw_mode = str(data.get("mode") or "mix").strip() or "mix"
        normalized_mode = {
            "vector": "mix",
            "keyword": "naive",
            "semantic": "local",
        }.get(raw_mode.lower(), raw_mode)
        return cls(
            mode=normalized_mode,
            top_k=max(1, int(data.get("top_k") or 10)),
            chunk_top_k=max(1, int(data.get("chunk_top_k") or 12)),
            response_type=str(data.get("response_type") or "Multiple Paragraphs").strip()
            or "Multiple Paragraphs",
            only_need_context=bool(data.get("only_need_context", True)),
            only_need_prompt=bool(data.get("only_need_prompt", False)),
            enable_rerank=bool(data.get("enable_rerank", False)),
            rerank_model=str(data.get("rerank_model") or "").strip() or None,
            options=options,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "top_k": self.top_k,
            "chunk_top_k": self.chunk_top_k,
            "response_type": self.response_type,
            "only_need_context": self.only_need_context,
            "only_need_prompt": self.only_need_prompt,
            "enable_rerank": self.enable_rerank,
            "rerank_model": self.rerank_model,
            "options": dict(self.options),
        }


KnowledgeRetrievalProfile = KnowledgeQueryParams


KNOWLEDGE_ARCHITECTURE_TYPE = "lightrag"


def default_query_params_payload() -> dict[str, Any]:
    return {
        "mode": "mix",
        "top_k": 10,
        "chunk_top_k": 12,
        "response_type": "Multiple Paragraphs",
        "only_need_context": True,
        "only_need_prompt": False,
        "enable_rerank": False,
        "options": {},
    }
@dataclass(slots=True)
class KnowledgeBaseDefinition:
    kb_id: str
    tenant_id: str
    instance_id: str
    name: str
    description: str = ""
    enabled: bool = True
    kb_type: str = KNOWLEDGE_ARCHITECTURE_TYPE
    embed_info: dict[str, Any] = field(default_factory=dict)
    llm_info: dict[str, Any] = field(default_factory=dict)
    query_params: KnowledgeQueryParams = field(default_factory=KnowledgeQueryParams)
    additional_params: dict[str, Any] = field(default_factory=dict)
    share_config: dict[str, Any] = field(default_factory=dict)
    mindmap: dict[str, Any] | None = None
    sample_questions: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        return json.dumps(
            {
                "description": self.description,
                "kb_type": KNOWLEDGE_ARCHITECTURE_TYPE,
                "embed_info": self.embed_info,
                "llm_info": self.llm_info,
                "query_params": self.query_params.to_dict(),
                "additional_params": self.additional_params,
                "share_config": self.share_config,
                "mindmap": self.mindmap,
                "sample_questions": self.sample_questions,
                "tags": self.tags,
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "KnowledgeBaseDefinition":
        stored = json.loads(record.get("config_json") or "{}")
        kb_type = KNOWLEDGE_ARCHITECTURE_TYPE
        return cls(
            kb_id=record["kb_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            name=record["name"],
            description=str(stored.get("description") or ""),
            enabled=bool(record.get("enabled", True)),
            kb_type=kb_type,
            embed_info=dict(stored.get("embed_info") or stored.get("embedInfo") or {}),
            llm_info=dict(stored.get("llm_info") or stored.get("llmInfo") or {}),
            query_params=KnowledgeQueryParams.from_dict(
                stored.get("query_params"),
                defaults=default_query_params_payload(),
            ),
            additional_params=dict(
                stored.get("additional_params") or stored.get("additionalParams") or {}
            ),
            share_config=dict(stored.get("share_config") or stored.get("shareConfig") or {}),
            mindmap=stored.get("mindmap"),
            sample_questions=[str(item).strip() for item in (stored.get("sample_questions") or stored.get("sampleQuestions") or []) if str(item).strip()],
            tags=[str(item).strip() for item in (stored.get("tags") or []) if str(item).strip()],
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "kbId": self.kb_id,
            "dbId": self.kb_id,
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "name": self.name,
            "description": self.description,
            "enabled": self.enabled,
            "kbType": KNOWLEDGE_ARCHITECTURE_TYPE,
            "embedInfo": dict(self.embed_info),
            "llmInfo": dict(self.llm_info),
            "query_params": self.query_params.to_dict(),
            "additionalParams": dict(self.additional_params),
            "shareConfig": dict(self.share_config),
            "mindmap": self.mindmap,
            "sampleQuestions": list(self.sample_questions),
            "tags": list(self.tags),
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


@dataclass(slots=True)
class KnowledgeFile:
    file_id: str
    kb_id: str
    tenant_id: str
    instance_id: str
    parent_id: str | None
    filename: str
    original_filename: str | None = None
    file_type: str = "file"
    path: str = "/"
    raw_path: str | None = None
    markdown_file: str | None = None
    status: KnowledgeDocumentStatus = KnowledgeDocumentStatus.UPLOADED
    content_hash: str | None = None
    file_size: int = 0
    content_type: str | None = None
    processing_params: dict[str, Any] = field(default_factory=dict)
    is_folder: bool = False
    error_message: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "KnowledgeFile":
        status_value = record.get("status") or (
            KnowledgeDocumentStatus.FOLDER.value if record.get("is_folder") else KnowledgeDocumentStatus.UPLOADED.value
        )
        return cls(
            file_id=record["file_id"],
            kb_id=record["kb_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            parent_id=record.get("parent_id"),
            filename=record["filename"],
            original_filename=record.get("original_filename"),
            file_type=record.get("file_type") or "file",
            path=record.get("path") or "/",
            raw_path=record.get("raw_path"),
            markdown_file=record.get("markdown_file"),
            status=KnowledgeDocumentStatus(status_value),
            content_hash=record.get("content_hash"),
            file_size=int(record.get("file_size") or 0),
            content_type=record.get("content_type"),
            processing_params=json.loads(record.get("processing_params_json") or "{}"),
            is_folder=bool(record.get("is_folder")),
            error_message=record.get("error_message"),
            created_by=record.get("created_by"),
            updated_by=record.get("updated_by"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_processing_params_json(self) -> str:
        return json.dumps(self.processing_params, ensure_ascii=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "fileId": self.file_id,
            "docId": self.file_id,
            "kbId": self.kb_id,
            "dbId": self.kb_id,
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "parentId": self.parent_id,
            "filename": self.filename,
            "title": self.filename,
            "originalFilename": self.original_filename,
            "fileType": self.file_type,
            "path": self.path,
            "rawPath": self.raw_path,
            "filePath": self.raw_path,
            "markdownFile": self.markdown_file,
            "parsedPath": self.markdown_file,
            "status": self.status.value,
            "docStatus": self.status.value,
            "contentHash": self.content_hash,
            "checksum": self.content_hash,
            "fileSize": self.file_size,
            "chunkCount": int(self.processing_params.get("chunksCount") or 0),
            "contentType": self.content_type,
            "mimeType": self.content_type,
            "processingParams": dict(self.processing_params),
            "metadata": dict(self.processing_params),
            "isFolder": self.is_folder,
            "errorMessage": self.error_message,
            "errorSummary": self.error_message,
            "createdBy": self.created_by,
            "updatedBy": self.updated_by,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


KnowledgeDocument = KnowledgeFile
KnowledgeSource = KnowledgeFile


@dataclass(slots=True)
class KnowledgeJob:
    job_id: str
    tenant_id: str
    instance_id: str
    kb_id: str
    job_kind: str
    target_file_ids: list[str]
    status: KnowledgeJobStatus
    track_id: str
    error_summary: str | None = None
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "KnowledgeJob":
        return cls(
            job_id=record["job_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            kb_id=record["kb_id"],
            job_kind=str(record.get("job_kind") or "ingest"),
            target_file_ids=[str(item) for item in json.loads(record.get("target_file_ids_json") or "[]")],
            status=KnowledgeJobStatus(record["status"]),
            track_id=record["track_id"],
            error_summary=record.get("error_summary"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "kbId": self.kb_id,
            "dbId": self.kb_id,
            "jobKind": self.job_kind,
            "targetFileIds": list(self.target_file_ids),
            "status": self.status.value,
            "trackId": self.track_id,
            "errorSummary": self.error_summary,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


KnowledgeIngestJob = KnowledgeJob
