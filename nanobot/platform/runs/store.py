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
            result_summary_json TEXT,
            artifact_path TEXT,
            last_error_code TEXT,
            last_error_message TEXT,
            provider TEXT,
            model TEXT,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            cached_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
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
        try:
            conn.execute("ALTER TABLE run_records ADD COLUMN provider TEXT;")
            conn.execute("ALTER TABLE run_records ADD COLUMN model TEXT;")
            conn.execute("ALTER TABLE run_records ADD COLUMN prompt_tokens INTEGER NOT NULL DEFAULT 0;")
            conn.execute("ALTER TABLE run_records ADD COLUMN completion_tokens INTEGER NOT NULL DEFAULT 0;")
            conn.execute("ALTER TABLE run_records ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE run_records ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;")
        except sqlite3.OperationalError:
            pass
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
                "tools_call_counts": summary.tools_call_counts,
                "mcps_call_counts": summary.mcps_call_counts,
                "knowledge_call_counts": summary.knowledge_call_counts,
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
            tools_call_counts=dict(payload.get("tools_call_counts") or {}),
            mcps_call_counts=dict(payload.get("mcps_call_counts") or {}),
            knowledge_call_counts=dict(payload.get("knowledge_call_counts") or {}),
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
            thread_id=row["thread_id"],
            parent_run_id=row["parent_run_id"],
            root_run_id=row["root_run_id"],
            session_key=row["session_key"],
            origin_channel=row["origin_channel"],
            origin_chat_id=row["origin_chat_id"],
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
            provider=row.keys().count("provider") > 0 and row["provider"] or None,
            model=row.keys().count("model") > 0 and row["model"] or None,
            prompt_tokens=row.keys().count("prompt_tokens") > 0 and row["prompt_tokens"] or 0,
            completion_tokens=row.keys().count("completion_tokens") > 0 and row["completion_tokens"] or 0,
            cached_tokens=row.keys().count("cached_tokens") > 0 and row["cached_tokens"] or 0,
            total_tokens=row.keys().count("total_tokens") > 0 and row["total_tokens"] or 0,
        )

    def insert_run(self, record: RunRecord) -> RunRecord:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO run_records (
                run_id, tenant_id, instance_id, kind, status, label, task_preview,
                agent_id, thread_id, parent_run_id, root_run_id, session_key,
                origin_channel, origin_chat_id, control_scope,
                workspace_path, memory_scope, knowledge_scope, result_summary_json,
                artifact_path, last_error_code, last_error_message,
                provider, model, prompt_tokens, completion_tokens, cached_tokens, total_tokens,
                created_at, started_at, finished_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        tenant_id: str | None = None,
        instance_id: str | None = None,
        statuses: tuple[str, ...] | None = None,
        session_key: str | None = None,
        parent_run_id: str | None = None,
    ) -> int:
        where: list[str] = []
        values: list[object] = []
        if tenant_id is not None:
            where.append("tenant_id = ?")
            values.append(tenant_id)
        if instance_id is not None:
            where.append("instance_id = ?")
            values.append(instance_id)
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

    def get_global_token_metrics(
        self,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> dict[str, int]:
        where: list[str] = []
        values: list[object] = []
        if tenant_id is not None:
            where.append("tenant_id = ?")
            values.append(tenant_id)
        if instance_id is not None:
            where.append("instance_id = ?")
            values.append(instance_id)

        where_clause = f"WHERE {' AND '.join(where)}" if where else ""
        conn = self._connect()
        try:
            row = conn.execute(
                f"SELECT SUM(prompt_tokens) AS p, SUM(completion_tokens) AS c, SUM(cached_tokens) AS ca, SUM(total_tokens) AS t FROM run_records {where_clause}",
                values,
            ).fetchone()
            if row and row["t"] is not None:
                return {
                    "prompt_tokens": int(row["p"] or 0),
                    "completion_tokens": int(row["c"] or 0),
                    "cached_tokens": int(row["ca"] or 0),
                    "total_tokens": int(row["t"] or 0),
                }
            return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "total_tokens": 0}
        except Exception:
            return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "total_tokens": 0}
        finally:
            conn.close()

    def get_all_agents_metrics(
        self,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        since: str | None = None,
        until: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        import json
        where: list[str] = ["agent_id IS NOT NULL", "agent_id != ''"]
        values: list[object] = []
        if tenant_id is not None:
            where.append("tenant_id = ?")
            values.append(tenant_id)
        if instance_id is not None:
            where.append("instance_id = ?")
            values.append(instance_id)
        if since is not None:
            where.append("created_at >= ?")
            values.append(since)
        if until is not None:
            where.append("created_at <= ?")
            values.append(until)

        where_clause = f"WHERE {' AND '.join(where)}"
        conn = self._connect()
        try:
            token_rows = conn.execute(
                f"""
                SELECT agent_id, provider, model, 
                       SUM(prompt_tokens) AS p, 
                       SUM(completion_tokens) AS c, 
                       SUM(cached_tokens) AS ca,
                       SUM(total_tokens) AS t
                FROM run_records 
                {where_clause}
                GROUP BY agent_id, provider, model
                """,
                values,
            ).fetchall()

            try:
                summary_rows = conn.execute(
                    f"""
                    SELECT agent_id,
                           json_extract(result_summary_json, '$.tools_call_counts') as tools_json,
                           json_extract(result_summary_json, '$.mcps_call_counts') as mcps_json,
                           json_extract(result_summary_json, '$.knowledge_call_counts') as kb_json
                    FROM run_records
                    {where_clause}
                    AND result_summary_json IS NOT NULL
                    """,
                    values,
                ).fetchall()
            except Exception:
                summary_rows = []

            agents_metrics: dict[str, dict[str, Any]] = {}

            for r in token_rows:
                aid = r["agent_id"]
                if aid not in agents_metrics:
                    agents_metrics[aid] = {"tokens": [], "tools": {}, "mcps": {}, "knowledge": {}}
                
                if int(r["t"] or 0) > 0:
                    agents_metrics[aid]["tokens"].append({
                        "provider": r["provider"] or "unknown",
                        "model": r["model"] or "unknown",
                        "promptTokens": int(r["p"] or 0),
                        "completionTokens": int(r["c"] or 0),
                        "cachedTokens": int(r["ca"] or 0),
                        "totalTokens": int(r["t"] or 0),
                    })
            
            for r in summary_rows:
                aid = r["agent_id"]
                if aid not in agents_metrics:
                    agents_metrics[aid] = {"tokens": [], "tools": {}, "mcps": {}, "knowledge": {}}
                
                def _merge_counts(target: dict[str, int], json_str: str | None) -> None:
                    if json_str:
                        try:
                            parsed = json.loads(json_str)
                            if isinstance(parsed, dict):
                                for k, v in parsed.items():
                                    target[k] = target.get(k, 0) + (int(v) if str(v).isdigit() else 0)
                        except Exception:
                            pass
                
                _merge_counts(agents_metrics[aid]["tools"], r["tools_json"])
                _merge_counts(agents_metrics[aid]["mcps"], r["mcps_json"])
                _merge_counts(agents_metrics[aid]["knowledge"], r["kb_json"])

            return agents_metrics
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Dashboard analytics queries
    # ------------------------------------------------------------------

    _BUCKET_FORMATS: dict[str, str] = {
        "hour": "%Y-%m-%dT%H:00:00Z",
        "day": "%Y-%m-%d",
        "week": "%Y-W%W",
        "month": "%Y-%m",
    }

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
        fmt = self._BUCKET_FORMATS.get(bucket, self._BUCKET_FORMATS["day"])
        where: list[str] = []
        values: list[object] = []
        if tenant_id is not None:
            where.append("tenant_id = ?")
            values.append(tenant_id)
        if instance_id is not None:
            where.append("instance_id = ?")
            values.append(instance_id)
        if since is not None:
            where.append("created_at >= ?")
            values.append(since)
        if until is not None:
            where.append("created_at <= ?")
            values.append(until)

        where_clause = f"WHERE {' AND '.join(where)}" if where else ""
        conn = self._connect()
        try:
            rows = conn.execute(
                f"""
                SELECT strftime('{fmt}', created_at) AS bucket,
                       agent_id, model,
                       COUNT(*) AS run_count,
                       SUM(prompt_tokens) AS p,
                       SUM(completion_tokens) AS c,
                       SUM(cached_tokens) AS ca,
                       SUM(total_tokens) AS t
                FROM run_records
                {where_clause}
                GROUP BY bucket, agent_id, model
                ORDER BY bucket ASC
                """,
                values,
            ).fetchall()
            return [
                {
                    "bucket": r["bucket"] or "",
                    "agentId": r["agent_id"],
                    "model": r["model"],
                    "runCount": int(r["run_count"] or 0),
                    "totalTokens": int(r["t"] or 0),
                    "promptTokens": int(r["p"] or 0),
                    "completionTokens": int(r["c"] or 0),
                    "cachedTokens": int(r["ca"] or 0),
                }
                for r in rows
            ]
        except Exception:
            return []
        finally:
            conn.close()

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
        where: list[str] = ["result_summary_json IS NOT NULL"]
        values: list[object] = []
        if tenant_id is not None:
            where.append("tenant_id = ?")
            values.append(tenant_id)
        if instance_id is not None:
            where.append("instance_id = ?")
            values.append(instance_id)
        if since is not None:
            where.append("created_at >= ?")
            values.append(since)
        if until is not None:
            where.append("created_at <= ?")
            values.append(until)

        where_clause = f"WHERE {' AND '.join(where)}"
        conn = self._connect()
        try:
            rows = conn.execute(
                f"""
                SELECT agent_id,
                       json_extract(result_summary_json, '$.tools_call_counts') AS tools_json
                FROM run_records
                {where_clause}
                """,
                values,
            ).fetchall()

            tool_counts: dict[str, int] = {}
            tool_agents: dict[str, set[str]] = {}
            for r in rows:
                tools_json = r["tools_json"]
                if not tools_json:
                    continue
                try:
                    parsed = json.loads(tools_json)
                    if not isinstance(parsed, dict):
                        continue
                    aid = r["agent_id"] or "unknown"
                    for tool_name, count_val in parsed.items():
                        count = int(count_val) if str(count_val).isdigit() else 0
                        if count > 0:
                            tool_counts[tool_name] = tool_counts.get(tool_name, 0) + count
                            tool_agents.setdefault(tool_name, set()).add(aid)
                except Exception:
                    pass

            ranked = sorted(tool_counts.items(), key=lambda x: x[1], reverse=True)[:limit]
            return [
                {"tool": name, "count": cnt, "agents": sorted(tool_agents.get(name, set()))}
                for name, cnt in ranked
            ]
        except Exception:
            return []
        finally:
            conn.close()

    def get_overview_metrics(
        self,
        *,
        since: str | None = None,
        until: str | None = None,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> dict[str, Any]:
        """Global overview metrics for the dashboard top-level cards."""
        where: list[str] = []
        values: list[object] = []
        if tenant_id is not None:
            where.append("tenant_id = ?")
            values.append(tenant_id)
        if instance_id is not None:
            where.append("instance_id = ?")
            values.append(instance_id)
        if since is not None:
            where.append("created_at >= ?")
            values.append(since)
        if until is not None:
            where.append("created_at <= ?")
            values.append(until)

        where_clause = f"WHERE {' AND '.join(where)}" if where else ""
        conn = self._connect()
        try:
            row = conn.execute(
                f"""
                SELECT COUNT(*) AS total_runs,
                       COUNT(DISTINCT agent_id) AS active_agents,
                       COUNT(DISTINCT model) AS active_models,
                       SUM(prompt_tokens) AS p,
                       SUM(completion_tokens) AS c,
                       SUM(cached_tokens) AS ca,
                       SUM(total_tokens) AS t
                FROM run_records {where_clause}
                """,
                values,
            ).fetchone()

            status_rows = conn.execute(
                f"""
                SELECT status, COUNT(*) AS cnt
                FROM run_records {where_clause}
                GROUP BY status
                """,
                values,
            ).fetchall()

            runs_by_status: dict[str, int] = {}
            for sr in status_rows:
                runs_by_status[sr["status"]] = int(sr["cnt"] or 0)

            return {
                "totalRuns": int(row["total_runs"] or 0) if row else 0,
                "activeAgents": int(row["active_agents"] or 0) if row else 0,
                "activeModels": int(row["active_models"] or 0) if row else 0,
                "totalTokens": int(row["t"] or 0) if row else 0,
                "promptTokens": int(row["p"] or 0) if row else 0,
                "completionTokens": int(row["c"] or 0) if row else 0,
                "cachedTokens": int(row["ca"] or 0) if row else 0,
                "runsByStatus": runs_by_status,
            }
        except Exception:
            return {
                "totalRuns": 0, "activeAgents": 0, "activeModels": 0,
                "totalTokens": 0, "promptTokens": 0, "completionTokens": 0,
                "cachedTokens": 0, "runsByStatus": {},
            }
        finally:
            conn.close()

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
