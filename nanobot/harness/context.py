"""Explicit execution context and policy primitives for runtime materialization."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from nanobot.platform.runs import RunControlScope


@dataclass(slots=True)
class ToolPolicy:
    """Resolved tool-facing policy for one execution."""

    allowlist: tuple[str, ...] = ()
    mcp_server_ids: tuple[str, ...] = ()
    skill_ids: tuple[str, ...] = ()

    def allowlist_as_list(self) -> list[str]:
        return list(self.allowlist)

    def mcp_server_ids_as_list(self) -> list[str]:
        return list(self.mcp_server_ids)

    def skill_ids_as_list(self) -> list[str]:
        return list(self.skill_ids)


@dataclass(slots=True)
class MemoryPolicy:
    """Resolved memory-facing policy for one execution."""

    scope: str = "agent_profile"
    include_workspace_memory: bool = False
    sections: tuple[tuple[str, str], ...] = ()

    def sections_as_list(self) -> list[tuple[str, str]]:
        return list(self.sections)


@dataclass(slots=True)
class KnowledgePolicy:
    """Resolved knowledge-facing policy for one execution."""

    scope: str = "workspace"
    binding_ids: tuple[str, ...] = ()
    names: tuple[str, ...] = ()
    hits: tuple[dict[str, Any], ...] = ()
    event_payload: dict[str, Any] = field(default_factory=dict)

    def binding_ids_as_list(self) -> list[str]:
        return list(self.binding_ids)

    def names_as_list(self) -> list[str]:
        return list(self.names)

    def hits_as_list(self) -> list[dict[str, Any]]:
        return list(self.hits)

    def event_snapshot(self) -> dict[str, Any]:
        return dict(self.event_payload)


@dataclass(slots=True)
class ExecutionContext:
    """Explicit runtime context for one agent or child-agent execution."""

    tenant_id: str
    instance_id: str
    principal_kind: str
    principal_id: str
    label: str
    agent_id: str | None = None
    team_id: str | None = None
    role: str | None = None
    run_id: str | None = None
    root_run_id: str | None = None
    parent_run_id: str | None = None
    session_key: str = ""
    session_id: str = ""
    session_title: str = ""
    thread_id: str | None = None
    origin_channel: str = "web"
    origin_chat_id: str = "direct"
    spawn_depth: int = 0
    control_scope: RunControlScope = RunControlScope.TOP_LEVEL
    workspace_path: str | None = None
    workspace_scope: str = "shared"
    sandbox_kind: str = "local"
    exec_working_dir: str | None = None
    restrict_to_workspace: bool = False
    exec_timeout_seconds: int | None = None
    tool_policy: ToolPolicy = field(default_factory=ToolPolicy)
    memory_policy: MemoryPolicy = field(default_factory=MemoryPolicy)
    knowledge_policy: KnowledgePolicy = field(default_factory=KnowledgePolicy)

    @property
    def effective_run_id(self) -> str | None:
        return self.run_id or self.root_run_id

    @property
    def effective_root_run_id(self) -> str | None:
        return self.root_run_id or self.run_id

    def event_snapshot(self) -> dict[str, Any]:
        """Return a stable run-event snapshot for execution lineage and audit."""
        payload: dict[str, Any] = {
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "principalKind": self.principal_kind,
            "principalId": self.principal_id,
            "label": self.label,
            "agentId": self.agent_id,
            "teamId": self.team_id,
            "role": self.role,
            "runId": self.run_id,
            "rootRunId": self.effective_root_run_id,
            "parentRunId": self.parent_run_id,
            "sessionKey": self.session_key,
            "sessionId": self.session_id,
            "sessionTitle": self.session_title,
            "threadId": self.thread_id,
            "originChannel": self.origin_channel,
            "originChatId": self.origin_chat_id,
            "spawnDepth": self.spawn_depth,
            "controlScope": self.control_scope.value,
            "workspacePath": self.workspace_path,
            "workspaceScope": self.workspace_scope,
            "sandboxKind": self.sandbox_kind,
            "execWorkingDir": self.exec_working_dir,
            "restrictToWorkspace": self.restrict_to_workspace,
            "execTimeoutSeconds": self.exec_timeout_seconds,
            "toolAllowlist": self.tool_policy.allowlist_as_list(),
            "mcpServerIds": self.tool_policy.mcp_server_ids_as_list(),
            "skillIds": self.tool_policy.skill_ids_as_list(),
            "memoryScope": self.memory_policy.scope,
            "includeWorkspaceMemory": self.memory_policy.include_workspace_memory,
            "memorySectionCount": len(self.memory_policy.sections),
            "knowledgeScope": self.knowledge_policy.scope,
            "knowledgeBindingIds": self.knowledge_policy.binding_ids_as_list(),
            "knowledgeNames": self.knowledge_policy.names_as_list(),
            "knowledgeHitCount": len(self.knowledge_policy.hits),
        }
        return {key: value for key, value in payload.items() if value is not None}

    def artifact_metadata(self, *, kind: str) -> dict[str, Any]:
        """Return the shared artifact metadata projection for one execution."""
        payload: dict[str, Any] = {
            "run_id": self.effective_run_id,
            "kind": kind,
            "tenant_id": self.tenant_id,
            "instance_id": self.instance_id,
            "agent_id": self.agent_id,
            "team_id": self.team_id,
            "role": self.role,
            "thread_id": self.thread_id,
            "origin_channel": self.origin_channel,
            "origin_chat_id": self.origin_chat_id,
            "principal_kind": self.principal_kind,
            "principal_id": self.principal_id,
            "workspace_path": self.workspace_path,
            "workspace_scope": self.workspace_scope,
            "sandbox_kind": self.sandbox_kind,
            "exec_working_dir": self.exec_working_dir,
            "restrict_to_workspace": self.restrict_to_workspace,
            "exec_timeout_seconds": self.exec_timeout_seconds,
            "memory_scope": self.memory_policy.scope,
            "workspace_memory_included": self.memory_policy.include_workspace_memory,
            "memory_section_count": len(self.memory_policy.sections),
            "knowledge_scope": self.knowledge_policy.scope,
            "knowledge_binding_ids": self.knowledge_policy.binding_ids_as_list(),
            "knowledge_names": self.knowledge_policy.names_as_list(),
            "knowledge_hits": len(self.knowledge_policy.hits),
        }
        return {key: value for key, value in payload.items() if value is not None}

    def to_agent_loop_run_context(self) -> dict[str, Any]:
        """Return the normalized child-task lineage payload for AgentLoop."""
        payload = {
            "run_id": self.effective_run_id,
            "root_run_id": self.effective_root_run_id,
            "tenant_id": self.tenant_id,
            "instance_id": self.instance_id,
            "agent_id": self.agent_id,
            "team_id": self.team_id,
            "thread_id": self.thread_id,
            "spawn_depth": self.spawn_depth,
            "principal_kind": self.principal_kind,
            "principal_id": self.principal_id,
            "role": self.role,
            "control_scope": self.control_scope.value,
            "memory_scope": self.memory_policy.scope,
            "knowledge_scope": self.knowledge_policy.scope,
            "workspace_scope": self.workspace_scope,
            "sandbox_kind": self.sandbox_kind,
            "restrict_to_workspace": self.restrict_to_workspace,
        }
        return {key: value for key, value in payload.items() if value is not None}
