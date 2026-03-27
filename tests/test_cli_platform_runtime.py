from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.cli.platform_runtime import CLIGatewayRoutingRuntime


def _make_runtime(**overrides) -> CLIGatewayRoutingRuntime:
    state = overrides.pop("state", SimpleNamespace(bus=object(), agent=None))
    return CLIGatewayRoutingRuntime(
        state=state,
        agents_service=overrides.pop("agents_service", SimpleNamespace()),
        teams_service=overrides.pop("teams_service", SimpleNamespace()),
        channel_bindings=overrides.pop("channel_bindings", SimpleNamespace()),
        routing_service=overrides.pop("routing_service", SimpleNamespace()),
        runs=overrides.pop("runs", SimpleNamespace()),
        knowledge_service=overrides.pop("knowledge_service", SimpleNamespace(shutdown=lambda: None)),
        memory_service=overrides.pop("memory_service", SimpleNamespace()),
        agent_runtime=overrides.pop("agent_runtime", SimpleNamespace()),
        team_runtime=overrides.pop("team_runtime", SimpleNamespace()),
    )


@pytest.mark.asyncio
async def test_cli_gateway_agent_handler_reuses_shared_agent_runtime() -> None:
    isolated = SimpleNamespace(
        process_direct=AsyncMock(return_value="agent reply"),
        close_mcp=AsyncMock(return_value=None),
    )
    agent_def = {"agentId": "ops-agent", "name": "Ops Agent"}
    agent_runtime = SimpleNamespace(
        build_isolated_agent_loop=MagicMock(return_value=(isolated, object()))
    )
    runtime = _make_runtime(
        agents_service=SimpleNamespace(get_agent=lambda agent_id: agent_def),
        agent_runtime=agent_runtime,
    )
    message = SimpleNamespace(
        content="restart service",
        session_key="telegram:42",
        channel="telegram",
        chat_id="42",
    )

    result = await runtime.handle_agent_message("ops-agent", message)

    assert result == "agent reply"
    agent_runtime.build_isolated_agent_loop.assert_called_once_with(
        agent_def,
        task="restart service",
        bus=runtime.state.bus,
    )
    isolated.process_direct.assert_awaited_once_with(
        "restart service",
        session_key="agent:ops-agent:telegram:42",
        channel="telegram",
        chat_id="42",
    )
    isolated.close_mcp.assert_awaited_once()


@pytest.mark.asyncio
async def test_cli_gateway_team_handler_reuses_shared_team_runtime() -> None:
    team_runtime = SimpleNamespace(
        run_team_sync=AsyncMock(return_value={"finalContent": "team reply"})
    )
    runtime = _make_runtime(team_runtime=team_runtime)
    message = SimpleNamespace(content="handle this", channel="slack", chat_id="room-1", session_key="slack:room-1")

    result = await runtime.handle_team_message("ops-team", message)

    assert result == "team reply"
    team_runtime.run_team_sync.assert_awaited_once_with(
        "ops-team",
        "handle this",
        origin_channel="slack",
        origin_chat_id="room-1",
        session_key="slack:room-1",
    )


def test_cli_gateway_bind_main_agent_updates_runtime_state() -> None:
    runtime = _make_runtime()
    agent = object()

    runtime.bind_main_agent(agent)  # type: ignore[arg-type]

    assert runtime.state.agent is agent
