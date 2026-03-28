from __future__ import annotations

from nanobot.platform.channel_audit import (
    ChannelAuditService,
    ChannelAuditStatus,
    ChannelAuditStore,
)


def test_channel_audit_service_records_and_updates_outcomes(tmp_path) -> None:
    service = ChannelAuditService(
        ChannelAuditStore(tmp_path / "channel-audit.db"),
        instance_id="instance-test",
    )

    created = service.record_inbound(
        tenant_id="tenant-a",
        channel_name="telegram",
        chat_id="chat-42",
        session_key="telegram:chat-42",
        sender_id="user-1",
        message_preview="Need help with an order status update",
        resolved=True,
        resolution_kind="exact",
        binding_id="cb-42",
        target_type="agent",
        target_id="agent-42",
    )

    assert created["status"] == "resolved"
    assert created["resolutionKind"] == "exact"

    updated = service.record_dispatch_outcome(
        created["auditId"],
        tenant_id="tenant-a",
        status=ChannelAuditStatus.DISPATCHED,
        response_preview="Order status checked.",
        run_id="run-42",
        artifact_path="tenant-a/instance-test/run-42.md",
    )

    assert updated["status"] == "dispatched"
    assert updated["dispatchRunId"] == "run-42"
    assert updated["artifactPath"] == "tenant-a/instance-test/run-42.md"
    assert updated["responsePreview"] == "Order status checked."


def test_channel_audit_service_with_tenant_hides_other_tenants(tmp_path) -> None:
    service = ChannelAuditService(
        ChannelAuditStore(tmp_path / "channel-audit.db"),
        instance_id="instance-test",
    )

    service.record_inbound(
        tenant_id="tenant-a",
        channel_name="telegram",
        chat_id="chat-a",
        session_key="telegram:chat-a",
        sender_id="user-a",
        message_preview="Tenant A message",
        resolved=False,
    )
    service.record_inbound(
        tenant_id="tenant-b",
        channel_name="telegram",
        chat_id="chat-b",
        session_key="telegram:chat-b",
        sender_id="user-b",
        message_preview="Tenant B message",
        resolved=False,
    )

    tenant_a = service.with_tenant("tenant-a").list_entries()
    tenant_b = service.with_tenant("tenant-b").list_entries()

    assert len(tenant_a) == 1
    assert tenant_a[0]["chatId"] == "chat-a"
    assert len(tenant_b) == 1
    assert tenant_b[0]["chatId"] == "chat-b"


def test_channel_audit_service_supports_query_filters(tmp_path) -> None:
    service = ChannelAuditService(
        ChannelAuditStore(tmp_path / "channel-audit.db"),
        instance_id="instance-test",
    )

    service.record_inbound(
        tenant_id="tenant-a",
        channel_name="telegram",
        chat_id="chat-1",
        session_key="telegram:chat-1",
        sender_id="user-1",
        message_preview="payment issue",
        resolved=False,
    )
    service.record_inbound(
        tenant_id="tenant-a",
        channel_name="discord",
        chat_id="chat-2",
        session_key="discord:chat-2",
        sender_id="user-2",
        message_preview="shipping issue",
        resolved=True,
        target_type="agent",
        target_id="support-agent",
    )

    filtered = service.list_entries(
        tenant_id="tenant-a",
        channel_name="discord",
        query="support",
    )

    assert len(filtered) == 1
    assert filtered[0]["channelName"] == "discord"
    assert filtered[0]["targetId"] == "support-agent"
