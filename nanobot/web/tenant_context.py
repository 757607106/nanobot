"""Tenant context middleware for multi-tenant API authentication."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import Request


@dataclass
class TenantContext:
    """Holds the authenticated tenant information for the current request."""

    tenant_id: str
    key_id: str | None = None
    scopes: list[str] = field(default_factory=list)


def get_tenant_id(request: Request) -> str:
    """Extract tenant_id from request state, defaulting to 'default'."""
    ctx = getattr(request.state, "tenant", None)
    return ctx.tenant_id if ctx else "default"


async def tenant_auth_middleware(request: Request, call_next: Any) -> Any:
    """Composite authentication middleware: API Key first, cookie fallback.

    For API requests (/api/v1/), checks for:
    1. Authorization: Bearer nk_xxx header
    2. X-API-Key: nk_xxx header
    If found, validates the key and injects TenantContext into request.state.

    If no API key is present, falls through to existing cookie-based auth
    with tenant_id='default'.

    Paths excluded from API key auth:
    - /api/v1/auth/* (auth endpoints)
    - /api/v1/health (health check)
    - Non-API paths (frontend static files)
    """
    path = request.url.path

    # Only apply API key auth to /api/v1/ paths
    if not path.startswith("/api/v1/"):
        request.state.tenant = TenantContext(tenant_id="default")
        return await call_next(request)

    # Skip auth for certain paths
    if path.startswith("/api/v1/auth/") or path == "/api/v1/health":
        request.state.tenant = TenantContext(tenant_id="default")
        return await call_next(request)

    # Try to extract API key
    raw_key = _extract_api_key(request)

    if raw_key:
        tenant_service = getattr(request.app.state, "tenants_service", None)
        if tenant_service is None:
            # Tenant service not initialized, fall through
            request.state.tenant = TenantContext(tenant_id="default")
            return await call_next(request)

        validation = tenant_service.validate_api_key(raw_key)
        if validation is None:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"error": "Invalid or expired API key."},
            )

        tenant_id, key_id, scopes = validation

        # Optionally verify X-Tenant-Id header matches the key's tenant
        header_tenant_id = request.headers.get("x-tenant-id", "").strip()
        if header_tenant_id and header_tenant_id != tenant_id:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=403,
                content={"error": f"API key does not belong to tenant '{header_tenant_id}'."},
            )

        request.state.tenant = TenantContext(
            tenant_id=tenant_id,
            key_id=key_id,
            scopes=scopes,
        )
        return await call_next(request)

    # No API key - default tenant context (cookie auth handled elsewhere)
    request.state.tenant = TenantContext(tenant_id="default")
    return await call_next(request)


def _extract_api_key(request: Request) -> str | None:
    """Extract API key from request headers."""
    # Check Authorization: Bearer nk_xxx
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer ") and auth_header[7:].startswith("nk_"):
        return auth_header[7:].strip()

    # Check X-API-Key: nk_xxx
    api_key_header = request.headers.get("x-api-key", "")
    if api_key_header.startswith("nk_"):
        return api_key_header.strip()

    return None
