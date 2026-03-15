"""Tenant management routes for multi-tenant SaaS isolation."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from nanobot.platform.tenants import (
    ApiKeyNotFoundError,
    TenantConflictError,
    TenantNotFoundError,
    TenantValidationError,
)
from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


# --- Tenant CRUD ---


@router.get("/api/v1/tenants")
def list_tenants(request: Request) -> JSONResponse:
    data = request.app.state.tenants_service.list_tenants()
    return _json_response(200, _ok(data))


@router.post("/api/v1/tenants")
def create_tenant(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.tenants_service.create_tenant(payload)
    except TenantConflictError as exc:
        raise APIError(409, "TENANT_CONFLICT", str(exc)) from exc
    except TenantValidationError as exc:
        raise APIError(400, "TENANT_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.get("/api/v1/tenants/{tenant_id}")
def get_tenant(request: Request, tenant_id: str) -> JSONResponse:
    try:
        data = request.app.state.tenants_service.get_tenant(tenant_id)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/tenants/{tenant_id}")
def update_tenant(
    request: Request,
    tenant_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.tenants_service.update_tenant(tenant_id, payload)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    except TenantValidationError as exc:
        raise APIError(400, "TENANT_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/tenants/{tenant_id}")
def delete_tenant(request: Request, tenant_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.tenants_service.delete_tenant(tenant_id)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))


# --- API Key management ---


@router.get("/api/v1/tenants/{tenant_id}/api-keys")
def list_api_keys(request: Request, tenant_id: str) -> JSONResponse:
    try:
        data = request.app.state.tenants_service.list_api_keys(tenant_id)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/tenants/{tenant_id}/api-keys")
def create_api_key(
    request: Request,
    tenant_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    name = str(payload.get("name") or "").strip()
    scopes = payload.get("scopes")
    expires_at = payload.get("expiresAt") or payload.get("expires_at")
    try:
        data = request.app.state.tenants_service.create_api_key(
            tenant_id,
            name=name,
            scopes=scopes if isinstance(scopes, list) else None,
            expires_at=str(expires_at).strip() if expires_at else None,
        )
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    except TenantValidationError as exc:
        raise APIError(400, "API_KEY_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.delete("/api/v1/api-keys/{key_id}")
def revoke_api_key(request: Request, key_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.tenants_service.revoke_api_key(key_id)
    except ApiKeyNotFoundError as exc:
        raise APIError(404, "API_KEY_NOT_FOUND", "API key not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))
