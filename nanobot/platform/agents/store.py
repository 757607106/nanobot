"""PostgreSQL store for instance-scoped agent definitions."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from nanobot.config.schema import RagPostgresConfig
from nanobot.platform.agents.models import AgentDefinition
from nanobot.platform.postgres_store import WorkspacePostgresStore


class AgentDefinitionStore(WorkspacePostgresStore):
    """Persist agent definitions in one shared PostgreSQL store."""

    _FEATURE_NAME = "Agent definition store"
    _SCHEMA_NAMESPACE = "platform_agent_definitions"
    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS agent_definitions (
            workspace_key TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            source_template_name TEXT,
            config_json JSONB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_key, agent_id)
        );

        CREATE INDEX IF NOT EXISTS idx_agent_definitions_tenant_instance
        ON agent_definitions(workspace_key, tenant_id, instance_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_definitions_enabled
        ON agent_definitions(workspace_key, enabled);
        CREATE INDEX IF NOT EXISTS idx_agent_definitions_name
        ON agent_definitions(workspace_key, tenant_id, instance_id, name);
    """

    def __init__(self, workspace: Path, postgres: RagPostgresConfig | dict[str, Any] | None = None):
        super().__init__(workspace, postgres)

    @staticmethod
    def _deserialize(row: dict[str, Any] | None) -> AgentDefinition | None:
        if row is None:
            return None
        payload = dict(row)
        config_value = payload.get("config_json")
        if isinstance(config_value, dict):
            payload["config_json"] = json.dumps(config_value, ensure_ascii=False)
        return AgentDefinition.from_record(payload)

    def get(self, agent_id: str, *, tenant_id: str | None = None) -> AgentDefinition | None:
        where = ["workspace_key = %s", "agent_id = %s"]
        params: list[Any] = [self.workspace_key, agent_id]
        if tenant_id is not None:
            where.append("tenant_id = %s")
            params.append(tenant_id)
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM agent_definitions WHERE {' AND '.join(where)}",
                    params,
                )
                row = cur.fetchone()
        return self._deserialize(row)

    def get_by_name(self, name: str, *, tenant_id: str, instance_id: str) -> AgentDefinition | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM agent_definitions
                    WHERE workspace_key = %s AND tenant_id = %s AND instance_id = %s AND name = %s
                    """,
                    (self.workspace_key, tenant_id, instance_id, name),
                )
                row = cur.fetchone()
        return self._deserialize(row)

    def list_all(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        enabled: bool | None = None,
    ) -> list[AgentDefinition]:
        where = ["workspace_key = %s", "tenant_id = %s", "instance_id = %s"]
        values: list[Any] = [self.workspace_key, tenant_id, instance_id]
        if enabled is not None:
            where.append("enabled = %s")
            values.append(bool(enabled))
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT * FROM agent_definitions
                    WHERE {' AND '.join(where)}
                    ORDER BY enabled DESC, updated_at DESC, name ASC
                    """,
                    values,
                )
                rows = cur.fetchall()
        return [agent for row in rows if (agent := self._deserialize(row)) is not None]

    def create(self, agent: AgentDefinition) -> AgentDefinition:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO agent_definitions (
                        workspace_key,
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
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        self.workspace_key,
                        agent.agent_id,
                        agent.tenant_id,
                        agent.instance_id,
                        agent.name,
                        bool(agent.enabled),
                        agent.source_template_name,
                        agent.to_storage_json(),
                        agent.created_at,
                        agent.updated_at,
                    ),
                )
        created = self.get(agent.agent_id)
        if created is None:
            raise RuntimeError(f"Failed to load created agent definition {agent.agent_id}")
        return created

    def update(self, agent: AgentDefinition, *, tenant_id: str | None = None) -> AgentDefinition | None:
        where = ["workspace_key = %s", "agent_id = %s"]
        params: list[Any] = [self.workspace_key, agent.agent_id]
        if tenant_id is not None:
            where.append("tenant_id = %s")
            params.append(tenant_id)
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE agent_definitions
                    SET name = %s, enabled = %s, source_template_name = %s, config_json = %s::jsonb, updated_at = %s
                    WHERE {' AND '.join(where)}
                    """,
                    (
                        agent.name,
                        bool(agent.enabled),
                        agent.source_template_name,
                        agent.to_storage_json(),
                        agent.updated_at,
                        *params,
                    ),
                )
                updated = cur.rowcount > 0
        if not updated:
            return None
        return self.get(agent.agent_id, tenant_id=tenant_id)

    def delete(self, agent_id: str, *, tenant_id: str | None = None) -> bool:
        where = ["workspace_key = %s", "agent_id = %s"]
        params: list[Any] = [self.workspace_key, agent_id]
        if tenant_id is not None:
            where.append("tenant_id = %s")
            params.append(tenant_id)
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM agent_definitions WHERE {' AND '.join(where)}",
                    params,
                )
                return cur.rowcount > 0
