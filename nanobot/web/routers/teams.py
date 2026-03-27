"""Team definition routes for the collaboration control plane."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nanobot.platform.teams import (
    TeamDefinitionConflictError,
    TeamDefinitionNotFoundError,
    TeamDefinitionValidationError,
)
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_id

router = APIRouter()


class TeamRunRequest(BaseModel):
    content: str


class TeamRunRetryRequest(BaseModel):
    appendContext: str | None = None


@router.get("/api/v1/teams")
def list_teams(
    request: Request,
    enabled: bool | None = Query(default=None),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    return _json_response(200, _ok(request.app.state.teams.list_teams(tenant_id=tenant_id, enabled=enabled)))


@router.post("/api/v1/teams")
def create_team(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.teams.create_team(payload, tenant_id=tenant_id)
    except TeamDefinitionConflictError as exc:
        raise APIError(409, "TEAM_CONFLICT", str(exc)) from exc
    except TeamDefinitionValidationError as exc:
        raise APIError(400, "TEAM_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.get("/api/v1/teams/{team_id}")
def get_team(request: Request, team_id: str) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.teams.get_team(team_id, tenant_id=tenant_id)
    except TeamDefinitionNotFoundError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/teams/{team_id}/thread")
def get_team_thread(
    request: Request,
    team_id: str,
    origin_channel: str = Query(default="web", alias="originChannel"),
    origin_chat_id: str | None = Query(default=None, alias="originChatId"),
    session_key: str | None = Query(default=None, alias="sessionKey"),
) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.web.team_runtime.get_team_thread_summary(
            team_id,
            tenant_id=tenant_id,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            session_key=session_key,
        )
    except TeamDefinitionNotFoundError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/teams/{team_id}/thread/messages")
def get_team_thread_messages(
    request: Request,
    team_id: str,
    limit: int = Query(default=40, ge=1, le=200),
    origin_channel: str = Query(default="web", alias="originChannel"),
    origin_chat_id: str | None = Query(default=None, alias="originChatId"),
    session_key: str | None = Query(default=None, alias="sessionKey"),
) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.web.team_runtime.get_team_thread_messages(
            team_id,
            tenant_id=tenant_id,
            limit=limit,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            session_key=session_key,
        )
    except TeamDefinitionNotFoundError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/teams/{team_id}")
def update_team(
    request: Request,
    team_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.teams.update_team(team_id, payload, tenant_id=tenant_id)
    except TeamDefinitionNotFoundError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    except TeamDefinitionConflictError as exc:
        raise APIError(409, "TEAM_CONFLICT", str(exc)) from exc
    except TeamDefinitionValidationError as exc:
        raise APIError(400, "TEAM_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/teams/{team_id}")
def delete_team(request: Request, team_id: str) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        deleted = request.app.state.teams.delete_team(team_id, tenant_id=tenant_id)
    except TeamDefinitionNotFoundError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))


@router.post("/api/v1/teams/{team_id}/copy")
def copy_team(
    request: Request,
    team_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.teams.copy_team(team_id, payload, tenant_id=tenant_id)
    except TeamDefinitionNotFoundError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    except TeamDefinitionConflictError as exc:
        raise APIError(409, "TEAM_CONFLICT", str(exc)) from exc
    except TeamDefinitionValidationError as exc:
        raise APIError(400, "TEAM_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.post("/api/v1/teams/{team_id}/enable")
def enable_team(request: Request, team_id: str) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.teams.set_enabled(team_id, True, tenant_id=tenant_id)
    except TeamDefinitionNotFoundError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/teams/{team_id}/disable")
def disable_team(request: Request, team_id: str) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.teams.set_enabled(team_id, False, tenant_id=tenant_id)
    except TeamDefinitionNotFoundError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/teams/{team_id}/runs")
async def run_team(
    request: Request,
    team_id: str,
    payload: TeamRunRequest,
) -> JSONResponse:
    try:
        data = await request.app.state.web.test_team_run(
            team_id,
            payload.content,
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    except ValueError as exc:
        raise APIError(400, "TEAM_RUN_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/teams/{team_id}/runs/{run_id}/retry")
async def retry_team_run(
    request: Request,
    team_id: str,
    run_id: str,
    payload: TeamRunRetryRequest,
) -> JSONResponse:
    try:
        data = await request.app.state.web.team_runtime.retry_team_run(
            team_id,
            run_id,
            tenant_id=get_tenant_id(request),
            append_context=payload.appendContext,
        )
    except KeyError as exc:
        raise APIError(404, "TEAM_NOT_FOUND", "Team not found.") from exc
    except ValueError as exc:
        raise APIError(400, "TEAM_RUN_RETRY_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))
