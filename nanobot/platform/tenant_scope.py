"""Shared helpers for tenant-aware service views and lookups."""

from __future__ import annotations

import inspect
from typing import Any, Callable


def clone_service_with_overrides(service: Any, /, **overrides: Any) -> Any:
    """Create a shallow service view with a few overridden attributes."""
    clone = object.__new__(type(service))
    clone.__dict__ = dict(getattr(service, "__dict__", {}))
    clone.__dict__.update(overrides)
    return clone


def call_with_optional_tenant(
    lookup: Callable[..., Any] | None,
    identifier: str,
    *,
    tenant_id: str | None = None,
) -> Any:
    """Invoke a lookup callable, passing ``tenant_id`` only when supported."""
    if lookup is None:
        return None
    if tenant_id is None:
        return lookup(identifier)
    try:
        signature = inspect.signature(lookup)
    except (TypeError, ValueError):
        return lookup(identifier)
    parameters = signature.parameters.values()
    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters):
        return lookup(identifier, tenant_id=tenant_id)
    if "tenant_id" in signature.parameters:
        return lookup(identifier, tenant_id=tenant_id)
    return lookup(identifier)


def call_with_tenant(
    lookup: Callable[..., Any] | None,
    identifier: str,
    *,
    tenant_id: str,
) -> Any:
    """Invoke a tenant-aware lookup and require tenant support."""
    if lookup is None:
        return None
    normalized_tenant_id = str(tenant_id or "").strip()
    if not normalized_tenant_id:
        raise ValueError("tenant_id is required for tenant-aware lookup.")
    try:
        signature = inspect.signature(lookup)
    except (TypeError, ValueError) as exc:
        raise TypeError("tenant-aware lookup must accept tenant_id.") from exc
    parameters = signature.parameters.values()
    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters):
        return lookup(identifier, tenant_id=normalized_tenant_id)
    if "tenant_id" in signature.parameters:
        return lookup(identifier, tenant_id=normalized_tenant_id)
    raise TypeError("tenant-aware lookup must accept tenant_id.")


def normalize_tenant_id(value: Any, *, default: str = "default") -> str:
    """Normalize one tenant identifier with a stable fallback."""
    normalized = str(value or "").strip()
    if normalized:
        return normalized
    fallback = str(default or "").strip()
    return fallback or "default"


def tenant_id_from_metadata(metadata: dict[str, Any] | None, *, default: str = "default") -> str:
    """Extract a tenant id from message-style metadata payloads."""
    if not isinstance(metadata, dict):
        return normalize_tenant_id(None, default=default)
    for key in ("_routing_tenant_id", "tenant_id", "tenantId"):
        raw_value = metadata.get(key)
        normalized = str(raw_value or "").strip()
        if normalized:
            return normalized
    return normalize_tenant_id(None, default=default)
