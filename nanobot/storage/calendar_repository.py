"""Calendar repository backed by SQLite."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger


class CalendarRepository:
    """Persist calendar events and settings for a workspace."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS calendar_events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            is_all_day INTEGER NOT NULL DEFAULT 0,
            priority TEXT NOT NULL DEFAULT 'medium',
            reminders_json TEXT NOT NULL DEFAULT '[]',
            recurrence_json TEXT,
            recurrence_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
        CREATE INDEX IF NOT EXISTS idx_calendar_events_recurrence ON calendar_events(recurrence_id);

        CREATE TABLE IF NOT EXISTS calendar_settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            default_view TEXT NOT NULL DEFAULT 'dayGridMonth',
            default_priority TEXT NOT NULL DEFAULT 'medium',
            sound_enabled INTEGER NOT NULL DEFAULT 1,
            notification_enabled INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );
    """

    _INSERT_DEFAULT_SETTINGS = """
        INSERT OR IGNORE INTO calendar_settings (
            id,
            default_view,
            default_priority,
            sound_enabled,
            notification_enabled,
            updated_at
        )
        VALUES (1, 'dayGridMonth', 'medium', 1, 1, datetime('now'));
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
            conn.executescript(self._INSERT_DEFAULT_SETTINGS)
            conn.commit()
            conn.close()
            logger.debug("Calendar tables initialized")
        except sqlite3.DatabaseError as exc:
            logger.error("Failed to initialize calendar tables: {}", exc)
            raise

    @staticmethod
    def _deserialize_event(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        result = dict(row)
        result["is_all_day"] = bool(result.get("is_all_day", 0))
        result["reminders"] = json.loads(result.pop("reminders_json", "[]") or "[]")
        recurrence_raw = result.pop("recurrence_json", None)
        result["recurrence"] = json.loads(recurrence_raw) if recurrence_raw else None
        return result

    @staticmethod
    def _deserialize_settings(row: sqlite3.Row | None) -> dict[str, Any]:
        if row is None:
            return {
                "default_view": "dayGridMonth",
                "default_priority": "medium",
                "sound_enabled": True,
                "notification_enabled": True,
            }
        result = dict(row)
        result["sound_enabled"] = bool(result.get("sound_enabled", 1))
        result["notification_enabled"] = bool(result.get("notification_enabled", 1))
        return result

    def get_events(
        self,
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> list[dict[str, Any]]:
        conn = self._connect()
        cursor = conn.cursor()

        query = "SELECT * FROM calendar_events WHERE 1=1"
        params: list[str] = []
        if start_time:
            query += " AND end_time >= ?"
            params.append(start_time)
        if end_time:
            query += " AND start_time <= ?"
            params.append(end_time)

        query += " ORDER BY start_time ASC"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        return [self._deserialize_event(row) for row in rows if row is not None]

    def get_event(self, event_id: str) -> dict[str, Any] | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM calendar_events WHERE id = ?", (event_id,))
        row = cursor.fetchone()
        conn.close()
        return self._deserialize_event(row)

    def create_event(self, data: dict[str, Any]) -> dict[str, Any]:
        conn = self._connect()
        cursor = conn.cursor()
        now = datetime.now().isoformat()
        event_id = data.get("id") or f"evt_{int(datetime.now().timestamp() * 1000)}"

        cursor.execute(
            """
            INSERT INTO calendar_events (
                id,
                title,
                description,
                start_time,
                end_time,
                is_all_day,
                priority,
                reminders_json,
                recurrence_json,
                recurrence_id,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                data.get("title", ""),
                data.get("description") or "",
                data.get("start_time"),
                data.get("end_time"),
                1 if data.get("is_all_day") else 0,
                data.get("priority", "medium"),
                json.dumps(data.get("reminders") or []),
                json.dumps(data.get("recurrence")) if data.get("recurrence") else None,
                data.get("recurrence_id"),
                now,
                now,
            ),
        )

        conn.commit()
        conn.close()
        logger.info("Calendar event created: {}", event_id)
        created = self.get_event(event_id)
        if created is None:
            raise RuntimeError(f"Failed to load created calendar event {event_id}")
        return created

    def update_event(self, event_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
        existing = self.get_event(event_id)
        if existing is None:
            return None

        conn = self._connect()
        cursor = conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute(
            """
            UPDATE calendar_events
            SET title = ?, description = ?, start_time = ?, end_time = ?, is_all_day = ?,
                priority = ?, reminders_json = ?, recurrence_json = ?, recurrence_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                data.get("title", existing["title"]),
                data.get("description", existing["description"]),
                data.get("start_time", existing["start_time"]),
                data.get("end_time", existing["end_time"]),
                1 if data.get("is_all_day", existing["is_all_day"]) else 0,
                data.get("priority", existing["priority"]),
                json.dumps(data.get("reminders", existing.get("reminders") or [])),
                json.dumps(data.get("recurrence")) if data.get("recurrence") else (
                    json.dumps(existing["recurrence"]) if existing.get("recurrence") else None
                ),
                data.get("recurrence_id", existing.get("recurrence_id")),
                now,
                event_id,
            ),
        )

        conn.commit()
        conn.close()
        logger.info("Calendar event updated: {}", event_id)
        return self.get_event(event_id)

    def delete_event(self, event_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM calendar_events WHERE id = ?", (event_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        if deleted:
            logger.info("Calendar event deleted: {}", event_id)
        return deleted

    def get_settings(self) -> dict[str, Any]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM calendar_settings WHERE id = 1")
        row = cursor.fetchone()
        conn.close()
        return self._deserialize_settings(row)

    def update_settings(self, data: dict[str, Any]) -> dict[str, Any]:
        current = self.get_settings()
        conn = self._connect()
        cursor = conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute(
            """
            UPDATE calendar_settings
            SET default_view = ?, default_priority = ?, sound_enabled = ?, notification_enabled = ?, updated_at = ?
            WHERE id = 1
            """,
            (
                data.get("default_view", current["default_view"]),
                data.get("default_priority", current["default_priority"]),
                1 if data.get("sound_enabled", current["sound_enabled"]) else 0,
                1 if data.get("notification_enabled", current["notification_enabled"]) else 0,
                now,
            ),
        )
        conn.commit()
        conn.close()
        logger.info("Calendar settings updated")
        return self.get_settings()


_calendar_repo: CalendarRepository | None = None


def get_calendar_repository(workspace: Path) -> CalendarRepository:
    """Return the workspace-scoped calendar repository."""
    global _calendar_repo
    db_path = workspace / ".nanobot" / "calendar.db"
    if _calendar_repo is None or _calendar_repo.db_path != db_path:
        _calendar_repo = CalendarRepository(db_path)
    return _calendar_repo
