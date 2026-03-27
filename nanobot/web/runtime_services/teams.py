"""Team-definition runtime helpers for test runs and LangGraph-based team orchestration."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from nanobot.harness import ExecutionContext, KnowledgePolicy, MemoryPolicy
from nanobot.platform.runs import RunControlScope, RunKind, RunResultSummary
from nanobot.platform.teams import TeamDefinitionNotFoundError
from nanobot.platform.teams.models import SupervisorConfig
from nanobot.web.runtime_services.langgraph_supervisor import LangGraphTeamRunner


@dataclass(slots=True)
class PreparedTeamRun:
    """Reusable root lifecycle materialization for one team run."""

    team: dict[str, Any]
    task: str
    root_run_id: str
    thread_id: str
    supervisor_config: SupervisorConfig
    origin_channel: str
    origin_chat_id: str
    route_metadata: dict[str, Any] = field(default_factory=dict)
    team_thread_context_block: str | None = None
    tenant_id: str | None = None
    instance_id: str | None = None

    @property
    def team_id(self) -> str:
        return str(self.team.get("teamId") or "").strip()

    @property
    def root_session_key(self) -> str:
        return WebTeamRuntimeService._root_session_key(self.team_id, self.root_run_id)

    def event_snapshot(self) -> dict[str, Any]:
        return {
            "teamId": self.team_id or None,
            "teamName": str(self.team.get("name") or "").strip() or None,
            "supervisorAgentId": str(self.team.get("supervisorAgentId") or "").strip() or None,
            "rootRunId": self.root_run_id,
            "threadId": self.thread_id,
            "sessionKey": self.root_session_key,
            "originChannel": self.origin_channel,
            "originChatId": self.origin_chat_id,
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "hasThreadContext": bool(self.team_thread_context_block),
            "taskLength": len(self.task),
            "taskPreview": " ".join(self.task.split())[:280],
            "supervisorConfig": self.supervisor_config.to_dict(),
            "routeMetadata": dict(self.route_metadata),
        }


class WebTeamRuntimeService:
    """Runtime helpers for team definitions inside the collaboration domain."""

    def __init__(self, state):
        self.state = state
        self._active_tasks: dict[str, asyncio.Task[Any]] = {}

    def _knowledge_service_for_tenant(self, tenant_id: str | None) -> Any | None:
        service = getattr(self.state, "app_knowledge", None)
        if service is None:
            return None
        return service.with_tenant(tenant_id) if hasattr(service, "with_tenant") else service

    def _memory_service_for_tenant(self, tenant_id: str | None) -> Any | None:
        service = getattr(self.state, "app_memory", None)
        if service is None:
            return None
        return service.with_tenant(tenant_id) if hasattr(service, "with_tenant") else service

    def _latest_channel_route_payload(self, run_id: str) -> dict[str, Any]:
        for event in reversed(self.state.runs.get_run(run_id).get("events") or []):
            if event.get("eventType") == "channel_dispatch_resolved":
                payload = event.get("payload")
                if isinstance(payload, dict):
                    return dict(payload)
                break
        return {}

    @staticmethod
    def _root_session_key(team_id: str, run_id: str) -> str:
        return f"team-test:{team_id}:{run_id}"

    @staticmethod
    def _child_session_key(team_id: str, root_run_id: str, role: str, agent_id: str) -> str:
        return f"team-test:{team_id}:{root_run_id}:{role}:{agent_id}"

    @staticmethod
    def _child_session_id(team_id: str, root_run_id: str, role: str, agent_id: str) -> str:
        return f"team-test:{team_id}:{root_run_id}:{role}:{agent_id}"

    @staticmethod
    def _team_thread_id(team_id: str) -> str:
        return f"team-thread:{team_id}"

    def _resolve_team_execution_boundary(
        self,
        team: dict[str, Any],
        supervisor: dict[str, Any],
    ) -> tuple[str, str]:
        tenant_id = str(team.get("tenantId") or supervisor.get("tenantId") or "default").strip() or "default"
        instance_id = str(
            team.get("instanceId")
            or supervisor.get("instanceId")
            or getattr(getattr(self.state, "app_agents", None), "instance_id", "")
            or "default"
        ).strip() or "default"
        return tenant_id, instance_id

    @classmethod
    def _resolve_team_thread_id(
        cls,
        team: dict[str, Any],
        *,
        origin_channel: str = "web",
        origin_chat_id: str | None = None,
        session_key: str | None = None,
        source_id: str | None = None,
    ) -> str:
        explicit_source = str(source_id or "").strip()
        if explicit_source:
            return explicit_source

        team_id = str(team["teamId"]).strip()
        normalized_channel = str(origin_channel or "web").strip() or "web"
        normalized_chat_id = str(origin_chat_id or "").strip()
        normalized_session_key = str(session_key or "").strip()

        # Keep the default Web Studio thread stable so the existing UI and
        # historical thread audit do not silently fork into a new scope.
        if normalized_session_key == f"web:{team_id}":
            normalized_session_key = ""

        if not normalized_session_key:
            if normalized_channel == "web" and (not normalized_chat_id or normalized_chat_id == team_id):
                return cls._team_thread_id(team_id)
            normalized_session_key = f"{normalized_channel}:{normalized_chat_id or team_id}"

        return f"{cls._team_thread_id(team_id)}:{normalized_session_key}"

    def _ensure_team_thread_session(self, team: dict[str, Any], *, thread_id: str):
        session = self.state.sessions.get_or_create(thread_id)
        if not session.metadata.get("title"):
            title = f"Team Thread · {team['name']}"
            default_thread_id = self._team_thread_id(team["teamId"])
            if thread_id != default_thread_id:
                scope_label = thread_id.removeprefix(default_thread_id).lstrip(":")
                if scope_label:
                    title = f"{title} · {scope_label}"
            session.metadata["title"] = title
            self.state.sessions.save(session)
        return session

    def _build_team_thread_context_block(
        self,
        team: dict[str, Any],
        *,
        thread_id: str,
        max_messages: int = 8,
    ) -> str | None:
        session = self._ensure_team_thread_session(team, thread_id=thread_id)
        history = [
            message
            for message in session.messages
            if message.get("role") in {"user", "assistant"} and str(message.get("content") or "").strip()
        ]
        if not history:
            return None
        recent = history[-max_messages:]
        lines = [
            "# Previous Team Thread Turns",
            "This is the recent team-level short-term context. Reuse it when it materially affects the current task.",
        ]
        for item in recent:
            role = "User" if item.get("role") == "user" else "Team"
            lines.append(f"## {role}\n{str(item.get('content') or '').strip()}")
        return "\n\n".join(lines)

    def _append_team_thread_message(
        self,
        team: dict[str, Any],
        *,
        thread_id: str,
        role: str,
        content: str,
        run_id: str,
    ) -> None:
        text = str(content or "").strip()
        if not text:
            return
        session = self._ensure_team_thread_session(team, thread_id=thread_id)
        session.add_message(role, text, run_id=run_id, team_id=team["teamId"])
        self.state.sessions.save(session)

    def _retrieve_team_knowledge(self, team: dict[str, Any], task: str) -> dict[str, Any]:
        knowledge_service = self._knowledge_service_for_tenant(team.get("tenantId"))
        if not knowledge_service:
            return {"hits": [], "requestedMode": "hybrid", "effectiveMode": "hybrid"}
        kb_ids = list(team.get("sharedKnowledgeBindingIds") or [])
        if not kb_ids:
            return {"hits": [], "requestedMode": "hybrid", "effectiveMode": "hybrid"}
        return knowledge_service.retrieve(kb_ids=kb_ids, query=task, limit=8)

    def _get_team_memory_sections(self, team_id: str, *, tenant_id: str | None = None) -> list[tuple[str, str]]:
        memory_service = self._memory_service_for_tenant(tenant_id)
        if not memory_service:
            return []
        snapshot = memory_service.get_team_memory(team_id)
        content = str(snapshot.get("content") or "").strip()
        if not content:
            return []
        return [("Team Shared Memory", content)]

    def _resolve_team_knowledge_names(self, kb_ids: list[str], *, tenant_id: str | None = None) -> list[str]:
        knowledge_service = self._knowledge_service_for_tenant(tenant_id)
        if not knowledge_service or not kb_ids:
            return []
        try:
            return [str(item.name or item.kb_id) for item in knowledge_service.resolve_bound_kbs(kb_ids)]
        except Exception:
            return []

    def _materialize_team_execution_context(
        self,
        team: dict[str, Any],
        task: str,
        *,
        root_run_id: str,
        thread_id: str,
        origin_channel: str,
        origin_chat_id: str,
        team_memory_sections: list[tuple[str, str]],
        shared_knowledge_result: dict[str, Any],
    ) -> ExecutionContext:
        try:
            supervisor = self.state.app_agents.get_agent(team["supervisorAgentId"], tenant_id=team.get("tenantId"))
        except TypeError:
            supervisor = self.state.app_agents.get_agent(team["supervisorAgentId"])
        tenant_id, instance_id = self._resolve_team_execution_boundary(team, supervisor)
        prepared = self.state.agent_runtime.prepare_agent_execution(
            supervisor,
            task=task,
            memory_sections=team_memory_sections,
        )
        kb_ids = list(team.get("sharedKnowledgeBindingIds") or [])
        knowledge_names = (
            self._resolve_team_knowledge_names(kb_ids, tenant_id=tenant_id)
            if kb_ids
            else prepared.knowledge_policy.names_as_list()
        )
        knowledge_hits = list(shared_knowledge_result.get("hits") or []) or prepared.knowledge_hits
        knowledge_scope = "team_bindings" if kb_ids else prepared.knowledge_policy.scope
        execution_context = ExecutionContext(
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_kind="team_supervisor",
            principal_id=str(team.get("supervisorAgentId") or team.get("teamId") or "team"),
            label=str(team.get("name") or "Team"),
            agent_id=str(team.get("supervisorAgentId") or "").strip() or None,
            team_id=str(team.get("teamId") or "").strip() or None,
            role="leader",
            run_id=root_run_id,
            root_run_id=root_run_id,
            session_key=self._root_session_key(str(team["teamId"]), root_run_id),
            session_id=self._root_session_key(str(team["teamId"]), root_run_id),
            session_title=f"Team Run · {team['name']}",
            thread_id=thread_id,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            control_scope=RunControlScope.TOP_LEVEL,
            workspace_path=str(self.state.config.workspace_path),
            tool_policy=prepared.tool_policy,
            memory_policy=MemoryPolicy(
                scope="team_thread",
                include_workspace_memory=prepared.memory_policy.include_workspace_memory,
                sections=prepared.memory_policy.sections,
            ),
            knowledge_policy=KnowledgePolicy(
                scope=knowledge_scope,
                binding_ids=tuple(kb_ids or prepared.knowledge_policy.binding_ids_as_list()),
                names=tuple(knowledge_names),
                hits=tuple(knowledge_hits),
                event_payload={
                    "knowledgeBindingIds": list(kb_ids or prepared.knowledge_policy.binding_ids_as_list()),
                    "knowledgeNames": list(knowledge_names),
                    "requestedMode": shared_knowledge_result.get("requestedMode"),
                    "effectiveMode": shared_knowledge_result.get("effectiveMode"),
                    "hitCount": len(knowledge_hits),
                },
            ),
        )
        environment = self.state.agent_runtime.resolve_environment_binding(
            workspace=prepared.config.workspace_path,
            restrict_to_workspace=prepared.config.tools.restrict_to_workspace,
            exec_config=prepared.config.tools.exec,
            principal_kind=execution_context.principal_kind,
            tenant_id=execution_context.tenant_id,
            instance_id=execution_context.instance_id,
            principal_id=execution_context.principal_id,
            team_id=execution_context.team_id,
            thread_id=execution_context.thread_id,
            root_run_id=execution_context.effective_root_run_id,
            session_key=execution_context.session_key,
        )
        workspace_binding = environment.workspace
        execution_context.workspace_path = str(workspace_binding.path)
        execution_context.workspace_scope = workspace_binding.scope
        sandbox_binding = environment.sandbox
        execution_context.sandbox_kind = sandbox_binding.kind
        execution_context.exec_working_dir = str(sandbox_binding.working_dir)
        execution_context.restrict_to_workspace = sandbox_binding.restrict_to_workspace
        execution_context.exec_timeout_seconds = sandbox_binding.exec_timeout
        return execution_context

    def _propose_memory_candidate(
        self,
        *,
        root_run_id: str,
        team: dict[str, Any],
        agent: dict[str, Any],
        run_result: dict[str, Any],
    ) -> None:
        memory_service = self._memory_service_for_tenant(team.get("tenantId"))
        if not memory_service:
            return
        content = (
            (run_result.get("assistantMessage") or {}).get("content")
            or (run_result.get("run", {}).get("resultSummary") or {}).get("content")
            or ""
        )
        candidate = memory_service.create_candidate(
            scope="team_shared",
            team_id=team["teamId"],
            agent_id=agent["agentId"],
            run_id=run_result["run"]["runId"],
            source_kind="member_result",
            title=f"{team['name']} · {agent['name']} candidate",
            content=content,
        )
        if candidate:
            self.state.runs.append_event(
                root_run_id,
                "memory_candidate_proposed",
                {
                    "candidateId": candidate["candidateId"],
                    "teamId": team["teamId"],
                    "agentId": agent["agentId"],
                    "runId": run_result["run"]["runId"],
                },
            )

    @staticmethod
    def _extract_supervisor_config(team: dict[str, Any]) -> SupervisorConfig:
        raw = team.get("supervisorConfig")
        if raw is None:
            return SupervisorConfig()
        if isinstance(raw, SupervisorConfig):
            return raw
        return SupervisorConfig.from_dict(raw)

    def _prepare_team_run(
        self,
        team_id: str,
        content: str,
        *,
        tenant_id: str | None = None,
        origin_channel: str = "web",
        origin_chat_id: str | None = None,
        session_key: str | None = None,
        route_metadata: dict[str, Any] | None = None,
    ) -> PreparedTeamRun:
        if not self.state.agent or not self.state.sessions or not self.state.runs:
            raise RuntimeError("Web team runtime is not available.")

        task = str(content or "").strip()
        if not task:
            raise ValueError("content is required.")

        try:
            team = self.state.app_teams.get_team(team_id, tenant_id=tenant_id)
        except TeamDefinitionNotFoundError as exc:
            raise KeyError(team_id) from exc
        supervisor = self.state.app_agents.get_agent(team["supervisorAgentId"], tenant_id=team.get("tenantId"))
        tenant_id, instance_id = self._resolve_team_execution_boundary(team, supervisor)

        thread_id = self._resolve_team_thread_id(
            team,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            session_key=session_key,
        )
        thread_context_block = self._build_team_thread_context_block(team, thread_id=thread_id)
        root_run = self.state.runs.create_run(
            kind=RunKind.TEAM,
            label=team["name"],
            task_preview=" ".join(task.split())[:280],
            tenant_id=tenant_id,
            instance_id=instance_id,
            team_id=team["teamId"],
            thread_id=thread_id,
            session_key=self._root_session_key(team["teamId"], "pending"),
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id or team["teamId"],
            control_scope=RunControlScope.TOP_LEVEL,
            workspace_path=str(self.state.config.workspace_path),
            memory_scope="team_thread",
            knowledge_scope="team_bindings" if team.get("sharedKnowledgeBindingIds") else "workspace",
        )
        self.state.runs.store.update_run(
            root_run.run_id,
            session_key=self._root_session_key(team["teamId"], root_run.run_id),
        )

        supervisor_config = self._extract_supervisor_config(team)

        self.state.runs.append_event(
            root_run.run_id,
            "team_run_requested",
            {
                "content": task,
                "contentPreview": " ".join(task.split())[:600],
                "contentLength": len(task),
            },
        )
        self.state.runs.append_event(
            root_run.run_id,
            "team_definition_resolved",
            {
                "supervisorAgentId": team["supervisorAgentId"],
                "memberAgentIds": team.get("memberAgentIds", []),
                "supervisorConfig": supervisor_config.to_dict(),
                "sharedKnowledgeBindingIds": team.get("sharedKnowledgeBindingIds", []),
                "memberAccessPolicy": team.get("memberAccessPolicy") or {},
            },
        )
        self.state.runs.append_event(
            root_run.run_id,
            "team_thread_resolved",
            {
                "threadId": thread_id,
                "hasPriorContext": bool(thread_context_block),
            },
        )
        route_payload = self._channel_route_event_payload(route_metadata)
        if route_payload:
            self.state.runs.append_event(
                root_run.run_id,
                "channel_dispatch_resolved",
                route_payload,
            )
        self._append_team_thread_message(
            team,
            thread_id=thread_id,
            role="user",
            content=task,
            run_id=root_run.run_id,
        )
        prepared = PreparedTeamRun(
            team=team,
            task=task,
            root_run_id=root_run.run_id,
            thread_id=thread_id,
            supervisor_config=supervisor_config,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id or team["teamId"],
            route_metadata=route_metadata or {},
            team_thread_context_block=thread_context_block,
            tenant_id=tenant_id,
            instance_id=instance_id,
        )
        self.state.runs.append_event(
            root_run.run_id,
            "team_run_prepared",
            prepared.event_snapshot(),
        )
        return prepared

    def _track_task(self, root_run_id: str, task: asyncio.Task[Any]) -> None:
        self._active_tasks[root_run_id] = task

        def _cleanup(done: asyncio.Task[Any]) -> None:
            self._active_tasks.pop(root_run_id, None)
            try:
                done.result()
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("Team run background task crashed")

        task.add_done_callback(_cleanup)

    @staticmethod
    def _channel_route_event_payload(route_metadata: dict[str, Any] | None) -> dict[str, Any] | None:
        payload = dict(route_metadata or {})
        return payload or None

    def _resolve_source_run(self, team_id: str, run_id: str, *, tenant_id: str | None = None) -> dict[str, Any]:
        run = self.state.runs.get_run(run_id)
        if run.get("kind") != "team" and run.get("teamId") == team_id and run.get("rootRunId"):
            run = self.state.runs.get_run(str(run["rootRunId"]))
        if run.get("kind") != "team" or run.get("teamId") != team_id:
            raise ValueError("Run does not belong to the target team.")
        if tenant_id and str(run.get("tenantId") or "default").strip() != str(tenant_id).strip():
            raise ValueError("Run does not belong to the target team.")
        return run

    @staticmethod
    def _extract_source_task(run: dict[str, Any]) -> str:
        for event in run.get("events") or []:
            if event.get("eventType") != "team_run_requested":
                continue
            payload = event.get("payload") or {}
            content = str(payload.get("content") or "").strip()
            if content:
                return content
            preview = str(payload.get("contentPreview") or "").strip()
            if preview:
                return preview
        return str(run.get("taskPreview") or "").strip()

    @staticmethod
    def _merge_append_context(task: str, append_context: str | None) -> str:
        extra = str(append_context or "").strip()
        if not extra:
            return task
        return (
            f"{task}\n\n"
            "# Additional Context\n"
            "Use the following extra context when you re-run the team task.\n"
            f"{extra}"
        )

    @staticmethod
    def _format_knowledge_hits_markdown(hits: list[dict[str, Any]]) -> str:
        sections: list[str] = []
        for index, hit in enumerate(hits, start=1):
            citation = hit.get("citation") or {}
            title = citation.get("title") or hit.get("title") or f"Hit {index}"
            source_uri = citation.get("sourceUri") or ""
            body = str(hit.get("content") or "").strip()
            lines = [f"### {index}. {title}"]
            if source_uri:
                lines.append(f"Source: {source_uri}")
            if body:
                lines.append("")
                lines.append(body)
            sections.append("\n".join(lines))
        return "\n\n".join(sections)

    async def _execute_team_run(
        self,
        prepared: PreparedTeamRun,
    ) -> str | None:
        team = prepared.team
        task = prepared.task
        root_run_id = prepared.root_run_id
        thread_id = prepared.thread_id
        team_thread_context_block = prepared.team_thread_context_block
        shared_knowledge_result = self._retrieve_team_knowledge(team, task)
        shared_knowledge_hits = list(shared_knowledge_result.get("hits") or [])
        shared_knowledge_block = None
        if shared_knowledge_hits:
            shared_knowledge_block = self.state.agent_runtime._build_knowledge_prompt_block(shared_knowledge_hits)
        team_memory_sections = self._get_team_memory_sections(team["teamId"], tenant_id=team.get("tenantId"))
        supervisor_config = prepared.supervisor_config
        supervisor_chunk_count = 0

        try:
            current = self.state.runs.require_run(root_run_id)
            if current.status.value == "cancel_requested":
                self.state.runs.cancel_run(root_run_id)
                return None

            self.state.runs.start_run(root_run_id)
            execution_context = self._materialize_team_execution_context(
                team,
                task,
                root_run_id=root_run_id,
                thread_id=thread_id,
                origin_channel=str(current.origin_channel or prepared.origin_channel or "web").strip() or "web",
                origin_chat_id=str(current.origin_chat_id or prepared.origin_chat_id or team["teamId"]).strip() or team["teamId"],
                team_memory_sections=team_memory_sections,
                shared_knowledge_result=shared_knowledge_result,
            )
            self.state.runs.store.update_run(
                root_run_id,
                workspace_path=execution_context.workspace_path,
            )
            self.state.runs.append_event(
                root_run_id,
                "execution_context_materialized",
                execution_context.event_snapshot(),
            )
            self.state.runs.append_event(
                root_run_id,
                "team_knowledge_retrieved",
                {
                    "sharedKnowledgeBindingIds": team.get("sharedKnowledgeBindingIds", []),
                    "requestedMode": shared_knowledge_result.get("requestedMode"),
                    "effectiveMode": shared_knowledge_result.get("effectiveMode"),
                    "hitCount": len(shared_knowledge_hits),
                },
            )

            member_access_policy = team.get("memberAccessPolicy") or {}

            # --- LangGraph Supervisor Execution ---
            self.state.runs.append_event(
                root_run_id,
                "supervisor_started",
                {
                    "supervisorAgentId": team["supervisorAgentId"],
                    "memberAgentIds": team.get("memberAgentIds", []),
                    "supervisorConfig": supervisor_config.to_dict(),
                },
            )

            runner = LangGraphTeamRunner(
                agent_runtime=self.state.agent_runtime,
                runs=self.state.runs,
                config_runtime=self.state.config_runtime,
            )

            async def _on_supervisor_event(event_type: str, payload: dict[str, Any]) -> None:
                nonlocal supervisor_chunk_count
                if event_type == "supervisor_chunk":
                    supervisor_chunk_count += 1
                    projected_payload = dict(payload or {})
                    projected_payload["chunkIndex"] = supervisor_chunk_count
                    self.state.runs.append_event(root_run_id, "supervisor_chunk", projected_payload)
                    return
                self.state.runs.append_event(root_run_id, event_type, dict(payload or {}))

            result = await runner.run_stream(
                team,
                task,
                root_run_id,
                thread_id,
                supervisor_config=supervisor_config,
                team_thread_context_block=team_thread_context_block,
                shared_knowledge_block=shared_knowledge_block,
                team_memory_sections=team_memory_sections,
                member_access_policy=member_access_policy,
                propose_memory_candidate=self._propose_memory_candidate,
                team_run_context=execution_context.event_snapshot(),
                on_event=_on_supervisor_event,
            )

            self.state.runs.append_event(
                root_run_id,
                "supervisor_completed",
                {
                    "supervisorAgentId": team["supervisorAgentId"],
                    "memberRunIds": result.member_run_ids,
                    "streamChunkCount": supervisor_chunk_count,
                    "finalContentLength": len(str(result.final_content or "")),
                    "responseMode": (result.supervisor_snapshot or {}).get("responseMode"),
                    "recursionLimit": (result.supervisor_snapshot or {}).get("recursionLimit"),
                    "modelName": (result.supervisor_snapshot or {}).get("modelName"),
                    "memberToolCount": len((result.supervisor_snapshot or {}).get("memberToolNames") or []),
                },
            )

            final_content = result.final_content
            self._append_team_thread_message(
                team,
                thread_id=thread_id,
                role="assistant",
                content=final_content,
                run_id=root_run_id,
            )
            route_payload = self._latest_channel_route_payload(root_run_id)
            artifact_path = self.state.runs.write_markdown_artifact(
                root_run_id,
                title=f"Team Run Artifact · {team['name']}",
                metadata={
                    **execution_context.artifact_metadata(kind="team"),
                    "routing_binding_id": str(route_payload.get("bindingId") or "").strip() or None,
                    "routing_audit_id": str(route_payload.get("auditId") or "").strip() or None,
                    "workflow_mode": "supervisor",
                    "supervisor_agent_id": team["supervisorAgentId"],
                    "supervisor_model_name": (result.supervisor_snapshot or {}).get("modelName"),
                    "supervisor_response_mode": (result.supervisor_snapshot or {}).get("responseMode"),
                    "supervisor_recursion_limit": (result.supervisor_snapshot or {}).get("recursionLimit"),
                    "member_run_count": len(result.member_run_ids),
                    "member_tool_count": len((result.supervisor_snapshot or {}).get("memberToolNames") or []),
                    "supervisor_chunk_count": supervisor_chunk_count,
                    "shared_knowledge_hits": len(shared_knowledge_hits),
                },
                sections=[
                    ("Original Task", task),
                    ("Final Answer", final_content),
                    ("Shared Knowledge", self._format_knowledge_hits_markdown(shared_knowledge_hits)),
                ],
            )
            self.state.runs.complete_run(
                root_run_id,
                RunResultSummary(
                    content=final_content,
                    metadata={
                        "memberRunIds": result.member_run_ids,
                        "sharedKnowledgeHitCount": len(shared_knowledge_hits),
                        "supervisorResponseMode": (result.supervisor_snapshot or {}).get("responseMode"),
                        "supervisorRecursionLimit": (result.supervisor_snapshot or {}).get("recursionLimit"),
                        "supervisorModelName": (result.supervisor_snapshot or {}).get("modelName"),
                        "memberToolCount": len((result.supervisor_snapshot or {}).get("memberToolNames") or []),
                    },
                ),
                artifact_path=artifact_path,
            )
            self.state.runs.append_event(
                root_run_id,
                "team_completed",
                {
                    "memberRunIds": result.member_run_ids,
                    "supervisorChunkCount": supervisor_chunk_count,
                    "sharedKnowledgeHitCount": len(shared_knowledge_hits),
                    "responseMode": (result.supervisor_snapshot or {}).get("responseMode"),
                    "recursionLimit": (result.supervisor_snapshot or {}).get("recursionLimit"),
                    "memberToolCount": len((result.supervisor_snapshot or {}).get("memberToolNames") or []),
                },
            )
            return final_content
        except asyncio.CancelledError:
            try:
                self.state.runs.cancel_run(root_run_id)
            except Exception:
                logger.debug("Team run [{}] cancel state update skipped", root_run_id)
            raise
        except Exception as exc:
            self.state.runs.fail_run(root_run_id, "TEAM_TEST_RUN_FAILED", str(exc))
            raise

    async def start_team_run(
        self,
        team_id: str,
        content: str,
        *,
        tenant_id: str | None = None,
        route_metadata: dict[str, Any] | None = None,
        source_run_id: str | None = None,
        append_context: str | None = None,
    ) -> dict[str, Any]:
        prepared = self._prepare_team_run(
            team_id,
            content,
            tenant_id=tenant_id,
            route_metadata=route_metadata,
        )
        if source_run_id:
            self.state.runs.append_event(
                prepared.root_run_id,
                "retry_requested",
                {
                    "sourceRunId": source_run_id,
                    "appendContextProvided": bool(str(append_context or "").strip()),
                    "appendContextPreview": " ".join(str(append_context or "").split())[:400],
                },
            )
        background = asyncio.create_task(
            self._execute_team_run(
                prepared,
            ),
            name=f"team-run:{prepared.root_run_id}",
        )
        self._track_task(prepared.root_run_id, background)
        return {
            "team": prepared.team,
            "run": self.state.runs.get_run(prepared.root_run_id),
            "supervisorRun": None,
            "memberRuns": [],
            "finalAssistantMessage": None,
            "teamKnowledgeHits": [],
        }

    async def run_team_sync(
        self,
        team_id: str,
        content: str,
        *,
        tenant_id: str | None = None,
        origin_channel: str = "web",
        origin_chat_id: str | None = None,
        session_key: str | None = None,
        route_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute one team run synchronously and return the final content."""
        prepared = self._prepare_team_run(
            team_id,
            content,
            tenant_id=tenant_id,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            session_key=session_key,
            route_metadata=route_metadata,
        )
        final_content = await self._execute_team_run(
            prepared,
        )
        run = self.state.runs.get_run(prepared.root_run_id)
        resolved_content = str(final_content or (run.get("resultSummary") or {}).get("content") or "").strip()
        return {
            "team": prepared.team,
            "run": run,
            "finalContent": resolved_content,
        }

    def get_team_thread_summary(
        self,
        team_id: str,
        *,
        tenant_id: str | None = None,
        origin_channel: str = "web",
        origin_chat_id: str | None = None,
        session_key: str | None = None,
        source_id: str | None = None,
    ) -> dict[str, Any]:
        team = self.state.app_teams.get_team(team_id, tenant_id=tenant_id)
        thread_id = self._resolve_team_thread_id(
            team,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            session_key=session_key,
            source_id=source_id,
        )
        session = self._ensure_team_thread_session(team, thread_id=thread_id)
        return {
            "threadId": thread_id,
            "session": self.state.chat_runtime.format_session_summary_from_session(session, thread_id),
        }

    def get_team_thread_messages(
        self,
        team_id: str,
        *,
        tenant_id: str | None = None,
        limit: int = 40,
        origin_channel: str = "web",
        origin_chat_id: str | None = None,
        session_key: str | None = None,
        source_id: str | None = None,
    ) -> dict[str, Any]:
        team = self.state.app_teams.get_team(team_id, tenant_id=tenant_id)
        thread_id = self._resolve_team_thread_id(
            team,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            session_key=session_key,
            source_id=source_id,
        )
        session = self._ensure_team_thread_session(team, thread_id=thread_id)
        messages = session.messages[-limit:]
        start_sequence = len(session.messages) - len(messages) + 1
        return {
            "threadId": thread_id,
            "messages": [
                self.state.chat_runtime.format_message(start_sequence + index, thread_id, message)
                for index, message in enumerate(messages)
            ],
            "total": len(session.messages),
        }

    def get_team_thread_memory_source(
        self,
        team_id: str,
        *,
        tenant_id: str | None = None,
        limit: int = 40,
        origin_channel: str = "web",
        origin_chat_id: str | None = None,
        session_key: str | None = None,
        source_id: str | None = None,
    ) -> dict[str, Any] | None:
        payload = self.get_team_thread_messages(
            team_id,
            tenant_id=tenant_id,
            limit=limit,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            session_key=session_key,
            source_id=source_id,
        )
        messages = payload.get("messages") or []
        if not messages:
            return None
        lines: list[str] = []
        for message in messages:
            role = str(message.get("role") or "assistant").strip() or "assistant"
            content = str(message.get("content") or "").strip()
            if not content:
                continue
            label = "User" if role == "user" else "Assistant" if role == "assistant" else role.title()
            lines.append(f"{label}: {content}")
        if not lines:
            return None
        return {
            "sourceId": payload["threadId"],
            "title": f"Team Thread · {team_id}",
            "content": "\n\n".join(lines),
            "metadata": {
                "threadId": payload["threadId"],
                "messageCount": payload.get("total", len(messages)),
            },
        }

    async def test_run_team(
        self,
        team_id: str,
        content: str,
        *,
        tenant_id: str | None = None,
        route_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await self.start_team_run(team_id, content, tenant_id=tenant_id, route_metadata=route_metadata)

    async def retry_team_run(
        self,
        team_id: str,
        run_id: str,
        *,
        tenant_id: str | None = None,
        append_context: str | None = None,
    ) -> dict[str, Any]:
        source_run = self._resolve_source_run(team_id, run_id, tenant_id=tenant_id)
        source_task = self._extract_source_task(source_run)
        if not source_task:
            raise ValueError("Source run has no reusable task content.")
        next_task = self._merge_append_context(source_task, append_context)
        return await self.start_team_run(
            team_id,
            next_task,
            tenant_id=tenant_id,
            source_run_id=source_run["runId"],
            append_context=append_context,
        )

    async def cancel_run(self, root_run_id: str) -> bool:
        task = self._active_tasks.get(root_run_id)
        if task is None or task.done():
            return False
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        try:
            self.state.runs.cancel_run(root_run_id)
        except Exception:
            logger.debug("Team run [{}] final cancel state update skipped", root_run_id)
        return True

    async def shutdown_async(self) -> None:
        tasks = [task for task in self._active_tasks.values() if not task.done()]
        self._active_tasks.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
