from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.config.schema import Config
from nanobot.web.runtime_services import channel_runtime as channel_runtime_module
from nanobot.web.runtime_services.channel_runtime import WebChannelRuntimeService


@pytest.mark.asyncio
async def test_channel_runtime_start_pipeline_logs_bootstrap_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    state = SimpleNamespace(
        config=Config(),
        channel_bindings_service=SimpleNamespace(),
        channel_audit_service=None,
        config_runtime=SimpleNamespace(make_provider=lambda config: object()),
        sessions=SimpleNamespace(),
    )
    runtime = WebChannelRuntimeService(state)
    runtime._stop_pipeline = AsyncMock()

    def _boom(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(channel_runtime_module, "AgentLoop", _boom)
    logger_exception = MagicMock()
    monkeypatch.setattr(channel_runtime_module.logger, "exception", logger_exception)

    await runtime._start_pipeline()

    runtime._stop_pipeline.assert_awaited_once()
    logger_exception.assert_called_once_with("Channel routing pipeline crashed")
