"""Operations and configuration routes for the nanobot Web UI."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse
from loguru import logger

from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


@router.get("/api/v1/config")
def get_config(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_config()))


@router.get("/api/v1/config/meta")
def get_config_meta(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_config_meta()))


@router.put("/api/v1/config")
def update_config(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.web.update_config(payload)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Config update failed")
        raise APIError(400, "CONFIG_UPDATE_FAILED", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/system/status")
def get_system_status(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_system_status()))


@router.post("/api/v1/validation/run")
def run_validation(request: Request) -> JSONResponse:
    data = request.app.state.operations.run_validation(config=request.app.state.web.config)
    return _json_response(200, _ok(data))


@router.get("/api/v1/ops/logs")
def get_ops_logs(request: Request, lines: int = Query(200, ge=20, le=400)) -> JSONResponse:
    data = request.app.state.operations.get_logs(lines=lines)
    return _json_response(200, _ok(data))


@router.get("/api/v1/ops/actions")
def get_ops_actions(request: Request) -> JSONResponse:
    data = request.app.state.operations.get_actions(config=request.app.state.web.config)
    return _json_response(200, _ok(data))


@router.post("/api/v1/ops/actions/{action_name}")
def trigger_ops_action(request: Request, action_name: str) -> JSONResponse:
    try:
        data = request.app.state.operations.trigger_action(action_name, config=request.app.state.web.config)
    except ValueError as exc:
        message = str(exc)
        if "正在执行" in message:
            raise APIError(409, "OPS_ACTION_RUNNING", message) from exc
        raise APIError(400, "OPS_ACTION_INVALID", message) from exc
    return _json_response(200, _ok(data))
