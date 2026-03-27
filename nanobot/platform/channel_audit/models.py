"""Models for channel audit events."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


def now_iso() -> str:
    """Return an RFC 3339-like UTC timestamp."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class ChannelAuditStatus(StrEnum):
    """Lifecycle states for one channel audit entry."""

    RESOLVED = "resolved"
    UNMATCHED = "unmatched"
    DISPATCHED = "dispatched"
    NO_HANDLER = "no_handler"
    DISPATCH_ERROR = "dispatch_error"


@dataclass(slots=True)
class ChannelAuditEntry:
    """Persisted inbound routing audit record."""

    audit_id: str
    tenant_id: str
    instance_id: str
    channel_name: str
    chat_id: str
    session_key: str
    sender_id: str
    message_preview: str
    status: ChannelAuditStatus
    resolved: bool
    resolution_kind: str = "none"
    binding_id: str | None = None
    target_type: str | None = None
    target_id: str | None = None
    message_id: str | None = None
    dispatch_run_id: str | None = None
    artifact_path: str | None = None
    response_preview: str | None = None
    error_message: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["status"] = self.status.value
        payload["auditId"] = payload.pop("audit_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["channelName"] = payload.pop("channel_name")
        payload["chatId"] = payload.pop("chat_id")
        payload["sessionKey"] = payload.pop("session_key")
        payload["senderId"] = payload.pop("sender_id")
        payload["messagePreview"] = payload.pop("message_preview")
        payload["resolutionKind"] = payload.pop("resolution_kind")
        payload["bindingId"] = payload.pop("binding_id")
        payload["targetType"] = payload.pop("target_type")
        payload["targetId"] = payload.pop("target_id")
        payload["messageId"] = payload.pop("message_id")
        payload["dispatchRunId"] = payload.pop("dispatch_run_id")
        payload["artifactPath"] = payload.pop("artifact_path")
        payload["responsePreview"] = payload.pop("response_preview")
        payload["errorMessage"] = payload.pop("error_message")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "ChannelAuditEntry":
        return cls(
            audit_id=str(record.get("audit_id") or ""),
            tenant_id=str(record.get("tenant_id") or "default"),
            instance_id=str(record.get("instance_id") or ""),
            channel_name=str(record.get("channel_name") or ""),
            chat_id=str(record.get("chat_id") or ""),
            session_key=str(record.get("session_key") or ""),
            sender_id=str(record.get("sender_id") or ""),
            message_preview=str(record.get("message_preview") or ""),
            status=ChannelAuditStatus(str(record.get("status") or ChannelAuditStatus.UNMATCHED.value)),
            resolved=bool(record.get("resolved")),
            resolution_kind=str(record.get("resolution_kind") or "none"),
            binding_id=str(record.get("binding_id") or "") or None,
            target_type=str(record.get("target_type") or "") or None,
            target_id=str(record.get("target_id") or "") or None,
            message_id=str(record.get("message_id") or "") or None,
            dispatch_run_id=str(record.get("dispatch_run_id") or "") or None,
            artifact_path=str(record.get("artifact_path") or "") or None,
            response_preview=str(record.get("response_preview") or "") or None,
            error_message=str(record.get("error_message") or "") or None,
            metadata=record.get("metadata_json") or record.get("metadata") or {},
            created_at=str(record.get("created_at") or now_iso()),
            updated_at=str(record.get("updated_at") or record.get("created_at") or now_iso()),
        )
