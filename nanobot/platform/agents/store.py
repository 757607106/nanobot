"""SQLite store for instance-scoped agent definitions."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from nanobot.platform.agents.models import AgentDefinition


class AgentDefinitionStore:
    """Persist agent definitions in an instance-scoped SQLite file."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS agent_definitions (
            agent_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            source_template_name TEXT,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_definitions_tenant_instance
        ON agent_definitions(tenant_id, instance_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_definitions_enabled
        ON agent_definitions(enabled);
        CREATE INDEX IF NOT EXISTS idx_agent_definitions_name
        ON agent_definitions(name);
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
    def _deserialize(row: sqlite3.Row | None) -> AgentDefinition | None:
        if row is None:
            return None
        return AgentDefinition.from_record(dict(row))

    def get(self, agent_id: str) -> AgentDefinition | None:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM agent_definitions WHERE agent_id = ?",
            (agent_id,),
        ).fetchone()
        conn.close()
        return self._deserialize(row)

    def get_by_name(self, name: str, *, tenant_id: str, instance_id: str) -> AgentDefinition | None:
        conn = self._connect()
        row = conn.execute(
            """
            SELECT * FROM agent_definitions
            WHERE tenant_id = ? AND instance_id = ? AND name = ?
            """,
            (tenant_id, instance_id, name),
        ).fetchone()
        conn.close()
        return self._deserialize(row)

    def list_all(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        enabled: bool | None = None,
    ) -> list[AgentDefinition]:
        where = ["tenant_id = ?", "instance_id = ?"]
        values: list[Any] = [tenant_id, instance_id]
        if enabled is not None:
            where.append("enabled = ?")
            values.append(1 if enabled else 0)

        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT * FROM agent_definitions
            WHERE {' AND '.join(where)}
            ORDER BY enabled DESC, updated_at DESC, name ASC
            """,
            values,
        ).fetchall()
        conn.close()
        return [agent for row in rows if (agent := self._deserialize(row)) is not None]

    def create(self, agent: AgentDefinition) -> AgentDefinition:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO agent_definitions (
                agent_id,
                tenant_id,
                instance_id,
                name,
                enabled,
                source_template_name,
                config_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                agent.agent_id,
                agent.tenant_id,
                agent.instance_id,
                agent.name,
                1 if agent.enabled else 0,
                agent.source_template_name,
                agent.to_storage_json(),
                agent.created_at,
                agent.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get(agent.agent_id)
        if created is None:
            raise RuntimeError(f"Failed to load created agent definition {agent.agent_id}")
        return created

    def update(self, agent: AgentDefinition) -> AgentDefinition | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE agent_definitions
            SET name = ?, enabled = ?, source_template_name = ?, config_json = ?, updated_at = ?
            WHERE agent_id = ?
            """,
            (
                agent.name,
                1 if agent.enabled else 0,
                agent.source_template_name,
                agent.to_storage_json(),
                agent.updated_at,
                agent.agent_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get(agent.agent_id)

    def delete(self, agent_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM agent_definitions WHERE agent_id = ?", (agent_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted
