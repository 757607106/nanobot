"""Agent definition routes for the collaboration control plane."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nanobot.platform.agents import (
    AgentDefinitionConflictError,
    AgentDefinitionNotFoundError,
    AgentDefinitionValidationError,
)
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_id

router = APIRouter()


class AgentTestRunRequest(BaseModel):
    content: str


def _default_tools(request: Request) -> list[str]:
    return [
        item["name"]
        for item in request.app.state.web.workspace_runtime.get_template_tool_catalog()
    ]


def _resolve_template_snapshot(request: Request, payload: dict[str, Any]) -> dict[str, Any] | None:
    template_name = payload.get("templateName") or payload.get("template_name")
    if not template_name:
        return None
    try:
        return request.app.state.web.get_agent_template(str(template_name))
    except KeyError as exc:
        raise APIError(404, "AGENT_TEMPLATE_NOT_FOUND", "Agent template not found.") from exc


@router.get("/api/v1/agents")
def list_agents(
    request: Request,
    enabled: bool | None = Query(default=None),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    return _json_response(200, _ok(request.app.state.agents.list_agents(tenant_id=tenant_id, enabled=enabled)))


@router.post("/api/v1/agents")
def create_agent(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.agents.create_agent(
            payload,
            tenant_id=tenant_id,
            default_model=request.app.state.web.config.agents.defaults.model,
            default_tools=_default_tools(request),
            template_snapshot=_resolve_template_snapshot(request, payload),
        )
    except AgentDefinitionConflictError as exc:
        raise APIError(409, "AGENT_CONFLICT", str(exc)) from exc
    except AgentDefinitionValidationError as exc:
        raise APIError(400, "AGENT_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.get("/api/v1/agents/{agent_id}")
def get_agent(request: Request, agent_id: str) -> JSONResponse:
    try:
        data = request.app.state.agents.get_agent(agent_id)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/agents/{agent_id}")
def update_agent(
    request: Request,
    agent_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.agents.update_agent(agent_id, payload)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    except AgentDefinitionConflictError as exc:
        raise APIError(409, "AGENT_CONFLICT", str(exc)) from exc
    except AgentDefinitionValidationError as exc:
        raise APIError(400, "AGENT_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/agents/{agent_id}")
def delete_agent(request: Request, agent_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.agents.delete_agent(agent_id)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))


@router.post("/api/v1/agents/{agent_id}/copy")
def copy_agent(
    request: Request,
    agent_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.agents.copy_agent(agent_id, payload)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    except AgentDefinitionConflictError as exc:
        raise APIError(409, "AGENT_CONFLICT", str(exc)) from exc
    except AgentDefinitionValidationError as exc:
        raise APIError(400, "AGENT_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.post("/api/v1/agents/{agent_id}/enable")
def enable_agent(request: Request, agent_id: str) -> JSONResponse:
    try:
        data = request.app.state.agents.set_enabled(agent_id, True)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/agents/{agent_id}/disable")
def disable_agent(request: Request, agent_id: str) -> JSONResponse:
    try:
        data = request.app.state.agents.set_enabled(agent_id, False)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/agents/{agent_id}/test-run")
async def test_run_agent(
    request: Request,
    agent_id: str,
    payload: AgentTestRunRequest,
) -> JSONResponse:
    try:
        data = await request.app.state.web.test_agent_run(agent_id, payload.content)
    except KeyError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    except ValueError as exc:
        raise APIError(400, "AGENT_TEST_RUN_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))
    return _json_response(200, _ok(data))
