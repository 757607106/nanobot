"""Tenant and API key models for multi-tenant SaaS isolation."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class Tenant:
    """Represents a tenant in the multi-tenant platform."""

    tenant_id: str
    name: str
    status: str = "active"
    plan: str = "free"
    settings: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenantId": self.tenant_id,
            "name": self.name,
            "status": self.status,
            "plan": self.plan,
            "settings": self.settings,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> Tenant:
        settings_raw = record.get("settings_json") or "{}"
        settings = json.loads(settings_raw) if isinstance(settings_raw, str) else settings_raw
        return cls(
            tenant_id=record["tenant_id"],
            name=record["name"],
            status=record.get("status") or "active",
            plan=record.get("plan") or "free",
            settings=settings,
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )


@dataclass(slots=True)
class ApiKey:
    """Represents an API key belonging to a tenant."""

    key_id: str
    tenant_id: str
    key_hash: str
    key_prefix: str
    name: str
    scopes: list[str] = field(default_factory=list)
    enabled: bool = True
    last_used_at: str | None = None
    expires_at: str | None = None
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "keyId": self.key_id,
            "tenantId": self.tenant_id,
            "keyPrefix": self.key_prefix,
            "name": self.name,
            "scopes": self.scopes,
            "enabled": self.enabled,
            "lastUsedAt": self.last_used_at,
            "expiresAt": self.expires_at,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> ApiKey:
        scopes_raw = record.get("scopes_json") or "[]"
        scopes = json.loads(scopes_raw) if isinstance(scopes_raw, str) else scopes_raw
        return cls(
            key_id=record["key_id"],
            tenant_id=record["tenant_id"],
            key_hash=record["key_hash"],
            key_prefix=record.get("key_prefix") or "",
            name=record.get("name") or "",
            scopes=scopes if isinstance(scopes, list) else [],
            enabled=bool(record.get("enabled", True)),
            last_used_at=record.get("last_used_at"),
            expires_at=record.get("expires_at"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )
