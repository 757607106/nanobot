from __future__ import annotations

from pathlib import Path

import pytest

from nanobot.platform.runs import (
    RunArtifactNotFoundError,
    RunControlScope,
    RunKind,
    RunLimitExceededError,
    RunLimits,
    RunResultSummary,
    RunService,
    RunStore,
)


def test_run_service_lifecycle_and_tree(tmp_path: Path) -> None:
    service = RunService(RunStore(tmp_path / "runs.db"), instance_id="instance-test")

    parent = service.create_run(
        kind=RunKind.AGENT,
        label="Primary run",
        task_preview="Coordinate the task",
        session_key="web:session-1",
    )
    child = service.create_run(
        kind=RunKind.AGENT,
        label="Follow-up run",
        task_preview="Gather supporting facts",
        session_key="web:session-1",
        parent_run_id=parent.run_id,
        root_run_id=parent.run_id,
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
    assert detail["kind"] == "agent"
    assert detail["status"] == "succeeded"
    assert detail["resultSummary"]["content"] == "Finished"
    assert detail["resultSummary"]["tools_used"] == ["web_search"]
    assert [event["eventType"] for event in detail["events"]] == ["queued", "started", "completed"]

    children = service.list_children(parent.run_id)
    assert len(children) == 1
    assert children[0]["runId"] == child.run_id
    assert children[0]["controlScope"] == "child"

    tree = service.get_run_tree(parent.run_id)
    assert tree["runId"] == parent.run_id
    assert len(tree["children"]) == 1
    assert tree["children"][0]["runId"] == child.run_id


def test_run_service_limit_checks_active_runs_and_parent_fanout(tmp_path: Path) -> None:
    service = RunService(
        RunStore(tmp_path / "limits.db"),
        instance_id="instance-test",
        limits=RunLimits(
            max_global_running=1,
            max_running_per_session=1,
            max_children_per_parent=1,
        ),
    )

    active = service.create_run(
        kind=RunKind.AGENT,
        label="Active run",
        task_preview="Current work",
        session_key="web:session-1",
    )
    service.start_run(active.run_id)

    with pytest.raises(RunLimitExceededError, match="Global"):
        service.check_limits(session_key="web:session-2", parent_run_id=None)

    scoped = RunService(
        RunStore(tmp_path / "session-parent-limits.db"),
        instance_id="instance-test",
        limits=RunLimits(
            max_global_running=10,
            max_running_per_session=1,
            max_children_per_parent=1,
        ),
    )
    parent = scoped.create_run(
        kind=RunKind.AGENT,
        label="Parent",
        task_preview="Parent task",
        session_key="web:session-9",
    )
    child = scoped.create_run(
        kind=RunKind.AGENT,
        label="Child",
        task_preview="Child task",
        session_key="web:session-9",
        parent_run_id=parent.run_id,
        root_run_id=parent.run_id,
        control_scope=RunControlScope.CHILD,
    )
    scoped.start_run(child.run_id)

    with pytest.raises(RunLimitExceededError, match="Session"):
        scoped.check_limits(session_key="web:session-9", parent_run_id=None)

    with pytest.raises(RunLimitExceededError, match="Parent"):
        scoped.check_limits(session_key="web:session-10", parent_run_id=parent.run_id)


def test_run_service_limit_checks_can_scope_to_tenant_and_instance(tmp_path: Path) -> None:
    service = RunService(
        RunStore(tmp_path / "tenant-limits.db"),
        instance_id="instance-default",
        limits=RunLimits(
            max_global_running=1,
            max_running_per_session=1,
            max_children_per_parent=1,
        ),
    )

    tenant_a = service.create_run(
        kind=RunKind.AGENT,
        label="Tenant A active run",
        task_preview="Tenant A activity",
        tenant_id="tenant-a",
        instance_id="instance-a",
        session_key="tenant-a:session-1",
    )
    service.start_run(tenant_a.run_id)

    service.check_limits(
        session_key="tenant-b:session-1",
        parent_run_id=None,
        tenant_id="tenant-b",
        instance_id="instance-b",
    )

    with pytest.raises(RunLimitExceededError):
        service.check_limits(
            session_key="tenant-a:session-2",
            parent_run_id=None,
            tenant_id="tenant-a",
            instance_id="instance-a",
        )


def test_run_service_can_mark_timeout(tmp_path: Path) -> None:
    service = RunService(RunStore(tmp_path / "timeout.db"), instance_id="instance-test")

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Slow run",
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


def test_run_service_writes_artifacts_under_tenant_scoped_storage(tmp_path: Path) -> None:
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


def test_run_service_reads_legacy_root_artifacts_for_compatibility(tmp_path: Path) -> None:
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
    legacy_file = artifact_dir / f"{run.run_id}.md"
    legacy_file.parent.mkdir(parents=True, exist_ok=True)
    legacy_file.write_text("# Legacy\n\nCompatibility artifact.\n", encoding="utf-8")
    service.complete_run(
        run.run_id,
        RunResultSummary(content="Compatibility artifact."),
        artifact_path=legacy_file.name,
    )

    artifact = service.get_artifact(run.run_id)
    assert artifact["audit"]["storageScope"] == "legacy_root"
    assert artifact["audit"]["isLegacyFallback"] is True
    assert "Compatibility artifact." in artifact["content"]


def test_run_service_boundary_audit_exposes_single_agent_lineage(tmp_path: Path) -> None:
    service = RunService(RunStore(tmp_path / "audit.db"), instance_id="instance-test")

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Audited run",
        task_preview="Inspect execution boundaries",
        agent_id="ops-agent",
        session_key="web:session-1",
        origin_channel="web",
        origin_chat_id="session-1",
    )
    service.append_event(
        run.run_id,
        "execution_context_materialized",
        {
            "principalKind": "agent",
            "principalId": "ops-agent",
            "label": "Audited run",
            "workspacePath": "/tmp/workspace",
            "workspaceScope": "shared",
            "sandboxKind": "local",
            "execWorkingDir": "/tmp/workspace",
            "restrictToWorkspace": False,
            "execTimeoutSeconds": 60,
        },
    )
    service.append_event(
        run.run_id,
        "bindings_resolved",
        {
            "toolAllowlist": ["read_file", "message"],
            "mcpServerIds": [],
            "skillIds": [],
            "knowledgeBindingIds": [],
            "knowledgeNames": [],
        },
    )

    audit = service.get_boundary_audit(run.run_id)
    assert audit["lineage"] == {
        "kind": "agent",
        "status": "queued",
        "controlScope": "top_level",
        "parentRunId": None,
        "rootRunId": run.run_id,
        "threadId": None,
        "sessionKey": "web:session-1",
    }
    assert audit["principal"]["principalKind"] == "agent"
    assert audit["principal"]["agentId"] == "ops-agent"
    assert audit["environment"]["workspacePath"] == "/tmp/workspace"
    assert audit["governance"]["toolAllowlist"] == ["read_file", "message"]


def test_run_service_get_artifact_requires_artifact_path(tmp_path: Path) -> None:
    service = RunService(RunStore(tmp_path / "missing-artifact.db"), instance_id="instance-test")

    run = service.create_run(
        kind=RunKind.AGENT,
        label="No artifact run",
        task_preview="No artifact yet",
        session_key="web:artifact-missing",
    )

    with pytest.raises(RunArtifactNotFoundError):
        service.get_artifact(run.run_id)
