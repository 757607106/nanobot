from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock, call

import pytest

from nanobot.agent.context import ContextBuilder
from nanobot.agent.loop import AgentLoop
from nanobot.agent.tools.filesystem import ReadFileTool
from nanobot.config.schema import Config, MCPServerConfig
from nanobot.harness import (
    AgentWorkspaceProvider,
    ChildTaskProjector,
    ChildTaskRequest,
    ChildTaskResult,
    DockerSandboxProvider,
    ExecutionContext,
    ExecutionEnvironmentBinding,
    InProcessChildTaskRuntime,
    KnowledgePolicy,
    LocalSandboxProvider,
    MemoryPolicy,
    SandboxBinding,
    SharedWorkspaceProvider,
    TenantScopedWorkspaceProvider,
    ThreadWorkspaceProvider,
    ToolPolicy,
    WorkspaceBinding,
    build_sandbox_provider,
    materialize_child_execution_context,
    resolve_execution_environment,
)
from nanobot.platform.runs import RunControlScope
from nanobot.providers.base import LLMResponse, ToolCallRequest
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
    assert prepared.knowledge_policy.scope == "workspace"
    assert prepared.knowledge_policy.binding_ids == ()
    assert prepared.knowledge_policy.names == ()
    assert prepared.knowledge_policy.hits == ()
    assert prepared.knowledge_policy.event_payload == {
        "knowledgeBindingIds": [],
        "knowledgeNames": [],
        "requestedMode": "naive",
        "effectiveMode": "naive",
        "hitCount": 0,
    }
    assert prepared.middleware_stages == [
        "PromptSeedMiddleware",
        "MemoryPolicyMiddleware",
        "KnowledgePolicyMiddleware",
        "ToolPolicyMiddleware",
        "RuntimePromptFragmentsMiddleware",
        "PromptAssemblyMiddleware",
    ]
    assert prepared.effective_tool_allowlist == ["read_file"]
    assert prepared.memory_sections == [("Agent Profile Memory", "Prefer numbered summaries.")]


def test_materialize_execution_context_captures_lineage_and_policies() -> None:
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
        control_scope=RunControlScope.MEMBER,
        team_id="ops-team",
        parent_run_id="run-root-1",
        root_run_id="run-root-1",
        thread_id="team-thread:ops-team:telegram:42",
        spawn_depth=1,
    )

    assert context.tenant_id == "tenant-demo"
    assert context.instance_id == "instance-demo"
    assert context.principal_kind == "team_member"
    assert context.principal_id == "ops-agent"
    assert context.team_id == "ops-team"
    assert context.role == "member"
    assert context.tool_policy.allowlist == ("read_file",)
    assert context.memory_policy.sections == (("Agent Profile Memory", "Prefer numbered summaries."),)
    assert context.knowledge_policy.scope == "team_shared"
    assert context.event_snapshot() == {
        "tenantId": "tenant-demo",
        "instanceId": "instance-demo",
        "principalKind": "team_member",
        "principalId": "ops-agent",
        "label": "Ops Agent",
        "agentId": "ops-agent",
        "teamId": "ops-team",
        "role": "member",
        "rootRunId": "run-root-1",
        "parentRunId": "run-root-1",
        "sessionKey": "agent:ops-agent:telegram:42",
        "sessionId": "agent-session-1",
        "sessionTitle": "Agent Run · Ops Agent",
        "threadId": "team-thread:ops-team:telegram:42",
        "originChannel": "telegram",
        "originChatId": "42",
        "spawnDepth": 1,
        "controlScope": "member",
        "workspacePath": str(runtime.state.config.workspace_path),
        "workspaceScope": "shared",
        "sandboxKind": "local",
        "execWorkingDir": str(runtime.state.config.workspace_path),
        "restrictToWorkspace": False,
        "execTimeoutSeconds": 60,
        "toolAllowlist": ["read_file"],
        "mcpServerIds": [],
        "skillIds": [],
        "memoryScope": "agent_profile",
        "includeWorkspaceMemory": False,
        "memorySectionCount": 1,
        "knowledgeScope": "team_shared",
        "knowledgeBindingIds": [],
        "knowledgeNames": [],
        "knowledgeHitCount": 0,
    }
    assert context.artifact_metadata(kind="agent") == {
        "run_id": "run-root-1",
        "kind": "agent",
        "tenant_id": "tenant-demo",
        "instance_id": "instance-demo",
        "agent_id": "ops-agent",
        "team_id": "ops-team",
        "role": "member",
        "thread_id": "team-thread:ops-team:telegram:42",
        "origin_channel": "telegram",
        "origin_chat_id": "42",
        "principal_kind": "team_member",
        "principal_id": "ops-agent",
        "workspace_path": str(runtime.state.config.workspace_path),
        "workspace_scope": "shared",
        "sandbox_kind": "local",
        "exec_working_dir": str(runtime.state.config.workspace_path),
        "restrict_to_workspace": False,
        "exec_timeout_seconds": 60,
        "memory_scope": "agent_profile",
        "workspace_memory_included": False,
        "memory_section_count": 1,
        "knowledge_scope": "team_shared",
        "knowledge_binding_ids": [],
        "knowledge_names": [],
        "knowledge_hits": 0,
    }
    assert context.to_agent_loop_run_context() == {
        "run_id": "run-root-1",
        "root_run_id": "run-root-1",
        "tenant_id": "tenant-demo",
        "instance_id": "instance-demo",
        "agent_id": "ops-agent",
        "team_id": "ops-team",
        "thread_id": "team-thread:ops-team:telegram:42",
        "spawn_depth": 1,
        "principal_kind": "team_member",
        "principal_id": "ops-agent",
        "role": "member",
        "control_scope": "member",
        "memory_scope": "agent_profile",
        "knowledge_scope": "team_shared",
        "workspace_scope": "shared",
        "sandbox_kind": "local",
        "restrict_to_workspace": False,
    }


def test_materialize_child_execution_context_captures_child_lineage() -> None:
    context = materialize_child_execution_context(
        ChildTaskRequest(
            task="Inspect the repository",
            label="Inspect repo",
            principal_kind="subagent",
            principal_id="ops-agent",
            agent_id="ops-agent",
            team_id="ops-team",
            thread_id="thread-1",
            session_key="web:chat-1",
            session_id="web:chat-1",
            session_title="Inspect repo",
            origin_channel="web",
            origin_chat_id="chat-1",
            control_scope=RunControlScope.CHILD,
            parent_run_id="run-parent-1",
            root_run_id="run-root-1",
            spawn_depth=1,
        ),
        run_id="run-child-1",
        tenant_id="tenant-demo",
        instance_id="instance-demo",
        role="child",
        workspace_path="/tmp/workspace",
        tool_policy=ToolPolicy(allowlist=("list_dir", "exec")),
        memory_policy=MemoryPolicy(scope="agent_session"),
        knowledge_policy=KnowledgePolicy(scope="workspace"),
    )

    assert context.event_snapshot() == {
        "tenantId": "tenant-demo",
        "instanceId": "instance-demo",
        "principalKind": "subagent",
        "principalId": "ops-agent",
        "label": "Inspect repo",
        "agentId": "ops-agent",
        "teamId": "ops-team",
        "role": "child",
        "runId": "run-child-1",
        "rootRunId": "run-root-1",
        "parentRunId": "run-parent-1",
        "sessionKey": "web:chat-1",
        "sessionId": "web:chat-1",
        "sessionTitle": "Inspect repo",
        "threadId": "thread-1",
        "originChannel": "web",
        "originChatId": "chat-1",
        "spawnDepth": 1,
        "controlScope": "child",
        "workspacePath": "/tmp/workspace",
        "workspaceScope": "shared",
        "sandboxKind": "local",
        "restrictToWorkspace": False,
        "toolAllowlist": ["list_dir", "exec"],
        "mcpServerIds": [],
        "skillIds": [],
        "memoryScope": "agent_session",
        "includeWorkspaceMemory": False,
        "memorySectionCount": 0,
        "knowledgeScope": "workspace",
        "knowledgeBindingIds": [],
        "knowledgeNames": [],
        "knowledgeHitCount": 0,
    }


@pytest.mark.asyncio
async def test_in_process_child_task_runtime_projects_shared_lifecycle_events() -> None:
    runs = MagicMock()
    runtime = InProcessChildTaskRuntime(projector=ChildTaskProjector(runs=runs))
    request = ChildTaskRequest(
        task="Review rollout",
        label="Ops Team · Reviewer",
        principal_kind="team_member",
        principal_id="reviewer-1",
        agent_id="reviewer-1",
        team_id="ops-team",
        thread_id="team-thread:ops-team:web:42",
        session_key="team-test:ops-team:run-root-1:member:reviewer-1",
        origin_channel="web",
        origin_chat_id="42",
        parent_run_id="run-root-1",
        root_run_id="run-root-1",
        spawn_depth=1,
        timeout_seconds=300,
    )

    async def _executor(handle):
        return ChildTaskResult(
            status="ok",
            content="Looks good",
            task=handle.request.task,
            label=handle.request.resolved_label(),
            principal_kind=handle.request.principal_kind,
            principal_id=handle.request.principal_id,
            agent_id=handle.request.agent_id,
            team_id=handle.request.team_id,
            thread_id=handle.request.thread_id,
            run_id="run-member-1",
            session_key=handle.request.resolved_session_key(),
            session_id=handle.request.resolved_session_id(),
            origin_channel=handle.request.origin_channel,
            origin_chat_id=handle.request.origin_chat_id,
            metadata={"runStatus": "succeeded"},
        )

    handle = await runtime.start(
        request,
        executor=_executor,
        parent_run_id="run-root-1",
        root_run_id="run-root-1",
        call_index=1,
    )
    result = await runtime.wait(handle)

    assert result.run_id == "run-member-1"
    assert runs.append_event.call_args_list == [
        call(
            "run-root-1",
            "child_task_scheduled",
            {
                "handleId": ANY,
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "reviewer-1",
                "agentId": "reviewer-1",
                "teamId": "ops-team",
                "threadId": "team-thread:ops-team:web:42",
                "label": "Ops Team · Reviewer",
                "task": "Review rollout",
                "sessionKey": "team-test:ops-team:run-root-1:member:reviewer-1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "callIndex": 1,
            },
        ),
        call(
            "run-root-1",
            "child_task_progress",
            {
                "handleId": ANY,
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "reviewer-1",
                "agentId": "reviewer-1",
                "teamId": "ops-team",
                "threadId": "team-thread:ops-team:web:42",
                "label": "Ops Team · Reviewer",
                "task": "Review rollout",
                "sessionKey": "team-test:ops-team:run-root-1:member:reviewer-1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "status": "running",
                "stage": "running",
                "message": "Started execution",
            },
        ),
        call(
            "run-root-1",
            "child_task_completed",
            {
                "handleId": ANY,
                "childRunId": "run-member-1",
                "parentRunId": "run-root-1",
                "rootRunId": "run-root-1",
                "principalKind": "team_member",
                "principalId": "reviewer-1",
                "agentId": "reviewer-1",
                "teamId": "ops-team",
                "threadId": "team-thread:ops-team:web:42",
                "label": "Ops Team · Reviewer",
                "task": "Review rollout",
                "sessionKey": "team-test:ops-team:run-root-1:member:reviewer-1",
                "originChannel": "web",
                "originChatId": "42",
                "spawnDepth": 1,
                "timeoutSeconds": 300,
                "status": "ok",
                "content": "Looks good",
                "metadata": {"runStatus": "succeeded"},
            },
        ),
    ]
    handle_ids = [event.args[2]["handleId"] for event in runs.append_event.call_args_list]
    assert len(set(handle_ids)) == 1


@pytest.mark.asyncio
async def test_in_process_child_task_runtime_cancel_returns_terminal_result() -> None:
    runtime = InProcessChildTaskRuntime()
    started = asyncio.Event()

    request = ChildTaskRequest(
        task="Inspect dependency",
        label="Inspect dependency",
        principal_kind="subagent",
        session_key="web:chat-1",
        origin_channel="web",
        origin_chat_id="chat-1",
    )

    async def _executor(handle):
        try:
            started.set()
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            return ChildTaskResult(
                status="cancelled",
                content="Cancelled",
                task=handle.request.task,
                label=handle.request.resolved_label(),
                principal_kind=handle.request.principal_kind,
                principal_id=handle.request.principal_id,
                agent_id=handle.request.agent_id,
                team_id=handle.request.team_id,
                thread_id=handle.request.thread_id,
                run_id="run-child-1",
                session_key=handle.request.resolved_session_key(),
                session_id=handle.request.resolved_session_id(),
                origin_channel=handle.request.origin_channel,
                origin_chat_id=handle.request.origin_chat_id,
                metadata={"runStatus": "cancelled"},
            )
        raise AssertionError("executor should have been cancelled")

    handle = await runtime.start(request, executor=_executor, run_id="run-child-1")
    await asyncio.wait_for(started.wait(), timeout=1.0)

    assert await runtime.cancel(handle) is True
    result = await runtime.wait(handle)

    assert result.status == "cancelled"
    assert result.run_id == "run-child-1"
    assert runtime.get_running_count() == 0


@pytest.mark.asyncio
async def test_agent_loop_process_direct_uses_execution_context(tmp_path) -> None:
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    loop = AgentLoop(
        bus=MagicMock(),
        provider=provider,
        workspace=tmp_path,
    )

    captured: dict[str, object] = {}

    async def _fake_process_message(msg, session_key=None, on_progress=None, run_context=None):
        del on_progress
        captured["msg"] = msg
        captured["session_key"] = session_key
        captured["run_context"] = run_context
        return SimpleNamespace(content="ok")

    loop._process_message = _fake_process_message  # type: ignore[method-assign]

    context = ExecutionContext(
        tenant_id="tenant-demo",
        instance_id="instance-demo",
        principal_kind="agent",
        principal_id="ops-agent",
        label="Ops Agent",
        agent_id="ops-agent",
        run_id="run-1",
        root_run_id="run-1",
        session_key="agent:ops-agent:telegram:42",
        session_id="agent-session-1",
        session_title="Agent Run · Ops Agent",
        origin_channel="telegram",
        origin_chat_id="42",
        tool_policy=ToolPolicy(allowlist=("read_file",)),
        memory_policy=MemoryPolicy(scope="agent_profile"),
        knowledge_policy=KnowledgePolicy(scope="workspace"),
    )

    result = await loop.process_direct("hello", execution_context=context)

    assert result == "ok"
    assert captured["session_key"] == "agent:ops-agent:telegram:42"
    msg = captured["msg"]
    assert msg.channel == "telegram"
    assert msg.chat_id == "agent-session-1"
    assert captured["run_context"] == {
        "run_id": "run-1",
        "root_run_id": "run-1",
        "tenant_id": "tenant-demo",
        "instance_id": "instance-demo",
        "agent_id": "ops-agent",
        "principal_kind": "agent",
        "principal_id": "ops-agent",
        "control_scope": "top_level",
        "memory_scope": "agent_profile",
        "knowledge_scope": "workspace",
        "spawn_depth": 0,
        "workspace_scope": "shared",
        "sandbox_kind": "local",
        "restrict_to_workspace": False,
    }


def test_shared_workspace_provider_resolves_shared_binding(tmp_path) -> None:
    provider = SharedWorkspaceProvider()

    binding = provider.resolve(
        workspace=tmp_path,
        restrict_to_workspace=True,
        principal_kind="agent",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-1",
        root_run_id="run-root-1",
        session_key="web:chat-1",
    )

    assert binding == WorkspaceBinding(
        path=tmp_path,
        scope="shared",
        restrict_to_workspace=True,
        tenant_id=None,
        instance_id=None,
        principal_kind="agent",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-1",
        root_run_id="run-root-1",
        session_key="web:chat-1",
    )


def test_thread_workspace_provider_resolves_thread_binding(tmp_path) -> None:
    provider = ThreadWorkspaceProvider()

    binding = provider.resolve(
        workspace=tmp_path,
        restrict_to_workspace=False,
        principal_kind="team_member",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )

    assert binding == WorkspaceBinding(
        path=tmp_path / ".nanobot" / "workspaces" / "threads" / "thread-42",
        scope="thread",
        restrict_to_workspace=True,
        tenant_id=None,
        instance_id=None,
        principal_kind="team_member",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )
    assert binding.path.is_dir()


def test_agent_workspace_provider_resolves_agent_binding(tmp_path) -> None:
    provider = AgentWorkspaceProvider()

    binding = provider.resolve(
        workspace=tmp_path,
        restrict_to_workspace=False,
        principal_kind="agent",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )

    assert binding == WorkspaceBinding(
        path=tmp_path / ".nanobot" / "workspaces" / "agents" / "ops-agent",
        scope="agent",
        restrict_to_workspace=True,
        tenant_id=None,
        instance_id=None,
        principal_kind="agent",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )
    assert binding.path.is_dir()


def test_local_sandbox_provider_resolves_local_binding(tmp_path) -> None:
    provider = LocalSandboxProvider()
    binding = provider.resolve(
        workspace_binding=WorkspaceBinding(
            path=tmp_path,
            scope="thread",
            restrict_to_workspace=True,
            principal_kind="agent",
            principal_id="ops-agent",
        ),
        exec_config=SimpleNamespace(timeout=90, path_append="/usr/local/bin"),
        principal_kind="agent",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )

    assert binding == SandboxBinding(
        kind="local",
        working_dir=tmp_path,
        host_workspace_path=tmp_path,
        runtime_workdir=str(tmp_path),
        restrict_to_workspace=True,
        exec_timeout=90,
        path_append="/usr/local/bin",
        tenant_id=None,
        instance_id=None,
        principal_kind="agent",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )


def test_resolve_execution_environment_combines_workspace_and_sandbox(tmp_path) -> None:
    environment = resolve_execution_environment(
        workspace=tmp_path,
        restrict_to_workspace=False,
        exec_config=SimpleNamespace(timeout=45, path_append="/opt/bin"),
        principal_kind="team_member",
        tenant_id="tenant-a",
        instance_id="instance-1",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
        workspace_provider=ThreadWorkspaceProvider(),
        sandbox_provider=LocalSandboxProvider(),
    )

    assert environment == ExecutionEnvironmentBinding(
        workspace=WorkspaceBinding(
            path=tmp_path / ".nanobot" / "workspaces" / "threads" / "thread-42",
            scope="thread",
            restrict_to_workspace=True,
            tenant_id="tenant-a",
            instance_id="instance-1",
            principal_kind="team_member",
            principal_id="ops-agent",
            team_id="ops-team",
            thread_id="thread-42",
            root_run_id="run-root-1",
            session_key="telegram:42",
        ),
        sandbox=SandboxBinding(
            kind="local",
            working_dir=tmp_path / ".nanobot" / "workspaces" / "threads" / "thread-42",
            host_workspace_path=tmp_path / ".nanobot" / "workspaces" / "threads" / "thread-42",
            runtime_workdir=str(tmp_path / ".nanobot" / "workspaces" / "threads" / "thread-42"),
            restrict_to_workspace=True,
            exec_timeout=45,
            path_append="/opt/bin",
            tenant_id="tenant-a",
            instance_id="instance-1",
            principal_kind="team_member",
            principal_id="ops-agent",
            team_id="ops-team",
            thread_id="thread-42",
            root_run_id="run-root-1",
            session_key="telegram:42",
        ),
    )


def test_tenant_scoped_workspace_provider_rebases_under_tenant_instance(tmp_path) -> None:
    provider = TenantScopedWorkspaceProvider(delegate=ThreadWorkspaceProvider())

    binding = provider.resolve(
        workspace=tmp_path,
        restrict_to_workspace=False,
        principal_kind="team_member",
        tenant_id="tenant-a",
        instance_id="instance-1",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )

    assert binding == WorkspaceBinding(
        path=tmp_path / ".nanobot" / "workspaces" / "tenants" / "tenant-a" / "instance-1" / "thread" / "thread-42",
        scope="thread",
        restrict_to_workspace=True,
        tenant_id="tenant-a",
        instance_id="instance-1",
        principal_kind="team_member",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )
    assert binding.path.is_dir()


def test_build_sandbox_provider_selects_declared_backend() -> None:
    assert isinstance(build_sandbox_provider(SimpleNamespace(sandbox_kind="local")), LocalSandboxProvider)
    assert isinstance(build_sandbox_provider(SimpleNamespace(sandbox_kind="docker")), DockerSandboxProvider)
    remote = build_sandbox_provider(SimpleNamespace(sandbox_kind="remote"))
    assert remote.__class__.__name__ == "RemoteSandboxProvider"


def test_docker_sandbox_provider_separates_host_and_runtime_paths(tmp_path) -> None:
    provider = DockerSandboxProvider()
    binding = provider.resolve(
        workspace_binding=WorkspaceBinding(
            path=tmp_path,
            scope="thread",
            restrict_to_workspace=True,
            principal_kind="team_member",
            principal_id="ops-agent",
            tenant_id="tenant-a",
            instance_id="instance-1",
        ),
        exec_config=SimpleNamespace(
            timeout=120,
            path_append="/opt/tools",
            docker_runtime_workdir="/runtime/workspace",
            docker_image="python:3.12-slim",
            docker_network_mode="none",
        ),
        principal_kind="team_member",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )

    assert binding == SandboxBinding(
        kind="docker",
        working_dir=Path("/runtime/workspace"),
        host_workspace_path=tmp_path,
        runtime_workdir="/runtime/workspace",
        restrict_to_workspace=True,
        exec_timeout=120,
        path_append="/opt/tools",
        image="python:3.12-slim",
        network_mode="none",
        mount_policy="workspace_only",
        tenant_id="tenant-a",
        instance_id="instance-1",
        principal_kind="team_member",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )
    assert binding.event_snapshot()["hostWorkspacePath"] == str(tmp_path)
    assert binding.event_snapshot()["runtimeWorkdir"] == "/runtime/workspace"


def test_docker_sandbox_provider_honors_mount_policy_and_env_allowlist(tmp_path) -> None:
    provider = DockerSandboxProvider()
    binding = provider.resolve(
        workspace_binding=WorkspaceBinding(
            path=tmp_path,
            scope="thread",
            restrict_to_workspace=True,
            principal_kind="team_member",
            principal_id="ops-agent",
            tenant_id="tenant-a",
            instance_id="instance-1",
        ),
        exec_config=SimpleNamespace(
            timeout=120,
            path_append="/opt/tools",
            docker_runtime_workdir="/runtime/workspace",
            docker_image="python:3.12-slim",
            docker_network_mode="none",
            docker_mount_policy="workspace_and_mounts",
            docker_mounts=[f"{tmp_path / 'cache'}:/cache:ro"],
            docker_env_allowlist=["APP_ENV", "BOT_MODE"],
        ),
        principal_kind="team_member",
        principal_id="ops-agent",
        team_id="ops-team",
        thread_id="thread-42",
        root_run_id="run-root-1",
        session_key="telegram:42",
    )

    assert binding.mount_policy == "workspace_and_mounts"
    assert binding.mounts == ((str((tmp_path / "cache").resolve()), "/cache", True),)
    assert binding.env_allowlist == ("APP_ENV", "BOT_MODE")


def test_context_builder_prefers_virtual_workspace_path_in_prompt(tmp_path) -> None:
    builder = ContextBuilder(tmp_path, virtual_workspace_path="/runtime/workspace")

    prompt = builder.build_system_prompt(include_workspace_memory=False)

    assert "Your workspace is at: /runtime/workspace" in prompt
    assert str(tmp_path) not in prompt


@pytest.mark.asyncio
async def test_read_file_tool_accepts_virtual_workspace_paths(tmp_path) -> None:
    target = tmp_path / "docs" / "note.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("hello from host\n", encoding="utf-8")

    tool = ReadFileTool(
        workspace=tmp_path,
        virtual_workspace=Path("/runtime/workspace"),
        allowed_dir=tmp_path,
    )

    result = await tool.execute("/runtime/workspace/docs/note.txt")

    assert "1| hello from host" in result


def test_build_isolated_agent_loop_uses_workspace_provider(tmp_path) -> None:
    alt_workspace = tmp_path / "thread-workspace"
    alt_workspace.mkdir()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"

    class _WorkspaceProvider:
        def resolve(self, **kwargs):
            _ = kwargs
            return WorkspaceBinding(
                path=alt_workspace,
                scope="thread",
                restrict_to_workspace=True,
                principal_kind="agent",
                principal_id="ops-agent",
            )

    state = _make_runtime_state()
    state.bus = MagicMock()
    state.sessions = SessionManager(tmp_path / "sessions")
    state.cron = None
    state.workspace_provider = _WorkspaceProvider()
    state.config_runtime = SimpleNamespace(make_provider=lambda config: provider)
    runtime = WebAgentRuntimeService(state)

    loop, prepared = runtime.build_isolated_agent_loop(
        {
            "agentId": "ops-agent",
            "name": "Ops Agent",
            "systemPrompt": "Operate carefully.",
            "toolAllowlist": ["read_file"],
        },
        task="Inspect the deployment logs.",
        bus=state.bus,
    )

    assert loop.workspace == alt_workspace
    assert loop.restrict_to_workspace is True
    assert prepared.tool_policy.allowlist == ("read_file",)


def test_build_isolated_agent_loop_uses_sandbox_provider(tmp_path) -> None:
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    sandbox_dir = tmp_path / "sandbox-workdir"
    sandbox_dir.mkdir()

    class _SandboxProvider:
        def resolve(self, **kwargs):
            _ = kwargs
            return SandboxBinding(
                kind="local",
                working_dir=sandbox_dir,
                restrict_to_workspace=True,
                exec_timeout=123,
                path_append="/opt/tools",
                principal_kind="agent",
                principal_id="ops-agent",
            )

    state = _make_runtime_state()
    state.bus = MagicMock()
    state.sessions = SessionManager(tmp_path / "sessions")
    state.cron = None
    state.sandbox_provider = _SandboxProvider()
    state.config_runtime = SimpleNamespace(make_provider=lambda config: provider)
    runtime = WebAgentRuntimeService(state)

    loop, _ = runtime.build_isolated_agent_loop(
        {
            "agentId": "ops-agent",
            "name": "Ops Agent",
            "systemPrompt": "Operate carefully.",
            "toolAllowlist": ["read_file"],
        },
        task="Inspect the deployment logs.",
        bus=state.bus,
    )

    assert loop.sandbox_binding == SandboxBinding(
        kind="local",
        working_dir=sandbox_dir,
        restrict_to_workspace=True,
        exec_timeout=123,
        path_append="/opt/tools",
        principal_kind="agent",
        principal_id="ops-agent",
    )


@pytest.mark.asyncio
async def test_execute_child_agent_task_returns_structured_result() -> None:
    runtime = WebAgentRuntimeService(_make_runtime_state())
    runtime.run_agent_definition = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "run": {"runId": "run-member-1", "status": "succeeded"},
            "assistantMessage": {"content": "Member answer"},
        }
    )

    request = ChildTaskRequest(
        task="Review the rollout plan",
        label="Ops Team · Reviewer",
        principal_kind="team_member",
        principal_id="reviewer-1",
        agent_definition={"agentId": "reviewer-1", "name": "Reviewer"},
        agent_id="reviewer-1",
        team_id="ops-team",
        thread_id="team-thread:ops-team:web:42",
        session_key="team-test:ops-team:run-root-1:member:reviewer-1",
        session_id="team-test:ops-team:run-root-1:member:reviewer-1",
        session_title="Team Run · Ops Team · Reviewer",
        origin_channel="web",
        origin_chat_id="42",
        control_scope=RunControlScope.MEMBER,
        parent_run_id="run-root-1",
        root_run_id="run-root-1",
        spawn_depth=1,
        additional_prompt_sections=("# Team Knowledge\nUse the team notes.",),
        include_workspace_memory=False,
        memory_sections=(("Team Memory", "Remember the rollback owner."),),
    )

    result = await runtime.execute_child_agent_task(request)

    assert result == ChildTaskResult(
        status="ok",
        content="Member answer",
        task="Review the rollout plan",
        label="Ops Team · Reviewer",
        principal_kind="team_member",
        principal_id="reviewer-1",
        agent_id="reviewer-1",
        team_id="ops-team",
        thread_id="team-thread:ops-team:web:42",
        run_id="run-member-1",
        session_key="team-test:ops-team:run-root-1:member:reviewer-1",
        session_id="team-test:ops-team:run-root-1:member:reviewer-1",
        origin_channel="web",
        origin_chat_id="42",
        metadata={"runStatus": "succeeded"},
        raw_result={
            "run": {"runId": "run-member-1", "status": "succeeded"},
            "assistantMessage": {"content": "Member answer"},
        },
        )
    runtime.run_agent_definition.assert_awaited_once_with(
        {"agentId": "reviewer-1", "name": "Reviewer"},
        task="Review the rollout plan",
        label="Ops Team · Reviewer",
        session_key="team-test:ops-team:run-root-1:member:reviewer-1",
        session_id="team-test:ops-team:run-root-1:member:reviewer-1",
        session_title="Team Run · Ops Team · Reviewer",
        origin_chat_id="42",
        origin_channel="web",
        control_scope=RunControlScope.MEMBER,
        team_id="ops-team",
        parent_run_id="run-root-1",
        root_run_id="run-root-1",
        thread_id="team-thread:ops-team:web:42",
        spawn_depth=1,
        additional_prompt_sections=["# Team Knowledge\nUse the team notes."],
        include_workspace_memory=False,
        memory_sections=[("Team Memory", "Remember the rollback owner.")],
        on_progress=None,
        on_run_event=None,
    )


@pytest.mark.asyncio
async def test_execute_child_agent_task_forwards_progress_callback() -> None:
    runtime = WebAgentRuntimeService(_make_runtime_state())
    progress_events: list[tuple[str, bool]] = []

    async def _fake_run_agent_definition(*args, **kwargs):
        on_progress = kwargs.pop("on_progress")
        await on_progress("Inspecting evidence")
        await on_progress("Running tool call", tool_hint=True)
        return {
            "run": {"runId": "run-member-2", "status": "succeeded"},
            "assistantMessage": {"content": "Member answer"},
        }

    runtime.run_agent_definition = _fake_run_agent_definition  # type: ignore[method-assign]

    request = ChildTaskRequest(
        task="Review the rollout plan",
        label="Ops Team · Reviewer",
        principal_kind="team_member",
        principal_id="reviewer-1",
        agent_definition={"agentId": "reviewer-1", "name": "Reviewer"},
        agent_id="reviewer-1",
    )

    async def _on_progress(message: str, *, tool_hint: bool = False) -> None:
        progress_events.append((message, tool_hint))

    result = await runtime.execute_child_agent_task(request, on_progress=_on_progress)

    assert result.run_id == "run-member-2"
    assert progress_events == [
        ("Inspecting evidence", False),
        ("Running tool call", True),
    ]


@pytest.mark.asyncio
async def test_execute_child_agent_task_forwards_run_event_callback() -> None:
    runtime = WebAgentRuntimeService(_make_runtime_state())
    observed_events: list[tuple[str, dict[str, object]]] = []

    async def _fake_run_agent_definition(*args, **kwargs):
        on_run_event = kwargs.pop("on_run_event")
        await on_run_event("model_called", {"iteration": 1, "model": "test-model", "messageCount": 1})
        await on_run_event(
            "tool_called",
            {"iteration": 1, "toolName": "list_dir", "arguments": {}},
        )
        return {
            "run": {"runId": "run-member-3", "status": "succeeded"},
            "assistantMessage": {"content": "Member answer"},
        }

    runtime.run_agent_definition = _fake_run_agent_definition  # type: ignore[method-assign]

    request = ChildTaskRequest(
        task="Review the rollout plan",
        label="Ops Team · Reviewer",
        principal_kind="team_member",
        principal_id="reviewer-1",
        agent_definition={"agentId": "reviewer-1", "name": "Reviewer"},
        agent_id="reviewer-1",
    )

    async def _on_run_event(event_type: str, payload: dict[str, object]) -> None:
        observed_events.append((event_type, payload))

    result = await runtime.execute_child_agent_task(request, on_run_event=_on_run_event)

    assert result.run_id == "run-member-3"
    assert observed_events == [
        ("model_called", {"iteration": 1, "model": "test-model", "messageCount": 1}),
        ("tool_called", {"iteration": 1, "toolName": "list_dir", "arguments": {}}),
    ]


@pytest.mark.asyncio
async def test_execute_child_agent_task_honors_timeout() -> None:
    runtime = WebAgentRuntimeService(_make_runtime_state())

    async def _slow_run_agent_definition(*args, **kwargs):
        _ = args, kwargs
        await asyncio.sleep(1.1)
        return {
            "run": {"runId": "run-member-slow", "status": "succeeded"},
            "assistantMessage": {"content": "Too late"},
        }

    runtime.run_agent_definition = _slow_run_agent_definition  # type: ignore[method-assign]

    request = ChildTaskRequest(
        task="Review the rollout plan",
        label="Ops Team · Reviewer",
        principal_kind="team_member",
        principal_id="reviewer-1",
        agent_definition={"agentId": "reviewer-1", "name": "Reviewer"},
        agent_id="reviewer-1",
        timeout_seconds=1,
    )

    with pytest.raises(asyncio.TimeoutError):
        await runtime.execute_child_agent_task(request)


@pytest.mark.asyncio
async def test_execute_child_agent_task_checks_limits_for_delegated_runs() -> None:
    runtime_state = _make_runtime_state()
    runtime_state.runs = MagicMock()
    runtime = WebAgentRuntimeService(runtime_state)
    runtime.run_agent_definition = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "run": {"runId": "run-member-1", "status": "succeeded"},
            "assistantMessage": {"content": "Member answer"},
        }
    )

    request = ChildTaskRequest(
        task="Review the rollout plan",
        label="Ops Team · Reviewer",
        principal_kind="team_member",
        principal_id="reviewer-1",
        agent_definition={"agentId": "reviewer-1", "name": "Reviewer"},
        agent_id="reviewer-1",
        session_key="team-test:ops-team:run-root-1:member:reviewer-1",
        control_scope=RunControlScope.MEMBER,
        parent_run_id="run-root-1",
        root_run_id="run-root-1",
        spawn_depth=1,
    )

    await runtime.execute_child_agent_task(request)

    runtime_state.runs.check_limits.assert_called_once_with(
        session_key="team-test:ops-team:run-root-1:member:reviewer-1",
        parent_run_id="run-root-1",
        spawn_depth=1,
        tenant_id=None,
        instance_id=None,
    )


@pytest.mark.asyncio
async def test_agent_loop_tool_hooks_project_run_events(tmp_path, monkeypatch) -> None:
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    run_registry = MagicMock()
    loop = AgentLoop(
        bus=MagicMock(),
        provider=provider,
        workspace=tmp_path,
        run_registry=run_registry,
    )

    async def fake_execute(self, name, arguments):
        assert name == "list_dir"
        assert arguments == {}
        return "tool result"

    monkeypatch.setattr("nanobot.agent.tools.registry.ToolRegistry.execute", fake_execute)

    responses = [
        LLMResponse(
            content="thinking",
            tool_calls=[ToolCallRequest(id="call_1", name="list_dir", arguments={})],
            finish_reason="tool_calls",
        ),
        LLMResponse(
            content="Done",
            tool_calls=[],
            finish_reason="stop",
        ),
    ]

    async def scripted_chat_with_retry(*, messages, tools, model):
        _ = messages, tools, model
        return responses.pop(0)

    provider.chat_with_retry = scripted_chat_with_retry

    final_content, tools_used, _ = await loop._run_agent_loop(
        [{"role": "user", "content": "List the workspace"}],
        run_context={"run_id": "run-1"},
    )

    assert final_content == "Done"
    assert tools_used == ["list_dir"]
    assert run_registry.append_event.call_args_list == [
        call(
            "run-1",
            "model_called",
            {"iteration": 1, "model": "test-model", "messageCount": 1},
        ),
        call(
            "run-1",
            "model_result",
            {
                "iteration": 1,
                "model": "test-model",
                "finishReason": "tool_calls",
                "toolCallCount": 1,
                "hasVisibleContent": True,
            },
        ),
        call(
            "run-1",
            "tool_called",
            {"iteration": 1, "toolName": "list_dir", "arguments": {}},
        ),
        call(
            "run-1",
            "tool_result",
            {
                "iteration": 1,
                "toolName": "list_dir",
                "contentPreview": "tool result",
                "isError": False,
            },
        ),
        call(
            "run-1",
            "model_called",
            {"iteration": 2, "model": "test-model", "messageCount": 3},
        ),
        call(
            "run-1",
            "model_result",
            {
                "iteration": 2,
                "model": "test-model",
                "finishReason": "stop",
                "toolCallCount": 0,
                "hasVisibleContent": True,
            },
        ),
    ]
