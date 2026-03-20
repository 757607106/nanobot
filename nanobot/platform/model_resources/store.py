"""SQLite store for model provider resources."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from nanobot.platform.model_resources.models import ModelProvider, SystemModelDefaults


class ModelProviderStore:
    """Persist model providers and capability defaults in an instance-scoped SQLite file."""

    _CREATE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS model_providers (
            provider_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_model_providers_tenant_instance
        ON model_providers(tenant_id, instance_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_model_providers_enabled
        ON model_providers(enabled);
        CREATE INDEX IF NOT EXISTS idx_model_providers_display_name
        ON model_providers(display_name);

        CREATE TABLE IF NOT EXISTS system_model_defaults (
            tenant_id TEXT NOT NULL,
            instance_id TEXT NOT NULL,
            config_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (tenant_id, instance_id)
        );
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
    def _deserialize_provider(row: sqlite3.Row | None) -> ModelProvider | None:
        if row is None:
            return None
        return ModelProvider.from_record(dict(row))

    @staticmethod
    def _deserialize_defaults(row: sqlite3.Row | None) -> SystemModelDefaults | None:
        if row is None:
            return None
        return SystemModelDefaults.from_record(dict(row))

    def get_provider(self, provider_id: str, *, tenant_id: str | None = None) -> ModelProvider | None:
        conn = self._connect()
        if tenant_id is None:
            row = conn.execute(
                "SELECT * FROM model_providers WHERE provider_id = ?",
                (provider_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM model_providers WHERE provider_id = ? AND tenant_id = ?",
                (provider_id, tenant_id),
            ).fetchone()
        conn.close()
        return self._deserialize_provider(row)

    def get_provider_by_name(self, display_name: str, *, tenant_id: str, instance_id: str) -> ModelProvider | None:
        conn = self._connect()
        row = conn.execute(
            """
            SELECT * FROM model_providers
            WHERE tenant_id = ? AND instance_id = ? AND display_name = ?
            """,
            (tenant_id, instance_id, display_name),
        ).fetchone()
        conn.close()
        return self._deserialize_provider(row)

    def list_providers(
        self,
        *,
        tenant_id: str,
        instance_id: str,
        enabled: bool | None = None,
    ) -> list[ModelProvider]:
        where = ["tenant_id = ?", "instance_id = ?"]
        values: list[Any] = [tenant_id, instance_id]
        if enabled is not None:
            where.append("enabled = ?")
            values.append(1 if enabled else 0)
        conn = self._connect()
        rows = conn.execute(
            f"""
            SELECT * FROM model_providers
            WHERE {' AND '.join(where)}
            ORDER BY enabled DESC, updated_at DESC, display_name ASC
            """,
            values,
        ).fetchall()
        conn.close()
        return [provider for row in rows if (provider := self._deserialize_provider(row)) is not None]

    def create_provider(self, provider: ModelProvider) -> ModelProvider:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO model_providers (
                provider_id, tenant_id, instance_id, display_name, enabled,
                config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                provider.provider_id,
                provider.tenant_id,
                provider.instance_id,
                provider.display_name,
                1 if provider.enabled else 0,
                provider.to_storage_json(),
                provider.created_at,
                provider.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        created = self.get_provider(provider.provider_id)
        if created is None:
            raise RuntimeError(f"Failed to load created model provider {provider.provider_id}")
        return created

    def update_provider(self, provider: ModelProvider, *, tenant_id: str | None = None) -> ModelProvider | None:
        conn = self._connect()
        cursor = conn.cursor()
        if tenant_id is None:
            cursor.execute(
                """
                UPDATE model_providers
                SET display_name = ?, enabled = ?, config_json = ?, updated_at = ?
                WHERE provider_id = ?
                """,
                (
                    provider.display_name,
                    1 if provider.enabled else 0,
                    provider.to_storage_json(),
                    provider.updated_at,
                    provider.provider_id,
                ),
            )
        else:
            cursor.execute(
                """
                UPDATE model_providers
                SET display_name = ?, enabled = ?, config_json = ?, updated_at = ?
                WHERE provider_id = ? AND tenant_id = ?
                """,
                (
                    provider.display_name,
                    1 if provider.enabled else 0,
                    provider.to_storage_json(),
                    provider.updated_at,
                    provider.provider_id,
                    tenant_id,
                ),
            )
        conn.commit()
        updated = cursor.rowcount > 0
        conn.close()
        if not updated:
            return None
        return self.get_provider(provider.provider_id, tenant_id=tenant_id)

    def delete_provider(self, provider_id: str, *, tenant_id: str | None = None) -> bool:
        conn = self._connect()
        cursor = conn.cursor()
        if tenant_id is None:
            cursor.execute("DELETE FROM model_providers WHERE provider_id = ?", (provider_id,))
        else:
            cursor.execute(
                "DELETE FROM model_providers WHERE provider_id = ? AND tenant_id = ?",
                (provider_id, tenant_id),
            )
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    def get_defaults(self, *, tenant_id: str, instance_id: str) -> SystemModelDefaults | None:
        conn = self._connect()
        row = conn.execute(
            """
            SELECT tenant_id, instance_id, config_json, updated_at
            FROM system_model_defaults
            WHERE tenant_id = ? AND instance_id = ?
            """,
            (tenant_id, instance_id),
        ).fetchone()
        conn.close()
        return self._deserialize_defaults(row)

    def save_defaults(self, defaults: SystemModelDefaults) -> SystemModelDefaults:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO system_model_defaults (tenant_id, instance_id, config_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(tenant_id, instance_id)
            DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
            """,
            (
                defaults.tenant_id,
                defaults.instance_id,
                defaults.to_storage_json(),
                defaults.updated_at,
            ),
        )
        conn.commit()
        conn.close()
        saved = self.get_defaults(tenant_id=defaults.tenant_id, instance_id=defaults.instance_id)
        if saved is None:
            raise RuntimeError("Failed to load saved model defaults")
        return saved
