from __future__ import annotations

import pytest

from nanobot.providers.base import GenerationSettings, LLMProvider, LLMResponse


class _RuntimeProvider(LLMProvider):
    def __init__(self, *, model: str = "openai/gpt-4o-mini") -> None:
        super().__init__()
        self._model = model
        self.generation = GenerationSettings(max_tokens=4096)

    async def chat(self, *args, **kwargs) -> LLMResponse:
        return LLMResponse(content="", tool_calls=[])

    def get_default_model(self) -> str:
        return self._model


@pytest.fixture(autouse=True)
def _patch_web_runtime_provider(monkeypatch):
    monkeypatch.setattr(
        "nanobot.web.runtime_services.config.make_provider_from_config",
        lambda config, **kwargs: _RuntimeProvider(model=kwargs.get("model") or config.agents.defaults.model),
    )
