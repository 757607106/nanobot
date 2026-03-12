"""Agent template repository backed by SQLite."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger


class AgentTemplateRepository:
    """Persist agent templates for a single workspace."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS agent_templates (
            name TEXT PRIMARY KEY,
            source TEXT NOT NULL DEFAULT 'user',
            config_json TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            is_system INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_templates_source ON agent_templates(source);
        CREATE INDEX IF NOT EXISTS idx_agent_templates_system ON agent_templates(is_system);
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
        try:
            conn = self._connect()
            conn.executescript(self._CREATE_SCHEMA)
            conn.commit()
            conn.close()
            logger.debug("Agent template tables initialized")
        except sqlite3.DatabaseError as exc:
            logger.error("Failed to initialize agent template tables: {}", exc)
            raise

    @staticmethod
    def _deserialize(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        result = dict(row)
        result["enabled"] = bool(result.get("enabled", 1))
        result["is_system"] = bool(result.get("is_system", 0))
        return result

    def get(self, name: str) -> dict[str, Any] | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM agent_templates WHERE name = ?", (name,))
        row = cursor.fetchone()
        conn.close()
        return self._deserialize(row)

    def list_all(self) -> list[dict[str, Any]]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM agent_templates ORDER BY is_system DESC, enabled DESC, name ASC"
        )
        rows = cursor.fetchall()
        conn.close()
        return [self._deserialize(row) for row in rows if row is not None]

    def create(
        self,
        name: str,
        config_json: str,
        *,
        source: str = "user",
        enabled: bool = True,
        is_system: bool = False,
    ) -> dict[str, Any]:
        now = datetime.now().isoformat()
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO agent_templates (
                name,
                source,
                config_json,
                enabled,
                is_system,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (name, source, config_json, 1 if enabled else 0, 1 if is_system else 0, now, now),
        )
        conn.commit()
        conn.close()
        logger.info("Agent template created: {}", name)
        created = self.get(name)
        if created is None:
            raise RuntimeError(f"Failed to load created agent template {name}")
        return created

    def update(
        self,
        name: str,
        config_json: str,
        *,
        enabled: bool | None = None,
        source: str | None = None,
    ) -> dict[str, Any] | None:
        existing = self.get(name)
        if existing is None:
            return None

        now = datetime.now().isoformat()
        next_enabled = existing["enabled"] if enabled is None else bool(enabled)
        next_source = existing["source"] if source is None else source

        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE agent_templates
            SET config_json = ?, enabled = ?, source = ?, updated_at = ?
            WHERE name = ?
            """,
            (config_json, 1 if next_enabled else 0, next_source, now, name),
        )
        conn.commit()
        conn.close()
        logger.info("Agent template updated: {}", name)
        return self.get(name)

    def delete(self, name: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM agent_templates WHERE name = ?", (name,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        if deleted:
            logger.info("Agent template deleted: {}", name)
        return deleted

    def upsert(
        self,
        name: str,
        config_json: str,
        *,
        source: str = "user",
        enabled: bool = True,
        is_system: bool = False,
    ) -> dict[str, Any]:
        existing = self.get(name)
        if existing is None:
            return self.create(
                name,
                config_json,
                source=source,
                enabled=enabled,
                is_system=is_system,
            )

        now = datetime.now().isoformat()
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE agent_templates
            SET config_json = ?, source = ?, enabled = ?, is_system = ?, updated_at = ?
            WHERE name = ?
            """,
            (config_json, source, 1 if enabled else 0, 1 if is_system else 0, now, name),
        )
        conn.commit()
        conn.close()
        logger.info("Agent template upserted: {}", name)
        updated = self.get(name)
        if updated is None:
            raise RuntimeError(f"Failed to load upserted agent template {name}")
        return updated


_agent_template_repo: AgentTemplateRepository | None = None


def get_agent_template_repository(workspace: Path) -> AgentTemplateRepository:
    """Return the workspace-scoped agent template repository."""
    global _agent_template_repo
    db_path = workspace / ".nanobot" / "agent_templates.db"
    if _agent_template_repo is None or _agent_template_repo.db_path != db_path:
        _agent_template_repo = AgentTemplateRepository(db_path)
    return _agent_template_repo
