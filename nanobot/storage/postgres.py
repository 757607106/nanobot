"""Shared PostgreSQL helpers for runtime-backed stores."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from typing import Any

from nanobot.config.schema import RagPostgresConfig

try:
    from psycopg.conninfo import make_conninfo
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool
except Exception:  # pragma: no cover - optional dependency for PostgreSQL deployments
    make_conninfo = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]
    ConnectionPool = None  # type: ignore[assignment]


@dataclass(slots=True)
class _SharedPool:
    pool: Any
    refs: int = 0


_POOL_REGISTRY_LOCK = threading.Lock()
_POOL_REGISTRY: dict[tuple[str, int], _SharedPool] = {}


def default_postgres_config(postgres: Any | None) -> RagPostgresConfig:
    """Normalize one PostgreSQL configuration payload."""
    if postgres is None:
        return RagPostgresConfig()
    if isinstance(postgres, RagPostgresConfig):
        return postgres
    return RagPostgresConfig.model_validate(postgres)


def build_postgres_pool_settings(
    postgres: RagPostgresConfig | dict[str, Any] | None,
    *,
    feature_name: str,
) -> tuple[RagPostgresConfig, str, int]:
    """Return validated config plus shared-pool connection settings."""
    pg = default_postgres_config(postgres)
    if not bool(getattr(pg, "enabled", False)):
        raise RuntimeError(
            f"{feature_name} requires PostgreSQL. Set rag.postgres.enabled=true "
            "and provide rag.postgres connection settings."
        )
    if ConnectionPool is None or make_conninfo is None or dict_row is None:
        raise RuntimeError(
            f"{feature_name} requires dependency 'psycopg[binary,pool]'. "
            "Install with: pip install psycopg[binary,pool]"
        )

    conn_kwargs: dict[str, Any] = {
        "host": str(getattr(pg, "host", "127.0.0.1") or "127.0.0.1"),
        "port": int(getattr(pg, "port", 5432) or 5432),
        "user": str(getattr(pg, "user", "postgres") or "postgres"),
        "password": str(getattr(pg, "password", "") or ""),
        "dbname": str(getattr(pg, "database", "nanobot") or "nanobot"),
    }
    ssl_mode = str(getattr(pg, "ssl_mode", "") or "").strip()
    ssl_cert = str(getattr(pg, "ssl_cert", "") or "").strip()
    ssl_key = str(getattr(pg, "ssl_key", "") or "").strip()
    ssl_root_cert = str(getattr(pg, "ssl_root_cert", "") or "").strip()
    ssl_crl = str(getattr(pg, "ssl_crl", "") or "").strip()
    if ssl_mode:
        conn_kwargs["sslmode"] = ssl_mode
    if ssl_cert:
        conn_kwargs["sslcert"] = ssl_cert
    if ssl_key:
        conn_kwargs["sslkey"] = ssl_key
    if ssl_root_cert:
        conn_kwargs["sslrootcert"] = ssl_root_cert
    if ssl_crl:
        conn_kwargs["sslcrl"] = ssl_crl

    conninfo = make_conninfo(**conn_kwargs)
    max_connections = max(1, int(getattr(pg, "max_connections", 50) or 50))
    return pg, conninfo, max_connections


def acquire_shared_postgres_pool(conninfo: str, max_connections: int) -> tuple[tuple[str, int], Any]:
    """Acquire one shared row-dict connection pool for the given conninfo."""
    key = (conninfo, max(1, int(max_connections or 1)))
    with _POOL_REGISTRY_LOCK:
        shared = _POOL_REGISTRY.get(key)
        if shared is None:
            shared = _SharedPool(
                pool=ConnectionPool(  # type: ignore[misc]
                    conninfo=conninfo,
                    min_size=1,
                    max_size=key[1],
                    open=True,
                    kwargs={"row_factory": dict_row, "autocommit": True},
                )
            )
            _POOL_REGISTRY[key] = shared
        shared.refs += 1
        return key, shared.pool


def release_shared_postgres_pool(key: tuple[str, int]) -> None:
    """Release one shared pool reference and close it when unused."""
    pool = None
    with _POOL_REGISTRY_LOCK:
        shared = _POOL_REGISTRY.get(key)
        if shared is None:
            return
        shared.refs -= 1
        if shared.refs > 0:
            return
        _POOL_REGISTRY.pop(key, None)
        pool = shared.pool
    if pool is not None:
        pool.close()


def pg_json(value: Any) -> str:
    """Serialize one Python object to JSON for PostgreSQL JSONB columns."""
    return json.dumps(value, ensure_ascii=False)


def pg_dict(value: Any) -> dict[str, Any]:
    """Return one mapping payload regardless of row-factory JSON handling."""
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    return {}


def pg_list(value: Any) -> list[Any]:
    """Return one list payload regardless of row-factory JSON handling."""
    if isinstance(value, list):
        return list(value)
    if isinstance(value, str) and value.strip():
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return list(parsed)
    return []

