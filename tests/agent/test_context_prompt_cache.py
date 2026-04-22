"""Tests for cache-friendly prompt construction."""

from __future__ import annotations

import datetime as datetime_module
from datetime import datetime as real_datetime
from importlib.resources import files as pkg_files
from pathlib import Path

from nanobot.agent.context import ContextBuilder


class _FakeDatetime(real_datetime):
    current = real_datetime(2026, 2, 24, 13, 59)

    @classmethod
    def now(cls, tz=None):  # type: ignore[override]
        return cls.current


def _make_workspace(tmp_path: Path) -> Path:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)
    return workspace


def test_bootstrap_files_are_backed_by_templates() -> None:
    template_dir = pkg_files("nanobot") / "templates"

    for filename in ContextBuilder.BOOTSTRAP_FILES:
        assert (template_dir / filename).is_file(), f"missing bootstrap template: {filename}"


def test_system_prompt_stays_stable_when_clock_changes(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(datetime_module, "datetime", _FakeDatetime)

    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    _FakeDatetime.current = real_datetime(2026, 2, 24, 13, 59)
    prompt1 = builder.build_system_prompt()

    _FakeDatetime.current = real_datetime(2026, 2, 24, 14, 0)
    prompt2 = builder.build_system_prompt()

    assert prompt1 == prompt2


def test_system_prompt_reflects_current_memory_contract(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    prompt = builder.build_system_prompt()

    assert "PROFILE.md" in prompt
    assert "MEMORY.md" in prompt
    assert "memory/YYYY-MM-DD.md" in prompt
    assert "history.jsonl" not in prompt
    assert "USER.md" not in prompt


def test_system_prompt_omits_workspace_memory_when_disabled(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    marker = "workspace-memory-marker"
    (workspace / "AGENTS.md").write_text(marker, encoding="utf-8")
    builder = ContextBuilder(workspace)

    prompt_with_memory = builder.build_system_prompt(include_workspace_memory=True)
    prompt_without_memory = builder.build_system_prompt(include_workspace_memory=False)

    assert marker in prompt_with_memory
    assert marker not in prompt_without_memory


def test_daily_notes_are_not_injected_into_system_prompt(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    builder.memory.append_daily_note("A transient note")
    prompt = builder.build_system_prompt()

    assert "A transient note" not in prompt
    assert "# Recent History" not in prompt


def test_runtime_context_is_separate_untrusted_user_message(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    messages = builder.build_messages(
        history=[],
        current_message="Return exactly: OK",
        channel="cli",
        chat_id="direct",
    )

    assert messages[0]["role"] == "system"
    assert messages[-1]["role"] == "user"
    user_content = messages[-1]["content"]
    assert isinstance(user_content, str)
    assert ContextBuilder._RUNTIME_CONTEXT_TAG in user_content
    assert "Current Time:" in user_content
    assert "Channel: cli" in user_content
    assert "Chat ID: direct" in user_content
    assert "Return exactly: OK" in user_content


def test_execution_rules_in_system_prompt(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    prompt = builder.build_system_prompt()
    assert "Act, don't narrate" in prompt
    assert "Read before you write" in prompt
    assert "verify the result" in prompt


def test_channel_format_hint_telegram(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    prompt = builder.build_system_prompt(channel="telegram")
    assert "Format Hint" in prompt
    assert "messaging app" in prompt


def test_channel_format_hint_whatsapp(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    prompt = builder.build_system_prompt(channel="whatsapp")
    assert "Format Hint" in prompt
    assert "plain text only" in prompt


def test_channel_format_hint_absent_for_unknown(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    prompt = builder.build_system_prompt(channel=None)
    assert "Format Hint" not in prompt

    prompt2 = builder.build_system_prompt(channel="feishu")
    assert "Format Hint" not in prompt2


def test_system_prompt_can_skip_always_skills_and_catalog_summary(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    (workspace / "skills" / "always-on").mkdir(parents=True)
    (workspace / "skills" / "always-on" / "SKILL.md").write_text(
        "---\nname: always-on\ndescription: test\nalways: true\n---\n\n# Always On\n",
        encoding="utf-8",
    )
    builder = ContextBuilder(
        workspace,
        include_always_skills=False,
        include_skills_summary=False,
    )

    prompt = builder.build_system_prompt()

    assert "# Active Skills" not in prompt
    assert "<skills>" not in prompt


def test_build_messages_passes_channel_to_system_prompt(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    messages = builder.build_messages(
        history=[],
        current_message="hi",
        channel="telegram",
        chat_id="123",
    )
    system = messages[0]["content"]
    assert "Format Hint" in system
    assert "messaging app" in system


def test_system_prompt_cache_refreshes_when_bootstrap_changes(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    memory_file = workspace / "MEMORY.md"
    memory_file.write_text("Version A", encoding="utf-8")
    builder = ContextBuilder(workspace)

    prompt1 = builder.build_system_prompt()
    memory_file.write_text("Version B updated", encoding="utf-8")
    prompt2 = builder.build_system_prompt()

    assert "Version A" in prompt1
    assert "Version B updated" in prompt2
    assert prompt1 != prompt2


def test_system_prompt_cache_refreshes_when_skill_changes(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    skill_dir = workspace / "skills" / "alpha"
    skill_dir.mkdir(parents=True)
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text("---\ndescription: Alpha\n---\n\n# Alpha v1\n", encoding="utf-8")
    builder = ContextBuilder(
        workspace,
        include_always_skills=False,
        include_skills_summary=False,
    )

    prompt1 = builder.build_system_prompt(skill_names=["alpha"])
    skill_file.write_text("---\ndescription: Alpha\n---\n\n# Alpha v2 updated\n", encoding="utf-8")
    prompt2 = builder.build_system_prompt(skill_names=["alpha"])

    assert "# Alpha v1" in prompt1
    assert "# Alpha v2 updated" in prompt2
    assert prompt1 != prompt2


def test_subagent_result_does_not_create_consecutive_assistant_messages(tmp_path) -> None:
    workspace = _make_workspace(tmp_path)
    builder = ContextBuilder(workspace)

    messages = builder.build_messages(
        history=[{"role": "assistant", "content": "previous result"}],
        current_message="subagent result",
        channel="cli",
        chat_id="direct",
        current_role="assistant",
    )

    for left, right in zip(messages, messages[1:]):
        assert not (left.get("role") == right.get("role") == "assistant")
