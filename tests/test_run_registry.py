from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from nanobot.platform.runs import (
    RunControlScope,
    RunKind,
    RunLimitExceededError,
    RunLimits,
    RunResultSummary,
    RunService,
    RunStore,
)


def test_run_service_lifecycle_and_tree(tmp_path) -> None:
    service = RunService(RunStore(tmp_path / "runs.db"), instance_id="instance-test")

    parent = service.create_run(
        kind=RunKind.AGENT,
        label="Primary run",
        task_preview="Coordinate the task",
        session_key="web:session-1",
    )
    child = service.create_run(
        kind=RunKind.SUBAGENT,
        label="Research",
        task_preview="Gather supporting facts",
        session_key="web:session-1",
        parent_run_id=parent.run_id,
        root_run_id=parent.run_id,
        spawn_depth=1,
        control_scope=RunControlScope.CHILD,
    )

    service.start_run(parent.run_id)
    service.start_run(child.run_id)
    service.complete_run(
        child.run_id,
        RunResultSummary(content="Finished", tools_used=["web_search"]),
    )

    detail = service.get_run(child.run_id)
    assert detail["runId"] == child.run_id
    assert detail["status"] == "succeeded"
    assert detail["resultSummary"]["content"] == "Finished"
    assert detail["resultSummary"]["tools_used"] == ["web_search"]
    assert [event["eventType"] for event in detail["events"]] == ["queued", "started", "completed"]

    children = service.list_children(parent.run_id)
    assert len(children) == 1
    assert children[0]["runId"] == child.run_id

    tree = service.get_run_tree(parent.run_id)
    assert tree["runId"] == parent.run_id
    assert len(tree["children"]) == 1
    assert tree["children"][0]["runId"] == child.run_id


def test_run_service_limit_checks(tmp_path) -> None:
    service = RunService(
        RunStore(tmp_path / "limits.db"),
        instance_id="instance-test",
        limits=RunLimits(
            max_global_running=1,
            max_running_per_session=1,
            max_children_per_parent=1,
            max_spawn_depth=0,
        ),
    )

    top = service.create_run(
        kind=RunKind.SUBAGENT,
        label="Top",
        task_preview="Top task",
        session_key="web:session-1",
    )
    service.start_run(top.run_id)

    with pytest.raises(RunLimitExceededError):
        service.check_limits(session_key="web:session-2", parent_run_id=None, spawn_depth=0)

    with pytest.raises(RunLimitExceededError):
        service.check_limits(session_key="web:session-1", parent_run_id=None, spawn_depth=0)

    with pytest.raises(RunLimitExceededError):
        service.check_limits(session_key="web:session-1", parent_run_id=None, spawn_depth=1)

    relaxed = RunService(
        RunStore(tmp_path / "fanout.db"),
        instance_id="instance-test",
        limits=RunLimits(
            max_global_running=10,
            max_running_per_session=10,
            max_children_per_parent=1,
            max_spawn_depth=2,
        ),
    )
    parent = relaxed.create_run(
        kind=RunKind.AGENT,
        label="Parent",
        task_preview="Parent task",
        session_key="web:session-4",
    )
    child = relaxed.create_run(
        kind=RunKind.SUBAGENT,
        label="Child",
        task_preview="Child task",
        session_key="web:session-4",
        parent_run_id=parent.run_id,
        root_run_id=parent.run_id,
    )
    relaxed.start_run(child.run_id)

    with pytest.raises(RunLimitExceededError):
        relaxed.check_limits(
            session_key="web:session-4",
            parent_run_id=parent.run_id,
            spawn_depth=1,
        )


@pytest.mark.asyncio
async def test_subagent_manager_records_run_lifecycle(tmp_path) -> None:
    from nanobot.agent.subagent import SubagentManager
    from nanobot.bus.queue import MessageBus
    from nanobot.providers.base import LLMResponse

    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"

    async def scripted_chat_with_retry(*, messages, **kwargs):
        _ = messages, kwargs
        return LLMResponse(content="Subagent finished", tool_calls=[])

    provider.chat_with_retry = scripted_chat_with_retry
    runs = RunService(RunStore(tmp_path / "runtime.db"), instance_id="instance-test")
    manager = SubagentManager(
        provider=provider,
        workspace=tmp_path,
        bus=bus,
        run_registry=runs,
    )

    result_text = await manager.spawn(
        task="Inspect the repository",
        label="Inspect repo",
        origin_channel="web",
        origin_chat_id="chat-1",
        session_key="web:chat-1",
    )
    assert "Inspect repo" in result_text

    listed = runs.list_runs(limit=10)
    assert len(listed) == 1
    run_id = listed[0]["runId"]

    for _ in range(50):
        record = runs.get_run(run_id)
        if record["status"] == "succeeded":
            break
        await asyncio.sleep(0.02)
    else:
        pytest.fail("subagent run did not finish in time")

    record = runs.get_run(run_id)
    assert record["status"] == "succeeded"
    assert record["sessionKey"] == "web:chat-1"
    assert record["resultSummary"]["content"] == "Subagent finished"
    assert [event["eventType"] for event in record["events"]] == [
        "queued",
        "started",
        "completed",
        "announced",
    ]

    inbound = await asyncio.wait_for(bus.consume_inbound(), timeout=1.0)
    assert inbound.channel == "system"
    assert "Inspect the repository" in inbound.content
