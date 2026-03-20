"""Milvus-backed vector storage for knowledge chunks."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


class VectorStoreUnavailableError(RuntimeError):
    """Raised when the configured vector store cannot be used."""


@dataclass(slots=True)
class VectorSearchHit:
    chunk_id: str
    score: float


class MilvusVectorStore:
    """Thin wrapper around pymilvus for per-knowledge-base chunk vectors."""

    def __init__(
        self,
        *,
        uri: str | None = None,
        token: str | None = None,
        db_name: str | None = None,
    ) -> None:
        self.uri = uri or os.getenv("NANOBOT_MILVUS_URI", "http://127.0.0.1:19530")
        self.token = token or os.getenv("NANOBOT_MILVUS_TOKEN")
        self.db_name = db_name or os.getenv("NANOBOT_MILVUS_DB_NAME")
        self._client: Any | None = None

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            from pymilvus import MilvusClient
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreUnavailableError(
                "pymilvus is not installed. Add the Milvus dependency before using kbBackend=milvus.",
            ) from exc
        kwargs: dict[str, Any] = {"uri": self.uri}
        if self.token:
            kwargs["token"] = self.token
        if self.db_name:
            kwargs["db_name"] = self.db_name
        try:
            self._client = MilvusClient(**kwargs)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreUnavailableError(f"Failed to connect to Milvus at {self.uri}: {exc}") from exc
        return self._client

    def _ensure_collection(self, collection_name: str, *, dimension: int) -> None:
        client = self._get_client()
        try:
            has_collection = bool(client.has_collection(collection_name=collection_name))
        except TypeError:
            has_collection = bool(client.has_collection(collection_name))
        if has_collection:
            return
        try:
            from pymilvus import DataType
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreUnavailableError("pymilvus DataType is unavailable.") from exc

        schema = client.create_schema(auto_id=False, enable_dynamic_field=False)
        schema.add_field(field_name="chunk_id", datatype=DataType.VARCHAR, is_primary=True, max_length=255)
        schema.add_field(field_name="doc_id", datatype=DataType.VARCHAR, max_length=255)
        schema.add_field(field_name="kb_id", datatype=DataType.VARCHAR, max_length=255)
        schema.add_field(field_name="ordinal", datatype=DataType.INT64)
        schema.add_field(field_name="embedding", datatype=DataType.FLOAT_VECTOR, dim=dimension)

        index_params = client.prepare_index_params()
        index_params.add_index(field_name="embedding", index_type="AUTOINDEX", metric_type="COSINE")
        client.create_collection(
            collection_name=collection_name,
            schema=schema,
            index_params=index_params,
        )

    def _flush_collection(self, collection_name: str) -> None:
        client = self._get_client()
        try:
            client.flush(collection_name=collection_name)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreUnavailableError(
                f"Failed to flush Milvus collection '{collection_name}': {exc}",
            ) from exc

    def replace_document_chunks(
        self,
        *,
        collection_name: str,
        kb_id: str,
        doc_id: str,
        vectors: list[dict[str, Any]],
    ) -> None:
        if not vectors:
            return
        dimension = len(vectors[0]["embedding"])
        self._ensure_collection(collection_name, dimension=dimension)
        client = self._get_client()
        try:
            client.delete(collection_name=collection_name, filter=f'doc_id == "{doc_id}"')
        except Exception:
            # Best effort delete before reinsert; stale duplicates are still prevented by PK chunk_id.
            pass
        payload = [
            {
                "chunk_id": item["chunk_id"],
                "doc_id": doc_id,
                "kb_id": kb_id,
                "ordinal": int(item["ordinal"]),
                "embedding": list(item["embedding"]),
            }
            for item in vectors
        ]
        client.upsert(collection_name=collection_name, data=payload)
        self._flush_collection(collection_name)

    def delete_document(self, *, collection_name: str, doc_id: str) -> None:
        client = self._get_client()
        try:
            client.delete(collection_name=collection_name, filter=f'doc_id == "{doc_id}"')
            self._flush_collection(collection_name)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreUnavailableError(f"Failed to delete Milvus document vectors: {exc}") from exc

    def delete_collection(self, *, collection_name: str) -> None:
        client = self._get_client()
        try:
            has_collection = bool(client.has_collection(collection_name=collection_name))
        except TypeError:
            has_collection = bool(client.has_collection(collection_name))
        if not has_collection:
            return
        client.drop_collection(collection_name=collection_name)

    def search(
        self,
        *,
        collection_name: str,
        vector: list[float],
        limit: int,
    ) -> list[VectorSearchHit]:
        client = self._get_client()
        try:
            has_collection = bool(client.has_collection(collection_name=collection_name))
        except TypeError:
            has_collection = bool(client.has_collection(collection_name))
        if not has_collection:
            return []
        raw = client.search(
            collection_name=collection_name,
            data=[vector],
            anns_field="embedding",
            limit=limit,
            output_fields=["chunk_id", "doc_id", "kb_id", "ordinal"],
        )
        hits = raw[0] if raw else []
        results: list[VectorSearchHit] = []
        for hit in hits:
            if hasattr(hit, "to_dict"):
                payload = hit.to_dict()
            elif isinstance(hit, dict):
                payload = hit
            else:
                payload = {}
            entity = payload.get("entity") if isinstance(payload, dict) else None
            chunk_id = ""
            if isinstance(entity, dict):
                chunk_id = str(entity.get("chunk_id") or "").strip()
            if not chunk_id:
                chunk_id = str(
                    payload.get("id")
                    or payload.get("chunk_id")
                    or getattr(hit, "id", "")
                    or "",
                ).strip()
            if not chunk_id:
                continue
            score_value = (
                payload.get("distance")
                or payload.get("score")
                or getattr(hit, "distance", None)
                or getattr(hit, "score", None)
                or 0.0
            )
            score = float(score_value)
            results.append(VectorSearchHit(chunk_id=chunk_id, score=score))
        return results
