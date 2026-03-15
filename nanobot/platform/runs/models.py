"""Run registry models for subagent and future multi-agent runtime state."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


def now_iso() -> str:
    """Return an RFC 3339-like UTC timestamp."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class RunKind(StrEnum):
    """High-level run kind."""

    AGENT = "agent"
    SUBAGENT = "subagent"
    TEAM = "team"


class RunStatus(StrEnum):
    """Lifecycle states for one run."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"


class RunControlScope(StrEnum):
    """How the run relates to the broader execution tree."""

    TOP_LEVEL = "top_level"
    CHILD = "child"
    LEADER = "leader"
    MEMBER = "member"


@dataclass(slots=True)
class RunErrorSummary:
    """Compact failure summary stored on the run record."""

    code: str
    message: str


@dataclass(slots=True)
class RunResultSummary:
    """Compact success summary stored on the run record."""

    content: str | None = None
    tools_used: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RunEvent:
    """One persisted run event."""

    run_id: str
    event_type: str
    payload: dict[str, Any] | None = None
    event_id: int | None = None
    created_at: str = field(default_factory=now_iso)

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "eventId": self.event_id,
            "runId": self.run_id,
            "eventType": self.event_type,
            "payload": self.payload or {},
            "createdAt": self.created_at,
        }
        return payload


@dataclass(slots=True)
class RunLimits:
    """Default runtime limits for subagent execution."""

    max_global_running: int = 8
    max_running_per_session: int = 4
    max_children_per_parent: int = 8
    max_spawn_depth: int = 1


@dataclass(slots=True)
class RunRecord:
    """Stored run metadata for subagent execution."""

    run_id: str
    tenant_id: str
    instance_id: str
    kind: RunKind
    status: RunStatus
    label: str
    task_preview: str
    agent_id: str | None = None
    team_id: str | None = None
    thread_id: str | None = None
    parent_run_id: str | None = None
    root_run_id: str | None = None
    session_key: str | None = None
    origin_channel: str | None = None
    origin_chat_id: str | None = None
    spawn_depth: int = 0
    control_scope: RunControlScope = RunControlScope.TOP_LEVEL
    workspace_path: str | None = None
    memory_scope: str | None = None
    knowledge_scope: str | None = None
    created_at: str = field(default_factory=now_iso)
    started_at: str | None = None
    finished_at: str | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None
    result_summary: RunResultSummary | None = None
    artifact_path: str | None = None

    def to_dict(self, *, children_count: int | None = None, events: list[RunEvent] | None = None) -> dict[str, Any]:
        payload = asdict(self)
        payload["kind"] = self.kind.value
        payload["status"] = self.status.value
        payload["control_scope"] = self.control_scope.value
        payload["result_summary"] = asdict(self.result_summary) if self.result_summary else None
        payload["runId"] = payload.pop("run_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["taskPreview"] = payload.pop("task_preview")
        payload["agentId"] = payload.pop("agent_id")
        payload["teamId"] = payload.pop("team_id")
        payload["threadId"] = payload.pop("thread_id")
        payload["parentRunId"] = payload.pop("parent_run_id")
        payload["rootRunId"] = payload.pop("root_run_id")
        payload["sessionKey"] = payload.pop("session_key")
        payload["originChannel"] = payload.pop("origin_channel")
        payload["originChatId"] = payload.pop("origin_chat_id")
        payload["spawnDepth"] = payload.pop("spawn_depth")
        payload["controlScope"] = payload.pop("control_scope")
        payload["workspacePath"] = payload.pop("workspace_path")
        payload["memoryScope"] = payload.pop("memory_scope")
        payload["knowledgeScope"] = payload.pop("knowledge_scope")
        payload["createdAt"] = payload.pop("created_at")
        payload["startedAt"] = payload.pop("started_at")
        payload["finishedAt"] = payload.pop("finished_at")
        payload["lastErrorCode"] = payload.pop("last_error_code")
        payload["lastErrorMessage"] = payload.pop("last_error_message")
        payload["resultSummary"] = payload.pop("result_summary")
        payload["artifactPath"] = payload.pop("artifact_path")
        if children_count is not None:
            payload["childrenCount"] = children_count
        if events is not None:
            payload["events"] = [event.to_dict() for event in events]
        return payload

