"""PostgreSQL store for the LightRAG-aligned knowledge-base subsystem."""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator

from nanobot.platform.knowledge.models import KnowledgeBaseDefinition, KnowledgeFile, KnowledgeJob

try:
    import psycopg
    from psycopg.conninfo import make_conninfo
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool
except Exception:  # pragma: no cover - optional dependency for PostgreSQL deployments
    psycopg = None  # type: ignore[assignment]
    make_conninfo = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]
    ConnectionPool = None  # type: ignore[assignment]


class KnowledgeBaseStore:
    """Persist knowledge bases, file trees, and background jobs in PostgreSQL."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS knowledge_bases (
            kb_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            config_json JSONB NOT NULL,
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
            file_size BIGINT NOT NULL DEFAULT 0,
            content_type TEXT,
            processing_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            is_folder BOOLEAN NOT NULL DEFAULT FALSE,
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
            target_file_ids_json JSONB NOT NULL,
            status TEXT NOT NULL,
            track_id TEXT NOT NULL,
            error_summary TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_kb
        ON knowledge_jobs(kb_id, updated_at DESC);
    """

    def __init__(
        self,
        *,
        host: str,
        port: int,
        user: str,
        password: str,
        database: str,
        max_connections: int = 50,
        ssl_mode: str | None = None,
        ssl_cert: str | None = None,
        ssl_key: str | None = None,
        ssl_root_cert: str | None = None,
        ssl_crl: str | None = None,
    ):
        if psycopg is None or ConnectionPool is None or make_conninfo is None:
            raise RuntimeError(
                "PostgreSQL knowledge store requires dependency 'psycopg[binary,pool]'. "
                "Install with: pip install psycopg[binary,pool]"
            )

        conn_kwargs: dict[str, Any] = {
            "host": host,
            "port": int(port),
            "user": user,
            "password": password,
            "dbname": database,
        }
        if ssl_mode:
            conn_kwargs["sslmode"] = ssl_mode
        if ssl_cert:
            conn_kwargs["sslcert"] = ssl_cert
        if ssl_key:
            conn_kwargs["sslkey"] = ssl_key
        if ssl_root_cert:
            conn_kwargs["sslrootcert"] = ssl_root_cert
        if ssl_crl:
            conn_kwargs["sslcrl"] = ssl_crl

        conninfo = make_conninfo(**conn_kwargs)
        self._pool = ConnectionPool(
            conninfo=conninfo,
            min_size=1,
            max_size=max(1, int(max_connections or 1)),
            kwargs={"row_factory": dict_row, "autocommit": True},
        )
        self._pool.open(wait=True)
        self._init_tables()

    @contextmanager
    def _connection(self) -> Iterator[Any]:
        with self._pool.connection() as conn:
            yield conn

    def close(self) -> None:
        self._pool.close()

    def _init_tables(self) -> None:
        statements = [part.strip() for part in self._CREATE_SCHEMA.split(";") if part.strip()]
        with self._connection() as conn:
            with conn.cursor() as cur:
                for statement in statements:
                    cur.execute(statement)

    @staticmethod
    def _deserialize_kb(row: dict[str, Any] | None) -> KnowledgeBaseDefinition | None:
        if row is None:
            return None
        payload = dict(row)
        config_value = payload.get("config_json")
        if isinstance(config_value, dict):
            payload["config_json"] = json.dumps(config_value, ensure_ascii=False)
        return KnowledgeBaseDefinition.from_record(payload)

    @staticmethod
    def _deserialize_file(row: dict[str, Any] | None) -> KnowledgeFile | None:
        if row is None:
            return None
        payload = dict(row)
        params_value = payload.get("processing_params_json")
        if isinstance(params_value, dict):
            payload["processing_params_json"] = json.dumps(params_value, ensure_ascii=False)
        return KnowledgeFile.from_record(payload)

    @staticmethod
    def _deserialize_job(row: dict[str, Any] | None) -> KnowledgeJob | None:
        if row is None:
            return None
        payload = dict(row)
        target_value = payload.get("target_file_ids_json")
        if isinstance(target_value, list):
            payload["target_file_ids_json"] = json.dumps(target_value, ensure_ascii=False)
        return KnowledgeJob.from_record(payload)

    def get_kb(self, kb_id: str) -> KnowledgeBaseDefinition | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM knowledge_bases WHERE kb_id = %s", (kb_id,))
                row = cur.fetchone()
        return self._deserialize_kb(row)

    def get_kb_by_name(self, name: str, *, tenant_id: str, instance_id: str) -> KnowledgeBaseDefinition | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM knowledge_bases
                    WHERE tenant_id = %s AND instance_id = %s AND name = %s
                    """,
                    (tenant_id, instance_id, name),
                )
                row = cur.fetchone()
        return self._deserialize_kb(row)

    def list_kbs(self, *, tenant_id: str, instance_id: str, enabled: bool | None = None) -> list[KnowledgeBaseDefinition]:
        where = ["tenant_id = %s", "instance_id = %s"]
        values: list[Any] = [tenant_id, instance_id]
        if enabled is not None:
            where.append("enabled = %s")
            values.append(bool(enabled))

        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT * FROM knowledge_bases
                    WHERE {' AND '.join(where)}
                    ORDER BY enabled DESC, updated_at DESC, name ASC
                    """,
                    values,
                )
                rows = cur.fetchall()
        return [item for row in rows if (item := self._deserialize_kb(row)) is not None]

    def create_kb(self, kb: KnowledgeBaseDefinition) -> KnowledgeBaseDefinition:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO knowledge_bases (
                        kb_id, tenant_id, instance_id, name, enabled, config_json, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        kb.kb_id,
                        kb.tenant_id,
                        kb.instance_id,
                        kb.name,
                        bool(kb.enabled),
                        kb.to_storage_json(),
                        kb.created_at,
                        kb.updated_at,
                    ),
                )
        created = self.get_kb(kb.kb_id)
        if created is None:
            raise RuntimeError(f"Failed to reload created knowledge base {kb.kb_id}")
        return created

    def update_kb(self, kb: KnowledgeBaseDefinition) -> KnowledgeBaseDefinition | None:
        updated = False
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE knowledge_bases
                    SET name = %s, enabled = %s, config_json = %s::jsonb, updated_at = %s
                    WHERE kb_id = %s
                    """,
                    (
                        kb.name,
                        bool(kb.enabled),
                        kb.to_storage_json(),
                        kb.updated_at,
                        kb.kb_id,
                    ),
                )
                updated = cur.rowcount > 0
        return self.get_kb(kb.kb_id) if updated else None

    def delete_kb(self, kb_id: str) -> bool:
        deleted = False
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM knowledge_jobs WHERE kb_id = %s", (kb_id,))
                cur.execute("DELETE FROM knowledge_files WHERE kb_id = %s", (kb_id,))
                cur.execute("DELETE FROM knowledge_bases WHERE kb_id = %s", (kb_id,))
                deleted = cur.rowcount > 0
        return deleted

    def insert_file(self, file: KnowledgeFile) -> KnowledgeFile:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO knowledge_files (
                        file_id, kb_id, tenant_id, instance_id, parent_id, filename, original_filename,
                        file_type, path, raw_path, markdown_file, status, content_hash, file_size,
                        content_type, processing_params_json, is_folder, error_message, created_by,
                        updated_by, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)
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
                        bool(file.is_folder),
                        file.error_message,
                        file.created_by,
                        file.updated_by,
                        file.created_at,
                        file.updated_at,
                    ),
                )
        created = self.get_file(file.file_id)
        if created is None:
            raise RuntimeError(f"Failed to reload created knowledge file {file.file_id}")
        return created

    def get_file(self, file_id: str) -> KnowledgeFile | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM knowledge_files WHERE file_id = %s", (file_id,))
                row = cur.fetchone()
        return self._deserialize_file(row)

    def list_files(self, kb_id: str) -> list[KnowledgeFile]:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM knowledge_files
                    WHERE kb_id = %s
                    ORDER BY is_folder DESC, path ASC, filename ASC
                    """,
                    (kb_id,),
                )
                rows = cur.fetchall()
        return [item for row in rows if (item := self._deserialize_file(row)) is not None]

    def update_file(self, file: KnowledgeFile) -> KnowledgeFile | None:
        updated = False
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE knowledge_files
                    SET parent_id = %s, filename = %s, original_filename = %s, file_type = %s, path = %s,
                        raw_path = %s, markdown_file = %s, status = %s, content_hash = %s, file_size = %s,
                        content_type = %s, processing_params_json = %s::jsonb, is_folder = %s, error_message = %s,
                        created_by = %s, updated_by = %s, updated_at = %s
                    WHERE file_id = %s
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
                        bool(file.is_folder),
                        file.error_message,
                        file.created_by,
                        file.updated_by,
                        file.updated_at,
                        file.file_id,
                    ),
                )
                updated = cur.rowcount > 0
        return self.get_file(file.file_id) if updated else None

    def delete_file(self, file_id: str) -> bool:
        deleted = False
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM knowledge_files WHERE file_id = %s", (file_id,))
                deleted = cur.rowcount > 0
        return deleted

    def insert_job(self, job: KnowledgeJob) -> KnowledgeJob:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO knowledge_jobs (
                        job_id, tenant_id, instance_id, kb_id, job_kind, target_file_ids_json,
                        status, track_id, error_summary, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
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
        created = self.get_job(job.job_id)
        if created is None:
            raise RuntimeError(f"Failed to reload created knowledge job {job.job_id}")
        return created

    def get_job(self, job_id: str) -> KnowledgeJob | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM knowledge_jobs WHERE job_id = %s", (job_id,))
                row = cur.fetchone()
        return self._deserialize_job(row)

    def list_jobs(self, kb_id: str) -> list[KnowledgeJob]:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM knowledge_jobs
                    WHERE kb_id = %s
                    ORDER BY updated_at DESC, created_at DESC
                    """,
                    (kb_id,),
                )
                rows = cur.fetchall()
        return [item for row in rows if (item := self._deserialize_job(row)) is not None]

    def update_job(self, job: KnowledgeJob) -> KnowledgeJob | None:
        updated = False
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE knowledge_jobs
                    SET job_kind = %s, target_file_ids_json = %s::jsonb, status = %s, track_id = %s,
                        error_summary = %s, updated_at = %s
                    WHERE job_id = %s
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
                updated = cur.rowcount > 0
        return self.get_job(job.job_id) if updated else None

    def get_kb_stats(self, kb_id: str) -> dict[str, int]:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*) AS total_count,
                        SUM(CASE WHEN is_folder THEN 1 ELSE 0 END) AS folder_count,
                        SUM(CASE WHEN NOT is_folder THEN 1 ELSE 0 END) AS file_count,
                        SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexed_count,
                        SUM(CASE WHEN status = 'parsed' THEN 1 ELSE 0 END) AS parsed_count,
                        SUM(CASE WHEN status IN ('error_parsing', 'error_indexing') THEN 1 ELSE 0 END) AS error_count
                    FROM knowledge_files
                    WHERE kb_id = %s
                    """,
                    (kb_id,),
                )
                row = cur.fetchone()

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
            "totalCount": int(row.get("total_count") or 0),
            "folderCount": int(row.get("folder_count") or 0),
            "fileCount": int(row.get("file_count") or 0),
            "indexedCount": int(row.get("indexed_count") or 0),
            "parsedCount": int(row.get("parsed_count") or 0),
            "errorCount": int(row.get("error_count") or 0),
        }


def create_knowledge_store(config: Any, instance: Any) -> KnowledgeBaseStore:
    """Create the unified knowledge metadata store (PostgreSQL only)."""
    _ = instance
    rag = getattr(config, "rag", None)
    pg = getattr(rag, "postgres", None) if rag is not None else None
    enabled = bool(getattr(pg, "enabled", False))
    if not enabled:
        raise RuntimeError(
            "Knowledge store requires PostgreSQL. Set rag.postgres.enabled=true "
            "and provide rag.postgres connection settings."
        )

    return KnowledgeBaseStore(
        host=str(getattr(pg, "host", "127.0.0.1") or "127.0.0.1"),
        port=int(getattr(pg, "port", 5432) or 5432),
        user=str(getattr(pg, "user", "postgres") or "postgres"),
        password=str(getattr(pg, "password", "") or ""),
        database=str(getattr(pg, "database", "nanobot") or "nanobot"),
        max_connections=max(1, int(getattr(pg, "max_connections", 50) or 50)),
        ssl_mode=str(getattr(pg, "ssl_mode", "") or "").strip() or None,
        ssl_cert=str(getattr(pg, "ssl_cert", "") or "").strip() or None,
        ssl_key=str(getattr(pg, "ssl_key", "") or "").strip() or None,
        ssl_root_cert=str(getattr(pg, "ssl_root_cert", "") or "").strip() or None,
        ssl_crl=str(getattr(pg, "ssl_crl", "") or "").strip() or None,
    )
