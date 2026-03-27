"""Shared platform runtime helpers for CLI gateway channel routing."""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Callable

from loguru import logger

from nanobot.agent.loop import AgentLoop
from nanobot.bus.queue import MessageBus
from nanobot.config.schema import Config
from nanobot.cron.service import CronService
from nanobot.platform.agents import AgentDefinitionService, AgentDefinitionStore
from nanobot.platform.channel_bindings import ChannelBindingService, ChannelBindingStore
from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import KnowledgeBaseService, KnowledgeBaseStore
from nanobot.platform.knowledge.rag_engine import create_rag_engine_from_config
from nanobot.platform.memory import TeamMemoryService, TeamMemoryStore
from nanobot.platform.runs import RunService, RunStore
from nanobot.platform.teams import TeamDefinitionService, TeamDefinitionStore
from nanobot.session.manager import SessionManager
from nanobot.web.runtime_services.agents import WebAgentRuntimeService
from nanobot.web.runtime_services.channel_routing import ChannelRoutingService
from nanobot.web.runtime_services.chat import WebChatRuntimeService
from nanobot.web.runtime_services.teams import WebTeamRuntimeService


def _list_registered_tools(agent: AgentLoop | None) -> list[dict[str, str]]:
    if agent is None:
        return []
    catalog: list[dict[str, str]] = []
    for name in agent.tools.tool_names:
        tool = agent.tools.get(name)
        if tool is None:
            continue
        catalog.append({"name": name, "description": tool.description})
    return catalog


def _build_team_artifact_sources(runs: RunService, team_id: str) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for run in runs.list_runs(team_id=team_id, limit=50):
        run_id = str(run.get("runId") or "").strip()
        artifact_path = str(run.get("artifactPath") or "").strip()
        if not run_id or not artifact_path:
            continue
        try:
            artifact = runs.get_artifact(run_id)
        except Exception:
            continue
        content = str(artifact.get("content") or "").strip()
        if not content:
            continue
        sources.append(
            {
                "sourceId": run_id,
                "title": f"Run Artifact · {run.get('label') or run_id}",
                "content": content,
                "metadata": {
                    "runId": run_id,
                    "teamId": run.get("teamId"),
                    "agentId": run.get("agentId"),
                    "kind": run.get("kind"),
                    "status": run.get("status"),
                    "threadId": run.get("threadId"),
                    "artifactPath": artifact_path,
                },
            }
        )
    return sources


@dataclass(slots=True)
class CLIGatewayRoutingRuntime:
    """CLI-side adapter that reuses the shared agent/team runtime services."""

    state: Any
    agents_service: AgentDefinitionService
    teams_service: TeamDefinitionService
    channel_bindings: ChannelBindingService
    routing_service: ChannelRoutingService
    runs: RunService
    knowledge_service: KnowledgeBaseService
    memory_service: TeamMemoryService
    agent_runtime: WebAgentRuntimeService
    team_runtime: WebTeamRuntimeService

    def bind_main_agent(self, agent: AgentLoop) -> None:
        self.state.agent = agent

    async def handle_agent_message(self, agent_id: str, msg: Any) -> str | None:
        try:
            agent_def = self.agents_service.get_agent(agent_id)
        except Exception:
            logger.warning("Agent definition '{}' not found for channel routing", agent_id)
            return f"Agent '{agent_id}' not found."

        isolated, _ = self.agent_runtime.build_isolated_agent_loop(
            agent_def,
            task=msg.content,
            bus=self.state.bus,
        )
        try:
            return await isolated.process_direct(
                msg.content,
                session_key=f"agent:{agent_id}:{msg.session_key}",
                channel=msg.channel,
                chat_id=msg.chat_id,
            )
        finally:
            await isolated.close_mcp()

    async def handle_team_message(self, team_id: str, msg: Any) -> str | None:
        try:
            result = await self.team_runtime.run_team_sync(
                team_id,
                msg.content,
                origin_channel=msg.channel,
                origin_chat_id=msg.chat_id,
                session_key=msg.session_key,
            )
        except KeyError:
            logger.warning("Team definition '{}' not found for channel routing", team_id)
            return f"Team '{team_id}' not found."
        except ValueError as exc:
            return str(exc)
        except Exception as exc:
            logger.exception("Team '{}' execution failed", team_id)
            return f"Team execution error: {exc}"
        return str(result.get("finalContent") or "").strip() or "(Team produced no response)"

    def shutdown(self) -> None:
        self.knowledge_service.shutdown()


def build_cli_gateway_routing_runtime(
    *,
    config: Config,
    instance: PlatformInstance,
    bus: MessageBus,
    session_manager: SessionManager,
    cron: CronService,
    provider_factory: Callable[[Config], Any],
) -> CLIGatewayRoutingRuntime:
    """Build the platform services needed for CLI channel routing."""
    agents_service = AgentDefinitionService(
        AgentDefinitionStore(instance.agent_definitions_db_path()),
        instance_id=instance.id,
    )
    teams_service = TeamDefinitionService(
        TeamDefinitionStore(instance.team_definitions_db_path()),
        instance_id=instance.id,
        agent_lookup=agents_service.require_agent,
    )
    channel_bindings = ChannelBindingService(
        ChannelBindingStore(instance.channel_bindings_db_path()),
        instance_id=instance.id,
        agent_lookup=agents_service.require_agent,
        team_lookup=teams_service.require_team,
    )
    routing_service = ChannelRoutingService(channel_bindings)
    knowledge_service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=create_rag_engine_from_config(config, instance.data_dir),
        config=config,
    )
    runs = RunService(
        RunStore(instance.agent_runs_db_path()),
        instance_id=instance.id,
        artifact_dir=instance.agent_artifacts_dir(),
    )
    memory_service = TeamMemoryService(
        TeamMemoryStore(instance.memory_db_path()),
        instance=instance,
        instance_id=instance.id,
        agent_lookup=agents_service.require_agent,
        team_lookup=teams_service.require_team,
    )

    state = SimpleNamespace()
    state.config = config
    state.bus = bus
    state.agent = None
    state.sessions = session_manager
    state.cron = cron
    state.runs = runs
    state.app_agents = agents_service
    state.app_teams = teams_service
    state.app_knowledge = knowledge_service
    state.app_memory = memory_service
    state.chat_runtime = WebChatRuntimeService(state)
    state.config_runtime = SimpleNamespace(make_provider=provider_factory)
    state.workspace_runtime = SimpleNamespace(
        get_valid_template_tools=lambda: _list_registered_tools(state.agent)
    )

    agent_runtime = WebAgentRuntimeService(state)
    team_runtime = WebTeamRuntimeService(state)
    state.agent_runtime = agent_runtime
    state.team_runtime = team_runtime

    memory_service.bind_runtime_sources(
        team_thread_source_loader=team_runtime.get_team_thread_memory_source,
        team_artifact_sources_loader=lambda team_id: _build_team_artifact_sources(runs, team_id),
    )

    return CLIGatewayRoutingRuntime(
        state=state,
        agents_service=agents_service,
        teams_service=teams_service,
        channel_bindings=channel_bindings,
        routing_service=routing_service,
        runs=runs,
        knowledge_service=knowledge_service,
        memory_service=memory_service,
        agent_runtime=agent_runtime,
        team_runtime=team_runtime,
    )
