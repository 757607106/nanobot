"""Model provider resource routes for the nanobot Web UI."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse

from nanobot.platform.model_resources import (
    ModelProviderConflictError,
    ModelProviderNotFoundError,
    ModelProviderValidationError,
)
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_id

router = APIRouter()


@router.get("/api/v1/model-providers")
def list_model_providers(
    request: Request,
    enabled: bool | None = Query(default=None),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    data = request.app.state.model_providers.list_providers(tenant_id=tenant_id, enabled=enabled)
    return _json_response(200, _ok(data))


@router.post("/api/v1/model-providers")
def create_model_provider(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    try:
        data = request.app.state.model_providers.create_provider(payload, tenant_id=tenant_id)
    except ModelProviderConflictError as exc:
        raise APIError(409, "MODEL_PROVIDER_CONFLICT", str(exc)) from exc
    except ModelProviderValidationError as exc:
        raise APIError(400, "MODEL_PROVIDER_INVALID", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.get("/api/v1/model-providers/{provider_id}")
def get_model_provider(request: Request, provider_id: str) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    try:
        data = request.app.state.model_providers.get_provider(provider_id, tenant_id=tenant_id)
    except ModelProviderNotFoundError as exc:
        raise APIError(404, "MODEL_PROVIDER_NOT_FOUND", "Model provider not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/model-providers/{provider_id}")
def update_model_provider(
    request: Request,
    provider_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    try:
        data = request.app.state.model_providers.update_provider(
            provider_id,
            payload,
            tenant_id=tenant_id,
        )
    except ModelProviderNotFoundError as exc:
        raise APIError(404, "MODEL_PROVIDER_NOT_FOUND", "Model provider not found.") from exc
    except ModelProviderConflictError as exc:
        raise APIError(409, "MODEL_PROVIDER_CONFLICT", str(exc)) from exc
    except ModelProviderValidationError as exc:
        raise APIError(400, "MODEL_PROVIDER_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/model-providers/{provider_id}")
def delete_model_provider(request: Request, provider_id: str) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    try:
        deleted = request.app.state.model_providers.delete_provider(provider_id, tenant_id=tenant_id)
    except ModelProviderNotFoundError as exc:
        raise APIError(404, "MODEL_PROVIDER_NOT_FOUND", "Model provider not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))


@router.post("/api/v1/model-providers/{provider_id}/test")
def test_model_provider(request: Request, provider_id: str) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    try:
        data = request.app.state.model_providers.test_provider(provider_id, tenant_id=tenant_id)
    except ModelProviderNotFoundError as exc:
        raise APIError(404, "MODEL_PROVIDER_NOT_FOUND", "Model provider not found.") from exc
    except ModelProviderValidationError as exc:
        raise APIError(400, "MODEL_PROVIDER_TEST_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/model-defaults")
def get_model_defaults(request: Request) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    return _json_response(200, _ok(request.app.state.model_providers.get_defaults(tenant_id=tenant_id)))


@router.put("/api/v1/model-defaults")
def update_model_defaults(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    try:
        data = request.app.state.model_providers.update_defaults(payload, tenant_id=tenant_id)
    except ModelProviderValidationError as exc:
        raise APIError(400, "MODEL_DEFAULTS_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))
