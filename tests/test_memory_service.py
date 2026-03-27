from __future__ import annotations

from pathlib import Path

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.memory import MemoryService, MemoryStore


def test_memory_service_supports_agent_profile_sources(tmp_path: Path) -> None:
    instance = PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "config.json",
    )
    service = MemoryService(
        MemoryStore(instance.memory_db_path()),
        instance=instance,
        instance_id=instance.id,
        agent_lookup=lambda agent_id, *, tenant_id=None: {"agentId": agent_id, "tenantId": tenant_id},
    )

    updated = service.update_agent_memory(
        "ops-agent",
        "Agent profile memory: prefer numbered incident checklists.",
    )
    assert updated["agentId"] == "ops-agent"
    assert "numbered incident checklists" in updated["content"]

    search = service.search(
        query="incident checklists",
        agent_id="ops-agent",
        mode="keyword",
    )
    assert search["effectiveMode"] == "keyword"
    assert any(item["sourceType"] == "agent_profile" for item in search["items"])

    source = service.get_memory_source(
        source_type="agent_profile",
        source_id="ops-agent",
        agent_id="ops-agent",
    )
    assert source["sourceType"] == "agent_profile"
    assert source["sourceId"] == "ops-agent"
    assert "numbered incident checklists" in source["content"]


def test_memory_service_applies_agent_profile_candidates(tmp_path: Path) -> None:
    instance = PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "config.json",
    )
    service = MemoryService(
        MemoryStore(instance.memory_db_path()),
        instance=instance,
        instance_id=instance.id,
        agent_lookup=lambda agent_id, *, tenant_id=None: {"agentId": agent_id, "tenantId": tenant_id},
    )

    candidate = service.create_candidate(
        scope="agent_profile",
        agent_id="ops-agent",
        run_id="run-agent-1",
        source_kind="manual_note",
        title="Ops Agent profile candidate",
        content="Prefer a numbered checklist for incident response summaries.",
    )
    assert candidate is not None
    assert candidate["scope"] == "agent_profile"
    assert candidate["status"] == "proposed"

    listed = service.list_candidates(agent_id="ops-agent", scope="agent_profile", status="proposed")
    assert len(listed) == 1
    assert listed[0]["candidateId"] == candidate["candidateId"]

    applied = service.apply_candidate(candidate["candidateId"])
    assert applied["status"] == "applied"
    assert applied["agentId"] == "ops-agent"

    snapshot = service.get_agent_memory("ops-agent")
    assert "numbered checklist" in snapshot["content"]
    assert snapshot["candidateCount"] == 0

    memory_source = service.get_memory_source(
        source_type="memory_candidate",
        source_id=candidate["candidateId"],
        agent_id="ops-agent",
    )
    assert memory_source["sourceType"] == "memory_candidate"
    assert memory_source["metadata"]["agentId"] == "ops-agent"
