"""SQLite store for memory candidates."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from nanobot.platform.memory.models import MemoryCandidate


class TeamMemoryStore:
    """Persist memory candidates in an instance-scoped SQLite file."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS memory_candidates (
            candidate_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            scope TEXT NOT NULL,
            team_id TEXT,
            agent_id TEXT,
            run_id TEXT,
            source_kind TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'proposed',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            applied_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_memory_candidates_team
        ON memory_candidates(team_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memory_candidates_run
        ON memory_candidates(run_id);
        CREATE INDEX IF NOT EXISTS idx_memory_candidates_scope
        ON memory_candidates(scope, status, updated_at DESC);
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
    def _deserialize(row: sqlite3.Row | None) -> MemoryCandidate | None:
        if row is None:
            return None
        return MemoryCandidate.from_record(dict(row))

    def create(self, candidate: MemoryCandidate) -> MemoryCandidate:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO memory_candidates (
                candidate_id,
                tenant_id,
                instance_id,
                scope,
                team_id,
                agent_id,
                run_id,
                source_kind,
                title,
                content,
                status,
                created_at,
                updated_at,
                applied_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                candidate.candidate_id,
                candidate.tenant_id,
                candidate.instance_id,
                candidate.scope,
                candidate.team_id,
                candidate.agent_id,
                candidate.run_id,
                candidate.source_kind,
                candidate.title,
                candidate.content,
                candidate.status,
                candidate.created_at,
                candidate.updated_at,
                candidate.applied_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get(candidate.candidate_id)
        if created is None:
            raise RuntimeError(f"Failed to load created memory candidate {candidate.candidate_id}")
        return created

    def get(self, candidate_id: str) -> MemoryCandidate | None:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM memory_candidates WHERE candidate_id = ?",
            (candidate_id,),
        ).fetchone()
        conn.close()
        return self._deserialize(row)

    def list_all(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        team_id: str | None = None,
        status: str | None = None,
        scope: str | None = None,
        limit: int = 100,
    ) -> list[MemoryCandidate]:
        where = ["tenant_id = ?", "instance_id = ?"]
        values: list[Any] = [tenant_id, instance_id]
        if team_id:
            where.append("team_id = ?")
            values.append(team_id)
        if status:
            where.append("status = ?")
            values.append(status)
        if scope:
            where.append("scope = ?")
            values.append(scope)
        values.append(limit)

        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT * FROM memory_candidates
            WHERE {' AND '.join(where)}
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ?
            """,
            values,
        ).fetchall()
        conn.close()
        return [item for row in rows if (item := self._deserialize(row)) is not None]

    def count(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        team_id: str | None = None,
        status: str | None = None,
    ) -> int:
        where = ["tenant_id = ?", "instance_id = ?"]
        values: list[Any] = [tenant_id, instance_id]
        if team_id:
            where.append("team_id = ?")
            values.append(team_id)
        if status:
            where.append("status = ?")
            values.append(status)

        conn = self._connect()
        row = conn.execute(
            f"SELECT COUNT(*) AS count FROM memory_candidates WHERE {' AND '.join(where)}",
            values,
        ).fetchone()
        conn.close()
        return int(row["count"]) if row is not None else 0

    def update_status(
        self,
        candidate_id: str,
        *,
        status: str,
        updated_at: str,
        applied_at: str | None = None,
    ) -> MemoryCandidate | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE memory_candidates
            SET status = ?, updated_at = ?, applied_at = ?
            WHERE candidate_id = ?
            """,
            (status, updated_at, applied_at, candidate_id),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get(candidate_id)
