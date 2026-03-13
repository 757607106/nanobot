"""Channel management routes for the nanobot Web UI."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse
from loguru import logger

from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


@router.get("/api/v1/channels")
def get_channels(request: Request) -> JSONResponse:
    data = request.app.state.channels.list_channels(config=request.app.state.web.config)
    return _json_response(200, _ok(data))


@router.put("/api/v1/channels/delivery")
def update_channel_delivery(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.channels.update_delivery(
            payload=payload,
            current_config=request.app.state.web.get_config(),
            update_config=request.app.state.web.update_config,
        )
    except ValueError as exc:
        raise APIError(400, "CHANNEL_DELIVERY_UPDATE_FAILED", str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Channel delivery update failed")
        raise APIError(400, "CHANNEL_DELIVERY_UPDATE_FAILED", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/channels/{channel_name}")
def get_channel(request: Request, channel_name: str) -> JSONResponse:
    try:
        data = request.app.state.channels.get_channel(
            config=request.app.state.web.config,
            channel_name=channel_name,
        )
    except KeyError as exc:
        raise APIError(404, "CHANNEL_NOT_FOUND", f"Unknown channel: {channel_name}") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/channels/{channel_name}")
def update_channel(
    request: Request,
    channel_name: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.channels.update_channel(
            channel_name=channel_name,
            payload=payload,
            current_config=request.app.state.web.get_config(),
            update_config=request.app.state.web.update_config,
        )
    except KeyError as exc:
        raise APIError(404, "CHANNEL_NOT_FOUND", f"Unknown channel: {channel_name}") from exc
    except ValueError as exc:
        raise APIError(400, "CHANNEL_UPDATE_FAILED", str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Channel update failed")
        raise APIError(400, "CHANNEL_UPDATE_FAILED", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/channels/{channel_name}/test")
async def test_channel(
    request: Request,
    channel_name: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = await request.app.state.channel_tests.probe_channel(
            config=request.app.state.web.config,
            channel_name=channel_name,
            payload=payload,
        )
    except KeyError as exc:
        raise APIError(404, "CHANNEL_NOT_FOUND", f"Unknown channel: {channel_name}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Channel test failed")
        raise APIError(400, "CHANNEL_TEST_FAILED", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/channels/whatsapp/bind/status")
def get_whatsapp_bind_status(request: Request) -> JSONResponse:
    data = request.app.state.whatsapp_binding.status(request.app.state.web.config)
    return _json_response(200, _ok(data))


@router.post("/api/v1/channels/whatsapp/bind/start")
def start_whatsapp_bind(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.whatsapp_binding.start(request.app.state.web.config, payload)
    except Exception as exc:  # noqa: BLE001
        logger.exception("WhatsApp bind start failed")
        raise APIError(400, "WHATSAPP_BIND_START_FAILED", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/channels/whatsapp/bind/stop")
def stop_whatsapp_bind(request: Request) -> JSONResponse:
    try:
        data = request.app.state.whatsapp_binding.stop(request.app.state.web.config)
    except Exception as exc:  # noqa: BLE001
        logger.exception("WhatsApp bind stop failed")
        raise APIError(400, "WHATSAPP_BIND_STOP_FAILED", str(exc)) from exc
    return _json_response(200, _ok(data))
