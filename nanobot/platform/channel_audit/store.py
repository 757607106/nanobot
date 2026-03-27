"""SQLite persistence for channel audit entries."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from nanobot.platform.channel_audit.models import ChannelAuditEntry


class ChannelAuditStore:
    """Persist channel audit entries in an instance-scoped SQLite file."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS channel_audit (
            audit_id          TEXT PRIMARY KEY,
            tenant_id         TEXT NOT NULL DEFAULT 'default',
            instance_id       TEXT NOT NULL,
            channel_name      TEXT NOT NULL,
            chat_id           TEXT NOT NULL,
            session_key       TEXT NOT NULL,
            sender_id         TEXT NOT NULL,
            message_preview   TEXT NOT NULL,
            status            TEXT NOT NULL,
            resolved          INTEGER NOT NULL DEFAULT 0,
            resolution_kind   TEXT NOT NULL DEFAULT 'none',
            binding_id        TEXT,
            target_type       TEXT,
            target_id         TEXT,
            message_id        TEXT,
            dispatch_run_id   TEXT,
            artifact_path     TEXT,
            response_preview  TEXT,
            error_message     TEXT,
            metadata_json     TEXT NOT NULL DEFAULT '{}',
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_channel_audit_scope_created
        ON channel_audit(tenant_id, instance_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_channel_audit_channel
        ON channel_audit(tenant_id, instance_id, channel_name, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_channel_audit_status
        ON channel_audit(tenant_id, instance_id, status, created_at DESC);
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
    def _deserialize(row: sqlite3.Row | None) -> ChannelAuditEntry | None:
        if row is None:
            return None
        payload = dict(row)
        try:
            payload["metadata_json"] = json.loads(str(payload.get("metadata_json") or "{}"))
        except Exception:
            payload["metadata_json"] = {}
        return ChannelAuditEntry.from_record(payload)

    def create(self, entry: ChannelAuditEntry) -> ChannelAuditEntry:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO channel_audit (
                audit_id, tenant_id, instance_id, channel_name, chat_id, session_key,
                sender_id, message_preview, status, resolved, resolution_kind, binding_id,
                target_type, target_id, message_id, dispatch_run_id, artifact_path,
                response_preview, error_message, metadata_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry.audit_id,
                entry.tenant_id,
                entry.instance_id,
                entry.channel_name,
                entry.chat_id,
                entry.session_key,
                entry.sender_id,
                entry.message_preview,
                entry.status.value,
                1 if entry.resolved else 0,
                entry.resolution_kind,
                entry.binding_id,
                entry.target_type,
                entry.target_id,
                entry.message_id,
                entry.dispatch_run_id,
                entry.artifact_path,
                entry.response_preview,
                entry.error_message,
                json.dumps(entry.metadata or {}, ensure_ascii=True),
                entry.created_at,
                entry.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get(entry.audit_id, tenant_id=entry.tenant_id, instance_id=entry.instance_id)
        if created is None:
            raise RuntimeError(f"Failed to load created channel audit entry {entry.audit_id}")
        return created

    def get(
        self,
        audit_id: str,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> ChannelAuditEntry | None:
        clauses = ["audit_id = ?"]
        params: list[object] = [audit_id]
        if tenant_id is not None:
            clauses.append("tenant_id = ?")
            params.append(tenant_id)
        if instance_id is not None:
            clauses.append("instance_id = ?")
            params.append(instance_id)
        conn = self._connect()
        row = conn.execute(
            f"SELECT * FROM channel_audit WHERE {' AND '.join(clauses)}",
            tuple(params),
        ).fetchone()
        conn.close()
        return self._deserialize(row)

    def update(
        self,
        entry: ChannelAuditEntry,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> ChannelAuditEntry | None:
        clauses = ["audit_id = ?"]
        params: list[object] = [entry.audit_id]
        if tenant_id is not None:
            clauses.append("tenant_id = ?")
            params.append(tenant_id)
        if instance_id is not None:
            clauses.append("instance_id = ?")
            params.append(instance_id)
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            f"""
            UPDATE channel_audit
            SET status = ?, resolved = ?, resolution_kind = ?, binding_id = ?, target_type = ?,
                target_id = ?, message_id = ?, dispatch_run_id = ?, artifact_path = ?,
                response_preview = ?, error_message = ?, metadata_json = ?, updated_at = ?
            WHERE {' AND '.join(clauses)}
            """,
            (
                entry.status.value,
                1 if entry.resolved else 0,
                entry.resolution_kind,
                entry.binding_id,
                entry.target_type,
                entry.target_id,
                entry.message_id,
                entry.dispatch_run_id,
                entry.artifact_path,
                entry.response_preview,
                entry.error_message,
                json.dumps(entry.metadata or {}, ensure_ascii=True),
                entry.updated_at,
                *params,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get(entry.audit_id, tenant_id=tenant_id, instance_id=instance_id)

    def list_entries(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        limit: int = 100,
        channel_name: str | None = None,
        chat_id: str | None = None,
        status: str | None = None,
        query: str | None = None,
    ) -> list[ChannelAuditEntry]:
        clauses = ["tenant_id = ?", "instance_id = ?"]
        params: list[object] = [tenant_id, instance_id]
        if channel_name:
            clauses.append("channel_name = ?")
            params.append(channel_name)
        if chat_id:
            clauses.append("chat_id = ?")
            params.append(chat_id)
        if status:
            clauses.append("status = ?")
            params.append(status)
        normalized_query = str(query or "").strip()
        if normalized_query:
            like = f"%{normalized_query}%"
            clauses.append(
                "(chat_id LIKE ? OR session_key LIKE ? OR sender_id LIKE ? OR message_preview LIKE ? OR "
                "COALESCE(binding_id, '') LIKE ? OR COALESCE(target_id, '') LIKE ? OR COALESCE(response_preview, '') LIKE ? OR "
                "COALESCE(error_message, '') LIKE ?)"
            )
            params.extend([like, like, like, like, like, like, like, like])
        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT * FROM channel_audit
            WHERE {' AND '.join(clauses)}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*params, max(1, min(int(limit or 100), 500))),
        ).fetchall()
        conn.close()
        return [entry for row in rows if (entry := self._deserialize(row)) is not None]
