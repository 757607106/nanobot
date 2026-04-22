"""Session management for conversation history backed by PostgreSQL."""

from __future__ import annotations

import asyncio
import threading
import time
import weakref
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import blake2b
from pathlib import Path
from typing import Any, Iterator

from nanobot.chat_payload import build_chat_request_content, normalize_chat_attachments
from nanobot.config.schema import RagPostgresConfig
from nanobot.storage.postgres import (
    acquire_shared_postgres_pool,
    build_postgres_pool_settings,
    pg_dict,
    pg_json,
    pg_list,
    release_shared_postgres_pool,
)
from nanobot.utils.helpers import find_legal_message_start


@dataclass
class Session:
    """A conversation session."""

    key: str  # channel:chat_id
    messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    metadata: dict[str, Any] = field(default_factory=dict)
    last_consolidated: int = 0  # Number of messages already consolidated to files

    def add_message(self, role: str, content: str, **kwargs: Any) -> None:
        """Add a message to the session."""
        msg = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
            **kwargs,
        }
        self.messages.append(msg)
        self.updated_at = datetime.now()

    def get_history(self, max_messages: int = 500) -> list[dict[str, Any]]:
        """Return unconsolidated messages for LLM input, aligned to a legal tool-call boundary."""
        unconsolidated = self.messages[self.last_consolidated:]
        sliced = unconsolidated[-max_messages:]

        for i, message in enumerate(sliced):
            if message.get("role") == "user":
                sliced = sliced[i:]
                break

        start = find_legal_message_start(sliced)
        if start:
            sliced = sliced[start:]

        out: list[dict[str, Any]] = []
        for message in sliced:
            content = message.get("content", "")
            if message.get("role") == "user" and isinstance(content, str):
                content = build_chat_request_content(
                    content,
                    normalize_chat_attachments(message.get("attachments") or []),
                )
            entry: dict[str, Any] = {"role": message["role"], "content": content}
            for key in ("tool_calls", "tool_call_id", "name", "reasoning_content"):
                if key in message:
                    entry[key] = message[key]
            out.append(entry)
        return out

    def clear(self) -> None:
        """Clear all messages and reset session to initial state."""
        self.messages = []
        self.last_consolidated = 0
        self.updated_at = datetime.now()

    def retain_recent_legal_suffix(self, max_messages: int) -> None:
        """Keep a legal recent suffix, mirroring get_history boundary rules."""
        if max_messages <= 0:
            self.clear()
            return
        if len(self.messages) <= max_messages:
            return

        start_idx = max(0, len(self.messages) - max_messages)
        while start_idx > 0 and self.messages[start_idx].get("role") != "user":
            start_idx -= 1

        retained = self.messages[start_idx:]
        start = find_legal_message_start(retained)
        if start:
            retained = retained[start:]

        dropped = len(self.messages) - len(retained)
        self.messages = retained
        self.last_consolidated = max(0, self.last_consolidated - dropped)
        self.updated_at = datetime.now()


@dataclass(slots=True)
class SessionExecutionObservation:
    """Minimal queue-wait observability for one session execution."""

    wait_ms: float = 0.0
    queued: bool = False

    def to_payload(self, session_key: str) -> dict[str, Any]:
        return {
            "sessionKey": session_key,
            "queued": self.queued,
            "waitMs": round(self.wait_ms, 2),
        }


_CREATE_SCHEMA = """
    CREATE TABLE IF NOT EXISTS agent_sessions (
        workspace_key TEXT NOT NULL,
        session_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        messages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_consolidated INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_key, session_key)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace_updated
    ON agent_sessions(workspace_key, updated_at DESC);
"""

_SCHEMA_READY_LOCK = threading.Lock()
_SCHEMA_READY: set[tuple[str, int]] = set()
_EXECUTION_LOCKS: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
_HELD_EXECUTION_SCOPES: ContextVar[tuple[str, ...]] = ContextVar(
    "_HELD_EXECUTION_SCOPES",
    default=(),
)


def _execution_lock(scope: str) -> asyncio.Lock:
    return _EXECUTION_LOCKS.setdefault(scope, asyncio.Lock())


class SessionManager:
    """Manages conversation sessions in PostgreSQL."""

    def __init__(self, workspace: Path, postgres: RagPostgresConfig | dict[str, Any] | None = None):
        _, conninfo, max_connections = build_postgres_pool_settings(
            postgres,
            feature_name="Session store",
        )
        self.workspace = Path(workspace).resolve()
        self.workspace_key = str(self.workspace)
        self._cache: dict[str, Session] = {}
        self._persisted_keys: set[str] = set()
        self._pool_key, self._pool = acquire_shared_postgres_pool(conninfo, max_connections)
        self._finalizer = weakref.finalize(self, release_shared_postgres_pool, self._pool_key)
        self._ensure_schema()

    def close(self) -> None:
        """Release this manager's shared pool reference."""
        self._finalizer()

    @contextmanager
    def _connection(self) -> Iterator[Any]:
        with self._pool.connection() as conn:
            yield conn

    def _ensure_schema(self) -> None:
        if self._pool_key in _SCHEMA_READY:
            return
        with _SCHEMA_READY_LOCK:
            if self._pool_key in _SCHEMA_READY:
                return
            statements = [part.strip() for part in _CREATE_SCHEMA.split(";") if part.strip()]
            with self._connection() as conn:
                with conn.cursor() as cur:
                    for statement in statements:
                        cur.execute(statement)
            _SCHEMA_READY.add(self._pool_key)

    def _deserialize_session(self, row: dict[str, Any] | None) -> Session | None:
        if row is None:
            return None
        created_at = datetime.fromisoformat(str(row.get("created_at") or datetime.now().isoformat()))
        updated_at = datetime.fromisoformat(str(row.get("updated_at") or created_at.isoformat()))
        return Session(
            key=str(row.get("session_key") or ""),
            messages=[dict(item) if isinstance(item, dict) else item for item in pg_list(row.get("messages_json"))],
            created_at=created_at,
            updated_at=updated_at,
            metadata=pg_dict(row.get("metadata_json")),
            last_consolidated=int(row.get("last_consolidated") or 0),
        )

    def _load(self, key: str) -> Session | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        session_key,
                        created_at,
                        updated_at,
                        metadata_json,
                        messages_json,
                        last_consolidated
                    FROM agent_sessions
                    WHERE workspace_key = %s AND session_key = %s
                    """,
                    (self.workspace_key, key),
                )
                row = cur.fetchone()
        session = self._deserialize_session(row)
        if session is not None:
            self._persisted_keys.add(key)
        return session

    def get_or_create(self, key: str) -> Session:
        """Get an existing session or create a new one."""
        session = self.get(key)
        if session is not None:
            return session
        session = Session(key=key)
        self._cache[key] = session
        return session

    def get(self, key: str) -> Session | None:
        """Return an existing session without creating a new one."""
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        session = self._load(key)
        if session is not None:
            self._cache[key] = session
        return session

    def _save_full(self, session: Session) -> None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO agent_sessions (
                        workspace_key,
                        session_key,
                        created_at,
                        updated_at,
                        metadata_json,
                        messages_json,
                        last_consolidated,
                        message_count
                    )
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
                    ON CONFLICT (workspace_key, session_key) DO UPDATE SET
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at,
                        metadata_json = EXCLUDED.metadata_json,
                        messages_json = EXCLUDED.messages_json,
                        last_consolidated = EXCLUDED.last_consolidated,
                        message_count = EXCLUDED.message_count
                    """,
                    (
                        self.workspace_key,
                        session.key,
                        session.created_at.isoformat(),
                        session.updated_at.isoformat(),
                        pg_json(session.metadata),
                        pg_json(session.messages),
                        int(session.last_consolidated or 0),
                        len(session.messages),
                    ),
                )
        self._persisted_keys.add(session.key)
        self._cache[session.key] = session

    def _save_append(self, session: Session, append_from: int) -> bool:
        if session.key not in self._persisted_keys:
            return False

        start = max(0, min(int(append_from), len(session.messages)))
        appended_messages = session.messages[start:]
        append_count = len(appended_messages)
        append_payload = pg_json(appended_messages) if append_count else "[]"

        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE agent_sessions
                    SET
                        created_at = %s,
                        updated_at = %s,
                        metadata_json = %s::jsonb,
                        messages_json = CASE
                            WHEN %s > 0 THEN messages_json || %s::jsonb
                            ELSE messages_json
                        END,
                        last_consolidated = %s,
                        message_count = %s
                    WHERE workspace_key = %s AND session_key = %s
                    """,
                    (
                        session.created_at.isoformat(),
                        session.updated_at.isoformat(),
                        pg_json(session.metadata),
                        append_count,
                        append_payload,
                        int(session.last_consolidated or 0),
                        len(session.messages),
                        self.workspace_key,
                        session.key,
                    ),
                )
                updated = cur.rowcount > 0
        if updated:
            self._persisted_keys.add(session.key)
            self._cache[session.key] = session
        return updated

    def save(self, session: Session, *, append_from: int = 0) -> None:
        """Persist a session, appending only the new message suffix when possible."""
        start = max(0, int(append_from or 0))
        if start > 0 and self._save_append(session, start):
            return

        self._save_full(session)

    def delete(self, key: str) -> bool:
        """Delete a session from PostgreSQL and the in-memory cache."""
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM agent_sessions WHERE workspace_key = %s AND session_key = %s",
                    (self.workspace_key, key),
                )
                removed = cur.rowcount > 0
        self._cache.pop(key, None)
        self._persisted_keys.discard(key)
        return removed

    def update_metadata(self, key: str, **metadata: Any) -> Session:
        """Merge metadata into a session and persist it."""
        session = self.get_or_create(key)
        session.metadata.update(metadata)
        session.updated_at = datetime.now()
        self.save(session, append_from=len(session.messages))
        return session

    def invalidate(self, key: str) -> None:
        """Remove a session from the in-memory cache."""
        self._cache.pop(key, None)

    def list_sessions(self) -> list[dict[str, Any]]:
        """List all sessions for the current workspace."""
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT session_key, created_at, updated_at, metadata_json, message_count
                    FROM agent_sessions
                    WHERE workspace_key = %s
                    ORDER BY updated_at DESC
                    """,
                    (self.workspace_key,),
                )
                rows = cur.fetchall() or []

        sessions: list[dict[str, Any]] = []
        for row in rows:
            metadata = pg_dict(row.get("metadata_json"))
            file_count = len(normalize_chat_attachments(metadata.get("chatFiles") or []))
            sessions.append(
                {
                    "key": str(row.get("session_key") or ""),
                    "created_at": row.get("created_at"),
                    "updated_at": row.get("updated_at"),
                    "metadata": metadata,
                    "title": metadata.get("title"),
                    "message_count": int(row.get("message_count") or 0),
                    "file_count": file_count,
                }
            )
        return sessions

    def garbage_collect(self, ttl_days: int = 30, test_ttl_hours: int = 1) -> None:
        """Clean up old sessions to prevent unbounded accumulation."""
        now = datetime.now()
        for session_info in self.list_sessions():
            key = session_info["key"]
            updated_str = session_info.get("updated_at")
            if not updated_str:
                continue

            try:
                updated_at = datetime.fromisoformat(str(updated_str))
            except ValueError:
                continue

            age_hours = (now - updated_at).total_seconds() / 3600

            if key.startswith("agent-test:") or key.startswith("test:"):
                if age_hours > test_ttl_hours:
                    self.delete(key)
                continue

            if age_hours > (ttl_days * 24):
                self.delete(key)

    def _execution_scope(self, session_key: str) -> str:
        return f"{self.workspace_key}\0{session_key}"

    def _advisory_lock_ids(self, session_key: str) -> tuple[int, int]:
        digest = blake2b(self._execution_scope(session_key).encode("utf-8"), digest_size=8).digest()
        return (
            int.from_bytes(digest[:4], byteorder="big", signed=True),
            int.from_bytes(digest[4:], byteorder="big", signed=True),
        )

    def _run_advisory_lock(self, conn: Any, session_key: str, *, unlock: bool = False) -> None:
        fn = "pg_advisory_unlock" if unlock else "pg_advisory_lock"
        lock_a, lock_b = self._advisory_lock_ids(session_key)
        with conn.cursor() as cur:
            cur.execute(f"SELECT {fn}(%s, %s)", (lock_a, lock_b))
            if unlock:
                row = cur.fetchone()
                if isinstance(row, dict) and not next(iter(row.values()), True):
                    raise RuntimeError(f"Failed to release advisory lock for session '{session_key}'.")

    @asynccontextmanager
    async def execution(self, session_key: str) -> Iterator[SessionExecutionObservation]:
        """Serialize same-session work across loops and worker processes."""
        scope = self._execution_scope(session_key)
        held = _HELD_EXECUTION_SCOPES.get()
        observation = SessionExecutionObservation()
        if scope in held:
            yield observation
            return

        local_lock = _execution_lock(scope)
        local_contended = local_lock.locked()
        local_started = time.perf_counter()
        async with local_lock:
            local_wait_ms = max(0.0, (time.perf_counter() - local_started) * 1000.0)
            observation.wait_ms = local_wait_ms if local_contended else 0.0
            observation.queued = local_contended
            conn = await asyncio.to_thread(self._pool.getconn)
            token = _HELD_EXECUTION_SCOPES.set((*held, scope))
            try:
                await asyncio.to_thread(self._run_advisory_lock, conn, session_key)
                try:
                    yield observation
                finally:
                    await asyncio.to_thread(self._run_advisory_lock, conn, session_key, unlock=True)
            finally:
                _HELD_EXECUTION_SCOPES.reset(token)
                await asyncio.to_thread(self._pool.putconn, conn)
