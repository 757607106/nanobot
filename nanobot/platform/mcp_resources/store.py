"""SQLite store for MCP server and tool resources."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from nanobot.platform.mcp_resources.models import McpServerDefinition, McpToolDefinition, now_iso


class McpResourceStore:
    """Persist MCP server resources and discovered tool states."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS mcp_servers (
            server_name TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant_instance
        ON mcp_servers(tenant_id, instance_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS mcp_tools (
            server_name TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            description TEXT NOT NULL DEFAULT '',
            input_schema_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (server_name, tool_name, tenant_id, instance_id)
        );

        CREATE INDEX IF NOT EXISTS idx_mcp_tools_server
        ON mcp_tools(server_name, tenant_id, instance_id, enabled);
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
    def _deserialize_server(row: sqlite3.Row | None) -> McpServerDefinition | None:
        if row is None:
            return None
        return McpServerDefinition.from_record(dict(row))

    @staticmethod
    def _deserialize_tool(row: sqlite3.Row | None) -> McpToolDefinition | None:
        if row is None:
            return None
        return McpToolDefinition.from_record(dict(row))

    def get_server(self, server_name: str, *, tenant_id: str | None = None) -> McpServerDefinition | None:
        conn = self._connect()
        if tenant_id is None:
            row = conn.execute(
                "SELECT * FROM mcp_servers WHERE server_name = ?",
                (server_name,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM mcp_servers WHERE server_name = ? AND tenant_id = ?",
                (server_name, tenant_id),
            ).fetchone()
        conn.close()
        return self._deserialize_server(row)

    def list_servers(self, *, tenant_id: str, instance_id: str, enabled: bool | None = None) -> list[McpServerDefinition]:
        where = ["tenant_id = ?", "instance_id = ?"]
        values: list[Any] = [tenant_id, instance_id]
        if enabled is not None:
            where.append("enabled = ?")
            values.append(1 if enabled else 0)
        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT * FROM mcp_servers
            WHERE {' AND '.join(where)}
            ORDER BY enabled DESC, updated_at DESC, server_name ASC
            """,
            values,
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize_server(row)) is not None]

    def create_server(self, server: McpServerDefinition) -> McpServerDefinition:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO mcp_servers (
                server_name, tenant_id, instance_id, enabled, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                server.server_name,
                server.tenant_id,
                server.instance_id,
                1 if server.enabled else 0,
                server.to_storage_json(),
                server.created_at,
                server.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_server(server.server_name)
        if created is None:
            raise RuntimeError(f"Failed to load created MCP server {server.server_name}")
        return created

    def update_server(self, server: McpServerDefinition, *, tenant_id: str | None = None) -> McpServerDefinition | None:
        conn = self._connect()
        cursor = conn.cursor()
        if tenant_id is None:
            cursor.execute(
                """
                UPDATE mcp_servers
                SET enabled = ?, config_json = ?, updated_at = ?
                WHERE server_name = ?
                """,
                (
                    1 if server.enabled else 0,
                    server.to_storage_json(),
                    server.updated_at,
                    server.server_name,
                ),
            )
        else:
            cursor.execute(
                """
                UPDATE mcp_servers
                SET enabled = ?, config_json = ?, updated_at = ?
                WHERE server_name = ? AND tenant_id = ?
                """,
                (
                    1 if server.enabled else 0,
                    server.to_storage_json(),
                    server.updated_at,
                    server.server_name,
                    tenant_id,
                ),
            )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get_server(server.server_name, tenant_id=tenant_id)

    def delete_server(self, server_name: str, *, tenant_id: str | None = None) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        if tenant_id is None:
            cursor.execute("DELETE FROM mcp_servers WHERE server_name = ?", (server_name,))
            cursor.execute("DELETE FROM mcp_tools WHERE server_name = ?", (server_name,))
        else:
            cursor.execute(
                "DELETE FROM mcp_servers WHERE server_name = ? AND tenant_id = ?",
                (server_name, tenant_id),
            )
            cursor.execute(
                "DELETE FROM mcp_tools WHERE server_name = ? AND tenant_id = ?",
                (server_name, tenant_id),
            )
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    def list_tools(self, *, server_name: str, tenant_id: str, instance_id: str, enabled: bool | None = None) -> list[McpToolDefinition]:
        where = ["server_name = ?", "tenant_id = ?", "instance_id = ?"]
        values: list[Any] = [server_name, tenant_id, instance_id]
        if enabled is not None:
            where.append("enabled = ?")
            values.append(1 if enabled else 0)
        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT * FROM mcp_tools
            WHERE {' AND '.join(where)}
            ORDER BY enabled DESC, created_at ASC, tool_name ASC
            """,
            values,
        ).fetchall()
        conn.close()
        return [tool for row in rows if (tool := self._deserialize_tool(row)) is not None]

    def get_tool(
        self,
        *,
        server_name: str,
        tool_name: str,
        tenant_id: str,
        instance_id: str,
    ) -> McpToolDefinition | None:
        conn = self._connect()
        row = conn.execute(
            """
            SELECT * FROM mcp_tools
            WHERE server_name = ? AND tool_name = ? AND tenant_id = ? AND instance_id = ?
            """,
            (server_name, tool_name, tenant_id, instance_id),
        ).fetchone()
        conn.close()
        return self._deserialize_tool(row)

    def replace_tools(
        self,
        *,
        server_name: str,
        tenant_id: str,
        instance_id: str,
        tools: list[McpToolDefinition],
    ) -> list[McpToolDefinition]:
        existing = {
            item.tool_name: item
            for item in self.list_tools(server_name=server_name, tenant_id=tenant_id, instance_id=instance_id)
        }
        conn = self._connect()
        cursor = conn.cursor()
        for tool in tools:
            existing_tool = existing.get(tool.tool_name)
            enabled = tool.enabled if existing_tool is None else existing_tool.enabled
            cursor.execute(
                """
                INSERT INTO mcp_tools (
                    server_name, tool_name, tenant_id, instance_id, enabled,
                    description, input_schema_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(server_name, tool_name, tenant_id, instance_id)
                DO UPDATE SET
                    description = excluded.description,
                    input_schema_json = excluded.input_schema_json,
                    updated_at = excluded.updated_at
                """,
                (
                    server_name,
                    tool.tool_name,
                    tenant_id,
                    instance_id,
                    1 if enabled else 0,
                    tool.description,
                    json.dumps(tool.input_schema or {}, ensure_ascii=False),
                    existing_tool.created_at if existing_tool else tool.created_at,
                    tool.updated_at,
                ),
            )
        keep_names = {item.tool_name for item in tools}
        if keep_names:
            placeholders = ",".join("?" for _ in keep_names)
            cursor.execute(
                f"""
                DELETE FROM mcp_tools
                WHERE server_name = ? AND tenant_id = ? AND instance_id = ?
                  AND tool_name NOT IN ({placeholders})
                """,
                [server_name, tenant_id, instance_id, *keep_names],
            )
        else:
            cursor.execute(
                "DELETE FROM mcp_tools WHERE server_name = ? AND tenant_id = ? AND instance_id = ?",
                (server_name, tenant_id, instance_id),
            )
        conn.commit()
        conn.close()
        return self.list_tools(server_name=server_name, tenant_id=tenant_id, instance_id=instance_id)

    def set_tool_enabled(
        self,
        *,
        server_name: str,
        tool_name: str,
        tenant_id: str,
        instance_id: str,
        enabled: bool,
    ) -> McpToolDefinition | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE mcp_tools
            SET enabled = ?, updated_at = ?
            WHERE server_name = ? AND tool_name = ? AND tenant_id = ? AND instance_id = ?
            """,
            (1 if enabled else 0, now_iso(), server_name, tool_name, tenant_id, instance_id),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get_tool(server_name=server_name, tool_name=tool_name, tenant_id=tenant_id, instance_id=instance_id)
