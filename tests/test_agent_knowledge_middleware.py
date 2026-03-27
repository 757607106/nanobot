from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.agent.loop import AgentLoop
from nanobot.agent.middleware import KnowledgeBindingMiddleware
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.knowledge import QueryKnowledgeBaseTool, build_knowledge_binding_context
from nanobot.config.schema import Config, MCPServerConfig, ModelBindingConfig
from nanobot.web.runtime_services import channel_runtime as channel_runtime_module
from nanobot.web.runtime_services.agents import WebAgentRuntimeService
from nanobot.web.runtime_services.channel_runtime import WebChannelRuntimeService


class _FakeKnowledgeService:
    def __init__(self) -> None:
        self.retrieve_calls: list[dict[str, object]] = []

    def resolve_bound_kbs(self, kb_ids: list[str]):
        return [SimpleNamespace(kb_id=item) for item in kb_ids]

    def get_knowledge_base(self, kb_id: str) -> dict[str, object]:
        return {
            "kbId": kb_id,
            "name": "Ops KB" if kb_id == "kb-ops" else kb_id,
            "description": "Runbooks and operating notes",
            "stats": {"fileCount": 2, "indexedCount": 2},
        }

    def retrieve(self, *, kb_ids: list[str], query: str, limit: int, requested_mode: str | None = None) -> dict[str, object]:
        assert kb_ids == ["kb-ops"]
        assert "restart" in query.lower()
        assert limit == 6
        assert requested_mode == "naive"
        self.retrieve_calls.append(
            {
                "kb_ids": kb_ids,
                "query": query,
                "limit": limit,
                "requested_mode": requested_mode,
            }
        )
        return {
            "hits": [
                {
                    "content": "Use supervisorctl restart nanobot after checking service health.",
                    "citation": {
                        "title": "runbook.md",
                        "sourceUri": "kb://runbook.md",
                        "sourceType": "knowledge",
                    },
                }
            ],
            "requestedMode": "naive",
            "effectiveMode": "naive",
        }

    def query_kb_for_agent(
        self,
        kb_id: str,
        query_text: str,
        *,
        file_name: str | None = None,
        limit: int = 6,
    ) -> dict[str, object]:
        del file_name, limit
        return {
            "message": None,
            "metadata": {"mode": "naive"},
            "data": {"chunks": [], "entities": [], "relationships": [], "references": []},
            "query": query_text,
            "kbId": kb_id,
        }


def test_knowledge_binding_middleware_builds_tools_prompt_and_allowlist() -> None:
    knowledge_service = _FakeKnowledgeService()
    middleware = KnowledgeBindingMiddleware(knowledge_service)
    result = middleware.apply(
        {
            "knowledgeBindingIds": ["kb-ops"],
            "toolAllowlist": ["read_file"],
        },
        "How do we restart nanobot?",
        base_tool_allowlist=["read_file"],
    )

    assert [tool.name for tool in result.extra_tools] == ["list_kbs", "get_mindmap", "query_kb"]
    assert result.effective_tool_allowlist == ["read_file", "list_kbs", "get_mindmap", "query_kb"]
    assert result.event_payload["knowledgeNames"] == ["Ops KB"]
    assert result.event_payload["requestedMode"] == "naive"
    assert result.event_payload["hitCount"] == 1
    assert len(result.knowledge_hits) == 1
    assert result.prompt_sections
    assert "# Knowledge Policy" in result.prompt_sections[0]
    assert "# Retrieved Knowledge" in result.prompt_sections[1]
    assert "runbook.md" in result.prompt_sections[1]
    assert knowledge_service.retrieve_calls[0]["requested_mode"] == "naive"


@pytest.mark.asyncio
async def test_query_kb_tool_blocks_general_knowledge_fallback_when_no_evidence() -> None:
    binding_context = build_knowledge_binding_context(_FakeKnowledgeService(), ["kb-ops"])
    assert binding_context is not None
    tool = QueryKnowledgeBaseTool(binding_context)

    result = await tool.execute(kb_name="Ops KB", query_text="How do we clear the cache?")

    assert "No matching evidence was found" in result
    assert "Do not answer from general knowledge." in result
    assert "bound knowledge base did not contain a matching answer" in result


class _EchoTool(Tool):
    @property
    def name(self) -> str:
        return "echo_kb"

    @property
    def description(self) -> str:
        return "Echo tool for registration tests."

    @property
    def parameters(self) -> dict[str, object]:
        return {"type": "object", "properties": {}}

    async def execute(self, **kwargs):  # type: ignore[override]
        return "ok"


def test_agent_loop_registers_extra_tools(tmp_path) -> None:
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"

    loop = AgentLoop(
        bus=MagicMock(),
        provider=provider,
        workspace=tmp_path,
        extra_tools=[_EchoTool()],
        tool_allowlist=["echo_kb"],
    )

    assert "echo_kb" in loop.tools.tool_names


def test_prepare_agent_execution_includes_agent_profile_memory() -> None:
    runtime = WebAgentRuntimeService(
        SimpleNamespace(
            app_memory=SimpleNamespace(
                get_agent_memory=lambda agent_id: {
                    "agentId": agent_id,
                    "content": "Agent memory: prefer bullet summaries.",
                }
            ),
            app_knowledge=None,
            config=Config(),
            workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: [{"name": "read_file"}]),
        )
    )

    prepared = runtime.prepare_agent_execution(
        {
            "agentId": "ops-agent",
            "name": "Ops Agent",
            "systemPrompt": "You are an ops agent.",
            "toolAllowlist": ["read_file"],
            "memoryScope": "agent_profile",
        },
        task="Summarize the incident response posture.",
    )

    assert prepared.include_workspace_memory is False
    assert prepared.memory_sections == [("Agent Profile Memory", "Agent memory: prefer bullet summaries.")]
    assert prepared.runtime_memory_fragments == [("Agent Profile Memory", "Agent memory: prefer bullet summaries.")]


def test_prepare_agent_execution_middleware_chain_preserves_prompt_order() -> None:
    runtime = WebAgentRuntimeService(
        SimpleNamespace(
            app_memory=SimpleNamespace(get_agent_memory=lambda agent_id: {"agentId": agent_id, "content": ""}),
            app_knowledge=_FakeKnowledgeService(),
            config=Config(),
            workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: [{"name": "read_file"}]),
        )
    )

    prepared = runtime.prepare_agent_execution(
        {
            "agentId": "ops-agent",
            "name": "Ops Agent",
            "systemPrompt": "You are an ops agent.",
            "toolAllowlist": ["read_file"],
            "memoryScope": "agent_profile",
            "knowledgeBindingIds": ["kb-ops"],
        },
        task="How do we restart nanobot safely?",
        additional_prompt_sections=["# Team Context\nEscalate carefully."],
    )

    prompt = prepared.system_prompt_override or ""
    assert prompt.index("You are an ops agent.") < prompt.index("# Team Context")
    assert prompt.index("# Team Context") < prompt.index("# Knowledge Policy")
    assert prompt.index("# Knowledge Policy") < prompt.index("# Retrieved Knowledge")
    assert len(prepared.runtime_prompt_fragments) == 2
    assert prepared.runtime_prompt_fragments[0].startswith("# Knowledge Policy")
    assert prepared.runtime_prompt_fragments[1].startswith("# Retrieved Knowledge")


@pytest.mark.asyncio
async def test_channel_runtime_agent_handler_applies_knowledge_binding(monkeypatch, tmp_path) -> None:
    captured: dict[str, object] = {}
    runtime_config_holder: dict[str, object] = {}

    def _make_provider(runtime_config):
        runtime_config_holder["config"] = runtime_config
        return provider

    class CapturingAgentLoop:
        def __init__(self, *args, **kwargs):
            captured.update(kwargs)

        async def process_direct(self, *args, **kwargs):
            return "ok"

        async def close_mcp(self):
            return None

    monkeypatch.setattr("nanobot.web.runtime_services.agents.AgentLoop", CapturingAgentLoop)

    config = Config()
    config.agents.defaults.workspace = str(tmp_path)
    config.model_bindings["ops-binding"] = ModelBindingConfig(provider="openai", model="gpt-4o-mini")
    config.tools.mcp_servers["ops-mcp"] = MCPServerConfig(command="python", args=["-m", "demo"], enabled=True)
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    state = SimpleNamespace(
        app_agents=SimpleNamespace(
            get_agent=lambda agent_id: {
                "agentId": agent_id,
                "name": "Ops Agent",
                "systemPrompt": "You are an ops agent.",
                "binding": "ops-binding",
                "toolAllowlist": ["read_file"],
                "skillIds": [],
                "mcpServerIds": ["ops-mcp"],
                "memoryScope": "workspace_shared",
                "knowledgeBindingIds": ["kb-ops"],
            }
        ),
        app_knowledge=_FakeKnowledgeService(),
        config=config,
        config_runtime=SimpleNamespace(make_provider=_make_provider),
        bus=MagicMock(),
        sessions=SimpleNamespace(),
        workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: [{"name": "read_file"}]),
        cron=None,
    )
    state.agent_runtime = WebAgentRuntimeService(state)
    agent_def = state.app_agents.get_agent("agent-ops")
    state.agent_runtime.build_isolated_agent_loop(
        agent_def,
        task="How do we restart nanobot?",
    )
    state.agent_runtime.run_agent_definition = AsyncMock(return_value={
        "assistantMessage": {"content": "ok"},
        "run": {"runId": "run-1", "artifactPath": None},
    })
    runtime = WebChannelRuntimeService(state)

    result = await runtime._agent_handler(
        "agent-ops",
        SimpleNamespace(content="How do we restart nanobot?", session_key="chat-1", channel="telegram", chat_id="42"),
    )

    assert result == {
        "content": "ok",
        "runId": "run-1",
        "artifactPath": None,
        "metadata": {
            "targetType": "agent",
            "targetId": "agent-ops",
        },
    }
    assert captured["tool_allowlist"] == ["read_file", "list_kbs", "get_mindmap", "query_kb"]
    assert [tool.name for tool in captured["extra_tools"]] == ["list_kbs", "get_mindmap", "query_kb"]
    assert "Retrieved Knowledge" in str(captured["system_prompt_override"])
    assert captured["include_workspace_memory"] is True
    state.agent_runtime.run_agent_definition.assert_awaited_once_with(
        agent_def,
        task="How do we restart nanobot?",
        label="Ops Agent",
        session_key="agent:agent-ops:chat-1",
        session_id="agent:agent-ops:chat-1",
        session_title="Agent Route · Ops Agent",
        origin_channel="telegram",
        origin_chat_id="42",
        route_metadata=None,
    )
    runtime_config = runtime_config_holder["config"]
    assert runtime_config.agents.defaults.binding == "ops-binding"
    assert runtime_config.agents.defaults.model == "gpt-4o-mini"
    assert list(runtime_config.tools.mcp_servers) == ["ops-mcp"]


@pytest.mark.asyncio
async def test_channel_runtime_start_pipeline_logs_bootstrap_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    state = SimpleNamespace(
        config=Config(),
        channel_bindings_service=SimpleNamespace(),
        channel_audit_service=None,
        config_runtime=SimpleNamespace(make_provider=lambda config: object()),
        sessions=SimpleNamespace(),
    )
    runtime = WebChannelRuntimeService(state)
    runtime._stop_pipeline = AsyncMock()

    def _boom(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(channel_runtime_module, "AgentLoop", _boom)
    logger_exception = MagicMock()
    monkeypatch.setattr(channel_runtime_module.logger, "exception", logger_exception)

    await runtime._start_pipeline()

    runtime._stop_pipeline.assert_awaited_once()
    logger_exception.assert_called_once_with("Channel routing pipeline crashed")
