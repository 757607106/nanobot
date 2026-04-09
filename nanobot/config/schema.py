"""Configuration schema using Pydantic."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from pydantic_settings import BaseSettings

from nanobot.cron.types import CronSchedule


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
    send_max_retries: int = Field(default=3, ge=0, le=10)  # Max delivery attempts (initial send included)
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
    weixin: ChannelSectionConfig = Field(default_factory=ChannelSectionConfig)

    transcription_provider: str = "groq"  # Voice transcription backend: "groq" or "openai"

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
                "weixin",
            ):
                section = getattr(self, name, None)
                if isinstance(section, ChannelSectionConfig):
                    data[name] = section.model_dump(*args, **kwargs)
        return data


class DreamConfig(Base):
    """Dream memory consolidation configuration."""

    _HOUR_MS = 3_600_000

    interval_h: int = Field(default=2, ge=1)  # Every 2 hours by default
    cron: str | None = Field(default=None, exclude=True)  # Legacy compatibility override
    model_override: str | None = Field(
        default=None,
        validation_alias=AliasChoices("modelOverride", "model", "model_override"),
    )  # Optional Dream-specific model override
    max_batch_size: int = Field(default=20, ge=1)  # Max history entries per run
    max_iterations: int = Field(default=10, ge=1)  # Max tool calls per Phase 2

    def build_schedule(self, timezone: str) -> CronSchedule:
        """Build the runtime schedule, preferring the legacy cron override if present."""
        if self.cron:
            return CronSchedule(kind="cron", expr=self.cron, tz=timezone)
        return CronSchedule(kind="every", every_ms=self.interval_h * self._HOUR_MS)

    def describe_schedule(self) -> str:
        """Return a human-readable summary for logs and startup output."""
        if self.cron:
            return f"cron {self.cron} (legacy)"
        hours = self.interval_h
        return f"every {hours}h"


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
    context_block_limit: int | None = None
    temperature: float = 0.1
    max_tool_iterations: int = 200
    max_tool_result_chars: int = 16_000
    provider_retry_mode: Literal["standard", "persistent"] = "standard"
    memory_window: int | None = Field(default=None, exclude=True)
    reasoning_effort: str | None = None  # low / medium / high - enables LLM thinking mode
    timezone: str = "UTC"  # IANA timezone, e.g. "Asia/Shanghai", "America/New_York"
    dream: DreamConfig = Field(default_factory=DreamConfig)

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
    capability_type: Literal["text_chat", "embedding", "multimodal", "rerank"] = "text_chat"


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
    ovms: ProviderConfig = Field(default_factory=ProviderConfig)  # OpenVINO Model Server (OVMS)
    gemini: ProviderConfig = Field(default_factory=ProviderConfig)
    moonshot: ProviderConfig = Field(default_factory=ProviderConfig)
    minimax: ProviderConfig = Field(default_factory=ProviderConfig)
    mistral: ProviderConfig = Field(default_factory=ProviderConfig)
    stepfun: ProviderConfig = Field(default_factory=ProviderConfig)  # Step Fun (阶跃星辰)
    xiaomi_mimo: ProviderConfig = Field(default_factory=ProviderConfig)  # Xiaomi MIMO (小米)
    aihubmix: ProviderConfig = Field(default_factory=ProviderConfig)  # AiHubMix API gateway
    siliconflow: ProviderConfig = Field(default_factory=ProviderConfig)  # SiliconFlow (硅基流动)
    volcengine: ProviderConfig = Field(default_factory=ProviderConfig)  # VolcEngine (火山引擎)
    volcengine_coding_plan: ProviderConfig = Field(default_factory=ProviderConfig)  # VolcEngine Coding Plan
    byteplus: ProviderConfig = Field(default_factory=ProviderConfig)  # BytePlus (VolcEngine international)
    byteplus_coding_plan: ProviderConfig = Field(default_factory=ProviderConfig)  # BytePlus Coding Plan
    openai_codex: ProviderConfig = Field(default_factory=ProviderConfig, exclude=True)  # OpenAI Codex (OAuth)
    github_copilot: ProviderConfig = Field(default_factory=ProviderConfig, exclude=True)  # Github Copilot (OAuth)
    qianfan: ProviderConfig = Field(default_factory=ProviderConfig)  # Qianfan (百度千帆)


class HeartbeatConfig(Base):
    """Heartbeat service configuration."""

    enabled: bool = True
    interval_s: int = 30 * 60  # 30 minutes
    keep_recent_messages: int = 8


class ApiConfig(Base):
    """OpenAI-compatible API server configuration."""

    host: str = "127.0.0.1"  # Safer default: local-only bind.
    port: int = 8900
    timeout: float = 120.0  # Per-request timeout in seconds.


class GatewayConfig(Base):
    """Gateway/server configuration."""

    host: str = "0.0.0.0"
    port: int = 18790
    heartbeat: HeartbeatConfig = Field(default_factory=HeartbeatConfig)


class WebSearchConfig(Base):
    """Web search tool configuration."""

    provider: str = "duckduckgo"  # brave, tavily, duckduckgo, searxng, jina
    api_key: str = ""
    base_url: str = ""  # SearXNG base URL
    max_results: int = 5
    timeout: int = 30  # Wall-clock timeout (seconds) for search operations


class WebToolsConfig(Base):
    """Web tools configuration."""

    enable: bool = True
    proxy: str | None = (
        None  # HTTP/SOCKS5 proxy URL, e.g. "http://127.0.0.1:7890" or "socks5://127.0.0.1:1080"
    )
    search: WebSearchConfig = Field(default_factory=WebSearchConfig)


class ExecToolConfig(Base):
    """Shell exec tool configuration."""

    enable: bool = True
    timeout: int = 60
    path_append: str = ""
    sandbox_kind: Literal["local", "docker", "remote"] = "local"
    sandbox: str = ""  # upstream sandbox compatibility
    docker_image: str = "python:3.12-slim"
    docker_runtime_workdir: str = "/workspace"
    docker_network_mode: str = "bridge"
    docker_mount_policy: Literal["workspace_only", "workspace_and_mounts"] = "workspace_only"
    docker_mounts: list[str] = Field(default_factory=list)
    docker_env_allowlist: list[str] = Field(default_factory=list)
    remote_endpoint: str = ""

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
    restrict_to_workspace: bool = False  # restrict all tool access to workspace directory
    mcp_servers: dict[str, MCPServerConfig] = Field(default_factory=dict)
    ssrf_whitelist: list[str] = Field(default_factory=list)  # CIDR ranges to exempt from SSRF blocking (e.g. ["100.64.0.0/10"] for Tailscale)


class RagMilvusConfig(Base):
    """Milvus vector storage connection for the LightRAG workflow."""

    uri: str = "http://127.0.0.1:19530"
    db_name: str = "nanobot"
    user: str = ""
    password: str = ""
    token: str = "root:Milvus"
    index_type: str = "AUTOINDEX"
    metric_type: str = "COSINE"


class RagGraphStoreConfig(Base):
    """Neo4j graph storage connection for the LightRAG workflow."""

    enabled: bool = True
    provider: Literal["networkx", "neo4j"] = "neo4j"
    uri: str = "bolt://127.0.0.1:7687"
    username: str = "neo4j"
    password: str = "password"
    database: str = "neo4j"


class RAGConfig(Base):
    """RAG engine configuration — embeds LightRAG Core for GraphRAG.

    LLM and Embedding models are injected from nanobot's modelBindings.
    Storage backends (Neo4j for graph, Milvus for vectors) run as Docker
    services configured here.
    """

    # Model bindings (reference keys from Config.model_bindings)
    llm_binding: str | None = None       # LLM for indexing + query; None = use default agent binding
    embedding_binding: str | None = None  # Embedding model; None = auto-detect from bindings

    # Timeouts
    llm_timeout: int = 180       # seconds per LightRAG LLM/VLM request
    embedding_timeout: int = 60  # seconds per LightRAG embedding request

    # LightRAG concurrency tuning
    max_async: int = 16                 # MAX_ASYNC — concurrent LLM requests during query/index
    max_parallel_insert: int = 4        # MAX_PARALLEL_INSERT — parallel document ingest workers
    embedding_func_max_async: int = 4   # EMBEDDING_FUNC_MAX_ASYNC — concurrent embedding requests (keep low to avoid provider rate limits)

    # LightRAG chunking & batching
    chunk_token_size: int = 2400        # Tokens per chunk — larger = fewer chunks = fewer LLM calls (default 1200 in LightRAG)
    chunk_overlap_token_size: int = 100 # Overlap tokens between chunks for context preservation
    embedding_batch_num: int = 32       # Texts per embedding API call — larger = fewer requests = less rate limiting

    # Storage backends
    milvus: RagMilvusConfig = Field(default_factory=RagMilvusConfig)
    graph_store: RagGraphStoreConfig = Field(default_factory=RagGraphStoreConfig)

# Multimodal model keywords used by capability type inference (module-level to
# avoid Pydantic treating it as a ModelPrivateAttr inside the Config class).
_MULTIMODAL_MODEL_KEYWORDS = (
    "vision", "vl", "omni", "qvq", "pixtral",
    "gpt-4o", "gpt-4-turbo",
    "claude-opus", "claude-sonnet",
    "gemini-2", "gemini-1.5", "gemini-pro",
    "glm-4v",
    "qwen-vl", "qwen2-vl", "qwen2.5-vl",
    "step-1v", "step-2v",
    "yi-vision",
    "internvl",
)


class Config(BaseSettings):
    """Root configuration for nanobot."""

    agents: AgentsConfig = Field(default_factory=AgentsConfig)
    channels: ChannelsConfig = Field(default_factory=ChannelsConfig)
    providers: ProvidersConfig = Field(default_factory=ProvidersConfig)
    model_bindings: dict[str, ModelBindingConfig] = Field(default_factory=dict)
    api: ApiConfig = Field(default_factory=ApiConfig)
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

    def _merge_provider_material(
        self,
        provider_name: str | None,
        preferred: ProviderConfig | ModelBindingConfig | None,
    ) -> ProviderConfig | None:
        """Merge binding overrides with provider-level fallback material."""
        resolved_name = str(provider_name or "").strip()
        provider = getattr(self.providers, resolved_name, None) if resolved_name else None
        if preferred is None and provider is None:
            return None
        source = preferred or provider
        if source is None:
            return None

        api_key = str(getattr(source, "api_key", None) or "").strip()
        if not api_key and provider is not None:
            api_key = str(getattr(provider, "api_key", None) or "").strip()

        api_base = normalize_api_base_url(
            resolved_name or None,
            getattr(source, "api_base", None),
        )
        if not api_base and provider is not None:
            api_base = normalize_api_base_url(
                resolved_name or None,
                getattr(provider, "api_base", None),
            )

        extra_headers = self._copy_headers(getattr(source, "extra_headers", None))
        if not extra_headers and provider is not None:
            extra_headers = self._copy_headers(getattr(provider, "extra_headers", None))

        return ProviderConfig(
            api_key=api_key,
            api_base=api_base,
            extra_headers=extra_headers,
        )

    @staticmethod
    def _infer_binding_capability_type(
        model: str | None,
        label: str | None = None,
    ) -> Literal["text_chat", "embedding", "multimodal", "rerank"]:
        haystack = " ".join(
            part.strip().lower()
            for part in (model or "", label or "")
            if str(part or "").strip()
        )
        if any(token in haystack for token in ("rerank", "reranker", "bge-reranker", "jina-reranker")):
            return "rerank"
        if any(token in haystack for token in ("embedding", "embeddings", "embed", "bge", "e5", "gte", "voyage")):
            return "embedding"
        if any(token in haystack for token in _MULTIMODAL_MODEL_KEYWORDS):
            return "multimodal"
        return "text_chat"

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
            capability_type="text_chat",
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
                capability_type="text_chat",
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
            from nanobot.providers.registry import find_by_name

            normalized_spec = find_by_name(forced_provider)
            normalized_provider = normalized_spec.name if normalized_spec is not None else forced_provider
            preferred = self._preferred_binding_candidate(normalized_provider, model=model)
            if preferred:
                binding_name, binding = preferred
                return binding, binding_name, normalized_provider
            provider = getattr(self.providers, normalized_provider, None)
            return (provider, None, normalized_provider) if provider else (None, None, None)

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

        if self.agents.defaults.provider and self.agents.defaults.provider != "auto":
            normalized = find_by_name(self.agents.defaults.provider)
            if normalized is not None:
                self.agents.defaults.provider = normalized.name

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
                normalized_provider_name = spec.name if spec is not None else provider_name
                explicit_capability = (
                    str(getattr(binding, "capability_type", "") or "").strip()
                    if "capability_type" in getattr(binding, "model_fields_set", set())
                    else ""
                )
                normalized[key] = ModelBindingConfig(
                    provider=normalized_provider_name,
                    label=str(binding.label or "").strip() or (spec.label if spec else normalized_provider_name),
                    model=str(binding.model or "").strip() or None,
                    api_key=binding.api_key,
                    api_base=normalize_api_base_url(normalized_provider_name, binding.api_base),
                    extra_headers=self._copy_headers(binding.extra_headers),
                    capability_type=(
                        explicit_capability
                        or self._infer_binding_capability_type(binding.model, binding.label)
                    ),
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
                    capability_type="text_chat",
                )
            self.model_bindings = synthesized

        if self.agents.defaults.binding and self.agents.defaults.binding not in self.model_bindings:
            self.agents.defaults.binding = None


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
            merged = self._merge_provider_material(spec.name, binding)
            if merged is None:
                continue
            provider.api_key = merged.api_key
            provider.api_base = merged.api_base
            provider.extra_headers = merged.extra_headers

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
        p, name = self._match_provider(model)
        return self._merge_provider_material(name, p)

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

        p = self.get_provider(model)
        name = self.get_provider_name(model)
        if p and p.api_base:
            return p.api_base
        # Only gateways get a default api_base here. Standard providers
        # resolve their base URL from the registry in the provider constructor.
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
