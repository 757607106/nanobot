"""Tests for /stop task cancellation."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _make_loop():
    """Create a minimal AgentLoop with mocked dependencies."""
    from nanobot.agent.loop import AgentLoop
    from nanobot.bus.queue import MessageBus

    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    workspace = MagicMock()
    workspace.__truediv__ = MagicMock(return_value=MagicMock())

    with patch("nanobot.agent.loop.ContextBuilder"), \
         patch("nanobot.agent.loop.SessionManager"), \
         patch("nanobot.agent.loop.SubagentManager") as MockSubMgr:
        MockSubMgr.return_value.cancel_by_session = AsyncMock(return_value=0)
        loop = AgentLoop(bus=bus, provider=provider, workspace=workspace)
    return loop, bus


class TestHandleStop:
    @pytest.mark.asyncio
    async def test_stop_no_active_task(self):
        from nanobot.bus.events import InboundMessage

        loop, bus = _make_loop()
        msg = InboundMessage(channel="test", sender_id="u1", chat_id="c1", content="/stop")
        await loop._handle_stop(msg)
        out = await asyncio.wait_for(bus.consume_outbound(), timeout=1.0)
        assert "No active task" in out.content

    @pytest.mark.asyncio
    async def test_stop_cancels_active_task(self):
        from nanobot.bus.events import InboundMessage

        loop, bus = _make_loop()
        cancelled = asyncio.Event()

        async def slow_task():
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                cancelled.set()
                raise

        task = asyncio.create_task(slow_task())
        await asyncio.sleep(0)
        loop._active_tasks["test:c1"] = [task]

        msg = InboundMessage(channel="test", sender_id="u1", chat_id="c1", content="/stop")
        await loop._handle_stop(msg)

        assert cancelled.is_set()
        out = await asyncio.wait_for(bus.consume_outbound(), timeout=1.0)
        assert "stopped" in out.content.lower()

    @pytest.mark.asyncio
    async def test_stop_cancels_multiple_tasks(self):
        from nanobot.bus.events import InboundMessage

        loop, bus = _make_loop()
        events = [asyncio.Event(), asyncio.Event()]

        async def slow(idx):
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                events[idx].set()
                raise

        tasks = [asyncio.create_task(slow(i)) for i in range(2)]
        await asyncio.sleep(0)
        loop._active_tasks["test:c1"] = tasks

        msg = InboundMessage(channel="test", sender_id="u1", chat_id="c1", content="/stop")
        await loop._handle_stop(msg)

        assert all(e.is_set() for e in events)
        out = await asyncio.wait_for(bus.consume_outbound(), timeout=1.0)
        assert "2 task" in out.content


class TestDispatch:
    @pytest.mark.asyncio
    async def test_dispatch_processes_and_publishes(self):
        from nanobot.bus.events import InboundMessage, OutboundMessage

        loop, bus = _make_loop()
        msg = InboundMessage(channel="test", sender_id="u1", chat_id="c1", content="hello")
        loop._process_message = AsyncMock(
            return_value=OutboundMessage(channel="test", chat_id="c1", content="hi")
        )
        await loop._dispatch(msg)
        out = await asyncio.wait_for(bus.consume_outbound(), timeout=1.0)
        assert out.content == "hi"

    @pytest.mark.asyncio
    async def test_processing_lock_serializes(self):
        from nanobot.bus.events import InboundMessage, OutboundMessage

        loop, bus = _make_loop()
        order = []

        async def mock_process(m, **kwargs):
            order.append(f"start-{m.content}")
            await asyncio.sleep(0.05)
            order.append(f"end-{m.content}")
            return OutboundMessage(channel="test", chat_id="c1", content=m.content)

        loop._process_message = mock_process
        msg1 = InboundMessage(channel="test", sender_id="u1", chat_id="c1", content="a")
        msg2 = InboundMessage(channel="test", sender_id="u1", chat_id="c1", content="b")

        t1 = asyncio.create_task(loop._dispatch(msg1))
        t2 = asyncio.create_task(loop._dispatch(msg2))
        await asyncio.gather(t1, t2)
        assert order == ["start-a", "end-a", "start-b", "end-b"]


class TestSubagentCancellation:
    @pytest.mark.asyncio
    async def test_cancel_by_session(self):
        from nanobot.agent.subagent import SubagentManager
        from nanobot.bus.queue import MessageBus
        from nanobot.harness import ChildTaskRequest, ChildTaskResult

        bus = MessageBus()
        provider = MagicMock()
        provider.get_default_model.return_value = "test-model"
        mgr = SubagentManager(provider=provider, workspace=MagicMock(), bus=bus)

        cancelled = asyncio.Event()
        started = asyncio.Event()

        async def slow(handle):
            try:
                started.set()
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                cancelled.set()
                return ChildTaskResult(
                    status="cancelled",
                    content="Cancelled",
                    task=handle.request.task,
                    label=handle.request.resolved_label(),
                    principal_kind=handle.request.principal_kind,
                    principal_id=handle.request.principal_id,
                    agent_id=handle.request.agent_id,
                    team_id=handle.request.team_id,
                    thread_id=handle.request.thread_id,
                    run_id="sub-1",
                    session_key=handle.request.resolved_session_key(),
                    session_id=handle.request.resolved_session_id(),
                    origin_channel=handle.request.origin_channel,
                    origin_chat_id=handle.request.origin_chat_id,
                    metadata={"runStatus": "cancelled"},
                )
            raise AssertionError("task should have been cancelled")

        await mgr._child_runtime.start(
            ChildTaskRequest(
                task="inspect repo",
                label="Inspect repo",
                principal_kind="subagent",
                session_key="test:c1",
                origin_channel="test",
                origin_chat_id="c1",
            ),
            executor=slow,
            run_id="sub-1",
        )
        await asyncio.wait_for(started.wait(), timeout=1.0)

        count = await mgr.cancel_by_session("test:c1")
        assert count == 1
        assert cancelled.is_set()

    @pytest.mark.asyncio
    async def test_cancel_by_session_no_tasks(self):
        from nanobot.agent.subagent import SubagentManager
        from nanobot.bus.queue import MessageBus

        bus = MessageBus()
        provider = MagicMock()
        provider.get_default_model.return_value = "test-model"
        mgr = SubagentManager(provider=provider, workspace=MagicMock(), bus=bus)
        assert await mgr.cancel_by_session("nonexistent") == 0

    def test_subagent_tool_registry_is_explicit(self, tmp_path):
        from nanobot.agent.subagent import SubagentManager
        from nanobot.bus.queue import MessageBus

        bus = MessageBus()
        provider = MagicMock()
        provider.get_default_model.return_value = "test-model"
        mgr = SubagentManager(provider=provider, workspace=tmp_path, bus=bus)

        tools = mgr._build_tool_registry()

        assert set(tools.tool_names) == {
            "read_file",
            "write_file",
            "edit_file",
            "list_dir",
            "exec",
            "web_search",
            "web_fetch",
        }

    @pytest.mark.asyncio
    async def test_subagent_preserves_reasoning_fields_in_tool_turn(self, monkeypatch, tmp_path):
        from nanobot.agent.subagent import SubagentManager
        from nanobot.bus.queue import MessageBus
        from nanobot.harness import ChildTaskHandle, ChildTaskRequest
        from nanobot.providers.base import LLMResponse, ToolCallRequest

        bus = MessageBus()
        provider = MagicMock()
        provider.get_default_model.return_value = "test-model"

        captured_second_call: list[dict] = []

        call_count = {"n": 0}

        async def scripted_chat_with_retry(*, messages, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return LLMResponse(
                    content="thinking",
                    tool_calls=[ToolCallRequest(id="call_1", name="list_dir", arguments={})],
                    reasoning_content="hidden reasoning",
                    thinking_blocks=[{"type": "thinking", "thinking": "step"}],
                )
            captured_second_call[:] = messages
            return LLMResponse(content="done", tool_calls=[])
        provider.chat_with_retry = scripted_chat_with_retry
        mgr = SubagentManager(provider=provider, workspace=tmp_path, bus=bus)

        async def fake_execute(self, name, arguments):
            return "tool result"

        monkeypatch.setattr("nanobot.agent.tools.registry.ToolRegistry.execute", fake_execute)

        await mgr._execute_subagent_child_task(
            ChildTaskHandle(
                request=ChildTaskRequest(
                    task="do task",
                    label="label",
                    principal_kind="subagent",
                    session_key="test:c1",
                    origin_channel="test",
                    origin_chat_id="c1",
                ),
                run_id="sub-1",
            ),
            origin={"channel": "test", "chat_id": "c1", "session_key": "test:c1"},
        )

        assistant_messages = [
            msg for msg in captured_second_call
            if msg.get("role") == "assistant" and msg.get("tool_calls")
        ]
        assert len(assistant_messages) == 1
        assert assistant_messages[0]["reasoning_content"] == "hidden reasoning"
        assert assistant_messages[0]["thinking_blocks"] == [{"type": "thinking", "thinking": "step"}]

    @pytest.mark.asyncio
    async def test_spawn_tool_preserves_thread_scoped_session_key(self):
        from nanobot.agent.tools.spawn import SpawnTool

        manager = SimpleNamespace(spawn=AsyncMock(return_value="started"))
        tool = SpawnTool(manager)
        tool.set_context("telegram", "42", session_key="telegram:42:topic:99")
        tool.set_run_context(
            {
                "run_id": "run-1",
                "root_run_id": "run-1",
                "tenant_id": "tenant-a",
                "instance_id": "instance-a",
                "thread_id": "thread-1",
                "agent_id": "agent-1",
                "team_id": None,
                "spawn_depth": 0,
            }
        )

        result = await tool.execute("inspect the topic", label="topic task")

        assert result == "started"
        manager.spawn.assert_awaited_once_with(
            task="inspect the topic",
            label="topic task",
            origin_channel="telegram",
            origin_chat_id="42",
            session_key="telegram:42:topic:99",
            parent_run_id="run-1",
            root_run_id="run-1",
            thread_id="thread-1",
            agent_id="agent-1",
            team_id=None,
            tenant_id="tenant-a",
            instance_id="instance-a",
            spawn_depth=1,
        )

    @pytest.mark.asyncio
    async def test_spawn_tool_prefers_structured_child_task_runtime(self):
        from nanobot.agent.tools.spawn import SpawnTool
        from nanobot.harness import ChildTaskRequest

        manager = SimpleNamespace(spawn_child_task=AsyncMock(return_value="started"))
        tool = SpawnTool(manager)
        tool.set_context("telegram", "42", session_key="telegram:42:topic:99")
        tool.set_run_context(
            {
                "run_id": "run-1",
                "root_run_id": "run-1",
                "tenant_id": "tenant-a",
                "instance_id": "instance-a",
                "thread_id": "thread-1",
                "agent_id": "agent-1",
                "team_id": "team-1",
                "spawn_depth": 0,
            }
        )

        result = await tool.execute("inspect the topic", label="topic task")

        assert result == "started"
        manager.spawn_child_task.assert_awaited_once()
        request = manager.spawn_child_task.await_args.args[0]
        assert isinstance(request, ChildTaskRequest)
        assert request.task == "inspect the topic"
        assert request.label == "topic task"
        assert request.tenant_id == "tenant-a"
        assert request.instance_id == "instance-a"
        assert request.agent_id == "agent-1"
        assert request.team_id == "team-1"
        assert request.thread_id == "thread-1"
        assert request.session_key == "telegram:42:topic:99"
        assert request.parent_run_id == "run-1"
        assert request.root_run_id == "run-1"
        assert request.spawn_depth == 1

    @pytest.mark.asyncio
    async def test_structured_subagent_result_uses_parent_session_without_polluting_history(self, tmp_path: Path):
        from nanobot.agent.loop import AgentLoop
        from nanobot.agent.subagent_protocol import build_subagent_result_metadata
        from nanobot.bus.events import InboundMessage
        from nanobot.bus.queue import MessageBus
        from nanobot.providers.base import LLMResponse

        bus = MessageBus()
        provider = MagicMock()
        provider.get_default_model.return_value = "test-model"
        captured_messages: dict[str, list[dict]] = {}

        async def scripted_chat_with_retry(*, messages, **kwargs):
            _ = kwargs
            captured_messages["messages"] = messages
            return LLMResponse(content="Wrapped up for the user", tool_calls=[])

        provider.chat_with_retry = scripted_chat_with_retry
        loop = AgentLoop(bus=bus, provider=provider, workspace=tmp_path)

        msg = InboundMessage(
            channel="system",
            sender_id="subagent",
            chat_id="telegram:42",
            content="legacy content should be ignored",
            metadata=build_subagent_result_metadata(
                task_id="sub-1",
                label="topic task",
                task="inspect the thread context",
                result="found the answer in the topic history",
                status="ok",
                origin_channel="telegram",
                origin_chat_id="42",
                session_key="telegram:42:topic:99",
            ),
            session_key_override="telegram:42:topic:99",
        )

        response = await loop._process_message(msg)

        assert response is not None
        assert response.channel == "telegram"
        assert response.chat_id == "42"
        assert response.content == "Wrapped up for the user"

        prompt_message = next(msg for msg in reversed(captured_messages["messages"]) if msg.get("role") == "user")
        assert prompt_message["role"] == "user"
        assert "A background task you delegated has finished." in prompt_message["content"]
        assert "inspect the thread context" in prompt_message["content"]
        assert "found the answer in the topic history" in prompt_message["content"]
        assert "legacy content should be ignored" not in prompt_message["content"]

        session = loop.sessions.get_or_create("telegram:42:topic:99")
        assert [item["role"] for item in session.messages] == ["assistant"]
        assert session.messages[0]["content"] == "Wrapped up for the user"

        await loop.close_mcp()
