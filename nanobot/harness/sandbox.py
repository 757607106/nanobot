"""Sandbox binding/provider primitives for execution harness runtimes."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from .workspace import WorkspaceBinding


class SandboxExecutor(Protocol):
    """Execution backend interface for sandboxed shell commands."""

    async def run(
        self,
        command: str,
        *,
        tool: Any,
        host_cwd: str,
        runtime_cwd: str,
        timeout: int,
        path_append: str,
    ) -> str: ...


@dataclass(slots=True)
class SandboxBinding:
    """Resolved sandbox boundary for one execution."""

    kind: str
    working_dir: Path
    host_workspace_path: Path | None = None
    runtime_workdir: str | None = None
    restrict_to_workspace: bool = False
    exec_timeout: int = 60
    path_append: str = ""
    image: str | None = None
    network_mode: str | None = None
    endpoint: str | None = None
    mount_policy: str | None = None
    mounts: tuple[tuple[str, str, bool], ...] = ()
    env_allowlist: tuple[str, ...] = ()
    env: dict[str, str] = field(default_factory=dict)
    tenant_id: str | None = None
    instance_id: str | None = None
    principal_kind: str | None = None
    principal_id: str | None = None
    team_id: str | None = None
    thread_id: str | None = None
    root_run_id: str | None = None
    session_key: str | None = None

    def event_snapshot(self) -> dict[str, Any]:
        """Return a compact event-safe sandbox snapshot."""
        payload: dict[str, Any] = {
            "sandboxKind": self.kind,
            "execWorkingDir": str(self.working_dir),
            "hostWorkspacePath": str(self.host_workspace_path) if self.host_workspace_path else None,
            "runtimeWorkdir": self.runtime_workdir,
            "restrictToWorkspace": self.restrict_to_workspace,
            "execTimeoutSeconds": self.exec_timeout,
            "pathAppendConfigured": bool(self.path_append),
            "sandboxImage": self.image,
            "sandboxNetworkMode": self.network_mode,
            "sandboxEndpoint": self.endpoint,
            "sandboxMountPolicy": self.mount_policy,
            "sandboxMountCount": len(self.mounts),
            "sandboxEnvAllowlistCount": len(self.env_allowlist),
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "principalKind": self.principal_kind,
            "principalId": self.principal_id,
            "teamId": self.team_id,
            "threadId": self.thread_id,
            "rootRunId": self.root_run_id,
            "sessionKey": self.session_key,
        }
        return {key: value for key, value in payload.items() if value is not None}


class SandboxProvider(Protocol):
    """Provider interface for resolving one execution sandbox binding."""

    def resolve(
        self,
        *,
        workspace_binding: WorkspaceBinding,
        exec_config: Any,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        team_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> SandboxBinding: ...

    def get_executor(self, binding: SandboxBinding) -> SandboxExecutor: ...


@dataclass(slots=True)
class LocalSandboxProvider:
    """Default sandbox provider that preserves today's local execution behavior."""

    kind: str = "local"

    def resolve(
        self,
        *,
        workspace_binding: WorkspaceBinding,
        exec_config: Any,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        team_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> SandboxBinding:
        timeout = int(getattr(exec_config, "timeout", 60) or 60)
        path_append = str(getattr(exec_config, "path_append", "") or "")
        resolved_tenant_id = tenant_id if tenant_id is not None else workspace_binding.tenant_id
        resolved_instance_id = instance_id if instance_id is not None else workspace_binding.instance_id
        return SandboxBinding(
            kind=self.kind,
            working_dir=workspace_binding.path,
            host_workspace_path=workspace_binding.path,
            runtime_workdir=str(workspace_binding.path),
            restrict_to_workspace=workspace_binding.restrict_to_workspace,
            exec_timeout=timeout,
            path_append=path_append,
            tenant_id=resolved_tenant_id,
            instance_id=resolved_instance_id,
            principal_kind=principal_kind,
            principal_id=principal_id,
            team_id=team_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )

    def get_executor(self, binding: SandboxBinding) -> SandboxExecutor:
        from nanobot.agent.tools.shell import LocalShellSandboxExecutor

        _ = binding
        return LocalShellSandboxExecutor()


@dataclass(slots=True)
class DockerSandboxProvider:
    """Docker-backed sandbox provider using bind-mount execution."""

    kind: str = "docker"

    def resolve(
        self,
        *,
        workspace_binding: WorkspaceBinding,
        exec_config: Any,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        team_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> SandboxBinding:
        timeout = int(getattr(exec_config, "timeout", 60) or 60)
        path_append = str(getattr(exec_config, "path_append", "") or "")
        runtime_workdir = str(getattr(exec_config, "docker_runtime_workdir", "/workspace") or "/workspace").strip() or "/workspace"
        image = str(getattr(exec_config, "docker_image", "python:3.12-slim") or "python:3.12-slim").strip() or "python:3.12-slim"
        network_mode = str(getattr(exec_config, "docker_network_mode", "bridge") or "bridge").strip() or "bridge"
        mount_policy = str(getattr(exec_config, "docker_mount_policy", "workspace_only") or "workspace_only").strip() or "workspace_only"
        raw_mounts = list(getattr(exec_config, "docker_mounts", []) or [])
        mounts: tuple[tuple[str, str, bool], ...] = ()
        if mount_policy == "workspace_and_mounts":
            parsed_mounts: list[tuple[str, str, bool]] = []
            for raw in raw_mounts:
                mount = _parse_mount_spec(str(raw or ""), workspace_binding.path)
                if mount is not None:
                    parsed_mounts.append(mount)
            mounts = tuple(parsed_mounts)
        env_allowlist = tuple(str(item).strip() for item in (getattr(exec_config, "docker_env_allowlist", []) or []) if str(item).strip())
        resolved_tenant_id = tenant_id if tenant_id is not None else workspace_binding.tenant_id
        resolved_instance_id = instance_id if instance_id is not None else workspace_binding.instance_id
        return SandboxBinding(
            kind=self.kind,
            working_dir=Path(runtime_workdir),
            host_workspace_path=workspace_binding.path,
            runtime_workdir=runtime_workdir,
            restrict_to_workspace=workspace_binding.restrict_to_workspace,
            exec_timeout=timeout,
            path_append=path_append,
            image=image,
            network_mode=network_mode,
            mount_policy=mount_policy,
            mounts=mounts,
            env_allowlist=env_allowlist,
            tenant_id=resolved_tenant_id,
            instance_id=resolved_instance_id,
            principal_kind=principal_kind,
            principal_id=principal_id,
            team_id=team_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )

    def get_executor(self, binding: SandboxBinding) -> SandboxExecutor:
        from nanobot.agent.tools.shell import DockerShellSandboxExecutor

        return DockerShellSandboxExecutor(
            image=str(binding.image or "python:3.12-slim"),
            network_mode=str(binding.network_mode or "bridge"),
            host_workspace_path=str(binding.host_workspace_path or ""),
            runtime_workdir=str(binding.runtime_workdir or binding.working_dir),
            env=dict(binding.env or {}),
            mounts=tuple(binding.mounts or ()),
            env_allowlist=tuple(binding.env_allowlist or ()),
        )


@dataclass(slots=True)
class RemoteSandboxProvider:
    """Remote sandbox skeleton. Execution stays explicitly unsupported for now."""

    kind: str = "remote"

    def resolve(
        self,
        *,
        workspace_binding: WorkspaceBinding,
        exec_config: Any,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str | None = None,
        team_id: str | None = None,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> SandboxBinding:
        timeout = int(getattr(exec_config, "timeout", 60) or 60)
        path_append = str(getattr(exec_config, "path_append", "") or "")
        endpoint = str(getattr(exec_config, "remote_endpoint", "") or "").strip() or None
        resolved_tenant_id = tenant_id if tenant_id is not None else workspace_binding.tenant_id
        resolved_instance_id = instance_id if instance_id is not None else workspace_binding.instance_id
        return SandboxBinding(
            kind=self.kind,
            working_dir=workspace_binding.path,
            host_workspace_path=workspace_binding.path,
            runtime_workdir=str(workspace_binding.path),
            restrict_to_workspace=workspace_binding.restrict_to_workspace,
            exec_timeout=timeout,
            path_append=path_append,
            endpoint=endpoint,
            tenant_id=resolved_tenant_id,
            instance_id=resolved_instance_id,
            principal_kind=principal_kind,
            principal_id=principal_id,
            team_id=team_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )

    def get_executor(self, binding: SandboxBinding) -> SandboxExecutor:
        from nanobot.agent.tools.shell import UnsupportedSandboxExecutor

        return UnsupportedSandboxExecutor(reason=f"Remote sandbox is not configured for endpoint {binding.endpoint or 'unknown'}")


def build_sandbox_provider(exec_config: Any) -> SandboxProvider:
    """Build the effective sandbox provider from exec-tool configuration."""
    kind = str(getattr(exec_config, "sandbox_kind", "local") or "local").strip().lower()
    if kind == "docker":
        return DockerSandboxProvider()
    if kind == "remote":
        return RemoteSandboxProvider()
    return LocalSandboxProvider()


def _parse_mount_spec(raw: str, workspace_root: Path) -> tuple[str, str, bool] | None:
    """Parse one mount spec as `host:container[:ro|rw]`."""
    value = str(raw or "").strip()
    if not value:
        return None
    parts = value.split(":")
    if len(parts) < 2:
        return None
    host = str(parts[0] or "").strip()
    target = str(parts[1] or "").strip()
    if not host or not target:
        return None
    read_only = True
    if len(parts) >= 3:
        mode = str(parts[2] or "").strip().lower()
        read_only = mode != "rw"
    host_path = Path(host).expanduser()
    if not host_path.is_absolute():
        host_path = workspace_root / host_path
    return str(host_path.resolve()), target, read_only
