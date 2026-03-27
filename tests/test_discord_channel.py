from __future__ import annotations

from pathlib import Path

import pytest

from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.discord import DiscordChannel, DiscordConfig


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, content: bytes = b"", json_body: dict | None = None) -> None:
        self.status_code = status_code
        self.content = content
        self._json_body = json_body or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict:
        return self._json_body


class _FakeHttpClient:
    def __init__(self) -> None:
        self.get_calls: list[str] = []
        self.post_calls: list[dict[str, object]] = []

    async def get(self, url: str) -> _FakeResponse:
        self.get_calls.append(url)
        return _FakeResponse(content=b"discord-bytes")

    async def post(self, url: str, headers=None, json=None, files=None, data=None) -> _FakeResponse:
        self.post_calls.append(
            {
                "url": url,
                "headers": headers,
                "json": json,
                "files": files,
                "data": data,
            }
        )
        return _FakeResponse()


@pytest.mark.asyncio
async def test_discord_group_message_downloads_attachments_and_routes_to_bus(tmp_path, monkeypatch) -> None:
    bus = MessageBus()
    channel = DiscordChannel(
        DiscordConfig(token="token", allow_from=["user1"], group_policy="mention"),
        bus,
    )
    channel._http = _FakeHttpClient()
    channel._bot_user_id = "bot1"
    channel._running = True

    monkeypatch.setattr("nanobot.channels.discord.get_media_dir", lambda _name=None: tmp_path)

    async def _noop_typing(_channel_id: str) -> None:
        return None

    channel._start_typing = _noop_typing  # type: ignore[method-assign]

    await channel._handle_message_create(
        {
            "id": "msg1",
            "channel_id": "chan1",
            "guild_id": "guild1",
            "content": "hello <@bot1>",
            "author": {"id": "user1", "bot": False},
            "mentions": [{"id": "bot1"}],
            "attachments": [
                {
                    "id": "att1",
                    "url": "https://cdn.discordapp.com/file.bin",
                    "filename": "report.txt",
                    "size": 8,
                }
            ],
        }
    )

    msg = await bus.consume_inbound()
    assert msg.sender_id == "user1"
    assert msg.chat_id == "chan1"
    assert msg.metadata["guild_id"] == "guild1"
    assert msg.metadata["message_id"] == "msg1"
    assert len(msg.media) == 1
    saved = Path(msg.media[0])
    assert saved.exists()
    assert saved.read_bytes() == b"discord-bytes"
    assert "[attachment:" in msg.content


@pytest.mark.asyncio
async def test_discord_send_includes_reply_reference_for_text_messages() -> None:
    channel = DiscordChannel(
        DiscordConfig(token="token", allow_from=["*"]),
        MessageBus(),
    )
    channel._http = _FakeHttpClient()

    await channel.send(
        OutboundMessage(
            channel="discord",
            chat_id="chan1",
            content="reply body",
            reply_to="msg-parent",
        )
    )

    assert len(channel._http.post_calls) == 1
    call = channel._http.post_calls[0]
    assert call["url"].endswith("/channels/chan1/messages")
    assert call["json"] == {
        "content": "reply body",
        "message_reference": {"message_id": "msg-parent"},
        "allowed_mentions": {"replied_user": False},
    }
