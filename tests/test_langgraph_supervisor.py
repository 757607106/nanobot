"""Tests for the LangGraph supervisor orchestration layer."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from nanobot.platform.teams.models import _migrate_workflow_mode


# ---------------------------------------------------------------------------
# A. Workflow mode migration
# ---------------------------------------------------------------------------

class TestWorkflowModeMigration:
    def test_legacy_parallel_fanout_maps_to_supervisor(self):
        assert _migrate_workflow_mode("parallel_fanout") == "supervisor"

    def test_legacy_sequential_handoff_maps_to_supervisor(self):
        assert _migrate_workflow_mode("sequential_handoff") == "supervisor"

    def test_legacy_leader_summary_maps_to_supervisor(self):
        assert _migrate_workflow_mode("leader_summary") == "supervisor"

    def test_supervisor_stays_supervisor(self):
        assert _migrate_workflow_mode("supervisor") == "supervisor"

    def test_unknown_mode_passes_through(self):
        assert _migrate_workflow_mode("custom_mode") == "custom_mode"


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
    def test_includes_leader_system_prompt(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _build_supervisor_prompt

        prompt = _build_supervisor_prompt(
            team={"name": "Test Team"},
            leader={"systemPrompt": "You lead the team."},
            members=[{"name": "Worker", "agentId": "w1", "description": "Does work"}],
        )
        assert "You lead the team." in prompt
        assert "Test Team" in prompt
        assert "Worker" in prompt

    def test_includes_knowledge_block(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _build_supervisor_prompt

        prompt = _build_supervisor_prompt(
            team={"name": "T"},
            leader={"systemPrompt": ""},
            members=[],
            shared_knowledge_block="# Knowledge\nSome facts.",
        )
        assert "# Knowledge" in prompt

    def test_includes_thread_context(self):
        from nanobot.web.runtime_services.langgraph_supervisor import _build_supervisor_prompt

        prompt = _build_supervisor_prompt(
            team={"name": "T"},
            leader={"systemPrompt": ""},
            members=[],
            team_thread_context_block="# Previous turns\nUser: hi",
        )
        assert "# Previous turns" in prompt


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
        )
        assert tools[0].name == "call_my_special_agent"


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
        assert llm._bound_tools is None

        # Create a mock tool with proper schema
        mock_tool = MagicMock()
        mock_tool.name = "test_tool"
        mock_tool.description = "A test tool"
        mock_tool.args_schema = None

        with patch("langchain_core.utils.function_calling.convert_to_openai_tool") as mock_convert:
            mock_convert.return_value = {"type": "function", "function": {"name": "test_tool"}}
            bound = llm.bind_tools([mock_tool])

        assert bound._bound_tools is not None
        assert len(bound._bound_tools) == 1
        # Original should be unchanged
        assert llm._bound_tools is None

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
