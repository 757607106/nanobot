from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from nanobot.config.schema import Config, MCPServerConfig
from nanobot.harness import (
    AgentWorkspaceProvider,
    DockerSandboxProvider,
    ExecutionContext,
    KnowledgePolicy,
    LocalSandboxProvider,
    MemoryPolicy,
    SharedWorkspaceProvider,
    TenantScopedWorkspaceProvider,
    ThreadWorkspaceProvider,
    ToolPolicy,
    build_sandbox_provider,
    resolve_execution_environment,
)
from nanobot.platform.runs import RunControlScope, RunService
from nanobot.platform.runs.store import RunStore
from nanobot.session.manager import SessionManager
from nanobot.web.runtime_services.agents import WebAgentRuntimeService


def _make_runtime_state(*, agent_memory: str = "") -> SimpleNamespace:
    config = Config()
    config.tools.mcp_servers["ops-mcp"] = MCPServerConfig(command="python", args=["-m", "demo"], enabled=True)
    return SimpleNamespace(
        app_agents=SimpleNamespace(instance_id="instance-demo"),
        app_memory=SimpleNamespace(
            get_agent_memory=lambda agent_id: {
                "agentId": agent_id,
                "content": agent_memory,
            }
        ),
        app_knowledge=None,
        config=config,
        workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: [{"name": "read_file"}]),
    )


def test_prepare_agent_execution_builds_explicit_policy_objects() -> None:
    runtime = WebAgentRuntimeService(_make_runtime_state(agent_memory="Prefer numbered summaries."))

    prepared = runtime.prepare_agent_execution(
        {
            "agentId": "ops-agent",
            "name": "Ops Agent",
            "systemPrompt": "You are an ops agent.",
            "toolAllowlist": ["read_file"],
            "mcpServerIds": ["ops-mcp"],
            "memoryScope": "agent_profile",
        },
        task="Summarize the remediation plan.",
    )

    assert prepared.tool_policy == ToolPolicy(
        allowlist=("read_file",),
        mcp_server_ids=("ops-mcp",),
        skill_ids=(),
    )
    assert prepared.memory_policy == MemoryPolicy(
        scope="agent_profile",
        include_workspace_memory=False,
        sections=(("Agent Profile Memory", "Prefer numbered summaries."),),
    )
    assert prepared.knowledge_policy == KnowledgePolicy(
        scope="workspace",
        binding_ids=(),
        names=(),
        hits=(),
        event_payload={
            "knowledgeBindingIds": [],
            "knowledgeNames": [],
            "requestedMode": "auto",
            "effectiveMode": "mixed",
            "hitCount": 0,
        },
    )
    assert prepared.middleware_stages == [
        "PromptSeedMiddleware",
        "MemoryPolicyMiddleware",
        "KnowledgePolicyMiddleware",
        "ToolPolicyMiddleware",
        "RuntimePromptFragmentsMiddleware",
        "PromptAssemblyMiddleware",
    ]


def test_materialize_execution_context_omits_removed_depth_fields() -> None:
    runtime = WebAgentRuntimeService(_make_runtime_state(agent_memory="Prefer numbered summaries."))
    agent = {
        "agentId": "ops-agent",
        "tenantId": "tenant-demo",
        "instanceId": "instance-demo",
        "name": "Ops Agent",
        "systemPrompt": "You are an ops agent.",
        "toolAllowlist": ["read_file"],
        "memoryScope": "agent_profile",
    }
    prepared = runtime.prepare_agent_execution(agent, task="Summarize the remediation plan.")

    context = runtime.materialize_execution_context(
        agent,
        prepared,
        label=None,
        session_key="agent:ops-agent:telegram:42",
        session_id="agent-session-1",
        session_title="Agent Run · Ops Agent",
        origin_chat_id="42",
        origin_channel="telegram",
        parent_run_id="run-root-1",
        root_run_id="run-root-1",
        thread_id="thread-1",
        control_scope=RunControlScope.TOP_LEVEL,
    )

    snapshot = context.event_snapshot()
    assert snapshot["tenantId"] == "tenant-demo"
    assert snapshot["instanceId"] == "instance-demo"
    assert snapshot["principalKind"] == "agent"
    assert snapshot["principalId"] == "ops-agent"
    assert snapshot["controlScope"] == "top_level"
    assert snapshot["workspaceScope"] == "shared"
    assert snapshot["sandboxKind"] == "local"
    assert "spawnDepth" not in snapshot

    run_context = context.to_agent_loop_run_context()
    assert run_context == {
        "run_id": "run-root-1",
        "root_run_id": "run-root-1",
        "tenant_id": "tenant-demo",
        "instance_id": "instance-demo",
        "agent_id": "ops-agent",
        "thread_id": "thread-1",
        "principal_kind": "agent",
        "principal_id": "ops-agent",
        "control_scope": "top_level",
        "memory_scope": "agent_profile",
        "knowledge_scope": "workspace",
        "workspace_scope": "shared",
        "sandbox_kind": "local",
        "restrict_to_workspace": False,
    }


def test_execution_context_artifact_metadata_tracks_agent_scope() -> None:
    context = ExecutionContext(
        tenant_id="tenant-demo",
        instance_id="instance-demo",
        principal_kind="agent",
        principal_id="ops-agent",
        label="Ops Agent",
        agent_id="ops-agent",
        run_id="run-1",
        root_run_id="run-1",
        thread_id="thread-1",
        origin_channel="telegram",
        origin_chat_id="42",
        control_scope=RunControlScope.TOP_LEVEL,
        workspace_path="/tmp/workspace",
        workspace_scope="agent",
        sandbox_kind="docker",
        exec_working_dir="/workspace",
        restrict_to_workspace=True,
        exec_timeout_seconds=120,
        memory_policy=MemoryPolicy(scope="workspace_shared", include_workspace_memory=True),
        knowledge_policy=KnowledgePolicy(scope="bindings", binding_ids=("kb-1",), names=("Support KB",)),
    )

    assert context.artifact_metadata(kind="agent") == {
        "run_id": "run-1",
        "kind": "agent",
        "tenant_id": "tenant-demo",
        "instance_id": "instance-demo",
        "agent_id": "ops-agent",
        "thread_id": "thread-1",
        "origin_channel": "telegram",
        "origin_chat_id": "42",
        "principal_kind": "agent",
        "principal_id": "ops-agent",
        "workspace_path": "/tmp/workspace",
        "workspace_scope": "agent",
        "sandbox_kind": "docker",
        "exec_working_dir": "/workspace",
        "restrict_to_workspace": True,
        "exec_timeout_seconds": 120,
        "memory_scope": "workspace_shared",
        "workspace_memory_included": True,
        "memory_section_count": 0,
        "knowledge_scope": "bindings",
        "knowledge_binding_ids": ["kb-1"],
        "knowledge_names": ["Support KB"],
        "knowledge_hits": 0,
    }


def test_workspace_providers_resolve_scoped_paths(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    shared = SharedWorkspaceProvider().resolve(
        workspace=workspace,
        restrict_to_workspace=False,
        principal_kind="agent",
        principal_id="ops-agent",
    )
    thread = ThreadWorkspaceProvider().resolve(
        workspace=workspace,
        restrict_to_workspace=False,
        principal_kind="agent",
        principal_id="ops-agent",
        thread_id="thread-42",
    )
    agent = AgentWorkspaceProvider().resolve(
        workspace=workspace,
        restrict_to_workspace=False,
        principal_kind="agent",
        principal_id="ops-agent",
    )

    assert shared.path == workspace
    assert shared.scope == "shared"
    assert thread.scope == "thread"
    assert thread.path.name == "thread-42"
    assert thread.path.exists()
    assert agent.scope == "agent"
    assert agent.path.name == "ops-agent"
    assert agent.path.exists()


def test_tenant_scoped_workspace_provider_rebases_delegate(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    binding = TenantScopedWorkspaceProvider(delegate=ThreadWorkspaceProvider()).resolve(
        workspace=workspace,
        restrict_to_workspace=False,
        principal_kind="agent",
        tenant_id="tenant-a",
        instance_id="instance-a",
        principal_id="ops-agent",
        thread_id="thread-99",
    )

    assert binding.scope == "thread"
    assert binding.path.parts[-4:] == ("tenant-a", "instance-a", "thread", "thread-99")
    assert binding.path.exists()


def test_resolve_execution_environment_combines_workspace_and_sandbox(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    config = Config()
    config.tools.exec.timeout = 180
    config.tools.exec.sandbox_kind = "docker"
    config.tools.exec.docker_runtime_workdir = "/workspace"

    environment = resolve_execution_environment(
        workspace=workspace,
        restrict_to_workspace=False,
        exec_config=config.tools.exec,
        principal_kind="agent",
        tenant_id="tenant-a",
        instance_id="instance-a",
        principal_id="ops-agent",
        thread_id="thread-1",
        workspace_provider=TenantScopedWorkspaceProvider(delegate=AgentWorkspaceProvider()),
        sandbox_provider=DockerSandboxProvider(),
    )

    assert environment.workspace.scope == "agent"
    assert environment.workspace.path.parts[-4:] == ("tenant-a", "instance-a", "agent", "ops-agent")
    assert environment.sandbox.kind == "docker"
    assert environment.sandbox.host_workspace_path == environment.workspace.path
    assert environment.sandbox.runtime_workdir == "/workspace"
    snapshot = environment.event_snapshot()
    assert snapshot["workspaceScope"] == "agent"
    assert snapshot["sandboxKind"] == "docker"
    assert snapshot["tenantId"] == "tenant-a"


def test_run_agent_definition_uses_isolated_workspace_and_scoped_memory(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    config = Config()
    config.agents.defaults.workspace = str(workspace)
    runs = RunService(RunStore(tmp_path / "runs.db"), instance_id="instance-a")
    sessions = SessionManager(workspace)
    state = SimpleNamespace(
        agent=object(),
        sessions=sessions,
        runs=runs,
        bus=object(),
        config=config,
        config_runtime=SimpleNamespace(make_provider=lambda _cfg: object()),
        chat_runtime=SimpleNamespace(
            format_session_summary_from_session=lambda _session, session_id: {
                "id": session_id,
                "sessionId": session_id,
                "title": "",
                "messageCount": 0,
                "fileCount": 0,
            },
            format_message=lambda sequence, session_id, message: {
                "sequence": sequence,
                "sessionId": session_id,
                **(message or {}),
            },
            default_title=lambda _content=None: "Session",
        ),
        workspace_runtime=SimpleNamespace(get_valid_template_tools=lambda: []),
        app_agents=SimpleNamespace(instance_id="instance-a"),
        app_knowledge=None,
        app_memory=None,
        cron=None,
    )
    runtime = WebAgentRuntimeService(state)
    agent = {
        "agentId": "agent-a",
        "tenantId": "tenant-a",
        "instanceId": "instance-a",
        "name": "Agent A",
        "systemPrompt": "System prompt.",
        "toolAllowlist": [],
        "mcpServerIds": [],
        "memoryScope": "workspace_shared",
    }
    environment = runtime.resolve_isolated_agent_environment(
        agent,
        thread_id="thread-a",
        session_key="agent:agent-a:session:session-a",
    )
    memory_dir = environment.workspace.path / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    (memory_dir / "MEMORY.md").write_text("WORKSPACE SECRET", encoding="utf-8")

    captured: dict[str, Any] = {}

    class StubLoop:
        async def process_direct(self, *args, **kwargs):
            _ = args, kwargs
            return "Stub response"

        async def close_mcp(self) -> None:
            return None

    def fake_build_isolated_agent_loop(self, agent, *, prepared=None, workspace_binding=None, sandbox_binding=None, **kwargs):
        _ = agent, kwargs, sandbox_binding
        captured["workspace_binding"] = workspace_binding
        captured["prepared"] = prepared
        return StubLoop(), prepared

    monkeypatch.setattr(WebAgentRuntimeService, "build_isolated_agent_loop", fake_build_isolated_agent_loop)

    import asyncio

    asyncio.run(
        runtime.run_agent_definition(
            agent,
            task="Hello",
            label="Agent A",
            session_key="agent:agent-a:session:session-a",
            session_id="session-a",
            session_title="Agent Session",
            origin_chat_id="chat-a",
            origin_channel="web",
            thread_id="thread-a",
            workspace_binding=environment.workspace,
            sandbox_binding=environment.sandbox,
        )
    )

    workspace_binding = captured["workspace_binding"]
    prepared = captured["prepared"]
    assert workspace_binding.scope == "agent_thread"
    assert "/agents/agent-a/threads/thread-a" in workspace_binding.path.as_posix()
    assert ("Agent Workspace Memory", "WORKSPACE SECRET") in prepared.runtime_memory_sections

def test_build_sandbox_provider_uses_configured_kind() -> None:
    config = Config()

    config.tools.exec.sandbox_kind = "local"
    assert isinstance(build_sandbox_provider(config.tools.exec), LocalSandboxProvider)

    config.tools.exec.sandbox_kind = "docker"
    assert isinstance(build_sandbox_provider(config.tools.exec), DockerSandboxProvider)
