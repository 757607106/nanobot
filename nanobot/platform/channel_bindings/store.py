"""SQLite store for channel bindings."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from nanobot.platform.channel_bindings.models import ChannelBinding


class ChannelBindingStore:
    """Persist channel bindings in an instance-scoped SQLite file."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS channel_bindings (
            binding_id     TEXT PRIMARY KEY,
            tenant_id      TEXT NOT NULL DEFAULT 'default',
            instance_id    TEXT NOT NULL,
            channel_name   TEXT NOT NULL,
            channel_chat_id TEXT NOT NULL DEFAULT '*',
            target_type    TEXT NOT NULL CHECK(target_type IN ('agent', 'team')),
            target_id      TEXT NOT NULL,
            priority       INTEGER NOT NULL DEFAULT 0,
            enabled        INTEGER NOT NULL DEFAULT 1,
            metadata_json  TEXT NOT NULL DEFAULT '{}',
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_cb_unique_binding
        ON channel_bindings(tenant_id, instance_id, channel_name, channel_chat_id);

        CREATE INDEX IF NOT EXISTS idx_cb_lookup
        ON channel_bindings(tenant_id, instance_id, channel_name, enabled);
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
    def _deserialize(row: sqlite3.Row | None) -> ChannelBinding | None:
        if row is None:
            return None
        return ChannelBinding.from_record(dict(row))

    def get(self, binding_id: str) -> ChannelBinding | None:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM channel_bindings WHERE binding_id = ?",
            (binding_id,),
        ).fetchone()
        conn.close()
        return self._deserialize(row)

    def resolve(
        self,
        *,
        channel_name: str,
        channel_chat_id: str,
        tenant_id: str,
        instance_id: str,
    ) -> ChannelBinding | None:
        """Resolve a binding: exact chat_id match first, then wildcard '*'."""
        conn = self._connect()
        # Try exact match first
        row = conn.execute(
            """
            SELECT * FROM channel_bindings
            WHERE tenant_id = ? AND instance_id = ? AND channel_name = ?
                  AND channel_chat_id = ? AND enabled = 1
            ORDER BY priority DESC
            LIMIT 1
            """,
            (tenant_id, instance_id, channel_name, channel_chat_id),
        ).fetchone()
        if row is not None:
            conn.close()
            return self._deserialize(row)
        # Fallback to wildcard
        row = conn.execute(
            """
            SELECT * FROM channel_bindings
            WHERE tenant_id = ? AND instance_id = ? AND channel_name = ?
                  AND channel_chat_id = '*' AND enabled = 1
            ORDER BY priority DESC
            LIMIT 1
            """,
            (tenant_id, instance_id, channel_name),
        ).fetchone()
        conn.close()
        return self._deserialize(row)

    def list_all(
        self,
        *,
        tenant_id: str,
        instance_id: str,
    ) -> list[ChannelBinding]:
        conn = self._connect()
        rows = conn.execute(
            """
            SELECT * FROM channel_bindings
            WHERE tenant_id = ? AND instance_id = ?
            ORDER BY channel_name ASC, priority DESC, updated_at DESC
            """,
            (tenant_id, instance_id),
        ).fetchall()
        conn.close()
        return [b for row in rows if (b := self._deserialize(row)) is not None]

    def create(self, binding: ChannelBinding) -> ChannelBinding:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO channel_bindings (
                binding_id, tenant_id, instance_id, channel_name, channel_chat_id,
                target_type, target_id, priority, enabled, metadata_json,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                binding.binding_id,
                binding.tenant_id,
                binding.instance_id,
                binding.channel_name,
                binding.channel_chat_id,
                binding.target_type,
                binding.target_id,
                binding.priority,
                1 if binding.enabled else 0,
                binding.to_storage_json(),
                binding.created_at,
                binding.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get(binding.binding_id)
        if created is None:
            raise RuntimeError(f"Failed to load created channel binding {binding.binding_id}")
        return created

    def update(self, binding: ChannelBinding) -> ChannelBinding | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE channel_bindings
            SET channel_name = ?, channel_chat_id = ?, target_type = ?, target_id = ?,
                priority = ?, enabled = ?, metadata_json = ?, updated_at = ?
            WHERE binding_id = ?
            """,
            (
                binding.channel_name,
                binding.channel_chat_id,
                binding.target_type,
                binding.target_id,
                binding.priority,
                1 if binding.enabled else 0,
                binding.to_storage_json(),
                binding.updated_at,
                binding.binding_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get(binding.binding_id)

    def delete(self, binding_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM channel_bindings WHERE binding_id = ?", (binding_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted
