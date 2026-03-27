from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from nanobot.platform.runs import (
    RunArtifactNotFoundError,
    RunControlScope,
    RunKind,
    RunLimitExceededError,
    RunLimits,
    RunNotFoundError,
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


def test_run_service_limit_checks_can_scope_to_tenant_and_instance(tmp_path) -> None:
    service = RunService(
        RunStore(tmp_path / "tenant-limits.db"),
        instance_id="instance-default",
        limits=RunLimits(
            max_global_running=1,
            max_running_per_session=1,
            max_children_per_parent=1,
            max_spawn_depth=1,
        ),
    )

    tenant_a = service.create_run(
        kind=RunKind.SUBAGENT,
        label="Tenant A child",
        task_preview="Tenant A active child",
        tenant_id="tenant-a",
        instance_id="instance-a",
        session_key="tenant-a:session-1",
    )
    service.start_run(tenant_a.run_id)

    service.check_limits(
        session_key="tenant-b:session-1",
        parent_run_id=None,
        spawn_depth=1,
        tenant_id="tenant-b",
        instance_id="instance-b",
    )

    with pytest.raises(RunLimitExceededError):
        service.check_limits(
            session_key="tenant-a:session-2",
            parent_run_id=None,
            spawn_depth=1,
            tenant_id="tenant-a",
            instance_id="instance-a",
        )


def test_run_service_can_mark_timeout(tmp_path) -> None:
    service = RunService(RunStore(tmp_path / "timeout.db"), instance_id="instance-test")

    run = service.create_run(
        kind=RunKind.SUBAGENT,
        label="Slow child",
        task_preview="Wait for data",
        session_key="web:session-9",
    )
    service.start_run(run.run_id)
    service.timeout_run(run.run_id, "Timed out after 5 seconds.")

    detail = service.get_run(run.run_id)
    assert detail["status"] == "timed_out"
    assert detail["lastErrorCode"] == "TIMEOUT"
    assert detail["lastErrorMessage"] == "Timed out after 5 seconds."
    assert [event["eventType"] for event in detail["events"]] == ["queued", "started", "timed_out"]


def test_run_service_create_run_allows_tenant_and_instance_override(tmp_path) -> None:
    service = RunService(
        RunStore(tmp_path / "override.db"),
        instance_id="instance-default",
        tenant_id="tenant-default",
    )

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Scoped run",
        task_preview="Persist tenant-aware lineage",
        tenant_id="tenant-a",
        instance_id="instance-a",
        session_key="web:scoped",
    )

    detail = service.get_run(run.run_id)
    assert detail["tenantId"] == "tenant-a"
    assert detail["instanceId"] == "instance-a"


def test_run_service_writes_artifacts_under_tenant_scoped_storage(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"
    service = RunService(
        RunStore(tmp_path / "artifact.db"),
        instance_id="instance-test",
        tenant_id="tenant-a",
        artifact_dir=artifact_dir,
    )

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Artifact run",
        task_preview="Persist a markdown artifact",
        session_key="web:artifact",
    )
    service.start_run(run.run_id)
    artifact_path = service.write_markdown_artifact(
        run.run_id,
        title="Artifact run",
        metadata={"tenant": "tenant-a"},
        sections=[("Summary", "Scoped artifact content.")],
    )
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Scoped artifact content."),
        artifact_path=artifact_path,
    )

    assert artifact_path == f"{run.run_id}.md"
    scoped_artifact = artifact_dir / "tenants" / "tenant-a" / "instance-test" / artifact_path
    assert scoped_artifact.exists()
    assert not (artifact_dir / artifact_path).exists()

    artifact = service.get_artifact(run.run_id)
    assert artifact["artifactPath"] == artifact_path
    assert artifact["fileName"] == artifact_path
    assert "Scoped artifact content." in artifact["content"]


def test_run_service_reads_legacy_root_artifacts_for_compatibility(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"
    service = RunService(
        RunStore(tmp_path / "artifact-legacy.db"),
        instance_id="instance-test",
        tenant_id="tenant-a",
        artifact_dir=artifact_dir,
    )

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Legacy artifact run",
        task_preview="Read a legacy artifact",
        session_key="web:artifact-legacy",
    )
    service.start_run(run.run_id)
    legacy_path = artifact_dir / f"{run.run_id}.md"
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_path.write_text("# Legacy\n\nLegacy root artifact.\n", encoding="utf-8")
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Legacy root artifact."),
        artifact_path=legacy_path.name,
    )

    artifact = service.get_artifact(run.run_id)
    assert artifact["artifactPath"] == legacy_path.name
    assert artifact["fileName"] == legacy_path.name
    assert "Legacy root artifact." in artifact["content"]


def test_run_service_with_tenant_hides_other_tenant_runs_and_artifacts(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"
    service = RunService(
        RunStore(tmp_path / "scoped.db"),
        instance_id="instance-test",
        tenant_id="default",
        artifact_dir=artifact_dir,
    )
    tenant_service = service.with_tenant("tenant-a")

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Tenant scoped run",
        task_preview="Stay isolated",
        tenant_id="tenant-a",
        session_key="web:tenant-a",
    )
    service.start_run(run.run_id)
    artifact_path = service.write_markdown_artifact(
        run.run_id,
        title="Tenant scoped run",
        sections=[("Summary", "Tenant A only artifact.")],
    )
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Tenant A only artifact."),
        artifact_path=artifact_path,
    )

    assert tenant_service.get_run(run.run_id)["tenantId"] == "tenant-a"
    assert tenant_service.get_artifact(run.run_id)["audit"]["storageScope"] == "tenant_instance_scoped"

    with pytest.raises(RunNotFoundError):
        service.with_tenant("tenant-b").get_run(run.run_id)
    with pytest.raises(RunNotFoundError):
        service.with_tenant("tenant-b").get_artifact(run.run_id)


def test_run_service_boundary_audit_includes_channel_and_artifact_governance(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"
    service = RunService(
        RunStore(tmp_path / "audit.db"),
        instance_id="instance-test",
        tenant_id="tenant-a",
        artifact_dir=artifact_dir,
    )

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Audited run",
        task_preview="Trace boundary details",
        tenant_id="tenant-a",
        session_key="agent:ops:telegram:123",
        origin_channel="telegram",
        origin_chat_id="chat-123",
        workspace_path="/tmp/workspace",
        memory_scope="agent_profile",
        knowledge_scope="bindings",
    )
    service.append_event(
        run.run_id,
        "execution_context_materialized",
        {
            "principalKind": "agent",
            "principalId": "agent-ops",
            "label": "Ops Agent",
            "workspacePath": "/tmp/workspace",
            "workspaceScope": "agent",
            "sandboxKind": "local",
            "execWorkingDir": "/tmp/workspace",
            "restrictToWorkspace": True,
            "execTimeoutSeconds": 30,
        },
    )
    service.append_event(
        run.run_id,
        "bindings_resolved",
        {
            "toolAllowlist": ["read_file"],
            "knowledgeBindingIds": ["kb-ops"],
            "knowledgeNames": ["Ops KB"],
            "mcpServerIds": [],
            "skillIds": [],
        },
    )
    service.append_event(
        run.run_id,
        "channel_dispatch_resolved",
        {
            "tenantId": "tenant-a",
            "bindingId": "cb-ops",
            "targetType": "agent",
            "targetId": "agent-ops",
            "channelName": "telegram",
            "chatId": "chat-123",
            "sessionKey": "agent:ops:telegram:123",
        },
    )
    service.start_run(run.run_id)
    artifact_path = service.write_markdown_artifact(
        run.run_id,
        title="Audited run",
        sections=[("Summary", "Complete audit trace.")],
    )
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Complete audit trace."),
        artifact_path=artifact_path,
    )

    audit = service.get_boundary_audit(run.run_id)
    assert audit["tenantId"] == "tenant-a"
    assert audit["channel"]["routing"]["bindingId"] == "cb-ops"
    assert audit["environment"]["workspaceScope"] == "agent"
    assert audit["governance"]["knowledgeBindingIds"] == ["kb-ops"]
    assert audit["artifact"]["storageScope"] == "tenant_instance_scoped"
    assert audit["eventRefs"]["artifactWritten"]["eventType"] == "artifact_written"


def test_run_service_artifact_lifecycle_governance(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"
    service = RunService(
        RunStore(tmp_path / "artifact-lifecycle.db"),
        instance_id="instance-test",
        tenant_id="tenant-a",
        artifact_dir=artifact_dir,
    )

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Artifact lifecycle run",
        task_preview="Manage artifact lifecycle",
        session_key="web:artifact-lifecycle",
    )
    service.start_run(run.run_id)
    artifact_path = service.write_markdown_artifact(
        run.run_id,
        title="Artifact lifecycle run",
        sections=[("Summary", "Lifecycle content.")],
    )
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Lifecycle content."),
        artifact_path=artifact_path,
    )

    active = service.get_artifact_audit(run.run_id)
    assert active["lifecycleStatus"] == "active"
    assert active["retentionPolicy"]["enabled"] is False

    policy = service.set_artifact_retention_policy(
        run.run_id,
        archive_after_days=0,
        delete_after_days=30,
        reason="default retention",
    )
    assert policy["enabled"] is True
    assert policy["archiveAfterDays"] == 0
    assert policy["nextAction"] == "archive"

    applied_archive = service.apply_artifact_retention_policy(run.run_id)
    assert applied_archive["applied"] is True
    assert applied_archive["action"] == "archive"
    archived = service.get_artifact_audit(run.run_id)
    assert archived["lifecycleStatus"] == "archived"
    assert archived["retentionPolicy"]["deleteAfterDays"] == 30

    quarantined = service.quarantine_artifact(run.run_id, reason="suspicious output")
    assert quarantined["lifecycleStatus"] == "quarantined"
    assert quarantined["governanceReason"] == "suspicious output"
    assert service.get_artifact(run.run_id)["audit"]["lifecycleStatus"] == "quarantined"

    delete_policy = service.set_artifact_retention_policy(
        run.run_id,
        archive_after_days=None,
        delete_after_days=0,
        reason="cleanup retention",
    )
    assert delete_policy["nextAction"] == "delete"
    applied_delete = service.apply_artifact_retention_policy(run.run_id)
    assert applied_delete["applied"] is True
    assert applied_delete["action"] == "delete"

    deleted = service.get_artifact_audit(run.run_id)
    assert deleted["lifecycleStatus"] == "deleted"
    with pytest.raises(RunArtifactNotFoundError):
        service.get_artifact(run.run_id)

    restored = service.restore_artifact(run.run_id, reason="false positive")
    assert restored["lifecycleStatus"] == "active"
    restored_artifact = service.get_artifact(run.run_id)
    assert restored_artifact["audit"]["lifecycleStatus"] == "active"
    assert "Lifecycle content." in restored_artifact["content"]


def test_run_service_sweeps_artifact_retention_policy(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"
    service = RunService(
        RunStore(tmp_path / "artifact-retention-sweep.db"),
        instance_id="instance-test",
        tenant_id="tenant-a",
        artifact_dir=artifact_dir,
    )

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Artifact retention sweep run",
        task_preview="Sweep artifact policy",
        session_key="web:artifact-retention-sweep",
    )
    service.start_run(run.run_id)
    artifact_path = service.write_markdown_artifact(
        run.run_id,
        title="Artifact retention sweep run",
        sections=[("Summary", "Sweep content.")],
    )
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Sweep content."),
        artifact_path=artifact_path,
    )
    service.set_artifact_retention_policy(
        run.run_id,
        archive_after_days=0,
        delete_after_days=14,
        reason="sweep retention",
    )

    sweep = service.sweep_artifact_retention()
    assert sweep["evaluated"] == 1
    assert sweep["applied"] == 1
    assert sweep["archived"] == 1
    assert sweep["deleted"] == 0
    assert sweep["items"][0]["action"] == "archive"
    assert service.get_artifact_audit(run.run_id)["lifecycleStatus"] == "archived"


def test_run_service_uses_tenant_default_artifact_retention_policy(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"

    def tenant_loader(tenant_id: str) -> dict[str, object]:
        assert tenant_id == "tenant-a"
        return {
            "tenantId": "tenant-a",
            "updatedAt": "2026-03-27T00:00:00Z",
            "settings": {
                "artifactRetention": {
                    "enabled": True,
                    "archiveAfterDays": 0,
                    "deleteAfterDays": 14,
                    "reason": "tenant default",
                    "actionBy": "tenant_admin",
                    "updatedAt": "2026-03-27T00:00:00Z",
                }
            },
        }

    service = RunService(
        RunStore(tmp_path / "artifact-tenant-default.db"),
        instance_id="instance-test",
        tenant_id="tenant-a",
        artifact_dir=artifact_dir,
        tenant_settings_loader=tenant_loader,
    )

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Tenant default retention run",
        task_preview="Inherit tenant retention",
        session_key="web:artifact-tenant-default",
    )
    service.start_run(run.run_id)
    artifact_path = service.write_markdown_artifact(
        run.run_id,
        title="Tenant default retention run",
        sections=[("Summary", "Tenant retention content.")],
    )
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Tenant retention content."),
        artifact_path=artifact_path,
    )

    audit = service.get_artifact_audit(run.run_id)
    assert audit["retentionPolicy"]["enabled"] is True
    assert audit["retentionPolicy"]["source"] == "tenant_default"
    assert audit["retentionPolicy"]["archiveAfterDays"] == 0
    assert audit["retentionPolicy"]["nextAction"] == "archive"

    applied = service.apply_artifact_retention_policy(run.run_id)
    assert applied["applied"] is True
    assert applied["action"] == "archive"
    assert service.get_artifact_audit(run.run_id)["lifecycleStatus"] == "archived"


def test_run_service_uses_agent_template_artifact_retention_policy_before_tenant_default(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"

    def tenant_loader(_tenant_id: str) -> dict[str, object]:
        return {
            "tenantId": "tenant-a",
            "updatedAt": "2026-03-27T00:00:00Z",
            "settings": {
                "artifactRetention": {
                    "enabled": True,
                    "archiveAfterDays": 30,
                    "deleteAfterDays": 60,
                    "reason": "tenant default",
                }
            },
        }

    def agent_loader(agent_id: str, tenant_id: str | None) -> dict[str, object]:
        assert agent_id == "agent-a"
        assert tenant_id == "tenant-a"
        return {
            "agentId": "agent-a",
            "tenantId": "tenant-a",
            "artifactRetentionPolicy": {
                "enabled": True,
                "archiveAfterDays": 0,
                "deleteAfterDays": 7,
                "reason": "agent template",
            },
        }

    service = RunService(
        RunStore(tmp_path / "artifact-agent-template.db"),
        instance_id="instance-test",
        tenant_id="tenant-a",
        artifact_dir=artifact_dir,
        tenant_settings_loader=tenant_loader,
        agent_definition_loader=agent_loader,
    )

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Agent template retention run",
        task_preview="Inherit agent retention",
        agent_id="agent-a",
        session_key="web:artifact-agent-template",
    )
    service.start_run(run.run_id)
    artifact_path = service.write_markdown_artifact(
        run.run_id,
        title="Agent template retention run",
        sections=[("Summary", "Agent template content.")],
    )
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Agent template content."),
        artifact_path=artifact_path,
    )

    audit = service.get_artifact_audit(run.run_id)
    assert audit["retentionPolicy"]["enabled"] is True
    assert audit["retentionPolicy"]["source"] == "agent_template"
    assert audit["retentionPolicy"]["archiveAfterDays"] == 0
    assert audit["retentionPolicy"]["deleteAfterDays"] == 7


def test_run_service_uses_team_template_artifact_retention_policy_before_agent_and_tenant(tmp_path) -> None:
    artifact_dir = tmp_path / "artifacts"

    def tenant_loader(_tenant_id: str) -> dict[str, object]:
        return {
            "tenantId": "tenant-a",
            "updatedAt": "2026-03-27T00:00:00Z",
            "settings": {"artifactRetention": {"enabled": True, "archiveAfterDays": 30, "deleteAfterDays": 90}},
        }

    def agent_loader(agent_id: str, tenant_id: str | None) -> dict[str, object]:
        assert agent_id == "agent-a"
        assert tenant_id == "tenant-a"
        return {
            "agentId": "agent-a",
            "tenantId": "tenant-a",
            "artifactRetentionPolicy": {"enabled": True, "archiveAfterDays": 14, "deleteAfterDays": 28},
        }

    def team_loader(team_id: str, tenant_id: str | None) -> dict[str, object]:
        assert team_id == "team-a"
        assert tenant_id == "tenant-a"
        return {
            "teamId": "team-a",
            "tenantId": "tenant-a",
            "artifactRetentionPolicy": {"enabled": True, "archiveAfterDays": 0, "deleteAfterDays": 3},
        }

    service = RunService(
        RunStore(tmp_path / "artifact-team-template.db"),
        instance_id="instance-test",
        tenant_id="tenant-a",
        artifact_dir=artifact_dir,
        tenant_settings_loader=tenant_loader,
        agent_definition_loader=agent_loader,
        team_definition_loader=team_loader,
    )

    run = service.create_run(
        kind=RunKind.TEAM,
        label="Team template retention run",
        task_preview="Inherit team retention",
        team_id="team-a",
        agent_id="agent-a",
        session_key="web:artifact-team-template",
    )
    service.start_run(run.run_id)
    artifact_path = service.write_markdown_artifact(
        run.run_id,
        title="Team template retention run",
        sections=[("Summary", "Team template content.")],
    )
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Team template content."),
        artifact_path=artifact_path,
    )

    audit = service.get_artifact_audit(run.run_id)
    assert audit["retentionPolicy"]["enabled"] is True
    assert audit["retentionPolicy"]["source"] == "team_template"
    assert audit["retentionPolicy"]["archiveAfterDays"] == 0
    assert audit["retentionPolicy"]["deleteAfterDays"] == 3


@pytest.mark.asyncio
async def test_subagent_manager_records_run_lifecycle(tmp_path) -> None:
    from nanobot.agent.subagent import SubagentManager
    from nanobot.agent.subagent_protocol import parse_subagent_result_metadata
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
        "execution_context_materialized",
        "started",
        "model_called",
        "model_result",
        "completed",
        "announced",
    ]
    context_payload = record["events"][1]["payload"]
    assert context_payload["principalKind"] == "subagent"
    assert context_payload["label"] == "Inspect repo"
    assert context_payload["sessionKey"] == "web:chat-1"
    assert context_payload["memoryScope"] == "agent_session"
    assert context_payload["knowledgeScope"] == "workspace"
    assert context_payload["sandboxKind"] == "local"
    assert context_payload["execWorkingDir"] == str(tmp_path)
    assert context_payload["restrictToWorkspace"] is False
    assert context_payload["execTimeoutSeconds"] == 60

    inbound = await asyncio.wait_for(bus.consume_inbound(), timeout=1.0)
    assert inbound.channel == "system"
    assert inbound.content.startswith("subagent_result:")
    assert inbound.session_key == "web:chat-1"
    payload = parse_subagent_result_metadata(inbound.metadata)
    assert payload is not None
    assert payload["task"] == "Inspect the repository"
    assert payload["label"] == "Inspect repo"
    assert payload["result"] == "Subagent finished"
    assert payload["sessionKey"] == "web:chat-1"


@pytest.mark.asyncio
async def test_subagent_manager_uses_request_tenant_and_instance_for_child_run(tmp_path) -> None:
    from nanobot.agent.subagent import SubagentManager
    from nanobot.bus.queue import MessageBus
    from nanobot.harness import ChildTaskRequest
    from nanobot.providers.base import LLMResponse

    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"

    async def scripted_chat_with_retry(*, messages, **kwargs):
        _ = messages, kwargs
        return LLMResponse(content="Tenant scoped child finished", tool_calls=[])

    provider.chat_with_retry = scripted_chat_with_retry
    runs = RunService(RunStore(tmp_path / "runtime-tenant.db"), instance_id="instance-default", tenant_id="tenant-default")
    manager = SubagentManager(
        provider=provider,
        workspace=tmp_path,
        bus=bus,
        run_registry=runs,
    )

    await manager.spawn_child_task(
        ChildTaskRequest(
            task="Inspect a tenant-scoped task",
            label="Inspect tenant task",
            tenant_id="tenant-a",
            instance_id="instance-a",
            origin_channel="web",
            origin_chat_id="chat-tenant",
            session_key="web:chat-tenant",
        )
    )

    listed = [
        record.to_dict()
        for record in runs.store.list_runs(
            tenant_id="tenant-a",
            instance_id="instance-a",
            limit=10,
        )
    ]
    assert len(listed) == 1
    run_id = listed[0]["runId"]

    for _ in range(50):
        record = runs.get_run(run_id)
        if record["status"] == "succeeded":
            break
        await asyncio.sleep(0.02)
    else:
        pytest.fail("tenant-scoped subagent run did not finish in time")

    record = runs.get_run(run_id)
    assert record["tenantId"] == "tenant-a"
    assert record["instanceId"] == "instance-a"
    context_payload = next(
        event["payload"]
        for event in record["events"]
        if event["eventType"] == "execution_context_materialized"
    )
    assert context_payload["tenantId"] == "tenant-a"
    assert context_payload["instanceId"] == "instance-a"


@pytest.mark.asyncio
async def test_subagent_manager_records_model_and_tool_events(tmp_path, monkeypatch) -> None:
    from nanobot.agent.execution import ToolLoopResult
    from nanobot.agent.subagent import SubagentManager
    from nanobot.bus.queue import MessageBus
    from nanobot.harness import ChildTaskRequest
    from nanobot.providers.base import LLMResponse, ToolCallRequest

    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    runs = RunService(RunStore(tmp_path / "runtime-events.db"), instance_id="instance-test")
    manager = SubagentManager(
        provider=provider,
        workspace=tmp_path,
        bus=bus,
        run_registry=runs,
    )

    async def fake_run_tool_loop(*, hooks=None, **kwargs):
        _ = kwargs
        assert hooks is not None
        tool_call = ToolCallRequest(id="tc-1", name="list_dir", arguments={})
        await hooks.before_model(
            iteration=1,
            messages=[{"role": "user", "content": "Inspect the repository"}],
            model="test-model",
        )
        await hooks.after_model(
            iteration=1,
            response=LLMResponse(
                content="I'll inspect the workspace.",
                tool_calls=[tool_call],
                finish_reason="tool_calls",
            ),
            model="test-model",
        )
        await hooks.before_tool(iteration=1, tool_call=tool_call)
        await hooks.after_tool(iteration=1, tool_call=tool_call, result="listing")
        await hooks.before_model(
            iteration=2,
            messages=[
                {"role": "user", "content": "Inspect the repository"},
                {"role": "assistant", "content": "I'll inspect the workspace."},
                {"role": "tool", "content": "listing"},
            ],
            model="test-model",
        )
        await hooks.after_model(
            iteration=2,
            response=LLMResponse(
                content="Inspection complete.",
                tool_calls=[],
                finish_reason="stop",
            ),
            model="test-model",
        )
        return ToolLoopResult(
            final_content="Inspection complete.",
            tools_used=["list_dir"],
            messages=[],
            iterations=2,
        )

    monkeypatch.setattr("nanobot.agent.subagent.run_tool_loop", fake_run_tool_loop)

    await manager.spawn_child_task(
        ChildTaskRequest(
            task="Inspect the repository",
            label="Inspect repo",
            origin_channel="web",
            origin_chat_id="chat-events",
            session_key="web:chat-events",
        )
    )

    listed = runs.list_runs(limit=10)
    assert len(listed) == 1
    run_id = listed[0]["runId"]

    for _ in range(50):
        record = runs.get_run(run_id)
        if record["status"] == "succeeded":
            break
        await asyncio.sleep(0.02)
    else:
        pytest.fail("subagent eventful run did not finish in time")

    record = runs.get_run(run_id)
    assert [event["eventType"] for event in record["events"]] == [
        "queued",
        "execution_context_materialized",
        "started",
        "model_called",
        "model_result",
        "tool_called",
        "tool_result",
        "model_called",
        "model_result",
        "completed",
        "announced",
    ]
    assert record["events"][1]["payload"]["principalKind"] == "child_task"
    assert record["events"][1]["payload"]["label"] == "Inspect repo"
    assert record["events"][3]["payload"] == {
        "iteration": 1,
        "model": "test-model",
        "messageCount": 1,
    }
    assert record["events"][5]["payload"] == {
        "iteration": 1,
        "toolName": "list_dir",
        "arguments": {},
    }
    assert record["events"][6]["payload"] == {
        "iteration": 1,
        "toolName": "list_dir",
        "contentPreview": "listing",
        "isError": False,
    }


@pytest.mark.asyncio
async def test_subagent_manager_uses_workspace_provider_binding(tmp_path, monkeypatch) -> None:
    from nanobot.agent.execution import ToolLoopResult
    from nanobot.agent.subagent import SubagentManager
    from nanobot.bus.queue import MessageBus
    from nanobot.harness import ChildTaskRequest, SandboxBinding, WorkspaceBinding

    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    runs = RunService(RunStore(tmp_path / "runtime-workspace.db"), instance_id="instance-test")
    bound_workspace = tmp_path / "thread-workspace"
    bound_workspace.mkdir()

    class _WorkspaceProvider:
        def resolve(self, **kwargs):
            _ = kwargs
            return WorkspaceBinding(
                path=bound_workspace,
                scope="thread",
                restrict_to_workspace=True,
                principal_kind="subagent",
                principal_id="ops-agent",
            )

    class _SandboxProvider:
        def resolve(self, **kwargs):
            _ = kwargs
            return SandboxBinding(
                kind="local",
                working_dir=bound_workspace,
                restrict_to_workspace=True,
                exec_timeout=77,
                path_append="/opt/tools",
                principal_kind="subagent",
                principal_id="ops-agent",
            )

    manager = SubagentManager(
        provider=provider,
        workspace=tmp_path,
        bus=bus,
        run_registry=runs,
        workspace_provider=_WorkspaceProvider(),
        sandbox_provider=_SandboxProvider(),
    )

    async def fake_run_tool_loop(**kwargs):
        assert str(kwargs["context"].workspace) == str(bound_workspace)
        return ToolLoopResult(
            final_content="Bound workspace complete.",
            tools_used=[],
            messages=[],
            iterations=1,
        )

    monkeypatch.setattr("nanobot.agent.subagent.run_tool_loop", fake_run_tool_loop)

    await manager.spawn_child_task(
        ChildTaskRequest(
            task="Inspect the thread workspace",
            label="Inspect thread workspace",
            principal_kind="subagent",
            principal_id="ops-agent",
            agent_id="ops-agent",
            origin_channel="web",
            origin_chat_id="chat-workspace",
            session_key="web:chat-workspace",
        )
    )

    listed = runs.list_runs(limit=10)
    assert len(listed) == 1
    run_id = listed[0]["runId"]

    for _ in range(50):
        record = runs.get_run(run_id)
        if record["status"] == "succeeded":
            break
        await asyncio.sleep(0.02)
    else:
        pytest.fail("workspace-bound subagent run did not finish in time")

    record = runs.get_run(run_id)
    assert record["workspacePath"] == str(bound_workspace)
    context_payload = next(
        event["payload"]
        for event in record["events"]
        if event["eventType"] == "execution_context_materialized"
    )
    assert context_payload["workspacePath"] == str(bound_workspace)
    assert context_payload["workspaceScope"] == "thread"
    assert context_payload["sandboxKind"] == "local"
    assert context_payload["execWorkingDir"] == str(bound_workspace)
    assert context_payload["restrictToWorkspace"] is True
    assert context_payload["execTimeoutSeconds"] == 77


@pytest.mark.asyncio
async def test_subagent_manager_projects_child_task_events_to_parent_run(tmp_path) -> None:
    from nanobot.agent.subagent import SubagentManager
    from nanobot.bus.queue import MessageBus
    from nanobot.providers.base import LLMResponse

    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"

    async def scripted_chat_with_retry(*, messages, **kwargs):
        _ = messages, kwargs
        return LLMResponse(content="Projected child finished", tool_calls=[])

    provider.chat_with_retry = scripted_chat_with_retry
    runs = RunService(RunStore(tmp_path / "runtime-parent.db"), instance_id="instance-test")
    parent = runs.create_run(
        kind=RunKind.AGENT,
        label="Parent run",
        task_preview="Coordinate child tasks",
        session_key="web:parent",
    )
    runs.start_run(parent.run_id)

    manager = SubagentManager(
        provider=provider,
        workspace=tmp_path,
        bus=bus,
        run_registry=runs,
    )

    await manager.spawn(
        task="Inspect a dependency",
        label="Inspect dependency",
        origin_channel="web",
        origin_chat_id="chat-parent",
        session_key="web:chat-parent",
        parent_run_id=parent.run_id,
        root_run_id=parent.run_id,
        spawn_depth=1,
    )

    child_run_id = None
    for _ in range(50):
        children = runs.list_children(parent.run_id)
        if children and children[0]["status"] == "succeeded":
            child_run_id = children[0]["runId"]
            break
        await asyncio.sleep(0.02)
    else:
        pytest.fail("projected child run did not finish in time")

    parent_detail = runs.get_run(parent.run_id)
    parent_event_types = [event["eventType"] for event in parent_detail["events"]]
    assert "child_task_scheduled" in parent_event_types
    assert "child_task_completed" in parent_event_types

    scheduled = next(event for event in parent_detail["events"] if event["eventType"] == "child_task_scheduled")
    completed = next(event for event in parent_detail["events"] if event["eventType"] == "child_task_completed")

    assert scheduled["payload"]["principalKind"] == "subagent"
    assert scheduled["payload"]["childRunId"] == child_run_id
    assert scheduled["payload"]["parentRunId"] == parent.run_id
    assert completed["payload"]["childRunId"] == child_run_id
    assert completed["payload"]["status"] == "ok"
    assert completed["payload"]["content"] == "Projected child finished"


@pytest.mark.asyncio
async def test_subagent_manager_projects_child_task_progress_to_parent_run(tmp_path, monkeypatch) -> None:
    from nanobot.agent.execution import ToolLoopResult
    from nanobot.agent.subagent import SubagentManager
    from nanobot.bus.queue import MessageBus
    from nanobot.providers.base import LLMResponse, ToolCallRequest

    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    runs = RunService(RunStore(tmp_path / "runtime-parent-progress.db"), instance_id="instance-test")
    parent = runs.create_run(
        kind=RunKind.AGENT,
        label="Parent run",
        task_preview="Coordinate child tasks",
        session_key="web:parent-progress",
    )
    runs.start_run(parent.run_id)

    manager = SubagentManager(
        provider=provider,
        workspace=tmp_path,
        bus=bus,
        run_registry=runs,
    )

    async def fake_run_tool_loop(*, hooks=None, **kwargs):
        _ = kwargs
        assert hooks is not None
        tool_call = ToolCallRequest(id="tc-1", name="list_dir", arguments={})
        await hooks.before_model(
            iteration=1,
            messages=[{"role": "user", "content": "Inspect a dependency"}],
            model="test-model",
        )
        await hooks.after_model(
            iteration=1,
            response=LLMResponse(content="Thinking", tool_calls=[tool_call], finish_reason="tool_calls"),
            model="test-model",
        )
        await hooks.before_tool(iteration=1, tool_call=tool_call)
        await hooks.after_tool(iteration=1, tool_call=tool_call, result="listing")
        return ToolLoopResult(
            final_content="Projected child finished",
            tools_used=["list_dir"],
            messages=[],
            iterations=1,
        )

    monkeypatch.setattr("nanobot.agent.subagent.run_tool_loop", fake_run_tool_loop)

    await manager.spawn(
        task="Inspect a dependency",
        label="Inspect dependency",
        origin_channel="web",
        origin_chat_id="chat-parent",
        session_key="web:chat-parent",
        parent_run_id=parent.run_id,
        root_run_id=parent.run_id,
        spawn_depth=1,
    )

    for _ in range(50):
        children = runs.list_children(parent.run_id)
        if children and children[0]["status"] == "succeeded":
            break
        await asyncio.sleep(0.02)
    else:
        pytest.fail("projected child run did not finish in time")

    parent_detail = runs.get_run(parent.run_id)
    progress_events = [
        event for event in parent_detail["events"]
        if event["eventType"] == "child_task_progress"
    ]
    assert len(progress_events) >= 3
    handle_ids = {event["payload"].get("handleId") for event in progress_events}
    assert len(handle_ids) == 1
    assert progress_events[0]["payload"]["stage"] == "running"
    assert progress_events[1]["payload"]["stage"] == "model_called"
    assert progress_events[2]["payload"]["stage"] == "model_result"
    assert any(event["payload"].get("stage") == "tool_called" for event in progress_events)
    assert any(event["payload"].get("stage") == "tool_result" for event in progress_events)


@pytest.mark.asyncio
async def test_subagent_manager_records_timeout_lifecycle(tmp_path, monkeypatch) -> None:
    from nanobot.agent.subagent import SubagentManager
    from nanobot.agent.subagent_protocol import parse_subagent_result_metadata
    from nanobot.bus.queue import MessageBus
    from nanobot.harness import ChildTaskRequest

    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    runs = RunService(RunStore(tmp_path / "runtime-timeout.db"), instance_id="instance-test")
    manager = SubagentManager(
        provider=provider,
        workspace=tmp_path,
        bus=bus,
        run_registry=runs,
    )

    async def slow_run_tool_loop(**kwargs):
        _ = kwargs
        await asyncio.sleep(1.1)
        raise AssertionError("subagent timeout wrapper did not interrupt run_tool_loop")

    monkeypatch.setattr("nanobot.agent.subagent.run_tool_loop", slow_run_tool_loop)

    result_text = await manager.spawn_child_task(
        ChildTaskRequest(
            task="Inspect the repository slowly",
            label="Inspect repo slowly",
            origin_channel="web",
            origin_chat_id="chat-2",
            session_key="web:chat-2",
            timeout_seconds=1,
        )
    )
    assert "Inspect repo slowly" in result_text

    listed = runs.list_runs(limit=10)
    assert len(listed) == 1
    run_id = listed[0]["runId"]

    for _ in range(100):
        record = runs.get_run(run_id)
        if record["status"] == "timed_out":
            break
        await asyncio.sleep(0.02)
    else:
        pytest.fail("subagent timeout run did not finish in time")

    record = runs.get_run(run_id)
    assert record["status"] == "timed_out"
    assert record["lastErrorCode"] == "TIMEOUT"
    assert [event["eventType"] for event in record["events"]] == [
        "queued",
        "execution_context_materialized",
        "started",
        "timed_out",
        "announced",
    ]

    inbound = await asyncio.wait_for(bus.consume_inbound(), timeout=1.0)
    payload = parse_subagent_result_metadata(inbound.metadata)
    assert payload is not None
    assert payload["status"] == "timed_out"
    assert payload["sessionKey"] == "web:chat-2"
