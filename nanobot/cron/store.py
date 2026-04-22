"""PostgreSQL-backed cron job store."""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from nanobot.config.schema import RagPostgresConfig
from nanobot.cron.types import CronJob, CronJobState, CronPayload, CronRunRecord, CronSchedule
from nanobot.platform.postgres_store import WorkspacePostgresStore
from nanobot.storage.postgres import pg_dict, pg_json, pg_list

_CREATE_SCHEMA = """
    CREATE TABLE IF NOT EXISTS cron_jobs (
        workspace_key TEXT NOT NULL,
        job_id TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        source TEXT NOT NULL DEFAULT '',
        schedule_json JSONB NOT NULL,
        payload_json JSONB NOT NULL,
        next_run_at_ms BIGINT,
        last_run_at_ms BIGINT,
        last_status TEXT,
        last_error TEXT,
        run_history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at_ms BIGINT NOT NULL,
        updated_at_ms BIGINT NOT NULL,
        delete_after_run BOOLEAN NOT NULL DEFAULT FALSE,
        claimed_by TEXT,
        claimed_until_ms BIGINT,
        PRIMARY KEY (workspace_key, job_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cron_jobs_workspace_enabled_next_run
    ON cron_jobs(workspace_key, enabled, next_run_at_ms);
    CREATE INDEX IF NOT EXISTS idx_cron_jobs_workspace_claimed_until
    ON cron_jobs(workspace_key, claimed_until_ms);
"""


class CronJobStore(WorkspacePostgresStore):
    """Persist cron jobs in PostgreSQL."""

    _CREATE_SCHEMA = _CREATE_SCHEMA
    _FEATURE_NAME = "Cron service"
    _SCHEMA_NAMESPACE = "cron_jobs"

    def __init__(self, workspace: Path, postgres: RagPostgresConfig | dict[str, Any] | None = None):
        super().__init__(workspace, postgres)

    @staticmethod
    def _row_to_job(row: dict[str, Any] | None) -> CronJob | None:
        if row is None:
            return None
        schedule = CronSchedule(**pg_dict(row.get("schedule_json")))
        payload = CronPayload(**pg_dict(row.get("payload_json")))
        history = [
            record if isinstance(record, CronRunRecord) else CronRunRecord(**record)
            for record in pg_list(row.get("run_history_json"))
        ]
        return CronJob(
            id=str(row.get("job_id") or ""),
            name=str(row.get("name") or ""),
            enabled=bool(row.get("enabled", True)),
            source=str(row.get("source") or ""),
            schedule=schedule,
            payload=payload,
            state=CronJobState(
                next_run_at_ms=row.get("next_run_at_ms"),
                last_run_at_ms=row.get("last_run_at_ms"),
                last_status=row.get("last_status"),
                last_error=row.get("last_error"),
                run_history=history,
            ),
            created_at_ms=int(row.get("created_at_ms") or 0),
            updated_at_ms=int(row.get("updated_at_ms") or 0),
            delete_after_run=bool(row.get("delete_after_run", False)),
        )

    @staticmethod
    def _serialize_job(job: CronJob) -> tuple[Any, ...]:
        return (
            job.id,
            job.name,
            job.enabled,
            job.source,
            pg_json(asdict(job.schedule)),
            pg_json(asdict(job.payload)),
            job.state.next_run_at_ms,
            job.state.last_run_at_ms,
            job.state.last_status,
            job.state.last_error,
            pg_json([asdict(record) for record in job.state.run_history]),
            job.created_at_ms,
            job.updated_at_ms,
            job.delete_after_run,
        )

    def get_job(self, job_id: str) -> CronJob | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM cron_jobs
                    WHERE workspace_key = %s AND job_id = %s
                    """,
                    (self.workspace_key, job_id),
                )
                row = cur.fetchone()
        return self._row_to_job(row)

    def list_jobs(self, *, include_disabled: bool = False) -> list[CronJob]:
        with self._connection() as conn:
            with conn.cursor() as cur:
                if include_disabled:
                    cur.execute(
                        """
                        SELECT * FROM cron_jobs
                        WHERE workspace_key = %s
                        ORDER BY next_run_at_ms NULLS LAST, created_at_ms ASC
                        """,
                        (self.workspace_key,),
                    )
                else:
                    cur.execute(
                        """
                        SELECT * FROM cron_jobs
                        WHERE workspace_key = %s AND enabled = TRUE
                        ORDER BY next_run_at_ms NULLS LAST, created_at_ms ASC
                        """,
                        (self.workspace_key,),
                    )
                rows = cur.fetchall() or []
        return [job for row in rows if (job := self._row_to_job(row)) is not None]

    def put_job(self, job: CronJob) -> CronJob:
        with self._connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO cron_jobs (
                            workspace_key, job_id, name, enabled, source, schedule_json, payload_json,
                            next_run_at_ms, last_run_at_ms, last_status, last_error, run_history_json,
                            created_at_ms, updated_at_ms, delete_after_run
                        )
                        VALUES (
                            %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb,
                            %s, %s, %s, %s, %s::jsonb,
                            %s, %s, %s
                        )
                        ON CONFLICT (workspace_key, job_id) DO UPDATE SET
                            name = EXCLUDED.name,
                            enabled = EXCLUDED.enabled,
                            source = EXCLUDED.source,
                            schedule_json = EXCLUDED.schedule_json,
                            payload_json = EXCLUDED.payload_json,
                            next_run_at_ms = EXCLUDED.next_run_at_ms,
                            last_run_at_ms = EXCLUDED.last_run_at_ms,
                            last_status = EXCLUDED.last_status,
                            last_error = EXCLUDED.last_error,
                            run_history_json = EXCLUDED.run_history_json,
                            updated_at_ms = EXCLUDED.updated_at_ms,
                            delete_after_run = EXCLUDED.delete_after_run,
                            claimed_by = NULL,
                            claimed_until_ms = NULL
                        RETURNING *
                        """,
                        (self.workspace_key, *self._serialize_job(job)),
                    )
                    row = cur.fetchone()
        stored = self._row_to_job(row)
        assert stored is not None
        return stored

    def delete_job(self, job_id: str) -> bool:
        with self._connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        DELETE FROM cron_jobs
                        WHERE workspace_key = %s AND job_id = %s
                        """,
                        (self.workspace_key, job_id),
                    )
                    return cur.rowcount > 0

    def claim_due_jobs(
        self,
        *,
        worker_id: str,
        now_ms: int,
        claimed_until_ms: int,
        limit: int = 100,
    ) -> list[CronJob]:
        with self._connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        WITH due AS (
                            SELECT job_id
                            FROM cron_jobs
                            WHERE workspace_key = %s
                              AND enabled = TRUE
                              AND next_run_at_ms IS NOT NULL
                              AND next_run_at_ms <= %s
                              AND (claimed_until_ms IS NULL OR claimed_until_ms < %s)
                            ORDER BY next_run_at_ms ASC, created_at_ms ASC
                            LIMIT %s
                            FOR UPDATE SKIP LOCKED
                        )
                        UPDATE cron_jobs AS jobs
                        SET claimed_by = %s,
                            claimed_until_ms = %s
                        FROM due
                        WHERE jobs.workspace_key = %s
                          AND jobs.job_id = due.job_id
                        RETURNING jobs.*
                        """,
                        (
                            self.workspace_key,
                            now_ms,
                            now_ms,
                            max(1, int(limit or 1)),
                            worker_id,
                            claimed_until_ms,
                            self.workspace_key,
                        ),
                    )
                    rows = cur.fetchall() or []
        return [job for row in rows if (job := self._row_to_job(row)) is not None]

    def release_claim(self, job_id: str, *, worker_id: str) -> None:
        with self._connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE cron_jobs
                        SET claimed_by = NULL,
                            claimed_until_ms = NULL
                        WHERE workspace_key = %s
                          AND job_id = %s
                          AND claimed_by = %s
                        """,
                        (self.workspace_key, job_id, worker_id),
                    )

    def record_execution(
        self,
        job_id: str,
        *,
        worker_id: str | None,
        run_at_ms: int,
        duration_ms: int,
        status: str,
        error: str | None,
        next_run_at_ms: int | None,
        disable_after_run: bool,
        delete_after_run: bool,
    ) -> CronJob | None:
        with self._connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    if worker_id:
                        cur.execute(
                            """
                            SELECT * FROM cron_jobs
                            WHERE workspace_key = %s AND job_id = %s AND claimed_by = %s
                            FOR UPDATE
                            """,
                            (self.workspace_key, job_id, worker_id),
                        )
                    else:
                        cur.execute(
                            """
                            SELECT * FROM cron_jobs
                            WHERE workspace_key = %s AND job_id = %s
                            FOR UPDATE
                            """,
                            (self.workspace_key, job_id),
                        )
                    row = cur.fetchone()
                    job = self._row_to_job(row)
                    if job is None:
                        return None

                    updated_at_ms = run_at_ms + max(0, int(duration_ms or 0))
                    job.state.last_run_at_ms = run_at_ms
                    job.state.last_status = status  # type: ignore[assignment]
                    job.state.last_error = error
                    job.updated_at_ms = updated_at_ms
                    job.state.run_history.append(
                        CronRunRecord(
                            run_at_ms=run_at_ms,
                            status=status,  # type: ignore[arg-type]
                            duration_ms=max(0, int(duration_ms or 0)),
                            error=error,
                        )
                    )
                    job.state.run_history = job.state.run_history[-20:]

                    if delete_after_run:
                        cur.execute(
                            """
                            DELETE FROM cron_jobs
                            WHERE workspace_key = %s AND job_id = %s
                            """,
                            (self.workspace_key, job_id),
                        )
                        return None

                    job.enabled = False if disable_after_run else job.enabled
                    job.state.next_run_at_ms = None if disable_after_run else next_run_at_ms

                    cur.execute(
                        """
                        UPDATE cron_jobs
                        SET enabled = %s,
                            next_run_at_ms = %s,
                            last_run_at_ms = %s,
                            last_status = %s,
                            last_error = %s,
                            run_history_json = %s::jsonb,
                            updated_at_ms = %s,
                            claimed_by = NULL,
                            claimed_until_ms = NULL
                        WHERE workspace_key = %s AND job_id = %s
                        RETURNING *
                        """,
                        (
                            job.enabled,
                            job.state.next_run_at_ms,
                            job.state.last_run_at_ms,
                            job.state.last_status,
                            job.state.last_error,
                            pg_json([asdict(record) for record in job.state.run_history]),
                            job.updated_at_ms,
                            self.workspace_key,
                            job_id,
                        ),
                    )
                    updated_row = cur.fetchone()
        return self._row_to_job(updated_row)

    def get_next_wake_ms(self, *, now_ms: int) -> int | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT MIN(
                        CASE
                            WHEN next_run_at_ms IS NULL THEN NULL
                            WHEN next_run_at_ms <= %s
                                 AND claimed_until_ms IS NOT NULL
                                 AND claimed_until_ms >= %s
                            THEN claimed_until_ms
                            ELSE next_run_at_ms
                        END
                    ) AS next_wake_at_ms
                    FROM cron_jobs
                    WHERE workspace_key = %s
                      AND enabled = TRUE
                      AND next_run_at_ms IS NOT NULL
                    """,
                    (now_ms, now_ms, self.workspace_key),
                )
                row = cur.fetchone()
        next_wake = (row or {}).get("next_wake_at_ms")
        return int(next_wake) if next_wake is not None else None
