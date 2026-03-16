"""Channel message dispatcher for routing inbound messages to target agents or teams."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from loguru import logger

from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus


class ChannelMessageDispatcher:
    """Routes inbound messages to the correct agent or team based on routing metadata.

    When ``_RoutingBusProxy`` enriches a message with ``_routing_target_type``
    and ``_routing_target_id``, this dispatcher resolves and executes the target.

    Callers register async handler callbacks:

    - ``agent_handler(agent_id, msg) -> str | None``  – run the named agent
    - ``team_handler(team_id, msg) -> str | None``    – run the named team
    """

    def __init__(
        self,
        bus: MessageBus,
        *,
        agent_handler: Callable[[str, InboundMessage], Awaitable[str | None]] | None = None,
        team_handler: Callable[[str, InboundMessage], Awaitable[str | None]] | None = None,
    ):
        self.bus = bus
        self.agent_handler = agent_handler
        self.team_handler = team_handler

    async def dispatch(self, msg: InboundMessage) -> bool:
        """Attempt to dispatch *msg* via routing metadata.

        Returns ``True`` if the message was handled (routed to an agent/team),
        ``False`` if no routing metadata was present and the caller should
        fall through to default processing.
        """
        meta = msg.metadata or {}
        target_type = meta.get("_routing_target_type")
        target_id = meta.get("_routing_target_id")

        if not target_type or not target_id:
            return False

        logger.info(
            "Channel dispatch: {} → {}:{}",
            msg.session_key,
            target_type,
            target_id,
        )

        try:
            response: str | None = None
            if target_type == "agent" and self.agent_handler:
                response = await self.agent_handler(target_id, msg)
            elif target_type == "team" and self.team_handler:
                response = await self.team_handler(target_id, msg)
            else:
                logger.warning(
                    "No handler for routing target_type={} (target_id={})",
                    target_type,
                    target_id,
                )
                await self.bus.publish_outbound(OutboundMessage(
                    channel=msg.channel,
                    chat_id=msg.chat_id,
                    content=f"No handler configured for {target_type}:{target_id}.",
                ))
                return True

            if response is not None:
                await self.bus.publish_outbound(OutboundMessage(
                    channel=msg.channel,
                    chat_id=msg.chat_id,
                    content=response,
                ))
        except Exception:
            logger.exception(
                "Channel dispatch error for {}:{}", target_type, target_id,
            )
            await self.bus.publish_outbound(OutboundMessage(
                channel=msg.channel,
                chat_id=msg.chat_id,
                content=f"Error dispatching to {target_type}:{target_id}.",
            ))

        return True
