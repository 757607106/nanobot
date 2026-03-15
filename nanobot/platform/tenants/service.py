"""Service layer for tenant management and API key operations."""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import replace
from typing import Any

from nanobot.platform.tenants.models import ApiKey, Tenant, now_iso
from nanobot.platform.tenants.store import TenantStore


class TenantNotFoundError(KeyError):
    """Raised when a tenant does not exist."""


class TenantConflictError(RuntimeError):
    """Raised when a tenant would conflict with an existing one."""


class TenantValidationError(ValueError):
    """Raised when a tenant payload is invalid."""


class ApiKeyNotFoundError(KeyError):
    """Raised when an API key does not exist."""


_API_KEY_PREFIX = "nk_"


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "tenant"


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


class TenantService:
    """CRUD service for tenants and API keys."""

    def __init__(self, store: TenantStore):
        self.store = store

    def _next_tenant_id(self, name: str) -> str:
        base = _slugify(name)
        candidate = base
        counter = 2
        while self.store.get_tenant(candidate) is not None:
            candidate = f"{base}-{counter}"
            counter += 1
        return candidate

    # --- Tenant CRUD ---

    def create_tenant(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise TenantValidationError("name is required.")

        tenant_id = str(payload.get("tenantId") or payload.get("tenant_id") or "").strip()
        if not tenant_id:
            tenant_id = self._next_tenant_id(name)
        elif self.store.get_tenant(tenant_id) is not None:
            raise TenantConflictError(f"Tenant '{tenant_id}' already exists.")

        status = str(payload.get("status") or "active").strip()
        plan = str(payload.get("plan") or "free").strip()
        settings = payload.get("settings") or {}

        now = now_iso()
        tenant = Tenant(
            tenant_id=tenant_id,
            name=name,
            status=status,
            plan=plan,
            settings=settings if isinstance(settings, dict) else {},
            created_at=now,
            updated_at=now,
        )
        return self.store.create_tenant(tenant).to_dict()

    def get_tenant(self, tenant_id: str) -> dict[str, Any]:
        tenant = self.store.get_tenant(tenant_id)
        if tenant is None:
            raise TenantNotFoundError(tenant_id)
        return tenant.to_dict()

    def list_tenants(self) -> list[dict[str, Any]]:
        return [t.to_dict() for t in self.store.list_tenants()]

    def update_tenant(self, tenant_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.store.get_tenant(tenant_id)
        if existing is None:
            raise TenantNotFoundError(tenant_id)

        updated = replace(
            existing,
            name=str(payload["name"]).strip() if "name" in payload else existing.name,
            status=str(payload["status"]).strip() if "status" in payload else existing.status,
            plan=str(payload["plan"]).strip() if "plan" in payload else existing.plan,
            settings=payload["settings"] if "settings" in payload and isinstance(payload["settings"], dict) else existing.settings,
            updated_at=now_iso(),
        )
        result = self.store.update_tenant(updated)
        if result is None:
            raise TenantNotFoundError(tenant_id)
        return result.to_dict()

    def delete_tenant(self, tenant_id: str) -> bool:
        if not self.store.delete_tenant(tenant_id):
            raise TenantNotFoundError(tenant_id)
        return True

    # --- API Key operations ---

    def create_api_key(
        self,
        tenant_id: str,
        *,
        name: str,
        scopes: list[str] | None = None,
        expires_at: str | None = None,
    ) -> dict[str, Any]:
        tenant = self.store.get_tenant(tenant_id)
        if tenant is None:
            raise TenantNotFoundError(tenant_id)

        name = str(name or "").strip()
        if not name:
            raise TenantValidationError("API key name is required.")

        raw_key = f"{_API_KEY_PREFIX}{secrets.token_hex(32)}"
        key_hash = _hash_key(raw_key)
        key_prefix = raw_key[:12]
        key_id = f"ak-{secrets.token_hex(8)}"

        now = now_iso()
        api_key = ApiKey(
            key_id=key_id,
            tenant_id=tenant_id,
            key_hash=key_hash,
            key_prefix=key_prefix,
            name=name,
            scopes=scopes or ["read", "write"],
            enabled=True,
            expires_at=expires_at,
            created_at=now,
            updated_at=now,
        )
        created = self.store.create_api_key(api_key)
        result = created.to_dict()
        result["key"] = raw_key
        return result

    def validate_api_key(self, raw_key: str) -> tuple[str, str, list[str]] | None:
        """Validate an API key. Returns (tenant_id, key_id, scopes) or None."""
        if not raw_key or not raw_key.startswith(_API_KEY_PREFIX):
            return None
        key_hash = _hash_key(raw_key)
        api_key = self.store.get_api_key_by_hash(key_hash)
        if api_key is None:
            return None
        if not api_key.enabled:
            return None
        if api_key.expires_at:
            from datetime import datetime, timezone
            try:
                expires = datetime.fromisoformat(api_key.expires_at.replace("Z", "+00:00"))
                if expires < datetime.now(timezone.utc):
                    return None
            except (ValueError, TypeError):
                pass
        self.store.update_api_key_last_used(api_key.key_id, now_iso())
        return (api_key.tenant_id, api_key.key_id, api_key.scopes)

    def list_api_keys(self, tenant_id: str) -> list[dict[str, Any]]:
        tenant = self.store.get_tenant(tenant_id)
        if tenant is None:
            raise TenantNotFoundError(tenant_id)
        return [k.to_dict() for k in self.store.list_api_keys(tenant_id)]

    def revoke_api_key(self, key_id: str) -> bool:
        if not self.store.delete_api_key(key_id):
            raise ApiKeyNotFoundError(key_id)
        return True
