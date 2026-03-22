"""SQLite store for the rebuilt knowledge-base subsystem."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from nanobot.platform.knowledge.models import KnowledgeBaseDefinition, KnowledgeFile, KnowledgeJob


class KnowledgeBaseStore:
    """Persist knowledge bases, file trees, and background jobs in SQLite."""

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

        CREATE TABLE IF NOT EXISTS knowledge_files (
            file_id TEXT PRIMARY KEY,
            kb_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            parent_id TEXT,
            filename TEXT NOT NULL,
            original_filename TEXT,
            file_type TEXT NOT NULL,
            path TEXT NOT NULL,
            raw_path TEXT,
            markdown_file TEXT,
            status TEXT NOT NULL,
            content_hash TEXT,
            file_size INTEGER NOT NULL DEFAULT 0,
            content_type TEXT,
            processing_params_json TEXT NOT NULL DEFAULT '{}',
            is_folder INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            created_by TEXT,
            updated_by TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_files_kb
        ON knowledge_files(kb_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_knowledge_files_parent
        ON knowledge_files(kb_id, parent_id, filename);

        CREATE INDEX IF NOT EXISTS idx_knowledge_files_status
        ON knowledge_files(kb_id, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS knowledge_jobs (
            job_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            kb_id TEXT NOT NULL,
            job_kind TEXT NOT NULL,
            target_file_ids_json TEXT NOT NULL,
            status TEXT NOT NULL,
            track_id TEXT NOT NULL,
            error_summary TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_kb
        ON knowledge_jobs(kb_id, updated_at DESC);
    """

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_tables()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_tables(self) -> None:
        conn = self._connect()
        conn.executescript(self._CREATE_SCHEMA)
        conn.commit()
        conn.close()

    @staticmethod
    def _deserialize_kb(row: sqlite3.Row | None) -> KnowledgeBaseDefinition | None:
        if row is None:
            return None
        return KnowledgeBaseDefinition.from_record(dict(row))

    @staticmethod
    def _deserialize_file(row: sqlite3.Row | None) -> KnowledgeFile | None:
        if row is None:
            return None
        return KnowledgeFile.from_record(dict(row))

    @staticmethod
    def _deserialize_job(row: sqlite3.Row | None) -> KnowledgeJob | None:
        if row is None:
            return None
        return KnowledgeJob.from_record(dict(row))

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
            raise RuntimeError(f"Failed to reload created knowledge base {kb.kb_id}")
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
        conn.execute("DELETE FROM knowledge_jobs WHERE kb_id = ?", (kb_id,))
        conn.execute("DELETE FROM knowledge_files WHERE kb_id = ?", (kb_id,))
        cursor.execute("DELETE FROM knowledge_bases WHERE kb_id = ?", (kb_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    def insert_file(self, file: KnowledgeFile) -> KnowledgeFile:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO knowledge_files (
                file_id, kb_id, tenant_id, instance_id, parent_id, filename, original_filename,
                file_type, path, raw_path, markdown_file, status, content_hash, file_size,
                content_type, processing_params_json, is_folder, error_message, created_by,
                updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file.file_id,
                file.kb_id,
                file.tenant_id,
                file.instance_id,
                file.parent_id,
                file.filename,
                file.original_filename,
                file.file_type,
                file.path,
                file.raw_path,
                file.markdown_file,
                file.status.value,
                file.content_hash,
                file.file_size,
                file.content_type,
                file.to_processing_params_json(),
                1 if file.is_folder else 0,
                file.error_message,
                file.created_by,
                file.updated_by,
                file.created_at,
                file.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_file(file.file_id)
        if created is None:
            raise RuntimeError(f"Failed to reload created knowledge file {file.file_id}")
        return created

    def get_file(self, file_id: str) -> KnowledgeFile | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM knowledge_files WHERE file_id = ?", (file_id,)).fetchone()
        conn.close()
        return self._deserialize_file(row)

    def list_files(self, kb_id: str) -> list[KnowledgeFile]:
        conn = self._connect()
        rows = conn.execute(
            """
            SELECT * FROM knowledge_files
            WHERE kb_id = ?
            ORDER BY is_folder DESC, path ASC, filename ASC
            """,
            (kb_id,),
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize_file(row)) is not None]

    def update_file(self, file: KnowledgeFile) -> KnowledgeFile | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE knowledge_files
            SET parent_id = ?, filename = ?, original_filename = ?, file_type = ?, path = ?,
                raw_path = ?, markdown_file = ?, status = ?, content_hash = ?, file_size = ?,
                content_type = ?, processing_params_json = ?, is_folder = ?, error_message = ?,
                created_by = ?, updated_by = ?, updated_at = ?
            WHERE file_id = ?
            """,
            (
                file.parent_id,
                file.filename,
                file.original_filename,
                file.file_type,
                file.path,
                file.raw_path,
                file.markdown_file,
                file.status.value,
                file.content_hash,
                file.file_size,
                file.content_type,
                file.to_processing_params_json(),
                1 if file.is_folder else 0,
                file.error_message,
                file.created_by,
                file.updated_by,
                file.updated_at,
                file.file_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        return self.get_file(file.file_id) if updated else None

    def delete_file(self, file_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM knowledge_files WHERE file_id = ?", (file_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    def insert_job(self, job: KnowledgeJob) -> KnowledgeJob:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO knowledge_jobs (
                job_id, tenant_id, instance_id, kb_id, job_kind, target_file_ids_json,
                status, track_id, error_summary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job.job_id,
                job.tenant_id,
                job.instance_id,
                job.kb_id,
                job.job_kind,
                json.dumps(job.target_file_ids, ensure_ascii=False),
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
            raise RuntimeError(f"Failed to reload created knowledge job {job.job_id}")
        return created

    def get_job(self, job_id: str) -> KnowledgeJob | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM knowledge_jobs WHERE job_id = ?", (job_id,)).fetchone()
        conn.close()
        return self._deserialize_job(row)

    def list_jobs(self, kb_id: str) -> list[KnowledgeJob]:
        conn = self._connect()
        rows = conn.execute(
            """
            SELECT * FROM knowledge_jobs
            WHERE kb_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            (kb_id,),
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize_job(row)) is not None]

    def update_job(self, job: KnowledgeJob) -> KnowledgeJob | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE knowledge_jobs
            SET job_kind = ?, target_file_ids_json = ?, status = ?, track_id = ?,
                error_summary = ?, updated_at = ?
            WHERE job_id = ?
            """,
            (
                job.job_kind,
                json.dumps(job.target_file_ids, ensure_ascii=False),
                job.status.value,
                job.track_id,
                job.error_summary,
                job.updated_at,
                job.job_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        return self.get_job(job.job_id) if updated else None

    def get_kb_stats(self, kb_id: str) -> dict[str, int]:
        conn = self._connect()
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_count,
                SUM(CASE WHEN is_folder = 1 THEN 1 ELSE 0 END) AS folder_count,
                SUM(CASE WHEN is_folder = 0 THEN 1 ELSE 0 END) AS file_count,
                SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexed_count,
                SUM(CASE WHEN status = 'parsed' THEN 1 ELSE 0 END) AS parsed_count,
                SUM(CASE WHEN status IN ('error_parsing', 'error_indexing') THEN 1 ELSE 0 END) AS error_count
            FROM knowledge_files
            WHERE kb_id = ?
            """,
            (kb_id,),
        ).fetchone()
        conn.close()
        if row is None:
            return {
                "totalCount": 0,
                "folderCount": 0,
                "fileCount": 0,
                "indexedCount": 0,
                "parsedCount": 0,
                "errorCount": 0,
            }
        return {
            "totalCount": int(row["total_count"] or 0),
            "folderCount": int(row["folder_count"] or 0),
            "fileCount": int(row["file_count"] or 0),
            "indexedCount": int(row["indexed_count"] or 0),
            "parsedCount": int(row["parsed_count"] or 0),
            "errorCount": int(row["error_count"] or 0),
        }

