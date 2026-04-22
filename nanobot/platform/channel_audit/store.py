"""PostgreSQL persistence for channel audit entries."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from nanobot.config.schema import RagPostgresConfig
from nanobot.platform.channel_audit.models import ChannelAuditEntry
from nanobot.platform.postgres_store import WorkspacePostgresStore
from nanobot.storage.postgres import pg_dict, pg_json


class ChannelAuditStore(WorkspacePostgresStore):
    """Persist channel audit entries in one shared PostgreSQL store."""

    _FEATURE_NAME = "Channel audit store"
    _SCHEMA_NAMESPACE = "platform_channel_audit"
    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS channel_audit (
            workspace_key TEXT NOT NULL,
            audit_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            channel_name TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            session_key TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            message_preview TEXT NOT NULL,
            status TEXT NOT NULL,
            resolved BOOLEAN NOT NULL DEFAULT FALSE,
            resolution_kind TEXT NOT NULL DEFAULT 'none',
            binding_id TEXT,
            target_type TEXT,
            target_id TEXT,
            message_id TEXT,
            dispatch_run_id TEXT,
            artifact_path TEXT,
            response_preview TEXT,
            error_message TEXT,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_key, audit_id)
        );

        CREATE INDEX IF NOT EXISTS idx_channel_audit_scope_created
        ON channel_audit(workspace_key, tenant_id, instance_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_channel_audit_channel
        ON channel_audit(workspace_key, tenant_id, instance_id, channel_name, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_channel_audit_status
        ON channel_audit(workspace_key, tenant_id, instance_id, status, created_at DESC);
    """

    def __init__(self, workspace: Path, postgres: RagPostgresConfig | dict[str, Any] | None = None):
        super().__init__(workspace, postgres)

    @staticmethod
    def _deserialize(row: dict[str, Any] | None) -> ChannelAuditEntry | None:
        if row is None:
            return None
        payload = dict(row)
        payload["metadata_json"] = pg_dict(payload.get("metadata_json"))
        return ChannelAuditEntry.from_record(payload)

    def create(self, entry: ChannelAuditEntry) -> ChannelAuditEntry:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO channel_audit (
                        workspace_key,
                        audit_id,
                        tenant_id,
                        instance_id,
                        channel_name,
                        chat_id,
                        session_key,
                        sender_id,
                        message_preview,
                        status,
                        resolved,
                        resolution_kind,
                        binding_id,
                        target_type,
                        target_id,
                        message_id,
                        dispatch_run_id,
                        artifact_path,
                        response_preview,
                        error_message,
                        metadata_json,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        self.workspace_key,
                        entry.audit_id,
                        entry.tenant_id,
                        entry.instance_id,
                        entry.channel_name,
                        entry.chat_id,
                        entry.session_key,
                        entry.sender_id,
                        entry.message_preview,
                        entry.status.value,
                        bool(entry.resolved),
                        entry.resolution_kind,
                        entry.binding_id,
                        entry.target_type,
                        entry.target_id,
                        entry.message_id,
                        entry.dispatch_run_id,
                        entry.artifact_path,
                        entry.response_preview,
                        entry.error_message,
                        pg_json(entry.metadata or {}),
                        entry.created_at,
                        entry.updated_at,
                    ),
                )
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
        clauses = ["workspace_key = %s", "audit_id = %s"]
        params: list[Any] = [self.workspace_key, audit_id]
        if tenant_id is not None:
            clauses.append("tenant_id = %s")
            params.append(tenant_id)
        if instance_id is not None:
            clauses.append("instance_id = %s")
            params.append(instance_id)
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM channel_audit WHERE {' AND '.join(clauses)}",
                    params,
                )
                row = cur.fetchone()
        return self._deserialize(row)

    def update(
        self,
        entry: ChannelAuditEntry,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> ChannelAuditEntry | None:
        clauses = ["workspace_key = %s", "audit_id = %s"]
        params: list[Any] = [self.workspace_key, entry.audit_id]
        if tenant_id is not None:
            clauses.append("tenant_id = %s")
            params.append(tenant_id)
        if instance_id is not None:
            clauses.append("instance_id = %s")
            params.append(instance_id)
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE channel_audit
                    SET status = %s, resolved = %s, resolution_kind = %s, binding_id = %s, target_type = %s,
                        target_id = %s, message_id = %s, dispatch_run_id = %s, artifact_path = %s,
                        response_preview = %s, error_message = %s, metadata_json = %s::jsonb, updated_at = %s
                    WHERE {' AND '.join(clauses)}
                    """,
                    (
                        entry.status.value,
                        bool(entry.resolved),
                        entry.resolution_kind,
                        entry.binding_id,
                        entry.target_type,
                        entry.target_id,
                        entry.message_id,
                        entry.dispatch_run_id,
                        entry.artifact_path,
                        entry.response_preview,
                        entry.error_message,
                        pg_json(entry.metadata or {}),
                        entry.updated_at,
                        *params,
                    ),
                )
                updated = cur.rowcount > 0
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
        clauses = ["workspace_key = %s", "tenant_id = %s", "instance_id = %s"]
        params: list[Any] = [self.workspace_key, tenant_id, instance_id]
        if channel_name:
            clauses.append("channel_name = %s")
            params.append(channel_name)
        if chat_id:
            clauses.append("chat_id = %s")
            params.append(chat_id)
        if status:
            clauses.append("status = %s")
            params.append(status)
        normalized_query = str(query or "").strip()
        if normalized_query:
            like = f"%{normalized_query}%"
            clauses.append(
                "(chat_id ILIKE %s OR session_key ILIKE %s OR sender_id ILIKE %s OR message_preview ILIKE %s OR "
                "COALESCE(binding_id, '') ILIKE %s OR COALESCE(target_id, '') ILIKE %s OR "
                "COALESCE(response_preview, '') ILIKE %s OR COALESCE(error_message, '') ILIKE %s)"
            )
            params.extend([like, like, like, like, like, like, like, like])
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT * FROM channel_audit
                    WHERE {' AND '.join(clauses)}
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (*params, max(1, min(int(limit or 100), 500))),
                )
                rows = cur.fetchall()
        return [entry for row in rows if (entry := self._deserialize(row)) is not None]
