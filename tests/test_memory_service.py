from __future__ import annotations

from pathlib import Path

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.memory import TeamMemoryService, TeamMemoryStore


def test_team_memory_service_creates_and_applies_candidates(tmp_path: Path) -> None:
    instance = PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "config.json",
    )
    service = TeamMemoryService(
        TeamMemoryStore(instance.memory_db_path()),
        instance=instance,
        instance_id=instance.id,
        team_lookup=lambda team_id: {"teamId": team_id},
    )

    initial = service.get_team_memory("support-team")
    assert initial["content"] == ""
    assert initial["candidateCount"] == 0

    candidate = service.create_candidate(
        scope="team_shared",
        team_id="support-team",
        agent_id="research-agent",
        run_id="run_member_1",
        source_kind="member_result",
        title="Support Team · Research candidate",
        content="Escalate only after confirming the impacted region.",
    )
    assert candidate is not None
    assert candidate["status"] == "proposed"

    listed = service.list_candidates(team_id="support-team")
    assert len(listed) == 1
    assert listed[0]["candidateId"] == candidate["candidateId"]

    applied = service.apply_candidate(candidate["candidateId"])
    assert applied["status"] == "applied"
    assert applied["appliedAt"] is not None

    team_memory = service.get_team_memory("support-team")
    assert "Escalate only after confirming the impacted region." in team_memory["content"]
    assert team_memory["candidateCount"] == 0

    search = service.search(query="impacted region", team_id="support-team")
    assert search["total"] == 1
    assert search["effectiveMode"] == "hybrid"
    assert search["items"][0]["sourceType"] == "team_memory"

    source = service.get_memory_source(source_type="team_memory", source_id="support-team", team_id="support-team")
    assert source["sourceType"] == "team_memory"
    assert "Escalate only after confirming the impacted region." in source["content"]


def test_team_memory_service_search_includes_team_thread_and_run_artifacts(tmp_path: Path) -> None:
    instance = PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "config.json",
    )
    service = TeamMemoryService(
        TeamMemoryStore(instance.memory_db_path()),
        instance=instance,
        instance_id=instance.id,
        team_lookup=lambda team_id: {"teamId": team_id},
    )
    service.bind_runtime_sources(
        team_thread_source_loader=lambda team_id: {
            "sourceId": f"team-thread:{team_id}",
            "title": f"Team Thread · {team_id}",
            "content": "User: Initial request\n\nAssistant: Team summary with follow-up context.",
            "metadata": {"threadId": f"team-thread:{team_id}", "messageCount": 2},
        },
        team_artifact_sources_loader=lambda team_id: [
            {
                "sourceId": "run_team_1",
                "title": f"Run Artifact · {team_id}",
                "content": "# Artifact\n\nEscalation artifact for the support workflow.",
                "metadata": {"runId": "run_team_1", "teamId": team_id},
            }
        ],
    )

    thread_search = service.search(query="follow-up context", team_id="support-team")
    assert any(item["sourceType"] == "team_thread" for item in thread_search["items"])

    artifact_search = service.search(query="Escalation artifact", team_id="support-team")
    assert any(item["sourceType"] == "run_artifact" for item in artifact_search["items"])

    thread_source = service.get_memory_source(
        source_type="team_thread",
        source_id="team-thread:support-team",
        team_id="support-team",
    )
    assert thread_source["sourceType"] == "team_thread"
    assert "Team summary with follow-up context." in thread_source["content"]

    artifact_source = service.get_memory_source(
        source_type="run_artifact",
        source_id="run_team_1",
        team_id="support-team",
    )
    assert artifact_source["sourceType"] == "run_artifact"
    assert "Escalation artifact for the support workflow." in artifact_source["content"]


def test_team_memory_service_search_supports_semantic_and_hybrid_modes(tmp_path: Path) -> None:
    instance = PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "config.json",
    )
    service = TeamMemoryService(
        TeamMemoryStore(instance.memory_db_path()),
        instance=instance,
        instance_id=instance.id,
        team_lookup=lambda team_id: {"teamId": team_id},
    )
    service.update_team_memory(
        "support-team",
        "Escalation handling guideline: escalate only after triaging the impacted customer region.",
    )

    semantic = service.search(
        query="escalation guideline",
        team_id="support-team",
        mode="semantic",
    )
    assert semantic["effectiveMode"] == "semantic"
    assert semantic["total"] >= 1
    assert semantic["items"][0]["sourceType"] == "team_memory"

    hybrid = service.search(
        query="triaging impacted customer region",
        team_id="support-team",
        mode="hybrid",
    )
    assert hybrid["effectiveMode"] == "hybrid"
    assert hybrid["total"] >= 1
