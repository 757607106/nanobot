"""Shared PostgreSQL base for workspace-scoped platform stores."""

from __future__ import annotations

import threading
import weakref
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from nanobot.config.schema import RagPostgresConfig
from nanobot.storage.postgres import (
    acquire_shared_postgres_pool,
    build_postgres_pool_settings,
    release_shared_postgres_pool,
)

_SCHEMA_READY_LOCK = threading.Lock()
_SCHEMA_READY: set[tuple[tuple[str, int], str]] = set()


class WorkspacePostgresStore:
    """Base class for one workspace-scoped PostgreSQL metadata store."""

    _CREATE_SCHEMA = ""
    _FEATURE_NAME = "Workspace store"
    _SCHEMA_NAMESPACE = ""

    def __init__(self, workspace: Path, postgres: RagPostgresConfig | dict[str, Any] | None = None):
        _, conninfo, max_connections = build_postgres_pool_settings(
            postgres,
            feature_name=self._FEATURE_NAME,
        )
        self.workspace = Path(workspace).resolve()
        self.workspace_key = str(self.workspace)
        self._pool_key, self._pool = acquire_shared_postgres_pool(conninfo, max_connections)
        self._finalizer = weakref.finalize(self, release_shared_postgres_pool, self._pool_key)
        self._ensure_schema()

    def close(self) -> None:
        """Release this store's shared pool reference."""
        self._finalizer()

    @contextmanager
    def _connection(self) -> Iterator[Any]:
        with self._pool.connection() as conn:
            yield conn

    def _schema_namespace(self) -> str:
        return self._SCHEMA_NAMESPACE or type(self).__qualname__

    def _ensure_schema(self) -> None:
        ready_key = (self._pool_key, self._schema_namespace())
        if ready_key in _SCHEMA_READY:
            return
        with _SCHEMA_READY_LOCK:
            if ready_key in _SCHEMA_READY:
                return
            statements = [part.strip() for part in self._CREATE_SCHEMA.split(";") if part.strip()]
            with self._connection() as conn:
                with conn.cursor() as cur:
                    for statement in statements:
                        cur.execute(statement)
            _SCHEMA_READY.add(ready_key)
