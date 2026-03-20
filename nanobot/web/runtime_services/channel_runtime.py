"""Channel routing runtime for the nanobot Web UI.

Starts enabled channels (Telegram, QQ, Discord, …) in a dedicated background
thread with its own asyncio event-loop, resolves channel bindings to agent /
team targets, and dispatches inbound messages accordingly.

The pattern mirrors ``WebScheduleRuntimeService`` — a daemon thread that owns
an ``asyncio.new_event_loop()`` so that the long-running ``agent.run()`` and
``ChannelManager.start_all()`` tasks do not block the uvicorn event-loop.
"""

from __future__ import annotations

import asyncio
import threading
from typing import TYPE_CHECKING, Any

from loguru import logger

from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import InboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.dispatch import ChannelMessageDispatcher
from nanobot.channels.manager import ChannelManager
from nanobot.web.runtime_services.channel_routing import ChannelRoutingService

if TYPE_CHECKING:
    from nanobot.web.runtime import WebAppState


class WebChannelRuntimeService:
    """Manages the full channel message-routing pipeline for the Web UI."""

    def __init__(self, state: WebAppState) -> None:
        self.state = state
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._bus: MessageBus | None = None
        self._agent: AgentLoop | None = None
        self._channel_manager: ChannelManager | None = None
        self._running = False

    # ------------------------------------------------------------------
    # Public API (all synchronous — safe to call from any thread)
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Create a background thread + event-loop and start channel routing."""
        if self._running:
            return

        bindings = getattr(self.state, "channel_bindings_service", None)
        if bindings is None:
            logger.warning("Channel bindings service not available; channel routing disabled")
            return

        # Check whether any channel is actually enabled in the config.
        channels_data = self.state.config.channels.model_dump(mode="json", by_alias=True)
        has_enabled = any(
            isinstance(v, dict) and v.get("enabled")
            for v in channels_data.values()
        )
        if not has_enabled:
            logger.info("No channels enabled in config; channel routing not started")
            return

        loop = asyncio.new_event_loop()
        self._loop = loop
        self._ready.clear()

        def runner() -> None:
            asyncio.set_event_loop(loop)
            self._ready.set()
            try:
                loop.run_forever()
            finally:
                pending = [t for t in asyncio.all_tasks(loop) if not t.done()]
                for t in pending:
                    t.cancel()
                if pending:
                    loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                loop.close()

        self._thread = threading.Thread(
            target=runner,
            name="nanobot-web-channels",
            daemon=True,
        )
        self._thread.start()
        if not self._ready.wait(timeout=5):
            logger.error("Failed to start channel runtime thread")
            return

        # Schedule the pipeline on the dedicated loop (fire-and-forget).
        asyncio.run_coroutine_threadsafe(self._start_pipeline(), loop)
        self._running = True
        logger.info("Web channel runtime started")

    def stop(self) -> None:
        """Cancel all tasks, stop the event-loop and join the thread."""
        if not self._running:
            return

        loop = self._loop
        thread = self._thread
        if loop is not None and not loop.is_closed():
            try:
                if loop.is_running():
                    future = asyncio.run_coroutine_threadsafe(self._stop_pipeline(), loop)
                    future.result(timeout=10)
            except Exception:  # noqa: BLE001
                logger.exception("Error stopping channel pipeline")
            try:
                if loop.is_running():
                    loop.call_soon_threadsafe(loop.stop)
            except RuntimeError:
                logger.debug("Channel runtime loop closed before stop completed")

        if thread is not None and thread.is_alive():
            thread.join(timeout=5)

        self._loop = None
        self._thread = None
        self._running = False
        logger.info("Web channel runtime stopped")

    def restart(self) -> None:
        """Stop then start — called after a config change."""
        self.stop()
        self.start()

    def get_status(self) -> dict[str, Any]:
        """Return a summary of channel-routing state."""
        cm = self._channel_manager
        return {
            "running": self._running,
            "enabledChannels": cm.enabled_channels if cm else [],
            "channelStatus": cm.get_status() if cm else {},
        }

    @staticmethod
    def _assistant_content(payload: dict[str, Any]) -> str | None:
        assistant = payload.get("assistantMessage") or {}
        content = str(assistant.get("content") or "").strip() if isinstance(assistant, dict) else ""
        citations = assistant.get("citations") if isinstance(assistant, dict) else None
        if not isinstance(citations, list) or not citations:
            citations = [
                item.get("citation")
                for item in list(payload.get("knowledgeHits") or [])
                if isinstance(item, dict) and isinstance(item.get("citation"), dict)
            ]
        footer_lines: list[str] = []
        seen: set[tuple[str, str, str]] = set()
        for citation in citations[:3] if isinstance(citations, list) else []:
            if not isinstance(citation, dict):
                continue
            key = (
                str(citation.get("kbId") or ""),
                str(citation.get("docId") or ""),
                str(citation.get("title") or ""),
            )
            if key in seen:
                continue
            seen.add(key)
            title = str(citation.get("title") or citation.get("fileName") or citation.get("docId") or "").strip()
            kb_name = str(citation.get("kbName") or "").strip()
            if title:
                footer_lines.append(f"- {title}" + (f" ({kb_name})" if kb_name else ""))
        if footer_lines:
            footer = "参考来源：\n" + "\n".join(footer_lines)
            content = f"{content}\n\n{footer}".strip()
        return content or None

    # ------------------------------------------------------------------
    # Pipeline lifecycle (runs on the dedicated event-loop)
    # ------------------------------------------------------------------

    async def _start_pipeline(self) -> None:
        """Build all routing components and run them until cancelled."""
        try:
            config = self.state.config
            bindings = self.state.channel_bindings_service

            routing_service = ChannelRoutingService(bindings)
            self._bus = MessageBus()

            dispatcher = ChannelMessageDispatcher(
                self._bus,
                agent_handler=self._agent_handler,
                team_handler=self._team_handler,
            )

            provider = self.state.config_runtime.make_provider(config)
            self._agent = AgentLoop(
                bus=self._bus,
                provider=provider,
                workspace=config.workspace_path,
                model=config.agents.defaults.model,
                max_iterations=config.agents.defaults.max_tool_iterations,
                context_window_tokens=config.agents.defaults.context_window_tokens,
                brave_api_key=config.tools.web.search.api_key or None,
                web_proxy=config.tools.web.proxy or None,
                exec_config=config.tools.exec,
                restrict_to_workspace=config.tools.restrict_to_workspace,
                session_manager=self.state.sessions,
                mcp_servers=self.state.config_runtime.resolve_mcp_server_configs(config),
                channels_config=config.channels,
                channel_dispatcher=dispatcher,
            )

            self._channel_manager = ChannelManager(
                config, self._bus, routing_service=routing_service,
            )

            logger.info("Channel routing pipeline ready — starting agent loop and channels")
            await asyncio.gather(
                self._agent.run(),
                self._channel_manager.start_all(),
            )
        except asyncio.CancelledError:
            pass
        except BaseException:  # noqa: BLE001
            logger.exception("Channel routing pipeline crashed during startup or execution")
            self._running = False
            loop = asyncio.get_running_loop()
            loop.call_soon(loop.stop)

    async def _stop_pipeline(self) -> None:
        """Gracefully tear down the running pipeline."""
        if self._agent is not None:
            self._agent.stop()
            try:
                await self._agent.close_mcp()
            except Exception:  # noqa: BLE001
                pass
        if self._channel_manager is not None:
            try:
                await self._channel_manager.stop_all()
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------
    # Message handlers (called by ChannelMessageDispatcher)
    # ------------------------------------------------------------------

    async def _agent_handler(self, agent_id: str, msg: InboundMessage) -> str | None:
        """Route an inbound channel message to a specific agent definition."""
        agents_svc = self.state.app_agents
        if agents_svc is None:
            return "Agent service not available."

        try:
            agent_def = agents_svc.get_agent(agent_id)
        except Exception:
            logger.warning("Agent definition '{}' not found for channel routing", agent_id)
            return f"Agent '{agent_id}' not found."

        try:
            payload = await self.state.agent_runtime.run_agent_definition(
                agent_def,
                task=msg.content,
                label=agent_def.get("name") or agent_id,
                session_key=f"agent:{agent_id}:{msg.session_key}",
                session_id=f"channel-agent:{agent_id}:{msg.chat_id}",
                session_title=f"{agent_def.get('name') or agent_id} · {msg.channel}",
                origin_chat_id=msg.chat_id,
            )
            return self._assistant_content(payload)
        except Exception as exc:
            logger.exception("Channel agent execution failed for '{}'", agent_id)
            return f"Agent execution error: {exc}"

    async def _team_handler(self, team_id: str, msg: InboundMessage) -> str | None:
        """Route an inbound channel message to a team via LangGraph supervisor."""
        from langchain_core.messages import AIMessage, HumanMessage
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import create_react_agent

        from nanobot.platform.teams.models import SupervisorConfig
        from nanobot.web.runtime_services.langgraph_supervisor import (
            NanobotSupervisorLLM,
            _build_supervisor_prompt,
            _slugify_tool_name,
        )

        teams_svc = self.state.app_teams
        agents_svc = self.state.app_agents
        if teams_svc is None or agents_svc is None:
            return "Team/Agent service not available."

        try:
            team = teams_svc.get_team(team_id)
        except Exception:
            logger.warning("Team definition '{}' not found for channel routing", team_id)
            return f"Team '{team_id}' not found."

        supervisor_id = team.get("supervisorAgentId")
        if not supervisor_id:
            return "Team has no supervisor agent configured."

        try:
            supervisor = agents_svc.get_agent(supervisor_id)
        except Exception:
            return f"Supervisor agent '{supervisor_id}' not found."

        member_ids = team.get("memberAgentIds") or []
        members: list[dict[str, Any]] = []
        for mid in member_ids:
            try:
                members.append(agents_svc.get_agent(mid))
            except Exception:
                logger.warning("Member agent '{}' not found, skipping", mid)

        config = self.state.agent_runtime._build_agent_config(supervisor)
        provider = self.state.config_runtime.make_provider(config)

        supervisor_llm = NanobotSupervisorLLM(
            provider=provider, model_name=config.agents.defaults.model,
        )
        sup_config = SupervisorConfig.from_dict(team.get("supervisorConfig"))

        # Build member tools — each runs an isolated AgentLoop.
        member_tools: list[StructuredTool] = []
        for member in members:
            _m = member
            _m_name = member["name"]
            _m_id = member["agentId"]
            tool_name = f"call_{_slugify_tool_name(_m_name)}"
            role_hint = str(member.get("teamRoleHint") or "").strip()
            desc = role_hint or str(
                member.get("description") or member.get("systemPrompt") or ""
            ).strip()[:200]

            async def _call_member(
                task: str,
                _member: dict[str, Any] = _m,
                _member_id: str = _m_id,
            ) -> str:
                payload = await self.state.agent_runtime.run_agent_definition(
                    _member,
                    task=task,
                    label=_member.get("name") or _member_id,
                    session_key=f"team:{team_id}:member:{_member_id}:{msg.session_key}",
                    session_id=f"channel-team:{team_id}:{_member_id}:{msg.chat_id}",
                    session_title=f"{_member.get('name') or _member_id} · {msg.channel}",
                    origin_chat_id=msg.chat_id,
                    team_id=team_id,
                    include_workspace_memory=False,
                )
                return self._assistant_content(payload) or ""

            member_tools.append(StructuredTool.from_function(
                coroutine=_call_member,
                name=tool_name,
                description=f"Delegate a task to team member '{_m_name}'. {desc}",
            ))

        system_prompt = _build_supervisor_prompt(
            team, supervisor, members, supervisor_config=sup_config,
        )
        graph = create_react_agent(
            model=supervisor_llm, tools=member_tools, prompt=system_prompt,
        )

        try:
            result = await graph.ainvoke(
                {"messages": [HumanMessage(content=msg.content)]},
                config={"recursion_limit": sup_config.recursion_limit},
            )
        except Exception as exc:
            logger.exception("Team '{}' LangGraph execution failed", team["name"])
            return f"Team execution error: {exc}"

        for m in reversed(result.get("messages", [])):
            if isinstance(m, AIMessage) and m.content and not m.tool_calls:
                return str(m.content)
        return "(Team produced no response)"
