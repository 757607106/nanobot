"""Tests for channel message dispatcher."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from nanobot.bus.events import InboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.dispatch import ChannelMessageDispatcher


@pytest.fixture
def bus():
    return MessageBus()


class TestChannelMessageDispatcher:
    """Tests for ChannelMessageDispatcher."""

    @pytest.mark.asyncio
    async def test_dispatch_returns_false_without_routing_metadata(self, bus):
        dispatcher = ChannelMessageDispatcher(bus)
        msg = InboundMessage(
            channel="telegram",
            chat_id="123",
            content="Hello",
            sender_id="user",
            metadata={},
        )
        assert await dispatcher.dispatch(msg) is False

    @pytest.mark.asyncio
    async def test_dispatch_returns_false_with_empty_target_type(self, bus):
        dispatcher = ChannelMessageDispatcher(bus)
        msg = InboundMessage(
            channel="telegram",
            chat_id="123",
            content="Hello",
            sender_id="user",
            metadata={"_routing_target_type": "", "_routing_target_id": ""},
        )
        assert await dispatcher.dispatch(msg) is False

    @pytest.mark.asyncio
    async def test_dispatch_calls_agent_handler(self, bus):
        handler = AsyncMock(return_value="Agent response")
        dispatcher = ChannelMessageDispatcher(bus, agent_handler=handler)
        msg = InboundMessage(
            channel="telegram",
            chat_id="123",
            content="Hello",
            sender_id="user",
            metadata={
                "_routing_target_type": "agent",
                "_routing_target_id": "support-agent",
            },
        )
        result = await dispatcher.dispatch(msg)
        assert result is True
        handler.assert_called_once_with("support-agent", msg)
        # Check outbound message was published
        outbound = await asyncio.wait_for(bus.consume_outbound(), timeout=1.0)
        assert outbound.content == "Agent response"
        assert outbound.channel == "telegram"
        assert outbound.chat_id == "123"

    @pytest.mark.asyncio
    async def test_dispatch_calls_team_handler(self, bus):
        handler = AsyncMock(return_value="Team result")
        dispatcher = ChannelMessageDispatcher(bus, team_handler=handler)
        msg = InboundMessage(
            channel="whatsapp",
            chat_id="456",
            content="Task",
            sender_id="user",
            metadata={
                "_routing_target_type": "team",
                "_routing_target_id": "support-team",
            },
        )
        result = await dispatcher.dispatch(msg)
        assert result is True
        handler.assert_called_once_with("support-team", msg)
        outbound = await asyncio.wait_for(bus.consume_outbound(), timeout=1.0)
        assert outbound.content == "Team result"

    @pytest.mark.asyncio
    async def test_dispatch_handles_none_response(self, bus):
        handler = AsyncMock(return_value=None)
        dispatcher = ChannelMessageDispatcher(bus, agent_handler=handler)
        msg = InboundMessage(
            channel="telegram",
            chat_id="123",
            content="Hello",
            sender_id="user",
            metadata={
                "_routing_target_type": "agent",
                "_routing_target_id": "agent-1",
            },
        )
        result = await dispatcher.dispatch(msg)
        assert result is True
        handler.assert_called_once()

    @pytest.mark.asyncio
    async def test_dispatch_no_handler_sends_error(self, bus):
        dispatcher = ChannelMessageDispatcher(bus)  # No handlers
        msg = InboundMessage(
            channel="telegram",
            chat_id="123",
            content="Hello",
            sender_id="user",
            metadata={
                "_routing_target_type": "agent",
                "_routing_target_id": "agent-1",
            },
        )
        result = await dispatcher.dispatch(msg)
        assert result is True
        outbound = await asyncio.wait_for(bus.consume_outbound(), timeout=1.0)
        assert "No handler" in outbound.content

    @pytest.mark.asyncio
    async def test_dispatch_handles_handler_exception(self, bus):
        handler = AsyncMock(side_effect=RuntimeError("boom"))
        dispatcher = ChannelMessageDispatcher(bus, agent_handler=handler)
        msg = InboundMessage(
            channel="telegram",
            chat_id="123",
            content="Hello",
            sender_id="user",
            metadata={
                "_routing_target_type": "agent",
                "_routing_target_id": "agent-1",
            },
        )
        result = await dispatcher.dispatch(msg)
        assert result is True
        outbound = await asyncio.wait_for(bus.consume_outbound(), timeout=1.0)
        assert "Error dispatching" in outbound.content
