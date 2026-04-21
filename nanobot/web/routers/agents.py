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
from nanobot.platform.memory import MemoryCandidateValidationError
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_id, get_tenant_memory_service

router = APIRouter()


class AgentTestRunRequest(BaseModel):
    content: str


class AgentMemoryUpdateRequest(BaseModel):
    files: dict[str, str]


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


@router.get("/api/v1/agents/metrics")
def get_agents_metrics(
    request: Request,
    since: str | None = Query(default=None, description="ISO 8601 lower bound for created_at"),
    until: str | None = Query(default=None, description="ISO 8601 upper bound for created_at"),
) -> JSONResponse:
    data = request.app.state.runs.get_all_agents_metrics(since=since, until=until)
    return _json_response(200, _ok(data))


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
            default_binding=request.app.state.web.config.agents.defaults.binding,
            default_provider=request.app.state.web.config.agents.defaults.provider,
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
        tenant_id = get_tenant_id(request)
        data = request.app.state.agents.get_agent(agent_id, tenant_id=tenant_id)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/agents/{agent_id}/memory")
def get_agent_memory(request: Request, agent_id: str) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        request.app.state.agents.get_agent(agent_id, tenant_id=tenant_id)
        data = get_tenant_memory_service(request).get_agent_memory(agent_id)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    except MemoryCandidateValidationError as exc:
        raise APIError(400, "AGENT_MEMORY_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/agents/{agent_id}")
def update_agent(
    request: Request,
    agent_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.agents.update_agent(agent_id, payload, tenant_id=tenant_id)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    except AgentDefinitionConflictError as exc:
        raise APIError(409, "AGENT_CONFLICT", str(exc)) from exc
    except AgentDefinitionValidationError as exc:
        raise APIError(400, "AGENT_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/agents/{agent_id}/memory")
def update_agent_memory(
    request: Request,
    agent_id: str,
    payload: AgentMemoryUpdateRequest,
) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        request.app.state.agents.get_agent(agent_id, tenant_id=tenant_id)
        data = get_tenant_memory_service(request).update_agent_memory(agent_id, payload.files)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    except MemoryCandidateValidationError as exc:
        raise APIError(400, "AGENT_MEMORY_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/agents/{agent_id}")
def delete_agent(request: Request, agent_id: str) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        deleted = request.app.state.agents.delete_agent(agent_id, tenant_id=tenant_id)
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
        tenant_id = get_tenant_id(request)
        data = request.app.state.agents.copy_agent(agent_id, payload, tenant_id=tenant_id)
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
        tenant_id = get_tenant_id(request)
        data = request.app.state.agents.set_enabled(agent_id, True, tenant_id=tenant_id)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/agents/{agent_id}/disable")
def disable_agent(request: Request, agent_id: str) -> JSONResponse:
    try:
        tenant_id = get_tenant_id(request)
        data = request.app.state.agents.set_enabled(agent_id, False, tenant_id=tenant_id)
    except AgentDefinitionNotFoundError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/agents/optimize-prompt")
async def optimize_agent_prompt(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    data = await request.app.state.web.agent_runtime.optimize_prompt(payload, tenant_id=tenant_id)
    return _json_response(200, _ok(data))


@router.post("/api/v1/agents/{agent_id}/test-run")
async def test_run_agent(
    request: Request,
    agent_id: str,
    payload: AgentTestRunRequest,
) -> JSONResponse:
    try:
        data = await request.app.state.web.test_agent_run(
            agent_id,
            payload.content,
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    except ValueError as exc:
        raise APIError(400, "AGENT_TEST_RUN_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))
