"""Channel message dispatcher for routing inbound messages to target agents or teams."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from loguru import logger

from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.platform.channel_audit import ChannelAuditService, ChannelAuditStatus


ChannelDispatchResponse = str | dict[str, Any] | None


class ChannelMessageDispatcher:
    """Routes inbound messages to the correct agent or team based on routing metadata.

    When ``_RoutingBusProxy`` enriches a message with ``_routing_target_type``
    and ``_routing_target_id``, this dispatcher resolves and executes the target.

    Callers register async handler callbacks:

    - ``agent_handler(agent_id, msg) -> str | dict | None``  – run the named agent
    - ``team_handler(team_id, msg) -> str | dict | None``    – run the named team
    """

    def __init__(
        self,
        bus: MessageBus,
        *,
        agent_handler: Callable[[str, InboundMessage], Awaitable[ChannelDispatchResponse]] | None = None,
        team_handler: Callable[[str, InboundMessage], Awaitable[ChannelDispatchResponse]] | None = None,
        audit_service: ChannelAuditService | None = None,
    ):
        self.bus = bus
        self.agent_handler = agent_handler
        self.team_handler = team_handler
        self.audit_service = audit_service

    @staticmethod
    def _normalize_handler_response(response: ChannelDispatchResponse) -> dict[str, Any]:
        if isinstance(response, dict):
            payload = dict(response)
            return {
                "content": str(payload.get("content") or "").strip(),
                "runId": str(payload.get("runId") or "").strip() or None,
                "artifactPath": str(payload.get("artifactPath") or "").strip() or None,
                "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
            }
        if response is None:
            return {"content": "", "runId": None, "artifactPath": None, "metadata": {}}
        return {"content": str(response).strip(), "runId": None, "artifactPath": None, "metadata": {}}

    async def dispatch(self, msg: InboundMessage) -> bool:
        """Attempt to dispatch *msg* via routing metadata.

        Returns ``True`` if the message was handled (routed to an agent/team),
        ``False`` if no routing metadata was present and the caller should
        fall through to default processing.
        """
        meta = msg.metadata or {}
        target_type = meta.get("_routing_target_type")
        target_id = meta.get("_routing_target_id")
        audit_id = str(meta.get("_routing_audit_id") or "").strip() or None
        tenant_id = str(meta.get("_routing_tenant_id") or "default").strip() or "default"

        if not target_type or not target_id:
            return False

        logger.info(
            "Channel dispatch: {} → {}:{}",
            msg.session_key,
            target_type,
            target_id,
        )

        try:
            response: ChannelDispatchResponse = None
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
                if audit_id and self.audit_service is not None:
                    self.audit_service.record_dispatch_outcome(
                        audit_id,
                        tenant_id=tenant_id,
                        status=ChannelAuditStatus.NO_HANDLER,
                        error_message=f"No handler configured for {target_type}:{target_id}.",
                        metadata={"targetType": target_type, "targetId": target_id},
                    )
                return True

            payload = self._normalize_handler_response(response)
            if audit_id and self.audit_service is not None:
                self.audit_service.record_dispatch_outcome(
                    audit_id,
                    tenant_id=tenant_id,
                    status=ChannelAuditStatus.DISPATCHED,
                    response_preview=payload["content"],
                    run_id=payload["runId"],
                    artifact_path=payload["artifactPath"],
                    metadata={"targetType": target_type, "targetId": target_id, **payload["metadata"]},
                )
            if payload["content"]:
                await self.bus.publish_outbound(OutboundMessage(
                    channel=msg.channel,
                    chat_id=msg.chat_id,
                    content=payload["content"],
                ))
        except Exception:
            logger.exception(
                "Channel dispatch error for {}:{}", target_type, target_id,
            )
            if audit_id and self.audit_service is not None:
                self.audit_service.record_dispatch_outcome(
                    audit_id,
                    tenant_id=tenant_id,
                    status=ChannelAuditStatus.DISPATCH_ERROR,
                    error_message=f"Error dispatching to {target_type}:{target_id}.",
                    metadata={"targetType": target_type, "targetId": target_id},
                )
            await self.bus.publish_outbound(OutboundMessage(
                channel=msg.channel,
                chat_id=msg.chat_id,
                content=f"Error dispatching to {target_type}:{target_id}.",
            ))

        return True
