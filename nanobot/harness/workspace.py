"""Workspace binding/provider primitives for execution harness runtimes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Protocol


@dataclass(slots=True)
class WorkspaceBinding:
    """Resolved workspace boundary for one execution."""

    path: Path
    scope: str = "shared"
    restrict_to_workspace: bool = False
    tenant_id: str | None = None
    instance_id: str | None = None
    principal_kind: str | None = None
    principal_id: str | None = None
    thread_id: str | None = None
    root_run_id: str | None = None
    session_key: str | None = None

    def event_snapshot(self) -> dict[str, Any]:
        """Return a compact event-safe workspace snapshot."""
        payload: dict[str, Any] = {
            "workspacePath": str(self.path),
            "workspaceScope": self.scope,
            "restrictToWorkspace": self.restrict_to_workspace,
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "principalKind": self.principal_kind,
            "principalId": self.principal_id,
            "threadId": self.thread_id,
            "rootRunId": self.root_run_id,
            "sessionKey": self.session_key,
        }
        return {key: value for key, value in payload.items() if value is not None}


class WorkspaceProvider(Protocol):
    """Provider interface for resolving one execution workspace binding."""

    def resolve(
        self,
        *,
        workspace: Path,
        restrict_to_workspace: bool,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> WorkspaceBinding: ...


@dataclass(slots=True)
class SharedWorkspaceProvider:
    """Default provider that preserves today's shared-workspace behavior."""

    scope: str = "shared"

    def resolve(
        self,
        *,
        workspace: Path,
        restrict_to_workspace: bool,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> WorkspaceBinding:
        return WorkspaceBinding(
            path=workspace,
            scope=self.scope,
            restrict_to_workspace=restrict_to_workspace,
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_kind=principal_kind,
            principal_id=principal_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )


def _sanitize_workspace_segment(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip("-.")
    return normalized[:96] or "default"


@dataclass(slots=True)
class ThreadWorkspaceProvider:
    """Resolve a conversation-scoped workspace under the main project workspace."""

    scope: str = "thread"
    base_dir: str = ".nanobot/workspaces/threads"
    force_restrict_to_workspace: bool = True

    def resolve(
        self,
        *,
        workspace: Path,
        restrict_to_workspace: bool,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> WorkspaceBinding:
        scope_key = (
            str(thread_id or "").strip()
            or str(session_key or "").strip()
            or str(root_run_id or "").strip()
            or str(principal_id or "").strip()
            or str(principal_kind or "").strip()
            or "default"
        )
        base_path = Path(self.base_dir)
        resolved_base = base_path if base_path.is_absolute() else workspace / base_path
        resolved_path = resolved_base / _sanitize_workspace_segment(scope_key)
        resolved_path.mkdir(parents=True, exist_ok=True)
        return WorkspaceBinding(
            path=resolved_path,
            scope=self.scope,
            restrict_to_workspace=self.force_restrict_to_workspace or restrict_to_workspace,
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_kind=principal_kind,
            principal_id=principal_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )


@dataclass(slots=True)
class AgentWorkspaceProvider:
    """Resolve an agent-scoped workspace under the main project workspace."""

    scope: str = "agent"
    base_dir: str = ".nanobot/workspaces/agents"
    force_restrict_to_workspace: bool = True

    def resolve(
        self,
        *,
        workspace: Path,
        restrict_to_workspace: bool,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> WorkspaceBinding:
        scope_key = (
            str(principal_id or "").strip()
            or str(root_run_id or "").strip()
            or str(principal_kind or "").strip()
            or "default"
        )
        base_path = Path(self.base_dir)
        resolved_base = base_path if base_path.is_absolute() else workspace / base_path
        resolved_path = resolved_base / _sanitize_workspace_segment(scope_key)
        resolved_path.mkdir(parents=True, exist_ok=True)
        return WorkspaceBinding(
            path=resolved_path,
            scope=self.scope,
            restrict_to_workspace=self.force_restrict_to_workspace or restrict_to_workspace,
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_kind=principal_kind,
            principal_id=principal_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )


@dataclass(slots=True)
class AgentThreadWorkspaceProvider:
    """Resolve a tenant/instance/agent/thread-scoped workspace path."""

    scope: str = "agent_thread"
    base_dir: str = ".nanobot/workspaces/tenants"
    force_restrict_to_workspace: bool = True
    agent_segment: str = "agents"
    thread_segment: str = "threads"

    def resolve(
        self,
        *,
        workspace: Path,
        restrict_to_workspace: bool,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> WorkspaceBinding:
        base_path = Path(self.base_dir)
        resolved_base = base_path if base_path.is_absolute() else workspace / base_path
        resolved_tenant = _sanitize_workspace_segment(str(tenant_id or "default"))
        resolved_instance = _sanitize_workspace_segment(str(instance_id or "default"))
        resolved_agent = _sanitize_workspace_segment(
            str(principal_id or principal_kind or "agent")
        )
        resolved_thread = _sanitize_workspace_segment(
            str(thread_id or session_key or root_run_id or "default")
        )
        resolved_path = (
            resolved_base
            / resolved_tenant
            / resolved_instance
            / self.agent_segment
            / resolved_agent
            / self.thread_segment
            / resolved_thread
        )
        resolved_path.mkdir(parents=True, exist_ok=True)
        return WorkspaceBinding(
            path=resolved_path,
            scope=self.scope,
            restrict_to_workspace=self.force_restrict_to_workspace or restrict_to_workspace,
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_kind=principal_kind,
            principal_id=principal_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )


@dataclass(slots=True)
class TenantScopedWorkspaceProvider:
    """Rebase any workspace provider under a tenant/instance-scoped directory."""

    delegate: WorkspaceProvider | None = None
    base_dir: str = ".nanobot/workspaces/tenants"
    include_scope_segment: bool = True

    def resolve(
        self,
        *,
        workspace: Path,
        restrict_to_workspace: bool,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> WorkspaceBinding:
        base_provider = self.delegate or SharedWorkspaceProvider()
        binding = base_provider.resolve(
            workspace=workspace,
            restrict_to_workspace=restrict_to_workspace,
            principal_kind=principal_kind,
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_id=principal_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )
        resolved_tenant = _sanitize_workspace_segment(str(tenant_id or "default"))
        resolved_instance = _sanitize_workspace_segment(str(instance_id or "default"))
        base_path = Path(self.base_dir)
        tenant_root = (base_path if base_path.is_absolute() else workspace / base_path) / resolved_tenant / resolved_instance
        if self.include_scope_segment:
            tenant_root = tenant_root / _sanitize_workspace_segment(binding.scope)
        leaf_name = (
            "shared"
            if binding.scope == "shared"
            else _sanitize_workspace_segment(binding.path.name)
        )
        rebased_path = tenant_root / leaf_name
        rebased_path.mkdir(parents=True, exist_ok=True)
        return WorkspaceBinding(
            path=rebased_path,
            scope=binding.scope,
            restrict_to_workspace=binding.restrict_to_workspace,
            tenant_id=str(tenant_id or "default"),
            instance_id=str(instance_id or "default"),
            principal_kind=binding.principal_kind,
            principal_id=binding.principal_id,
            thread_id=binding.thread_id,
            root_run_id=binding.root_run_id,
            session_key=binding.session_key,
        )


@dataclass(slots=True)
class WorkspaceContext:
    """Unified workspace paths for one agent execution.

    Attributes:
        identity_root: Root for global identity files (SOUL.md, AGENTS.md, etc.).
        agent_root: Root for agent-isolated data (memory, sessions, skills, tool results).
        virtual_path: Path shown to the LLM in sandboxed environments.
    """

    identity_root: Path
    agent_root: Path
    virtual_path: Path | None = None

    @classmethod
    def shared(cls, workspace: Path) -> WorkspaceContext:
        """Shortcut for CLI single-agent mode: identity and agent share the same root."""
        return cls(identity_root=workspace, agent_root=workspace)

    @property
    def display_path(self) -> Path:
        """Return the path to show the LLM (virtual_path if set, otherwise agent_root)."""
        return self.virtual_path or self.agent_root
