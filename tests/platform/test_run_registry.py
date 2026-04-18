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

def test_run_service_metric_tracking(tmp_path: Path) -> None:
    service = RunService(RunStore(tmp_path / "metrics.db"), instance_id="instance-metrics")

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Metric Test",
        task_preview="Testing token metrics",
        session_key="web:session-metrics",
    )
    service.start_run(run.run_id)
    
    summary = RunResultSummary(
        content="Success with metrics",
        tools_used=["web_search", "mcp__calculator", "kb__wiki"],
        tools_call_counts={"web_search": 1},
        mcps_call_counts={"mcp__calculator": 1},
        knowledge_call_counts={"kb__wiki": 1},
    )
    
    service.complete_run(
        run.run_id,
        summary,
        provider="anthropic",
        model="claude-4-preview",
        prompt_tokens=150,
        completion_tokens=25,
        cached_tokens=42,
        total_tokens=175,
    )

    detail = service.get_run(run.run_id)
    assert detail["status"] == "succeeded"
    assert detail["provider"] == "anthropic"
    assert detail["model"] == "claude-4-preview"
    assert detail["promptTokens"] == 150
    assert detail["completionTokens"] == 25
    assert detail["cachedTokens"] == 42
    assert detail["totalTokens"] == 175
    
    res_summary = detail["resultSummary"]
    assert res_summary["tools_call_counts"] == {"web_search": 1}
    assert res_summary["mcps_call_counts"] == {"mcp__calculator": 1}
    assert res_summary["knowledge_call_counts"] == {"kb__wiki": 1}

def test_run_service_get_all_agents_metrics(tmp_path: Path) -> None:
    service = RunService(RunStore(tmp_path / "agents_metrics.db"), instance_id="instance-agents-metrics")

    # Create run for agent 1
    run1 = service.create_run(
        kind=RunKind.AGENT,
        label="Agent 1 Run",
        task_preview="Testing agent 1 metrics",
        agent_id="agent-001"
    )
    service.start_run(run1.run_id)
    service.complete_run(
        run1.run_id,
        RunResultSummary(
            content="Agent 1 done",
            tools_used=["toolA"],
            tools_call_counts={"toolA": 2},
            mcps_call_counts={"mcpX": 1},
            knowledge_call_counts={"kbY": 3},
        ),
        provider="openai",
        model="gpt-4",
        prompt_tokens=100,
        completion_tokens=50,
        cached_tokens=20,
        total_tokens=150,
    )

    # Create run for agent 2
    run2 = service.create_run(
        kind=RunKind.AGENT,
        label="Agent 2 Run",
        task_preview="Testing agent 2 metrics",
        agent_id="agent-002"
    )
    service.start_run(run2.run_id)
    service.complete_run(
        run2.run_id,
        RunResultSummary(
            content="Agent 2 done",
            tools_used=["toolB"],
            tools_call_counts={"toolB": 5},
            mcps_call_counts={},
            knowledge_call_counts={"kbZ": 1},
        ),
        provider="anthropic",
        model="claude-3-opus",
        prompt_tokens=200,
        completion_tokens=100,
        cached_tokens=0,
        total_tokens=300,
    )

    # Validate output structure and aggregations
    metrics = service.get_all_agents_metrics()
    
    assert "agent-001" in metrics
    a1_metrics = metrics["agent-001"]
    assert len(a1_metrics["tokens"]) == 1
    assert a1_metrics["tokens"][0]["provider"] == "openai"
    assert a1_metrics["tokens"][0]["totalTokens"] == 150
    assert a1_metrics["tokens"][0]["cachedTokens"] == 20
    assert a1_metrics["tools"]["toolA"] == 2
    assert a1_metrics["mcps"]["mcpX"] == 1
    assert a1_metrics["knowledge"]["kbY"] == 3

    assert "agent-002" in metrics
    a2_metrics = metrics["agent-002"]
    assert a2_metrics["tokens"][0]["provider"] == "anthropic"
    assert a2_metrics["tokens"][0]["totalTokens"] == 300
    assert a2_metrics["tokens"][0]["cachedTokens"] == 0
    assert a2_metrics["tools"]["toolB"] == 5
    assert "mcpX" not in a2_metrics["mcps"]
    assert a2_metrics["knowledge"]["kbZ"] == 1


def test_run_service_cached_tokens_persistence(tmp_path: Path) -> None:
    """Verify cached_tokens flows correctly through the entire store lifecycle."""
    store = RunStore(tmp_path / "cached.db")
    service = RunService(store, instance_id="inst-cached")

    run = service.create_run(
        kind=RunKind.AGENT,
        label="Cached test",
        task_preview="Cached token test",
        session_key="web:cached",
        agent_id="cache-agent",
    )
    service.start_run(run.run_id)
    service.complete_run(
        run.run_id,
        RunResultSummary(content="done"),
        provider="anthropic",
        model="claude-4-sonnet",
        prompt_tokens=1000,
        completion_tokens=200,
        cached_tokens=600,
        total_tokens=1200,
    )

    # Verify via get_run
    detail = service.get_run(run.run_id)
    assert detail["cachedTokens"] == 600

    # Verify via raw store record
    record = store.get_run(run.run_id)
    assert record is not None
    assert record.cached_tokens == 600

    # Verify via global_token_metrics
    global_metrics = store.get_global_token_metrics()
    assert global_metrics["cached_tokens"] == 600

    # Verify via agents_metrics
    agents_m = store.get_all_agents_metrics()
    assert "cache-agent" in agents_m
    assert agents_m["cache-agent"]["tokens"][0]["cachedTokens"] == 600


def test_run_service_metrics_time_range_filtering(tmp_path: Path) -> None:
    """Verify that since/until parameters correctly filter aggregated metrics."""
    store = RunStore(tmp_path / "timerange.db")
    service = RunService(store, instance_id="inst-timerange")

    # Create an older run with a fixed timestamp
    old_run = service.create_run(
        kind=RunKind.AGENT,
        label="Old run",
        task_preview="Old run",
        agent_id="time-agent",
    )
    service.start_run(old_run.run_id)
    service.complete_run(
        old_run.run_id,
        RunResultSummary(
            content="old",
            tools_call_counts={"toolOld": 3},
        ),
        provider="openai",
        model="gpt-4",
        prompt_tokens=100,
        completion_tokens=50,
        total_tokens=150,
    )
    # Manually backdate this run's created_at
    conn = store._connect()
    conn.execute(
        "UPDATE run_records SET created_at = ? WHERE run_id = ?",
        ("2025-01-01T00:00:00Z", old_run.run_id),
    )
    conn.commit()
    conn.close()

    # Create a recent run
    new_run = service.create_run(
        kind=RunKind.AGENT,
        label="New run",
        task_preview="New run",
        agent_id="time-agent",
    )
    service.start_run(new_run.run_id)
    service.complete_run(
        new_run.run_id,
        RunResultSummary(
            content="new",
            tools_call_counts={"toolNew": 7},
        ),
        provider="openai",
        model="gpt-4",
        prompt_tokens=200,
        completion_tokens=100,
        total_tokens=300,
    )

    # Without filtering, both runs should appear
    all_metrics = service.get_all_agents_metrics()
    assert "time-agent" in all_metrics
    assert all_metrics["time-agent"]["tools"].get("toolOld", 0) == 3
    assert all_metrics["time-agent"]["tools"].get("toolNew", 0) == 7

    # Filter to only include runs since 2026-01-01
    filtered = service.get_all_agents_metrics(since="2026-01-01T00:00:00Z")
    assert "time-agent" in filtered
    assert filtered["time-agent"]["tools"].get("toolOld", 0) == 0
    assert filtered["time-agent"]["tools"].get("toolNew", 0) == 7

    # Filter to only include runs until 2025-12-31
    old_only = service.get_all_agents_metrics(until="2025-12-31T23:59:59Z")
    assert "time-agent" in old_only
    assert old_only["time-agent"]["tools"].get("toolOld", 0) == 3
    assert old_only["time-agent"]["tools"].get("toolNew", 0) == 0

    # Filter with both bounds to exclude all
    empty = service.get_all_agents_metrics(
        since="2024-01-01T00:00:00Z", until="2024-12-31T23:59:59Z"
    )
    assert "time-agent" not in empty


def test_run_service_cached_tokens_zero_default(tmp_path: Path) -> None:
    """Verify cached_tokens defaults to 0 when not provided."""
    service = RunService(RunStore(tmp_path / "default_cached.db"), instance_id="inst-default")

    run = service.create_run(
        kind=RunKind.AGENT,
        label="No cache run",
        task_preview="No cache",
        session_key="web:no-cache",
    )
    service.start_run(run.run_id)
    service.complete_run(
        run.run_id,
        RunResultSummary(content="done"),
        provider="openai",
        model="gpt-4",
        prompt_tokens=500,
        completion_tokens=100,
        total_tokens=600,
    )

    detail = service.get_run(run.run_id)
    assert detail["cachedTokens"] == 0

