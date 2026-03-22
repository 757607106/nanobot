"""Minimal pymilvus backend for the knowledge workspace."""

from __future__ import annotations

import json
from threading import Lock
from typing import Any, Callable


class MilvusBackendError(RuntimeError):
    """Raised when the Milvus backend cannot satisfy a request."""


class MilvusKnowledgeBackend:
    """Per-knowledge-base Milvus Lite storage with a single chunks collection."""

    _COLLECTION_NAME = "knowledge_chunks"

    def __init__(self, uri_factory: Callable[[str], str]) -> None:
        self._uri_factory = uri_factory
        self._lock = Lock()
        self._clients: dict[str, Any] = {}

    @staticmethod
    def collection_name() -> str:
        return MilvusKnowledgeBackend._COLLECTION_NAME

    @staticmethod
    def ensure_runtime() -> None:
        try:
            from pymilvus import DataType, MilvusClient  # noqa: F401
        except ImportError as exc:  # pragma: no cover - guarded by runtime validation
            raise MilvusBackendError("Milvus support requires pymilvus[milvus_lite].") from exc

    def close_all(self) -> None:
        with self._lock:
            clients = list(self._clients.values())
            self._clients.clear()
        for client in clients:
            try:
                client.close()
            except Exception as exc:  # pragma: no cover - defensive close
                raise MilvusBackendError("Failed to close Milvus client.") from exc

    def close_kb(self, kb_id: str) -> None:
        with self._lock:
            client = self._clients.pop(kb_id, None)
        if client is None:
            return
        client.close()

    def get_client(self, kb_id: str) -> Any:
        self.ensure_runtime()
        from pymilvus import MilvusClient

        with self._lock:
            client = self._clients.get(kb_id)
            if client is None:
                client = MilvusClient(uri=self._uri_factory(kb_id))
                self._clients[kb_id] = client
            return client

    def ensure_collection(self, kb_id: str, *, dimension: int) -> None:
        self.ensure_runtime()
        from pymilvus import DataType

        client = self.get_client(kb_id)
        collection_name = self.collection_name()
        expected_dim = max(1, int(dimension))
        if client.has_collection(collection_name=collection_name):
            description = client.describe_collection(collection_name=collection_name)
            fields = {
                str(field.get("name") or ""): dict(field)
                for field in (description.get("fields") or [])
                if isinstance(field, dict)
            }
            required = {"id", "fileId", "filename", "path", "chunkIndex", "content", "tokensJson", "embedding"}
            embedding_params = dict(fields.get("embedding", {}).get("params") or {})
            existing_dim = int(embedding_params.get("dim") or 0)
            if required.issubset(fields) and existing_dim == expected_dim:
                return
            client.drop_collection(collection_name=collection_name)

        schema = client.create_schema(auto_id=False, enable_dynamic_field=False)
        schema.add_field(field_name="id", datatype=DataType.VARCHAR, is_primary=True, max_length=128)
        schema.add_field(field_name="fileId", datatype=DataType.VARCHAR, max_length=128)
        schema.add_field(field_name="filename", datatype=DataType.VARCHAR, max_length=512)
        schema.add_field(field_name="path", datatype=DataType.VARCHAR, max_length=1024)
        schema.add_field(field_name="chunkIndex", datatype=DataType.INT64)
        schema.add_field(field_name="content", datatype=DataType.VARCHAR, max_length=65535)
        schema.add_field(field_name="tokensJson", datatype=DataType.VARCHAR, max_length=16384)
        schema.add_field(field_name="embedding", datatype=DataType.FLOAT_VECTOR, dim=expected_dim)
        index_params = client.prepare_index_params()
        index_params.add_index(
            field_name="embedding",
            metric_type="COSINE",
            index_type="AUTOINDEX",
            index_name="embedding_index",
        )
        client.create_collection(
            collection_name=collection_name,
            schema=schema,
            index_params=index_params,
        )

    def replace_entries(self, kb_id: str, entries: list[dict[str, Any]]) -> None:
        client = self.get_client(kb_id)
        collection_name = self.collection_name()
        if client.has_collection(collection_name=collection_name):
            client.drop_collection(collection_name=collection_name)
        if not entries:
            return
        self.upsert_entries(kb_id, entries)

    def upsert_entries(self, kb_id: str, entries: list[dict[str, Any]]) -> None:
        if not entries:
            return
        self.ensure_collection(kb_id, dimension=len(list(entries[0].get("embedding") or [])))
        client = self.get_client(kb_id)
        client.insert(
            collection_name=self.collection_name(),
            data=[self._serialize_entry(item) for item in entries],
        )

    def list_entries(self, kb_id: str) -> list[dict[str, Any]]:
        client = self.get_client(kb_id)
        collection_name = self.collection_name()
        if not client.has_collection(collection_name=collection_name):
            return []

        iterator = client.query_iterator(
            collection_name=collection_name,
            batch_size=512,
            limit=-1,
            filter='id != ""',
            output_fields=["id", "fileId", "filename", "path", "chunkIndex", "content", "tokensJson"],
        )
        try:
            rows: list[dict[str, Any]] = []
            while True:
                batch = list(iterator.next())
                if not batch:
                    break
                rows.extend(self._deserialize_entry(item) for item in batch)
        finally:
            iterator.close()
        rows.sort(
            key=lambda item: (
                str(item.get("fileId") or ""),
                int(item.get("chunkIndex") or 0),
                str(item.get("chunkId") or ""),
            )
        )
        return rows

    def search_entries(
        self,
        kb_id: str,
        query_embedding: list[float],
        *,
        chunk_ids: list[str] | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        if not query_embedding:
            return []
        self.ensure_collection(kb_id, dimension=len(query_embedding))
        client = self.get_client(kb_id)
        collection_name = self.collection_name()
        if not client.has_collection(collection_name=collection_name):
            return []

        filter_expr = ""
        normalized_ids = [str(item).strip() for item in (chunk_ids or []) if str(item).strip()]
        if normalized_ids:
            quoted = ", ".join(json.dumps(item, ensure_ascii=False) for item in normalized_ids)
            filter_expr = f"id in [{quoted}]"
        raw_hits = client.search(
            collection_name=collection_name,
            data=[query_embedding],
            filter=filter_expr,
            limit=max(1, int(limit)),
            output_fields=["fileId", "filename", "path", "chunkIndex", "content", "tokensJson"],
        )
        results: list[dict[str, Any]] = []
        for hit in raw_hits[0] if raw_hits else []:
            entity = dict(hit.get("entity") or {})
            entry = self._deserialize_entry(
                {
                    "id": hit.get("id") or entity.get("id"),
                    **entity,
                }
            )
            score = float(
                hit.get("distance")
                if hit.get("distance") is not None
                else hit.get("score") or 0.0
            )
            entry["score"] = score
            entry["similarity"] = score
            results.append(entry)
        return results

    def delete_file_entries(self, kb_id: str, file_id: str) -> None:
        client = self.get_client(kb_id)
        collection_name = self.collection_name()
        if not client.has_collection(collection_name=collection_name):
            return
        client.delete(
            collection_name=collection_name,
            filter=f"fileId == {json.dumps(str(file_id), ensure_ascii=False)}",
        )

    @staticmethod
    def _serialize_entry(item: dict[str, Any]) -> dict[str, Any]:
        tokens = item.get("tokens") or []
        return {
            "id": str(item.get("chunkId") or item.get("id") or ""),
            "fileId": str(item.get("fileId") or "")[:128],
            "filename": str(item.get("filename") or "")[:512],
            "path": str(item.get("filePath") or item.get("path") or "")[:1024],
            "chunkIndex": int(item.get("chunkIndex") or 0),
            "content": str(item.get("content") or "")[:65535],
            "tokensJson": json.dumps(list(tokens), ensure_ascii=False)[:16384],
            "embedding": [float(value) for value in list(item.get("embedding") or [])],
        }

    @staticmethod
    def _deserialize_entry(item: dict[str, Any]) -> dict[str, Any]:
        tokens_text = str(item.get("tokensJson") or "[]")
        try:
            tokens = json.loads(tokens_text)
        except json.JSONDecodeError:
            tokens = []
        if not isinstance(tokens, list):
            tokens = []
        chunk_id = str(item.get("id") or item.get("chunkId") or "")
        path = str(item.get("path") or item.get("filePath") or "")
        return {
            "chunkId": chunk_id,
            "fileId": str(item.get("fileId") or ""),
            "filename": str(item.get("filename") or ""),
            "path": path,
            "filePath": path,
            "chunkIndex": int(item.get("chunkIndex") or 0),
            "content": str(item.get("content") or ""),
            "tokens": [str(token) for token in tokens if str(token).strip()],
        }
