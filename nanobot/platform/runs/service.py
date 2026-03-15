"""High-level run registry service."""

from __future__ import annotations

import uuid
from collections import deque
from pathlib import Path
from typing import Any

from nanobot.platform.runs.models import (
    RunControlScope,
    RunEvent,
    RunKind,
    RunLimits,
    RunRecord,
    RunResultSummary,
    RunStatus,
    now_iso,
)
from nanobot.platform.runs.store import RunStore


class RunNotFoundError(KeyError):
    """Raised when the requested run does not exist."""


class RunLimitExceededError(RuntimeError):
    """Raised when a new subagent would exceed configured limits."""


class RunStateError(RuntimeError):
    """Raised when the requested run transition is invalid."""


class RunArtifactNotFoundError(FileNotFoundError):
    """Raised when the requested run artifact does not exist."""


class RunService:
    """Run registry facade used by the Web layer and subagent manager."""

    _ACTIVE_STATUSES = (
        RunStatus.QUEUED.value,
        RunStatus.RUNNING.value,
        RunStatus.CANCEL_REQUESTED.value,
    )
    _TERMINAL_STATUSES = {
        RunStatus.SUCCEEDED,
        RunStatus.FAILED,
        RunStatus.CANCELLED,
        RunStatus.TIMED_OUT,
    }

    def __init__(
        self,
        store: RunStore,
        *,
        instance_id: str,
        tenant_id: str = "default",
        limits: RunLimits | None = None,
        artifact_dir: Path | None = None,
    ):
        self.store = store
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.limits = limits or RunLimits()
        self.artifact_dir = artifact_dir
        if self.artifact_dir is not None:
            self.artifact_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _new_run_id() -> str:
        return f"run_{uuid.uuid4().hex[:12]}"

    def create_run(
        self,
        *,
        kind: RunKind,
        label: str,
        task_preview: str,
        agent_id: str | None = None,
        team_id: str | None = None,
        thread_id: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
        origin_channel: str | None = None,
        origin_chat_id: str | None = None,
        spawn_depth: int = 0,
        control_scope: RunControlScope = RunControlScope.TOP_LEVEL,
        workspace_path: str | None = None,
        memory_scope: str | None = None,
        knowledge_scope: str | None = None,
        run_id: str | None = None,
    ) -> RunRecord:
        run_id = run_id or self._new_run_id()
        record = RunRecord(
            run_id=run_id,
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            kind=kind,
            status=RunStatus.QUEUED,
            label=label,
            task_preview=task_preview,
            agent_id=agent_id,
            team_id=team_id,
            thread_id=thread_id,
            parent_run_id=parent_run_id,
            root_run_id=root_run_id or run_id,
            session_key=session_key,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            spawn_depth=spawn_depth,
            control_scope=control_scope,
            workspace_path=workspace_path,
            memory_scope=memory_scope,
            knowledge_scope=knowledge_scope,
        )
        self.store.insert_run(record)
        self.append_event(run_id, "queued", {"label": label, "taskPreview": task_preview})
        return self.require_run(run_id)

    def require_run(self, run_id: str) -> RunRecord:
        record = self.store.get_run(run_id)
        if record is None:
            raise RunNotFoundError(run_id)
        return record

    def _ensure_transition(self, record: RunRecord, *, allowed_from: set[RunStatus]) -> None:
        if record.status not in allowed_from:
            raise RunStateError(f"Run {record.run_id} cannot transition from {record.status.value}.")

    def start_run(self, run_id: str) -> RunRecord:
        record = self.require_run(run_id)
        self._ensure_transition(record, allowed_from={RunStatus.QUEUED})
        updated = self.store.update_run(run_id, status=RunStatus.RUNNING, started_at=now_iso())
        assert updated is not None
        self.append_event(run_id, "started")
        return updated

    def complete_run(
        self,
        run_id: str,
        summary: RunResultSummary,
        *,
        artifact_path: str | None = None,
    ) -> RunRecord:
        record = self.require_run(run_id)
        self._ensure_transition(record, allowed_from={RunStatus.RUNNING})
        updated = self.store.update_run(
            run_id,
            status=RunStatus.SUCCEEDED,
            result_summary=summary,
            artifact_path=artifact_path,
            finished_at=now_iso(),
        )
        assert updated is not None
        self.append_event(run_id, "completed", {"artifactPath": artifact_path})
        return updated

    def fail_run(self, run_id: str, error_code: str, error_message: str) -> RunRecord:
        record = self.require_run(run_id)
        self._ensure_transition(record, allowed_from={RunStatus.RUNNING, RunStatus.QUEUED})
        updated = self.store.update_run(
            run_id,
            status=RunStatus.FAILED,
            last_error_code=error_code,
            last_error_message=error_message,
            finished_at=now_iso(),
        )
        assert updated is not None
        self.append_event(run_id, "failed", {"code": error_code, "message": error_message})
        return updated

    def request_cancel(self, run_id: str) -> RunRecord:
        record = self.require_run(run_id)
        if record.status in self._TERMINAL_STATUSES:
            return record
        updated = self.store.update_run(run_id, status=RunStatus.CANCEL_REQUESTED)
        assert updated is not None
        self.append_event(run_id, "cancel_requested")
        return updated

    def cancel_run(self, run_id: str) -> RunRecord:
        record = self.require_run(run_id)
        if record.status == RunStatus.CANCELLED:
            return record
        if record.status in self._TERMINAL_STATUSES and record.status != RunStatus.CANCELLED:
            raise RunStateError(f"Run {run_id} already finished with {record.status.value}.")
        updated = self.store.update_run(
            run_id,
            status=RunStatus.CANCELLED,
            finished_at=now_iso(),
        )
        assert updated is not None
        self.append_event(run_id, "cancelled")
        return updated

    def append_event(self, run_id: str, event_type: str, payload: dict[str, Any] | None = None) -> RunEvent:
        self.require_run(run_id)
        return self.store.insert_event(RunEvent(run_id=run_id, event_type=event_type, payload=payload))

    def write_markdown_artifact(
        self,
        run_id: str,
        *,
        title: str,
        metadata: dict[str, Any] | None = None,
        sections: list[tuple[str, str]] | None = None,
    ) -> str | None:
        if self.artifact_dir is None:
            return None
        lines = [f"# {title}", ""]
        if metadata:
            lines.append("## Metadata")
            lines.append("")
            for key, value in metadata.items():
                if value is None or value == "":
                    continue
                text = ", ".join(str(item) for item in value) if isinstance(value, list) else str(value)
                lines.append(f"- **{key}**: {text}")
            lines.append("")
        for heading, content in sections or []:
            text = str(content or "").strip()
            if not text:
                continue
            lines.append(f"## {heading}")
            lines.append("")
            lines.append(text)
            lines.append("")
        artifact_path = self.artifact_dir / f"{run_id}.md"
        artifact_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        return artifact_path.name

    def _resolve_artifact_path(self, artifact_path: str) -> Path:
        if self.artifact_dir is None:
            raise RunArtifactNotFoundError("Artifact storage is not configured.")
        base = self.artifact_dir.resolve()
        resolved = (self.artifact_dir / artifact_path).resolve()
        if resolved != base and base not in resolved.parents:
            raise RunArtifactNotFoundError("Artifact path is outside the configured storage.")
        return resolved

    def get_artifact(self, run_id: str) -> dict[str, Any]:
        record = self.require_run(run_id)
        if not record.artifact_path:
            raise RunArtifactNotFoundError(f"Run {run_id} has no artifact.")
        artifact_file = self._resolve_artifact_path(record.artifact_path)
        if not artifact_file.exists():
            raise RunArtifactNotFoundError(f"Artifact for run {run_id} was not found.")
        return {
            "runId": run_id,
            "artifactPath": record.artifact_path,
            "fileName": artifact_file.name,
            "contentType": "text/markdown",
            "content": artifact_file.read_text(encoding="utf-8"),
        }

    def get_run(self, run_id: str, *, include_events: bool = True) -> dict[str, Any]:
        record = self.require_run(run_id)
        children_count = len(self.store.list_runs(parent_run_id=run_id, limit=1000))
        events = self.store.list_events(run_id) if include_events else None
        return record.to_dict(children_count=children_count, events=events)

    def list_runs(
        self,
        *,
        tenant_id: str | None = None,
        status: str | None = None,
        kind: str | None = None,
        agent_id: str | None = None,
        team_id: str | None = None,
        session_key: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        thread_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        records = self.store.list_runs(
            tenant_id=tenant_id or self.tenant_id,
            instance_id=self.instance_id,
            status=status,
            kind=kind,
            agent_id=agent_id,
            team_id=team_id,
            session_key=session_key,
            parent_run_id=parent_run_id,
            root_run_id=root_run_id,
            thread_id=thread_id,
            limit=limit,
        )
        return [
            record.to_dict(children_count=self.store.count_runs(parent_run_id=record.run_id))
            for record in records
        ]

    def list_children(self, parent_run_id: str) -> list[dict[str, Any]]:
        self.require_run(parent_run_id)
        return self.list_runs(parent_run_id=parent_run_id, limit=1000)

    def get_run_tree(self, root_run_id: str) -> dict[str, Any]:
        root = self.get_run(root_run_id, include_events=True)
        nodes: dict[str, dict[str, Any]] = {root["runId"]: root}
        queue: deque[str] = deque([root["runId"]])
        while queue:
            parent_id = queue.popleft()
            children = self.list_children(parent_id)
            nodes[parent_id]["children"] = children
            for child in children:
                nodes[child["runId"]] = child
                queue.append(child["runId"])
        return root

    def count_running_global(self) -> int:
        return self.store.count_runs(statuses=self._ACTIVE_STATUSES)

    def count_running_for_session(self, session_key: str) -> int:
        return self.store.count_runs(statuses=self._ACTIVE_STATUSES, session_key=session_key)

    def check_limits(
        self,
        *,
        session_key: str | None,
        parent_run_id: str | None,
        spawn_depth: int,
    ) -> None:
        if spawn_depth > self.limits.max_spawn_depth:
            raise RunLimitExceededError("Subagent spawn depth limit exceeded.")
        if self.count_running_global() >= self.limits.max_global_running:
            raise RunLimitExceededError("Global subagent concurrency limit exceeded.")
        if session_key and self.count_running_for_session(session_key) >= self.limits.max_running_per_session:
            raise RunLimitExceededError("Session subagent concurrency limit exceeded.")
        if parent_run_id and self.store.count_runs(
            statuses=self._ACTIVE_STATUSES,
            parent_run_id=parent_run_id,
        ) >= self.limits.max_children_per_parent:
            raise RunLimitExceededError("Parent subagent fan-out limit exceeded.")
