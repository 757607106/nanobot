"""Tests for shared config-driven provider construction."""

from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import patch

from nanobot.config.schema import Config
from nanobot.providers.factory import make_provider_from_config
from nanobot.providers.openai_compat_provider import OpenAICompatProvider


def test_make_provider_from_config_uses_openai_compat_for_custom_binding() -> None:
    config = Config.model_validate(
        {
            "agents": {"defaults": {"provider": "custom", "model": "gpt-4o-mini"}},
            "providers": {
                "custom": {
                    "apiKey": "test-key",
                    "apiBase": "https://example.com/v1",
                    "extraHeaders": {"APP-Code": "demo-app"},
                }
            },
        }
    )

    with patch("nanobot.providers.openai_compat_provider.AsyncOpenAI"):
        provider = make_provider_from_config(config)

    assert isinstance(provider, OpenAICompatProvider)
    assert provider.get_default_model() == "gpt-4o-mini"


def test_make_provider_from_config_uses_anthropic_provider(monkeypatch) -> None:
    config = Config.model_validate(
        {
            "agents": {"defaults": {"provider": "anthropic", "model": "claude-sonnet-4-20250514"}},
            "providers": {
                "anthropic": {
                    "apiKey": "sk-ant-test",
                }
            },
        }
    )

    monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(AsyncAnthropic=lambda **kwargs: object()))
    provider = make_provider_from_config(config)

    assert provider.__class__.__name__ == "AnthropicProvider"
    assert provider.get_default_model() == "claude-sonnet-4-20250514"
