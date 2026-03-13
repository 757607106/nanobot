"""Configuration-oriented runtime services for the nanobot Web UI."""

from __future__ import annotations

import asyncio
import platform
import time
from typing import TYPE_CHECKING, Any

from nanobot.agent.loop import AgentLoop
from nanobot.bus.queue import MessageBus
from nanobot.config.schema import Config
from nanobot.providers.base import GenerationSettings
from nanobot.providers.custom_provider import CustomProvider
from nanobot.providers.litellm_provider import LiteLLMProvider
from nanobot.providers.openai_codex_provider import OpenAICodexProvider
from nanobot.providers.registry import PROVIDERS
from nanobot.services.agent_templates import AgentTemplateManager
from nanobot.session.manager import SessionManager
from nanobot.storage.calendar_repository import get_calendar_repository
from nanobot.utils.helpers import sync_workspace_templates

if TYPE_CHECKING:
    from nanobot.web.runtime import WebAppState


class WebConfigRuntimeService:
    """Encapsulates config inspection and runtime status helpers."""

    def __init__(self, state: WebAppState):
        self.state = state

    def make_provider(self, config: Config):
        model = config.agents.defaults.model
        provider_name = config.get_provider_name(model)
        provider_cfg = config.get_provider(model)

        if provider_name == "openai_codex" or model.startswith("openai-codex/"):
            provider = OpenAICodexProvider(default_model=model)
        elif provider_name == "custom":
            provider = CustomProvider(
                api_key=(provider_cfg.api_key if provider_cfg and provider_cfg.api_key else "no-key"),
                api_base=config.get_api_base(model) or "http://localhost:8000/v1",
                default_model=model,
            )
        elif provider_name == "azure_openai":
            if provider_cfg and provider_cfg.api_key and provider_cfg.api_base:
                from nanobot.providers.azure_openai_provider import AzureOpenAIProvider

                provider = AzureOpenAIProvider(
                    api_key=provider_cfg.api_key,
                    api_base=provider_cfg.api_base,
                    default_model=model,
                )
            else:
                provider = LiteLLMProvider(
                    api_key=None,
                    api_base=None,
                    default_model=model,
                    provider_name=provider_name,
                )
        else:
            provider = LiteLLMProvider(
                api_key=provider_cfg.api_key if provider_cfg and provider_cfg.api_key else None,
                api_base=config.get_api_base(model),
                default_model=model,
                extra_headers=provider_cfg.extra_headers if provider_cfg else None,
                provider_name=provider_name,
            )

        defaults = config.agents.defaults
        provider.generation = GenerationSettings(
            temperature=defaults.temperature,
            max_tokens=defaults.max_tokens,
            reasoning_effort=defaults.reasoning_effort,
        )
        return provider

    def rebuild_runtime(self, config: Config) -> None:
        sync_workspace_templates(config.workspace_path)
        self.state.calendar_repo = get_calendar_repository(config.workspace_path)
        bus = MessageBus()
        sessions = SessionManager(config.workspace_path)
        agent = AgentLoop(
            bus=bus,
            provider=self.make_provider(config),
            workspace=config.workspace_path,
            model=config.agents.defaults.model,
            max_iterations=config.agents.defaults.max_tool_iterations,
            context_window_tokens=config.agents.defaults.context_window_tokens,
            brave_api_key=config.tools.web.search.api_key or None,
            web_proxy=config.tools.web.proxy or None,
            exec_config=config.tools.exec,
            cron_service=self.state.cron,
            restrict_to_workspace=config.tools.restrict_to_workspace,
            session_manager=sessions,
            mcp_servers=config.tools.mcp_servers,
            channels_config=config.channels,
        )
        self.state.config = config
        self.state.bus = bus
        self.state.sessions = sessions
        self.state.agent = agent
        self.state.agent_templates = AgentTemplateManager(
            config.workspace_path,
            tool_catalog_provider=self.state.workspace_runtime.get_template_tool_catalog,
        )

    def get_config(self) -> dict[str, Any]:
        return self.state.config.model_dump(mode="json", by_alias=True)

    def get_config_meta(self) -> dict[str, Any]:
        providers: list[dict[str, Any]] = []
        for spec in PROVIDERS:
            if spec.is_oauth:
                category = "oauth"
            elif spec.is_gateway:
                category = "gateway"
            elif spec.is_local:
                category = "local"
            elif spec.is_direct:
                category = "direct"
            else:
                category = "standard"

            providers.append(
                {
                    "name": spec.name,
                    "label": spec.label,
                    "category": category,
                    "keywords": list(spec.keywords),
                    "defaultApiBase": spec.default_api_base or None,
                    "supportsPromptCaching": spec.supports_prompt_caching,
                    "isGateway": spec.is_gateway,
                    "isLocal": spec.is_local,
                    "isOauth": spec.is_oauth,
                    "isDirect": spec.is_direct,
                }
            )

        return {
            "providers": providers,
            "resolvedProvider": self.state.config.get_provider_name(self.state.config.agents.defaults.model) or "auto",
        }

    def update_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        config = Config.model_validate(payload)
        self.state.instance.save_config(config)
        old_agent = self.state.agent
        if old_agent is not None:
            asyncio.run(old_agent.close_mcp())
        self.rebuild_runtime(config)
        return self.get_config()

    def get_system_status(self) -> dict[str, Any]:
        sessions = self.state.sessions.list_sessions() if self.state.sessions else []
        web_sessions = [s for s in sessions if s.get("key", "").startswith("web:")]
        cron_status = self.state.schedule_runtime.get_cron_status()
        channels_data = self.state.config.channels.model_dump(mode="json", by_alias=True)
        enabled_channels = [
            name
            for name, value in channels_data.items()
            if isinstance(value, dict) and value.get("enabled")
        ]
        return {
            "web": {
                "version": self.state.version,
                "uptime": round(time.time() - self.state.start_time, 2),
                "workspace": str(self.state.config.workspace_path),
                "configPath": str(self.state.instance.config_path),
                "model": self.state.config.agents.defaults.model,
                "provider": self.state.config.get_provider_name(self.state.config.agents.defaults.model) or "auto",
            },
            "stats": {
                "totalSessions": len(sessions),
                "webSessions": len(web_sessions),
                "messages": sum(item.get("message_count", 0) for item in web_sessions),
                "enabledChannels": enabled_channels,
                "enabledChannelCount": len(enabled_channels),
                "scheduledJobs": cron_status["jobs"],
            },
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
            },
            "cron": cron_status,
        }
