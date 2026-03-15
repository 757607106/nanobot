"""Channel binding routes for routing messages to agents or teams."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from nanobot.platform.channel_bindings import (
    ChannelBindingConflictError,
    ChannelBindingNotFoundError,
    ChannelBindingValidationError,
)
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_id

router = APIRouter()


@router.get("/api/v1/channel-bindings")
def list_channel_bindings(request: Request) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    data = request.app.state.channel_bindings_service.list_bindings(tenant_id=tenant_id)
    return _json_response(200, _ok(data))


@router.post("/api/v1/channel-bindings")
def create_channel_binding(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    try:
        data = request.app.state.channel_bindings_service.create_binding(
            payload, tenant_id=tenant_id,
        )
    except ChannelBindingConflictError as exc:
        raise APIError(409, "CHANNEL_BINDING_CONFLICT", str(exc)) from exc
    except ChannelBindingValidationError as exc:
        raise APIError(400, "CHANNEL_BINDING_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.get("/api/v1/channel-bindings/{binding_id}")
def get_channel_binding(request: Request, binding_id: str) -> JSONResponse:
    try:
        data = request.app.state.channel_bindings_service.get_binding(binding_id)
    except ChannelBindingNotFoundError as exc:
        raise APIError(404, "CHANNEL_BINDING_NOT_FOUND", "Channel binding not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/channel-bindings/{binding_id}")
def update_channel_binding(
    request: Request,
    binding_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.channel_bindings_service.update_binding(binding_id, payload)
    except ChannelBindingNotFoundError as exc:
        raise APIError(404, "CHANNEL_BINDING_NOT_FOUND", "Channel binding not found.") from exc
    except ChannelBindingConflictError as exc:
        raise APIError(409, "CHANNEL_BINDING_CONFLICT", str(exc)) from exc
    except ChannelBindingValidationError as exc:
        raise APIError(400, "CHANNEL_BINDING_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/channel-bindings/{binding_id}")
def delete_channel_binding(request: Request, binding_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.channel_bindings_service.delete_binding(binding_id)
    except ChannelBindingNotFoundError as exc:
        raise APIError(404, "CHANNEL_BINDING_NOT_FOUND", "Channel binding not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))


@router.post("/api/v1/channel-bindings/resolve")
def resolve_channel_binding(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    channel_name = str(payload.get("channelName") or payload.get("channel_name") or "").strip()
    chat_id = str(payload.get("chatId") or payload.get("chat_id") or "").strip()
    if not channel_name:
        raise APIError(400, "CHANNEL_BINDING_VALIDATION_ERROR", "channelName is required.")
    if not chat_id:
        raise APIError(400, "CHANNEL_BINDING_VALIDATION_ERROR", "chatId is required.")

    binding = request.app.state.channel_bindings_service.resolve_binding(
        channel_name, chat_id, tenant_id=tenant_id,
    )
    if binding is None:
        return _json_response(200, _ok({"binding": None, "resolved": False}))
    return _json_response(200, _ok({"binding": binding.to_dict(), "resolved": True}))
