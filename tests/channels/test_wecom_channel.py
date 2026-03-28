from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.wecom import WecomChannel, WecomConfig


@pytest.mark.asyncio
async def test_wecom_text_message_routes_to_bus_and_stores_frame() -> None:
    bus = MessageBus()
    channel = WecomChannel(
        WecomConfig(bot_id="bot", secret="secret", allow_from=["user1"]),
        bus,
    )
    frame = {
        "body": {
            "msgid": "msg1",
            "from": {"userid": "user1"},
            "chatid": "chat1",
            "chattype": "single",
            "text": {"content": "hello from wecom"},
        }
    }

    await channel._process_message(frame, "text")

    msg = await bus.consume_inbound()
    assert msg.sender_id == "user1"
    assert msg.chat_id == "chat1"
    assert msg.content == "hello from wecom"
    assert msg.metadata["message_id"] == "msg1"
    assert channel._chat_frames["chat1"] == frame


@pytest.mark.asyncio
async def test_wecom_send_uses_reply_stream_with_stored_frame() -> None:
    channel = WecomChannel(
        WecomConfig(bot_id="bot", secret="secret", allow_from=["*"]),
        MessageBus(),
    )
    channel._client = type("FakeClient", (), {"reply_stream": AsyncMock()})()
    channel._generate_req_id = lambda prefix: f"{prefix}-1"
    channel._chat_frames["chat1"] = {"body": {"chatid": "chat1"}}

    await channel.send(
        OutboundMessage(
            channel="wecom",
            chat_id="chat1",
            content="reply content",
        )
    )

    channel._client.reply_stream.assert_awaited_once_with(
        {"body": {"chatid": "chat1"}},
        "stream-1",
        "reply content",
        finish=True,
    )
