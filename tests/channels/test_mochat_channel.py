from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.mochat import MochatChannel, MochatConfig, resolve_mochat_target


def test_resolve_mochat_target_distinguishes_panel_and_session_ids() -> None:
    assert resolve_mochat_target("panel:panel123").is_panel is True
    assert resolve_mochat_target("panel:panel123").id == "panel123"
    assert resolve_mochat_target("session_123").is_panel is False
    assert resolve_mochat_target("session_123").id == "session_123"


@pytest.mark.asyncio
async def test_mochat_send_routes_panel_messages_to_panel_api() -> None:
    channel = MochatChannel(
        MochatConfig(claw_token="token", allow_from=["*"]),
        MessageBus(),
    )
    channel._api_send = AsyncMock(return_value={})  # type: ignore[method-assign]

    await channel.send(
        OutboundMessage(
            channel="mochat",
            chat_id="panel:panel123",
            content="hello panel",
            reply_to="msg-parent",
            metadata={"group_id": "group1"},
        )
    )

    channel._api_send.assert_awaited_once_with(
        "/api/claw/groups/panels/send",
        "panelId",
        "panel123",
        "hello panel",
        "msg-parent",
        "group1",
    )


@pytest.mark.asyncio
async def test_mochat_send_routes_session_messages_to_session_api() -> None:
    channel = MochatChannel(
        MochatConfig(claw_token="token", allow_from=["*"]),
        MessageBus(),
    )
    channel._api_send = AsyncMock(return_value={})  # type: ignore[method-assign]

    await channel.send(
        OutboundMessage(
            channel="mochat",
            chat_id="session_123",
            content="hello session",
        )
    )

    channel._api_send.assert_awaited_once_with(
        "/api/claw/sessions/send",
        "sessionId",
        "session_123",
        "hello session",
        None,
    )
