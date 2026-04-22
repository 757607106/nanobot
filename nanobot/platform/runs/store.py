"""PostgreSQL-backed run registry store."""

from __future__ import annotations

import threading
import weakref
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from nanobot.config.schema import RagPostgresConfig
from nanobot.platform.runs.models import (
    RunControlScope,
    RunEvent,
    RunKind,
    RunRecord,
    RunResultSummary,
    RunStatus,
)
from nanobot.storage.postgres import (
    acquire_shared_postgres_pool,
    build_postgres_pool_settings,
    pg_dict,
    pg_json,
    release_shared_postgres_pool,
)


_CREATE_SCHEMA = """
    CREATE TABLE IF NOT EXISTS run_records (
        workspace_key TEXT NOT NULL,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        instance_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        label TEXT NOT NULL,
        task_preview TEXT NOT NULL,
        agent_id TEXT,
        thread_id TEXT,
        parent_run_id TEXT,
        root_run_id TEXT NOT NULL,
        session_key TEXT,
        origin_channel TEXT,
        origin_chat_id TEXT,
        control_scope TEXT NOT NULL DEFAULT 'top_level',
        workspace_path TEXT,
        memory_scope TEXT,
        knowledge_scope TEXT,
        result_summary_json JSONB,
        artifact_path TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        provider TEXT,
        model TEXT,
        prompt_tokens BIGINT NOT NULL DEFAULT 0,
        completion_tokens BIGINT NOT NULL DEFAULT 0,
        cached_tokens BIGINT NOT NULL DEFAULT 0,
        total_tokens BIGINT NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        PRIMARY KEY (workspace_key, run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_run_records_workspace_tenant_instance
    ON run_records(workspace_key, tenant_id, instance_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_records_workspace_status
    ON run_records(workspace_key, status);
    CREATE INDEX IF NOT EXISTS idx_run_records_workspace_root_run_id
    ON run_records(workspace_key, root_run_id);
    CREATE INDEX IF NOT EXISTS idx_run_records_workspace_parent_run_id
    ON run_records(workspace_key, parent_run_id);
    CREATE INDEX IF NOT EXISTS idx_run_records_workspace_session_key
    ON run_records(workspace_key, session_key);
    CREATE INDEX IF NOT EXISTS idx_run_records_workspace_agent_id
    ON run_records(workspace_key, agent_id);
    CREATE INDEX IF NOT EXISTS idx_run_records_workspace_created_at
    ON run_records(workspace_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS run_events (
        workspace_key TEXT NOT NULL,
        event_id BIGSERIAL NOT NULL,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_key, event_id),
        FOREIGN KEY (workspace_key, run_id)
            REFERENCES run_records(workspace_key, run_id)
            ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_events_workspace_run_id
    ON run_events(workspace_key, run_id, event_id ASC);
    CREATE INDEX IF NOT EXISTS idx_run_events_workspace_created_at
    ON run_events(workspace_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS run_artifacts (
        workspace_key TEXT NOT NULL,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        instance_id TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        content_text TEXT NOT NULL,
        storage_scope TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_key, run_id),
        FOREIGN KEY (workspace_key, run_id)
            REFERENCES run_records(workspace_key, run_id)
            ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_artifacts_workspace_tenant_instance
    ON run_artifacts(workspace_key, tenant_id, instance_id, updated_at DESC);
"""

_SCHEMA_READY_LOCK = threading.Lock()
_SCHEMA_READY: set[tuple[str, int]] = set()


class RunStore:
    """Persist run records and events in PostgreSQL."""

    _BUCKET_SQL: dict[str, str] = {
        "hour": "to_char(date_trunc('hour', created_at::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:00:00\"Z\"')",
        "day": "to_char(date_trunc('day', created_at::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD')",
        "week": "to_char(date_trunc('week', created_at::timestamptz AT TIME ZONE 'UTC'), 'IYYY-\"W\"IW')",
        "month": "to_char(date_trunc('month', created_at::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM')",
    }

    def __init__(self, workspace: Path, postgres: RagPostgresConfig | dict[str, Any] | None = None):
        _, conninfo, max_connections = build_postgres_pool_settings(
            postgres,
            feature_name="Run store",
        )
        self.workspace = Path(workspace).resolve()
        self.workspace_key = str(self.workspace)
        self._pool_key, self._pool = acquire_shared_postgres_pool(conninfo, max_connections)
        self._finalizer = weakref.finalize(self, release_shared_postgres_pool, self._pool_key)
        self._ensure_schema()

    def close(self) -> None:
        """Release this store's shared pool reference."""
        self._finalizer()

    @contextmanager
    def _connection(self) -> Iterator[Any]:
        with self._pool.connection() as conn:
            yield conn

    def _ensure_schema(self) -> None:
        if self._pool_key in _SCHEMA_READY:
            return
        with _SCHEMA_READY_LOCK:
            if self._pool_key in _SCHEMA_READY:
                return
            statements = [part.strip() for part in _CREATE_SCHEMA.split(";") if part.strip()]
            with self._connection() as conn:
                with conn.cursor() as cur:
                    for statement in statements:
                        cur.execute(statement)
            _SCHEMA_READY.add(self._pool_key)

    @staticmethod
    def _serialize_result_summary(summary: RunResultSummary | None) -> str | None:
        if summary is None:
            return None
        return pg_json(
            {
                "content": summary.content,
                "tools_used": summary.tools_used,
                "tools_call_counts": summary.tools_call_counts,
                "mcps_call_counts": summary.mcps_call_counts,
                "knowledge_call_counts": summary.knowledge_call_counts,
                "metadata": summary.metadata,
            }
        )

    @staticmethod
    def _deserialize_result_summary(raw: Any) -> RunResultSummary | None:
        if raw in (None, ""):
            return None
        payload = pg_dict(raw)
        if not payload:
            return None
        return RunResultSummary(
            content=payload.get("content"),
            tools_used=list(payload.get("tools_used") or []),
            tools_call_counts=dict(payload.get("tools_call_counts") or {}),
            mcps_call_counts=dict(payload.get("mcps_call_counts") or {}),
            knowledge_call_counts=dict(payload.get("knowledge_call_counts") or {}),
            metadata=dict(payload.get("metadata") or {}),
        )

    @classmethod
    def _row_to_record(cls, row: dict[str, Any] | None) -> RunRecord | None:
        if row is None:
            return None
        return RunRecord(
            run_id=str(row.get("run_id") or ""),
            tenant_id=str(row.get("tenant_id") or "default"),
            instance_id=str(row.get("instance_id") or ""),
            kind=RunKind(str(row.get("kind") or RunKind.AGENT.value)),
            status=RunStatus(str(row.get("status") or RunStatus.QUEUED.value)),
            label=str(row.get("label") or ""),
            task_preview=str(row.get("task_preview") or ""),
            agent_id=row.get("agent_id"),
            thread_id=row.get("thread_id"),
            parent_run_id=row.get("parent_run_id"),
            root_run_id=row.get("root_run_id"),
            session_key=row.get("session_key"),
            origin_channel=row.get("origin_channel"),
            origin_chat_id=row.get("origin_chat_id"),
            control_scope=RunControlScope(str(row.get("control_scope") or RunControlScope.TOP_LEVEL.value)),
            workspace_path=row.get("workspace_path"),
            memory_scope=row.get("memory_scope"),
            knowledge_scope=row.get("knowledge_scope"),
            created_at=str(row.get("created_at") or ""),
            started_at=row.get("started_at"),
            finished_at=row.get("finished_at"),
            last_error_code=row.get("last_error_code"),
            last_error_message=row.get("last_error_message"),
            result_summary=cls._deserialize_result_summary(row.get("result_summary_json")),
            artifact_path=row.get("artifact_path"),
            provider=row.get("provider"),
            model=row.get("model"),
            prompt_tokens=int(row.get("prompt_tokens") or 0),
            completion_tokens=int(row.get("completion_tokens") or 0),
            cached_tokens=int(row.get("cached_tokens") or 0),
            total_tokens=int(row.get("total_tokens") or 0),
        )

    @staticmethod
    def _normalize_record_updates(updates: dict[str, object]) -> dict[str, object]:
        normalized = dict(updates)
        if "kind" in normalized and normalized["kind"] is not None and not isinstance(normalized["kind"], RunKind):
            normalized["kind"] = RunKind(str(normalized["kind"]))
        if "status" in normalized and normalized["status"] is not None and not isinstance(normalized["status"], RunStatus):
            normalized["status"] = RunStatus(str(normalized["status"]))
        if (
            "control_scope" in normalized
            and normalized["control_scope"] is not None
            and not isinstance(normalized["control_scope"], RunControlScope)
        ):
            normalized["control_scope"] = RunControlScope(str(normalized["control_scope"]))
        return normalized

    @classmethod
    def _serialize_run_updates(cls, updates: dict[str, object]) -> tuple[dict[str, object], dict[str, object]]:
        record_updates = cls._normalize_record_updates(updates)
        serialized: dict[str, object] = {}
        for column, value in record_updates.items():
            if column == "result_summary":
                serialized["result_summary_json"] = cls._serialize_result_summary(value)  # type: ignore[arg-type]
                continue
            if isinstance(value, (RunKind, RunStatus, RunControlScope)):
                serialized[column] = value.value
                continue
            serialized[column] = value
        return record_updates, serialized

    @staticmethod
    def _append_filter(where: list[str], values: list[object], column: str, value: object | None) -> None:
        if value is None:
            return
        where.append(f"{column} = %s")
        values.append(value)

    def _scoped_where(self) -> tuple[list[str], list[object]]:
        return ["workspace_key = %s"], [self.workspace_key]

    @classmethod
    def _get_run_from_connection(cls, conn: Any, workspace_key: str, run_id: str) -> RunRecord | None:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM run_records
                WHERE workspace_key = %s AND run_id = %s
                """,
                (workspace_key, run_id),
            )
            row = cur.fetchone()
        return cls._row_to_record(row)

    @staticmethod
    def _store_event_from_row(event: RunEvent, row: dict[str, Any] | None) -> RunEvent:
        return RunEvent(
            run_id=event.run_id,
            event_type=event.event_type,
            payload=event.payload,
            event_id=int((row or {}).get("event_id") or 0) or None,
            created_at=event.created_at,
        )

    @classmethod
    def _insert_event_from_connection(cls, conn: Any, workspace_key: str, event: RunEvent) -> RunEvent:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO run_events (workspace_key, run_id, event_type, payload_json, created_at)
                VALUES (%s, %s, %s, %s::jsonb, %s)
                RETURNING event_id
                """,
                (
                    workspace_key,
                    event.run_id,
                    event.event_type,
                    pg_json(event.payload or {}),
                    event.created_at,
                ),
            )
            row = cur.fetchone()
        return cls._store_event_from_row(event, row)

    def insert_run(self, record: RunRecord, *, event: RunEvent | None = None) -> RunRecord:
        with self._connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO run_records (
                            workspace_key, run_id, tenant_id, instance_id, kind, status, label, task_preview,
                            agent_id, thread_id, parent_run_id, root_run_id, session_key,
                            origin_channel, origin_chat_id, control_scope,
                            workspace_path, memory_scope, knowledge_scope, result_summary_json,
                            artifact_path, last_error_code, last_error_message,
                            provider, model, prompt_tokens, completion_tokens, cached_tokens, total_tokens,
                            created_at, started_at, finished_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            self.workspace_key,
                            record.run_id,
                            record.tenant_id,
                            record.instance_id,
                            record.kind.value,
                            record.status.value,
                            record.label,
                            record.task_preview,
                            record.agent_id,
                            record.thread_id,
                            record.parent_run_id,
                            record.root_run_id or record.run_id,
                            record.session_key,
                            record.origin_channel,
                            record.origin_chat_id,
                            record.control_scope.value,
                            record.workspace_path,
                            record.memory_scope,
                            record.knowledge_scope,
                            self._serialize_result_summary(record.result_summary),
                            record.artifact_path,
                            record.last_error_code,
                            record.last_error_message,
                            record.provider,
                            record.model,
                            record.prompt_tokens,
                            record.completion_tokens,
                            record.cached_tokens,
                            record.total_tokens,
                            record.created_at,
                            record.started_at,
                            record.finished_at,
                        ),
                    )
                if event is not None:
                    self._insert_event_from_connection(conn, self.workspace_key, event)
        return record

    def update_run(
        self,
        run_id: str,
        *,
        current: RunRecord | None = None,
        event: RunEvent | None = None,
        expected_statuses: tuple[str, ...] | None = None,
        **updates: object,
    ) -> RunRecord | None:
        if not updates:
            if current is not None and current.run_id == run_id:
                return current
            return self.get_run(run_id)

        record_updates, serialized = self._serialize_run_updates(dict(updates))
        assignments: list[str] = []
        values: list[object] = []
        for column, value in serialized.items():
            suffix = "::jsonb" if column == "result_summary_json" else ""
            assignments.append(f"{column} = %s{suffix}")
            values.append(value)
        values.extend([self.workspace_key, run_id])
        status_filter = ""
        if expected_statuses:
            status_filter = " AND status = ANY(%s)"
            values.append(list(expected_statuses))

        updated = None
        with self._connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        UPDATE run_records
                        SET {", ".join(assignments)}
                        WHERE workspace_key = %s AND run_id = %s{status_filter}
                        RETURNING *
                        """,
                        values,
                    )
                    row = cur.fetchone()
                    if row is not None:
                        if event is not None:
                            self._insert_event_from_connection(conn, self.workspace_key, event)
                        updated = self._row_to_record(row)
        return updated

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._connection() as conn:
            return self._get_run_from_connection(conn, self.workspace_key, run_id)

    def list_runs(
        self,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        status: str | None = None,
        kind: str | None = None,
        agent_id: str | None = None,
        session_key: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        thread_id: str | None = None,
        limit: int = 50,
    ) -> list[RunRecord]:
        where, values = self._scoped_where()
        self._append_filter(where, values, "tenant_id", tenant_id)
        self._append_filter(where, values, "instance_id", instance_id)
        self._append_filter(where, values, "status", status)
        self._append_filter(where, values, "kind", kind)
        self._append_filter(where, values, "agent_id", agent_id)
        self._append_filter(where, values, "session_key", session_key)
        self._append_filter(where, values, "parent_run_id", parent_run_id)
        self._append_filter(where, values, "root_run_id", root_run_id)
        self._append_filter(where, values, "thread_id", thread_id)
        values.append(max(1, int(limit or 1)))

        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT * FROM run_records
                    WHERE {" AND ".join(where)}
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    values,
                )
                rows = cur.fetchall() or []
        return [record for row in rows if (record := self._row_to_record(row)) is not None]

    def count_runs(
        self,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        statuses: tuple[str, ...] | None = None,
        session_key: str | None = None,
        parent_run_id: str | None = None,
    ) -> int:
        where, values = self._scoped_where()
        self._append_filter(where, values, "tenant_id", tenant_id)
        self._append_filter(where, values, "instance_id", instance_id)
        if statuses:
            where.append("status = ANY(%s)")
            values.append(list(statuses))
        self._append_filter(where, values, "session_key", session_key)
        self._append_filter(where, values, "parent_run_id", parent_run_id)

        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT COUNT(*) AS count FROM run_records
                    WHERE {" AND ".join(where)}
                    """,
                    values,
                )
                row = cur.fetchone()
        return int((row or {}).get("count") or 0)

    def get_global_token_metrics(
        self,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> dict[str, int]:
        where, values = self._scoped_where()
        self._append_filter(where, values, "tenant_id", tenant_id)
        self._append_filter(where, values, "instance_id", instance_id)

        with self._connection() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        SELECT
                            SUM(prompt_tokens) AS p,
                            SUM(completion_tokens) AS c,
                            SUM(cached_tokens) AS ca,
                            SUM(total_tokens) AS t
                        FROM run_records
                        WHERE {" AND ".join(where)}
                        """,
                        values,
                    )
                    row = cur.fetchone()
                if row and row.get("t") is not None:
                    return {
                        "prompt_tokens": int(row.get("p") or 0),
                        "completion_tokens": int(row.get("c") or 0),
                        "cached_tokens": int(row.get("ca") or 0),
                        "total_tokens": int(row.get("t") or 0),
                    }
                return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "total_tokens": 0}
            except Exception:
                return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "total_tokens": 0}

    def get_all_agents_metrics(
        self,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        since: str | None = None,
        until: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        where, values = self._scoped_where()
        where.extend(["agent_id IS NOT NULL", "agent_id != ''"])
        self._append_filter(where, values, "tenant_id", tenant_id)
        self._append_filter(where, values, "instance_id", instance_id)
        if since is not None:
            where.append("created_at >= %s")
            values.append(since)
        if until is not None:
            where.append("created_at <= %s")
            values.append(until)

        agents_metrics: dict[str, dict[str, Any]] = {}
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        agent_id,
                        provider,
                        model,
                        SUM(prompt_tokens) AS p,
                        SUM(completion_tokens) AS c,
                        SUM(cached_tokens) AS ca,
                        SUM(total_tokens) AS t
                    FROM run_records
                    WHERE {" AND ".join(where)}
                    GROUP BY agent_id, provider, model
                    """,
                    values,
                )
                token_rows = cur.fetchall() or []
                cur.execute(
                    f"""
                    SELECT agent_id, result_summary_json
                    FROM run_records
                    WHERE {" AND ".join(where)} AND result_summary_json IS NOT NULL
                    """,
                    values,
                )
                summary_rows = cur.fetchall() or []

        for row in token_rows:
            agent_id = str(row.get("agent_id") or "")
            if agent_id not in agents_metrics:
                agents_metrics[agent_id] = {"tokens": [], "tools": {}, "mcps": {}, "knowledge": {}}
            if int(row.get("t") or 0) <= 0:
                continue
            agents_metrics[agent_id]["tokens"].append(
                {
                    "provider": row.get("provider") or "unknown",
                    "model": row.get("model") or "unknown",
                    "promptTokens": int(row.get("p") or 0),
                    "completionTokens": int(row.get("c") or 0),
                    "cachedTokens": int(row.get("ca") or 0),
                    "totalTokens": int(row.get("t") or 0),
                }
            )

        for row in summary_rows:
            agent_id = str(row.get("agent_id") or "")
            if agent_id not in agents_metrics:
                agents_metrics[agent_id] = {"tokens": [], "tools": {}, "mcps": {}, "knowledge": {}}
            summary = self._deserialize_result_summary(row.get("result_summary_json"))
            if summary is None:
                continue
            for name, count in summary.tools_call_counts.items():
                agents_metrics[agent_id]["tools"][name] = agents_metrics[agent_id]["tools"].get(name, 0) + int(count)
            for name, count in summary.mcps_call_counts.items():
                agents_metrics[agent_id]["mcps"][name] = agents_metrics[agent_id]["mcps"].get(name, 0) + int(count)
            for name, count in summary.knowledge_call_counts.items():
                agents_metrics[agent_id]["knowledge"][name] = agents_metrics[agent_id]["knowledge"].get(name, 0) + int(count)

        return agents_metrics

    def get_time_series_metrics(
        self,
        *,
        bucket: str = "day",
        since: str | None = None,
        until: str | None = None,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Aggregate run metrics into time buckets for trend charts."""
        bucket_expr = self._BUCKET_SQL.get(bucket, self._BUCKET_SQL["day"])
        where, values = self._scoped_where()
        self._append_filter(where, values, "tenant_id", tenant_id)
        self._append_filter(where, values, "instance_id", instance_id)
        if since is not None:
            where.append("created_at >= %s")
            values.append(since)
        if until is not None:
            where.append("created_at <= %s")
            values.append(until)

        with self._connection() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        SELECT
                            {bucket_expr} AS bucket,
                            agent_id,
                            model,
                            COUNT(*) AS run_count,
                            SUM(prompt_tokens) AS p,
                            SUM(completion_tokens) AS c,
                            SUM(cached_tokens) AS ca,
                            SUM(total_tokens) AS t
                        FROM run_records
                        WHERE {" AND ".join(where)}
                        GROUP BY 1, agent_id, model
                        ORDER BY 1 ASC
                        """,
                        values,
                    )
                    rows = cur.fetchall() or []
                return [
                    {
                        "bucket": str(row.get("bucket") or ""),
                        "agentId": row.get("agent_id"),
                        "model": row.get("model"),
                        "runCount": int(row.get("run_count") or 0),
                        "totalTokens": int(row.get("t") or 0),
                        "promptTokens": int(row.get("p") or 0),
                        "completionTokens": int(row.get("c") or 0),
                        "cachedTokens": int(row.get("ca") or 0),
                    }
                    for row in rows
                ]
            except Exception:
                return []

    def get_tool_usage_ranking(
        self,
        *,
        limit: int = 10,
        since: str | None = None,
        until: str | None = None,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Rank tools by total call frequency across all agents."""
        where, values = self._scoped_where()
        where.append("result_summary_json IS NOT NULL")
        self._append_filter(where, values, "tenant_id", tenant_id)
        self._append_filter(where, values, "instance_id", instance_id)
        if since is not None:
            where.append("created_at >= %s")
            values.append(since)
        if until is not None:
            where.append("created_at <= %s")
            values.append(until)

        with self._connection() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        SELECT agent_id, result_summary_json
                        FROM run_records
                        WHERE {" AND ".join(where)}
                        """,
                        values,
                    )
                    rows = cur.fetchall() or []
            except Exception:
                return []

        tool_counts: dict[str, int] = {}
        tool_agents: dict[str, set[str]] = {}
        for row in rows:
            summary = self._deserialize_result_summary(row.get("result_summary_json"))
            if summary is None:
                continue
            agent_id = str(row.get("agent_id") or "unknown")
            for tool_name, count in summary.tools_call_counts.items():
                normalized = int(count)
                if normalized <= 0:
                    continue
                tool_counts[tool_name] = tool_counts.get(tool_name, 0) + normalized
                tool_agents.setdefault(tool_name, set()).add(agent_id)

        ranked = sorted(tool_counts.items(), key=lambda item: item[1], reverse=True)[: max(1, int(limit or 1))]
        return [
            {"tool": name, "count": count, "agents": sorted(tool_agents.get(name, set()))}
            for name, count in ranked
        ]

    def get_overview_metrics(
        self,
        *,
        since: str | None = None,
        until: str | None = None,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> dict[str, Any]:
        """Global overview metrics for the dashboard top-level cards."""
        where, values = self._scoped_where()
        self._append_filter(where, values, "tenant_id", tenant_id)
        self._append_filter(where, values, "instance_id", instance_id)
        if since is not None:
            where.append("created_at >= %s")
            values.append(since)
        if until is not None:
            where.append("created_at <= %s")
            values.append(until)

        with self._connection() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        SELECT
                            COUNT(*) AS total_runs,
                            COUNT(DISTINCT agent_id) AS active_agents,
                            COUNT(DISTINCT model) AS active_models,
                            SUM(prompt_tokens) AS p,
                            SUM(completion_tokens) AS c,
                            SUM(cached_tokens) AS ca,
                            SUM(total_tokens) AS t
                        FROM run_records
                        WHERE {" AND ".join(where)}
                        """,
                        values,
                    )
                    row = cur.fetchone()
                    cur.execute(
                        f"""
                        SELECT status, COUNT(*) AS cnt
                        FROM run_records
                        WHERE {" AND ".join(where)}
                        GROUP BY status
                        """,
                        values,
                    )
                    status_rows = cur.fetchall() or []
                runs_by_status = {
                    str(status_row.get("status") or ""): int(status_row.get("cnt") or 0)
                    for status_row in status_rows
                    if status_row.get("status") is not None
                }
                return {
                    "totalRuns": int((row or {}).get("total_runs") or 0),
                    "activeAgents": int((row or {}).get("active_agents") or 0),
                    "activeModels": int((row or {}).get("active_models") or 0),
                    "totalTokens": int((row or {}).get("t") or 0),
                    "promptTokens": int((row or {}).get("p") or 0),
                    "completionTokens": int((row or {}).get("c") or 0),
                    "cachedTokens": int((row or {}).get("ca") or 0),
                    "runsByStatus": runs_by_status,
                }
            except Exception:
                return {
                    "totalRuns": 0,
                    "activeAgents": 0,
                    "activeModels": 0,
                    "totalTokens": 0,
                    "promptTokens": 0,
                    "completionTokens": 0,
                    "cachedTokens": 0,
                    "runsByStatus": {},
                }

    def insert_event(self, event: RunEvent) -> RunEvent:
        with self._connection() as conn:
            return self._insert_event_from_connection(conn, self.workspace_key, event)

    def list_events(self, run_id: str) -> list[RunEvent]:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT event_id, run_id, event_type, payload_json, created_at
                    FROM run_events
                    WHERE workspace_key = %s AND run_id = %s
                    ORDER BY event_id ASC
                    """,
                    (self.workspace_key, run_id),
                )
                rows = cur.fetchall() or []
        return [
            RunEvent(
                event_id=int(row.get("event_id") or 0),
                run_id=str(row.get("run_id") or ""),
                event_type=str(row.get("event_type") or ""),
                payload=pg_dict(row.get("payload_json")),
                created_at=str(row.get("created_at") or ""),
            )
            for row in rows
        ]

    def put_artifact(
        self,
        run_id: str,
        *,
        tenant_id: str,
        instance_id: str,
        artifact_path: str,
        file_name: str,
        content_type: str,
        content_text: str,
        storage_scope: str,
        storage_key: str,
        timestamp: str,
    ) -> dict[str, Any]:
        with self._connection() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO run_artifacts (
                            workspace_key, run_id, tenant_id, instance_id,
                            artifact_path, file_name, content_type, content_text,
                            storage_scope, storage_key, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (workspace_key, run_id) DO UPDATE SET
                            tenant_id = EXCLUDED.tenant_id,
                            instance_id = EXCLUDED.instance_id,
                            artifact_path = EXCLUDED.artifact_path,
                            file_name = EXCLUDED.file_name,
                            content_type = EXCLUDED.content_type,
                            content_text = EXCLUDED.content_text,
                            storage_scope = EXCLUDED.storage_scope,
                            storage_key = EXCLUDED.storage_key,
                            updated_at = EXCLUDED.updated_at
                        RETURNING *
                        """,
                        (
                            self.workspace_key,
                            run_id,
                            tenant_id,
                            instance_id,
                            artifact_path,
                            file_name,
                            content_type,
                            content_text,
                            storage_scope,
                            storage_key,
                            timestamp,
                            timestamp,
                        ),
                    )
                    row = cur.fetchone()
        return dict(row or {})

    def get_artifact_record(self, run_id: str) -> dict[str, Any] | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM run_artifacts
                    WHERE workspace_key = %s AND run_id = %s
                    """,
                    (self.workspace_key, run_id),
                )
                row = cur.fetchone()
        return dict(row) if row is not None else None


def create_run_store(config: Any, instance: Any) -> RunStore:
    """Create the unified run registry store (PostgreSQL only)."""
    rag = getattr(config, "rag", None)
    postgres = getattr(rag, "postgres", None) if rag is not None else None
    return RunStore(instance.data_dir, postgres=postgres)
