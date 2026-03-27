"""Tests for the LangGraph supervisor orchestration layer."""

from __future__ import annotations

import json
from typing import Any
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock, call, patch

import pytest

from nanobot.platform.teams.models import SupervisorConfig


# ---------------------------------------------------------------------------
# A. SupervisorConfig model
# ---------------------------------------------------------------------------

class TestSupervisorConfig:
    def test_default_values(self):
        sc = SupervisorConfig()
        assert sc.recursion_limit == 25
        assert sc.max_member_calls_per_run == 20
        assert sc.response_mode == "synthesize"

    def test_from_dict_camel_case(self):
        sc = SupervisorConfig.from_dict({"recursionLimit": 50, "responseMode": "last_member"})
        assert sc.recursion_limit == 50
        assert sc.response_mode == "last_member"

    def test_from_dict_snake_case(self):
        sc = SupervisorConfig.from_dict({"recursion_limit": 10, "max_member_calls_per_run": 5})
        assert sc.recursion_limit == 10
        assert sc.max_member_calls_per_run == 5

    def test_roundtrip(self):
        sc = SupervisorConfig(recursion_limit=30, response_mode="custom")
        d = sc.to_dict()
        sc2 = SupervisorConfig.from_dict(d)
        assert sc2.recursion_limit == 30
        assert sc2.response_mode == "custom"


# ---------------------------------------------------------------------------
# B. Message format conversion
# ---------------------------------------------------------------------------

class TestMessageConversion:
    def test_langchain_to_openai_system_message(self):
        from langchain_core.messages import SystemMessage
        from nanobot.web.runtime_services.langgraph_supervisor import _langchain_to_openai_messages

        result = _langchain_to_openai_messages([SystemMessage(content="You are a helper.")])
        assert result == [{"role": "system", "content": "You are a helper."}]

    def test_langchain_to_openai_human_message(self):
        from langchain_core.messages import HumanMessage
        from nanobot.web.runtime_services.langgraph_supervisor import _langchain_to_openai_messages

        result = _langchain_to_openai_messages([HumanMessage(content="Hello")])
        assert result == [{"role": "user", "content": "Hello"}]

    def test_langchain_to_openai_ai_message_plain(self):
        from langchain_core.messages import AIMessage
        from nanobot.web.runtime_services.langgraph_supervisor import _langchain_to_openai_messages

        result = _langchain_to_openai_messages([AIMessage(content="Answer")])
        assert result == [{"role": "assistant", "content": "Answer"}]

    def test_langchain_to_openai_ai_message_with_tool_calls(self):
        from langchain_core.messages import AIMessage
        from nanobot.web.runtime_services.langgraph_supervisor import _langchain_to_openai_messages

        msg = AIMessage(
            content="",
            tool_calls=[
                {"name": "call_researcher", "args": {"task": "find info"}, "id": "tc-1"},
            ],
        )
        result = _langchain_to_openai_messages([msg])
        assert len(result) == 1
        assert result[0]["role"] == "assistant"
        assert len(result[0]["tool_calls"]) == 1
        tc = result[0]["tool_calls"][0]
        assert tc["id"] == "tc-1"
        assert tc["function"]["name"] == "call_researcher"
        args = json.loads(tc["function"]["arguments"]) if isinstance(tc["function"]["arguments"], str) else tc["function"]["arguments"]
        assert args == {"task": "find info"}

    def test_langchain_to_openai_tool_message(self):
        from langchain_core.messages import ToolMessage
        from nanobot.web.runtime_services.langgraph_supervisor import _langchain_to_openai_messages

        result = _langchain_to_openai_messages([ToolMessage(content="result", tool_call_id="tc-1")])
        assert result == [{"role": "tool", "content": "result", "tool_call_id": "tc-1"}]

    def test_openai_tool_calls_to_langchain(self):
        from nanobot.providers.base import ToolCallRequest
        from nanobot.web.runtime_services.langgraph_supervisor import _openai_tool_calls_to_langchain

        tc = ToolCallRequest(id="tc-1", name="call_reviewer", arguments={"task": "check"})
        result = _openai_tool_calls_to_langchain([tc])
        assert len(result) == 1
        assert result[0] == {
            "name": "call_reviewer",
            "args": {"task": "check"},
            "id": "tc-1",
            "type": "tool_call",
        }


# ---------------------------------------------------------------------------
# C. Helper functions
# ---------------------------------------------------------------------------

class TestSlugifyToolName:
    def test_simple_name(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _slugify_tool_name
        assert _slugify_tool_name("Research Agent") == "research_agent"

    def test_special_characters(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _slugify_tool_name
        assert _slugify_tool_name("my-agent (v2)") == "my_agent_v2"

    def test_empty_name(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _slugify_tool_name
        assert _slugify_tool_name("") == "agent"


class TestBuildSupervisorPrompt:
    def test_includes_supervisor_system_prompt(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _build_supervisor_prompt

        prompt = _build_supervisor_prompt(
            team={"name": "Test Team"},
            supervisor={"systemPrompt": "You lead the team."},
            members=[{"name": "Worker", "agentId": "w1", "description": "Does work"}],
            supervisor_config=SupervisorConfig(),
        )
        assert "You lead the team." in prompt
        assert "Test Team" in prompt
        assert "Worker" in prompt

    def test_includes_knowledge_block(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _build_supervisor_prompt

        prompt = _build_supervisor_prompt(
            team={"name": "T"},
            supervisor={"systemPrompt": ""},
            members=[],
            supervisor_config=SupervisorConfig(),
            shared_knowledge_block="# Knowledge\nSome facts.",
        )
        assert "# Knowledge" in prompt

    def test_includes_thread_context(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _build_supervisor_prompt

        prompt = _build_supervisor_prompt(
            team={"name": "T"},
            supervisor={"systemPrompt": ""},
            members=[],
            supervisor_config=SupervisorConfig(),
            team_thread_context_block="# Previous turns\nUser: hi",
        )
        assert "# Previous turns" in prompt

    def test_includes_supervisor_additional_sections(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _build_supervisor_prompt

        prompt = _build_supervisor_prompt(
            team={"name": "T"},
            supervisor={"systemPrompt": "Lead carefully."},
            members=[],
            supervisor_config=SupervisorConfig(),
            supervisor_additional_sections=[
                "# Knowledge Policy\nUse bound evidence.",
                "# Retrieved Knowledge\nRunbook says restart safely.",
            ],
        )
        assert "Lead carefully." in prompt
        assert "# Knowledge Policy" in prompt
        assert "# Retrieved Knowledge" in prompt


class TestMemberCallTracker:
    def test_increments_per_agent(self):
        from nanobot.web.runtime_services.langgraph_supervisor import MemberCallTracker

        tracker = MemberCallTracker()
        assert tracker.next_call_index("a1") == 1
        assert tracker.next_call_index("a1") == 2
        assert tracker.next_call_index("a2") == 1
        assert tracker.next_call_index("a1") == 3


# ---------------------------------------------------------------------------
# D. Member tool factory
# ---------------------------------------------------------------------------

class TestCreateMemberTools:
    def test_creates_tool_per_member(self):
        from nanobot.web.runtime_services.langgraph_supervisor import create_member_tools

        members = [
            {"agentId": "m1", "name": "Researcher", "description": "Finds things"},
            {"agentId": "m2", "name": "Reviewer", "description": "Reviews things"},
        ]
        tools, tracker = create_member_tools(
            members=members,
            team={"teamId": "t1", "name": "Team"},
            root_run_id="run-1",
            thread_id="thread-1",
            agent_runtime=MagicMock(),
            runs=MagicMock(),
            propose_memory_candidate=MagicMock(),
            shared_knowledge_block=None,
            team_memory_sections=[],
            member_access_policy={},
            supervisor_config=SupervisorConfig(),
        )
        assert len(tools) == 2
        assert tools[0].name == "call_researcher"
        assert tools[1].name == "call_reviewer"

    def test_tool_names_are_slugified(self):
        from nanobot.web.runtime_services.langgraph_supervisor import create_member_tools

        members = [{"agentId": "m1", "name": "My Special Agent!", "description": ""}]
        tools, _ = create_member_tools(
            members=members,
            team={"teamId": "t1", "name": "T"},
            root_run_id="r1",
            thread_id="th1",
            agent_runtime=MagicMock(),
            runs=MagicMock(),
            propose_memory_candidate=MagicMock(),
            shared_knowledge_block=None,
            team_memory_sections=[],
            member_access_policy={},
            supervisor_config=SupervisorConfig(),
        )
        assert tools[0].name == "call_my_special_agent"

    @pytest.mark.asyncio
    async def test_member_runs_inherit_root_run_origin_metadata(self):
        from nanobot.web.runtime_services.langgraph_supervisor import create_member_tools

        run_agent_definition = AsyncMock(
            return_value={
                "run": {"runId": "run-member-1"},
                "assistantMessage": {"content": "Member answer"},
            }
        )
        agent_runtime = SimpleNamespace(run_agent_definition=run_agent_definition)
        runs = SimpleNamespace(
            get_run=lambda run_id: {
                "runId": run_id,
                "originChannel": "telegram",
                "originChatId": "42",
                "events": [],
            },
            append_event=MagicMock(),
        )
        propose_memory_candidate = MagicMock()

        tools, _ = create_member_tools(
            members=[{"agentId": "m1", "name": "Researcher", "description": "Finds things"}],
            team={"teamId": "t1", "name": "Team"},
            root_run_id="run-root-1",
            thread_id="team-thread:t1:telegram:42:topic:99",
            agent_runtime=agent_runtime,
            runs=runs,
            propose_memory_candidate=propose_memory_candidate,
            shared_knowledge_block=None,
            team_memory_sections=[],
            member_access_policy={},
            supervisor_config=SupervisorConfig(),
        )

        result = await tools[0].ainvoke({"task": "Handle the request"})

        assert result == "Member answer"
        run_agent_definition.assert_awaited_once_with(
            {"agentId": "m1", "name": "Researcher", "description": "Finds things"},
            task="Handle the request",
            label="Team · Researcher",
            session_key="team-test:t1:run-root-1:member:m1",
            session_id="team-test:t1:run-root-1:member:m1",
            session_title="Team Run · Team · Researcher",
            origin_channel="telegram",
            origin_chat_id="42",
            control_scope=ANY,
            team_id="t1",
            thread_id="team-thread:t1:telegram:42:topic:99",
            parent_run_id="run-root-1",
            root_run_id="run-root-1",
            spawn_depth=1,
            additional_prompt_sections=None,
            include_workspace_memory=False,
            memory_sections=[],
            on_progress=ANY,
            on_run_event=ANY,
        )
        propose_memory_candidate.assert_called_once()

    @pytest.mark.asyncio
    async def test_member_tools_prefer_structured_child_task_runtime(self):
        from nanobot.harness import ChildTaskRequest, ChildTaskResult
        from nanobot.web.runtime_services.langgraph_supervisor import create_member_tools

        async def _execute_child_agent_task(request, *, on_progress, on_run_event):
            await on_progress("Inspecting evidence")
            await on_run_event("model_called", {"iteration": 1, "model": "ops-model", "messageCount": 1})
            await on_run_event(
                "tool_called",
                {"iteration": 1, "toolName": "list_dir", "arguments": {}},
            )
            await on_run_event(
                "tool_result",
                {"iteration": 1, "toolName": "list_dir", "resultPreview": "ok"},
            )
            return ChildTaskResult(
                status="ok",
                content="Structured member answer",
                task="Investigate the thread",
                label="Team · Researcher",
                principal_kind="team_member",
                principal_id="m1",
                agent_id="m1",
                team_id="t1",
                thread_id="team-thread:t1:web:42",
                run_id="run-member-2",
                session_key="team-test:t1:run-root-1:member:m1",
                session_id="team-test:t1:run-root-1:member:m1",
                origin_channel="web",
                origin_chat_id="42",
                metadata={"runStatus": "succeeded"},
                raw_result={
                    "run": {"runId": "run-member-2", "status": "succeeded"},
                    "assistantMessage": {"content": "Structured member answer"},
                },
            )
        execute_child_agent_task = AsyncMock(side_effect=_execute_child_agent_task)
        agent_runtime = SimpleNamespace(execute_child_agent_task=execute_child_agent_task)
        runs = SimpleNamespace(
            get_run=lambda run_id: {
                "runId": run_id,
                "originChannel": "web",
                "originChatId": "42",
                "events": [],
            },
            append_event=MagicMock(),
        )
        propose_memory_candidate = MagicMock()

        tools, _ = create_member_tools(
            members=[{"agentId": "m1", "name": "Researcher", "description": "Finds things"}],
            team={"teamId": "t1", "name": "Team"},
            root_run_id="run-root-1",
            thread_id="team-thread:t1:web:42",
            agent_runtime=agent_runtime,
            runs=runs,
            propose_memory_candidate=propose_memory_candidate,
            shared_knowledge_block=None,
            team_memory_sections=[],
            member_access_policy={},
            supervisor_config=SupervisorConfig(),
        )

        result = await tools[0].ainvoke({"task": "Investigate the thread"})

        assert result == "Structured member answer"
        execute_child_agent_task.assert_awaited_once()
        request = execute_child_agent_task.await_args.args[0]
        on_progress = execute_child_agent_task.await_args.kwargs["on_progress"]
        on_run_event = execute_child_agent_task.await_args.kwargs["on_run_event"]
        assert isinstance(request, ChildTaskRequest)
        assert callable(on_progress)
        assert callable(on_run_event)
        assert request.task == "Investigate the thread"
        assert request.label == "Team · Researcher"
        assert request.agent_id == "m1"
        assert request.team_id == "t1"
        assert request.thread_id == "team-thread:t1:web:42"
        assert request.origin_channel == "web"
        assert request.origin_chat_id == "42"
        assert request.control_scope.value == "member"
        propose_memory_candidate.assert_called_once()
        assert runs.append_event.call_args_list[0] == call(
            "run-root-1",
            "child_task_scheduled",
            {
                "handleId": ANY,
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "m1",
                "agentId": "m1",
                "teamId": "t1",
                "threadId": "team-thread:t1:web:42",
                "label": "Team · Researcher",
                "task": "Investigate the thread",
                "sessionKey": "team-test:t1:run-root-1:member:m1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "callIndex": 1,
            },
        )
        assert runs.append_event.call_args_list[1] == call(
            "run-root-1",
            "child_task_progress",
            {
                "handleId": ANY,
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "m1",
                "agentId": "m1",
                "teamId": "t1",
                "threadId": "team-thread:t1:web:42",
                "label": "Team · Researcher",
                "task": "Investigate the thread",
                "sessionKey": "team-test:t1:run-root-1:member:m1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "status": "running",
                "stage": "running",
                "message": "Started execution",
            },
        )
        assert runs.append_event.call_args_list[2] == call(
            "run-root-1",
            "child_task_progress",
            {
                "handleId": ANY,
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "m1",
                "agentId": "m1",
                "teamId": "t1",
                "threadId": "team-thread:t1:web:42",
                "label": "Team · Researcher",
                "task": "Investigate the thread",
                "sessionKey": "team-test:t1:run-root-1:member:m1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "status": "running",
                "message": "Inspecting evidence",
                "toolHint": False,
            },
        )
        assert runs.append_event.call_args_list[3] == call(
            "run-root-1",
            "child_task_progress",
            {
                "handleId": ANY,
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "m1",
                "agentId": "m1",
                "teamId": "t1",
                "threadId": "team-thread:t1:web:42",
                "label": "Team · Researcher",
                "task": "Investigate the thread",
                "sessionKey": "team-test:t1:run-root-1:member:m1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "status": "running",
                "stage": "model_called",
                "iteration": 1,
                "model": "ops-model",
                "message": "Calling model ops-model",
            },
        )
        assert runs.append_event.call_args_list[4] == call(
            "run-root-1",
            "child_task_progress",
            {
                "handleId": ANY,
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "m1",
                "agentId": "m1",
                "teamId": "t1",
                "threadId": "team-thread:t1:web:42",
                "label": "Team · Researcher",
                "task": "Investigate the thread",
                "sessionKey": "team-test:t1:run-root-1:member:m1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "status": "running",
                "stage": "tool_called",
                "iteration": 1,
                "toolName": "list_dir",
                "message": "Running tool list_dir",
            },
        )
        assert runs.append_event.call_args_list[5] == call(
            "run-root-1",
            "child_task_progress",
            {
                "handleId": ANY,
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "m1",
                "agentId": "m1",
                "teamId": "t1",
                "threadId": "team-thread:t1:web:42",
                "label": "Team · Researcher",
                "task": "Investigate the thread",
                "sessionKey": "team-test:t1:run-root-1:member:m1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "status": "running",
                "stage": "tool_result",
                "iteration": 1,
                "toolName": "list_dir",
                "message": "Tool list_dir finished",
            },
        )
        assert runs.append_event.call_args_list[-1] == call(
            "run-root-1",
            "child_task_completed",
            {
                "handleId": ANY,
                "childRunId": "run-member-2",
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "m1",
                "agentId": "m1",
                "teamId": "t1",
                "threadId": "team-thread:t1:web:42",
                "label": "Team · Researcher",
                "task": "Investigate the thread",
                "sessionKey": "team-test:t1:run-root-1:member:m1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "status": "ok",
                "content": "Structured member answer",
                "metadata": {"runStatus": "succeeded"},
            },
        )


# ---------------------------------------------------------------------------
# E. NanobotSupervisorLLM adapter
# ---------------------------------------------------------------------------

class TestNanobotSupervisorLLM:
    def test_llm_type(self):
        from nanobot.web.runtime_services.langgraph_supervisor import NanobotSupervisorLLM

        llm = NanobotSupervisorLLM(provider=MagicMock(), model_name="test-model")
        assert llm._llm_type == "nanobot-supervisor"

    def test_bind_tools_returns_copy(self):
        from nanobot.web.runtime_services.langgraph_supervisor import NanobotSupervisorLLM

        llm = NanobotSupervisorLLM(provider=MagicMock(), model_name="test-model")
        assert llm.bound_tools is None

        # Create a mock tool with proper schema
        mock_tool = MagicMock()
        mock_tool.name = "test_tool"
        mock_tool.description = "A test tool"
        mock_tool.args_schema = None

        with patch("langchain_core.utils.function_calling.convert_to_openai_tool") as mock_convert:
            mock_convert.return_value = {"type": "function", "function": {"name": "test_tool"}}
            bound = llm.bind_tools([mock_tool])

        assert bound.bound_tools is not None
        assert len(bound.bound_tools) == 1
        # Original should be unchanged
        assert llm.bound_tools is None

    @pytest.mark.asyncio
    async def test_agenerate_calls_provider(self):
        from langchain_core.messages import HumanMessage
        from nanobot.providers.base import LLMResponse
        from nanobot.web.runtime_services.langgraph_supervisor import NanobotSupervisorLLM

        mock_provider = MagicMock()
        mock_response = LLMResponse(content="Hello back!", tool_calls=[])
        mock_provider.chat_with_retry = AsyncMock(return_value=mock_response)

        llm = NanobotSupervisorLLM(provider=mock_provider, model_name="test-model")
        result = await llm._agenerate([HumanMessage(content="Hello")])

        assert len(result.generations) == 1
        assert result.generations[0].message.content == "Hello back!"
        mock_provider.chat_with_retry.assert_awaited_once()

        call_kwargs = mock_provider.chat_with_retry.call_args
        messages = call_kwargs.kwargs.get("messages") or call_kwargs[1].get("messages")
        if messages is None:
            messages = call_kwargs[0][0] if call_kwargs[0] else None
        assert messages is not None
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "Hello"


@pytest.mark.asyncio
async def test_team_runner_includes_supervisor_agent_profile_memory(monkeypatch) -> None:
    from langchain_core.messages import AIMessage
    from nanobot.config.schema import Config
    from nanobot.web.runtime_services.agents import WebAgentRuntimeService
    from nanobot.web.runtime_services.langgraph_supervisor import LangGraphTeamRunner

    captured: dict[str, Any] = {}

    class _FakeGraph:
        async def ainvoke(self, payload, config):
            _ = payload, config
            return {"messages": [AIMessage(content="Supervisor final answer")]}

    def _fake_create_react_agent(*, model, tools, prompt):
        captured["model"] = model
        captured["tools"] = tools
        captured["prompt"] = prompt
        return _FakeGraph()

    monkeypatch.setattr("nanobot.web.runtime_services.langgraph_supervisor.create_react_agent", _fake_create_react_agent)

    agents = {
        "leader": {
            "agentId": "leader",
            "name": "Lead",
            "systemPrompt": "Lead the team.",
            "memoryScope": "agent_profile",
        },
        "member-1": {
            "agentId": "member-1",
            "name": "Researcher",
            "description": "Find evidence quickly.",
        },
    }
    state = SimpleNamespace(
        config=Config(),
        app_agents=SimpleNamespace(get_agent=lambda agent_id: agents[agent_id]),
        app_memory=SimpleNamespace(
            get_agent_memory=lambda agent_id: {
                "agentId": agent_id,
                "content": "Supervisor memory: always capture incident timeline first."
                if agent_id == "leader"
                else "",
            }
        ),
        app_knowledge=None,
        workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: []),
    )
    runner = LangGraphTeamRunner(
        WebAgentRuntimeService(state),
        SimpleNamespace(
            get_run=lambda run_id: {
                "runId": run_id,
                "originChannel": "web",
                "originChatId": "team-chat",
                "events": [],
            },
            append_event=MagicMock(),
        ),
        SimpleNamespace(make_provider=lambda config: MagicMock()),
    )
    monkeypatch.setattr(runner, "_build_supervisor_llm", lambda supervisor: MagicMock())

    result = await runner.run(
        {"teamId": "ops-team", "name": "Ops Team", "supervisorAgentId": "leader", "memberAgentIds": ["member-1"]},
        "Handle the incident.",
        "run-root-1",
        "team-thread:ops-team",
        supervisor_config=SupervisorConfig(),
        team_memory_sections=[("Team Shared Memory", "Team rule: verify customer impact.")],
        member_access_policy={},
        propose_memory_candidate=MagicMock(),
        team_run_context={
            "teamId": "ops-team",
            "teamName": "Ops Team",
            "rootRunId": "run-root-1",
        },
    )

    assert result.final_content == "Supervisor final answer"
    assert result.team_run_snapshot["teamId"] == "ops-team"
    assert result.supervisor_snapshot["toolAllowlist"] == []
    assert result.supervisor_snapshot["memoryScope"] == "agent_profile"
    assert result.supervisor_snapshot["knowledgeScope"] == "workspace"
    assert result.supervisor_snapshot["runtimeMemoryFragmentCount"] == 2
    assert result.supervisor_snapshot["middlewareTrace"] == [
        "PromptSeedMiddleware",
        "MemoryPolicyMiddleware",
        "KnowledgePolicyMiddleware",
        "ToolPolicyMiddleware",
        "RuntimePromptFragmentsMiddleware",
        "PromptAssemblyMiddleware",
    ]
    assert "Agent Profile Memory" in captured["prompt"]
    assert "always capture incident timeline first" in captured["prompt"]
    assert "Team Shared Memory" in captured["prompt"]


@pytest.mark.asyncio
async def test_team_runner_run_stream_emits_supervisor_chunk_summaries(monkeypatch) -> None:
    from langchain_core.messages import AIMessage, ToolMessage
    from nanobot.config.schema import Config
    from nanobot.web.runtime_services.agents import WebAgentRuntimeService
    from nanobot.web.runtime_services.langgraph_supervisor import LangGraphTeamRunner

    class _FakeGraph:
        async def astream(self, payload, config):
            _ = payload, config
            yield {
                "agent": {
                    "messages": [
                        AIMessage(
                            content="",
                            tool_calls=[
                                {
                                    "name": "call_researcher",
                                    "args": {"task": "Gather facts"},
                                    "id": "tc-1",
                                }
                            ],
                        )
                    ]
                }
            }
            yield {
                "tools": {
                    "messages": [
                        ToolMessage(content="Facts gathered.", tool_call_id="tc-1"),
                    ]
                }
            }
            yield {"agent": {"messages": [AIMessage(content="Supervisor final answer")]}}

    monkeypatch.setattr(
        "nanobot.web.runtime_services.langgraph_supervisor.create_react_agent",
        lambda **kwargs: _FakeGraph(),
    )

    agents = {
        "leader": {
            "agentId": "leader",
            "name": "Lead",
            "systemPrompt": "Lead the team.",
        },
        "member-1": {
            "agentId": "member-1",
            "name": "Researcher",
            "description": "Find evidence quickly.",
        },
    }
    root_run = {
        "runId": "run-root-1",
        "originChannel": "web",
        "originChatId": "team-chat",
        "events": [
            {
                "eventType": "child_task_completed",
                "payload": {
                    "childRunId": "run-member-1",
                    "status": "ok",
                },
            }
        ],
    }
    state = SimpleNamespace(
        config=Config(),
        app_agents=SimpleNamespace(get_agent=lambda agent_id: agents[agent_id]),
        app_memory=None,
        app_knowledge=None,
        workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: []),
    )
    runner = LangGraphTeamRunner(
        WebAgentRuntimeService(state),
        SimpleNamespace(
            get_run=lambda run_id: root_run,
            append_event=MagicMock(),
        ),
        SimpleNamespace(make_provider=lambda config: MagicMock()),
    )
    monkeypatch.setattr(runner, "_build_supervisor_llm", lambda supervisor: MagicMock())

    observed_events: list[tuple[str, dict[str, Any]]] = []

    async def _on_event(event_type: str, payload: dict[str, Any]) -> None:
        observed_events.append((event_type, payload))

    result = await runner.run_stream(
        {"teamId": "ops-team", "name": "Ops Team", "supervisorAgentId": "leader", "memberAgentIds": ["member-1"]},
        "Handle the incident.",
        "run-root-1",
        "team-thread:ops-team",
        supervisor_config=SupervisorConfig(),
        team_memory_sections=[],
        member_access_policy={},
        propose_memory_candidate=MagicMock(),
        team_run_context={
            "teamId": "ops-team",
            "teamName": "Ops Team",
            "rootRunId": "run-root-1",
        },
        on_event=_on_event,
    )

    assert result.final_content == "Supervisor final answer"
    assert result.member_run_ids == ["run-member-1"]
    assert result.supervisor_snapshot["supervisorAgentId"] == "leader"
    assert result.supervisor_snapshot["responseMode"] == "synthesize"
    assert result.supervisor_snapshot["recursionLimit"] == 25
    assert result.team_run_snapshot["teamId"] == "ops-team"
    assert [item[0] for item in observed_events] == [
        "supervisor_materialized",
        "supervisor_chunk",
        "supervisor_chunk",
        "supervisor_chunk",
    ]
    assert observed_events[0][1]["supervisorAgentId"] == "leader"
    assert observed_events[0][1]["memberAgentIds"] == ["member-1"]
    assert observed_events[0][1]["responseMode"] == "synthesize"
    assert observed_events[0][1]["recursionLimit"] == 25
    assert observed_events[0][1]["teamRunContext"]["teamId"] == "ops-team"
    assert observed_events[1][1]["nodes"][0]["lastMessage"]["toolCalls"] == ["call_researcher"]
    assert observed_events[2][1]["nodes"][0]["lastMessage"]["role"] == "tool"
    assert observed_events[-1][1]["lastMessage"]["contentPreview"] == "Supervisor final answer"
