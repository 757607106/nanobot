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
from pydantic import Field

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
    _bound_tools: list[dict[str, Any]] | None = None

    class Config:
        arbitrary_types_allowed = True

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
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                result = pool.submit(asyncio.run, self._agenerate(messages, stop, run_manager, **kwargs)).result()
            return result
        return asyncio.run(self._agenerate(messages, stop, run_manager, **kwargs))

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        openai_messages = _langchain_to_openai_messages(messages)

        tools = None
        if self._bound_tools:
            tools = self._bound_tools

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
        bound._bound_tools = [convert_to_openai_tool(t) for t in tools]
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

    knowledge_policy = str(member_access_policy.get("teamSharedKnowledge") or "explicit_only")
    memory_policy = str(member_access_policy.get("teamSharedMemory") or "leader_write_member_read")

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

        member_timeout = int(member.get("maxExecutionTimeoutSeconds") or 300)

        member_additional_sections: list[str] = []
        if knowledge_policy == "members_read" and shared_knowledge_block:
            member_additional_sections.append(shared_knowledge_block)

        member_memory = team_memory_sections if memory_policy == "leader_write_member_read" else []

        # Capture variables in closure
        _member = member
        _agent_id = agent_id
        _agent_name = agent_name
        _additional = member_additional_sections
        _memory = member_memory
        _timeout = member_timeout

        async def _call_member(
            task: str,
            _m=_member,
            _aid=_agent_id,
            _aname=_agent_name,
            _addl=_additional,
            _mem=_memory,
            _tout=_timeout,
        ) -> str:
            if tracker.limit_reached:
                return (
                    f"Error: Maximum member call limit ({tracker.max_total_calls}) reached. "
                    f"Please synthesize the results you have and provide a final answer."
                )

            call_index = tracker.next_call_index(_aid)
            session_suffix = f"member:{_aid}" if call_index == 1 else f"member:{_aid}:{call_index}"
            session_key = f"team-test:{team['teamId']}:{root_run_id}:{session_suffix}"
            session_id = session_key

            runs.append_event(
                root_run_id,
                "member_scheduled",
                {"agentId": _aid, "agentName": _aname, "callIndex": call_index},
            )

            try:
                run_coro = agent_runtime.run_agent_definition(
                    _m,
                    task=task,
                    label=f"{team['name']} · {_aname}",
                    session_key=session_key,
                    session_id=session_id,
                    session_title=f"Team Run · {team['name']} · {_aname}",
                    origin_chat_id=team["teamId"],
                    control_scope=RunControlScope.MEMBER,
                    team_id=team["teamId"],
                    thread_id=thread_id,
                    parent_run_id=root_run_id,
                    root_run_id=root_run_id,
                    spawn_depth=1,
                    additional_prompt_sections=_addl if _addl else None,
                    include_workspace_memory=False,
                    memory_sections=_mem,
                )
                run_result = await asyncio.wait_for(run_coro, timeout=_tout)
            except asyncio.TimeoutError:
                runs.append_event(
                    root_run_id,
                    "member_completed",
                    {"agentId": _aid, "agentName": _aname, "error": f"Timeout after {_tout}s"},
                )
                return f"Error: {_aname} timed out after {_tout} seconds."
            except asyncio.CancelledError:
                runs.append_event(
                    root_run_id,
                    "member_completed",
                    {"agentId": _aid, "agentName": _aname, "error": "Cancelled"},
                )
                return f"Error: {_aname} execution was cancelled."
            except Exception as exc:
                runs.append_event(
                    root_run_id,
                    "member_completed",
                    {"agentId": _aid, "agentName": _aname, "error": str(exc)},
                )
                return f"Error: {_aname} failed to complete the task: {exc}"

            content = (
                (run_result.get("assistantMessage") or {}).get("content")
                or (run_result.get("run", {}).get("resultSummary") or {}).get("content")
                or "(no response)"
            )

            runs.append_event(
                root_run_id,
                "member_completed",
                {"agentId": _aid, "agentName": _aname, "runId": run_result["run"]["runId"]},
            )

            propose_memory_candidate(
                root_run_id=root_run_id,
                team=team,
                agent=_m,
                run_result=run_result,
            )

            return content

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


def _build_supervisor_prompt(
    team: dict[str, Any],
    supervisor: dict[str, Any],
    members: list[dict[str, Any]],
    *,
    supervisor_config: SupervisorConfig,
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
    ) -> TeamRunResult:
        """Execute a team run using the LangGraph Supervisor pattern."""
        supervisor = self.agent_runtime.state.app_agents.get_agent(team["supervisorAgentId"])
        member_defs = [
            self.agent_runtime.state.app_agents.get_agent(mid)
            for mid in (team.get("memberAgentIds") or [])
        ]

        supervisor_llm = self._build_supervisor_llm(supervisor)

        member_tools, tracker = create_member_tools(
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

        # Build memory sections for the supervisor prompt
        supervisor_memory: list[tuple[str, str]] = []
        if str(supervisor.get("memoryScope") or "agent_profile") == "workspace_shared":
            try:
                workspace_path = self.agent_runtime.state.config.workspace_path
                memory_file = workspace_path / "memory" / "MEMORY.md"
                if memory_file.is_file():
                    ws_content = memory_file.read_text(encoding="utf-8").strip()
                    if ws_content:
                        supervisor_memory.append(("Workspace Shared Memory", ws_content))
            except Exception:
                logger.debug("Could not read workspace memory for supervisor")
        supervisor_memory.extend(team_memory_sections)

        system_prompt = _build_supervisor_prompt(
            team,
            supervisor,
            member_defs,
            supervisor_config=supervisor_config,
            team_thread_context_block=team_thread_context_block,
            shared_knowledge_block=shared_knowledge_block,
            memory_sections=supervisor_memory or None,
        )

        graph = create_react_agent(
            model=supervisor_llm,
            tools=member_tools,
            prompt=system_prompt,
        )

        logger.info(
            "Starting LangGraph supervisor for team '{}' with {} members (recursion_limit={})",
            team["name"],
            len(member_defs),
            supervisor_config.recursion_limit,
        )

        try:
            result = await graph.ainvoke(
                {"messages": [HumanMessage(content=task)]},
                config={"recursion_limit": supervisor_config.recursion_limit},
            )
        except Exception as exc:
            exc_name = type(exc).__name__
            if "recursion" in exc_name.lower() or "recursion" in str(exc).lower():
                logger.warning(
                    "Team '{}' hit recursion limit ({}): {}",
                    team["name"],
                    supervisor_config.recursion_limit,
                    exc,
                )
                return TeamRunResult(
                    final_content=(
                        f"The team supervisor reached its recursion limit "
                        f"({supervisor_config.recursion_limit}). "
                        f"Please try breaking down the task further or increase the limit."
                    ),
                )
            raise

        final_content = ""
        for msg in reversed(result.get("messages", [])):
            if isinstance(msg, AIMessage) and msg.content and not msg.tool_calls:
                final_content = str(msg.content)
                break

        member_run_ids: list[str] = []
        for event in self.runs.get_run(root_run_id).get("events") or []:
            if event.get("eventType") == "member_completed":
                run_id = (event.get("payload") or {}).get("runId")
                if run_id:
                    member_run_ids.append(run_id)

        return TeamRunResult(
            final_content=final_content,
            member_run_ids=member_run_ids,
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
        on_event: Any = None,
    ) -> TeamRunResult:
        """Execute a team run with streaming intermediate results.

        Args:
            on_event: Optional async callback ``async def on_event(event_type: str, data: dict)``
                      called for each intermediate event during the run.
        """
        supervisor = self.agent_runtime.state.app_agents.get_agent(team["supervisorAgentId"])
        member_defs = [
            self.agent_runtime.state.app_agents.get_agent(mid)
            for mid in (team.get("memberAgentIds") or [])
        ]

        supervisor_llm = self._build_supervisor_llm(supervisor)

        member_tools, tracker = create_member_tools(
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

        supervisor_memory: list[tuple[str, str]] = []
        if str(supervisor.get("memoryScope") or "agent_profile") == "workspace_shared":
            try:
                workspace_path = self.agent_runtime.state.config.workspace_path
                memory_file = workspace_path / "memory" / "MEMORY.md"
                if memory_file.is_file():
                    ws_content = memory_file.read_text(encoding="utf-8").strip()
                    if ws_content:
                        supervisor_memory.append(("Workspace Shared Memory", ws_content))
            except Exception:
                logger.debug("Could not read workspace memory for supervisor")
        supervisor_memory.extend(team_memory_sections)

        system_prompt = _build_supervisor_prompt(
            team,
            supervisor,
            member_defs,
            supervisor_config=supervisor_config,
            team_thread_context_block=team_thread_context_block,
            shared_knowledge_block=shared_knowledge_block,
            memory_sections=supervisor_memory or None,
        )

        graph = create_react_agent(
            model=supervisor_llm,
            tools=member_tools,
            prompt=system_prompt,
        )

        logger.info(
            "Starting LangGraph supervisor (streaming) for team '{}' with {} members",
            team["name"],
            len(member_defs),
        )

        final_content = ""
        try:
            async for chunk in graph.astream(
                {"messages": [HumanMessage(content=task)]},
                config={"recursion_limit": supervisor_config.recursion_limit},
            ):
                if on_event:
                    await on_event("graph_chunk", chunk)
                # Extract the latest AI message
                for key, value in chunk.items():
                    messages = value.get("messages") if isinstance(value, dict) else None
                    if messages:
                        for msg in messages:
                            if isinstance(msg, AIMessage) and msg.content and not msg.tool_calls:
                                final_content = str(msg.content)
        except Exception as exc:
            exc_name = type(exc).__name__
            if "recursion" in exc_name.lower() or "recursion" in str(exc).lower():
                logger.warning("Team '{}' hit recursion limit during streaming", team["name"])
                return TeamRunResult(
                    final_content=(
                        f"The team supervisor reached its recursion limit "
                        f"({supervisor_config.recursion_limit})."
                    ),
                )
            raise

        member_run_ids: list[str] = []
        for event in self.runs.get_run(root_run_id).get("events") or []:
            if event.get("eventType") == "member_completed":
                run_id = (event.get("payload") or {}).get("runId")
                if run_id:
                    member_run_ids.append(run_id)

        return TeamRunResult(
            final_content=final_content,
            member_run_ids=member_run_ids,
        )
