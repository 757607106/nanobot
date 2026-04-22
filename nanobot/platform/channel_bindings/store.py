"""PostgreSQL store for channel bindings."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from nanobot.config.schema import RagPostgresConfig
from nanobot.platform.channel_bindings.models import ChannelBinding
from nanobot.platform.postgres_store import WorkspacePostgresStore
from nanobot.storage.postgres import pg_dict, pg_json


class ChannelBindingStore(WorkspacePostgresStore):
    """Persist channel bindings in one shared PostgreSQL store."""

    _FEATURE_NAME = "Channel binding store"
    _SCHEMA_NAMESPACE = "platform_channel_bindings"
    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS channel_bindings (
            workspace_key TEXT NOT NULL,
            binding_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            channel_name TEXT NOT NULL,
            channel_chat_id TEXT NOT NULL DEFAULT '*',
            target_type TEXT NOT NULL CHECK(target_type IN ('agent')),
            target_id TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 0,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_key, binding_id)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_bindings_unique
        ON channel_bindings(workspace_key, tenant_id, instance_id, channel_name, channel_chat_id);

        CREATE INDEX IF NOT EXISTS idx_channel_bindings_lookup
        ON channel_bindings(workspace_key, tenant_id, instance_id, channel_name, enabled, priority DESC);
    """

    def __init__(self, workspace: Path, postgres: RagPostgresConfig | dict[str, Any] | None = None):
        super().__init__(workspace, postgres)

    @staticmethod
    def _deserialize(row: dict[str, Any] | None) -> ChannelBinding | None:
        if row is None:
            return None
        payload = dict(row)
        payload["metadata_json"] = pg_json(pg_dict(payload.get("metadata_json")))
        return ChannelBinding.from_record(payload)

    def get(self, binding_id: str, *, tenant_id: str | None = None) -> ChannelBinding | None:
        where = ["workspace_key = %s", "binding_id = %s"]
        params: list[Any] = [self.workspace_key, binding_id]
        if tenant_id is not None:
            where.append("tenant_id = %s")
            params.append(tenant_id)
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM channel_bindings WHERE {' AND '.join(where)}",
                    params,
                )
                row = cur.fetchone()
        return self._deserialize(row)

    def resolve(
        self,
        *,
        channel_name: str,
        channel_chat_id: str,
        tenant_id: str,
        instance_id: str,
    ) -> ChannelBinding | None:
        """Resolve one binding: exact chat_id match first, then wildcard '*'. """
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM channel_bindings
                    WHERE workspace_key = %s
                      AND tenant_id = %s
                      AND instance_id = %s
                      AND channel_name = %s
                      AND enabled = TRUE
                      AND channel_chat_id IN (%s, '*')
                    ORDER BY
                        CASE WHEN channel_chat_id = %s THEN 1 ELSE 0 END DESC,
                        priority DESC,
                        updated_at DESC
                    LIMIT 1
                    """,
                    (
                        self.workspace_key,
                        tenant_id,
                        instance_id,
                        channel_name,
                        channel_chat_id,
                        channel_chat_id,
                    ),
                )
                row = cur.fetchone()
        return self._deserialize(row)

    def list_all(
        self,
        *,
        tenant_id: str,
        instance_id: str,
    ) -> list[ChannelBinding]:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM channel_bindings
                    WHERE workspace_key = %s AND tenant_id = %s AND instance_id = %s
                    ORDER BY channel_name ASC, priority DESC, updated_at DESC
                    """,
                    (self.workspace_key, tenant_id, instance_id),
                )
                rows = cur.fetchall()
        return [binding for row in rows if (binding := self._deserialize(row)) is not None]

    def create(self, binding: ChannelBinding) -> ChannelBinding:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO channel_bindings (
                        workspace_key,
                        binding_id,
                        tenant_id,
                        instance_id,
                        channel_name,
                        channel_chat_id,
                        target_type,
                        target_id,
                        priority,
                        enabled,
                        metadata_json,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        self.workspace_key,
                        binding.binding_id,
                        binding.tenant_id,
                        binding.instance_id,
                        binding.channel_name,
                        binding.channel_chat_id,
                        binding.target_type,
                        binding.target_id,
                        binding.priority,
                        bool(binding.enabled),
                        binding.to_storage_json(),
                        binding.created_at,
                        binding.updated_at,
                    ),
                )
        created = self.get(binding.binding_id)
        if created is None:
            raise RuntimeError(f"Failed to load created channel binding {binding.binding_id}")
        return created

    def update(self, binding: ChannelBinding, *, tenant_id: str | None = None) -> ChannelBinding | None:
        where = ["workspace_key = %s", "binding_id = %s"]
        params: list[Any] = [self.workspace_key, binding.binding_id]
        if tenant_id is not None:
            where.append("tenant_id = %s")
            params.append(tenant_id)
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE channel_bindings
                    SET channel_name = %s, channel_chat_id = %s, target_type = %s, target_id = %s,
                        priority = %s, enabled = %s, metadata_json = %s::jsonb, updated_at = %s
                    WHERE {' AND '.join(where)}
                    """,
                    (
                        binding.channel_name,
                        binding.channel_chat_id,
                        binding.target_type,
                        binding.target_id,
                        binding.priority,
                        bool(binding.enabled),
                        binding.to_storage_json(),
                        binding.updated_at,
                        *params,
                    ),
                )
                updated = cur.rowcount > 0
        if not updated:
            return None
        return self.get(binding.binding_id, tenant_id=tenant_id)

    def delete(self, binding_id: str, *, tenant_id: str | None = None) -> bool:
        where = ["workspace_key = %s", "binding_id = %s"]
        params: list[Any] = [self.workspace_key, binding_id]
        if tenant_id is not None:
            where.append("tenant_id = %s")
            params.append(tenant_id)
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM channel_bindings WHERE {' AND '.join(where)}",
                    params,
                )
                return cur.rowcount > 0
