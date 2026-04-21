"""Tests for the agent-root memory store."""

from datetime import datetime

import pytest

from nanobot.agent.memory import MemoryStore


@pytest.fixture
def store(tmp_path):
    return MemoryStore(tmp_path)


class TestMemoryStoreFiles:
    def test_readers_return_empty_when_missing(self, store):
        assert store.read_agents() == ""
        assert store.read_soul() == ""
        assert store.read_profile() == ""
        assert store.read_memory() == ""

    def test_writes_and_reads_root_memory_files(self, store):
        store.write_agents("agents")
        store.write_soul("soul")
        store.write_profile("profile")
        store.write_memory("memory")

        assert store.read_agents() == "agents"
        assert store.read_soul() == "soul"
        assert store.read_profile() == "profile"
        assert store.read_memory() == "memory"


class TestDailyNotes:
    def test_append_daily_note_returns_incrementing_cursor(self, store):
        first = store.append_daily_note("event 1")
        second = store.append_daily_note("event 2")

        assert first == 1
        assert second == 2

    def test_append_daily_note_writes_timestamped_markdown_sections(self, store):
        timestamp = datetime(2026, 4, 21, 9, 30)
        cursor = store.append_daily_note("hello world", timestamp=timestamp)

        note_file = store.note_file_for_date(timestamp)
        content = note_file.read_text(encoding="utf-8")
        assert cursor == 1
        assert "## 2026-04-21 09:30 [#1]" in content
        assert "hello world" in content

    def test_read_unprocessed_notes_filters_by_cursor(self, store):
        store.append_daily_note("event 1", timestamp=datetime(2026, 4, 20, 9, 0))
        store.append_daily_note("event 2", timestamp=datetime(2026, 4, 21, 9, 0))
        store.append_daily_note("event 3", timestamp=datetime(2026, 4, 21, 10, 0))

        entries = store.read_unprocessed_notes(since_cursor=1)

        assert [entry["cursor"] for entry in entries] == [2, 3]
        assert [entry["content"] for entry in entries] == ["event 2", "event 3"]

    def test_list_note_files_is_sorted(self, store):
        store.append_daily_note("older", timestamp=datetime(2026, 4, 20, 8, 0))
        store.append_daily_note("newer", timestamp=datetime(2026, 4, 21, 8, 0))

        files = store.list_note_files()

        assert [path.name for path in files] == ["2026-04-20.md", "2026-04-21.md"]

    def test_raw_archive_appends_markdown_entry(self, store):
        store.raw_archive([{"role": "user", "content": "hello", "timestamp": "2026-04-21 09:00"}])

        entries = store.read_unprocessed_notes(since_cursor=0)
        assert len(entries) == 1
        assert "[RAW]" in entries[0]["content"]
        assert "USER: hello" in entries[0]["content"]


class TestDreamCursor:
    def test_initial_cursor_is_zero(self, store):
        assert store.get_last_dream_cursor() == 0

    def test_set_and_get_cursor(self, store):
        store.set_last_dream_cursor(5)
        assert store.get_last_dream_cursor() == 5

    def test_cursor_persists(self, store):
        store.set_last_dream_cursor(3)
        store2 = MemoryStore(store.workspace)
        assert store2.get_last_dream_cursor() == 3
