"""Agent-definition runtime helpers for test runs and recent run inspection."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from nanobot.harness import (
    AgentThreadWorkspaceProvider,
    ExecutionContext,
    ExecutionEnvironmentBinding,
    ExecutionAssemblyState,
    ExecutionMiddlewareChain,
    KnowledgeBindingMiddleware,
    KnowledgeBindingResult,
    KnowledgePolicy,
    KnowledgePolicyMiddleware,
    MemoryPolicy,
    MemoryPolicyMiddleware,
    PromptAssemblyMiddleware,
    PromptSeedMiddleware,
    RuntimePromptFragmentsMiddleware,
    SandboxBinding,
    SharedWorkspaceProvider,
    ToolPolicy,
    ToolPolicyMiddleware,
    WorkspaceBinding,
    WorkspaceProvider,
    build_sandbox_provider,
    resolve_execution_environment,
)
from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import InboundMessage, extract_outbound_content
from nanobot.agent.skills import SkillsLoader
from nanobot.providers.registry import find_by_model
from nanobot.platform.agents import AgentDefinitionNotFoundError
from nanobot.platform.agents.model_selection import canonicalize_agent_model_selection
from nanobot.platform.runs import RunControlScope, RunKind, RunResultSummary

if TYPE_CHECKING:
    from nanobot.config.schema import Config
    from nanobot.web.runtime import WebAppState


@dataclass(slots=True)
class PreparedAgentExecution:
    """Resolved agent runtime inputs reused across execution surfaces."""

    config: Config
    knowledge_binding: KnowledgeBindingResult
    tool_policy: ToolPolicy
    memory_policy: MemoryPolicy
    knowledge_policy: KnowledgePolicy
    runtime_prompt_sections: tuple[str, ...]
    runtime_memory_sections: tuple[tuple[str, str], ...]
    system_prompt_override: str | None
    middleware_trace: tuple[str, ...]

    @property
    def knowledge_hits(self) -> list[dict[str, Any]]:
        return self.knowledge_policy.hits_as_list()

    @property
    def knowledge_names(self) -> list[str]:
        return self.knowledge_policy.names_as_list()

    @property
    def effective_tool_allowlist(self) -> list[str]:
        return self.tool_policy.allowlist_as_list()

    @property
    def include_workspace_memory(self) -> bool:
        return self.memory_policy.include_workspace_memory

    @property
    def memory_sections(self) -> list[tuple[str, str]]:
        return self.memory_policy.sections_as_list()

    @property
    def runtime_prompt_fragments(self) -> list[str]:
        return list(self.runtime_prompt_sections)

    @property
    def runtime_memory_fragments(self) -> list[tuple[str, str]]:
        return list(self.runtime_memory_sections)

    @property
    def middleware_stages(self) -> list[str]:
        return list(self.middleware_trace)


class WebAgentRuntimeService:
    """Runtime helpers for agent definitions inside the collaboration domain."""

    def __init__(self, state: WebAppState):
        self.state = state

    def _get_workspace_provider(self):
        return getattr(self.state, "workspace_provider", None) or SharedWorkspaceProvider()

    def _get_sandbox_provider(self):
        return getattr(self.state, "sandbox_provider", None) or build_sandbox_provider(self.state.config.tools.exec)

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

    @staticmethod
    def _channel_route_event_payload(route_metadata: dict[str, Any] | None) -> dict[str, Any] | None:
        payload = dict(route_metadata or {})
        return payload or None

    def resolve_workspace_binding(
        self,
        *,
        workspace,
        restrict_to_workspace: bool,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> WorkspaceBinding:
        provider = self._get_workspace_provider()
        return provider.resolve(
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

    def resolve_sandbox_binding(
        self,
        *,
        workspace_binding: WorkspaceBinding,
        exec_config: Any,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> SandboxBinding:
        provider = self._get_sandbox_provider()
        return provider.resolve(
            workspace_binding=workspace_binding,
            exec_config=exec_config,
            principal_kind=principal_kind,
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_id=principal_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
        )

    def resolve_environment_binding(
        self,
        *,
        workspace,
        restrict_to_workspace: bool,
        exec_config: Any,
        principal_kind: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        principal_id: str,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
    ) -> ExecutionEnvironmentBinding:
        return resolve_execution_environment(
            workspace=workspace,
            restrict_to_workspace=restrict_to_workspace,
            exec_config=exec_config,
            principal_kind=principal_kind,
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_id=principal_id,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
            workspace_provider=self._get_workspace_provider(),
            sandbox_provider=self._get_sandbox_provider(),
        )

    @staticmethod
    def _agent_test_session_key(agent_id: str, run_id: str) -> str:
        return f"agent-test:{agent_id}:{run_id}"

    @staticmethod
    def _agent_test_session_id(agent_id: str, run_id: str) -> str:
        return f"agent-test:{agent_id}:{run_id}"

    def _format_session_summary(self, session_key: str, session_id: str) -> dict[str, Any]:
        session = self.state.sessions.get_or_create(session_key)
        return self.state.chat_runtime.format_session_summary_from_session(session, session_id)

    def _format_messages(self, session_key: str, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
        session = self.state.sessions.get_or_create(session_key)
        messages = session.messages[-limit:]
        start_sequence = len(session.messages) - len(messages) + 1
        return [
            self.state.chat_runtime.format_message(start_sequence + index, session_id, message)
            for index, message in enumerate(messages)
        ]

    def _get_last_assistant_message(self, session_key: str, session_id: str) -> dict[str, Any] | None:
        session = self.state.sessions.get_or_create(session_key)
        for index in range(len(session.messages) - 1, -1, -1):
            message = session.messages[index]
            if message.get("role") == "assistant":
                return self.state.chat_runtime.format_message(index + 1, session_id, message)
        return None

    def _validate_agent_bindings(
        self,
        agent: dict[str, Any],
        config: Config,
    ) -> tuple[list[str], list[str], list[str]]:
        canonicalize_agent_model_selection(
            config,
            model=agent.get("model"),
            binding=agent.get("binding"),
            provider=agent.get("provider"),
        )

        valid_tool_names = {
            item["name"]
            for item in self.state.workspace_runtime.get_valid_template_tools()
        }
        invalid_tools = [name for name in agent.get("toolAllowlist", []) if name not in valid_tool_names]
        if invalid_tools:
            raise ValueError(f"Agent has invalid tools: {', '.join(invalid_tools)}")

        configured_mcp = config.tools.mcp_servers
        missing_mcp = [name for name in agent.get("mcpServerIds", []) if name not in configured_mcp]
        if missing_mcp:
            raise ValueError(f"Agent references unknown MCP servers: {', '.join(missing_mcp)}")
        disabled_mcp = [
            name
            for name in agent.get("mcpServerIds", [])
            if name in configured_mcp and not configured_mcp[name].enabled
        ]
        if disabled_mcp:
            raise ValueError(f"Agent references disabled MCP servers: {', '.join(disabled_mcp)}")

        loader = SkillsLoader(config.workspace_path)
        known_skills = {item["name"] for item in loader.list_skills(filter_unavailable=False)}
        missing_skills = [name for name in agent.get("skillIds", []) if name not in known_skills]
        if missing_skills:
            raise ValueError(f"Agent references unknown skills: {', '.join(missing_skills)}")

        knowledge_service = self._knowledge_service_for_tenant(agent.get("tenantId"))
        if knowledge_service and agent.get("knowledgeBindingIds"):
            knowledge_service.resolve_bound_kbs(list(agent.get("knowledgeBindingIds") or []))

        return invalid_tools, disabled_mcp, missing_skills

    @staticmethod
    def _format_bindings_markdown(agent: dict[str, Any]) -> str:
        lines = [
            f"- Tools: {', '.join(agent.get('toolAllowlist') or []) or 'none'}",
            f"- MCP: {', '.join(agent.get('mcpServerIds') or []) or 'none'}",
            f"- Skills: {', '.join(agent.get('skillIds') or []) or 'none'}",
            f"- Knowledge Bindings: {', '.join(agent.get('knowledgeBindingIds') or []) or 'none'}",
        ]
        return "\n".join(lines)

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

    @staticmethod
    def _normalize_memory_sections(memory_sections: list[tuple[str, str]] | None) -> list[tuple[str, str]]:
        normalized: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for heading, content in memory_sections or []:
            title = str(heading or "").strip()
            body = str(content or "").strip()
            if not title or not body:
                continue
            entry = (title, body)
            if entry in seen:
                continue
            seen.add(entry)
            normalized.append(entry)
        return normalized

    @staticmethod
    def get_workspace_memory_sections_for_path(
        workspace_path: Path,
        *,
        heading: str = "Workspace Shared Memory",
    ) -> list[tuple[str, str]]:
        try:
            memory_file = workspace_path / "memory" / "MEMORY.md"
            if not memory_file.is_file():
                return []
            content = memory_file.read_text(encoding="utf-8").strip()
        except Exception:
            return []
        if not content:
            return []
        return [(heading, content)]

    def get_workspace_memory_sections(self) -> list[tuple[str, str]]:
        try:
            return self.get_workspace_memory_sections_for_path(self.state.config.workspace_path)
        except Exception:
            return []

    def get_agent_profile_memory_sections(self, agent_id: str, *, tenant_id: str | None = None) -> list[tuple[str, str]]:
        memory_service = self._memory_service_for_tenant(tenant_id)
        if not memory_service:
            return []
        try:
            snapshot = memory_service.get_agent_memory(agent_id)
        except Exception:
            return []
        content = str(snapshot.get("content") or "").strip()
        if not content:
            return []
        return [("Agent Profile Memory", content)]

    def resolve_agent_memory_context(
        self,
        agent: dict[str, Any],
        *,
        include_workspace_memory: bool | None = None,
        memory_sections: list[tuple[str, str]] | None = None,
    ) -> tuple[bool, list[tuple[str, str]]]:
        memory_scope = str(agent.get("memoryScope") or "agent_profile")
        if memory_scope not in {"agent_profile", "workspace_shared"}:
            memory_scope = "agent_profile"
        effective_include_workspace_memory = (
            include_workspace_memory
            if include_workspace_memory is not None
            else memory_scope == "workspace_shared"
        )
        resolved_sections: list[tuple[str, str]] = []
        if memory_scope == "agent_profile":
            resolved_sections.extend(
                self.get_agent_profile_memory_sections(
                    str(agent.get("agentId") or ""),
                    tenant_id=agent.get("tenantId"),
                )
            )
        resolved_sections.extend(memory_sections or [])
        return effective_include_workspace_memory, self._normalize_memory_sections(resolved_sections)

    def _build_agent_config(self, agent: dict[str, Any]) -> Config:
        config = self.state.config.model_copy(deep=True)
        selection = canonicalize_agent_model_selection(
            config,
            model=agent.get("model"),
            binding=agent.get("binding"),
            provider=agent.get("provider"),
        )
        binding = str(selection.binding or "").strip()
        provider = str(selection.provider or "").strip()
        model = str(selection.model or "").strip()
        if binding:
            config.agents.defaults.binding = binding
            binding_cfg = config.model_bindings.get(binding)
            if binding_cfg is not None:
                config.agents.defaults.provider = binding_cfg.provider
                if not model and binding_cfg.model:
                    config.agents.defaults.model = binding_cfg.model
        elif provider:
            config.agents.defaults.binding = None
            config.agents.defaults.provider = provider
        if model:
            config.agents.defaults.model = model
            if not provider and not binding:
                inferred = find_by_model(model)
                config.agents.defaults.provider = inferred.name if inferred else "auto"
                config.agents.defaults.binding = config.get_binding_name(model)
        selected_mcp = {
            name: entry
            for name, entry in config.tools.mcp_servers.items()
            if name in set(agent.get("mcpServerIds", []) or [])
        }
        config.tools.mcp_servers = selected_mcp
        return config

    @staticmethod
    def build_workspace_memory_resolver(
        workspace_path: Path,
        *,
        heading: str = "Workspace Shared Memory",
    ) -> Callable[[], list[tuple[str, str]]]:
        return lambda: WebAgentRuntimeService.get_workspace_memory_sections_for_path(
            workspace_path,
            heading=heading,
        )

    def resolve_agent_environment(
        self,
        agent: dict[str, Any],
        *,
        thread_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
        workspace_provider: WorkspaceProvider | None = None,
    ) -> ExecutionEnvironmentBinding:
        return resolve_execution_environment(
            workspace=self.state.config.workspace_path,
            restrict_to_workspace=self.state.config.tools.restrict_to_workspace,
            exec_config=self.state.config.tools.exec,
            principal_kind="agent",
            tenant_id=str(agent.get("tenantId") or "default").strip() or "default",
            instance_id=str(
                agent.get("instanceId")
                or getattr(getattr(self.state, "app_agents", None), "instance_id", "default")
                or "default"
            ).strip()
            or "default",
            principal_id=str(agent.get("agentId") or agent.get("name") or "agent").strip() or "agent",
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
            workspace_provider=workspace_provider or self._get_workspace_provider(),
            sandbox_provider=self._get_sandbox_provider(),
        )

    def resolve_isolated_agent_environment(
        self,
        agent: dict[str, Any],
        *,
        thread_id: str,
        session_key: str,
        root_run_id: str | None = None,
    ) -> ExecutionEnvironmentBinding:
        return self.resolve_agent_environment(
            agent,
            thread_id=thread_id,
            root_run_id=root_run_id,
            session_key=session_key,
            workspace_provider=AgentThreadWorkspaceProvider(),
        )

    def _build_execution_middleware_chain(
        self,
        knowledge_service: Any | None,
        *,
        workspace_memory_resolver: Callable[[], list[tuple[str, str]]] | None = None,
    ) -> ExecutionMiddlewareChain:
        return ExecutionMiddlewareChain(
            (
                PromptSeedMiddleware(),
                MemoryPolicyMiddleware(self.resolve_agent_memory_context),
                KnowledgePolicyMiddleware(knowledge_service),
                ToolPolicyMiddleware(),
                RuntimePromptFragmentsMiddleware(
                    workspace_memory_resolver or self.get_workspace_memory_sections
                ),
                PromptAssemblyMiddleware(),
            )
        )

    def prepare_agent_execution(
        self,
        agent: dict[str, Any],
        *,
        task: str,
        additional_prompt_sections: list[str] | None = None,
        include_workspace_memory: bool | None = None,
        memory_sections: list[tuple[str, str]] | None = None,
        workspace_memory_resolver: Callable[[], list[tuple[str, str]]] | None = None,
    ) -> PreparedAgentExecution:
        """Resolve config, bindings, and prompt state for one agent execution."""
        resolved_task = str(task or "").strip()
        if not resolved_task:
            raise ValueError("content is required.")

        config = self._build_agent_config(agent)
        self._validate_agent_bindings(agent, config)
        knowledge_service = self._knowledge_service_for_tenant(agent.get("tenantId"))
        assembly = self._build_execution_middleware_chain(
            knowledge_service,
            workspace_memory_resolver=workspace_memory_resolver,
        ).apply(
            ExecutionAssemblyState(
                agent=agent,
                task=resolved_task,
                config=config,
                additional_prompt_sections=tuple(additional_prompt_sections or []),
                include_workspace_memory_override=include_workspace_memory,
                requested_memory_sections=tuple(memory_sections or []),
            )
        )
        knowledge_binding = assembly.knowledge_binding or KnowledgeBindingResult(
            binding_context=None,
            extra_tools=[],
            effective_tool_allowlist=list(agent.get("toolAllowlist", [])),
            knowledge_hits=[],
            prompt_sections=[],
            event_payload={
                "knowledgeBindingIds": list(agent.get("knowledgeBindingIds") or []),
                "knowledgeNames": [],
                "requestedMode": "naive",
                "effectiveMode": "naive",
                "hitCount": 0,
            },
        )
        return PreparedAgentExecution(
            config=config,
            knowledge_binding=knowledge_binding,
            tool_policy=assembly.tool_policy,
            memory_policy=assembly.memory_policy,
            knowledge_policy=assembly.knowledge_policy,
            runtime_prompt_sections=tuple(assembly.runtime_prompt_sections),
            runtime_memory_sections=tuple(assembly.runtime_memory_sections),
            system_prompt_override=assembly.system_prompt_override,
            middleware_trace=tuple(assembly.middleware_trace),
        )

    def materialize_execution_context(
        self,
        agent: dict[str, Any],
        prepared: PreparedAgentExecution,
        *,
        label: str | None,
        session_key: str,
        session_id: str,
        session_title: str,
        origin_chat_id: str,
        origin_channel: str = "web",
        control_scope: RunControlScope = RunControlScope.TOP_LEVEL,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        thread_id: str | None = None,
        workspace_scope: str = "shared",
        workspace_path: str | None = None,
        sandbox_kind: str = "local",
        exec_working_dir: str | None = None,
        restrict_to_workspace: bool = False,
        exec_timeout_seconds: int | None = None,
    ) -> ExecutionContext:
        """Materialize a first-class execution context from an agent definition."""
        agent_id = str(agent.get("agentId") or "").strip() or None
        instance_id = str(
            agent.get("instanceId")
            or getattr(getattr(self.state, "app_agents", None), "instance_id", "")
            or "default"
        ).strip() or "default"
        tenant_id = str(agent.get("tenantId") or "default").strip() or "default"
        knowledge_scope = "bindings" if prepared.knowledge_policy.binding_ids else "workspace"
        knowledge_policy = KnowledgePolicy(
            scope=knowledge_scope,
            binding_ids=prepared.knowledge_policy.binding_ids,
            names=prepared.knowledge_policy.names,
            hits=prepared.knowledge_policy.hits,
            event_payload=prepared.knowledge_policy.event_snapshot(),
        )
        return ExecutionContext(
            tenant_id=tenant_id,
            instance_id=instance_id,
            principal_kind="agent",
            principal_id=agent_id or str(label or agent.get("name") or "agent"),
            label=str(label or agent.get("name") or "Agent"),
            agent_id=agent_id,
            role=None,
            root_run_id=root_run_id,
            parent_run_id=parent_run_id,
            session_key=session_key,
            session_id=session_id,
            session_title=session_title,
            thread_id=thread_id,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            control_scope=control_scope,
            workspace_path=workspace_path or str(prepared.config.workspace_path),
            workspace_scope=workspace_scope,
            sandbox_kind=sandbox_kind,
            exec_working_dir=exec_working_dir or str(prepared.config.workspace_path),
            restrict_to_workspace=restrict_to_workspace,
            exec_timeout_seconds=exec_timeout_seconds or int(prepared.config.tools.exec.timeout),
            tool_policy=prepared.tool_policy,
            memory_policy=prepared.memory_policy,
            knowledge_policy=knowledge_policy,
        )

    async def _execute_agent_turn(
        self,
        isolated_agent: AgentLoop,
        *,
        task: str,
        execution_context: ExecutionContext,
        on_progress: Callable[[str], Awaitable[None]] | Callable[..., Awaitable[None]] | None = None,
        on_run_event: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> str:
        if hasattr(isolated_agent, "_process_message") and hasattr(isolated_agent, "_connect_mcp"):
            await isolated_agent._connect_mcp()
            run_context = execution_context.to_agent_loop_run_context()
            if on_run_event is not None:
                run_context["run_event_sink"] = on_run_event
            response = await isolated_agent._process_message(
                InboundMessage(
                    channel=execution_context.origin_channel,
                    sender_id="user",
                    chat_id=execution_context.session_id or execution_context.origin_chat_id or "direct",
                    content=task,
                ),
                session_key=execution_context.session_key,
                on_progress=on_progress,
                run_context=run_context,
            )
            return extract_outbound_content(response)

        response = await isolated_agent.process_direct(
            content=task,
            session_key=execution_context.session_key,
            channel=execution_context.origin_channel,
            chat_id=execution_context.session_id or execution_context.origin_chat_id or "direct",
            on_progress=on_progress,
        )
        return extract_outbound_content(response)

    def build_isolated_agent_loop(
        self,
        agent: dict[str, Any],
        *,
        task: str,
        additional_prompt_sections: list[str] | None = None,
        include_workspace_memory: bool | None = None,
        memory_sections: list[tuple[str, str]] | None = None,
        bus: Any | None = None,
        run_registry: Any | None = None,
        workspace_binding: WorkspaceBinding | None = None,
        sandbox_binding: SandboxBinding | None = None,
        prepared: PreparedAgentExecution | None = None,
        workspace_memory_resolver: Callable[[], list[tuple[str, str]]] | None = None,
    ) -> tuple[AgentLoop, PreparedAgentExecution]:
        """Construct an agent loop that honors the agent definition's runtime config."""
        prepared = prepared or self.prepare_agent_execution(
            agent,
            task=task,
            additional_prompt_sections=additional_prompt_sections,
            include_workspace_memory=include_workspace_memory,
            memory_sections=memory_sections,
            workspace_memory_resolver=workspace_memory_resolver,
        )
        runtime_bus = bus or self.state.bus
        if runtime_bus is None:
            raise RuntimeError("Web agent runtime bus is not available.")
        if workspace_binding is None and sandbox_binding is None:
            resolved_environment = self.resolve_environment_binding(
                workspace=prepared.config.workspace_path,
                restrict_to_workspace=prepared.config.tools.restrict_to_workspace,
                exec_config=prepared.config.tools.exec,
                principal_kind="agent",
                tenant_id=str(agent.get("tenantId") or "default"),
                instance_id=str(
                    agent.get("instanceId")
                    or getattr(getattr(self.state, "app_agents", None), "instance_id", "default")
                    or "default"
                ),
                principal_id=str(agent.get("agentId") or agent.get("name") or "agent"),
            )
            resolved_workspace = resolved_environment.workspace
            resolved_sandbox = resolved_environment.sandbox
        else:
            resolved_workspace = workspace_binding or self.resolve_workspace_binding(
                workspace=prepared.config.workspace_path,
                restrict_to_workspace=prepared.config.tools.restrict_to_workspace,
                principal_kind="agent",
                tenant_id=str(agent.get("tenantId") or "default"),
                instance_id=str(
                    agent.get("instanceId")
                    or getattr(getattr(self.state, "app_agents", None), "instance_id", "default")
                    or "default"
                ),
                principal_id=str(agent.get("agentId") or agent.get("name") or "agent"),
            )
            resolved_sandbox = sandbox_binding or self.resolve_sandbox_binding(
                workspace_binding=resolved_workspace,
                exec_config=prepared.config.tools.exec,
                principal_kind="agent",
                tenant_id=str(agent.get("tenantId") or "default"),
                instance_id=str(
                    agent.get("instanceId")
                    or getattr(getattr(self.state, "app_agents", None), "instance_id", "default")
                    or "default"
                ),
                principal_id=str(agent.get("agentId") or agent.get("name") or "agent"),
            )
        isolated_agent = AgentLoop(
            bus=runtime_bus,
            provider=self.state.config_runtime.make_provider(prepared.config),
            workspace=resolved_workspace.path,
            context_workspace=prepared.config.workspace_path,
            model=prepared.config.agents.defaults.model,
            max_iterations=prepared.config.agents.defaults.max_tool_iterations,
            context_window_tokens=prepared.config.agents.defaults.context_window_tokens,
            web_search_config=prepared.config.tools.web.search,
            web_proxy=prepared.config.tools.web.proxy or None,
            exec_config=prepared.config.tools.exec,
            cron_service=self.state.cron,
            restrict_to_workspace=resolved_sandbox.restrict_to_workspace,
            session_manager=self.state.sessions,
            mcp_servers=prepared.config.tools.mcp_servers,
            channels_config=prepared.config.channels,
            run_registry=run_registry,
            tool_allowlist=prepared.effective_tool_allowlist,
            skill_names=list(agent.get("skillIds", [])),
            system_prompt_override=prepared.system_prompt_override,
            include_workspace_memory=prepared.include_workspace_memory,
            memory_sections=prepared.memory_sections,
            extra_tools=prepared.knowledge_binding.extra_tools,
            workspace_provider=self._get_workspace_provider(),
            sandbox_binding=resolved_sandbox,
            sandbox_provider=self._get_sandbox_provider(),
        )
        return isolated_agent, prepared

    async def run_agent_definition(
        self,
        agent: dict[str, Any],
        *,
        task: str,
        label: str | None = None,
        session_key: str,
        session_id: str,
        session_title: str,
        origin_chat_id: str,
        origin_channel: str = "web",
        control_scope: RunControlScope = RunControlScope.TOP_LEVEL,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        thread_id: str | None = None,
        route_metadata: dict[str, Any] | None = None,
        additional_prompt_sections: list[str] | None = None,
        include_workspace_memory: bool | None = None,
        memory_sections: list[tuple[str, str]] | None = None,
        workspace_memory_resolver: Callable[[], list[tuple[str, str]]] | None = None,
        workspace_binding: WorkspaceBinding | None = None,
        sandbox_binding: SandboxBinding | None = None,
        prepared: PreparedAgentExecution | None = None,
        on_progress: Callable[[str], Awaitable[None]] | Callable[..., Awaitable[None]] | None = None,
        on_run_event: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        if not self.state.agent or not self.state.sessions or not self.state.runs:
            raise RuntimeError("Web agent runtime is not available.")

        task = str(task or "").strip()
        if not task:
            raise ValueError("content is required.")

        config = prepared.config if prepared else self._build_agent_config(agent)
        if prepared is None:
            self._validate_agent_bindings(agent, config)

        agent_id = str(agent.get("agentId") or "").strip() or None
        instance_id = str(
            agent.get("instanceId")
            or getattr(getattr(self.state, "app_agents", None), "instance_id", "")
            or "default"
        ).strip() or "default"
        tenant_id = str(agent.get("tenantId") or "default").strip() or "default"
        principal_id = agent_id or str(label or agent.get("name") or "agent")

        if workspace_binding is None or sandbox_binding is None:
            environment = self.resolve_environment_binding(
                workspace=config.workspace_path,
                restrict_to_workspace=config.tools.restrict_to_workspace,
                exec_config=config.tools.exec,
                principal_kind="agent",
                tenant_id=tenant_id,
                instance_id=instance_id,
                principal_id=principal_id,
                thread_id=thread_id,
                root_run_id=root_run_id,
                session_key=session_key,
            )
            workspace_binding = workspace_binding or environment.workspace
            sandbox_binding = sandbox_binding or environment.sandbox
        assert workspace_binding is not None
        assert sandbox_binding is not None

        if prepared is None:
            effective_workspace_memory_resolver = workspace_memory_resolver
            if effective_workspace_memory_resolver is None:
                heading = "Workspace Shared Memory" if workspace_binding.scope == "shared" else "Agent Workspace Memory"
                effective_workspace_memory_resolver = self.build_workspace_memory_resolver(
                    workspace_binding.path,
                    heading=heading,
                )
            prepared = self.prepare_agent_execution(
                agent,
                task=task,
                additional_prompt_sections=additional_prompt_sections,
                include_workspace_memory=include_workspace_memory,
                memory_sections=memory_sections,
                workspace_memory_resolver=effective_workspace_memory_resolver,
            )

        execution_context = self.materialize_execution_context(
            agent,
            prepared,
            label=label,
            session_key=session_key,
            session_id=session_id,
            session_title=session_title,
            origin_chat_id=origin_chat_id,
            origin_channel=origin_channel,
            control_scope=control_scope,
            parent_run_id=parent_run_id,
            root_run_id=root_run_id,
            thread_id=thread_id,
        )
        execution_context.workspace_path = str(workspace_binding.path)
        execution_context.workspace_scope = workspace_binding.scope
        execution_context.sandbox_kind = sandbox_binding.kind
        execution_context.exec_working_dir = str(sandbox_binding.working_dir)
        execution_context.restrict_to_workspace = sandbox_binding.restrict_to_workspace
        execution_context.exec_timeout_seconds = sandbox_binding.exec_timeout
        isolated_agent, _ = self.build_isolated_agent_loop(
            agent,
            task=task,
            additional_prompt_sections=additional_prompt_sections,
            include_workspace_memory=include_workspace_memory,
            memory_sections=memory_sections,
            run_registry=self.state.runs,
            workspace_binding=workspace_binding,
            sandbox_binding=sandbox_binding,
            prepared=prepared,
            workspace_memory_resolver=workspace_memory_resolver,
        )
        config = prepared.config
        knowledge_hits = prepared.knowledge_hits

        record = self.state.runs.create_run(
            kind=RunKind.AGENT,
            label=execution_context.label,
            task_preview=" ".join(task.split())[:280],
            tenant_id=execution_context.tenant_id,
            instance_id=execution_context.instance_id,
            agent_id=execution_context.agent_id,
            thread_id=execution_context.thread_id,
            parent_run_id=execution_context.parent_run_id,
            root_run_id=execution_context.root_run_id,
            session_key=execution_context.session_key,
            origin_channel=execution_context.origin_channel,
            origin_chat_id=execution_context.origin_chat_id,
            control_scope=execution_context.control_scope,
            workspace_path=execution_context.workspace_path,
            memory_scope=execution_context.memory_policy.scope,
            knowledge_scope=execution_context.knowledge_policy.scope,
        )
        execution_context.run_id = record.run_id
        if not execution_context.root_run_id:
            execution_context.root_run_id = record.run_id

        session = self.state.sessions.get_or_create(execution_context.session_key)
        if not session.metadata.get("title"):
            session.metadata["title"] = execution_context.session_title
        self.state.sessions.save(session)

        self.state.runs.append_event(
            record.run_id,
            "execution_context_materialized",
            execution_context.event_snapshot(),
        )
        self.state.runs.append_event(
            record.run_id,
            "bindings_resolved",
            {
                "toolAllowlist": execution_context.tool_policy.allowlist_as_list(),
                "mcpServerIds": execution_context.tool_policy.mcp_server_ids_as_list(),
                "skillIds": execution_context.tool_policy.skill_ids_as_list(),
                "knowledgeBindingIds": execution_context.knowledge_policy.binding_ids_as_list(),
                "knowledgeNames": execution_context.knowledge_policy.names_as_list(),
            },
        )
        self.state.runs.append_event(
            record.run_id,
            "knowledge_retrieved",
            execution_context.knowledge_policy.event_snapshot(),
        )
        route_payload = self._channel_route_event_payload(route_metadata)
        if route_payload:
            self.state.runs.append_event(
                record.run_id,
                "channel_dispatch_resolved",
                route_payload,
            )

        progress_events: list[str] = []

        async def _on_progress(progress: str, *, tool_hint: bool = False) -> None:
            if not progress:
                return
            progress_events.append(progress)
            self.state.runs.append_event(
                record.run_id,
                "progress",
                {
                    "content": progress,
                    "toolHint": tool_hint,
                },
            )
            if on_progress is not None:
                await on_progress(progress, tool_hint=tool_hint)

        try:
            self.state.runs.start_run(record.run_id)
            response = await self._execute_agent_turn(
                isolated_agent,
                task=task,
                execution_context=execution_context,
                on_progress=_on_progress,
                on_run_event=on_run_event,
            )
            artifact_path = self.state.runs.write_markdown_artifact(
                record.run_id,
                title=f"Run Artifact · {execution_context.label}",
                metadata={
                    **execution_context.artifact_metadata(kind="agent"),
                    "routing_binding_id": (route_payload or {}).get("bindingId"),
                    "routing_audit_id": (route_payload or {}).get("auditId"),
                    "routing_target_type": (route_payload or {}).get("targetType"),
                    "routing_target_id": (route_payload or {}).get("targetId"),
                    "routing_tenant_id": (route_payload or {}).get("tenantId"),
                    "model": config.agents.defaults.model,
                },
                sections=[
                    ("Task", task),
                    ("Result", response),
                    ("Bindings", self._format_bindings_markdown({**agent, "toolAllowlist": execution_context.tool_policy.allowlist_as_list()})),
                    ("Retrieved Knowledge", self._format_knowledge_hits_markdown(knowledge_hits)),
                ],
            )
            self.state.runs.complete_run(
                record.run_id,
                RunResultSummary(
                    content=response,
                    metadata={
                        "sessionKey": execution_context.session_key,
                        "sessionId": execution_context.session_id,
                        "progressEventCount": len(progress_events),
                        "knowledgeHitCount": len(knowledge_hits),
                    },
                ),
                artifact_path=artifact_path,
            )
        except asyncio.CancelledError:
            try:
                self.state.runs.cancel_run(record.run_id)
            except Exception:
                pass
            raise
        except Exception as exc:
            self.state.runs.fail_run(record.run_id, "AGENT_TEST_RUN_FAILED", str(exc))
            raise
        finally:
            await isolated_agent.close_mcp()

        messages = self._format_messages(execution_context.session_key, execution_context.session_id)
        return {
            "run": self.state.runs.get_run(record.run_id),
            "session": self._format_session_summary(execution_context.session_key, execution_context.session_id),
            "assistantMessage": self._get_last_assistant_message(execution_context.session_key, execution_context.session_id),
            "messages": messages,
            "pendingKnowledgeBindings": execution_context.knowledge_policy.binding_ids_as_list(),
            "knowledgeHits": knowledge_hits,
            "appliedBindings": {
                "toolAllowlist": execution_context.tool_policy.allowlist_as_list(),
                "mcpServerIds": execution_context.tool_policy.mcp_server_ids_as_list(),
                "skillIds": execution_context.tool_policy.skill_ids_as_list(),
                "knowledgeBindingIds": execution_context.knowledge_policy.binding_ids_as_list(),
            },
        }

    async def test_run_agent(self, agent_id: str, content: str, *, tenant_id: str | None = None) -> dict[str, Any]:
        if not self.state.agent or not self.state.sessions or not self.state.runs:
            raise RuntimeError("Web agent runtime is not available.")

        task = str(content or "").strip()
        if not task:
            raise ValueError("content is required.")

        try:
            agent = self.state.app_agents.get_agent(agent_id, tenant_id=tenant_id)
        except AgentDefinitionNotFoundError as exc:
            raise KeyError(agent_id) from exc

        provisional_token = (
            self.state.instance.next_id("agent-test")
            if hasattr(self.state.instance, "next_id")
            else None
        )
        if not provisional_token:
            from uuid import uuid4

            provisional_token = uuid4().hex
        provisional_session_key = self._agent_test_session_key(agent["agentId"], provisional_token)
        provisional_session_id = self._agent_test_session_id(agent["agentId"], provisional_token)
        provisional_environment = self.resolve_isolated_agent_environment(
            agent,
            thread_id=provisional_session_id,
            session_key=provisional_session_key,
        )
        result = await self.run_agent_definition(
            agent,
            task=task,
            label=agent["name"],
            session_key=provisional_session_key,
            session_id=provisional_session_id,
            session_title=f"Agent Test · {agent['name']}",
            origin_chat_id=agent["agentId"],
            thread_id=provisional_session_id,
            workspace_memory_resolver=self.build_workspace_memory_resolver(
                provisional_environment.workspace.path,
                heading="Agent Workspace Memory",
            ),
            workspace_binding=provisional_environment.workspace,
            sandbox_binding=provisional_environment.sandbox,
        )
        run_id = result["run"]["runId"]
        actual_session_key = self._agent_test_session_key(agent["agentId"], run_id)
        actual_session_id = self._agent_test_session_id(agent["agentId"], run_id)
        if result["session"]["id"] != actual_session_id:
            session = self.state.sessions.get_or_create(provisional_session_key)
            self.state.sessions.delete(provisional_session_key)
            actual = self.state.sessions.get_or_create(actual_session_key)
            actual.messages = list(session.messages)
            actual.metadata.update(session.metadata)
            self.state.sessions.save(actual)
            actual_environment = self.resolve_isolated_agent_environment(
                agent,
                thread_id=actual_session_id,
                session_key=actual_session_key,
            )
            provisional_workspace_path = provisional_environment.workspace.path
            actual_workspace_path = actual_environment.workspace.path
            if provisional_workspace_path != actual_workspace_path and provisional_workspace_path.exists():
                actual_workspace_path.parent.mkdir(parents=True, exist_ok=True)
                if not actual_workspace_path.exists():
                    provisional_workspace_path.rename(actual_workspace_path)
            self.state.runs.store.update_run(
                run_id,
                session_key=actual_session_key,
                thread_id=actual_session_id,
                workspace_path=str(actual_workspace_path),
            )
            result["run"] = self.state.runs.get_run(run_id)
            result["session"] = self._format_session_summary(actual_session_key, actual_session_id)
            result["messages"] = self._format_messages(actual_session_key, actual_session_id)
            result["assistantMessage"] = self._get_last_assistant_message(actual_session_key, actual_session_id)
        return result
