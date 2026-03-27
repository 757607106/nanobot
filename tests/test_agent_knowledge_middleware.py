from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.agent.loop import AgentLoop
from nanobot.agent.middleware import KnowledgeBindingMiddleware
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.knowledge import QueryKnowledgeBaseTool, build_knowledge_binding_context
from nanobot.config.schema import Config, MCPServerConfig, ModelBindingConfig
from nanobot.platform.teams.models import SupervisorConfig
from nanobot.web.runtime_services import channel_runtime as channel_runtime_module
from nanobot.web.runtime_services.agents import WebAgentRuntimeService
from nanobot.web.runtime_services.channel_runtime import WebChannelRuntimeService
from nanobot.web.runtime_services.teams import PreparedTeamRun, WebTeamRuntimeService


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
async def test_channel_runtime_team_handler_delegates_to_shared_team_runtime() -> None:
    team_runtime = SimpleNamespace(
        run_team_sync=AsyncMock(return_value={"finalContent": "Team says hi"})
    )
    state = SimpleNamespace(team_runtime=team_runtime)
    runtime = WebChannelRuntimeService(state)

    result = await runtime._team_handler(
        "ops-team",
        SimpleNamespace(content="Handle this", channel="telegram", chat_id="42", session_key="telegram:42"),
    )

    assert result == {
        "content": "Team says hi",
        "runId": None,
        "artifactPath": None,
        "metadata": {
            "targetType": "team",
            "targetId": "ops-team",
        },
    }
    team_runtime.run_team_sync.assert_awaited_once_with(
        "ops-team",
        "Handle this",
        tenant_id="default",
        origin_channel="telegram",
        origin_chat_id="42",
        session_key="telegram:42",
        route_metadata=None,
    )


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


def test_team_runtime_thread_id_is_conversation_scoped_outside_web_studio() -> None:
    runtime = WebTeamRuntimeService(SimpleNamespace())
    team = {"teamId": "ops-team", "name": "Ops Team"}

    assert runtime._resolve_team_thread_id(team) == "team-thread:ops-team"
    assert runtime._resolve_team_thread_id(
        team,
        origin_channel="telegram",
        origin_chat_id="42",
    ) == "team-thread:ops-team:telegram:42"
    assert runtime._resolve_team_thread_id(
        team,
        origin_channel="telegram",
        origin_chat_id="42",
        session_key="telegram:42:topic:99",
    ) == "team-thread:ops-team:telegram:42:topic:99"


def test_team_runtime_materializes_team_execution_context() -> None:
    config = Config()
    agents = {
        "leader": {
            "agentId": "leader",
            "tenantId": "tenant-demo",
            "instanceId": "instance-demo",
            "name": "Lead",
            "systemPrompt": "Lead the team.",
            "toolAllowlist": ["read_file"],
            "memoryScope": "agent_profile",
        }
    }
    state = SimpleNamespace(
        config=config,
        app_agents=SimpleNamespace(
            instance_id="instance-demo",
            get_agent=lambda agent_id, tenant_id=None: agents[agent_id],
        ),
        app_memory=SimpleNamespace(
            get_agent_memory=lambda agent_id: {
                "agentId": agent_id,
                "content": "Leader memory: capture customer impact first." if agent_id == "leader" else "",
            }
        ),
        app_knowledge=SimpleNamespace(
            resolve_bound_kbs=lambda kb_ids: [SimpleNamespace(kb_id=item, name="Ops KB") for item in kb_ids]
        ),
        workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: [{"name": "read_file"}]),
    )
    state.agent_runtime = WebAgentRuntimeService(state)
    runtime = WebTeamRuntimeService(state)

    context = runtime._materialize_team_execution_context(
        {
            "teamId": "ops-team",
            "name": "Ops Team",
            "supervisorAgentId": "leader",
            "sharedKnowledgeBindingIds": ["kb-ops"],
        },
        "Handle the incident",
        root_run_id="run-team-1",
        thread_id="team-thread:ops-team",
        origin_channel="web",
        origin_chat_id="ops-team",
        team_memory_sections=[("Team Shared Memory", "Team rule: verify customer impact.")],
        shared_knowledge_result={
            "hits": [{"content": "Use the incident runbook."}],
            "requestedMode": "hybrid",
            "effectiveMode": "hybrid",
        },
    )

    assert context.principal_kind == "team_supervisor"
    assert context.principal_id == "leader"
    assert context.agent_id == "leader"
    assert context.team_id == "ops-team"
    assert context.role == "leader"
    assert context.run_id == "run-team-1"
    assert context.memory_policy.scope == "team_thread"
    assert context.memory_policy.sections == (
        ("Agent Profile Memory", "Leader memory: capture customer impact first."),
        ("Team Shared Memory", "Team rule: verify customer impact."),
    )
    assert context.knowledge_policy.scope == "team_bindings"
    assert context.knowledge_policy.binding_ids == ("kb-ops",)
    assert context.knowledge_policy.names == ("Ops KB",)
    assert context.event_snapshot()["knowledgeHitCount"] == 1


@pytest.mark.asyncio
async def test_team_runtime_run_team_sync_returns_final_content() -> None:
    captured: dict[str, object] = {}
    state = SimpleNamespace(
        runs=SimpleNamespace(get_run=lambda run_id: {"runId": run_id, "resultSummary": {"content": "fallback"}})
    )
    runtime = WebTeamRuntimeService(state)

    prepared = PreparedTeamRun(
        team={"teamId": "ops-team", "name": "Ops Team"},
        task="Handle this",
        root_run_id="run-1",
        thread_id="thread-1",
        supervisor_config=SupervisorConfig(),
        origin_channel="telegram",
        origin_chat_id="42",
    )
    runtime._prepare_team_run = (
        lambda team_id, content, *, tenant_id=None, origin_channel="web", origin_chat_id=None, session_key=None, route_metadata=None: prepared
    )

    async def _fake_execute(prepared_run):
        captured["prepared_run"] = prepared_run
        return "final answer"

    runtime._execute_team_run = _fake_execute

    result = await runtime.run_team_sync(
        "ops-team",
        "Handle this",
        origin_channel="telegram",
        origin_chat_id="42",
        session_key="telegram:42",
    )

    assert result["finalContent"] == "final answer"
    assert result["run"]["runId"] == "run-1"
    assert captured["prepared_run"] is prepared
    assert prepared.event_snapshot()["teamId"] == "ops-team"
    assert prepared.event_snapshot()["sessionKey"] == "team-test:ops-team:run-1"


@pytest.mark.asyncio
async def test_team_runtime_projects_supervisor_stream_events(tmp_path, monkeypatch) -> None:
    from nanobot.platform.runs import RunControlScope, RunKind
    from nanobot.platform.runs.service import RunService
    from nanobot.platform.runs.store import RunStore
    from nanobot.web.runtime_services.langgraph_supervisor import TeamRunResult

    runs = RunService(
        RunStore(tmp_path / "team-runtime.db"),
        instance_id="instance-test",
        artifact_dir=tmp_path / "artifacts",
    )
    root_run = runs.create_run(
        kind=RunKind.TEAM,
        label="Ops Team",
        task_preview="Handle the incident",
        team_id="ops-team",
        thread_id="team-thread:ops-team",
        session_key="team-test:ops-team:run-root-1",
        origin_channel="web",
        origin_chat_id="ops-team",
        control_scope=RunControlScope.TOP_LEVEL,
        workspace_path=str(tmp_path),
    )

    class _FakeRunner:
        def __init__(self, agent_runtime, runs, config_runtime):
            _ = agent_runtime, runs, config_runtime

        async def run_stream(self, *args, on_event=None, **kwargs):
            _ = args
            team_run_context = kwargs.get("team_run_context") or {}
            if on_event:
                await on_event(
                    "supervisor_materialized",
                    {
                        "supervisorAgentId": "leader",
                        "memberAgentIds": ["member-1"],
                        "responseMode": "synthesize",
                        "teamRunContext": dict(team_run_context),
                    },
                )
                await on_event(
                    "supervisor_chunk",
                    {
                        "nodes": [
                            {
                                "node": "agent",
                                "messageCount": 1,
                                "lastMessage": {
                                    "role": "assistant",
                                    "contentPreview": "Delegate research",
                                    "toolCalls": ["call_researcher"],
                                },
                            }
                        ],
                        "lastMessage": {
                            "role": "assistant",
                            "contentPreview": "Delegate research",
                            "toolCalls": ["call_researcher"],
                        },
                    },
                )
                await on_event(
                    "supervisor_chunk",
                    {
                        "nodes": [
                            {
                                "node": "agent",
                                "messageCount": 1,
                                "lastMessage": {
                                    "role": "assistant",
                                    "contentPreview": "Final synthesis",
                                },
                            }
                        ],
                        "lastMessage": {
                            "role": "assistant",
                            "contentPreview": "Final synthesis",
                        },
                    },
                )
            return TeamRunResult(
                final_content="Incident resolved.",
                member_run_ids=["run-member-1"],
                supervisor_snapshot={
                    "supervisorAgentId": "leader",
                    "memberAgentIds": ["member-1"],
                    "memberToolNames": ["call_researcher"],
                    "modelName": "test-model",
                    "responseMode": "synthesize",
                    "recursionLimit": 25,
                },
            )

    monkeypatch.setattr(
        "nanobot.web.runtime_services.teams.LangGraphTeamRunner",
        _FakeRunner,
    )

    config = Config()
    config.agents.defaults.workspace = str(tmp_path)
    state = SimpleNamespace(
        runs=runs,
        config_runtime=SimpleNamespace(),
        config=config,
        app_agents=SimpleNamespace(
            instance_id="instance-test",
            get_agent=lambda agent_id: {
                "agentId": "leader",
                "tenantId": "tenant-demo",
                "instanceId": "instance-test",
                "name": "Lead",
                "systemPrompt": "Lead the team.",
                "toolAllowlist": ["read_file"],
                "memoryScope": "agent_profile",
            },
        ),
        app_memory=SimpleNamespace(
            get_team_memory=lambda team_id: {
                "teamId": team_id,
                "content": "",
            },
            get_agent_memory=lambda agent_id: {
                "agentId": agent_id,
                "content": "Leader memory." if agent_id == "leader" else "",
            }
        ),
        app_knowledge=None,
        workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: [{"name": "read_file"}]),
    )
    state.agent_runtime = WebAgentRuntimeService(state)
    runtime = WebTeamRuntimeService(state)
    runtime._append_team_thread_message = MagicMock()

    result = await runtime._execute_team_run(
        PreparedTeamRun(
            team={
                "teamId": "ops-team",
                "name": "Ops Team",
                "supervisorAgentId": "leader",
                "memberAgentIds": ["member-1"],
            },
            task="Handle the incident",
            root_run_id=root_run.run_id,
            thread_id="team-thread:ops-team",
            supervisor_config=SupervisorConfig(),
            origin_channel="web",
            origin_chat_id="ops-team",
        )
    )

    assert result == "Incident resolved."
    run_payload = runs.get_run(root_run.run_id)
    event_types = [item["eventType"] for item in run_payload["events"]]
    assert "execution_context_materialized" in event_types
    assert "supervisor_materialized" in event_types
    assert event_types.count("supervisor_chunk") == 2
    assert "supervisor_started" in event_types
    assert "supervisor_completed" in event_types
    assert "team_completed" in event_types

    supervisor_completed = next(
        item["payload"]
        for item in run_payload["events"]
        if item["eventType"] == "supervisor_completed"
    )
    assert supervisor_completed["streamChunkCount"] == 2
    assert supervisor_completed["memberRunIds"] == ["run-member-1"]
    assert supervisor_completed["responseMode"] == "synthesize"
    assert supervisor_completed["recursionLimit"] == 25
    assert supervisor_completed["memberToolCount"] == 1
    assert supervisor_completed["modelName"] == "test-model"

    chunk_payloads = [
        item["payload"]
        for item in run_payload["events"]
        if item["eventType"] == "supervisor_chunk"
    ]
    context_payload = next(
        item["payload"]
        for item in run_payload["events"]
        if item["eventType"] == "execution_context_materialized"
    )
    supervisor_payload = next(
        item["payload"]
        for item in run_payload["events"]
        if item["eventType"] == "supervisor_materialized"
    )
    assert context_payload["principalKind"] == "team_supervisor"
    assert context_payload["agentId"] == "leader"
    assert context_payload["teamId"] == "ops-team"
    assert context_payload["knowledgeScope"] == "workspace"
    assert context_payload["sandboxKind"] == "local"
    assert context_payload["execWorkingDir"] == str(tmp_path)
    assert context_payload["restrictToWorkspace"] is False
    assert context_payload["execTimeoutSeconds"] == 60
    assert supervisor_payload["supervisorAgentId"] == "leader"
    assert supervisor_payload["memberAgentIds"] == ["member-1"]
    assert supervisor_payload["responseMode"] == "synthesize"
    assert supervisor_payload["teamRunContext"]["teamId"] == "ops-team"
    assert supervisor_payload["teamRunContext"]["rootRunId"] == root_run.run_id
    assert chunk_payloads[0]["chunkIndex"] == 1
    assert chunk_payloads[0]["lastMessage"]["toolCalls"] == ["call_researcher"]
    assert chunk_payloads[1]["chunkIndex"] == 2
    assert run_payload["resultSummary"]["metadata"]["supervisorResponseMode"] == "synthesize"
    assert run_payload["resultSummary"]["metadata"]["supervisorRecursionLimit"] == 25
    assert run_payload["resultSummary"]["metadata"]["memberToolCount"] == 1


@pytest.mark.asyncio
async def test_team_runtime_prepares_single_root_session_object(tmp_path) -> None:
    from nanobot.platform.runs import RunControlScope, RunKind
    from nanobot.platform.runs.service import RunService
    from nanobot.platform.runs.store import RunStore

    class _Session:
        def __init__(self) -> None:
            self.metadata: dict[str, object] = {}
            self.messages: list[dict[str, object]] = []

        def add_message(self, role: str, content: str, *, run_id: str, team_id: str) -> None:
            self.messages.append({
                "role": role,
                "content": content,
                "runId": run_id,
                "teamId": team_id,
            })

    class _Sessions:
        def __init__(self) -> None:
            self._sessions: dict[str, _Session] = {}

        def get_or_create(self, thread_id: str) -> _Session:
            return self._sessions.setdefault(thread_id, _Session())

        def save(self, session: _Session) -> None:
            _ = session

    config = Config()
    config.agents.defaults.workspace = str(tmp_path)
    runs = RunService(
        RunStore(tmp_path / "team-runtime.db"),
        instance_id="instance-test",
        artifact_dir=tmp_path / "artifacts",
    )
    team = {
        "teamId": "ops-team",
        "name": "Ops Team",
        "tenantId": "tenant-demo",
        "instanceId": "instance-test",
        "supervisorAgentId": "leader",
        "memberAgentIds": ["member-1"],
    }
    state = SimpleNamespace(
        agent=object(),
        sessions=_Sessions(),
        runs=runs,
        config=config,
        app_teams=SimpleNamespace(get_team=lambda team_id, tenant_id=None: team),
        app_agents=SimpleNamespace(
            get_agent=lambda agent_id, tenant_id=None: {
                "agentId": "leader",
                "tenantId": "tenant-demo",
                "instanceId": "instance-test",
                "name": "Lead",
                "systemPrompt": "Lead the team.",
                "toolAllowlist": ["read_file"],
                "memoryScope": "agent_profile",
            }
        ),
    )
    runtime = WebTeamRuntimeService(state)

    prepared = runtime._prepare_team_run(
        "ops-team",
        "Handle the incident",
        origin_channel="telegram",
        origin_chat_id="42",
        session_key="telegram:42",
    )

    assert prepared.team_id == "ops-team"
    assert prepared.root_session_key == f"team-test:ops-team:{prepared.root_run_id}"
    assert prepared.event_snapshot()["teamId"] == "ops-team"
    assert prepared.event_snapshot()["sessionKey"] == prepared.root_session_key
    run_payload = runs.get_run(prepared.root_run_id)
    event_types = [item["eventType"] for item in run_payload["events"]]
    assert "team_run_prepared" in event_types
    prepared_payload = next(
        item["payload"]
        for item in run_payload["events"]
        if item["eventType"] == "team_run_prepared"
    )
    assert prepared_payload["teamId"] == "ops-team"
    assert prepared_payload["rootRunId"] == prepared.root_run_id
    assert prepared_payload["sessionKey"] == prepared.root_session_key
