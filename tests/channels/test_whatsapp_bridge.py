from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.whatsapp import WhatsAppChannel, WhatsAppConfig


@pytest.mark.asyncio
async def test_whatsapp_bridge_message_routes_media_and_sender_ids() -> None:
    bus = MessageBus()
    channel = WhatsAppChannel(
        WhatsAppConfig(bridge_url="ws://localhost:3001", allow_from=["123456"]),
        bus,
    )

    await channel._handle_bridge_message(
        json.dumps(
            {
                "type": "message",
                "id": "msg1",
                "sender": "123456@s.whatsapp.net",
                "content": "hello",
                "media": ["/tmp/photo.jpg"],
                "timestamp": 123,
                "isGroup": False,
            }
        )
    )

    msg = await bus.consume_inbound()
    assert msg.sender_id == "123456"
    assert msg.chat_id == "123456@s.whatsapp.net"
    assert msg.media == ["/tmp/photo.jpg"]
    assert "[image: /tmp/photo.jpg]" in msg.content
    assert msg.metadata["message_id"] == "msg1"


@pytest.mark.asyncio
async def test_whatsapp_send_pushes_json_to_bridge_when_connected() -> None:
    channel = WhatsAppChannel(
        WhatsAppConfig(bridge_url="ws://localhost:3001", allow_from=["*"]),
        MessageBus(),
    )
    channel._connected = True
    channel._ws = type("FakeWs", (), {"send": AsyncMock()})()

    await channel.send(
        OutboundMessage(
            channel="whatsapp",
            chat_id="123456@s.whatsapp.net",
            content="reply body",
        )
    )

    channel._ws.send.assert_awaited_once()
    payload = json.loads(channel._ws.send.await_args.args[0])
    assert payload == {
        "type": "send",
        "to": "123456@s.whatsapp.net",
        "text": "reply body",
    }
