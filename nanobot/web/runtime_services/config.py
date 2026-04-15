"""Configuration-oriented runtime services for the nanobot Web UI."""

from __future__ import annotations

import asyncio
import platform
import time
from typing import TYPE_CHECKING, Any
import httpx

from nanobot.agent.loop import AgentLoop
from nanobot.config.schema import Config, ModelBindingConfig, normalize_api_base_url
from nanobot.platform.knowledge.rag_engine import create_rag_engine_from_config
from nanobot.platform.knowledge.store import create_knowledge_store
from nanobot.bus.queue import MessageBus
from nanobot.providers.factory import make_provider_from_config
from nanobot.providers.registry import PROVIDERS, find_by_name
from nanobot.session.manager import SessionManager
from nanobot.storage.calendar_repository import get_calendar_repository
from nanobot.utils.reasoning import supports_reasoning_mode
from nanobot.utils.helpers import sync_workspace_templates
from nanobot.web.services.agent_templates import AgentTemplateManager

if TYPE_CHECKING:
    from nanobot.web.runtime import WebAppState


class WebConfigRuntimeService:
    """Encapsulates config inspection and runtime status helpers."""

    def __init__(self, state: WebAppState):
        self.state = state

    def make_provider(self, config: Config):
        return make_provider_from_config(config)

    def provider_supports_reasoning(self, provider_name: str | None) -> bool:
        name = str(provider_name or "").strip()
        if not name:
            return False
        spec = find_by_name(name)
        return supports_reasoning_mode(
            model=None,
            provider_name=name,
            provider_backend=spec.backend if spec is not None else None,
            capability_type="text_chat",
        )

    def resolve_reasoning_support(
        self,
        *,
        config: Config | None = None,
        model: str | None = None,
        binding_name: str | None = None,
        provider_name: str | None = None,
    ) -> bool:
        active_config = config or self.state.config
        selected_model = str(model or active_config.agents.defaults.model or "").strip() or None
        selected_binding_name = str(
            binding_name
            or active_config.get_binding_name(selected_model)
            or ""
        ).strip() or None
        binding = (
            active_config.model_bindings.get(selected_binding_name)
            if selected_binding_name
            else None
        )
        selected_provider_name = str(
            provider_name
            or (binding.provider if binding is not None else active_config.get_provider_name(selected_model))
            or ""
        ).strip() or None
        selected_model_name = (
            str(binding.model or "").strip()
            if binding is not None and str(binding.model or "").strip()
            else selected_model
        )
        spec = find_by_name(selected_provider_name) if selected_provider_name else None
        capability_type = (
            str(getattr(binding, "capability_type", "") or "").strip()
            if binding is not None
            else None
        )
        return supports_reasoning_mode(
            model=selected_model_name,
            provider_name=selected_provider_name,
            provider_backend=spec.backend if spec is not None else None,
            capability_type=capability_type,
        )

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
            web_config=config.tools.web,
            exec_config=config.tools.exec,
            cron_service=self.state.cron,
            restrict_to_workspace=config.tools.restrict_to_workspace,
            session_manager=sessions,
            mcp_servers=config.tools.mcp_servers,
            channels_config=config.channels,
            run_registry=self.state.runs,
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
                    "supportsReasoning": self.provider_supports_reasoning(spec.name),
                    "isGateway": spec.is_gateway,
                    "isLocal": spec.is_local,
                    "isOauth": spec.is_oauth,
                    "isDirect": spec.is_direct,
                    "envKey": spec.env_key or None,
                }
            )

        return {
            "providers": providers,
            "resolvedProvider": self.state.config.get_provider_name(self.state.config.agents.defaults.model) or "auto",
            "resolvedBinding": self.state.config.get_binding_name(self.state.config.agents.defaults.model),
        }

    def update_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        config = Config.model_validate(payload)
        knowledge_store = None
        rag_engine = None
        if self.state.app_knowledge is not None:
            knowledge_store = create_knowledge_store(config, self.state.instance)
            try:
                rag_engine = create_rag_engine_from_config(config, self.state.instance.data_dir)
            except Exception:
                close_store = getattr(knowledge_store, "close", None)
                if callable(close_store):
                    close_store()
                raise

        self.state.instance.save_config(config)
        old_agent = self.state.agent
        if old_agent is not None:
            asyncio.run(old_agent.close_mcp())
        self.rebuild_runtime(config)
        if self.state.app_knowledge is not None:
            if knowledge_store is None:
                raise RuntimeError("Knowledge store initialization failed.")
            self.state.app_knowledge.set_store(knowledge_store)
            self.state.app_knowledge.set_rag_engine(rag_engine)
            self.state.app_knowledge.set_config(config)
        self.state.channel_runtime.restart()
        return self.get_config()

    @staticmethod
    def _provider_default_catalog_base(provider_name: str) -> str | None:
        defaults = {
            "deepseek": "https://api.deepseek.com",
            "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "zhipu": "https://open.bigmodel.cn/api/paas/v4",
        }
        if provider_name in defaults:
            return defaults[provider_name]
        spec = find_by_name(provider_name)
        return spec.default_api_base if spec and spec.default_api_base else None

    @classmethod
    def _resolve_catalog_base(cls, provider_name: str, api_base: str | None) -> str | None:
        value = normalize_api_base_url(provider_name, api_base)
        if value:
            return value.rstrip("/")
        fallback = cls._provider_default_catalog_base(provider_name)
        return fallback.rstrip("/") if fallback else None

    @staticmethod
    def _build_model_headers(provider_name: str, api_key: str | None) -> dict[str, str]:
        key = str(api_key or "").strip()
        if not key:
            return {}
        if provider_name == "azure_openai":
            return {"api-key": key}
        return {"Authorization": f"Bearer {key}"}

    @classmethod
    async def _request_remote_models(
        cls,
        *,
        provider_name: str,
        api_key: str | None,
        api_base: str | None,
    ) -> list[str]:
        if provider_name in {"openai_codex", "github_copilot", "anthropic", "gemini", "azure_openai"}:
            raise ValueError(f"{provider_name} 暂不支持自动获取模型列表，请手动填写模型。")

        base = cls._resolve_catalog_base(provider_name, api_base)
        if not base:
            raise ValueError("请先填写 API 地址，或选择带默认地址的供应商。")

        headers = cls._build_model_headers(provider_name, api_key)

        if provider_name == "ollama":
            urls = [f"{base}/api/tags"]
        else:
            urls = [f"{base}/models"]
            if base.endswith("/v1"):
                urls.append(f"{base[:-3]}/models")

        last_error = "无法获取模型列表。"
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            for url in urls:
                try:
                    response = await client.get(url, headers=headers)
                except Exception as exc:  # noqa: BLE001
                    last_error = str(exc)
                    continue

                if response.status_code >= 400:
                    last_error = f"{response.status_code}: {response.text}"
                    continue

                payload = response.json()
                if provider_name == "ollama":
                    items = payload.get("models") if isinstance(payload, dict) else []
                    model_ids = [
                        str(item.get("name") or "").strip()
                        for item in items or []
                        if isinstance(item, dict) and str(item.get("name") or "").strip()
                    ]
                else:
                    if isinstance(payload, dict):
                        items = payload.get("data") or payload.get("models") or []
                    else:
                        items = payload
                    model_ids = []
                    for item in items or []:
                        if isinstance(item, dict):
                            candidate = str(item.get("id") or item.get("name") or "").strip()
                        else:
                            candidate = str(item or "").strip()
                        if candidate:
                            model_ids.append(candidate)

                deduped = sorted(set(model_ids))
                if deduped:
                    return deduped

        raise ValueError(f"获取模型列表失败: {last_error}")

    async def fetch_model_binding_models(self, payload: dict[str, Any]) -> dict[str, Any]:
        provider_name = str(payload.get("provider") or "").strip()
        binding_name = str(payload.get("bindingName") or "").strip() or "__probe__"
        label = str(payload.get("label") or "").strip() or binding_name
        api_key = str(payload.get("apiKey") or "").strip()
        api_base_raw = payload.get("apiBase")
        api_base = normalize_api_base_url(provider_name, api_base_raw) or ""

        if not provider_name:
            raise ValueError("provider is required.")
        if find_by_name(provider_name) is None:
            raise ValueError("Unknown provider.")

        models = await self._request_remote_models(
            provider_name=provider_name,
            api_key=api_key,
            api_base=api_base or None,
        )

        return {
            "provider": provider_name,
            "bindingName": binding_name,
            "label": label,
            "models": models,
            "count": len(models),
            "message": f"已获取 {len(models)} 个模型",
            "source": "remote",
        }

    async def test_model_binding(self, payload: dict[str, Any]) -> dict[str, Any]:
        provider_name = str(payload.get("provider") or "").strip()
        model = str(payload.get("model") or "").strip()
        binding_name = str(payload.get("bindingName") or "").strip() or "__probe__"
        label = str(payload.get("label") or "").strip() or binding_name
        api_key = str(payload.get("apiKey") or "").strip()
        api_base_raw = payload.get("apiBase")
        api_base = normalize_api_base_url(provider_name, api_base_raw) or ""

        if not provider_name:
            raise ValueError("provider is required.")
        if not model:
            raise ValueError("model is required.")

        spec = find_by_name(provider_name)
        if spec is None:
            raise ValueError("Unknown provider.")
        if spec.is_oauth:
            raise ValueError("OAuth provider detection is not supported on this page.")
        if provider_name == "custom" and not api_base:
            raise ValueError("Custom provider requires an API Base.")
        if provider_name == "azure_openai" and (not api_key or not api_base):
            raise ValueError("Azure OpenAI requires both API Key and API Base.")
        if not spec.is_local and not spec.is_oauth and provider_name not in {"custom", "azure_openai"}:
            if spec.default_api_base:
                if not api_key:
                    raise ValueError(
                        "此供应商需要 API Key。"
                        + (f"（可通过环境变量 {spec.env_key} 配置）" if spec.env_key else "")
                    )
            elif not api_key and not api_base:
                raise ValueError("此供应商需要 API Key 或 API Base。")

        # Detect embedding model by name
        _EMBEDDING_KEYWORDS = ("embedding", "embeddings", "embed", "bge", "e5", "gte", "voyage")
        is_embedding = any(kw in model.lower() for kw in _EMBEDDING_KEYWORDS)

        if is_embedding:
            # Test embedding model via direct HTTP call to /embeddings endpoint
            base_url = self._resolve_catalog_base(provider_name, api_base or None)
            if not base_url and spec.default_api_base:
                base_url = spec.default_api_base.rstrip("/")
            if not base_url:
                raise ValueError("无法确定 API 地址，请填写 API Base。")

            headers = self._build_model_headers(provider_name, api_key)
            headers["Content-Type"] = "application/json"

            started = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                    resp = await client.post(
                        f"{base_url.rstrip('/')}/embeddings",
                        headers=headers,
                        json={"model": model, "input": ["hello"]},
                    )
                elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            except Exception as exc:
                elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
                return {
                    "ok": False,
                    "provider": provider_name,
                    "model": model,
                    "bindingName": binding_name,
                    "label": label,
                    "latencyMs": elapsed_ms,
                    "finishReason": "error",
                    "message": f"嵌入测试失败: {exc}",
                    "responsePreview": None,
                    "usage": {},
                }

            if resp.status_code >= 400:
                error_text = resp.text[:240]
                return {
                    "ok": False,
                    "provider": provider_name,
                    "model": model,
                    "bindingName": binding_name,
                    "label": label,
                    "latencyMs": elapsed_ms,
                    "finishReason": "error",
                    "message": f"嵌入测试失败: {error_text}",
                    "responsePreview": None,
                    "usage": {},
                }

            result_data = resp.json()
            data_items = result_data.get("data", [])
            usage = result_data.get("usage", {})
            dim = len(data_items[0]["embedding"]) if data_items and isinstance(data_items[0], dict) and "embedding" in data_items[0] else 0

            return {
                "ok": True,
                "provider": provider_name,
                "model": model,
                "bindingName": binding_name,
                "label": label,
                "latencyMs": elapsed_ms,
                "finishReason": "complete",
                "message": "嵌入检测通过",
                "responsePreview": f"向量维度: {dim}" if dim else None,
                "usage": usage,
            }

        probe_config = self.state.config.model_copy(deep=True)
        probe_config.model_bindings[binding_name] = ModelBindingConfig(
            provider=provider_name,
            label=label,
            model=model,
            api_key=api_key,
            api_base=api_base or None,
            extra_headers=dict(payload.get("extraHeaders") or {}),
        )
        probe_config.agents.defaults.binding = binding_name
        probe_config.agents.defaults.provider = provider_name
        probe_config.agents.defaults.model = model

        provider = self.make_provider(probe_config)
        started = time.perf_counter()
        response = await provider.chat_with_retry(
            messages=[
                {
                    "role": "user",
                    "content": "Reply with exactly OK if this model binding is available.",
                }
            ],
            model=model,
            max_tokens=16,
            temperature=0.1,
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        ok = response.finish_reason != "error"
        preview = (response.content or "").strip()

        return {
            "ok": ok,
            "provider": provider_name,
            "model": model,
            "bindingName": binding_name,
            "label": label,
            "latencyMs": elapsed_ms,
            "finishReason": response.finish_reason,
            "message": "检测通过" if ok else "检测失败",
            "responsePreview": preview[:240] if preview else None,
            "usage": response.usage,
        }

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
