from __future__ import annotations

from types import SimpleNamespace

from nanobot.platform.runs import RunKind, RunResultSummary, RunService, RunStore
from nanobot.platform.tenants import TenantService, TenantStore
from nanobot.web.runtime_services.schedule import WebScheduleRuntimeService


def test_schedule_runtime_sweeps_artifact_retention_across_tenants(tmp_path) -> None:
    runs = RunService(
        RunStore(tmp_path / "runs.db"),
        instance_id="instance-test",
    )
    tenants = TenantService(TenantStore(tmp_path / "tenants.db"))
    tenants.create_tenant({"tenantId": "tenant-a", "name": "Tenant A"})

    default_run = runs.create_run(
        kind=RunKind.AGENT,
        label="Default tenant artifact",
        task_preview="Default tenant retention",
        session_key="web:default-retention",
    )
    runs.start_run(default_run.run_id)
    default_artifact = runs.write_markdown_artifact(
        default_run.run_id,
        title="Default tenant artifact",
        sections=[("Summary", "Default tenant content.")],
    )
    runs.complete_run(
        default_run.run_id,
        RunResultSummary(content="Default tenant content."),
        artifact_path=default_artifact,
    )
    runs.set_artifact_retention_policy(
        default_run.run_id,
        archive_after_days=0,
        delete_after_days=14,
        reason="default retention",
    )

    tenant_runs = runs.with_tenant("tenant-a")
    tenant_run = tenant_runs.create_run(
        kind=RunKind.AGENT,
        label="Tenant A artifact",
        task_preview="Tenant A retention",
        tenant_id="tenant-a",
        session_key="web:tenant-a-retention",
    )
    tenant_runs.start_run(tenant_run.run_id)
    tenant_artifact = tenant_runs.write_markdown_artifact(
        tenant_run.run_id,
        title="Tenant A artifact",
        sections=[("Summary", "Tenant A content.")],
    )
    tenant_runs.complete_run(
        tenant_run.run_id,
        RunResultSummary(content="Tenant A content."),
        artifact_path=tenant_artifact,
    )
    tenant_runs.set_artifact_retention_policy(
        tenant_run.run_id,
        archive_after_days=0,
        delete_after_days=7,
        reason="tenant retention",
    )

    state = SimpleNamespace(
        runs=runs,
        tenants_service=tenants,
        _artifact_retention_task=None,
        _artifact_retention_sweep_interval_s=1800,
    )
    service = WebScheduleRuntimeService(state)

    result = service._run_artifact_retention_sweep()

    assert result["evaluated"] == 2
    assert result["applied"] == 2
    assert result["archived"] == 2
    assert result["deleted"] == 0
    assert {item["tenantId"] for item in result["tenants"]} == {"default", "tenant-a"}
    assert runs.get_artifact_audit(default_run.run_id)["lifecycleStatus"] == "archived"
    assert tenant_runs.get_artifact_audit(tenant_run.run_id)["lifecycleStatus"] == "archived"
