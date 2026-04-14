"""Shared platform runtime helpers for CLI gateway channel routing."""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Callable

from loguru import logger

from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import extract_outbound_content
from nanobot.bus.queue import MessageBus
from nanobot.config.schema import Config
from nanobot.cron.service import CronService
from nanobot.platform.agents import AgentDefinitionService, AgentDefinitionStore
from nanobot.platform.channel_bindings import ChannelBindingService, ChannelBindingStore
from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import KnowledgeBaseService
from nanobot.platform.knowledge.store import create_knowledge_store
from nanobot.platform.knowledge.rag_engine import create_rag_engine_from_config
from nanobot.platform.memory import MemoryService, MemoryStore
from nanobot.platform.runs import RunService, RunStore
from nanobot.session.manager import SessionManager
from nanobot.web.runtime_services.agents import WebAgentRuntimeService
from nanobot.web.runtime_services.channel_routing import ChannelRoutingService
from nanobot.web.runtime_services.chat import WebChatRuntimeService


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


@dataclass(slots=True)
class CLIGatewayRoutingRuntime:
    """CLI-side adapter that reuses the shared agent runtime services."""

    state: Any
    agents_service: AgentDefinitionService
    channel_bindings: ChannelBindingService
    routing_service: ChannelRoutingService
    runs: RunService
    knowledge_service: KnowledgeBaseService
    memory_service: MemoryService
    agent_runtime: WebAgentRuntimeService

    def bind_main_agent(self, agent: AgentLoop) -> None:
        self.state.agent = agent

    async def handle_agent_message(self, agent_id: str, msg: Any) -> str | None:
        try:
            agent_def = self.agents_service.get_agent(agent_id)
        except Exception:
            logger.warning("Agent definition '{}' not found for channel routing", agent_id)
            return f"Agent '{agent_id}' not found."

        session_key = f"agent:{agent_id}:{msg.session_key}"
        environment = self.agent_runtime.resolve_isolated_agent_environment(
            agent_def,
            thread_id=session_key,
            session_key=session_key,
        )
        isolated, _ = self.agent_runtime.build_isolated_agent_loop(
            agent_def,
            task=msg.content,
            bus=self.state.bus,
            workspace_binding=environment.workspace,
            sandbox_binding=environment.sandbox,
        )
        try:
            response = await isolated.process_direct(
                msg.content,
                session_key=session_key,
                channel=msg.channel,
                chat_id=msg.chat_id,
            )
            return extract_outbound_content(response)
        finally:
            await isolated.close_mcp()

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
    state = SimpleNamespace()
    state.config = config
    state.bus = bus
    state.agent = None
    state.sessions = session_manager
    state.cron = cron

    agents_service = AgentDefinitionService(
        AgentDefinitionStore(instance.agent_definitions_db_path()),
        instance_id=instance.id,
        config_loader=lambda: state.config,
    )
    channel_bindings = ChannelBindingService(
        ChannelBindingStore(instance.channel_bindings_db_path()),
        instance_id=instance.id,
        agent_lookup=agents_service.require_agent,
    )
    routing_service = ChannelRoutingService(channel_bindings)
    knowledge_service = KnowledgeBaseService(
        create_knowledge_store(config, instance),
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
    memory_service = MemoryService(
        MemoryStore(instance.memory_db_path()),
        instance=instance,
        instance_id=instance.id,
        agent_lookup=agents_service.require_agent,
    )

    state.runs = runs
    state.app_agents = agents_service
    state.app_knowledge = knowledge_service
    state.app_memory = memory_service
    state.chat_runtime = WebChatRuntimeService(state)
    state.config_runtime = SimpleNamespace(make_provider=provider_factory)
    state.workspace_runtime = SimpleNamespace(
        get_valid_template_tools=lambda: _list_registered_tools(state.agent)
    )

    agent_runtime = WebAgentRuntimeService(state)
    state.agent_runtime = agent_runtime

    return CLIGatewayRoutingRuntime(
        state=state,
        agents_service=agents_service,
        channel_bindings=channel_bindings,
        routing_service=routing_service,
        runs=runs,
        knowledge_service=knowledge_service,
        memory_service=memory_service,
        agent_runtime=agent_runtime,
    )
