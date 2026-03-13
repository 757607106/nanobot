"""MCP management routes for the nanobot Web UI."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel, Field

from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


class MCPRepositoryRequest(BaseModel):
    source: str


class MCPServerToggleRequest(BaseModel):
    enabled: bool


class MCPServerUpdateRequest(BaseModel):
    displayName: str | None = None
    enabled: bool
    type: Literal["stdio", "sse", "streamableHttp"]
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    toolTimeout: int = 30


class MCPRepairRequest(BaseModel):
    dangerousMode: bool = False


class MCPTestMessageRequest(BaseModel):
    content: str | None = None


@router.get("/api/v1/mcp/servers")
def list_mcp_servers(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.mcp_registry.list_servers(request.app.state.web.config)))


@router.get("/api/v1/mcp/servers/{server_name}")
def get_mcp_server(request: Request, server_name: str) -> JSONResponse:
    entry = request.app.state.mcp_servers.get_server(request.app.state.web.config, server_name)
    if entry is None:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", f"MCP '{server_name}' 不存在。")
    return _json_response(200, _ok(entry))


@router.post("/api/v1/mcp/servers/{server_name}/probe")
def probe_mcp_server(request: Request, server_name: str) -> JSONResponse:
    try:
        data = request.app.state.mcp_servers.probe_server(request.app.state.web.config, server_name)
    except ValueError as exc:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("MCP probe failed")
        raise APIError(500, "MCP_PROBE_FAILED", "MCP probe failed.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/mcp/servers/{server_name}/repair-plan")
def get_mcp_repair_plan(request: Request, server_name: str) -> JSONResponse:
    try:
        data = request.app.state.mcp_servers.get_repair_plan(request.app.state.web.config, server_name)
    except ValueError as exc:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/mcp/servers/{server_name}/repair-run")
def run_mcp_repair(
    request: Request,
    server_name: str,
    payload: MCPRepairRequest,
) -> JSONResponse:
    try:
        data = request.app.state.mcp_servers.run_repair(
            request.app.state.web.config,
            server_name,
            dangerous_mode=payload.dangerousMode,
        )
    except ValueError as exc:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", str(exc)) from exc
    except PermissionError as exc:
        raise APIError(409, "MCP_REPAIR_DANGEROUS_DISABLED", str(exc)) from exc
    except RuntimeError as exc:
        code = "MCP_REPAIR_ALREADY_RUNNING" if "正在运行" in str(exc) else "MCP_REPAIR_UNCONFIGURED"
        raise APIError(409, code, str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/mcp/servers/{server_name}/test-chat")
def get_mcp_test_chat(request: Request, server_name: str) -> JSONResponse:
    try:
        data = request.app.state.web.get_mcp_test_chat(server_name)
    except KeyError as exc:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", f"MCP '{server_name}' 不存在。") from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/mcp/servers/{server_name}/test-chat")
def clear_mcp_test_chat(request: Request, server_name: str) -> JSONResponse:
    try:
        deleted = request.app.state.web.clear_mcp_test_chat(server_name)
    except KeyError as exc:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", f"MCP '{server_name}' 不存在。") from exc
    return _json_response(200, _ok({"deleted": deleted}))


@router.post("/api/v1/mcp/servers/{server_name}/test-chat/messages")
async def create_mcp_test_chat_message(
    request: Request,
    server_name: str,
    payload: MCPTestMessageRequest,
) -> JSONResponse:
    content = (payload.content or "").strip()
    if not content:
        raise APIError(400, "VALIDATION_ERROR", "content is required.")

    async def on_progress(_progress: str, *, tool_hint: bool = False) -> None:
        return None

    try:
        data = await request.app.state.web.chat_with_mcp_test(server_name, content, on_progress)
    except KeyError as exc:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", f"MCP '{server_name}' 不存在。") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/mcp/servers/{server_name}/enabled")
def toggle_mcp_server(request: Request, server_name: str, payload: MCPServerToggleRequest) -> JSONResponse:
    try:
        data = request.app.state.mcp_servers.set_enabled(
            server_name,
            enabled=payload.enabled,
            current_config=request.app.state.web.get_config(),
            update_config=request.app.state.web.update_config,
        )
    except ValueError as exc:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/mcp/servers/{server_name}")
def update_mcp_server(
    request: Request,
    server_name: str,
    payload: MCPServerUpdateRequest,
) -> JSONResponse:
    try:
        data = request.app.state.mcp_servers.update_server(
            server_name,
            payload=payload.model_dump(),
            current_config=request.app.state.web.get_config(),
            update_config=request.app.state.web.update_config,
        )
    except ValueError as exc:
        message = str(exc)
        if "不存在" in message:
            raise APIError(404, "MCP_SERVER_NOT_FOUND", message) from exc
        raise APIError(400, "MCP_SERVER_UPDATE_FAILED", message) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/mcp/servers/{server_name}")
def delete_mcp_server(request: Request, server_name: str) -> JSONResponse:
    try:
        data = request.app.state.mcp_servers.remove_server(
            server_name,
            current_config=request.app.state.web.get_config(),
            update_config=request.app.state.web.update_config,
        )
    except ValueError as exc:
        raise APIError(404, "MCP_SERVER_NOT_FOUND", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/mcp/repositories/inspect")
def inspect_mcp_repository(request: Request, payload: MCPRepositoryRequest) -> JSONResponse:
    try:
        data = request.app.state.mcp_repository.analyze_repository(payload.source)
    except ValueError as exc:
        raise APIError(400, "MCP_REPOSITORY_INSPECT_FAILED", str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("MCP repository inspect failed")
        raise APIError(500, "MCP_REPOSITORY_INSPECT_FAILED", "Repository inspect failed.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/mcp/repositories/install")
def install_mcp_repository(request: Request, payload: MCPRepositoryRequest) -> JSONResponse:
    try:
        data = request.app.state.mcp_repository.install_repository(
            payload.source,
            current_config=request.app.state.web.get_config(),
            update_config=request.app.state.web.update_config,
        )
    except ValueError as exc:
        message = str(exc)
        if "已存在" in message or "已作为 MCP" in message:
            raise APIError(409, "MCP_REPOSITORY_DUPLICATE", message) from exc
        raise APIError(400, "MCP_REPOSITORY_INSTALL_FAILED", message) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("MCP repository install failed")
        raise APIError(500, "MCP_REPOSITORY_INSTALL_FAILED", "Repository install failed.") from exc
    return _json_response(201, _ok(data))
