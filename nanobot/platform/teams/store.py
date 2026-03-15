"""SQLite store for instance-scoped team definitions."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from nanobot.platform.teams.models import TeamDefinition


class TeamDefinitionStore:
    """Persist team definitions in an instance-scoped SQLite file."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS team_definitions (
            team_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_team_definitions_tenant_instance
        ON team_definitions(tenant_id, instance_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_team_definitions_enabled
        ON team_definitions(enabled);
        CREATE INDEX IF NOT EXISTS idx_team_definitions_name
        ON team_definitions(name);
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
    def _deserialize(row: sqlite3.Row | None) -> TeamDefinition | None:
        if row is None:
            return None
        return TeamDefinition.from_record(dict(row))

    def get(self, team_id: str) -> TeamDefinition | None:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM team_definitions WHERE team_id = ?",
            (team_id,),
        ).fetchone()
        conn.close()
        return self._deserialize(row)

    def get_by_name(self, name: str, *, tenant_id: str, instance_id: str) -> TeamDefinition | None:
        conn = self._connect()
        row = conn.execute(
            """
            SELECT * FROM team_definitions
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
    ) -> list[TeamDefinition]:
        where = ["tenant_id = ?", "instance_id = ?"]
        values: list[Any] = [tenant_id, instance_id]
        if enabled is not None:
            where.append("enabled = ?")
            values.append(1 if enabled else 0)

        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT * FROM team_definitions
            WHERE {' AND '.join(where)}
            ORDER BY enabled DESC, updated_at DESC, name ASC
            """,
            values,
        ).fetchall()
        conn.close()
        return [team for row in rows if (team := self._deserialize(row)) is not None]

    def create(self, team: TeamDefinition) -> TeamDefinition:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO team_definitions (
                team_id,
                tenant_id,
                instance_id,
                name,
                enabled,
                config_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                team.team_id,
                team.tenant_id,
                team.instance_id,
                team.name,
                1 if team.enabled else 0,
                team.to_storage_json(),
                team.created_at,
                team.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get(team.team_id)
        if created is None:
            raise RuntimeError(f"Failed to load created team definition {team.team_id}")
        return created

    def update(self, team: TeamDefinition) -> TeamDefinition | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE team_definitions
            SET name = ?, enabled = ?, config_json = ?, updated_at = ?
            WHERE team_id = ?
            """,
            (
                team.name,
                1 if team.enabled else 0,
                team.to_storage_json(),
                team.updated_at,
                team.team_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get(team.team_id)

    def delete(self, team_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM team_definitions WHERE team_id = ?", (team_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted
