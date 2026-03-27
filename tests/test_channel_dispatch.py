"""Tests for channel message dispatcher."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from nanobot.bus.events import InboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.dispatch import ChannelMessageDispatcher
from nanobot.platform.channel_audit import ChannelAuditService, ChannelAuditStore


@pytest.fixture
def bus():
    return MessageBus()


@pytest.fixture
def audit_service(tmp_path):
    return ChannelAuditService(ChannelAuditStore(tmp_path / "channel-audit.db"), instance_id="instance-test")


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

    @pytest.mark.asyncio
    async def test_dispatch_records_audit_outcome_for_structured_handler(self, bus, audit_service):
        audit = audit_service.record_inbound(
            tenant_id="tenant-a",
            channel_name="telegram",
            chat_id="123",
            session_key="telegram:123",
            sender_id="user",
            message_preview="Hello",
            resolved=True,
            resolution_kind="exact",
            binding_id="cb-1",
            target_type="agent",
            target_id="agent-1",
        )
        handler = AsyncMock(return_value={
            "content": "Agent response",
            "runId": "run-123",
            "artifactPath": "tenant-a/instance-test/run-123.md",
            "metadata": {"mode": "agent"},
        })
        dispatcher = ChannelMessageDispatcher(bus, agent_handler=handler, audit_service=audit_service)
        msg = InboundMessage(
            channel="telegram",
            chat_id="123",
            content="Hello",
            sender_id="user",
            metadata={
                "_routing_target_type": "agent",
                "_routing_target_id": "agent-1",
                "_routing_audit_id": audit["auditId"],
                "_routing_tenant_id": "tenant-a",
            },
        )

        result = await dispatcher.dispatch(msg)
        assert result is True
        updated = audit_service.get_entry(audit["auditId"], tenant_id="tenant-a")
        assert updated["status"] == "dispatched"
        assert updated["dispatchRunId"] == "run-123"
        assert updated["artifactPath"] == "tenant-a/instance-test/run-123.md"
        assert updated["metadata"]["mode"] == "agent"

    @pytest.mark.asyncio
    async def test_dispatch_records_no_handler_and_errors_in_audit(self, bus, audit_service):
        no_handler_audit = audit_service.record_inbound(
            tenant_id="tenant-a",
            channel_name="telegram",
            chat_id="123",
            session_key="telegram:123",
            sender_id="user",
            message_preview="Hello",
            resolved=True,
            resolution_kind="exact",
            binding_id="cb-1",
            target_type="agent",
            target_id="agent-1",
        )
        msg = InboundMessage(
            channel="telegram",
            chat_id="123",
            content="Hello",
            sender_id="user",
            metadata={
                "_routing_target_type": "agent",
                "_routing_target_id": "agent-1",
                "_routing_audit_id": no_handler_audit["auditId"],
                "_routing_tenant_id": "tenant-a",
            },
        )
        dispatcher = ChannelMessageDispatcher(bus, audit_service=audit_service)
        assert await dispatcher.dispatch(msg) is True
        no_handler_entry = audit_service.get_entry(no_handler_audit["auditId"], tenant_id="tenant-a")
        assert no_handler_entry["status"] == "no_handler"

        error_audit = audit_service.record_inbound(
            tenant_id="tenant-a",
            channel_name="telegram",
            chat_id="456",
            session_key="telegram:456",
            sender_id="user",
            message_preview="Oops",
            resolved=True,
            resolution_kind="exact",
            binding_id="cb-2",
            target_type="agent",
            target_id="agent-2",
        )
        failing_dispatcher = ChannelMessageDispatcher(
            bus,
            agent_handler=AsyncMock(side_effect=RuntimeError("boom")),
            audit_service=audit_service,
        )
        failing_msg = InboundMessage(
            channel="telegram",
            chat_id="456",
            content="Oops",
            sender_id="user",
            metadata={
                "_routing_target_type": "agent",
                "_routing_target_id": "agent-2",
                "_routing_audit_id": error_audit["auditId"],
                "_routing_tenant_id": "tenant-a",
            },
        )
        assert await failing_dispatcher.dispatch(failing_msg) is True
        error_entry = audit_service.get_entry(error_audit["auditId"], tenant_id="tenant-a")
        assert error_entry["status"] == "dispatch_error"
