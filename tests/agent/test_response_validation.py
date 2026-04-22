from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.agent.loop import AgentLoop
from nanobot.bus.queue import MessageBus
from nanobot.providers.base import LLMResponse, ToolCallRequest


def _make_loop(tmp_path):
    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    provider.generation = SimpleNamespace(max_tokens=4096)
    return AgentLoop(bus=bus, provider=provider, workspace=tmp_path, model="test-model")


@pytest.mark.asyncio
async def test_process_direct_retries_when_final_response_validation_rejects(tmp_path) -> None:
    (tmp_path / "pyproject.toml").write_text("[project]\nname = 'demo'\n", encoding="utf-8")
    loop = _make_loop(tmp_path)
    loop.turn_maintenance.schedule_after_user_turn = MagicMock()

    main_calls = {"count": 0}
    validation_calls = {"count": 0}

    async def chat_with_retry(*, messages, tools, model, **kwargs):
        del model, kwargs
        tool_names = {tool["function"]["name"] for tool in (tools or [])}
        if "validate_final_response" in tool_names:
            validation_calls["count"] += 1
            if validation_calls["count"] == 1:
                return LLMResponse(
                    content="",
                    tool_calls=[
                        ToolCallRequest(
                            id="validate-1",
                            name="validate_final_response",
                            arguments={
                                "accepted": False,
                                "reason": "The read_file result starts with [project], not [tool.poetry].",
                                "retry_message": "Use the exact first non-empty line from read_file.",
                            },
                        )
                    ],
                )
            return LLMResponse(
                content="",
                tool_calls=[
                    ToolCallRequest(
                        id="validate-2",
                        name="validate_final_response",
                        arguments={"accepted": True, "reason": "Matches the tool result."},
                    )
                ],
            )

        main_calls["count"] += 1
        if main_calls["count"] == 1:
            return LLMResponse(
                content="",
                tool_calls=[
                    ToolCallRequest(
                        id="call-1",
                        name="read_file",
                        arguments={"path": "pyproject.toml"},
                    )
                ],
            )
        if main_calls["count"] == 2:
            return LLMResponse(content="[tool.poetry]", tool_calls=[])

        assert messages[-1]["role"] == "user"
        assert messages[-1].get("_internal") is True
        assert "did not pass validation" in messages[-1]["content"]
        return LLMResponse(content="[project]", tool_calls=[])

    loop.provider.chat_with_retry = AsyncMock(side_effect=chat_with_retry)

    response = await loop.process_direct(
        "What is the first non-empty line of pyproject.toml?",
        session_key="cli:test-validation",
        run_context={
            "response_validation": {
                "task": "What is the first non-empty line of pyproject.toml?",
            }
        },
    )

    assert response is not None
    assert response.content == "[project]"
    assert main_calls["count"] == 3
    assert validation_calls["count"] == 2

    session = loop.sessions.get_or_create("cli:test-validation")
    assert not any(
        "did not pass validation" in str(message.get("content") or "")
        for message in session.messages
    )
    assert session.messages[-1]["role"] == "assistant"
    assert session.messages[-1]["content"] == "[project]"
