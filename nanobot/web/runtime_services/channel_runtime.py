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
from nanobot.web.tenant_context import get_metadata_tenant_id
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
                future = asyncio.run_coroutine_threadsafe(self._stop_pipeline(), loop)
                future.result(timeout=10)
            except Exception:  # noqa: BLE001
                logger.exception("Error stopping channel pipeline")
            try:
                loop.call_soon_threadsafe(loop.stop)
            except RuntimeError:
                logger.debug("Channel runtime loop already closed during stop")

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
                audit_service=self.state.channel_audit_service,
            )

            provider = self.state.config_runtime.make_provider(config)
            self._agent = AgentLoop(
                bus=self._bus,
                provider=provider,
                workspace=config.workspace_path,
                model=config.agents.defaults.model,
                max_iterations=config.agents.defaults.max_tool_iterations,
                context_window_tokens=config.agents.defaults.context_window_tokens,
                web_search_config=config.tools.web.search,
                web_proxy=config.tools.web.proxy or None,
                exec_config=config.tools.exec,
                restrict_to_workspace=config.tools.restrict_to_workspace,
                session_manager=self.state.sessions,
                mcp_servers=config.tools.mcp_servers,
                channels_config=config.channels,
                channel_dispatcher=dispatcher,
            )

            self._channel_manager = ChannelManager(
                config,
                self._bus,
                routing_service=routing_service,
                audit_service=self.state.channel_audit_service,
            )
            logger.info("Channel routing pipeline ready — starting agent loop and channels")
            await asyncio.gather(
                self._agent.run(),
                self._channel_manager.start_all(),
            )
        except asyncio.CancelledError:
            pass
        except BaseException:  # noqa: BLE001
            logger.exception("Channel routing pipeline crashed")
            await self._stop_pipeline()

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

    @staticmethod
    def _message_metadata(msg: InboundMessage) -> dict[str, Any]:
        metadata = getattr(msg, "metadata", None)
        return metadata if isinstance(metadata, dict) else {}

    @classmethod
    def _route_metadata(
        cls,
        msg: InboundMessage,
        *,
        tenant_id: str,
        target_type: str,
        target_id: str,
    ) -> dict[str, Any] | None:
        metadata = cls._message_metadata(msg)
        binding_id = str(metadata.get("_routing_binding_id") or "").strip()
        if not binding_id:
            return None
        return {
            "tenantId": tenant_id,
            "bindingId": binding_id,
            "auditId": str(metadata.get("_routing_audit_id") or "").strip() or None,
            "targetType": str(metadata.get("_routing_target_type") or target_type),
            "targetId": str(metadata.get("_routing_target_id") or target_id),
            "channelName": msg.channel,
            "chatId": msg.chat_id,
            "sessionKey": msg.session_key,
        }

    async def _agent_handler(self, agent_id: str, msg: InboundMessage) -> dict[str, Any] | str | None:
        """Route an inbound channel message to a specific agent definition."""
        agents_svc = self.state.app_agents
        if agents_svc is None:
            return "Agent service not available."
        tenant_id = get_metadata_tenant_id(self._message_metadata(msg))

        try:
            try:
                agent_def = agents_svc.get_agent(agent_id, tenant_id=tenant_id)
            except TypeError:
                agent_def = agents_svc.get_agent(agent_id)
        except Exception:
            logger.warning("Agent definition '{}' not found for channel routing", agent_id)
            return f"Agent '{agent_id}' not found."
        route_metadata = self._route_metadata(
            msg,
            tenant_id=tenant_id,
            target_type="agent",
            target_id=agent_id,
        )
        try:
            result = await self.state.agent_runtime.run_agent_definition(
                agent_def,
                task=msg.content,
                label=str(agent_def.get("name") or agent_id),
                session_key=f"agent:{agent_id}:{msg.session_key}",
                session_id=f"agent:{agent_id}:{msg.session_key}",
                session_title=f"Agent Route · {agent_def.get('name') or agent_id}",
                origin_channel=msg.channel,
                origin_chat_id=msg.chat_id,
                route_metadata=route_metadata,
            )
        except ValueError as exc:
            return str(exc)
        except Exception as exc:
            logger.exception("Agent '{}' channel execution failed", agent_id)
            return f"Agent execution error: {exc}"
        assistant = result.get("assistantMessage") or {}
        final_content = str(assistant.get("content") or (result.get("run", {}).get("resultSummary") or {}).get("content") or "").strip()
        return {
            "content": final_content or "(Agent produced no response)",
            "runId": str((result.get("run") or {}).get("runId") or "").strip() or None,
            "artifactPath": str((result.get("run") or {}).get("artifactPath") or "").strip() or None,
            "metadata": {
                "targetType": "agent",
                "targetId": agent_id,
            },
        }
