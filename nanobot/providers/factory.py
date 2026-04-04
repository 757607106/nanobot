"""Shared provider factory for config-driven runtime entrypoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from nanobot.providers.base import GenerationSettings
from nanobot.providers.registry import find_by_name

if TYPE_CHECKING:
    from nanobot.config.schema import Config
    from nanobot.providers.base import LLMProvider


def make_provider_from_config(
    config: "Config",
    *,
    model: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    reasoning_effort: str | None = None,
) -> "LLMProvider":
    """Create a runtime provider using the same backend selection as the CLI."""
    model_name = model or config.agents.defaults.model
    provider_name = config.get_provider_name(model_name)
    provider_cfg = config.get_provider(model_name)
    spec = find_by_name(provider_name) if provider_name else None
    backend = spec.backend if spec else "openai_compat"

    if backend == "openai_codex":
        from nanobot.providers.openai_codex_provider import OpenAICodexProvider

        provider = OpenAICodexProvider(default_model=model_name)
    elif backend == "azure_openai" and provider_cfg and provider_cfg.api_key and provider_cfg.api_base:
        from nanobot.providers.azure_openai_provider import AzureOpenAIProvider

        provider = AzureOpenAIProvider(
            api_key=provider_cfg.api_key,
            api_base=provider_cfg.api_base,
            default_model=model_name,
        )
    elif backend == "github_copilot":
        from nanobot.providers.github_copilot_provider import GitHubCopilotProvider

        provider = GitHubCopilotProvider(default_model=model_name)
    elif backend == "anthropic":
        from nanobot.providers.anthropic_provider import AnthropicProvider

        provider = AnthropicProvider(
            api_key=provider_cfg.api_key if provider_cfg else None,
            api_base=config.get_api_base(model_name),
            default_model=model_name,
            extra_headers=provider_cfg.extra_headers if provider_cfg else None,
        )
    else:
        from nanobot.providers.openai_compat_provider import OpenAICompatProvider

        provider = OpenAICompatProvider(
            api_key=provider_cfg.api_key if provider_cfg else None,
            api_base=config.get_api_base(model_name),
            default_model=model_name,
            extra_headers=provider_cfg.extra_headers if provider_cfg else None,
            spec=spec,
        )

    defaults = config.agents.defaults
    provider.generation = GenerationSettings(
        temperature=defaults.temperature if temperature is None else temperature,
        max_tokens=defaults.max_tokens if max_tokens is None else max_tokens,
        reasoning_effort=defaults.reasoning_effort if reasoning_effort is None else reasoning_effort,
    )
    return provider
