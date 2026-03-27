"""Service layer for channel audit registry."""

from __future__ import annotations

import secrets
from dataclasses import replace
from typing import Any

from nanobot.platform.channel_audit.models import (
    ChannelAuditEntry,
    ChannelAuditStatus,
    now_iso,
)
from nanobot.platform.channel_audit.store import ChannelAuditStore
from nanobot.platform.tenant_scope import clone_service_with_overrides, normalize_tenant_id


class ChannelAuditNotFoundError(KeyError):
    """Raised when a channel audit entry does not exist."""


class ChannelAuditService:
    """Instance-scoped channel audit registry."""

    def __init__(
        self,
        store: ChannelAuditStore,
        *,
        instance_id: str,
        tenant_id: str = "default",
    ):
        self.store = store
        self.instance_id = instance_id
        self.tenant_id = normalize_tenant_id(tenant_id)

    def with_tenant(self, tenant_id: str | None) -> "ChannelAuditService":
        resolved_tenant = normalize_tenant_id(tenant_id, default=self.tenant_id)
        return clone_service_with_overrides(self, tenant_id=resolved_tenant)

    @staticmethod
    def _preview(value: Any, *, limit: int = 280) -> str:
        compact = " ".join(str(value or "").split())
        if len(compact) <= limit:
            return compact
        return f"{compact[: max(limit - 1, 0)].rstrip()}…"

    def _generate_audit_id(self) -> str:
        return f"ca-{secrets.token_hex(8)}"

    def record_inbound(
        self,
        *,
        channel_name: str,
        chat_id: str,
        session_key: str,
        sender_id: str,
        message_preview: str,
        resolved: bool,
        resolution_kind: str = "none",
        binding_id: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        message_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> dict[str, Any]:
        resolved_tenant = normalize_tenant_id(tenant_id, default=self.tenant_id)
        resolved_instance = str(instance_id or self.instance_id).strip() or self.instance_id
        status = ChannelAuditStatus.RESOLVED if resolved else ChannelAuditStatus.UNMATCHED
        now = now_iso()
        entry = ChannelAuditEntry(
            audit_id=self._generate_audit_id(),
            tenant_id=resolved_tenant,
            instance_id=resolved_instance,
            channel_name=str(channel_name or "").strip(),
            chat_id=str(chat_id or "").strip(),
            session_key=str(session_key or "").strip(),
            sender_id=str(sender_id or "").strip(),
            message_preview=self._preview(message_preview),
            status=status,
            resolved=resolved,
            resolution_kind=str(resolution_kind or "none").strip() or "none",
            binding_id=str(binding_id or "").strip() or None,
            target_type=str(target_type or "").strip() or None,
            target_id=str(target_id or "").strip() or None,
            message_id=str(message_id or "").strip() or None,
            metadata=dict(metadata or {}),
            created_at=now,
            updated_at=now,
        )
        return self.store.create(entry).to_dict()

    def get_entry(self, audit_id: str, *, tenant_id: str | None = None) -> dict[str, Any]:
        resolved_tenant = normalize_tenant_id(tenant_id, default=self.tenant_id)
        entry = self.store.get(audit_id, tenant_id=resolved_tenant, instance_id=self.instance_id)
        if entry is None:
            raise ChannelAuditNotFoundError(audit_id)
        return entry.to_dict()

    def record_dispatch_outcome(
        self,
        audit_id: str,
        *,
        status: ChannelAuditStatus | str,
        response_preview: str | None = None,
        run_id: str | None = None,
        artifact_path: str | None = None,
        error_message: str | None = None,
        metadata: dict[str, Any] | None = None,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        resolved_tenant = normalize_tenant_id(tenant_id, default=self.tenant_id)
        existing = self.store.get(audit_id, tenant_id=resolved_tenant, instance_id=self.instance_id)
        if existing is None:
            raise ChannelAuditNotFoundError(audit_id)
        updated_metadata = dict(existing.metadata or {})
        if metadata:
            updated_metadata.update(metadata)
        updated = replace(
            existing,
            status=ChannelAuditStatus(str(status)),
            response_preview=self._preview(response_preview) if response_preview else existing.response_preview,
            dispatch_run_id=str(run_id or "").strip() or existing.dispatch_run_id,
            artifact_path=str(artifact_path or "").strip() or existing.artifact_path,
            error_message=self._preview(error_message, limit=400) if error_message else existing.error_message,
            metadata=updated_metadata,
            updated_at=now_iso(),
        )
        persisted = self.store.update(updated, tenant_id=resolved_tenant, instance_id=self.instance_id)
        if persisted is None:
            raise ChannelAuditNotFoundError(audit_id)
        return persisted.to_dict()

    def list_entries(
        self,
        *,
        tenant_id: str | None = None,
        limit: int = 100,
        channel_name: str | None = None,
        chat_id: str | None = None,
        status: str | None = None,
        query: str | None = None,
    ) -> list[dict[str, Any]]:
        resolved_tenant = normalize_tenant_id(tenant_id, default=self.tenant_id)
        return [
            entry.to_dict()
            for entry in self.store.list_entries(
                tenant_id=resolved_tenant,
                instance_id=self.instance_id,
                limit=limit,
                channel_name=channel_name,
                chat_id=chat_id,
                status=status,
                query=query,
            )
        ]
