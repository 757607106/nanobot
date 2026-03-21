"""Configuration schema using Pydantic."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from pydantic_settings import BaseSettings


_COMMON_API_ENDPOINT_SUFFIXES = (
    "/chat/completions",
    "/completions",
    "/responses",
    "/embeddings",
    "/models",
    "/audio/transcriptions",
    "/audio/speech",
    "/images/generations",
)

_PROVIDER_API_ENDPOINT_SUFFIXES: dict[str, tuple[str, ...]] = {
    "ollama": ("/api/chat", "/api/generate", "/api/tags"),
}


def normalize_api_base_url(provider_name: str | None, api_base: str | None) -> str | None:
    """Normalize pasted endpoint URLs into provider base URLs.

    Users often paste a full REST endpoint such as `/chat/completions`.
    Most providers in nanobot expect the API base instead, so we strip the
    terminal endpoint path while preserving provider-specific prefixes like
    `/v1`, `/compatible-mode/v1`, or `/api/paas/v4`.
    """

    raw_value = str(api_base or "").strip()
    if not raw_value:
        return None

    provider = str(provider_name or "").strip().lower()
    try:
        parts = urlsplit(raw_value)
    except Exception:
        return raw_value.rstrip("/")

    if not parts.scheme or not parts.netloc:
        return raw_value.rstrip("/")

    path = parts.path or ""
    path_lower = path.lower().rstrip("/")

    if provider == "azure_openai":
        marker = "/openai/deployments/"
        idx = path_lower.find(marker)
        if idx >= 0:
            path = path[:idx]
            path_lower = path.lower().rstrip("/")

    for suffix in (*_PROVIDER_API_ENDPOINT_SUFFIXES.get(provider, ()), *_COMMON_API_ENDPOINT_SUFFIXES):
        if path_lower.endswith(suffix):
            path = path[: len(path) - len(suffix)]
            break

    normalized_path = path.rstrip("/")
    normalized = urlunsplit((parts.scheme, parts.netloc, normalized_path, "", ""))
    return normalized.rstrip("/") or f"{parts.scheme}://{parts.netloc}"


class Base(BaseModel):
    """Base model that accepts both camelCase and snake_case keys."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ChannelSectionConfig(Base):
    """Compatibility-friendly channel section that still allows plugin extras."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")

    enabled: bool = False
    allow_from: list[str] = Field(default_factory=list)

    def model_dump(self, *args, **kwargs):
        data = super().model_dump(*args, **kwargs)
        if kwargs.get("by_alias"):
            for key in (self.model_extra or {}):
                alias = to_camel(key)
                if alias != key and key in data:
                    data[alias] = data.pop(key)
        return data


class ChannelsConfig(Base):
    """Configuration for built-in and plugin chat channels."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")

    send_progress: bool = True  # stream agent's text progress to the channel
    send_tool_hints: bool = False  # stream tool-call hints (e.g. read_file("…"))
    whatsapp: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    telegram: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    discord: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    feishu: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    mochat: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    dingtalk: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    email: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    slack: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    qq: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    matrix: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)
    wecom: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)

    def model_dump(self, *args, **kwargs):
        data = super().model_dump(*args, **kwargs)
        if kwargs.get("by_alias"):
            for name in (
                "whatsapp",
                "telegram",
                "discord",
                "feishu",
                "mochat",
                "dingtalk",
                "email",
                "slack",
                "qq",
                "matrix",
                "wecom",
            ):
                section = getattr(self, name, None)
                if isinstance(section, ChannelSectionConfig):
                    data[name] = section.model_dump(*args, **kwargs)
        return data


class AgentDefaults(Base):
    """Default agent configuration."""

    workspace: str = "~/.nanobot/workspace"
    model: str = "anthropic/claude-opus-4-5"
    binding: str | None = None  # Model binding id selected for the default runtime
    provider: str = (
        "auto"  # Provider name (e.g. "anthropic", "openrouter") or "auto" for auto-detection
    )
    max_tokens: int = 8192
    context_window_tokens: int = 65_536
    temperature: float = 0.1
    max_tool_iterations: int = 40
    # Deprecated compatibility field: accepted from old configs but ignored at runtime.
    memory_window: int | None = Field(default=None, exclude=True)
    reasoning_effort: str | None = None  # low / medium / high — enables LLM thinking mode

    @property
    def should_warn_deprecated_memory_window(self) -> bool:
        """Return True when old memoryWindow is present without contextWindowTokens."""
        return self.memory_window is not None and "context_window_tokens" not in self.model_fields_set


class AgentsConfig(Base):
    """Agent configuration."""

    defaults: AgentDefaults = Field(default_factory=AgentDefaults)


class ProviderConfig(Base):
    """LLM provider configuration."""

    api_key: str = ""
    api_base: str | None = None
    extra_headers: dict[str, str] | None = None  # Custom headers (e.g. APP-Code for AiHubMix)


class ModelBindingConfig(ProviderConfig):
    """Named binding that points to a concrete provider account or endpoint."""

    provider: str = ""
    label: str = ""
    model: str | None = None
    capability_type: Literal["text_chat", "embedding", "multimodal"] = "text_chat"


class ProvidersConfig(Base):
    """Configuration for LLM providers."""

    custom: ProviderConfig = Field(default_factory=ProviderConfig)  # Any OpenAI-compatible endpoint
    azure_openai: ProviderConfig = Field(default_factory=ProviderConfig)  # Azure OpenAI (model = deployment name)
    anthropic: ProviderConfig = Field(default_factory=ProviderConfig)
    openai: ProviderConfig = Field(default_factory=ProviderConfig)
    openrouter: ProviderConfig = Field(default_factory=ProviderConfig)
    deepseek: ProviderConfig = Field(default_factory=ProviderConfig)
    groq: ProviderConfig = Field(default_factory=ProviderConfig)
    zhipu: ProviderConfig = Field(default_factory=ProviderConfig)
    dashscope: ProviderConfig = Field(default_factory=ProviderConfig)
    vllm: ProviderConfig = Field(default_factory=ProviderConfig)
    ollama: ProviderConfig = Field(default_factory=ProviderConfig)  # Ollama local models
    gemini: ProviderConfig = Field(default_factory=ProviderConfig)
    moonshot: ProviderConfig = Field(default_factory=ProviderConfig)
    minimax: ProviderConfig = Field(default_factory=ProviderConfig)
    aihubmix: ProviderConfig = Field(default_factory=ProviderConfig)  # AiHubMix API gateway
    siliconflow: ProviderConfig = Field(default_factory=ProviderConfig)  # SiliconFlow (硅基流动)
    volcengine: ProviderConfig = Field(default_factory=ProviderConfig)  # VolcEngine (火山引擎)
    volcengine_coding_plan: ProviderConfig = Field(default_factory=ProviderConfig)  # VolcEngine Coding Plan
    byteplus: ProviderConfig = Field(default_factory=ProviderConfig)  # BytePlus (VolcEngine international)
    byteplus_coding_plan: ProviderConfig = Field(default_factory=ProviderConfig)  # BytePlus Coding Plan
    openai_codex: ProviderConfig = Field(default_factory=ProviderConfig)  # OpenAI Codex (OAuth)
    github_copilot: ProviderConfig = Field(default_factory=ProviderConfig)  # Github Copilot (OAuth)


class HeartbeatConfig(Base):
    """Heartbeat service configuration."""

    enabled: bool = True
    interval_s: int = 30 * 60  # 30 minutes


class GatewayConfig(Base):
    """Gateway/server configuration."""

    host: str = "0.0.0.0"
    port: int = 18790
    heartbeat: HeartbeatConfig = Field(default_factory=HeartbeatConfig)


class WebSearchConfig(Base):
    """Web search tool configuration."""

    provider: str = "brave"  # brave, tavily, duckduckgo, searxng, jina
    api_key: str = ""
    base_url: str = ""  # SearXNG base URL
    max_results: int = 5


class WebToolsConfig(Base):
    """Web tools configuration."""

    proxy: str | None = (
        None  # HTTP/SOCKS5 proxy URL, e.g. "http://127.0.0.1:7890" or "socks5://127.0.0.1:1080"
    )
    search: WebSearchConfig = Field(default_factory=WebSearchConfig)


class ExecToolConfig(Base):
    """Shell exec tool configuration."""

    timeout: int = 60
    path_append: str = ""


class MCPServerConfig(Base):
    """MCP server connection configuration (stdio or HTTP)."""

    enabled: bool = True
    type: Literal["stdio", "sse", "streamableHttp"] | None = None  # auto-detected if omitted
    command: str = ""  # Stdio: command to run (e.g. "npx")
    args: list[str] = Field(default_factory=list)  # Stdio: command arguments
    env: dict[str, str] = Field(default_factory=dict)  # Stdio: extra env vars
    url: str = ""  # HTTP/SSE: endpoint URL
    headers: dict[str, str] = Field(default_factory=dict)  # HTTP/SSE: custom headers
    tool_timeout: int = 30  # seconds before a tool call is cancelled
    enabled_tools: list[str] = Field(default_factory=lambda: ["*"])  # Only register these tools; accepts raw MCP names or wrapped mcp_<server>_<tool> names; ["*"] = all tools; [] = no tools

class ToolsConfig(Base):
    """Tools configuration."""

    web: WebToolsConfig = Field(default_factory=WebToolsConfig)
    exec: ExecToolConfig = Field(default_factory=ExecToolConfig)
    restrict_to_workspace: bool = False  # If true, restrict all tool access to workspace directory
    mcp_servers: dict[str, MCPServerConfig] = Field(default_factory=dict)


class RAGConfig(Base):
    """RAG engine configuration for LightRAG / RAG-Anything."""

    llm_binding: str | None = None  # Named model binding for RAG LLM / VLM calls; None follows the default agent binding
    llm_model: str = ""  # Optional LLM model override for RAG queries and extraction
    embedding_binding: str | None = None  # Named model binding for embedding requests; None follows the RAG/default binding
    embedding_model: str = "text-embedding-3-large"  # Embedding model name
    embedding_dim: int = 3072  # Embedding dimensions
    embedding_max_tokens: int = 8192  # Max token size for embedding
    parser: str = "auto"  # Document parser: auto, mineru, docling, paddleocr
    mineru_api_base: str = ""  # MinerU API endpoint (remote/API mode, no GPU needed)
    parse_method: str = "auto"  # Parse method: auto, ocr, txt
    enable_image_processing: bool = True  # Process images in documents
    enable_table_processing: bool = True  # Process tables in documents
    enable_equation_processing: bool = True  # Process equations in documents


class Config(BaseSettings):
    """Root configuration for nanobot."""

    agents: AgentsConfig = Field(default_factory=AgentsConfig)
    channels: ChannelsConfig = Field(default_factory=ChannelsConfig)
    providers: ProvidersConfig = Field(default_factory=ProvidersConfig)
    model_bindings: dict[str, ModelBindingConfig] = Field(default_factory=dict)
    gateway: GatewayConfig = Field(default_factory=GatewayConfig)
    tools: ToolsConfig = Field(default_factory=ToolsConfig)
    rag: RAGConfig = Field(default_factory=RAGConfig)

    @property
    def workspace_path(self) -> Path:
        """Get expanded workspace path."""
        return Path(self.agents.defaults.workspace).expanduser()

    @staticmethod
    def _has_auth_material(provider: ProviderConfig | ModelBindingConfig | None) -> bool:
        return bool(
            provider
            and (
                provider.api_key
                or provider.api_base
                or (provider.extra_headers and len(provider.extra_headers) > 0)
            )
        )

    @staticmethod
    def _copy_headers(extra_headers: dict[str, str] | None) -> dict[str, str] | None:
        if not extra_headers:
            return None
        return dict(extra_headers)

    def _legacy_binding_for_provider(
        self,
        provider_name: str,
        *,
        model: str | None = None,
    ) -> ModelBindingConfig | None:
        provider = getattr(self.providers, provider_name, None)
        if provider is None:
            return None
        from nanobot.providers.registry import find_by_name

        spec = find_by_name(provider_name)
        if not self._has_auth_material(provider) and not (spec and spec.is_oauth):
            return None
        return ModelBindingConfig(
            provider=provider_name,
            label=spec.label if spec else provider_name,
            model=model or None,
            api_key=provider.api_key,
            api_base=provider.api_base,
            extra_headers=self._copy_headers(provider.extra_headers),
        )

    def _iter_binding_items(self) -> list[tuple[str, ModelBindingConfig]]:
        items = list(self.model_bindings.items())
        if items:
            return items

        from nanobot.providers.registry import PROVIDERS

        active_provider = str(self.agents.defaults.provider or "").strip()
        active_model = str(self.agents.defaults.model or "").strip() or None
        synthesized: list[tuple[str, ModelBindingConfig]] = []
        for spec in PROVIDERS:
            provider = getattr(self.providers, spec.name, None)
            if provider is None:
                continue
            if not self._has_auth_material(provider) and active_provider != spec.name:
                continue
            synthesized_binding = ModelBindingConfig(
                provider=spec.name,
                label=spec.label,
                model=active_model if active_provider == spec.name else None,
                api_key=provider.api_key,
                api_base=provider.api_base,
                extra_headers=self._copy_headers(provider.extra_headers),
            )
            synthesized.append((spec.name, synthesized_binding))
        return synthesized

    def _binding_candidates(self, provider_name: str) -> list[tuple[str, ModelBindingConfig]]:
        provider_name = str(provider_name or "").strip()
        if not provider_name:
            return []
        candidates = [
            (binding_name, binding)
            for binding_name, binding in self._iter_binding_items()
            if binding.provider == provider_name
        ]
        if candidates:
            return candidates
        legacy = self._legacy_binding_for_provider(provider_name)
        return [(provider_name, legacy)] if legacy else []

    def _preferred_binding_candidate(
        self,
        provider_name: str,
        *,
        model: str | None = None,
    ) -> tuple[str, ModelBindingConfig] | None:
        candidates = self._binding_candidates(provider_name)
        if not candidates:
            return None

        requested_binding = str(self.agents.defaults.binding or "").strip()
        if requested_binding:
            for candidate in candidates:
                if candidate[0] == requested_binding:
                    return candidate

        for candidate in candidates:
            if candidate[0] == provider_name:
                return candidate

        expected_model = str(model or self.agents.defaults.model or "").strip().lower()
        if expected_model:
            for candidate in candidates:
                if str(candidate[1].model or "").strip().lower() == expected_model:
                    return candidate

        return candidates[0]

    def _binding_is_routable(
        self,
        binding: ModelBindingConfig | ProviderConfig | None,
        *,
        provider_name: str,
    ) -> bool:
        from nanobot.providers.registry import find_by_name

        if binding is None:
            return False
        spec = find_by_name(provider_name)
        if spec is None:
            return self._has_auth_material(binding)
        if spec.is_oauth:
            return True
        if spec.is_local:
            return bool(binding.api_base)
        return bool(binding.api_key)

    def _match_binding(
        self,
        model: str | None = None,
    ) -> tuple["ModelBindingConfig | ProviderConfig | None", str | None, str | None]:
        """Match (binding config, binding name, provider name)."""
        from nanobot.providers.registry import PROVIDERS

        forced_binding = str(self.agents.defaults.binding or "").strip()
        if forced_binding:
            binding = self.model_bindings.get(forced_binding)
            if binding is not None:
                return binding, forced_binding, binding.provider

        forced_provider = str(self.agents.defaults.provider or "").strip()
        if forced_provider and forced_provider != "auto":
            preferred = self._preferred_binding_candidate(forced_provider, model=model)
            if preferred:
                binding_name, binding = preferred
                return binding, binding_name, forced_provider
            provider = getattr(self.providers, forced_provider, None)
            return (provider, None, forced_provider) if provider else (None, None, None)

        model_lower = (model or self.agents.defaults.model).lower()
        model_normalized = model_lower.replace("-", "_")
        model_prefix = model_lower.split("/", 1)[0] if "/" in model_lower else ""
        normalized_prefix = model_prefix.replace("-", "_")

        def _kw_matches(kw: str) -> bool:
            kw = kw.lower()
            return kw in model_lower or kw.replace("-", "_") in model_normalized

        # Explicit provider prefix wins — prevents `github-copilot/...codex` matching openai_codex.
        for spec in PROVIDERS:
            if not model_prefix or normalized_prefix != spec.name:
                continue
            preferred = self._preferred_binding_candidate(spec.name, model=model)
            if preferred and self._binding_is_routable(preferred[1], provider_name=spec.name):
                binding_name, binding = preferred
                return binding, binding_name, spec.name
            provider = getattr(self.providers, spec.name, None)
            if provider and (
                spec.is_oauth
                or spec.is_local
                or self._binding_is_routable(provider, provider_name=spec.name)
            ):
                return provider, None, spec.name

        # Match by keyword (order follows PROVIDERS registry)
        for spec in PROVIDERS:
            if not any(_kw_matches(kw) for kw in spec.keywords):
                continue
            preferred = self._preferred_binding_candidate(spec.name, model=model)
            if preferred and self._binding_is_routable(preferred[1], provider_name=spec.name):
                binding_name, binding = preferred
                return binding, binding_name, spec.name
            provider = getattr(self.providers, spec.name, None)
            if provider and self._binding_is_routable(provider, provider_name=spec.name):
                return provider, None, spec.name

        # Fallback: configured local providers can route models without provider-specific keywords.
        local_fallback: tuple[ModelBindingConfig | ProviderConfig, str | None, str] | None = None
        for spec in PROVIDERS:
            if not spec.is_local:
                continue
            preferred = self._preferred_binding_candidate(spec.name, model=model)
            if preferred and preferred[1].api_base:
                binding_name, binding = preferred
                if spec.detect_by_base_keyword and spec.detect_by_base_keyword in preferred[1].api_base:
                    return binding, binding_name, spec.name
                if local_fallback is None:
                    local_fallback = (binding, binding_name, spec.name)
            provider = getattr(self.providers, spec.name, None)
            if not (provider and provider.api_base):
                continue
            if spec.detect_by_base_keyword and spec.detect_by_base_keyword in provider.api_base:
                return provider, None, spec.name
            if local_fallback is None:
                local_fallback = (provider, None, spec.name)
        if local_fallback:
            return local_fallback

        # Fallback: gateways first, then others (follows registry order)
        # OAuth providers are NOT valid fallbacks — they require explicit model selection
        for spec in PROVIDERS:
            if spec.is_oauth:
                continue
            preferred = self._preferred_binding_candidate(spec.name, model=model)
            if preferred and self._binding_is_routable(preferred[1], provider_name=spec.name):
                binding_name, binding = preferred
                return binding, binding_name, spec.name
            provider = getattr(self.providers, spec.name, None)
            if provider and self._binding_is_routable(provider, provider_name=spec.name):
                return provider, None, spec.name
        return None, None, None

    @model_validator(mode="after")
    def _hydrate_model_bindings(self) -> "Config":
        from nanobot.providers.registry import PROVIDERS, find_by_name

        for spec in PROVIDERS:
            provider = getattr(self.providers, spec.name, None)
            if provider is None:
                continue
            provider.api_base = normalize_api_base_url(spec.name, provider.api_base)

        if self.model_bindings:
            normalized: dict[str, ModelBindingConfig] = {}
            for binding_name, binding in self.model_bindings.items():
                key = str(binding_name or "").strip()
                if not key:
                    continue
                provider_name = str(binding.provider or "").strip()
                if not provider_name:
                    continue
                spec = find_by_name(provider_name)
                normalized[key] = ModelBindingConfig(
                    provider=provider_name,
                    label=str(binding.label or "").strip() or (spec.label if spec else provider_name),
                    model=str(binding.model or "").strip() or None,
                    api_key=binding.api_key,
                    api_base=normalize_api_base_url(provider_name, binding.api_base),
                    extra_headers=self._copy_headers(binding.extra_headers),
                )
            self.model_bindings = normalized
        else:
            synthesized: dict[str, ModelBindingConfig] = {}
            for spec in PROVIDERS:
                provider = getattr(self.providers, spec.name, None)
                if provider is None:
                    continue
                if not self._has_auth_material(provider) and str(self.agents.defaults.provider or "").strip() != spec.name:
                    continue
                synthesized[spec.name] = ModelBindingConfig(
                    provider=spec.name,
                    label=spec.label,
                    model=str(self.agents.defaults.model or "").strip() or None
                    if str(self.agents.defaults.provider or "").strip() == spec.name
                    else None,
                    api_key=provider.api_key,
                    api_base=normalize_api_base_url(spec.name, provider.api_base),
                    extra_headers=self._copy_headers(provider.extra_headers),
                )
            self.model_bindings = synthesized

        if self.agents.defaults.binding and self.agents.defaults.binding not in self.model_bindings:
            self.agents.defaults.binding = None
        if self.rag.llm_binding and self.rag.llm_binding not in self.model_bindings:
            self.rag.llm_binding = None
        if self.rag.embedding_binding and self.rag.embedding_binding not in self.model_bindings:
            self.rag.embedding_binding = None

        if not self.agents.defaults.binding:
            preferred_provider = str(self.agents.defaults.provider or "").strip()
            if preferred_provider and preferred_provider != "auto":
                preferred = self._preferred_binding_candidate(preferred_provider)
                if preferred:
                    self.agents.defaults.binding = preferred[0]
            elif len(self.model_bindings) == 1:
                self.agents.defaults.binding = next(iter(self.model_bindings))

        active_binding = self.model_bindings.get(str(self.agents.defaults.binding or "").strip())
        if active_binding is not None:
            self.agents.defaults.provider = active_binding.provider
            if not str(self.agents.defaults.model or "").strip() and active_binding.model:
                self.agents.defaults.model = active_binding.model
            elif str(self.agents.defaults.model or "").strip() and not active_binding.model:
                active_binding.model = str(self.agents.defaults.model).strip()

        for spec in PROVIDERS:
            projection = self._preferred_binding_candidate(spec.name)
            if not projection:
                continue
            provider = getattr(self.providers, spec.name, None)
            if provider is None:
                continue
            binding = projection[1]
            provider.api_key = binding.api_key
            provider.api_base = normalize_api_base_url(spec.name, binding.api_base)
            provider.extra_headers = self._copy_headers(binding.extra_headers)

        return self

    def _match_provider(
        self, model: str | None = None
    ) -> tuple["ProviderConfig | None", str | None]:
        """Match provider config and its registry name. Returns (config, spec_name)."""
        provider, _, provider_name = self._match_binding(model)
        return provider, provider_name

    def get_binding(
        self,
        model: str | None = None,
    ) -> "ModelBindingConfig | ProviderConfig | None":
        """Get the matched binding config if available, else fall back to legacy provider config."""
        binding, _, _ = self._match_binding(model)
        return binding

    def get_binding_name(self, model: str | None = None) -> str | None:
        """Get the matched binding id when one is available."""
        _, binding_name, _ = self._match_binding(model)
        return binding_name

    def get_provider(self, model: str | None = None) -> ProviderConfig | None:
        """Get matched provider config (api_key, api_base, extra_headers). Falls back to first available."""
        p, _ = self._match_provider(model)
        return p

    def get_provider_name(self, model: str | None = None) -> str | None:
        """Get the registry name of the matched provider (e.g. "deepseek", "openrouter")."""
        _, name = self._match_provider(model)
        return name

    def get_api_key(self, model: str | None = None) -> str | None:
        """Get API key for the given model. Falls back to first available key."""
        p = self.get_provider(model)
        return p.api_key if p else None

    def get_api_base(self, model: str | None = None) -> str | None:
        """Get API base URL for the given model. Applies default URLs for gateway/local providers."""
        from nanobot.providers.registry import find_by_name

        p, name = self._match_provider(model)
        if p and p.api_base:
            return p.api_base
        # Only gateways get a default api_base here. Standard providers
        # (like Moonshot) set their base URL via env vars in _setup_env
        # to avoid polluting the global litellm.api_base.
        if name:
            spec = find_by_name(name)
            if spec and (spec.is_gateway or spec.is_local) and spec.default_api_base:
                return spec.default_api_base
        return None

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        env_prefix="NANOBOT_",
        env_nested_delimiter="__",
    )
