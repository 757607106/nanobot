"""PostgreSQL store for tenants and API keys."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from nanobot.config.schema import RagPostgresConfig
from nanobot.platform.postgres_store import WorkspacePostgresStore
from nanobot.platform.tenants.models import ApiKey, Tenant
from nanobot.storage.postgres import pg_dict, pg_json, pg_list


class TenantStore(WorkspacePostgresStore):
    """Persist tenants and API keys in one shared PostgreSQL store."""

    _FEATURE_NAME = "Tenant store"
    _SCHEMA_NAMESPACE = "platform_tenants"
    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS tenants (
            workspace_key TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            plan TEXT NOT NULL DEFAULT 'free',
            settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_key, tenant_id)
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            workspace_key TEXT NOT NULL,
            key_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            key_hash TEXT NOT NULL,
            key_prefix TEXT NOT NULL,
            name TEXT NOT NULL,
            scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            last_used_at TEXT,
            expires_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_key, key_id),
            FOREIGN KEY (workspace_key, tenant_id)
                REFERENCES tenants(workspace_key, tenant_id)
                ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash
        ON api_keys(workspace_key, key_hash);
        CREATE INDEX IF NOT EXISTS idx_api_keys_tenant
        ON api_keys(workspace_key, tenant_id, created_at DESC);
    """

    def __init__(self, workspace: Path, postgres: RagPostgresConfig | dict[str, Any] | None = None):
        super().__init__(workspace, postgres)

    @staticmethod
    def _deserialize_tenant(row: dict[str, Any] | None) -> Tenant | None:
        if row is None:
            return None
        payload = dict(row)
        payload["settings_json"] = pg_json(pg_dict(payload.get("settings_json")))
        return Tenant.from_record(payload)

    @staticmethod
    def _deserialize_api_key(row: dict[str, Any] | None) -> ApiKey | None:
        if row is None:
            return None
        payload = dict(row)
        payload["scopes_json"] = pg_json(pg_list(payload.get("scopes_json")))
        return ApiKey.from_record(payload)

    def get_tenant(self, tenant_id: str) -> Tenant | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM tenants
                    WHERE workspace_key = %s AND tenant_id = %s
                    """,
                    (self.workspace_key, tenant_id),
                )
                row = cur.fetchone()
        return self._deserialize_tenant(row)

    def list_tenants(self) -> list[Tenant]:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM tenants
                    WHERE workspace_key = %s
                    ORDER BY created_at DESC
                    """,
                    (self.workspace_key,),
                )
                rows = cur.fetchall()
        return [tenant for row in rows if (tenant := self._deserialize_tenant(row)) is not None]

    def create_tenant(self, tenant: Tenant) -> Tenant:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO tenants (
                        workspace_key,
                        tenant_id,
                        name,
                        status,
                        plan,
                        settings_json,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        self.workspace_key,
                        tenant.tenant_id,
                        tenant.name,
                        tenant.status,
                        tenant.plan,
                        pg_json(tenant.settings),
                        tenant.created_at,
                        tenant.updated_at,
                    ),
                )
        created = self.get_tenant(tenant.tenant_id)
        if created is None:
            raise RuntimeError(f"Failed to load created tenant {tenant.tenant_id}")
        return created

    def update_tenant(self, tenant: Tenant) -> Tenant | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE tenants
                    SET name = %s, status = %s, plan = %s, settings_json = %s::jsonb, updated_at = %s
                    WHERE workspace_key = %s AND tenant_id = %s
                    """,
                    (
                        tenant.name,
                        tenant.status,
                        tenant.plan,
                        pg_json(tenant.settings),
                        tenant.updated_at,
                        self.workspace_key,
                        tenant.tenant_id,
                    ),
                )
                updated = cur.rowcount > 0
        if not updated:
            return None
        return self.get_tenant(tenant.tenant_id)

    def delete_tenant(self, tenant_id: str) -> bool:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM tenants
                    WHERE workspace_key = %s AND tenant_id = %s
                    """,
                    (self.workspace_key, tenant_id),
                )
                return cur.rowcount > 0

    def get_api_key(self, key_id: str) -> ApiKey | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM api_keys
                    WHERE workspace_key = %s AND key_id = %s
                    """,
                    (self.workspace_key, key_id),
                )
                row = cur.fetchone()
        return self._deserialize_api_key(row)

    def get_api_key_by_hash(self, key_hash: str) -> ApiKey | None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM api_keys
                    WHERE workspace_key = %s AND key_hash = %s AND enabled = TRUE
                    """,
                    (self.workspace_key, key_hash),
                )
                row = cur.fetchone()
        return self._deserialize_api_key(row)

    def list_api_keys(self, tenant_id: str) -> list[ApiKey]:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM api_keys
                    WHERE workspace_key = %s AND tenant_id = %s
                    ORDER BY created_at DESC
                    """,
                    (self.workspace_key, tenant_id),
                )
                rows = cur.fetchall()
        return [api_key for row in rows if (api_key := self._deserialize_api_key(row)) is not None]

    def create_api_key(self, api_key: ApiKey) -> ApiKey:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO api_keys (
                        workspace_key,
                        key_id,
                        tenant_id,
                        key_hash,
                        key_prefix,
                        name,
                        scopes_json,
                        enabled,
                        last_used_at,
                        expires_at,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
                    """,
                    (
                        self.workspace_key,
                        api_key.key_id,
                        api_key.tenant_id,
                        api_key.key_hash,
                        api_key.key_prefix,
                        api_key.name,
                        pg_json(api_key.scopes),
                        bool(api_key.enabled),
                        api_key.last_used_at,
                        api_key.expires_at,
                        api_key.created_at,
                        api_key.updated_at,
                    ),
                )
        created = self.get_api_key(api_key.key_id)
        if created is None:
            raise RuntimeError(f"Failed to load created API key {api_key.key_id}")
        return created

    def update_api_key_last_used(self, key_id: str, last_used_at: str) -> None:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE api_keys
                    SET last_used_at = %s
                    WHERE workspace_key = %s AND key_id = %s
                    """,
                    (last_used_at, self.workspace_key, key_id),
                )

    def delete_api_key(self, key_id: str) -> bool:
        with self._connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM api_keys
                    WHERE workspace_key = %s AND key_id = %s
                    """,
                    (self.workspace_key, key_id),
                )
                return cur.rowcount > 0
