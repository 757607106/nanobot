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
from nanobot.web.tenant_context import get_control_plane_principal, get_control_plane_tenant_id

router = APIRouter()


def _require_tenant_control_plane(
    request: Request, *, tenant_id: str | None = None, require_tenant_selected: bool = True
) -> str | None:
    principal = get_control_plane_principal(request)
    if principal is None:
        raise APIError(401, "AUTH_REQUIRED", "Authentication required.")
    if not principal.is_platform_admin:
        raise APIError(
            403,
            "TENANT_CONTROL_PLANE_FORBIDDEN",
            "Tenant API keys cannot access the tenants control plane.",
        )
    selected_tenant_id = get_control_plane_tenant_id(request)
    if require_tenant_selected:
        if not selected_tenant_id:
            raise APIError(
                403,
                "TENANT_CONTEXT_REQUIRED",
                "Select a current tenant before using the tenants control plane.",
            )
        if tenant_id is not None and selected_tenant_id != tenant_id:
            raise APIError(
                403,
                "TENANT_CONTEXT_MISMATCH",
                f"Current tenant '{selected_tenant_id}' does not match '{tenant_id}'.",
            )
    return selected_tenant_id


# --- Tenant CRUD ---


@router.get("/api/v1/tenants")
def list_tenants(request: Request) -> JSONResponse:
    _require_tenant_control_plane(request)
    data = request.app.state.tenants_service.list_tenants()
    return _json_response(200, _ok(data))


@router.post("/api/v1/tenants")
def create_tenant(
    request: Request,
    payload: dict[str, Any] = Body(...),
) -> JSONResponse:
    _require_tenant_control_plane(request)
    try:
        data = request.app.state.tenants_service.create_tenant(payload)
    except TenantConflictError as exc:
        raise APIError(409, "TENANT_CONFLICT", str(exc)) from exc
    except TenantValidationError as exc:
        raise APIError(400, "TENANT_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.get("/api/v1/tenants/{tenant_id}")
def get_tenant(request: Request, tenant_id: str) -> JSONResponse:
    _require_tenant_control_plane(request, tenant_id=tenant_id)
    try:
        data = request.app.state.tenants_service.get_tenant(tenant_id)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/tenants/{tenant_id}/artifact-retention-policy")
def get_tenant_artifact_retention_policy(request: Request, tenant_id: str) -> JSONResponse:
    _require_tenant_control_plane(request, tenant_id=tenant_id)
    try:
        data = request.app.state.tenants_service.get_artifact_retention_policy(tenant_id)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/tenants/{tenant_id}/artifact-retention-policy")
def update_tenant_artifact_retention_policy(
    request: Request,
    tenant_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    _require_tenant_control_plane(request, tenant_id=tenant_id)
    try:
        data = request.app.state.tenants_service.update_artifact_retention_policy(tenant_id, payload)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    except TenantValidationError as exc:
        raise APIError(400, "TENANT_RETENTION_POLICY_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/tenants/{tenant_id}/audit")
def get_tenant_audit(request: Request, tenant_id: str) -> JSONResponse:
    _require_tenant_control_plane(request, tenant_id=tenant_id)
    try:
        data = request.app.state.tenants_service.get_tenant_audit(tenant_id)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/tenants/{tenant_id}")
def update_tenant(
    request: Request,
    tenant_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    _require_tenant_control_plane(request, tenant_id=tenant_id)
    try:
        data = request.app.state.tenants_service.update_tenant(tenant_id, payload)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    except TenantValidationError as exc:
        raise APIError(400, "TENANT_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/tenants/{tenant_id}")
def delete_tenant(request: Request, tenant_id: str) -> JSONResponse:
    _require_tenant_control_plane(request, tenant_id=tenant_id)
    try:
        deleted = request.app.state.tenants_service.delete_tenant(tenant_id)
    except TenantNotFoundError as exc:
        raise APIError(404, "TENANT_NOT_FOUND", "Tenant not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))


# --- API Key management ---


@router.get("/api/v1/tenants/{tenant_id}/api-keys")
def list_api_keys(request: Request, tenant_id: str) -> JSONResponse:
    _require_tenant_control_plane(request, tenant_id=tenant_id)
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
    _require_tenant_control_plane(request, tenant_id=tenant_id)
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
    _require_tenant_control_plane(request)
    try:
        deleted = request.app.state.tenants_service.revoke_api_key(key_id)
    except ApiKeyNotFoundError as exc:
        raise APIError(404, "API_KEY_NOT_FOUND", "API key not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))
