"""Thin child-task protocol shared by team members and subagents."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

from nanobot.platform.runs import RunControlScope
from .context import ExecutionContext, KnowledgePolicy, MemoryPolicy, ToolPolicy


@dataclass(slots=True)
class ChildTaskRequest:
    """Normalized child-task request passed across execution surfaces."""

    task: str
    label: str = ""
    tenant_id: str | None = None
    instance_id: str | None = None
    principal_kind: str = "child_task"
    principal_id: str | None = None
    agent_definition: dict[str, Any] | None = None
    agent_id: str | None = None
    team_id: str | None = None
    thread_id: str | None = None
    session_key: str = ""
    session_id: str = ""
    session_title: str = ""
    origin_channel: str = "web"
    origin_chat_id: str = "direct"
    control_scope: RunControlScope = RunControlScope.CHILD
    parent_run_id: str | None = None
    root_run_id: str | None = None
    spawn_depth: int = 0
    timeout_seconds: int | None = None
    additional_prompt_sections: tuple[str, ...] = ()
    include_workspace_memory: bool | None = None
    memory_sections: tuple[tuple[str, str], ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def resolved_label(self) -> str:
        label = str(self.label or "").strip()
        if label:
            return label
        task = str(self.task or "").strip()
        return task[:30] + ("..." if len(task) > 30 else "")

    def resolved_session_key(self) -> str:
        session_key = str(self.session_key or "").strip()
        if session_key:
            return session_key
        return f"{self.origin_channel}:{self.origin_chat_id}"

    def resolved_session_id(self) -> str:
        session_id = str(self.session_id or "").strip()
        return session_id or self.resolved_session_key()

    def additional_prompt_sections_as_list(self) -> list[str]:
        return list(self.additional_prompt_sections)

    def memory_sections_as_list(self) -> list[tuple[str, str]]:
        return list(self.memory_sections)


@dataclass(slots=True)
class ChildTaskResult:
    """Normalized child-task result for structured delegation call sites."""

    status: str
    content: str
    task: str
    label: str
    principal_kind: str = "child_task"
    principal_id: str | None = None
    agent_id: str | None = None
    team_id: str | None = None
    thread_id: str | None = None
    run_id: str | None = None
    session_key: str = ""
    session_id: str = ""
    origin_channel: str = "web"
    origin_chat_id: str = "direct"
    metadata: dict[str, Any] = field(default_factory=dict)
    raw_result: dict[str, Any] | None = None

    @classmethod
    def from_agent_run(
        cls,
        request: ChildTaskRequest,
        run_result: dict[str, Any],
    ) -> ChildTaskResult:
        run = run_result.get("run") or {}
        assistant_message = run_result.get("assistantMessage") or {}
        summary = run.get("resultSummary") or {}
        raw_status = str(run.get("status") or "").strip().lower()
        normalized_status = "ok" if raw_status in {"", "succeeded"} else raw_status
        content = (
            str(assistant_message.get("content") or "").strip()
            or str(summary.get("content") or "").strip()
            or "(no response)"
        )
        return cls(
            status=normalized_status,
            content=content,
            task=str(request.task or "").strip(),
            label=request.resolved_label(),
            principal_kind=request.principal_kind,
            principal_id=request.principal_id or request.agent_id,
            agent_id=request.agent_id,
            team_id=request.team_id,
            thread_id=request.thread_id,
            run_id=str(run.get("runId") or "").strip() or None,
            session_key=request.resolved_session_key(),
            session_id=request.resolved_session_id(),
            origin_channel=str(request.origin_channel or "").strip() or "web",
            origin_chat_id=str(request.origin_chat_id or "").strip() or "direct",
            metadata={"runStatus": raw_status or "succeeded"},
            raw_result=run_result,
        )


@dataclass(slots=True)
class ChildTaskHandle:
    """Stable parent-facing handle for one delegated child task."""

    request: ChildTaskRequest
    run_id: str | None = None
    parent_run_id: str | None = None
    root_run_id: str | None = None
    handle_id: str = field(default_factory=lambda: uuid.uuid4().hex)

    def event_target_run_id(self) -> str | None:
        return self.parent_run_id or self.root_run_id

    def scheduled_payload(self, *, call_index: int | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "handleId": self.handle_id,
            "tenantId": self.request.tenant_id,
            "instanceId": self.request.instance_id,
            "childRunId": self.run_id,
            "parentRunId": self.parent_run_id,
            "rootRunId": self.root_run_id,
            "principalKind": self.request.principal_kind,
            "principalId": self.request.principal_id or self.request.agent_id,
            "agentId": self.request.agent_id,
            "teamId": self.request.team_id,
            "threadId": self.request.thread_id,
            "label": self.request.resolved_label(),
            "task": str(self.request.task or "").strip(),
            "sessionKey": self.request.resolved_session_key(),
            "originChannel": str(self.request.origin_channel or "").strip() or "web",
            "originChatId": str(self.request.origin_chat_id or "").strip() or "direct",
            "spawnDepth": self.request.spawn_depth,
            "timeoutSeconds": self.request.timeout_seconds,
        }
        if call_index is not None:
            payload["callIndex"] = call_index
        return {key: value for key, value in payload.items() if value is not None}

    def completed_payload(
        self,
        *,
        status: str,
        result: ChildTaskResult | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        payload = self.scheduled_payload()
        payload["status"] = str(status or "").strip() or "ok"
        if result is not None:
            payload["childRunId"] = result.run_id or payload.get("childRunId")
            payload["content"] = str(result.content or "").strip()
            payload["metadata"] = dict(result.metadata or {})
        if error:
            payload["error"] = str(error).strip()
        return payload


@dataclass(slots=True)
class ChildTaskProjector:
    """Project normalized child-task lifecycle events back to a parent run."""

    runs: Any
    legacy_scheduled_event: str | None = None
    legacy_completed_event: str | None = None

    def project_scheduled(
        self,
        handle: ChildTaskHandle,
        *,
        call_index: int | None = None,
        legacy_payload: dict[str, Any] | None = None,
    ) -> None:
        target_run_id = handle.event_target_run_id()
        if not target_run_id:
            return
        if self.legacy_scheduled_event and legacy_payload is not None:
            self.runs.append_event(target_run_id, self.legacy_scheduled_event, legacy_payload)
        self.runs.append_event(
            target_run_id,
            "child_task_scheduled",
            handle.scheduled_payload(call_index=call_index),
        )

    def project_completed(
        self,
        handle: ChildTaskHandle,
        *,
        status: str,
        result: ChildTaskResult | None = None,
        error: str | None = None,
        legacy_payload: dict[str, Any] | None = None,
    ) -> None:
        target_run_id = handle.event_target_run_id()
        if not target_run_id:
            return
        if self.legacy_completed_event and legacy_payload is not None:
            self.runs.append_event(target_run_id, self.legacy_completed_event, legacy_payload)
        self.runs.append_event(
            target_run_id,
            "child_task_completed",
            handle.completed_payload(status=status, result=result, error=error),
        )

    def project_progress(
        self,
        handle: ChildTaskHandle,
        *,
        status: str,
        message: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Project one normalized child-task progress event back to a parent run."""
        target_run_id = handle.event_target_run_id()
        if not target_run_id:
            return
        progress_payload = handle.scheduled_payload()
        progress_payload["status"] = str(status or "").strip() or "running"
        if message:
            progress_payload["message"] = str(message).strip()
        if payload:
            progress_payload.update({key: value for key, value in payload.items() if value is not None})
        self.runs.append_event(target_run_id, "child_task_progress", progress_payload)


ChildTaskExecutor = Callable[[ChildTaskHandle], Awaitable[ChildTaskResult]]
LegacyCompletedPayloadFactory = Callable[[ChildTaskHandle, ChildTaskResult], dict[str, Any] | None]


class ChildTaskRuntime(Protocol):
    """Shared child-task lifecycle contract used by team members and subagents."""

    async def start(
        self,
        request: ChildTaskRequest,
        *,
        executor: ChildTaskExecutor,
        run_id: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        call_index: int | None = None,
        legacy_scheduled_payload: dict[str, Any] | None = None,
        legacy_completed_payload_factory: LegacyCompletedPayloadFactory | None = None,
    ) -> ChildTaskHandle: ...

    async def wait(self, handle: ChildTaskHandle) -> ChildTaskResult: ...

    async def cancel(self, handle: ChildTaskHandle) -> bool: ...


@dataclass(slots=True)
class _ChildTaskEntry:
    """Registry entry for one in-process child task."""

    handle: ChildTaskHandle
    task: asyncio.Task[ChildTaskResult]


class InProcessChildTaskRuntime:
    """Minimal in-process child-task runtime with shared start/wait/cancel semantics."""

    def __init__(self, *, projector: ChildTaskProjector | None = None):
        self._projector = projector
        self._entries: dict[str, _ChildTaskEntry] = {}
        self._session_index: dict[str, set[str]] = {}
        self._run_index: dict[str, str] = {}

    async def start(
        self,
        request: ChildTaskRequest,
        *,
        executor: ChildTaskExecutor,
        run_id: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        call_index: int | None = None,
        legacy_scheduled_payload: dict[str, Any] | None = None,
        legacy_completed_payload_factory: LegacyCompletedPayloadFactory | None = None,
    ) -> ChildTaskHandle:
        """Schedule a child task and return a stable lifecycle handle."""
        handle = ChildTaskHandle(
            request=request,
            run_id=run_id,
            parent_run_id=parent_run_id,
            root_run_id=root_run_id,
        )
        if handle.run_id:
            self._run_index[handle.run_id] = handle.handle_id
        self._session_index.setdefault(request.resolved_session_key(), set()).add(handle.handle_id)
        if self._projector is not None:
            self._projector.project_scheduled(
                handle,
                call_index=call_index,
                legacy_payload=legacy_scheduled_payload,
            )
        task = asyncio.create_task(
            self._execute(
                handle,
                executor=executor,
                legacy_completed_payload_factory=legacy_completed_payload_factory,
            )
        )
        self._entries[handle.handle_id] = _ChildTaskEntry(handle=handle, task=task)
        task.add_done_callback(lambda _: self._discard_session_handle(handle))
        return handle

    async def wait(self, handle: ChildTaskHandle) -> ChildTaskResult:
        """Wait for one child task to finish and return its normalized result."""
        entry = self._entries.get(handle.handle_id)
        if entry is None:
            raise KeyError(f"Unknown child task handle: {handle.handle_id}")
        return await entry.task

    async def cancel(self, handle: ChildTaskHandle) -> bool:
        """Cancel one child task if it is still running."""
        entry = self._entries.get(handle.handle_id)
        if entry is None or entry.task.done():
            return False
        entry.task.cancel()
        await asyncio.gather(entry.task, return_exceptions=True)
        return True

    def project_handle_progress(
        self,
        handle: ChildTaskHandle,
        *,
        status: str = "running",
        message: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> bool:
        """Project progress for one running child task by handle."""
        entry = self._entries.get(handle.handle_id)
        if entry is None or entry.task.done() or self._projector is None:
            return False
        self._projector.project_progress(
            handle,
            status=status,
            message=message,
            payload=payload,
        )
        return True

    def project_progress(
        self,
        *,
        run_id: str,
        status: str = "running",
        message: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> bool:
        """Project progress for one running child task by child run id."""
        handle = self.get_handle_by_run_id(run_id)
        if handle is None:
            return False
        return self.project_handle_progress(
            handle,
            status=status,
            message=message,
            payload=payload,
        )

    async def cancel_run(self, run_id: str) -> bool:
        """Cancel a child task by its run id when available."""
        handle = self.get_handle_by_run_id(run_id)
        if handle is None:
            return False
        return await self.cancel(handle)

    async def cancel_session(self, session_key: str) -> int:
        """Cancel all running child tasks attached to one session."""
        handles = self.list_session_handles(session_key)
        tasks: list[asyncio.Task[ChildTaskResult]] = []
        for handle in handles:
            entry = self._entries.get(handle.handle_id)
            if entry is None or entry.task.done():
                continue
            entry.task.cancel()
            tasks.append(entry.task)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        return len(tasks)

    def get_running_count(self) -> int:
        """Return the number of child tasks that are still running."""
        return sum(1 for entry in self._entries.values() if not entry.task.done())

    def get_handle_by_run_id(self, run_id: str) -> ChildTaskHandle | None:
        """Resolve a lifecycle handle from a child run id."""
        handle_id = self._run_index.get(str(run_id or "").strip())
        if not handle_id:
            return None
        entry = self._entries.get(handle_id)
        return entry.handle if entry is not None else None

    def list_session_handles(self, session_key: str) -> list[ChildTaskHandle]:
        """List handles known for one session key."""
        handles: list[ChildTaskHandle] = []
        for handle_id in self._session_index.get(str(session_key or "").strip(), set()):
            entry = self._entries.get(handle_id)
            if entry is not None:
                handles.append(entry.handle)
        return handles

    async def _execute(
        self,
        handle: ChildTaskHandle,
        *,
        executor: ChildTaskExecutor,
        legacy_completed_payload_factory: LegacyCompletedPayloadFactory | None = None,
    ) -> ChildTaskResult:
        try:
            if self._projector is not None:
                self._projector.project_progress(
                    handle,
                    status="running",
                    message="Started execution",
                    payload={"stage": "running"},
                )
            result = await executor(handle)
        except asyncio.CancelledError:
            result = self._build_terminal_result(handle, status="cancelled", content="Cancelled")
        except asyncio.TimeoutError:
            timeout_seconds = int(handle.request.timeout_seconds or 0)
            timeout_text = (
                f"Timeout after {timeout_seconds}s"
                if timeout_seconds > 0
                else "Timed out"
            )
            result = self._build_terminal_result(handle, status="timed_out", content=timeout_text)
        except Exception as exc:  # pragma: no cover - defensive fallback
            result = self._build_terminal_result(
                handle,
                status="error",
                content=f"Error: {exc}",
                metadata={"error": str(exc)},
            )

        handle.run_id = result.run_id or handle.run_id
        if handle.run_id:
            self._run_index[handle.run_id] = handle.handle_id
        if self._projector is not None:
            legacy_payload = (
                legacy_completed_payload_factory(handle, result)
                if legacy_completed_payload_factory is not None
                else None
            )
            self._projector.project_completed(
                handle,
                status=result.status,
                result=result,
                error=None if result.status == "ok" else str(result.content or "").strip() or None,
                legacy_payload=legacy_payload,
            )
        return result

    @staticmethod
    def _build_terminal_result(
        handle: ChildTaskHandle,
        *,
        status: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> ChildTaskResult:
        request = handle.request
        return ChildTaskResult(
            status=status,
            content=str(content or "").strip() or status,
            task=str(request.task or "").strip(),
            label=request.resolved_label(),
            principal_kind=request.principal_kind,
            principal_id=request.principal_id or request.agent_id,
            agent_id=request.agent_id,
            team_id=request.team_id,
            thread_id=request.thread_id,
            run_id=handle.run_id,
            session_key=request.resolved_session_key(),
            session_id=request.resolved_session_id(),
            origin_channel=str(request.origin_channel or "").strip() or "web",
            origin_chat_id=str(request.origin_chat_id or "").strip() or "direct",
            metadata=dict(metadata or {}),
        )

    def _discard_session_handle(self, handle: ChildTaskHandle) -> None:
        session_key = handle.request.resolved_session_key()
        handles = self._session_index.get(session_key)
        if not handles:
            return
        handles.discard(handle.handle_id)
        if not handles:
            self._session_index.pop(session_key, None)


def collect_child_run_ids(events: list[dict[str, Any]] | None) -> list[str]:
    """Collect child run ids from normalized child-task events with legacy fallback."""
    run_ids: list[str] = []
    seen: set[str] = set()
    for event in events or []:
        event_type = str(event.get("eventType") or "").strip()
        payload = event.get("payload") or {}
        if event_type == "child_task_completed":
            run_id = str(payload.get("childRunId") or "").strip()
        elif event_type == "member_completed":
            run_id = str(payload.get("runId") or "").strip()
        else:
            continue
        if run_id and run_id not in seen:
            seen.add(run_id)
            run_ids.append(run_id)
    return run_ids


def materialize_child_execution_context(
    request: ChildTaskRequest,
    *,
    run_id: str,
    tenant_id: str = "default",
    instance_id: str = "default",
    label: str | None = None,
    role: str | None = None,
    workspace_path: str | None = None,
    workspace_scope: str = "shared",
    sandbox_kind: str = "local",
    exec_working_dir: str | None = None,
    restrict_to_workspace: bool = False,
    exec_timeout_seconds: int | None = None,
    tool_policy: ToolPolicy | None = None,
    memory_policy: MemoryPolicy | None = None,
    knowledge_policy: KnowledgePolicy | None = None,
) -> ExecutionContext:
    """Materialize an explicit execution context for one child-task run."""
    resolved_label = str(label or request.resolved_label()).strip() or "Child Task"
    principal_id = (
        str(request.principal_id or request.agent_id or resolved_label).strip() or resolved_label
    )
    resolved_tenant_id = str(request.tenant_id or tenant_id or "default").strip() or "default"
    resolved_instance_id = str(request.instance_id or instance_id or "default").strip() or "default"
    return ExecutionContext(
        tenant_id=resolved_tenant_id,
        instance_id=resolved_instance_id,
        principal_kind=str(request.principal_kind or "child_task").strip() or "child_task",
        principal_id=principal_id,
        label=resolved_label,
        agent_id=str(request.agent_id).strip() or None if request.agent_id is not None else None,
        team_id=str(request.team_id).strip() or None if request.team_id is not None else None,
        role=str(role or "").strip() or None,
        run_id=run_id,
        root_run_id=request.root_run_id or run_id,
        parent_run_id=request.parent_run_id,
        session_key=request.resolved_session_key(),
        session_id=request.resolved_session_id(),
        session_title=str(request.session_title or resolved_label).strip() or resolved_label,
        thread_id=str(request.thread_id).strip() or None if request.thread_id is not None else None,
        origin_channel=str(request.origin_channel or "web").strip() or "web",
        origin_chat_id=str(request.origin_chat_id or "direct").strip() or "direct",
        spawn_depth=request.spawn_depth,
        control_scope=request.control_scope,
        workspace_path=workspace_path,
        workspace_scope=workspace_scope,
        sandbox_kind=sandbox_kind,
        exec_working_dir=exec_working_dir,
        restrict_to_workspace=restrict_to_workspace,
        exec_timeout_seconds=exec_timeout_seconds,
        tool_policy=tool_policy or ToolPolicy(),
        memory_policy=memory_policy or MemoryPolicy(),
        knowledge_policy=knowledge_policy or KnowledgePolicy(),
    )
