"""Unified execution-environment binding helpers for harness runtimes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .sandbox import LocalSandboxProvider, SandboxBinding, SandboxProvider
from .workspace import SharedWorkspaceProvider, WorkspaceBinding, WorkspaceProvider


@dataclass(slots=True)
class ExecutionEnvironmentBinding:
    """Resolved workspace + sandbox bindings for one execution."""

    workspace: WorkspaceBinding
    sandbox: SandboxBinding

    def event_snapshot(self) -> dict[str, Any]:
        payload = {}
        payload.update(self.workspace.event_snapshot())
        payload.update(self.sandbox.event_snapshot())
        return payload


def resolve_execution_environment(
    *,
    workspace: Path,
    restrict_to_workspace: bool,
    exec_config: Any,
    principal_kind: str,
    tenant_id: str | None = None,
    instance_id: str | None = None,
    principal_id: str | None = None,
    team_id: str | None = None,
    thread_id: str | None = None,
    root_run_id: str | None = None,
    session_key: str | None = None,
    workspace_provider: WorkspaceProvider | None = None,
    sandbox_provider: SandboxProvider | None = None,
) -> ExecutionEnvironmentBinding:
    """Resolve the effective workspace and sandbox for one execution."""
    resolved_workspace_provider = workspace_provider or SharedWorkspaceProvider()
    resolved_sandbox_provider = sandbox_provider or LocalSandboxProvider()
    workspace_binding = resolved_workspace_provider.resolve(
        workspace=workspace,
        restrict_to_workspace=restrict_to_workspace,
        principal_kind=principal_kind,
        tenant_id=tenant_id,
        instance_id=instance_id,
        principal_id=principal_id,
        team_id=team_id,
        thread_id=thread_id,
        root_run_id=root_run_id,
        session_key=session_key,
    )
    sandbox_binding = resolved_sandbox_provider.resolve(
        workspace_binding=workspace_binding,
        exec_config=exec_config,
        principal_kind=principal_kind,
        tenant_id=tenant_id,
        instance_id=instance_id,
        principal_id=principal_id,
        team_id=team_id,
        thread_id=thread_id,
        root_run_id=root_run_id,
        session_key=session_key,
    )
    return ExecutionEnvironmentBinding(
        workspace=workspace_binding,
        sandbox=sandbox_binding,
    )
