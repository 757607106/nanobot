"""SQLite store for instance-scoped knowledge bases and chunk retrieval."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from nanobot.platform.knowledge.models import (
    KnowledgeBaseDefinition,
    KnowledgeDocument,
    KnowledgeIngestJob,
    KnowledgeSource,
)


class KnowledgeBaseStore:
    """Persist knowledge bases, documents, ingest jobs, and chunks in SQLite."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS knowledge_bases (
            kb_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_bases_tenant_instance
        ON knowledge_bases(tenant_id, instance_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS knowledge_documents (
            doc_id TEXT PRIMARY KEY,
            kb_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            source_id TEXT,
            source_type TEXT NOT NULL,
            title TEXT NOT NULL,
            mime_type TEXT,
            file_name TEXT,
            source_uri TEXT,
            file_path TEXT,
            parsed_path TEXT,
            checksum TEXT,
            parser_name TEXT,
            doc_status TEXT NOT NULL,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            error_summary TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb
        ON knowledge_documents(kb_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS knowledge_sources (
            source_id TEXT PRIMARY KEY,
            kb_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            title TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            source_uri TEXT,
            latest_doc_id TEXT,
            sync_count INTEGER NOT NULL DEFAULT 0,
            last_synced_at TEXT,
            config_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_sources_kb
        ON knowledge_sources(kb_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS knowledge_ingest_jobs (
            job_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            kb_id TEXT NOT NULL,
            doc_id TEXT NOT NULL,
            status TEXT NOT NULL,
            track_id TEXT NOT NULL,
            error_summary TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_ingest_jobs_kb
        ON knowledge_ingest_jobs(kb_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS knowledge_chunks (
            chunk_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            kb_id TEXT NOT NULL,
            doc_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc
        ON knowledge_chunks(doc_id, ordinal ASC);
    """

    _POST_MIGRATION_SCHEMA = """
        CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source
        ON knowledge_documents(source_id, updated_at DESC);
    """

    _CREATE_FTS = """
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
            chunk_id,
            kb_id UNINDEXED,
            doc_id UNINDEXED,
            tenant_id UNINDEXED,
            instance_id UNINDEXED,
            title,
            content,
            tokenize = 'unicode61'
        );
    """

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.fts_enabled = False
        self._init_tables()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_tables(self) -> None:
        conn = self._connect()
        conn.executescript(self._CREATE_SCHEMA)
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(knowledge_documents)").fetchall()
        }
        if "source_id" not in columns:
            conn.execute("ALTER TABLE knowledge_documents ADD COLUMN source_id TEXT")
        conn.executescript(self._POST_MIGRATION_SCHEMA)
        try:
            conn.executescript(self._CREATE_FTS)
            self.fts_enabled = True
        except sqlite3.DatabaseError:
            self.fts_enabled = False
        conn.commit()
        conn.close()

    @staticmethod
    def _deserialize_kb(row: sqlite3.Row | None) -> KnowledgeBaseDefinition | None:
        if row is None:
            return None
        return KnowledgeBaseDefinition.from_record(dict(row))

    @staticmethod
    def _deserialize_document(row: sqlite3.Row | None) -> KnowledgeDocument | None:
        if row is None:
            return None
        return KnowledgeDocument.from_record(dict(row))

    @staticmethod
    def _deserialize_job(row: sqlite3.Row | None) -> KnowledgeIngestJob | None:
        if row is None:
            return None
        return KnowledgeIngestJob.from_record(dict(row))

    @staticmethod
    def _deserialize_source(row: sqlite3.Row | None) -> KnowledgeSource | None:
        if row is None:
            return None
        return KnowledgeSource.from_record(dict(row))

    def get_kb(self, kb_id: str) -> KnowledgeBaseDefinition | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM knowledge_bases WHERE kb_id = ?", (kb_id,)).fetchone()
        conn.close()
        return self._deserialize_kb(row)

    def get_kb_by_name(self, name: str, *, tenant_id: str, instance_id: str) -> KnowledgeBaseDefinition | None:
        conn = self._connect()
        row = conn.execute(
            """
            SELECT * FROM knowledge_bases
            WHERE tenant_id = ? AND instance_id = ? AND name = ?
            """,
            (tenant_id, instance_id, name),
        ).fetchone()
        conn.close()
        return self._deserialize_kb(row)

    def list_kbs(self, *, tenant_id: str, instance_id: str, enabled: bool | None = None) -> list[KnowledgeBaseDefinition]:
        where = ["tenant_id = ?", "instance_id = ?"]
        values: list[Any] = [tenant_id, instance_id]
        if enabled is not None:
            where.append("enabled = ?")
            values.append(1 if enabled else 0)
        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT * FROM knowledge_bases
            WHERE {' AND '.join(where)}
            ORDER BY enabled DESC, updated_at DESC, name ASC
            """,
            values,
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize_kb(row)) is not None]

    def create_kb(self, kb: KnowledgeBaseDefinition) -> KnowledgeBaseDefinition:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO knowledge_bases (
                kb_id, tenant_id, instance_id, name, enabled, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                kb.kb_id,
                kb.tenant_id,
                kb.instance_id,
                kb.name,
                1 if kb.enabled else 0,
                kb.to_storage_json(),
                kb.created_at,
                kb.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_kb(kb.kb_id)
        if created is None:
            raise RuntimeError(f"Failed to load created knowledge base {kb.kb_id}")
        return created

    def update_kb(self, kb: KnowledgeBaseDefinition) -> KnowledgeBaseDefinition | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE knowledge_bases
            SET name = ?, enabled = ?, config_json = ?, updated_at = ?
            WHERE kb_id = ?
            """,
            (
                kb.name,
                1 if kb.enabled else 0,
                kb.to_storage_json(),
                kb.updated_at,
                kb.kb_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        return self.get_kb(kb.kb_id) if updated else None

    def delete_kb(self, kb_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        doc_rows = conn.execute("SELECT doc_id FROM knowledge_documents WHERE kb_id = ?", (kb_id,)).fetchall()
        doc_ids = [row["doc_id"] for row in doc_rows]
        if doc_ids:
            placeholders = ",".join("?" for _ in doc_ids)
            conn.execute(f"DELETE FROM knowledge_chunks WHERE doc_id IN ({placeholders})", doc_ids)
            if self.fts_enabled:
                conn.execute(f"DELETE FROM knowledge_chunks_fts WHERE doc_id IN ({placeholders})", doc_ids)
        conn.execute("DELETE FROM knowledge_ingest_jobs WHERE kb_id = ?", (kb_id,))
        conn.execute("DELETE FROM knowledge_sources WHERE kb_id = ?", (kb_id,))
        conn.execute("DELETE FROM knowledge_documents WHERE kb_id = ?", (kb_id,))
        cursor.execute("DELETE FROM knowledge_bases WHERE kb_id = ?", (kb_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    def insert_document(self, document: KnowledgeDocument) -> KnowledgeDocument:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO knowledge_documents (
                doc_id, kb_id, tenant_id, instance_id, source_id, source_type, title, mime_type, file_name,
                source_uri, file_path, parsed_path, checksum, parser_name, doc_status, chunk_count,
                metadata_json, error_summary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document.doc_id,
                document.kb_id,
                document.tenant_id,
                document.instance_id,
                document.source_id,
                document.source_type,
                document.title,
                document.mime_type,
                document.file_name,
                document.source_uri,
                document.file_path,
                document.parsed_path,
                document.checksum,
                document.parser_name,
                document.doc_status.value,
                document.chunk_count,
                json.dumps(document.metadata, ensure_ascii=False),
                document.error_summary,
                document.created_at,
                document.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_document(document.doc_id)
        if created is None:
            raise RuntimeError(f"Failed to load created knowledge document {document.doc_id}")
        return created

    def get_document(self, doc_id: str) -> KnowledgeDocument | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM knowledge_documents WHERE doc_id = ?", (doc_id,)).fetchone()
        conn.close()
        return self._deserialize_document(row)

    def list_documents(self, kb_id: str) -> list[KnowledgeDocument]:
        conn = self._connect()
        rows = conn.execute(
            """
            SELECT * FROM knowledge_documents
            WHERE kb_id = ?
            ORDER BY updated_at DESC, title ASC
            """,
            (kb_id,),
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize_document(row)) is not None]

    def update_document(self, document: KnowledgeDocument) -> KnowledgeDocument | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE knowledge_documents
            SET title = ?, source_id = ?, mime_type = ?, file_name = ?, source_uri = ?, file_path = ?, parsed_path = ?,
                checksum = ?, parser_name = ?, doc_status = ?, chunk_count = ?, metadata_json = ?,
                error_summary = ?, updated_at = ?
            WHERE doc_id = ?
            """,
            (
                document.title,
                document.source_id,
                document.mime_type,
                document.file_name,
                document.source_uri,
                document.file_path,
                document.parsed_path,
                document.checksum,
                document.parser_name,
                document.doc_status.value,
                document.chunk_count,
                json.dumps(document.metadata, ensure_ascii=False),
                document.error_summary,
                document.updated_at,
                document.doc_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        return self.get_document(document.doc_id) if updated else None

    def delete_document(self, doc_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        conn.execute("DELETE FROM knowledge_chunks WHERE doc_id = ?", (doc_id,))
        if self.fts_enabled:
            conn.execute("DELETE FROM knowledge_chunks_fts WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM knowledge_ingest_jobs WHERE doc_id = ?", (doc_id,))
        cursor.execute("DELETE FROM knowledge_documents WHERE doc_id = ?", (doc_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    def insert_job(self, job: KnowledgeIngestJob) -> KnowledgeIngestJob:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO knowledge_ingest_jobs (
                job_id, tenant_id, instance_id, kb_id, doc_id, status, track_id,
                error_summary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job.job_id,
                job.tenant_id,
                job.instance_id,
                job.kb_id,
                job.doc_id,
                job.status.value,
                job.track_id,
                job.error_summary,
                job.created_at,
                job.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_job(job.job_id)
        if created is None:
            raise RuntimeError(f"Failed to load created knowledge job {job.job_id}")
        return created

    def get_job(self, job_id: str) -> KnowledgeIngestJob | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM knowledge_ingest_jobs WHERE job_id = ?", (job_id,)).fetchone()
        conn.close()
        return self._deserialize_job(row)

    def list_jobs(self, kb_id: str) -> list[KnowledgeIngestJob]:
        conn = self._connect()
        rows = conn.execute(
            """
            SELECT * FROM knowledge_ingest_jobs
            WHERE kb_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            (kb_id,),
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize_job(row)) is not None]

    def update_job(self, job: KnowledgeIngestJob) -> KnowledgeIngestJob | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE knowledge_ingest_jobs
            SET status = ?, error_summary = ?, updated_at = ?
            WHERE job_id = ?
            """,
            (job.status.value, job.error_summary, job.updated_at, job.job_id),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        return self.get_job(job.job_id) if updated else None

    def insert_source(self, source: KnowledgeSource) -> KnowledgeSource:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO knowledge_sources (
                source_id, kb_id, tenant_id, instance_id, source_type, title, enabled, source_uri,
                latest_doc_id, sync_count, last_synced_at, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source.source_id,
                source.kb_id,
                source.tenant_id,
                source.instance_id,
                source.source_type,
                source.title,
                1 if source.enabled else 0,
                source.source_uri,
                source.latest_doc_id,
                source.sync_count,
                source.last_synced_at,
                source.to_storage_json(),
                source.created_at,
                source.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_source(source.source_id)
        if created is None:
            raise RuntimeError(f"Failed to load created knowledge source {source.source_id}")
        return created

    def get_source(self, source_id: str) -> KnowledgeSource | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM knowledge_sources WHERE source_id = ?", (source_id,)).fetchone()
        conn.close()
        return self._deserialize_source(row)

    def list_sources(self, kb_id: str) -> list[KnowledgeSource]:
        conn = self._connect()
        rows = conn.execute(
            """
            SELECT * FROM knowledge_sources
            WHERE kb_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            (kb_id,),
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize_source(row)) is not None]

    def update_source(self, source: KnowledgeSource) -> KnowledgeSource | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE knowledge_sources
            SET title = ?, enabled = ?, source_uri = ?, latest_doc_id = ?, sync_count = ?, last_synced_at = ?,
                config_json = ?, updated_at = ?
            WHERE source_id = ?
            """,
            (
                source.title,
                1 if source.enabled else 0,
                source.source_uri,
                source.latest_doc_id,
                source.sync_count,
                source.last_synced_at,
                source.to_storage_json(),
                source.updated_at,
                source.source_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        return self.get_source(source.source_id) if updated else None

    def delete_source(self, source_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM knowledge_sources WHERE source_id = ?", (source_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    def list_documents_without_source(self, kb_id: str) -> list[KnowledgeDocument]:
        conn = self._connect()
        rows = conn.execute(
            """
            SELECT * FROM knowledge_documents
            WHERE kb_id = ? AND (source_id IS NULL OR source_id = '')
            ORDER BY updated_at DESC, created_at DESC
            """,
            (kb_id,),
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize_document(row)) is not None]

    def replace_chunks(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        kb_id: str,
        doc_id: str,
        title: str,
        chunks: list[dict[str, Any]],
    ) -> None:
        conn = self._connect()
        conn.execute("DELETE FROM knowledge_chunks WHERE doc_id = ?", (doc_id,))
        if self.fts_enabled:
            conn.execute("DELETE FROM knowledge_chunks_fts WHERE doc_id = ?", (doc_id,))
        for chunk in chunks:
            conn.execute(
                """
                INSERT INTO knowledge_chunks (
                    chunk_id, tenant_id, instance_id, kb_id, doc_id, ordinal, title, content,
                    metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk["chunk_id"],
                    tenant_id,
                    instance_id,
                    kb_id,
                    doc_id,
                    chunk["ordinal"],
                    title,
                    chunk["content"],
                    json.dumps(chunk.get("metadata") or {}, ensure_ascii=False),
                    chunk["created_at"],
                ),
            )
            if self.fts_enabled:
                conn.execute(
                    """
                    INSERT INTO knowledge_chunks_fts (
                        chunk_id, kb_id, doc_id, tenant_id, instance_id, title, content
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk["chunk_id"],
                        kb_id,
                        doc_id,
                        tenant_id,
                        instance_id,
                        title,
                        chunk["content"],
                    ),
                )
        conn.commit()
        conn.close()

    def search_chunks(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        kb_ids: list[str],
        query_text: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        if not kb_ids:
            return []
        kb_placeholders = ",".join("?" for _ in kb_ids)
        values: list[Any] = [tenant_id, instance_id, *kb_ids]
        conn = self._connect()
        if self.fts_enabled:
            rows = conn.execute(
                f"""
                SELECT
                    chunks.chunk_id,
                    chunks.kb_id,
                    chunks.doc_id,
                    chunks.ordinal,
                    chunks.content,
                    chunks.metadata_json,
                    docs.title,
                    docs.source_type,
                    docs.source_uri,
                    docs.file_name,
                    docs.mime_type,
                    docs.metadata_json AS document_metadata_json,
                    bm25(knowledge_chunks_fts) AS rank
                FROM knowledge_chunks_fts
                JOIN knowledge_chunks AS chunks ON chunks.chunk_id = knowledge_chunks_fts.chunk_id
                JOIN knowledge_documents AS docs ON docs.doc_id = chunks.doc_id
                WHERE chunks.tenant_id = ?
                  AND chunks.instance_id = ?
                  AND chunks.kb_id IN ({kb_placeholders})
                  AND knowledge_chunks_fts MATCH ?
                ORDER BY rank ASC, chunks.ordinal ASC
                LIMIT ?
                """,
                [*values, query_text, limit],
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT
                    chunks.chunk_id,
                    chunks.kb_id,
                    chunks.doc_id,
                    chunks.ordinal,
                    chunks.content,
                    chunks.metadata_json,
                    docs.title,
                    docs.source_type,
                    docs.source_uri,
                    docs.file_name,
                    docs.mime_type,
                    docs.metadata_json AS document_metadata_json,
                    0.0 AS rank
                FROM knowledge_chunks AS chunks
                JOIN knowledge_documents AS docs ON docs.doc_id = chunks.doc_id
                WHERE chunks.tenant_id = ?
                  AND chunks.instance_id = ?
                  AND chunks.kb_id IN ({kb_placeholders})
                  AND chunks.content LIKE ?
                ORDER BY chunks.ordinal ASC
                LIMIT ?
                """,
                [*values, f"%{query_text}%", limit],
            ).fetchall()
        conn.close()
        return [dict(row) for row in rows]

    def list_chunks(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        kb_ids: list[str],
        limit: int,
    ) -> list[dict[str, Any]]:
        if not kb_ids:
            return []
        kb_placeholders = ",".join("?" for _ in kb_ids)
        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT
                chunks.chunk_id,
                chunks.kb_id,
                chunks.doc_id,
                chunks.ordinal,
                chunks.content,
                chunks.metadata_json,
                docs.title,
                docs.source_type,
                docs.source_uri,
                docs.file_name,
                docs.mime_type,
                docs.metadata_json AS document_metadata_json,
                0.0 AS rank
            FROM knowledge_chunks AS chunks
            JOIN knowledge_documents AS docs ON docs.doc_id = chunks.doc_id
            WHERE chunks.tenant_id = ?
              AND chunks.instance_id = ?
              AND chunks.kb_id IN ({kb_placeholders})
            ORDER BY docs.updated_at DESC, chunks.ordinal ASC
            LIMIT ?
            """,
            [tenant_id, instance_id, *kb_ids, limit],
        ).fetchall()
        conn.close()
        return [dict(row) for row in rows]
