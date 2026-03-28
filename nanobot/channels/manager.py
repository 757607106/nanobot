"""Channel manager for coordinating chat channels."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from loguru import logger

from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.config.schema import Config
from nanobot.platform.channel_audit import ChannelAuditService
from nanobot.platform.tenant_scope import tenant_id_from_metadata

if TYPE_CHECKING:
    from nanobot.web.runtime_services.channel_routing import ChannelRoutingService


_SEND_RETRY_DELAYS = (1, 2, 4)


class _RoutingBusProxy:
    """Transparent proxy that enriches inbound messages with routing metadata.

    Channels interact with this proxy exactly like a real ``MessageBus``.  On
    ``publish_inbound``, the proxy resolves a channel-binding target and injects
    ``_routing_*`` keys into the message metadata before forwarding to the
    underlying bus.  All other attributes are proxied through unchanged.
    """

    def __init__(
        self,
        inner: MessageBus,
        routing_service: ChannelRoutingService,
        audit_service: ChannelAuditService | None = None,
        tenant_id: str = "default",
    ):
        self._inner = inner
        self._routing = routing_service
        self._audit = audit_service
        self._tenant_id = tenant_id

    async def publish_inbound(self, msg: InboundMessage) -> None:
        tenant_id = tenant_id_from_metadata(msg.metadata, default=self._tenant_id)
        target = self._routing.resolve_target(
            msg.channel, msg.chat_id, tenant_id=tenant_id,
        )
        if target is not None:
            msg.metadata["_routing_target_type"] = target.target_type
            msg.metadata["_routing_target_id"] = target.target_id
            msg.metadata["_routing_binding_id"] = target.binding_id
            msg.metadata["_routing_tenant_id"] = tenant_id
        if self._audit is not None:
            binding_chat_id = str(getattr(target, "binding_chat_id", "") or "").strip()
            resolution_kind = "none"
            if target is not None:
                resolution_kind = "wildcard" if binding_chat_id == "*" else "exact"
            audit_entry = self._audit.record_inbound(
                tenant_id=tenant_id,
                channel_name=msg.channel,
                chat_id=msg.chat_id,
                session_key=msg.session_key,
                sender_id=msg.sender_id,
                message_preview=msg.content,
                resolved=target is not None,
                resolution_kind=resolution_kind,
                binding_id=str(getattr(target, "binding_id", "") or "").strip() or None,
                target_type=str(getattr(target, "target_type", "") or "").strip() or None,
                target_id=str(getattr(target, "target_id", "") or "").strip() or None,
                message_id=str((msg.metadata or {}).get("message_id") or "").strip() or None,
                metadata={
                    "mediaCount": len(msg.media or []),
                    "source": "routing_proxy",
                },
            )
            msg.metadata["_routing_audit_id"] = audit_entry["auditId"]
        await self._inner.publish_inbound(msg)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class ChannelManager:
    """
    Manages chat channels and coordinates message routing.

    Responsibilities:
    - Initialize enabled channels (Telegram, WhatsApp, etc.)
    - Start/stop channels
    - Route outbound messages
    """

    def __init__(
        self,
        config: Config,
        bus: MessageBus,
        *,
        routing_service: ChannelRoutingService | None = None,
        audit_service: ChannelAuditService | None = None,
        tenant_id: str = "default",
    ):
        self.config = config
        self._raw_bus = bus
        # When a routing service is provided, channels write through a proxy
        # that enriches inbound messages with _routing_* metadata.
        if routing_service is not None:
            self.bus: MessageBus | _RoutingBusProxy = _RoutingBusProxy(
                bus, routing_service, audit_service, tenant_id,
            )
            logger.info("Channel routing enabled (tenant={})", tenant_id)
        else:
            self.bus = bus
        self.channels: dict[str, BaseChannel] = {}
        self._dispatch_task: asyncio.Task | None = None

        self._init_channels()

    def _init_channels(self) -> None:
        """Initialize channels discovered via pkgutil scan + entry_points plugins."""
        from nanobot.channels.registry import discover_all

        groq_key = self.config.providers.groq.api_key

        for name, cls in discover_all().items():
            section = getattr(self.config.channels, name, None)
            if section is None:
                continue
            enabled = (
                section.get("enabled", False)
                if isinstance(section, dict)
                else getattr(section, "enabled", False)
            )
            if not enabled:
                continue
            try:
                channel_config = (
                    section.model_dump(mode="python")
                    if hasattr(section, "model_dump") and not isinstance(section, dict)
                    else section
                )
                channel = cls(channel_config, self.bus)
                channel.transcription_api_key = groq_key
                self.channels[name] = channel
                logger.info("{} channel enabled", cls.display_name)
            except Exception as e:
                logger.warning("{} channel not available: {}", name, e)

        self._validate_allow_from()

    def _validate_allow_from(self) -> None:
        for name, ch in self.channels.items():
            if getattr(ch.config, "allow_from", None) == []:
                raise SystemExit(
                    f'Error: "{name}" has empty allowFrom (denies all). '
                    f'Set ["*"] to allow everyone, or add specific user IDs.'
                )

    async def _start_channel(self, name: str, channel: BaseChannel) -> None:
        """Start a channel and log any exceptions."""
        try:
            await channel.start()
        except Exception as e:
            logger.error("Failed to start channel {}: {}", name, e)

    async def start_all(self) -> None:
        """Start all channels and the outbound dispatcher."""
        if not self.channels:
            logger.warning("No channels enabled")
            return

        # Start outbound dispatcher
        self._dispatch_task = asyncio.create_task(self._dispatch_outbound())

        # Start channels
        tasks = []
        for name, channel in self.channels.items():
            logger.info("Starting {} channel...", name)
            tasks.append(asyncio.create_task(self._start_channel(name, channel)))

        # Wait for all to complete (they should run forever)
        await asyncio.gather(*tasks, return_exceptions=True)

    async def stop_all(self) -> None:
        """Stop all channels and the dispatcher."""
        logger.info("Stopping all channels...")

        # Stop dispatcher
        if self._dispatch_task:
            self._dispatch_task.cancel()
            try:
                await self._dispatch_task
            except asyncio.CancelledError:
                pass

        # Stop all channels
        for name, channel in self.channels.items():
            try:
                await channel.stop()
                logger.info("Stopped {} channel", name)
            except Exception as e:
                logger.error("Error stopping {}: {}", name, e)

    async def _dispatch_outbound(self) -> None:
        """Dispatch outbound messages to the appropriate channel."""
        logger.info("Outbound dispatcher started")
        pending: list[OutboundMessage] = []

        while True:
            try:
                if pending:
                    msg = pending.pop(0)
                else:
                    msg = await asyncio.wait_for(
                        self.bus.consume_outbound(),
                        timeout=1.0,
                    )

                if msg.metadata.get("_progress"):
                    if msg.metadata.get("_tool_hint") and not self.config.channels.send_tool_hints:
                        continue
                    if not msg.metadata.get("_tool_hint") and not self.config.channels.send_progress:
                        continue

                if msg.metadata.get("_stream_delta") and not msg.metadata.get("_stream_end"):
                    msg, extra_pending = self._coalesce_stream_deltas(msg)
                    pending.extend(extra_pending)

                channel = self.channels.get(msg.channel)
                if channel:
                    await self._send_with_retry(channel, msg)
                else:
                    logger.warning("Unknown channel: {}", msg.channel)

            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

    @staticmethod
    async def _send_once(channel: BaseChannel, msg: OutboundMessage) -> None:
        """Send one outbound message without retry policy."""
        if msg.metadata.get("_stream_delta") or msg.metadata.get("_stream_end"):
            await channel.send_delta(msg.chat_id, msg.content, msg.metadata)
        elif not msg.metadata.get("_streamed"):
            await channel.send(msg)

    def _coalesce_stream_deltas(
        self, first_msg: OutboundMessage,
    ) -> tuple[OutboundMessage, list[OutboundMessage]]:
        """Merge consecutive stream-delta messages for the same channel target."""
        target_key = (first_msg.channel, first_msg.chat_id)
        combined_content = first_msg.content
        final_metadata = dict(first_msg.metadata or {})
        non_matching: list[OutboundMessage] = []

        while True:
            try:
                next_msg = self.bus.outbound.get_nowait()
            except asyncio.QueueEmpty:
                break

            same_target = (next_msg.channel, next_msg.chat_id) == target_key
            is_delta = next_msg.metadata and next_msg.metadata.get("_stream_delta")
            is_end = next_msg.metadata and next_msg.metadata.get("_stream_end")

            if same_target and is_delta and not final_metadata.get("_stream_end"):
                combined_content += next_msg.content
                if is_end:
                    final_metadata["_stream_end"] = True
                    break
            else:
                non_matching.append(next_msg)
                break

        return OutboundMessage(
            channel=first_msg.channel,
            chat_id=first_msg.chat_id,
            content=combined_content,
            metadata=final_metadata,
        ), non_matching

    async def _send_with_retry(self, channel: BaseChannel, msg: OutboundMessage) -> None:
        """Send a message with bounded retry and exponential backoff."""
        max_attempts = max(self.config.channels.send_max_retries, 1)

        for attempt in range(max_attempts):
            try:
                await self._send_once(channel, msg)
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if attempt == max_attempts - 1:
                    logger.error(
                        "Failed to send to {} after {} attempts: {} - {}",
                        msg.channel, max_attempts, type(e).__name__, e,
                    )
                    return
                delay = _SEND_RETRY_DELAYS[min(attempt, len(_SEND_RETRY_DELAYS) - 1)]
                logger.warning(
                    "Send to {} failed (attempt {}/{}): {}, retrying in {}s",
                    msg.channel, attempt + 1, max_attempts, type(e).__name__, delay,
                )
                await asyncio.sleep(delay)

    def get_channel(self, name: str) -> BaseChannel | None:
        """Get a channel by name."""
        return self.channels.get(name)

    def get_status(self) -> dict[str, Any]:
        """Get status of all channels."""
        return {
            name: {
                "enabled": True,
                "running": channel.is_running
            }
            for name, channel in self.channels.items()
        }

    @property
    def enabled_channels(self) -> list[str]:
        """Get list of enabled channel names."""
        return list(self.channels.keys())
