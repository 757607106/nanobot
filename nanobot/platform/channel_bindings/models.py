"""Channel binding models for routing channel messages to agents or teams."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class ChannelBinding:
    """Maps a channel + chat_id to a specific agent or team."""

    binding_id: str
    tenant_id: str
    instance_id: str
    channel_name: str
    channel_chat_id: str
    target_type: str
    target_id: str
    priority: int = 0
    enabled: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        return json.dumps(self.metadata, ensure_ascii=False)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> ChannelBinding:
        metadata_raw = record.get("metadata_json") or "{}"
        metadata = json.loads(metadata_raw) if isinstance(metadata_raw, str) else metadata_raw
        return cls(
            binding_id=record["binding_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            channel_name=record["channel_name"],
            channel_chat_id=record.get("channel_chat_id") or "*",
            target_type=record["target_type"],
            target_id=record["target_id"],
            priority=int(record.get("priority") or 0),
            enabled=bool(record.get("enabled", True)),
            metadata=metadata,
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "bindingId": self.binding_id,
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "channelName": self.channel_name,
            "channelChatId": self.channel_chat_id,
            "targetType": self.target_type,
            "targetId": self.target_id,
            "priority": self.priority,
            "enabled": self.enabled,
            "metadata": self.metadata,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }
