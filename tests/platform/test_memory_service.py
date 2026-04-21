from __future__ import annotations

from pathlib import Path

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.memory import MemoryService


def _make_service(tmp_path: Path) -> MemoryService:
    instance = PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "config.json",
    )
    return MemoryService(
        instance=instance,
        instance_id=instance.id,
        agent_lookup=lambda agent_id, *, tenant_id=None: {"agentId": agent_id, "tenantId": tenant_id},
    )


def test_memory_service_returns_four_file_workspace_snapshot(tmp_path: Path) -> None:
    service = _make_service(tmp_path)

    updated = service.update_agent_memory(
        "ops-agent",
        {
            "AGENTS.md": "# AGENTS\n\nUse long-term memory carefully.\n",
            "MEMORY.md": "# MEMORY\n\n- Prefer numbered incident checklists.\n",
        },
    )

    assert updated["agentId"] == "ops-agent"
    assert set(updated["files"]) == {"AGENTS.md", "SOUL.md", "PROFILE.md", "MEMORY.md"}
    assert "numbered incident checklists" in updated["files"]["MEMORY.md"]["content"]
    assert updated["files"]["PROFILE.md"]["fileName"] == "PROFILE.md"


def test_memory_service_lists_recent_daily_notes(tmp_path: Path) -> None:
    service = _make_service(tmp_path)
    snapshot = service.get_agent_memory("ops-agent")
    memory_root = Path(snapshot["rootPath"])
    notes_dir = memory_root / "memory"
    notes_dir.mkdir(parents=True, exist_ok=True)
    (notes_dir / "2026-04-20.md").write_text("older note\n", encoding="utf-8")
    (notes_dir / "2026-04-21.md").write_text("latest note\n", encoding="utf-8")

    updated = service.get_agent_memory("ops-agent")
    assert [note["fileName"] for note in updated["dailyNotes"][:2]] == [
        "2026-04-21.md",
        "2026-04-20.md",
    ]
    assert updated["dailyNotes"][0]["content"] == "latest note\n"
