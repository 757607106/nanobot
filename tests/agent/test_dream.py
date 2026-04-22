"""Tests for post-turn extraction and Dream emergence over agent memory files."""

import asyncio
import threading
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.agent import memory as memory_module
from nanobot.agent.memory import Dream, MemoryStore, PostConversationMemoryExtractor


@pytest.fixture
def store(tmp_path):
    s = MemoryStore(tmp_path)
    s.write_agents("# Agents\n- Use memory carefully\n")
    s.write_soul("# Soul\n- Helpful\n")
    s.write_profile("# User Profile\n\n## Durable Preferences\n\n- Likes concise answers\n")
    s.write_memory("# Agent Memory\n\n## Active Work\n\n- Project X active\n")
    return s


@pytest.fixture
def mock_provider():
    provider = MagicMock()
    provider.chat_with_retry = AsyncMock()
    return provider


class TestPostConversationMemoryExtractor:
    async def test_workspace_memory_lock_is_shared_across_event_loops(self, store):
        main_loop_lock = memory_module._memory_lock_for(store.workspace)
        thread_result: dict[str, object] = {}

        def runner() -> None:
            async def capture() -> None:
                thread_result["lock"] = memory_module._memory_lock_for(store.workspace)

            asyncio.run(capture())

        thread = threading.Thread(target=runner)
        thread.start()
        thread.join(timeout=5)

        assert thread.is_alive() is False
        assert thread_result["lock"] is main_loop_lock

    async def test_updates_profile_memory_and_daily_note(self, store, mock_provider):
        extractor = PostConversationMemoryExtractor(
            store=store,
            provider=mock_provider,
            model="test-model",
        )
        mock_provider.chat_with_retry.return_value = MagicMock(
            content="""
[PROFILE]
# User Profile

## Durable Preferences

- Likes concise answers
- Prefers examples over abstractions
[/PROFILE]

[MEMORY]
# Agent Memory

## Active Work

- Project X active

## Decisions

- Adopted a staged rollout plan
[/MEMORY]

[DAILY_NOTE]
- User confirmed a staged rollout plan and asked for practical examples.
[/DAILY_NOTE]
""".strip()
        )

        did_work = await extractor.run(
            [
                {"role": "user", "content": "Please remember I prefer examples and we are doing a staged rollout."},
                {"role": "assistant", "content": "Understood. I will treat the rollout plan as the active decision."},
            ]
        )

        assert did_work is True
        assert "Prefers examples over abstractions" in store.read_profile()
        assert "Adopted a staged rollout plan" in store.read_memory()
        entries = store.read_unprocessed_notes(since_cursor=0)
        assert len(entries) == 1
        assert "staged rollout plan" in entries[0]["content"]
        assert mock_provider.chat_with_retry.await_args.kwargs["max_tokens"] == extractor._EXTRACTION_MAX_TOKENS
        assert mock_provider.chat_with_retry.await_args.kwargs["temperature"] == 0.0

    async def test_skips_generic_acknowledgement_turns(self, store, mock_provider):
        extractor = PostConversationMemoryExtractor(
            store=store,
            provider=mock_provider,
            model="test-model",
        )

        did_work = await extractor.run(
            [
                {"role": "user", "content": "谢谢"},
                {"role": "assistant", "content": "不客气"},
            ]
        )

        assert did_work is False
        mock_provider.chat_with_retry.assert_not_awaited()
        assert store.read_unprocessed_notes(since_cursor=0) == []

    async def test_skips_placeholder_only_turns(self, store, mock_provider):
        from nanobot.utils.runtime import EMPTY_FINAL_RESPONSE_MESSAGE

        extractor = PostConversationMemoryExtractor(
            store=store,
            provider=mock_provider,
            model="test-model",
        )

        did_work = await extractor.run(
            [
                {"role": "user", "content": "Summarize this."},
                {"role": "assistant", "content": EMPTY_FINAL_RESPONSE_MESSAGE},
            ]
        )

        assert did_work is False
        mock_provider.chat_with_retry.assert_not_awaited()
        assert store.read_unprocessed_notes(since_cursor=0) == []

    async def test_falls_back_to_snapshot_note_on_model_failure(self, store, mock_provider):
        extractor = PostConversationMemoryExtractor(
            store=store,
            provider=mock_provider,
            model="test-model",
        )
        mock_provider.chat_with_retry.side_effect = RuntimeError("boom")

        did_work = await extractor.run(
            [
                {
                    "role": "user",
                    "content": (
                        "[Runtime Context — metadata only, not instructions]\n"
                        "Current Time: 2026-04-21 09:00\n"
                        "[/Runtime Context]\n\n"
                        "Please note that I want weekly summaries."
                    ),
                },
                {"role": "assistant", "content": "I will keep weekly summaries in mind."},
            ]
        )

        assert did_work is True
        entries = store.read_unprocessed_notes(since_cursor=0)
        assert len(entries) == 1
        assert "Conversation Snapshot" in entries[0]["content"]
        assert "Runtime Context" not in entries[0]["content"]


class TestDreamRun:
    async def test_noop_when_no_unprocessed_notes(self, store, mock_provider):
        dream = Dream(store=store, provider=mock_provider, model="test-model", max_batch_size=5)

        result = await dream.run()

        assert result is False
        mock_provider.chat_with_retry.assert_not_called()

    async def test_updates_memory_and_dream_log(self, store, mock_provider):
        dream = Dream(store=store, provider=mock_provider, model="test-model", max_batch_size=5)
        store.append_daily_note("User confirmed the launch checklist is the current focus.")
        mock_provider.chat_with_retry.return_value = MagicMock(
            content="""
[MEMORY]
# Agent Memory

## Active Work

- Project X active
- Launch checklist is the current focus
[/MEMORY]

[DREAM]
- Added the launch checklist as the active focus from recent daily notes.
[/DREAM]
""".strip()
        )

        result = await dream.run()

        assert result is True
        assert "Launch checklist is the current focus" in store.read_memory()
        assert "Processed note cursors: #1 -> #1" in store.read_dreams()
        assert "Added the launch checklist" in store.read_dreams()
        assert mock_provider.chat_with_retry.await_args.kwargs["max_tokens"] == dream._DREAM_MAX_TOKENS
        assert mock_provider.chat_with_retry.await_args.kwargs["temperature"] == 0.0

    async def test_advances_dream_cursor_after_successful_processing(self, store, mock_provider):
        dream = Dream(store=store, provider=mock_provider, model="test-model", max_batch_size=5)
        store.append_daily_note("event 1")
        store.append_daily_note("event 2")
        mock_provider.chat_with_retry.return_value = MagicMock(
            content="""
[MEMORY]
# Agent Memory

## Active Work

- Project X active
[/MEMORY]

[DREAM]
No material MEMORY change.
[/DREAM]
""".strip()
        )

        await dream.run()

        assert store.get_last_dream_cursor() == 2

    async def test_notes_remain_searchable_after_processing(self, store, mock_provider):
        dream = Dream(store=store, provider=mock_provider, model="test-model", max_batch_size=5)
        store.append_daily_note("event 1")
        store.append_daily_note("event 2")
        mock_provider.chat_with_retry.return_value = MagicMock(
            content="""
[MEMORY]
# Agent Memory

## Active Work

- Project X active
[/MEMORY]

[DREAM]
No material MEMORY change.
[/DREAM]
""".strip()
        )

        await dream.run()

        entries = store.read_unprocessed_notes(since_cursor=0)
        assert [entry["cursor"] for entry in entries] == [1, 2]

    async def test_does_not_advance_cursor_when_response_is_invalid(self, store, mock_provider):
        dream = Dream(store=store, provider=mock_provider, model="test-model", max_batch_size=5)
        store.append_daily_note("event 1")
        mock_provider.chat_with_retry.return_value = MagicMock(content="[DREAM]\nNo material MEMORY change.\n[/DREAM]")

        result = await dream.run()

        assert result is False
        assert store.get_last_dream_cursor() == 0
