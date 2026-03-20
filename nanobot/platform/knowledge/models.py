"""Knowledge-base models for the first enterprise KB slice."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from nanobot.platform.model_resources.models import ModelSelection


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class KnowledgeDocumentStatus(StrEnum):
    UPLOADED = "uploaded"
    PARSING = "parsing"
    PARSED = "parsed"
    INDEXING = "indexing"
    INDEXED = "indexed"
    ERROR_PARSING = "error_parsing"
    ERROR_INDEXING = "error_indexing"


class KnowledgeJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(slots=True)
class KnowledgeRetrievalProfile:
    mode: str = "hybrid"
    top_k: int = 8
    chunk_top_k: int = 20
    chunk_size: int = 800
    chunk_overlap: int = 120
    citation_required: bool = True
    rerank_enabled: bool = False
    metadata_filters: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "KnowledgeRetrievalProfile":
        payload = payload or {}
        return cls(
            mode=str(payload.get("mode") or "hybrid").strip() or "hybrid",
            top_k=max(1, int(payload.get("top_k") or payload.get("topK") or 8)),
            chunk_top_k=max(1, int(payload.get("chunk_top_k") or payload.get("chunkTopK") or 20)),
            chunk_size=max(200, int(payload.get("chunk_size") or payload.get("chunkSize") or 800)),
            chunk_overlap=max(0, int(payload.get("chunk_overlap") or payload.get("chunkOverlap") or 120)),
            citation_required=bool(
                payload.get("citation_required")
                if "citation_required" in payload
                else payload.get("citationRequired", True)
            ),
            rerank_enabled=bool(
                payload.get("rerank_enabled")
                if "rerank_enabled" in payload
                else payload.get("rerankEnabled", False)
            ),
            metadata_filters=dict(
                payload.get("metadata_filters") or payload.get("metadataFilters") or {}
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["topK"] = payload.pop("top_k")
        payload["chunkTopK"] = payload.pop("chunk_top_k")
        payload["chunkSize"] = payload.pop("chunk_size")
        payload["chunkOverlap"] = payload.pop("chunk_overlap")
        payload["citationRequired"] = payload.pop("citation_required")
        payload["rerankEnabled"] = payload.pop("rerank_enabled")
        payload["metadataFilters"] = payload.pop("metadata_filters")
        return payload


@dataclass(slots=True)
class KnowledgeBaseDefinition:
    kb_id: str
    tenant_id: str
    instance_id: str
    name: str
    description: str = ""
    enabled: bool = True
    tags: list[str] = field(default_factory=list)
    kb_backend: str = "sqlite"
    embedding_model_selection: ModelSelection | None = None
    reranker_model_selection: ModelSelection | None = None
    auto_index_after_parse: bool = True
    vector_collection: str | None = None
    legacy_config: bool = False
    reindex_required: bool = False
    reindex_reason: str | None = None
    retrieval_profile: KnowledgeRetrievalProfile = field(default_factory=KnowledgeRetrievalProfile)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        return json.dumps(
            {
                "description": self.description,
                "tags": self.tags,
                "kb_backend": self.kb_backend,
                "embedding_model_selection": (
                    self.embedding_model_selection.to_storage_dict() if self.embedding_model_selection else None
                ),
                "reranker_model_selection": (
                    self.reranker_model_selection.to_storage_dict() if self.reranker_model_selection else None
                ),
                "auto_index_after_parse": self.auto_index_after_parse,
                "vector_collection": self.vector_collection,
                "legacy_config": self.legacy_config,
                "reindex_required": self.reindex_required,
                "reindex_reason": self.reindex_reason,
                "retrieval_profile": self.retrieval_profile.to_dict(),
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "KnowledgeBaseDefinition":
        stored = json.loads(record["config_json"])
        return cls(
            kb_id=record["kb_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            name=record["name"],
            description=stored.get("description", ""),
            enabled=bool(record.get("enabled", True)),
            tags=list(stored.get("tags") or []),
            kb_backend=str(stored.get("kb_backend") or stored.get("kbBackend") or "sqlite"),
            embedding_model_selection=ModelSelection.from_dict(
                stored.get("embedding_model_selection") or stored.get("embeddingModelSelection"),
                default_capability="embedding",
            ),
            reranker_model_selection=ModelSelection.from_dict(
                stored.get("reranker_model_selection") or stored.get("rerankerModelSelection"),
                default_capability="reranker",
            ),
            auto_index_after_parse=bool(
                stored.get("auto_index_after_parse")
                if "auto_index_after_parse" in stored
                else stored.get("autoIndexAfterParse", True)
            ),
            vector_collection=stored.get("vector_collection") or stored.get("vectorCollection"),
            legacy_config=bool(
                stored.get("legacy_config")
                if "legacy_config" in stored
                else stored.get("legacyConfig")
                if "legacyConfig" in stored
                else not any(
                    key in stored
                    for key in (
                        "kb_backend",
                        "kbBackend",
                        "auto_index_after_parse",
                        "autoIndexAfterParse",
                        "vector_collection",
                        "vectorCollection",
                        "reindex_required",
                        "reindexRequired",
                    )
                )
            ),
            reindex_required=bool(
                stored.get("reindex_required")
                if "reindex_required" in stored
                else stored.get("reindexRequired", False)
            ),
            reindex_reason=stored.get("reindex_reason") or stored.get("reindexReason"),
            retrieval_profile=KnowledgeRetrievalProfile.from_dict(stored.get("retrieval_profile")),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["kbId"] = payload.pop("kb_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload.pop("retrieval_profile", None)
        payload["kbBackend"] = payload.pop("kb_backend")
        payload.pop("embedding_model_selection", None)
        payload["embeddingModelSelection"] = (
            self.embedding_model_selection.to_dict() if self.embedding_model_selection else None
        )
        payload.pop("reranker_model_selection", None)
        payload["rerankerModelSelection"] = (
            self.reranker_model_selection.to_dict() if self.reranker_model_selection else None
        )
        payload["autoIndexAfterParse"] = payload.pop("auto_index_after_parse")
        payload["vectorCollection"] = payload.pop("vector_collection")
        payload["legacyConfig"] = payload.pop("legacy_config")
        payload["reindexRequired"] = payload.pop("reindex_required")
        payload["reindexReason"] = payload.pop("reindex_reason")
        payload["retrievalProfile"] = self.retrieval_profile.to_dict()
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload


@dataclass(slots=True)
class KnowledgeDocument:
    doc_id: str
    kb_id: str
    tenant_id: str
    instance_id: str
    source_type: str
    title: str
    source_id: str | None = None
    mime_type: str | None = None
    file_name: str | None = None
    source_uri: str | None = None
    file_path: str | None = None
    parsed_path: str | None = None
    checksum: str | None = None
    parser_name: str | None = None
    doc_status: KnowledgeDocumentStatus = KnowledgeDocumentStatus.UPLOADED
    chunk_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)
    error_summary: str | None = None
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "KnowledgeDocument":
        return cls(
            doc_id=record["doc_id"],
            kb_id=record["kb_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            source_id=record.get("source_id"),
            source_type=record["source_type"],
            title=record["title"],
            mime_type=record.get("mime_type"),
            file_name=record.get("file_name"),
            source_uri=record.get("source_uri"),
            file_path=record.get("file_path"),
            parsed_path=record.get("parsed_path"),
            checksum=record.get("checksum"),
            parser_name=record.get("parser_name"),
            doc_status=KnowledgeDocumentStatus(record.get("doc_status") or KnowledgeDocumentStatus.UPLOADED.value),
            chunk_count=int(record.get("chunk_count") or 0),
            metadata=json.loads(record.get("metadata_json") or "{}"),
            error_summary=record.get("error_summary"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["docId"] = payload.pop("doc_id")
        payload["kbId"] = payload.pop("kb_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["sourceId"] = payload.pop("source_id")
        payload["sourceType"] = payload.pop("source_type")
        payload["mimeType"] = payload.pop("mime_type")
        payload["fileName"] = payload.pop("file_name")
        payload["sourceUri"] = payload.pop("source_uri")
        payload["filePath"] = payload.pop("file_path")
        payload["parsedPath"] = payload.pop("parsed_path")
        payload["parserName"] = payload.pop("parser_name")
        payload.pop("doc_status", None)
        payload["docStatus"] = self.doc_status.value
        payload["chunkCount"] = payload.pop("chunk_count")
        payload["errorSummary"] = payload.pop("error_summary")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload


@dataclass(slots=True)
class KnowledgeIngestJob:
    job_id: str
    tenant_id: str
    instance_id: str
    kb_id: str
    doc_id: str
    status: KnowledgeJobStatus
    track_id: str
    error_summary: str | None = None
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "KnowledgeIngestJob":
        return cls(
            job_id=record["job_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            kb_id=record["kb_id"],
            doc_id=record["doc_id"],
            status=KnowledgeJobStatus(record["status"]),
            track_id=record["track_id"],
            error_summary=record.get("error_summary"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["jobId"] = payload.pop("job_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["kbId"] = payload.pop("kb_id")
        payload["docId"] = payload.pop("doc_id")
        payload["status"] = self.status.value
        payload["trackId"] = payload.pop("track_id")
        payload["errorSummary"] = payload.pop("error_summary")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload


@dataclass(slots=True)
class KnowledgeSource:
    source_id: str
    kb_id: str
    tenant_id: str
    instance_id: str
    source_type: str
    title: str
    enabled: bool = True
    source_uri: str | None = None
    latest_doc_id: str | None = None
    sync_count: int = 0
    last_synced_at: str | None = None
    config: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "KnowledgeSource":
        return cls(
            source_id=record["source_id"],
            kb_id=record["kb_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            source_type=record["source_type"],
            title=record["title"],
            enabled=bool(record.get("enabled", True)),
            source_uri=record.get("source_uri"),
            latest_doc_id=record.get("latest_doc_id"),
            sync_count=int(record.get("sync_count") or 0),
            last_synced_at=record.get("last_synced_at"),
            config=json.loads(record.get("config_json") or "{}"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["sourceId"] = payload.pop("source_id")
        payload["kbId"] = payload.pop("kb_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["sourceType"] = payload.pop("source_type")
        payload["sourceUri"] = payload.pop("source_uri")
        payload["latestDocId"] = payload.pop("latest_doc_id")
        payload["syncCount"] = payload.pop("sync_count")
        payload["lastSyncedAt"] = payload.pop("last_synced_at")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload

    def to_storage_json(self) -> str:
        return json.dumps(self.config, ensure_ascii=False)
