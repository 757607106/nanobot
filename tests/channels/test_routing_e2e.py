"""End-to-end integration tests for the channel routing pipeline.

Tests the full message flow:
  InboundMessage
    -> _RoutingBusProxy (injects routing metadata)
    -> MessageBus
    -> AgentLoop._dispatch (via consume_inbound)
    -> ChannelMessageDispatcher.dispatch
    -> agent_handler
    -> OutboundMessage
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.dispatch import ChannelMessageDispatcher
from nanobot.channels.manager import _RoutingBusProxy
from nanobot.platform.channel_audit import ChannelAuditService, ChannelAuditStore
from nanobot.platform.channel_bindings.models import ChannelBinding, now_iso
from nanobot.platform.channel_bindings.service import (
    ChannelBindingConflictError,
    ChannelBindingService,
    ChannelBindingValidationError,
)
from nanobot.platform.channel_bindings.store import ChannelBindingStore
from nanobot.web.runtime_services.channel_routing import (
    ChannelRoutingService,
    RoutingTarget,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    return tmp_path / "test_bindings.db"


@pytest.fixture
def store(tmp_db: Path) -> ChannelBindingStore:
    return ChannelBindingStore(tmp_db)


@pytest.fixture
def service(store: ChannelBindingStore) -> ChannelBindingService:
    return ChannelBindingService(store, instance_id="default")


@pytest.fixture
def routing(service: ChannelBindingService) -> ChannelRoutingService:
    return ChannelRoutingService(service)


@pytest.fixture
def bus() -> MessageBus:
    return MessageBus()


@pytest.fixture
def audit_service(tmp_path: Path) -> ChannelAuditService:
    return ChannelAuditService(ChannelAuditStore(tmp_path / "channel-audit.db"), instance_id="default")


@pytest.fixture
def proxy(bus: MessageBus, routing: ChannelRoutingService, audit_service: ChannelAuditService) -> _RoutingBusProxy:
    return _RoutingBusProxy(bus, routing, audit_service=audit_service, tenant_id="default")


def _make_msg(
    channel: str = "qq",
    chat_id: str = "group_123",
    content: str = "hello",
    sender_id: str = "user_456",
) -> InboundMessage:
    return InboundMessage(
        channel=channel,
        sender_id=sender_id,
        chat_id=chat_id,
        content=content,
        metadata={"message_id": "test_msg_1"},
    )


def _create_binding(
    service: ChannelBindingService,
    *,
    channel: str = "qq",
    chat_id: str = "*",
    target_type: str = "agent",
    target_id: str = "agent-13",
    tenant_id: str = "default",
    priority: int = 0,
    enabled: bool = True,
) -> dict:
    return service.create_binding(
        {
            "channelName": channel,
            "channelChatId": chat_id,
            "targetType": target_type,
            "targetId": target_id,
            "priority": priority,
            "enabled": enabled,
        },
        tenant_id=tenant_id,
    )


# ===================================================================
# Part 1: ChannelBindingService CRUD + resolve
# ===================================================================


class TestChannelBindingService:
    """Unit tests for the ChannelBindingService layer."""

    def test_create_validates_target_with_tenant_scope(self, store: ChannelBindingStore) -> None:
        captured: dict[str, str | None] = {}

        def _lookup(target_id: str, *, tenant_id: str | None = None) -> None:
            captured["target_id"] = target_id
            captured["tenant_id"] = tenant_id

        service = ChannelBindingService(store, instance_id="default", agent_lookup=_lookup)

        created = _create_binding(
            service,
            target_id="agent-tenant",
            tenant_id="tenant-a",
        )

        assert created["tenantId"] == "tenant-a"
        assert captured == {"target_id": "agent-tenant", "tenant_id": "tenant-a"}

    def test_create_and_list(self, service: ChannelBindingService) -> None:
        created = _create_binding(service, channel="qq", chat_id="*", target_id="agent-13")
        assert created["channelName"] == "qq"
        assert created["channelChatId"] == "*"
        assert created["targetType"] == "agent"
        assert created["targetId"] == "agent-13"
        assert created["enabled"] is True

        bindings = service.list_bindings(tenant_id="default")
        assert len(bindings) == 1
        assert bindings[0]["bindingId"] == created["bindingId"]

    def test_create_exact_and_wildcard(self, service: ChannelBindingService) -> None:
        wild = _create_binding(service, channel="qq", chat_id="*", target_id="default-agent")
        exact = _create_binding(service, channel="qq", chat_id="group_999", target_id="vip-agent")
        bindings = service.list_bindings(tenant_id="default")
        assert len(bindings) == 2

    def test_get_binding(self, service: ChannelBindingService) -> None:
        created = _create_binding(service)
        fetched = service.get_binding(created["bindingId"], tenant_id="default")
        assert fetched["bindingId"] == created["bindingId"]

    def test_update_binding(self, service: ChannelBindingService) -> None:
        created = _create_binding(service, target_id="agent-13")
        updated = service.update_binding(
            created["bindingId"],
            {"targetId": "agent-12"},
            tenant_id="default",
        )
        assert updated["targetId"] == "agent-12"

    def test_update_rejects_non_agent_target_type(self, service: ChannelBindingService) -> None:
        created = _create_binding(service, target_id="agent-13")

        with pytest.raises(ChannelBindingValidationError, match="targetType must be one of: agent."):
            service.update_binding(
                created["bindingId"],
                {"targetType": "legacy-target", "targetId": "agent-12"},
                tenant_id="default",
            )

    def test_delete_binding(self, service: ChannelBindingService) -> None:
        created = _create_binding(service)
        assert service.delete_binding(created["bindingId"], tenant_id="default") is True
        assert service.list_bindings(tenant_id="default") == []

    def test_resolve_exact_match(self, service: ChannelBindingService) -> None:
        _create_binding(service, channel="qq", chat_id="*", target_id="default-agent")
        _create_binding(service, channel="qq", chat_id="group_VIP", target_id="vip-agent")

        binding = service.resolve_binding("qq", "group_VIP", tenant_id="default")
        assert binding is not None
        assert binding.target_id == "vip-agent"

    def test_resolve_wildcard_fallback(self, service: ChannelBindingService) -> None:
        _create_binding(service, channel="qq", chat_id="*", target_id="default-agent")

        binding = service.resolve_binding("qq", "any_chat_id", tenant_id="default")
        assert binding is not None
        assert binding.target_id == "default-agent"

    def test_resolve_no_match(self, service: ChannelBindingService) -> None:
        _create_binding(service, channel="qq", chat_id="*", target_id="default-agent")
        binding = service.resolve_binding("telegram", "some_chat", tenant_id="default")
        assert binding is None

    def test_resolve_disabled_ignored(self, service: ChannelBindingService) -> None:
        _create_binding(service, channel="qq", chat_id="*", target_id="agent-13", enabled=False)
        binding = service.resolve_binding("qq", "any_chat", tenant_id="default")
        assert binding is None

    def test_duplicate_binding_conflict(self, service: ChannelBindingService) -> None:
        _create_binding(service, channel="qq", chat_id="*")
        with pytest.raises(Exception):
            _create_binding(service, channel="qq", chat_id="*")


# ===================================================================
# Part 2: ChannelRoutingService
# ===================================================================


class TestChannelRoutingService:
    """Tests for ChannelRoutingService.resolve_target()."""

    def test_resolve_returns_routing_target(
        self, service: ChannelBindingService, routing: ChannelRoutingService,
    ) -> None:
        created = _create_binding(service, channel="qq", chat_id="*", target_id="agent-13")
        target = routing.resolve_target("qq", "group_123", tenant_id="default")
        assert target is not None
        assert isinstance(target, RoutingTarget)
        assert target.target_type == "agent"
        assert target.target_id == "agent-13"
        assert target.binding_id == created["bindingId"]

    def test_resolve_returns_none_when_no_binding(
        self, routing: ChannelRoutingService,
    ) -> None:
        target = routing.resolve_target("qq", "group_123", tenant_id="default")
        assert target is None

    def test_resolve_exact_wins_over_wildcard(
        self, service: ChannelBindingService, routing: ChannelRoutingService,
    ) -> None:
        _create_binding(service, channel="qq", chat_id="*", target_id="default-agent")
        _create_binding(service, channel="qq", chat_id="group_VIP", target_id="vip-agent")

        target = routing.resolve_target("qq", "group_VIP", tenant_id="default")
        assert target is not None
        assert target.target_id == "vip-agent"

        target_other = routing.resolve_target("qq", "group_OTHER", tenant_id="default")
        assert target_other is not None
        assert target_other.target_id == "default-agent"


# ===================================================================
# Part 3: _RoutingBusProxy (metadata injection)
# ===================================================================


class TestRoutingBusProxy:
    """Tests for _RoutingBusProxy injecting routing metadata into messages."""

    @pytest.mark.asyncio
    async def test_proxy_injects_routing_metadata(
        self,
        service: ChannelBindingService,
        bus: MessageBus,
        proxy: _RoutingBusProxy,
        audit_service: ChannelAuditService,
    ) -> None:
        binding = _create_binding(service, channel="qq", chat_id="*", target_id="agent-13")
        msg = _make_msg(channel="qq", chat_id="group_123")

        await proxy.publish_inbound(msg)

        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        assert received.metadata["_routing_target_type"] == "agent"
        assert received.metadata["_routing_target_id"] == "agent-13"
        assert received.metadata["_routing_binding_id"] == binding["bindingId"]
        assert received.metadata["_routing_audit_id"].startswith("ca-")
        # original metadata preserved
        assert received.metadata["message_id"] == "test_msg_1"
        audit = audit_service.get_entry(received.metadata["_routing_audit_id"], tenant_id="default")
        assert audit["status"] == "resolved"
        assert audit["resolutionKind"] == "wildcard"

    @pytest.mark.asyncio
    async def test_proxy_uses_message_tenant_metadata_for_resolution(
        self,
        service: ChannelBindingService,
        bus: MessageBus,
        proxy: _RoutingBusProxy,
        audit_service: ChannelAuditService,
    ) -> None:
        _create_binding(service, channel="qq", chat_id="*", target_id="default-agent", tenant_id="default")
        tenant_binding = _create_binding(
            service,
            channel="qq",
            chat_id="*",
            target_id="tenant-agent",
            tenant_id="tenant-a",
        )
        msg = _make_msg(channel="qq", chat_id="group_123")
        msg.metadata["tenantId"] = "tenant-a"

        await proxy.publish_inbound(msg)

        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        assert received.metadata["_routing_target_id"] == "tenant-agent"
        assert received.metadata["_routing_binding_id"] == tenant_binding["bindingId"]
        assert received.metadata["_routing_tenant_id"] == "tenant-a"
        audit = audit_service.get_entry(received.metadata["_routing_audit_id"], tenant_id="tenant-a")
        assert audit["tenantId"] == "tenant-a"

    @pytest.mark.asyncio
    async def test_proxy_no_match_no_metadata(
        self, bus: MessageBus, proxy: _RoutingBusProxy, audit_service: ChannelAuditService,
    ) -> None:
        msg = _make_msg(channel="telegram", chat_id="unknown_chat")

        await proxy.publish_inbound(msg)

        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        assert "_routing_target_type" not in received.metadata
        assert "_routing_target_id" not in received.metadata
        audit = audit_service.get_entry(received.metadata["_routing_audit_id"], tenant_id="default")
        assert audit["status"] == "unmatched"

    @pytest.mark.asyncio
    async def test_proxy_exact_match_over_wildcard(
        self,
        service: ChannelBindingService,
        bus: MessageBus,
        proxy: _RoutingBusProxy,
    ) -> None:
        _create_binding(service, channel="qq", chat_id="*", target_id="default-agent")
        _create_binding(service, channel="qq", chat_id="vip_group", target_id="vip-agent")

        msg = _make_msg(channel="qq", chat_id="vip_group")
        await proxy.publish_inbound(msg)

        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        assert received.metadata["_routing_target_type"] == "agent"
        assert received.metadata["_routing_target_id"] == "vip-agent"

    @pytest.mark.asyncio
    async def test_proxy_passthrough_attributes(
        self, bus: MessageBus, proxy: _RoutingBusProxy,
    ) -> None:
        """Proxy should forward attribute access to the inner bus."""
        assert proxy.inbound_size == 0
        assert proxy.outbound_size == 0


# ===================================================================
# Part 4: Full pipeline — Proxy + Dispatcher
# ===================================================================


class TestFullRoutingPipeline:
    """End-to-end tests: inbound message -> proxy -> bus -> dispatcher -> handler -> outbound."""

    @pytest.mark.asyncio
    async def test_e2e_agent_routing(
        self,
        service: ChannelBindingService,
        bus: MessageBus,
        proxy: _RoutingBusProxy,
    ) -> None:
        """Full E2E: QQ message -> wildcard binding -> agent handler -> outbound response."""
        _create_binding(service, channel="qq", chat_id="*", target_id="agent-13")

        agent_handler = AsyncMock(return_value="I am agent-13, ready to help!")
        dispatcher = ChannelMessageDispatcher(
            bus, agent_handler=agent_handler,
        )

        # 1) Publish inbound message through the routing proxy
        msg = _make_msg(channel="qq", chat_id="group_123", content="help me please")
        await proxy.publish_inbound(msg)

        # 2) Consume from bus (as AgentLoop would)
        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)

        # 3) Dispatch (as AgentLoop._dispatch would)
        handled = await dispatcher.dispatch(received)
        assert handled is True

        # 4) Verify handler was called with correct args
        agent_handler.assert_called_once()
        call_args = agent_handler.call_args
        assert call_args[0][0] == "agent-13"
        assert call_args[0][1].content == "help me please"
        assert call_args[0][1].channel == "qq"
        assert call_args[0][1].chat_id == "group_123"

        # 5) Verify outbound response
        outbound = await asyncio.wait_for(bus.consume_outbound(), timeout=2.0)
        assert outbound.channel == "qq"
        assert outbound.chat_id == "group_123"
        assert outbound.content == "I am agent-13, ready to help!"

    @pytest.mark.asyncio
    async def test_e2e_no_binding_falls_through(
        self, bus: MessageBus, proxy: _RoutingBusProxy,
    ) -> None:
        """No binding → dispatcher returns False → default agent path."""
        agent_handler = AsyncMock(return_value="default response")
        dispatcher = ChannelMessageDispatcher(
            bus, agent_handler=agent_handler,
        )

        msg = _make_msg(channel="telegram", chat_id="random_chat")
        await proxy.publish_inbound(msg)

        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        handled = await dispatcher.dispatch(received)
        assert handled is False  # No routing metadata → not handled by dispatcher
        agent_handler.assert_not_called()

    @pytest.mark.asyncio
    async def test_e2e_exact_match_takes_priority(
        self,
        service: ChannelBindingService,
        bus: MessageBus,
        proxy: _RoutingBusProxy,
    ) -> None:
        """Exact chat_id match should take priority over wildcard binding."""
        _create_binding(service, channel="qq", chat_id="*", target_id="default-agent")
        _create_binding(service, channel="qq", chat_id="vip_group", target_id="vip-agent")

        agent_handler = AsyncMock(return_value="VIP service")
        dispatcher = ChannelMessageDispatcher(bus, agent_handler=agent_handler)

        # Message to VIP group -> exact match
        msg = _make_msg(channel="qq", chat_id="vip_group", content="VIP request")
        await proxy.publish_inbound(msg)
        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        await dispatcher.dispatch(received)
        agent_handler.assert_called_once()
        assert agent_handler.call_args[0][0] == "vip-agent"

        # Message to other group -> wildcard fallback
        agent_handler.reset_mock()
        agent_handler.return_value = "Standard service"
        msg2 = _make_msg(channel="qq", chat_id="normal_group", content="Normal request")
        await proxy.publish_inbound(msg2)
        received2 = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        await dispatcher.dispatch(received2)
        agent_handler.assert_called_once()
        assert agent_handler.call_args[0][0] == "default-agent"

    @pytest.mark.asyncio
    async def test_e2e_multi_channel_isolation(
        self,
        service: ChannelBindingService,
        bus: MessageBus,
        proxy: _RoutingBusProxy,
    ) -> None:
        """Different channels have separate bindings and don't interfere."""
        _create_binding(service, channel="qq", chat_id="*", target_id="qq-agent")
        _create_binding(service, channel="telegram", chat_id="*", target_id="tg-agent")

        agent_handler = AsyncMock(return_value="response")
        dispatcher = ChannelMessageDispatcher(bus, agent_handler=agent_handler)

        # QQ message
        msg_qq = _make_msg(channel="qq", chat_id="qq_group")
        await proxy.publish_inbound(msg_qq)
        received_qq = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        await dispatcher.dispatch(received_qq)
        assert agent_handler.call_args[0][0] == "qq-agent"

        # Telegram message
        agent_handler.reset_mock()
        msg_tg = _make_msg(channel="telegram", chat_id="tg_group")
        await proxy.publish_inbound(msg_tg)
        received_tg = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)
        await dispatcher.dispatch(received_tg)
        assert agent_handler.call_args[0][0] == "tg-agent"

    @pytest.mark.asyncio
    async def test_e2e_handler_error_produces_error_outbound(
        self,
        service: ChannelBindingService,
        bus: MessageBus,
        proxy: _RoutingBusProxy,
    ) -> None:
        """Handler exception -> error message in outbound."""
        _create_binding(service, channel="qq", chat_id="*", target_id="buggy-agent")

        agent_handler = AsyncMock(side_effect=RuntimeError("LLM timeout"))
        dispatcher = ChannelMessageDispatcher(bus, agent_handler=agent_handler)

        msg = _make_msg(channel="qq", chat_id="some_group")
        await proxy.publish_inbound(msg)
        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)

        handled = await dispatcher.dispatch(received)
        assert handled is True

        outbound = await asyncio.wait_for(bus.consume_outbound(), timeout=2.0)
        assert "Error dispatching" in outbound.content
        assert outbound.channel == "qq"

    @pytest.mark.asyncio
    async def test_e2e_disabled_binding_not_routed(
        self,
        service: ChannelBindingService,
        bus: MessageBus,
        proxy: _RoutingBusProxy,
    ) -> None:
        """Disabled binding should not inject routing metadata."""
        _create_binding(service, channel="qq", chat_id="*", target_id="agent-13", enabled=False)

        agent_handler = AsyncMock(return_value="should not be called")
        dispatcher = ChannelMessageDispatcher(bus, agent_handler=agent_handler)

        msg = _make_msg(channel="qq", chat_id="group_123")
        await proxy.publish_inbound(msg)
        received = await asyncio.wait_for(bus.consume_inbound(), timeout=2.0)

        handled = await dispatcher.dispatch(received)
        assert handled is False
        agent_handler.assert_not_called()


# ===================================================================
# Part 5: Web API integration tests (live server)
# ===================================================================


class TestWebAPIChannelBindings:
    """Tests against the running Web UI API (requires server on port 6788)."""

    BASE_URL = "http://127.0.0.1:6788"

    @pytest.fixture(autouse=True)
    def _check_server(self) -> None:
        """Skip if the Web UI server is not running."""
        import urllib.request
        try:
            urllib.request.urlopen(f"{self.BASE_URL}/api/v1/health", timeout=2)
        except Exception:
            pytest.skip("Web UI server not running on port 6788")

    @pytest.fixture
    def session(self):
        """Login and return a requests-compatible session."""
        import urllib.request
        import http.cookiejar
        import json

        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

        login_data = json.dumps({"username": "admin", "password": "admin123"}).encode()
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/v1/auth/login",
            data=login_data,
            headers={"Content-Type": "application/json"},
        )
        opener.open(req)
        return opener

    def _api(self, session, method: str, path: str, data: dict | None = None) -> dict:
        import json
        import urllib.request

        url = f"{self.BASE_URL}{path}"
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        resp = session.open(req)
        return json.loads(resp.read().decode())

    def _ensure_agent(self, session, agent_id: str) -> None:
        try:
            self._api(session, "POST", "/api/v1/agents", {"name": agent_id, "systemPrompt": "Hello", "agentId": agent_id})
        except Exception as e:
            pass

    def test_create_and_resolve_binding(self, session) -> None:
        """Create a binding via API, resolve it, then delete it."""
        self._ensure_agent(session, "agent-13")
        # Create
        result = self._api(session, "POST", "/api/v1/channel-bindings", {
            "channelName": "test_e2e",
            "channelChatId": "*",
            "targetType": "agent",
            "targetId": "agent-13",
        })
        assert result["success"] is True
        binding_id = result["data"]["bindingId"]

        try:
            # Resolve (wildcard should match any chat_id)
            resolve_result = self._api(session, "POST", "/api/v1/channel-bindings/resolve", {
                "channelName": "test_e2e",
                "chatId": "any_chat_id_here",
            })
            assert resolve_result["success"] is True
            assert resolve_result["data"]["resolved"] is True
            assert resolve_result["data"]["binding"]["targetId"] == "agent-13"

            # Resolve (different channel should not match)
            resolve_miss = self._api(session, "POST", "/api/v1/channel-bindings/resolve", {
                "channelName": "nonexistent_channel",
                "chatId": "any_chat_id",
            })
            assert resolve_miss["data"]["resolved"] is False

            # List
            list_result = self._api(session, "GET", "/api/v1/channel-bindings")
            assert list_result["success"] is True
            ids = [b["bindingId"] for b in list_result["data"]]
            assert binding_id in ids

        finally:
            # Delete (cleanup)
            del_result = self._api(session, "DELETE", f"/api/v1/channel-bindings/{binding_id}")
            assert del_result["success"] is True

    def test_update_binding(self, session) -> None:
        """Create, update target, verify, then delete."""
        self._ensure_agent(session, "agent-13")
        self._ensure_agent(session, "agent-12")
        result = self._api(session, "POST", "/api/v1/channel-bindings", {
            "channelName": "test_update",
            "channelChatId": "*",
            "targetType": "agent",
            "targetId": "agent-13",
        })
        binding_id = result["data"]["bindingId"]

        try:
            updated = self._api(session, "PUT", f"/api/v1/channel-bindings/{binding_id}", {
                "targetId": "agent-12",
            })
            assert updated["data"]["targetId"] == "agent-12"

            fetched = self._api(session, "GET", f"/api/v1/channel-bindings/{binding_id}")
            assert fetched["data"]["targetId"] == "agent-12"
        finally:
            self._api(session, "DELETE", f"/api/v1/channel-bindings/{binding_id}")

    def test_exact_match_wins_over_wildcard_via_api(self, session) -> None:
        """Two bindings for same channel: exact chat_id should win in resolve."""
        self._ensure_agent(session, "agent-13")
        self._ensure_agent(session, "agent-12")
        wild = self._api(session, "POST", "/api/v1/channel-bindings", {
            "channelName": "test_priority",
            "channelChatId": "*",
            "targetType": "agent",
            "targetId": "agent-13",
        })
        exact = self._api(session, "POST", "/api/v1/channel-bindings", {
            "channelName": "test_priority",
            "channelChatId": "vip_chat_123",
            "targetType": "agent",
            "targetId": "agent-12",
        })

        try:
            # Exact match
            r1 = self._api(session, "POST", "/api/v1/channel-bindings/resolve", {
                "channelName": "test_priority",
                "chatId": "vip_chat_123",
            })
            assert r1["data"]["resolved"] is True
            assert r1["data"]["binding"]["targetId"] == "agent-12"

            # Wildcard fallback
            r2 = self._api(session, "POST", "/api/v1/channel-bindings/resolve", {
                "channelName": "test_priority",
                "chatId": "random_chat",
            })
            assert r2["data"]["resolved"] is True
            assert r2["data"]["binding"]["targetId"] == "agent-13"

        finally:
            self._api(session, "DELETE", f"/api/v1/channel-bindings/{wild['data']['bindingId']}")
            self._api(session, "DELETE", f"/api/v1/channel-bindings/{exact['data']['bindingId']}")
