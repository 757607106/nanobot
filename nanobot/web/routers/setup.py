"""Setup and readiness routes for the nanobot Web UI."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nanobot.providers.registry import PROVIDERS
from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


class SetupProviderRequest(BaseModel):
    provider: str
    model: str
    apiKey: str | None = None
    apiBase: str | None = None


class SetupChannelRequest(BaseModel):
    mode: Literal["skip", "telegram"]
    telegramToken: str | None = None
    telegramAllowFrom: list[str] | None = None
    telegramProxy: str | None = None
    telegramReplyToMessage: bool | None = None
    telegramGroupPolicy: Literal["mention", "open"] | None = None


class SetupAgentDefaultsRequest(BaseModel):
    workspace: str
    maxTokens: int
    contextWindowTokens: int
    temperature: float
    maxToolIterations: int
    reasoningEffort: Literal["low", "medium", "high"] | None = None


@router.get("/api/v1/setup/status")
def get_setup_status(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.setup.get_status(request.app.state.web.config)))


@router.put("/api/v1/setup/provider")
def update_setup_provider(request: Request, payload: SetupProviderRequest) -> JSONResponse:
    provider_name = str(payload.provider or "").strip()
    model = str(payload.model or "").strip()
    if not provider_name:
        raise APIError(400, "SETUP_PROVIDER_INVALID", "provider is required.")
    if not model:
        raise APIError(400, "SETUP_PROVIDER_INVALID", "model is required.")

    spec = next((item for item in PROVIDERS if item.name == provider_name), None)
    if spec is None:
        raise APIError(400, "SETUP_PROVIDER_INVALID", "Unknown provider.")

    config_payload = request.app.state.web.get_config()
    provider_payload = config_payload.setdefault("providers", {}).setdefault(
        provider_name,
        {"apiKey": "", "apiBase": None, "extraHeaders": {}},
    )
    api_key = str(
        payload.apiKey if payload.apiKey is not None else provider_payload.get("apiKey") or "",
    ).strip()
    api_base = str(
        payload.apiBase if payload.apiBase is not None else provider_payload.get("apiBase") or "",
    ).strip()

    if provider_name == "custom" and not api_base:
        raise APIError(400, "SETUP_PROVIDER_INVALID", "Custom provider requires an API Base.")
    if provider_name == "azure_openai" and (not api_key or not api_base):
        raise APIError(
            400,
            "SETUP_PROVIDER_INVALID",
            "Azure OpenAI requires both API Key and API Base.",
        )
    if not spec.is_oauth and not spec.is_local and provider_name not in {"custom", "azure_openai"}:
        if not api_key and not api_base:
            raise APIError(
                400,
                "SETUP_PROVIDER_INVALID",
                "This provider requires an API Key or API Base.",
            )

    config_payload["agents"]["defaults"]["provider"] = provider_name
    config_payload["agents"]["defaults"]["model"] = model
    provider_payload["apiKey"] = api_key
    provider_payload["apiBase"] = api_base or None

    updated_config = request.app.state.web.update_config(config_payload)
    setup_status = request.app.state.setup.mark_provider_configured(request.app.state.web.config)
    return _json_response(200, _ok({"config": updated_config, "setup": setup_status}))


@router.put("/api/v1/setup/channel")
def update_setup_channel(request: Request, payload: SetupChannelRequest) -> JSONResponse:
    if payload.mode == "skip":
        setup_status = request.app.state.setup.mark_channel_skipped(request.app.state.web.config)
        return _json_response(200, _ok({"config": request.app.state.web.get_config(), "setup": setup_status}))

    token = str(payload.telegramToken or "").strip()
    if not token:
        raise APIError(400, "SETUP_CHANNEL_INVALID", "Telegram token is required.")

    config_payload = request.app.state.web.get_config()
    telegram_payload = config_payload.setdefault("channels", {}).setdefault("telegram", {})
    telegram_payload["enabled"] = True
    telegram_payload["token"] = token
    telegram_payload["allowFrom"] = [
        item.strip()
        for item in (payload.telegramAllowFrom or [])
        if item and item.strip()
    ]
    telegram_payload["proxy"] = str(payload.telegramProxy or "").strip() or None
    telegram_payload["replyToMessage"] = bool(payload.telegramReplyToMessage)
    telegram_payload["groupPolicy"] = payload.telegramGroupPolicy or "mention"

    updated_config = request.app.state.web.update_config(config_payload)
    setup_status = request.app.state.setup.mark_channel_configured(request.app.state.web.config)
    return _json_response(200, _ok({"config": updated_config, "setup": setup_status}))


@router.put("/api/v1/setup/agent-defaults")
def update_setup_agent_defaults(
    request: Request,
    payload: SetupAgentDefaultsRequest,
) -> JSONResponse:
    workspace = str(payload.workspace or "").strip()
    if not workspace:
        raise APIError(400, "SETUP_AGENT_INVALID", "workspace is required.")
    if payload.maxTokens <= 0 or payload.contextWindowTokens <= 0 or payload.maxToolIterations <= 0:
        raise APIError(400, "SETUP_AGENT_INVALID", "Agent defaults must be positive.")
    if payload.temperature < 0 or payload.temperature > 2:
        raise APIError(400, "SETUP_AGENT_INVALID", "temperature must be between 0 and 2.")

    config_payload = request.app.state.web.get_config()
    defaults = config_payload["agents"]["defaults"]
    defaults["workspace"] = workspace
    defaults["maxTokens"] = payload.maxTokens
    defaults["contextWindowTokens"] = payload.contextWindowTokens
    defaults["temperature"] = payload.temperature
    defaults["maxToolIterations"] = payload.maxToolIterations
    defaults["reasoningEffort"] = payload.reasoningEffort

    updated_config = request.app.state.web.update_config(config_payload)
    setup_status = request.app.state.setup.mark_agent_configured(request.app.state.web.config)
    return _json_response(200, _ok({"config": updated_config, "setup": setup_status}))


@router.get("/api/v1/health")
def get_health() -> JSONResponse:
    return _json_response(200, _ok({"status": "ok"}))
