import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.agent.context import ContextBuilder
from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import InboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.session.manager import Session


def _mk_loop() -> AgentLoop:
    loop = AgentLoop.__new__(AgentLoop)
    from nanobot.config.schema import AgentDefaults

    loop.max_tool_result_chars = AgentDefaults().max_tool_result_chars
    return loop


def _make_full_loop(tmp_path: Path) -> AgentLoop:
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    return AgentLoop(bus=MessageBus(), provider=provider, workspace=tmp_path, model="test-model")


def test_save_turn_skips_multimodal_user_when_only_runtime_context() -> None:
    loop = _mk_loop()
    session = Session(key="test:runtime-only")
    runtime = ContextBuilder._RUNTIME_CONTEXT_TAG + "\nCurrent Time: now (UTC)"

    loop._save_turn(
        session,
        [{"role": "user", "content": [{"type": "text", "text": runtime}]}],
        skip=0,
    )
    assert session.messages == []


def test_save_turn_keeps_image_placeholder_with_path_after_runtime_strip() -> None:
    loop = _mk_loop()
    session = Session(key="test:image")
    runtime = ContextBuilder._RUNTIME_CONTEXT_TAG + "\nCurrent Time: now (UTC)"

    loop._save_turn(
        session,
        [{
            "role": "user",
            "content": [
                {"type": "text", "text": runtime},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}, "_meta": {"path": "/media/feishu/photo.jpg"}},
            ],
        }],
        skip=0,
    )
    assert session.messages[0]["content"] == [{"type": "text", "text": "[image: /media/feishu/photo.jpg]"}]


def test_save_turn_keeps_image_placeholder_without_meta() -> None:
    loop = _mk_loop()
    session = Session(key="test:image-no-meta")
    runtime = ContextBuilder._RUNTIME_CONTEXT_TAG + "\nCurrent Time: now (UTC)"

    loop._save_turn(
        session,
        [{
            "role": "user",
            "content": [
                {"type": "text", "text": runtime},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        }],
        skip=0,
    )
    assert session.messages[0]["content"] == [{"type": "text", "text": "[image]"}]


def test_save_turn_keeps_tool_results_under_16k() -> None:
    loop = _mk_loop()
    session = Session(key="test:tool-result")
    content = "x" * 12_000

    loop._save_turn(
        session,
        [{"role": "tool", "tool_call_id": "call_1", "name": "read_file", "content": content}],
        skip=0,
    )

    assert session.messages[0]["content"] == content


def test_restore_runtime_checkpoint_rehydrates_completed_and_pending_tools() -> None:
    loop = _mk_loop()
    session = Session(
        key="test:checkpoint",
        metadata={
            AgentLoop._RUNTIME_CHECKPOINT_KEY: {
                "assistant_message": {
                    "role": "assistant",
                    "content": "working",
                    "tool_calls": [
                        {
                            "id": "call_done",
                            "type": "function",
                            "function": {"name": "read_file", "arguments": "{}"},
                        },
                        {
                            "id": "call_pending",
                            "type": "function",
                            "function": {"name": "exec", "arguments": "{}"},
                        },
                    ],
                },
                "completed_tool_results": [
                    {
                        "role": "tool",
                        "tool_call_id": "call_done",
                        "name": "read_file",
                        "content": "ok",
                    }
                ],
                "pending_tool_calls": [
                    {
                        "id": "call_pending",
                        "type": "function",
                        "function": {"name": "exec", "arguments": "{}"},
                    }
                ],
            }
        },
    )

    restored = loop._restore_runtime_checkpoint(session)

    assert restored is True
    assert session.metadata.get(AgentLoop._RUNTIME_CHECKPOINT_KEY) is None
    assert session.messages[0]["role"] == "assistant"
    assert session.messages[1]["tool_call_id"] == "call_done"
    assert session.messages[2]["tool_call_id"] == "call_pending"
    assert "interrupted before this tool finished" in session.messages[2]["content"].lower()


def test_restore_runtime_checkpoint_dedupes_overlapping_tail() -> None:
    loop = _mk_loop()
    session = Session(
        key="test:checkpoint-overlap",
        messages=[
            {
                "role": "assistant",
                "content": "working",
                "tool_calls": [
                    {
                        "id": "call_done",
                        "type": "function",
                        "function": {"name": "read_file", "arguments": "{}"},
                    },
                    {
                        "id": "call_pending",
                        "type": "function",
                        "function": {"name": "exec", "arguments": "{}"},
                    },
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "call_done",
                "name": "read_file",
                "content": "ok",
            },
        ],
        metadata={
            AgentLoop._RUNTIME_CHECKPOINT_KEY: {
                "assistant_message": {
                    "role": "assistant",
                    "content": "working",
                    "tool_calls": [
                        {
                            "id": "call_done",
                            "type": "function",
                            "function": {"name": "read_file", "arguments": "{}"},
                        },
                        {
                            "id": "call_pending",
                            "type": "function",
                            "function": {"name": "exec", "arguments": "{}"},
                        },
                    ],
                },
                "completed_tool_results": [
                    {
                        "role": "tool",
                        "tool_call_id": "call_done",
                        "name": "read_file",
                        "content": "ok",
                    }
                ],
                "pending_tool_calls": [
                    {
                        "id": "call_pending",
                        "type": "function",
                        "function": {"name": "exec", "arguments": "{}"},
                    }
                ],
            }
        },
    )

    restored = loop._restore_runtime_checkpoint(session)

    assert restored is True
    assert session.metadata.get(AgentLoop._RUNTIME_CHECKPOINT_KEY) is None
    assert len(session.messages) == 3
    assert session.messages[0]["role"] == "assistant"
    assert session.messages[1]["tool_call_id"] == "call_done"
    assert session.messages[2]["tool_call_id"] == "call_pending"


@pytest.mark.asyncio
async def test_process_message_persists_user_message_before_turn_completes(tmp_path: Path) -> None:
    loop = _make_full_loop(tmp_path)
    loop.consolidator.maybe_consolidate_by_tokens = AsyncMock(return_value=False)  # type: ignore[method-assign]
    loop._run_agent_loop = AsyncMock(side_effect=RuntimeError("boom"))  # type: ignore[method-assign]

    msg = InboundMessage(channel="feishu", sender_id="u1", chat_id="c1", content="persist me")
    with pytest.raises(RuntimeError, match="boom"):
        await loop._process_message(msg)

    loop.sessions.invalidate("feishu:c1")
    persisted = loop.sessions.get_or_create("feishu:c1")
    assert [m["role"] for m in persisted.messages] == ["user"]
    assert persisted.messages[0]["content"] == "persist me"
    assert persisted.metadata.get(AgentLoop._PENDING_USER_TURN_KEY) is True
    assert persisted.updated_at >= persisted.created_at


@pytest.mark.asyncio
async def test_process_direct_records_uncontended_session_execution_metrics(tmp_path: Path) -> None:
    loop = _make_full_loop(tmp_path)
    loop.turn_maintenance.schedule_after_user_turn = MagicMock()

    async def fake_run(initial_messages, **_kwargs):
        return (
            "reply",
            None,
            [*initial_messages, {"role": "assistant", "content": "reply"}],
            "stop",
            False,
        )

    loop._run_agent_loop = fake_run  # type: ignore[method-assign]

    seen_events: list[tuple[str, dict[str, object]]] = []

    async def event_sink(event_type: str, payload: dict[str, object]) -> None:
        seen_events.append((event_type, payload))

    run_context: dict[str, object] = {"run_event_sink": event_sink}
    response = await loop.process_direct(
        "hello",
        session_key="cli:metrics",
        run_context=run_context,
    )

    assert response is not None
    assert response.content == "reply"
    metrics = run_context["session_execution"]
    assert isinstance(metrics, dict)
    assert metrics["sessionKey"] == "cli:metrics"
    assert metrics["queued"] is False
    assert float(metrics["waitMs"]) >= 0.0
    assert seen_events == []


@pytest.mark.asyncio
async def test_process_message_does_not_duplicate_early_persisted_user_message(tmp_path: Path) -> None:
    loop = _make_full_loop(tmp_path)
    loop.consolidator.maybe_consolidate_by_tokens = AsyncMock(return_value=False)  # type: ignore[method-assign]
    loop._run_agent_loop = AsyncMock(return_value=(
        "done",
        None,
        [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "done"},
        ],
        "stop",
        False,
    ))  # type: ignore[method-assign]

    result = await loop._process_message(
        InboundMessage(channel="feishu", sender_id="u1", chat_id="c2", content="hello")
    )

    assert result is not None
    assert result.content == "done"
    session = loop.sessions.get_or_create("feishu:c2")
    assert [
        {k: v for k, v in m.items() if k in {"role", "content"}}
        for m in session.messages
    ] == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "done"},
    ]
    assert AgentLoop._PENDING_USER_TURN_KEY not in session.metadata


@pytest.mark.asyncio
async def test_next_turn_after_crash_closes_pending_user_turn_before_new_input(tmp_path: Path) -> None:
    loop = _make_full_loop(tmp_path)
    loop.consolidator.maybe_consolidate_by_tokens = AsyncMock(return_value=False)  # type: ignore[method-assign]
    loop.provider.chat_with_retry = AsyncMock(return_value=MagicMock())  # unused because _run_agent_loop is stubbed

    session = loop.sessions.get_or_create("feishu:c3")
    session.add_message("user", "old question")
    session.metadata[AgentLoop._PENDING_USER_TURN_KEY] = True
    loop.sessions.save(session)

    loop._run_agent_loop = AsyncMock(return_value=(
        "new answer",
        None,
        [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "old question"},
            {"role": "assistant", "content": "Error: Task interrupted before a response was generated."},
            {"role": "user", "content": "new question"},
            {"role": "assistant", "content": "new answer"},
        ],
        "stop",
        False,
    ))  # type: ignore[method-assign]

    result = await loop._process_message(
        InboundMessage(channel="feishu", sender_id="u1", chat_id="c3", content="new question")
    )

    assert result is not None
    assert result.content == "new answer"
    session = loop.sessions.get_or_create("feishu:c3")
    assert [
        {k: v for k, v in m.items() if k in {"role", "content"}}
        for m in session.messages
    ] == [
        {"role": "user", "content": "old question"},
        {"role": "assistant", "content": "Error: Task interrupted before a response was generated."},
        {"role": "user", "content": "new question"},
        {"role": "assistant", "content": "new answer"},
    ]
    assert AgentLoop._PENDING_USER_TURN_KEY not in session.metadata


@pytest.mark.asyncio
async def test_stop_preserves_runtime_checkpoint_for_next_turn(tmp_path: Path) -> None:
    from nanobot.command.builtin import cmd_stop
    from nanobot.command.router import CommandContext

    loop = _make_full_loop(tmp_path)
    loop.consolidator.maybe_consolidate_by_tokens = AsyncMock(return_value=False)  # type: ignore[method-assign]

    checkpoint_saved = asyncio.Event()

    async def interrupted_run_agent_loop(_initial_messages, *, session=None, **_kwargs):
        assert session is not None
        loop._set_runtime_checkpoint(
            session,
            {
                "assistant_message": {
                    "role": "assistant",
                    "content": "working",
                    "tool_calls": [
                        {
                            "id": "call_done",
                            "type": "function",
                            "function": {"name": "read_file", "arguments": "{}"},
                        },
                        {
                            "id": "call_pending",
                            "type": "function",
                            "function": {"name": "exec", "arguments": "{}"},
                        },
                    ],
                },
                "completed_tool_results": [
                    {
                        "role": "tool",
                        "tool_call_id": "call_done",
                        "name": "read_file",
                        "content": "ok",
                    }
                ],
                "pending_tool_calls": [
                    {
                        "id": "call_pending",
                        "type": "function",
                        "function": {"name": "exec", "arguments": "{}"},
                    }
                ],
            },
        )
        checkpoint_saved.set()
        await asyncio.Event().wait()

    loop._run_agent_loop = interrupted_run_agent_loop  # type: ignore[method-assign]

    first_msg = InboundMessage(channel="feishu", sender_id="u1", chat_id="c4", content="keep progress")
    task = asyncio.create_task(loop._process_message(first_msg))
    loop._active_tasks[first_msg.session_key] = [task]
    await asyncio.wait_for(checkpoint_saved.wait(), timeout=1.0)

    stop_msg = InboundMessage(channel="feishu", sender_id="u1", chat_id="c4", content="/stop")
    stop_ctx = CommandContext(msg=stop_msg, session=None, key=stop_msg.session_key, raw="/stop", loop=loop)
    stop_result = await cmd_stop(stop_ctx)

    assert "Stopped 1 task" in stop_result.content
    assert task.done()

    loop.sessions.invalidate("feishu:c4")
    interrupted = loop.sessions.get_or_create("feishu:c4")
    assert interrupted.metadata.get(AgentLoop._PENDING_USER_TURN_KEY) is True
    assert interrupted.metadata.get(AgentLoop._RUNTIME_CHECKPOINT_KEY) is not None

    async def resumed_run_agent_loop(initial_messages, **_kwargs):
        return (
            "next answer",
            None,
            [*initial_messages, {"role": "assistant", "content": "next answer"}],
            "stop",
            False,
        )

    loop._run_agent_loop = resumed_run_agent_loop  # type: ignore[method-assign]
    result = await loop._process_message(
        InboundMessage(channel="feishu", sender_id="u1", chat_id="c4", content="continue here")
    )

    assert result is not None
    assert result.content == "next answer"

    session = loop.sessions.get_or_create("feishu:c4")
    assert [
        {k: v for k, v in m.items() if k in {"role", "content", "tool_call_id", "name"}}
        for m in session.messages
    ] == [
        {"role": "user", "content": "keep progress"},
        {"role": "assistant", "content": "working"},
        {"role": "tool", "tool_call_id": "call_done", "name": "read_file", "content": "ok"},
        {
            "role": "tool",
            "tool_call_id": "call_pending",
            "name": "exec",
            "content": "Error: Task interrupted before this tool finished.",
        },
        {"role": "user", "content": "continue here"},
        {"role": "assistant", "content": "next answer"},
    ]


@pytest.mark.asyncio
async def test_process_direct_serializes_same_session_across_loops(tmp_path: Path) -> None:
    first_loop = _make_full_loop(tmp_path)
    second_loop = _make_full_loop(tmp_path)
    first_loop.turn_maintenance.prepare_session = AsyncMock(return_value=None)
    first_loop.turn_maintenance.schedule_after_user_turn = MagicMock()
    first_loop.turn_maintenance.schedule_after_system_turn = MagicMock()
    second_loop.turn_maintenance.prepare_session = AsyncMock(return_value=None)
    second_loop.turn_maintenance.schedule_after_user_turn = MagicMock()
    second_loop.turn_maintenance.schedule_after_system_turn = MagicMock()
    session_key = "web:shared"
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    second_seen_history: list[list[dict[str, str]]] = []

    async def first_run(initial_messages, **_kwargs):
        first_started.set()
        await release_first.wait()
        return (
            "reply first",
            None,
            [*initial_messages, {"role": "assistant", "content": "reply first"}],
            "stop",
            False,
        )

    async def second_run(initial_messages, **_kwargs):
        second_seen_history.append(
            [
                {"role": str(message.get("role")), "content": str(message.get("content"))}
                for message in initial_messages
                if message.get("role") in {"user", "assistant"}
            ]
        )
        return (
            "reply second",
            None,
            [*initial_messages, {"role": "assistant", "content": "reply second"}],
            "stop",
            False,
        )

    first_loop._run_agent_loop = first_run  # type: ignore[method-assign]
    second_loop._run_agent_loop = second_run  # type: ignore[method-assign]

    first_task = asyncio.create_task(first_loop.process_direct("first", session_key=session_key))
    await asyncio.wait_for(first_started.wait(), timeout=1.0)

    second_task = asyncio.create_task(second_loop.process_direct("second", session_key=session_key))
    await asyncio.sleep(0.05)
    assert not second_task.done()

    release_first.set()
    await asyncio.gather(first_task, second_task)

    reloaded = second_loop.sessions.get_or_create(session_key)
    assert [
        {k: v for k, v in message.items() if k in {"role", "content"}}
        for message in reloaded.messages
    ] == [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "reply first"},
        {"role": "user", "content": "second"},
        {"role": "assistant", "content": "reply second"},
    ]
    assert second_seen_history[0][:2] == [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "reply first"},
    ]
    assert second_seen_history[0][-1]["role"] == "user"
    assert second_seen_history[0][-1]["content"].endswith("second")
    assert AgentLoop._PENDING_USER_TURN_KEY not in reloaded.metadata
    assert AgentLoop._RUNTIME_CHECKPOINT_KEY not in reloaded.metadata


@pytest.mark.asyncio
async def test_same_session_wait_emits_queue_observation_event(tmp_path: Path) -> None:
    shared_sessions = _make_full_loop(tmp_path).sessions
    first_loop = _make_full_loop(tmp_path)
    second_loop = _make_full_loop(tmp_path)
    first_loop.sessions = shared_sessions
    second_loop.sessions = shared_sessions
    first_loop.turn_maintenance.prepare_session = AsyncMock(return_value=None)
    first_loop.turn_maintenance.schedule_after_user_turn = MagicMock()
    second_loop.turn_maintenance.prepare_session = AsyncMock(return_value=None)
    second_loop.turn_maintenance.schedule_after_user_turn = MagicMock()

    first_started = asyncio.Event()
    release_first = asyncio.Event()

    async def first_run(initial_messages, **_kwargs):
        first_started.set()
        await release_first.wait()
        return (
            "reply first",
            None,
            [*initial_messages, {"role": "assistant", "content": "reply first"}],
            "stop",
            False,
        )

    async def second_run(initial_messages, **_kwargs):
        return (
            "reply second",
            None,
            [*initial_messages, {"role": "assistant", "content": "reply second"}],
            "stop",
            False,
        )

    first_loop._run_agent_loop = first_run  # type: ignore[method-assign]
    second_loop._run_agent_loop = second_run  # type: ignore[method-assign]

    seen_events: list[tuple[str, dict[str, object]]] = []

    async def event_sink(event_type: str, payload: dict[str, object]) -> None:
        seen_events.append((event_type, payload))

    session_key = "web:queued-metrics"
    first_task = asyncio.create_task(first_loop.process_direct("first", session_key=session_key))
    await asyncio.wait_for(first_started.wait(), timeout=1.0)

    run_context: dict[str, object] = {"run_event_sink": event_sink}
    second_task = asyncio.create_task(
        second_loop.process_direct(
            "second",
            session_key=session_key,
            run_context=run_context,
        )
    )
    await asyncio.sleep(0.05)
    assert not second_task.done()

    release_first.set()
    await asyncio.gather(first_task, second_task)

    metrics = run_context["session_execution"]
    assert isinstance(metrics, dict)
    assert metrics["sessionKey"] == session_key
    assert metrics["queued"] is True
    assert float(metrics["waitMs"]) >= 40.0
    assert seen_events
    event_type, payload = seen_events[0]
    assert event_type == "session_execution_queued"
    assert payload["sessionKey"] == session_key
    assert payload["queued"] is True
