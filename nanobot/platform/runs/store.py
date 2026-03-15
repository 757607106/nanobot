"""SQLite-backed run registry store."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from nanobot.platform.runs.models import (
    RunControlScope,
    RunEvent,
    RunKind,
    RunRecord,
    RunResultSummary,
    RunStatus,
)


class RunStore:
    """Persist run records and events in SQLite."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS run_records (
            run_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            label TEXT NOT NULL,
            task_preview TEXT NOT NULL,
            agent_id TEXT,
            team_id TEXT,
            thread_id TEXT,
            parent_run_id TEXT,
            root_run_id TEXT NOT NULL,
            session_key TEXT,
            origin_channel TEXT,
            origin_chat_id TEXT,
            spawn_depth INTEGER NOT NULL DEFAULT 0,
            control_scope TEXT NOT NULL DEFAULT 'top_level',
            workspace_path TEXT,
            memory_scope TEXT,
            knowledge_scope TEXT,
            result_summary_json TEXT,
            artifact_path TEXT,
            last_error_code TEXT,
            last_error_message TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_run_records_tenant_instance
        ON run_records(tenant_id, instance_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_run_records_status
        ON run_records(status);
        CREATE INDEX IF NOT EXISTS idx_run_records_root_run_id
        ON run_records(root_run_id);
        CREATE INDEX IF NOT EXISTS idx_run_records_parent_run_id
        ON run_records(parent_run_id);
        CREATE INDEX IF NOT EXISTS idx_run_records_session_key
        ON run_records(session_key);
        CREATE INDEX IF NOT EXISTS idx_run_records_agent_id
        ON run_records(agent_id);
        CREATE INDEX IF NOT EXISTS idx_run_records_team_id
        ON run_records(team_id);
        CREATE INDEX IF NOT EXISTS idx_run_records_created_at
        ON run_records(created_at DESC);

        CREATE TABLE IF NOT EXISTS run_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_run_events_run_id
        ON run_events(run_id, event_id ASC);
        CREATE INDEX IF NOT EXISTS idx_run_events_created_at
        ON run_events(created_at DESC);
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
    def _serialize_result_summary(summary: RunResultSummary | None) -> str | None:
        if summary is None:
            return None
        return json.dumps(
            {
                "content": summary.content,
                "tools_used": summary.tools_used,
                "metadata": summary.metadata,
            },
            ensure_ascii=False,
        )

    @staticmethod
    def _deserialize_result_summary(raw: str | None) -> RunResultSummary | None:
        if not raw:
            return None
        payload = json.loads(raw)
        return RunResultSummary(
            content=payload.get("content"),
            tools_used=list(payload.get("tools_used") or []),
            metadata=dict(payload.get("metadata") or {}),
        )

    @classmethod
    def _row_to_record(cls, row: sqlite3.Row | None) -> RunRecord | None:
        if row is None:
            return None
        return RunRecord(
            run_id=row["run_id"],
            tenant_id=row["tenant_id"],
            instance_id=row["instance_id"],
            kind=RunKind(row["kind"]),
            status=RunStatus(row["status"]),
            label=row["label"],
            task_preview=row["task_preview"],
            agent_id=row["agent_id"],
            team_id=row["team_id"],
            thread_id=row["thread_id"],
            parent_run_id=row["parent_run_id"],
            root_run_id=row["root_run_id"],
            session_key=row["session_key"],
            origin_channel=row["origin_channel"],
            origin_chat_id=row["origin_chat_id"],
            spawn_depth=int(row["spawn_depth"]),
            control_scope=RunControlScope(row["control_scope"]),
            workspace_path=row["workspace_path"],
            memory_scope=row["memory_scope"],
            knowledge_scope=row["knowledge_scope"],
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            last_error_code=row["last_error_code"],
            last_error_message=row["last_error_message"],
            result_summary=cls._deserialize_result_summary(row["result_summary_json"]),
            artifact_path=row["artifact_path"],
        )

    def insert_run(self, record: RunRecord) -> RunRecord:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO run_records (
                run_id, tenant_id, instance_id, kind, status, label, task_preview,
                agent_id, team_id, thread_id, parent_run_id, root_run_id, session_key,
                origin_channel, origin_chat_id, spawn_depth, control_scope,
                workspace_path, memory_scope, knowledge_scope, result_summary_json,
                artifact_path, last_error_code, last_error_message, created_at,
                started_at, finished_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.run_id,
                record.tenant_id,
                record.instance_id,
                record.kind.value,
                record.status.value,
                record.label,
                record.task_preview,
                record.agent_id,
                record.team_id,
                record.thread_id,
                record.parent_run_id,
                record.root_run_id or record.run_id,
                record.session_key,
                record.origin_channel,
                record.origin_chat_id,
                record.spawn_depth,
                record.control_scope.value,
                record.workspace_path,
                record.memory_scope,
                record.knowledge_scope,
                self._serialize_result_summary(record.result_summary),
                record.artifact_path,
                record.last_error_code,
                record.last_error_message,
                record.created_at,
                record.started_at,
                record.finished_at,
            ),
        )
        conn.commit()
        conn.close()
        return record

    def update_run(self, run_id: str, **updates: object) -> RunRecord | None:
        if not updates:
            return self.get_run(run_id)
        normalized: dict[str, object] = dict(updates)
        if "kind" in normalized and isinstance(normalized["kind"], RunKind):
            normalized["kind"] = normalized["kind"].value
        if "status" in normalized and isinstance(normalized["status"], RunStatus):
            normalized["status"] = normalized["status"].value
        if "control_scope" in normalized and isinstance(normalized["control_scope"], RunControlScope):
            normalized["control_scope"] = normalized["control_scope"].value
        if "result_summary" in normalized and isinstance(
            normalized["result_summary"],
            (RunResultSummary, type(None)),
        ):
            normalized["result_summary_json"] = self._serialize_result_summary(normalized.pop("result_summary"))  # type: ignore[arg-type]

        assignments = ", ".join(f"{column} = ?" for column in normalized)
        values = list(normalized.values()) + [run_id]

        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(f"UPDATE run_records SET {assignments} WHERE run_id = ?", values)
        conn.commit()
        conn.close()
        if cursor.rowcount <= 0:
            return None
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> RunRecord | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM run_records WHERE run_id = ?", (run_id,)).fetchone()
        conn.close()
        return self._row_to_record(row)

    def list_runs(
        self,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        status: str | None = None,
        kind: str | None = None,
        agent_id: str | None = None,
        team_id: str | None = None,
        session_key: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        thread_id: str | None = None,
        limit: int = 50,
    ) -> list[RunRecord]:
        where: list[str] = []
        values: list[object] = []
        if tenant_id is not None:
            where.append("tenant_id = ?")
            values.append(tenant_id)
        if instance_id is not None:
            where.append("instance_id = ?")
            values.append(instance_id)
        if status is not None:
            where.append("status = ?")
            values.append(status)
        if kind is not None:
            where.append("kind = ?")
            values.append(kind)
        if agent_id is not None:
            where.append("agent_id = ?")
            values.append(agent_id)
        if team_id is not None:
            where.append("team_id = ?")
            values.append(team_id)
        if session_key is not None:
            where.append("session_key = ?")
            values.append(session_key)
        if parent_run_id is not None:
            where.append("parent_run_id = ?")
            values.append(parent_run_id)
        if root_run_id is not None:
            where.append("root_run_id = ?")
            values.append(root_run_id)
        if thread_id is not None:
            where.append("thread_id = ?")
            values.append(thread_id)
        where_clause = f"WHERE {' AND '.join(where)}" if where else ""

        conn = self._connect()
        rows = conn.execute(
            f"SELECT * FROM run_records {where_clause} ORDER BY created_at DESC LIMIT ?",
            values + [limit],
        ).fetchall()
        conn.close()
        return [record for row in rows if (record := self._row_to_record(row)) is not None]

    def count_runs(
        self,
        *,
        statuses: tuple[str, ...] | None = None,
        session_key: str | None = None,
        parent_run_id: str | None = None,
    ) -> int:
        where: list[str] = []
        values: list[object] = []
        if statuses:
            placeholders = ", ".join("?" for _ in statuses)
            where.append(f"status IN ({placeholders})")
            values.extend(statuses)
        if session_key is not None:
            where.append("session_key = ?")
            values.append(session_key)
        if parent_run_id is not None:
            where.append("parent_run_id = ?")
            values.append(parent_run_id)
        where_clause = f"WHERE {' AND '.join(where)}" if where else ""
        conn = self._connect()
        row = conn.execute(
            f"SELECT COUNT(*) AS count FROM run_records {where_clause}",
            values,
        ).fetchone()
        conn.close()
        return int(row["count"]) if row is not None else 0

    def insert_event(self, event: RunEvent) -> RunEvent:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO run_events (run_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                event.run_id,
                event.event_type,
                json.dumps(event.payload or {}, ensure_ascii=False),
                event.created_at,
            ),
        )
        conn.commit()
        event_id = cursor.lastrowid
        conn.close()
        return RunEvent(
            run_id=event.run_id,
            event_type=event.event_type,
            payload=event.payload,
            event_id=event_id,
            created_at=event.created_at,
        )

    def list_events(self, run_id: str) -> list[RunEvent]:
        conn = self._connect()
        rows = conn.execute(
            "SELECT event_id, run_id, event_type, payload_json, created_at FROM run_events WHERE run_id = ? ORDER BY event_id ASC",
            (run_id,),
        ).fetchall()
        conn.close()
        events: list[RunEvent] = []
        for row in rows:
            payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
            events.append(
                RunEvent(
                    event_id=int(row["event_id"]),
                    run_id=row["run_id"],
                    event_type=row["event_type"],
                    payload=payload,
                    created_at=row["created_at"],
                )
            )
        return events
