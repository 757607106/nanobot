"""LangGraph-based team supervisor for dynamic multi-agent orchestration.

This module implements a LangGraph Supervisor pattern where the team supervisor LLM
dynamically decides which members to call, in what order, and when to produce
the final answer.

Single-agent execution (AgentLoop, run_agent_definition) is completely untouched.
LangGraph is used purely as the scheduling/orchestration layer.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import Any, Sequence

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import StructuredTool
from langgraph.prebuilt import create_react_agent
from loguru import logger
from pydantic import ConfigDict, Field

from nanobot.harness import (
    ChildTaskHandle,
    ChildTaskProjector,
    ChildTaskRequest,
    ChildTaskResult,
    InProcessChildTaskRuntime,
    collect_child_run_ids,
)
from nanobot.harness.events import summarize_langgraph_chunk
from nanobot.platform.runs import RunControlScope
from nanobot.platform.teams.models import SupervisorConfig
from nanobot.providers.base import ToolCallRequest

# ---------------------------------------------------------------------------
# A. LLM Bridge: NanobotSupervisorLLM
# ---------------------------------------------------------------------------


def _langchain_to_openai_messages(messages: Sequence[BaseMessage]) -> list[dict[str, Any]]:
    """Convert LangChain BaseMessage sequence to OpenAI-format dicts."""
    result: list[dict[str, Any]] = []
    for msg in messages:
        if isinstance(msg, SystemMessage):
            result.append({"role": "system", "content": msg.content})
        elif isinstance(msg, HumanMessage):
            result.append({"role": "user", "content": msg.content})
        elif isinstance(msg, AIMessage):
            entry: dict[str, Any] = {"role": "assistant", "content": msg.content or None}
            if msg.tool_calls:
                entry["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": (
                                tc["args"]
                                if isinstance(tc["args"], str)
                                else __import__("json").dumps(tc["args"], ensure_ascii=False)
                            ),
                        },
                    }
                    for tc in msg.tool_calls
                ]
            result.append(entry)
        elif isinstance(msg, ToolMessage):
            result.append({
                "role": "tool",
                "content": msg.content or "(empty)",
                "tool_call_id": msg.tool_call_id,
            })
        else:
            result.append({"role": "user", "content": str(msg.content)})
    return result


def _openai_tool_calls_to_langchain(tool_calls: list[ToolCallRequest]) -> list[dict[str, Any]]:
    """Convert nanobot ToolCallRequest list to LangChain tool_calls format."""
    return [
        {
            "name": tc.name,
            "args": tc.arguments,
            "id": tc.id,
            "type": "tool_call",
        }
        for tc in tool_calls
    ]


class NanobotSupervisorLLM(BaseChatModel):
    """Adapter bridging nanobot's LLMProvider to LangChain's BaseChatModel.

    Only used for the Supervisor LLM in team orchestration.
    Member agents still run via their own AgentLoop.
    """

    provider: Any = Field(exclude=True)
    model_name: str = ""
    bound_tools: list[dict[str, Any]] | None = Field(default=None, exclude=True)
    model_config = ConfigDict(arbitrary_types_allowed=True)

    @property
    def _llm_type(self) -> str:
        return "nanobot-supervisor"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        raise NotImplementedError(
            "NanobotSupervisorLLM is async-only. Use _agenerate() via LangGraph's async invoke."
        )

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        openai_messages = _langchain_to_openai_messages(messages)

        tools = None
        if self.bound_tools:
            tools = self.bound_tools

        response = await self.provider.chat_with_retry(
            messages=openai_messages,
            tools=tools,
            model=self.model_name or None,
        )

        tool_calls = _openai_tool_calls_to_langchain(response.tool_calls) if response.tool_calls else []
        ai_message = AIMessage(
            content=response.content or "",
            tool_calls=tool_calls,
        )
        return ChatResult(generations=[ChatGeneration(message=ai_message)])

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> NanobotSupervisorLLM:
        """Return a copy with tools bound for LLM calls."""
        from langchain_core.utils.function_calling import convert_to_openai_tool

        bound = self.model_copy()
        bound.model_name = self.model_name
        bound.bound_tools = [convert_to_openai_tool(t) for t in tools]
        return bound


# ---------------------------------------------------------------------------
# B. Member Tool Factory
# ---------------------------------------------------------------------------


@dataclass
class MemberCallTracker:
    """Tracks how many times each member agent has been called."""

    counts: dict[str, int] = field(default_factory=dict)
    total_calls: int = 0
    max_total_calls: int = 20

    def next_call_index(self, agent_id: str) -> int:
        count = self.counts.get(agent_id, 0) + 1
        self.counts[agent_id] = count
        self.total_calls += 1
        return count

    @property
    def limit_reached(self) -> bool:
        return self.total_calls >= self.max_total_calls


@dataclass(slots=True)
class TeamMemberTaskRuntime:
    """Shared child-task adapter for LangGraph member tool calls."""

    team: dict[str, Any]
    root_run_id: str
    thread_id: str
    agent_runtime: Any
    runs: Any
    propose_memory_candidate: Any
    tracker: MemberCallTracker
    root_origin_channel: str
    root_origin_chat_id: str
    shared_knowledge_block: str | None
    team_memory_sections: list[tuple[str, str]]
    member_access_policy: dict[str, Any]
    child_runtime: InProcessChildTaskRuntime

    def _build_member_runtime_inputs(self, member: dict[str, Any]) -> tuple[list[str], list[tuple[str, str]], int]:
        knowledge_policy = str(self.member_access_policy.get("teamSharedKnowledge") or "explicit_only")
        memory_policy = str(self.member_access_policy.get("teamSharedMemory") or "leader_write_member_read")
        additional_sections: list[str] = []
        if knowledge_policy == "members_read" and self.shared_knowledge_block:
            additional_sections.append(self.shared_knowledge_block)
        member_memory = self.team_memory_sections if memory_policy == "leader_write_member_read" else []
        timeout_seconds = int(member.get("maxExecutionTimeoutSeconds") or 300)
        return additional_sections, member_memory, timeout_seconds

    def _build_child_request(
        self,
        member: dict[str, Any],
        task: str,
        *,
        call_index: int,
    ) -> ChildTaskRequest:
        agent_id = member["agentId"]
        agent_name = member["name"]
        additional_sections, member_memory, timeout_seconds = self._build_member_runtime_inputs(member)
        session_suffix = f"member:{agent_id}" if call_index == 1 else f"member:{agent_id}:{call_index}"
        session_key = f"team-test:{self.team['teamId']}:{self.root_run_id}:{session_suffix}"
        return ChildTaskRequest(
            task=task,
            label=f"{self.team['name']} · {agent_name}",
            tenant_id=str(member.get("tenantId") or self.team.get("tenantId") or "").strip() or None,
            instance_id=str(
                member.get("instanceId")
                or self.team.get("instanceId")
                or getattr(getattr(getattr(self.agent_runtime, "state", None), "app_agents", None), "instance_id", "")
            ).strip() or None,
            principal_kind="team_member",
            principal_id=agent_id,
            agent_definition=member,
            agent_id=agent_id,
            team_id=self.team["teamId"],
            thread_id=self.thread_id,
            session_key=session_key,
            session_id=session_key,
            session_title=f"Team Run · {self.team['name']} · {agent_name}",
            origin_channel=self.root_origin_channel,
            origin_chat_id=self.root_origin_chat_id,
            control_scope=RunControlScope.MEMBER,
            parent_run_id=self.root_run_id,
            root_run_id=self.root_run_id,
            spawn_depth=1,
            timeout_seconds=timeout_seconds,
            additional_prompt_sections=tuple(additional_sections),
            include_workspace_memory=False,
            memory_sections=tuple(member_memory),
        )

    async def _execute_child_request(
        self,
        member: dict[str, Any],
        handle: ChildTaskHandle,
    ) -> ChildTaskResult:
        child_request = handle.request

        async def _project_progress(progress: str, *, tool_hint: bool = False) -> None:
            message = str(progress or "").strip()
            if not message:
                return
            self.child_runtime.project_handle_progress(
                handle,
                status="running",
                message=message,
                payload={"toolHint": tool_hint},
            )

        async def _project_run_event(event_type: str, payload: dict[str, Any]) -> None:
            if event_type == "model_called":
                self.child_runtime.project_handle_progress(
                    handle,
                    status="running",
                    message=f"Calling model {payload.get('model')}",
                    payload={
                        "stage": "model_called",
                        "iteration": payload.get("iteration"),
                        "model": payload.get("model"),
                    },
                )
            elif event_type == "model_result":
                self.child_runtime.project_handle_progress(
                    handle,
                    status="running",
                    message=f"Model {payload.get('model')} returned",
                    payload={
                        "stage": "model_result",
                        "iteration": payload.get("iteration"),
                        "model": payload.get("model"),
                        "toolCallCount": payload.get("toolCallCount"),
                    },
                )
            elif event_type == "tool_called":
                tool_name = str(payload.get("toolName") or "").strip()
                self.child_runtime.project_handle_progress(
                    handle,
                    status="running",
                    message=f"Running tool {tool_name}" if tool_name else "Running tool",
                    payload={
                        "stage": "tool_called",
                        "iteration": payload.get("iteration"),
                        "toolName": tool_name or None,
                    },
                )
            elif event_type == "tool_result":
                tool_name = str(payload.get("toolName") or "").strip()
                self.child_runtime.project_handle_progress(
                    handle,
                    status="running",
                    message=f"Tool {tool_name} finished" if tool_name else "Tool finished",
                    payload={
                        "stage": "tool_result",
                        "iteration": payload.get("iteration"),
                        "toolName": tool_name or None,
                    },
                )

        execute_child = getattr(self.agent_runtime, "execute_child_agent_task", None)
        try:
            if callable(execute_child):
                return await execute_child(
                    child_request,
                    on_progress=_project_progress,
                    on_run_event=_project_run_event,
                )

            run_coro = self.agent_runtime.run_agent_definition(
                member,
                task=child_request.task,
                label=child_request.resolved_label(),
                session_key=child_request.resolved_session_key(),
                session_id=child_request.resolved_session_id(),
                session_title=child_request.session_title,
                origin_channel=child_request.origin_channel,
                origin_chat_id=child_request.origin_chat_id,
                control_scope=child_request.control_scope,
                team_id=child_request.team_id,
                thread_id=child_request.thread_id,
                parent_run_id=child_request.parent_run_id,
                root_run_id=child_request.root_run_id,
                spawn_depth=child_request.spawn_depth,
                additional_prompt_sections=child_request.additional_prompt_sections_as_list() or None,
                include_workspace_memory=child_request.include_workspace_memory,
                memory_sections=child_request.memory_sections_as_list(),
                on_progress=_project_progress,
                on_run_event=_project_run_event,
            )
            timeout_seconds = int(child_request.timeout_seconds or 0)
            if timeout_seconds > 0:
                run_result = await asyncio.wait_for(run_coro, timeout=timeout_seconds)
            else:
                run_result = await run_coro
            return ChildTaskResult.from_agent_run(child_request, run_result)
        except asyncio.TimeoutError:
            timeout_seconds = int(child_request.timeout_seconds or 0)
            timeout_text = f"Timeout after {timeout_seconds}s" if timeout_seconds > 0 else "Timed out"
            return ChildTaskResult(
                status="timed_out",
                content=timeout_text,
                task=child_request.task,
                label=child_request.resolved_label(),
                principal_kind=child_request.principal_kind,
                principal_id=child_request.principal_id or child_request.agent_id,
                agent_id=child_request.agent_id,
                team_id=child_request.team_id,
                thread_id=child_request.thread_id,
                session_key=child_request.resolved_session_key(),
                session_id=child_request.resolved_session_id(),
                origin_channel=child_request.origin_channel,
                origin_chat_id=child_request.origin_chat_id,
                metadata={"error": timeout_text, "runStatus": "timed_out"},
            )
        except asyncio.CancelledError:
            return ChildTaskResult(
                status="cancelled",
                content="Cancelled",
                task=child_request.task,
                label=child_request.resolved_label(),
                principal_kind=child_request.principal_kind,
                principal_id=child_request.principal_id or child_request.agent_id,
                agent_id=child_request.agent_id,
                team_id=child_request.team_id,
                thread_id=child_request.thread_id,
                session_key=child_request.resolved_session_key(),
                session_id=child_request.resolved_session_id(),
                origin_channel=child_request.origin_channel,
                origin_chat_id=child_request.origin_chat_id,
                metadata={"error": "Cancelled", "runStatus": "cancelled"},
            )
        except Exception as exc:
            return ChildTaskResult(
                status="error",
                content=f"Error: {exc}",
                task=child_request.task,
                label=child_request.resolved_label(),
                principal_kind=child_request.principal_kind,
                principal_id=child_request.principal_id or child_request.agent_id,
                agent_id=child_request.agent_id,
                team_id=child_request.team_id,
                thread_id=child_request.thread_id,
                session_key=child_request.resolved_session_key(),
                session_id=child_request.resolved_session_id(),
                origin_channel=child_request.origin_channel,
                origin_chat_id=child_request.origin_chat_id,
                metadata={"error": str(exc), "runStatus": "failed"},
            )

    async def call_member(self, member: dict[str, Any], task: str) -> str:
        agent_id = member["agentId"]
        agent_name = member["name"]
        if self.tracker.limit_reached:
            return (
                f"Error: Maximum member call limit ({self.tracker.max_total_calls}) reached. "
                f"Please synthesize the results you have and provide a final answer."
            )

        call_index = self.tracker.next_call_index(agent_id)
        child_request = self._build_child_request(member, task, call_index=call_index)
        handle = await self.child_runtime.start(
            child_request,
            executor=lambda task_handle: self._execute_child_request(member, task_handle),
            parent_run_id=self.root_run_id,
            root_run_id=self.root_run_id,
            call_index=call_index,
        )
        child_result = await self.child_runtime.wait(handle)

        if child_result.status == "timed_out":
            return f"Error: {agent_name} timed out after {int(child_request.timeout_seconds or 0)} seconds."
        if child_result.status == "cancelled":
            return f"Error: {agent_name} execution was cancelled."
        if child_result.status != "ok":
            error_text = str((child_result.metadata or {}).get("error") or child_result.content or child_result.status)
            return f"Error: {agent_name} failed to complete the task: {error_text}"

        run_result = child_result.raw_result or {
            "run": {
                "runId": child_result.run_id,
                "status": (child_result.metadata or {}).get("runStatus") or child_result.status,
            },
            "assistantMessage": {"content": child_result.content},
        }

        self.propose_memory_candidate(
            root_run_id=self.root_run_id,
            team=self.team,
            agent=member,
            run_result=run_result,
        )
        return child_result.content or "(no response)"


def _slugify_tool_name(name: str) -> str:
    """Convert agent name to a valid tool function name."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "agent"


def create_member_tools(
    *,
    members: list[dict[str, Any]],
    team: dict[str, Any],
    root_run_id: str,
    thread_id: str,
    agent_runtime: Any,
    runs: Any,
    propose_memory_candidate: Any,
    shared_knowledge_block: str | None,
    team_memory_sections: list[tuple[str, str]],
    member_access_policy: dict[str, Any],
    supervisor_config: SupervisorConfig,
) -> tuple[list[StructuredTool], MemberCallTracker]:
    """Dynamically create LangChain tools for each member agent.

    Each tool wraps a call to ``run_agent_definition()`` so the
    Supervisor can delegate tasks to members via standard tool calling.
    """
    tracker = MemberCallTracker(max_total_calls=supervisor_config.max_member_calls_per_run)
    tools: list[StructuredTool] = []
    root_run = runs.get_run(root_run_id)
    root_origin_channel = str(root_run.get("originChannel") or "web").strip() or "web"
    root_origin_chat_id = str(root_run.get("originChatId") or team["teamId"]).strip() or team["teamId"]
    member_runtime = TeamMemberTaskRuntime(
        team=team,
        root_run_id=root_run_id,
        thread_id=thread_id,
        agent_runtime=agent_runtime,
        runs=runs,
        propose_memory_candidate=propose_memory_candidate,
        tracker=tracker,
        root_origin_channel=root_origin_channel,
        root_origin_chat_id=root_origin_chat_id,
        shared_knowledge_block=shared_knowledge_block,
        team_memory_sections=team_memory_sections,
        member_access_policy=member_access_policy,
        child_runtime=InProcessChildTaskRuntime(projector=ChildTaskProjector(runs=runs)),
    )

    for member in members:
        agent_id = member["agentId"]
        agent_name = member["name"]
        tool_name = f"call_{_slugify_tool_name(agent_name)}"

        # Use team_role_hint with higher priority, fallback to description/systemPrompt
        role_hint = str(member.get("teamRoleHint") or "").strip()
        description_snippet = role_hint or str(member.get("description") or member.get("systemPrompt") or "").strip()
        if len(description_snippet) > 200:
            description_snippet = description_snippet[:197] + "..."

        output_hint = str(member.get("outputFormatHint") or "").strip()
        output_hint_text = f" Expected output: {output_hint}" if output_hint else ""

        tool_description = (
            f"Delegate a task to team member '{agent_name}'. "
            f"{description_snippet}"
            f"{output_hint_text} "
            f"Pass a clear, specific task description."
        )

        _member = member

        async def _call_member(task: str, _m=_member) -> str:
            return await member_runtime.call_member(_m, task)

        tool = StructuredTool.from_function(
            coroutine=_call_member,
            name=tool_name,
            description=tool_description,
            args_schema=None,
        )
        tools.append(tool)

    return tools, tracker


# ---------------------------------------------------------------------------
# C. LangGraph Team Runner
# ---------------------------------------------------------------------------


@dataclass
class TeamRunResult:
    """Result from a LangGraph team supervisor run."""

    final_content: str
    member_run_ids: list[str] = field(default_factory=list)
    supervisor_snapshot: dict[str, Any] = field(default_factory=dict)
    team_run_snapshot: dict[str, Any] = field(default_factory=dict)


@dataclass
class PreparedSupervisorExecution:
    """Reusable supervisor runtime materialization for one team run."""

    supervisor: dict[str, Any]
    member_defs: list[dict[str, Any]]
    runtime_prepared: Any
    supervisor_llm: NanobotSupervisorLLM
    member_tools: list[StructuredTool]
    system_prompt: str
    supervisor_additional_sections: list[str] = field(default_factory=list)
    supervisor_memory: list[tuple[str, str]] = field(default_factory=list)
    team_thread_context_attached: bool = False
    shared_knowledge_attached: bool = False

    def event_snapshot(self, supervisor_config: SupervisorConfig) -> dict[str, Any]:
        """Return a compact runtime snapshot for supervisor observability."""
        tool_policy = getattr(self.runtime_prepared, "tool_policy", None)
        memory_policy = getattr(self.runtime_prepared, "memory_policy", None)
        knowledge_policy = getattr(self.runtime_prepared, "knowledge_policy", None)
        return {
            "supervisorAgentId": str(self.supervisor.get("agentId") or "").strip() or None,
            "memberAgentIds": [str(item.get("agentId") or "").strip() for item in self.member_defs if str(item.get("agentId") or "").strip()],
            "memberToolNames": [tool.name for tool in self.member_tools],
            "modelName": self.supervisor_llm.model_name,
            "responseMode": supervisor_config.response_mode,
            "recursionLimit": supervisor_config.recursion_limit,
            "knowledgeSectionCount": len(self.supervisor_additional_sections),
            "memorySectionCount": len(self.supervisor_memory),
            "runtimePromptFragmentCount": len(getattr(self.runtime_prepared, "runtime_prompt_fragments", []) or []),
            "runtimeMemoryFragmentCount": len(getattr(self.runtime_prepared, "runtime_memory_fragments", []) or []),
            "middlewareTrace": list(getattr(self.runtime_prepared, "middleware_stages", []) or []),
            "toolAllowlist": tool_policy.allowlist_as_list() if tool_policy is not None else [],
            "mcpServerIds": tool_policy.mcp_server_ids_as_list() if tool_policy is not None else [],
            "skillIds": tool_policy.skill_ids_as_list() if tool_policy is not None else [],
            "memoryScope": getattr(memory_policy, "scope", None),
            "includeWorkspaceMemory": getattr(memory_policy, "include_workspace_memory", None),
            "knowledgeScope": getattr(knowledge_policy, "scope", None),
            "knowledgeBindingIds": knowledge_policy.binding_ids_as_list() if knowledge_policy is not None else [],
            "knowledgeNames": knowledge_policy.names_as_list() if knowledge_policy is not None else [],
            "knowledgeHitCount": len(getattr(knowledge_policy, "hits", ()) or ()),
            "teamThreadContextAttached": self.team_thread_context_attached,
            "sharedKnowledgeAttached": self.shared_knowledge_attached,
            "systemPromptLength": len(self.system_prompt),
        }


@dataclass
class PreparedTeamGraph:
    """Reusable LangGraph preparation result shared by invoke/stream paths."""

    graph: Any
    supervisor_execution: PreparedSupervisorExecution


def _build_supervisor_prompt(
    team: dict[str, Any],
    supervisor: dict[str, Any],
    members: list[dict[str, Any]],
    *,
    supervisor_config: SupervisorConfig,
    supervisor_additional_sections: list[str] | None = None,
    team_thread_context_block: str | None = None,
    shared_knowledge_block: str | None = None,
    memory_sections: list[tuple[str, str]] | None = None,
) -> str:
    """Build the system prompt for the Supervisor LLM."""
    sections: list[str] = []

    # Custom template takes highest priority
    custom_template = supervisor_config.supervisor_prompt_template.strip()
    if custom_template:
        # Support placeholders in custom template
        member_names = ", ".join(m["name"] for m in members)
        rendered = custom_template.replace("{team_name}", team.get("name") or "")
        rendered = rendered.replace("{members_list}", member_names)
        sections.append(rendered)
    else:
        supervisor_prompt = str(supervisor.get("systemPrompt") or "").strip()
        if supervisor_prompt:
            sections.append(supervisor_prompt)

    sections.append(f"You are the supervisor of team '{team['name']}'.")

    member_lines = []
    for m in members:
        slug = _slugify_tool_name(m["name"])
        # Use teamRoleHint if available, otherwise fallback to description/systemPrompt
        role_hint = str(m.get("teamRoleHint") or "").strip()
        desc = role_hint or str(m.get("description") or m.get("systemPrompt") or "").strip()
        if len(desc) > 150:
            desc = desc[:147] + "..."
        output_hint = str(m.get("outputFormatHint") or "").strip()
        hint_text = f" (Output format: {output_hint})" if output_hint else ""
        member_lines.append(f"- **{m['name']}**: {desc}{hint_text}\n  Tool: call_{slug}(task=\"...\")")
    if member_lines:
        sections.append("## Your Team Members\n\n" + "\n".join(member_lines))

    response_mode = supervisor_config.response_mode
    if response_mode == "last_member":
        response_instruction = (
            "When ready, return the last member's response as the final answer."
        )
    elif response_mode == "custom":
        response_instruction = (
            "When ready, respond with your final answer based on the results collected."
        )
    else:
        response_instruction = (
            "When ready, respond directly with the final synthesized answer — do NOT call any tool."
        )

    sections.append(
        "## How to Work\n\n"
        "1. Analyze the task and decide which team members to involve.\n"
        "2. Delegate sub-tasks by calling member tools with clear, specific instructions.\n"
        "3. Review member results and iterate if needed (call again with refined tasks).\n"
        "4. You may call the same member multiple times with different tasks.\n"
        f"5. {response_instruction}"
    )

    for section in supervisor_additional_sections or []:
        text = str(section or "").strip()
        if text:
            sections.append(text)

    if team_thread_context_block:
        sections.append(team_thread_context_block)

    if shared_knowledge_block:
        sections.append(shared_knowledge_block)

    if memory_sections:
        memory_parts: list[str] = []
        for heading, content in memory_sections:
            title = str(heading or "").strip()
            body = str(content or "").strip()
            if title and body:
                memory_parts.append(f"## {title}\n\n{body}")
        if memory_parts:
            sections.append("# Memory\n\n" + "\n\n".join(memory_parts))

    return "\n\n".join(sections)


class LangGraphTeamRunner:
    """Orchestrates a team run using LangGraph's create_react_agent."""

    def __init__(self, agent_runtime: Any, runs: Any, config_runtime: Any):
        self.agent_runtime = agent_runtime
        self.runs = runs
        self.config_runtime = config_runtime

    def _build_supervisor_llm(self, supervisor: dict[str, Any]) -> NanobotSupervisorLLM:
        """Build a NanobotSupervisorLLM from the supervisor agent's model config."""
        config = self.agent_runtime._build_agent_config(supervisor)
        provider = self.config_runtime.make_provider(config)
        model_name = config.agents.defaults.model
        return NanobotSupervisorLLM(provider=provider, model_name=model_name)

    def _prepare_supervisor_prompt_context(
        self,
        supervisor: dict[str, Any],
        task: str,
        team_memory_sections: list[tuple[str, str]],
    ) -> Any:
        return self.agent_runtime.prepare_agent_execution(
            supervisor,
            task=task,
            memory_sections=team_memory_sections,
        )

    def _get_agent_definition(self, agent_id: str, *, tenant_id: str) -> dict[str, Any]:
        getter = self.agent_runtime.state.app_agents.get_agent
        try:
            return getter(agent_id, tenant_id=tenant_id)
        except TypeError:
            return getter(agent_id)

    def _prepare_supervisor_execution(
        self,
        team: dict[str, Any],
        task: str,
        root_run_id: str,
        thread_id: str,
        *,
        supervisor_config: SupervisorConfig,
        team_thread_context_block: str | None = None,
        shared_knowledge_block: str | None = None,
        team_memory_sections: list[tuple[str, str]],
        member_access_policy: dict[str, Any],
        propose_memory_candidate: Any,
    ) -> PreparedSupervisorExecution:
        tenant_id = str(team.get("tenantId") or "default").strip() or "default"
        supervisor = self._get_agent_definition(team["supervisorAgentId"], tenant_id=tenant_id)
        member_defs = [
            self._get_agent_definition(mid, tenant_id=tenant_id)
            for mid in (team.get("memberAgentIds") or [])
        ]

        supervisor_llm = self._build_supervisor_llm(supervisor)
        member_tools, _ = create_member_tools(
            members=member_defs,
            team=team,
            root_run_id=root_run_id,
            thread_id=thread_id,
            agent_runtime=self.agent_runtime,
            runs=self.runs,
            propose_memory_candidate=propose_memory_candidate,
            shared_knowledge_block=shared_knowledge_block,
            team_memory_sections=team_memory_sections,
            member_access_policy=member_access_policy,
            supervisor_config=supervisor_config,
        )
        runtime_prepared = self._prepare_supervisor_prompt_context(
            supervisor,
            task,
            team_memory_sections,
        )
        system_prompt = _build_supervisor_prompt(
            team,
            supervisor,
            member_defs,
            supervisor_config=supervisor_config,
            supervisor_additional_sections=runtime_prepared.runtime_prompt_fragments,
            team_thread_context_block=team_thread_context_block,
            shared_knowledge_block=shared_knowledge_block,
            memory_sections=runtime_prepared.runtime_memory_fragments or None,
        )
        return PreparedSupervisorExecution(
            supervisor=supervisor,
            member_defs=member_defs,
            runtime_prepared=runtime_prepared,
            supervisor_llm=supervisor_llm,
            member_tools=member_tools,
            system_prompt=system_prompt,
            supervisor_additional_sections=list(runtime_prepared.runtime_prompt_fragments),
            supervisor_memory=list(runtime_prepared.runtime_memory_fragments),
            team_thread_context_attached=bool(team_thread_context_block),
            shared_knowledge_attached=bool(shared_knowledge_block),
        )

    def _prepare_team_graph(
        self,
        team: dict[str, Any],
        task: str,
        root_run_id: str,
        thread_id: str,
        *,
        supervisor_config: SupervisorConfig,
        team_thread_context_block: str | None = None,
        shared_knowledge_block: str | None = None,
        team_memory_sections: list[tuple[str, str]],
        member_access_policy: dict[str, Any],
        propose_memory_candidate: Any,
    ) -> PreparedTeamGraph:
        supervisor_execution = self._prepare_supervisor_execution(
            team,
            task,
            root_run_id,
            thread_id,
            supervisor_config=supervisor_config,
            team_thread_context_block=team_thread_context_block,
            shared_knowledge_block=shared_knowledge_block,
            team_memory_sections=team_memory_sections,
            member_access_policy=member_access_policy,
            propose_memory_candidate=propose_memory_candidate,
        )
        graph = create_react_agent(
            model=supervisor_execution.supervisor_llm,
            tools=supervisor_execution.member_tools,
            prompt=supervisor_execution.system_prompt,
        )
        return PreparedTeamGraph(
            graph=graph,
            supervisor_execution=supervisor_execution,
        )

    @staticmethod
    def _extract_final_content(messages: Sequence[BaseMessage]) -> str:
        for msg in reversed(list(messages)):
            if isinstance(msg, AIMessage) and msg.content and not msg.tool_calls:
                return str(msg.content)
        return ""

    @staticmethod
    def _is_recursion_error(exc: Exception) -> bool:
        exc_name = type(exc).__name__
        text = str(exc)
        return "recursion" in exc_name.lower() or "recursion" in text.lower()

    @staticmethod
    def _build_recursion_limit_result(
        team_name: str,
        recursion_limit: int,
        *,
        streaming: bool = False,
    ) -> TeamRunResult:
        logger.warning(
            "Team '{}' hit recursion limit{}",
            team_name,
            " during streaming" if streaming else "",
        )
        suffix = "." if streaming else ". Please try breaking down the task further or increase the limit."
        return TeamRunResult(
            final_content=(
                f"The team supervisor reached its recursion limit "
                f"({recursion_limit}){suffix}"
            ),
        )

    def _build_team_result(
        self,
        root_run_id: str,
        final_content: str,
        *,
        prepared: PreparedTeamGraph | None = None,
        supervisor_config: SupervisorConfig | None = None,
        team_run_context: dict[str, Any] | None = None,
    ) -> TeamRunResult:
        member_run_ids = collect_child_run_ids(self.runs.get_run(root_run_id).get("events") or [])
        supervisor_snapshot = (
            prepared.supervisor_execution.event_snapshot(supervisor_config)
            if prepared is not None and supervisor_config is not None
            else {}
        )
        return TeamRunResult(
            final_content=final_content,
            member_run_ids=member_run_ids,
            supervisor_snapshot=supervisor_snapshot,
            team_run_snapshot=dict(team_run_context or {}),
        )

    @staticmethod
    async def _emit_supervisor_materialized(
        prepared: PreparedTeamGraph,
        supervisor_config: SupervisorConfig,
        on_event: Any = None,
        *,
        team_run_context: dict[str, Any] | None = None,
    ) -> None:
        if on_event is None:
            return
        payload = prepared.supervisor_execution.event_snapshot(supervisor_config)
        if team_run_context:
            payload["teamRunContext"] = dict(team_run_context)
        await on_event(
            "supervisor_materialized",
            payload,
        )

    async def _execute_prepared_graph(
        self,
        prepared: PreparedTeamGraph,
        *,
        team_name: str,
        task: str,
        root_run_id: str,
        supervisor_config: SupervisorConfig,
        team_run_context: dict[str, Any] | None = None,
        on_event: Any = None,
        stream: bool,
    ) -> TeamRunResult:
        await self._emit_supervisor_materialized(
            prepared,
            supervisor_config,
            on_event,
            team_run_context=team_run_context,
        )

        final_content = ""
        try:
            if stream:
                async for chunk in prepared.graph.astream(
                    {"messages": [HumanMessage(content=task)]},
                    config={"recursion_limit": supervisor_config.recursion_limit},
                ):
                    summary = summarize_langgraph_chunk(chunk)
                    if on_event and summary is not None:
                        await on_event("supervisor_chunk", summary)
                    for _, value in chunk.items():
                        messages = value.get("messages") if isinstance(value, dict) else None
                        if messages:
                            candidate = self._extract_final_content(messages)
                            if candidate:
                                final_content = candidate
            else:
                result = await prepared.graph.ainvoke(
                    {"messages": [HumanMessage(content=task)]},
                    config={"recursion_limit": supervisor_config.recursion_limit},
                )
                final_content = self._extract_final_content(result.get("messages", []))
        except Exception as exc:
            if self._is_recursion_error(exc):
                return self._build_recursion_limit_result(
                    team_name,
                    supervisor_config.recursion_limit,
                    streaming=stream,
                )
            raise

        return self._build_team_result(
            root_run_id,
            final_content,
            prepared=prepared,
            supervisor_config=supervisor_config,
            team_run_context=team_run_context,
        )

    async def run(
        self,
        team: dict[str, Any],
        task: str,
        root_run_id: str,
        thread_id: str,
        *,
        supervisor_config: SupervisorConfig,
        team_thread_context_block: str | None = None,
        shared_knowledge_block: str | None = None,
        team_memory_sections: list[tuple[str, str]],
        member_access_policy: dict[str, Any],
        propose_memory_candidate: Any,
        team_run_context: dict[str, Any] | None = None,
        on_event: Any = None,
    ) -> TeamRunResult:
        """Execute a team run using the LangGraph Supervisor pattern."""
        prepared = self._prepare_team_graph(
            team,
            task,
            root_run_id,
            thread_id,
            supervisor_config=supervisor_config,
            team_thread_context_block=team_thread_context_block,
            shared_knowledge_block=shared_knowledge_block,
            team_memory_sections=team_memory_sections,
            member_access_policy=member_access_policy,
            propose_memory_candidate=propose_memory_candidate,
        )

        logger.info(
            "Starting LangGraph supervisor for team '{}' with {} members (recursion_limit={})",
            team["name"],
            len(prepared.supervisor_execution.member_defs),
            supervisor_config.recursion_limit,
        )
        return await self._execute_prepared_graph(
            prepared,
            team_name=team["name"],
            task=task,
            root_run_id=root_run_id,
            supervisor_config=supervisor_config,
            team_run_context=team_run_context,
            on_event=on_event,
            stream=False,
        )

    async def run_stream(
        self,
        team: dict[str, Any],
        task: str,
        root_run_id: str,
        thread_id: str,
        *,
        supervisor_config: SupervisorConfig,
        team_thread_context_block: str | None = None,
        shared_knowledge_block: str | None = None,
        team_memory_sections: list[tuple[str, str]],
        member_access_policy: dict[str, Any],
        propose_memory_candidate: Any,
        team_run_context: dict[str, Any] | None = None,
        on_event: Any = None,
    ) -> TeamRunResult:
        """Execute a team run with streaming intermediate results.

        Args:
            on_event: Optional async callback ``async def on_event(event_type: str, data: dict)``
                      called for each intermediate event during the run.
        """
        prepared = self._prepare_team_graph(
            team,
            task,
            root_run_id,
            thread_id,
            supervisor_config=supervisor_config,
            team_thread_context_block=team_thread_context_block,
            shared_knowledge_block=shared_knowledge_block,
            team_memory_sections=team_memory_sections,
            member_access_policy=member_access_policy,
            propose_memory_candidate=propose_memory_candidate,
        )

        logger.info(
            "Starting LangGraph supervisor (streaming) for team '{}' with {} members",
            team["name"],
            len(prepared.supervisor_execution.member_defs),
        )
        return await self._execute_prepared_graph(
            prepared,
            team_name=team["name"],
            task=task,
            root_run_id=root_run_id,
            supervisor_config=supervisor_config,
            team_run_context=team_run_context,
            on_event=on_event,
            stream=True,
        )
