"""SQLite store for tenants and API keys."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from nanobot.platform.tenants.models import ApiKey, Tenant


class TenantStore:
    """Persist tenants and API keys in a SQLite file."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS tenants (
            tenant_id    TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'active',
            plan         TEXT NOT NULL DEFAULT 'free',
            settings_json TEXT NOT NULL DEFAULT '{}',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            key_id       TEXT PRIMARY KEY,
            tenant_id    TEXT NOT NULL,
            key_hash     TEXT NOT NULL,
            key_prefix   TEXT NOT NULL,
            name         TEXT NOT NULL,
            scopes_json  TEXT NOT NULL DEFAULT '[]',
            enabled      INTEGER NOT NULL DEFAULT 1,
            last_used_at TEXT,
            expires_at   TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_ak_hash ON api_keys(key_hash);
        CREATE INDEX IF NOT EXISTS idx_ak_tenant ON api_keys(tenant_id);
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

    # --- Tenant operations ---

    def get_tenant(self, tenant_id: str) -> Tenant | None:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM tenants WHERE tenant_id = ?",
            (tenant_id,),
        ).fetchone()
        conn.close()
        if row is None:
            return None
        return Tenant.from_record(dict(row))

    def list_tenants(self) -> list[Tenant]:
        conn = self._connect()
        rows = conn.execute(
            "SELECT * FROM tenants ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        return [Tenant.from_record(dict(row)) for row in rows]

    def create_tenant(self, tenant: Tenant) -> Tenant:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO tenants (tenant_id, name, status, plan, settings_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tenant.tenant_id,
                tenant.name,
                tenant.status,
                tenant.plan,
                json.dumps(tenant.settings, ensure_ascii=False),
                tenant.created_at,
                tenant.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_tenant(tenant.tenant_id)
        if created is None:
            raise RuntimeError(f"Failed to load created tenant {tenant.tenant_id}")
        return created

    def update_tenant(self, tenant: Tenant) -> Tenant | None:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE tenants
            SET name = ?, status = ?, plan = ?, settings_json = ?, updated_at = ?
            WHERE tenant_id = ?
            """,
            (
                tenant.name,
                tenant.status,
                tenant.plan,
                json.dumps(tenant.settings, ensure_ascii=False),
                tenant.updated_at,
                tenant.tenant_id,
            ),
        )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get_tenant(tenant.tenant_id)

    def delete_tenant(self, tenant_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM api_keys WHERE tenant_id = ?", (tenant_id,))
        cursor.execute("DELETE FROM tenants WHERE tenant_id = ?", (tenant_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    # --- API Key operations ---

    def get_api_key(self, key_id: str) -> ApiKey | None:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM api_keys WHERE key_id = ?",
            (key_id,),
        ).fetchone()
        conn.close()
        if row is None:
            return None
        return ApiKey.from_record(dict(row))

    def get_api_key_by_hash(self, key_hash: str) -> ApiKey | None:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1",
            (key_hash,),
        ).fetchone()
        conn.close()
        if row is None:
            return None
        return ApiKey.from_record(dict(row))

    def list_api_keys(self, tenant_id: str) -> list[ApiKey]:
        conn = self._connect()
        rows = conn.execute(
            "SELECT * FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC",
            (tenant_id,),
        ).fetchall()
        conn.close()
        return [ApiKey.from_record(dict(row)) for row in rows]

    def create_api_key(self, api_key: ApiKey) -> ApiKey:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO api_keys (
                key_id, tenant_id, key_hash, key_prefix, name,
                scopes_json, enabled, last_used_at, expires_at,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                api_key.key_id,
                api_key.tenant_id,
                api_key.key_hash,
                api_key.key_prefix,
                api_key.name,
                json.dumps(api_key.scopes, ensure_ascii=False),
                1 if api_key.enabled else 0,
                api_key.last_used_at,
                api_key.expires_at,
                api_key.created_at,
                api_key.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_api_key(api_key.key_id)
        if created is None:
            raise RuntimeError(f"Failed to load created API key {api_key.key_id}")
        return created

    def update_api_key_last_used(self, key_id: str, last_used_at: str) -> None:
        conn = self._connect()
        conn.execute(
            "UPDATE api_keys SET last_used_at = ? WHERE key_id = ?",
            (last_used_at, key_id),
        )
        conn.commit()
        conn.close()

    def delete_api_key(self, key_id: str) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM api_keys WHERE key_id = ?", (key_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted
