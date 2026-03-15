"""Service layer for channel binding management."""

from __future__ import annotations

import secrets
from dataclasses import replace
from typing import Any, Callable

from nanobot.platform.channel_bindings.models import ChannelBinding, now_iso
from nanobot.platform.channel_bindings.store import ChannelBindingStore


class ChannelBindingNotFoundError(KeyError):
    """Raised when a channel binding does not exist."""


class ChannelBindingConflictError(RuntimeError):
    """Raised when a channel binding would conflict with an existing one."""


class ChannelBindingValidationError(ValueError):
    """Raised when a channel binding payload is invalid."""


_ALLOWED_TARGET_TYPES = {"agent", "team"}


class ChannelBindingService:
    """Instance-scoped CRUD service for channel bindings."""

    def __init__(
        self,
        store: ChannelBindingStore,
        *,
        instance_id: str,
        agent_lookup: Callable[[str], Any] | None = None,
        team_lookup: Callable[[str], Any] | None = None,
    ):
        self.store = store
        self.instance_id = instance_id
        self.agent_lookup = agent_lookup
        self.team_lookup = team_lookup

    @staticmethod
    def _normalize_text(value: Any, *, required: bool = False, field_name: str = "value") -> str:
        text = str(value or "").strip()
        if required and not text:
            raise ChannelBindingValidationError(f"{field_name} is required.")
        return text

    def _generate_binding_id(self) -> str:
        return f"cb-{secrets.token_hex(8)}"

    def _validate_target(self, target_type: str, target_id: str) -> None:
        if target_type not in _ALLOWED_TARGET_TYPES:
            allowed = ", ".join(sorted(_ALLOWED_TARGET_TYPES))
            raise ChannelBindingValidationError(f"targetType must be one of: {allowed}.")
        if target_type == "agent" and self.agent_lookup:
            try:
                self.agent_lookup(target_id)
            except Exception as exc:
                raise ChannelBindingValidationError(
                    f"Agent '{target_id}' does not exist."
                ) from exc
        elif target_type == "team" and self.team_lookup:
            try:
                self.team_lookup(target_id)
            except Exception as exc:
                raise ChannelBindingValidationError(
                    f"Team '{target_id}' does not exist."
                ) from exc

    def resolve_binding(
        self,
        channel_name: str,
        chat_id: str,
        *,
        tenant_id: str,
    ) -> ChannelBinding | None:
        return self.store.resolve(
            channel_name=channel_name,
            channel_chat_id=chat_id,
            tenant_id=tenant_id,
            instance_id=self.instance_id,
        )

    def list_bindings(self, *, tenant_id: str) -> list[dict[str, Any]]:
        return [
            b.to_dict()
            for b in self.store.list_all(tenant_id=tenant_id, instance_id=self.instance_id)
        ]

    def get_binding(self, binding_id: str) -> dict[str, Any]:
        binding = self.store.get(binding_id)
        if binding is None:
            raise ChannelBindingNotFoundError(binding_id)
        return binding.to_dict()

    def create_binding(self, payload: dict[str, Any], *, tenant_id: str) -> dict[str, Any]:
        channel_name = self._normalize_text(
            payload.get("channelName") or payload.get("channel_name"),
            required=True,
            field_name="channelName",
        )
        channel_chat_id = self._normalize_text(
            payload.get("channelChatId") or payload.get("channel_chat_id"),
            field_name="channelChatId",
        ) or "*"
        target_type = self._normalize_text(
            payload.get("targetType") or payload.get("target_type"),
            required=True,
            field_name="targetType",
        )
        target_id = self._normalize_text(
            payload.get("targetId") or payload.get("target_id"),
            required=True,
            field_name="targetId",
        )
        self._validate_target(target_type, target_id)

        priority = int(payload.get("priority") or 0)
        enabled_raw = payload.get("enabled")
        enabled = True if enabled_raw is None else bool(enabled_raw)
        metadata = payload.get("metadata") or {}

        now = now_iso()
        binding = ChannelBinding(
            binding_id=self._generate_binding_id(),
            tenant_id=tenant_id,
            instance_id=self.instance_id,
            channel_name=channel_name,
            channel_chat_id=channel_chat_id,
            target_type=target_type,
            target_id=target_id,
            priority=priority,
            enabled=enabled,
            metadata=metadata if isinstance(metadata, dict) else {},
            created_at=now,
            updated_at=now,
        )
        return self.store.create(binding).to_dict()

    def update_binding(self, binding_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.store.get(binding_id)
        if existing is None:
            raise ChannelBindingNotFoundError(binding_id)

        channel_name = existing.channel_name
        if "channelName" in payload or "channel_name" in payload:
            channel_name = self._normalize_text(
                payload.get("channelName") or payload.get("channel_name"),
                required=True,
                field_name="channelName",
            )

        channel_chat_id = existing.channel_chat_id
        if "channelChatId" in payload or "channel_chat_id" in payload:
            channel_chat_id = self._normalize_text(
                payload.get("channelChatId") or payload.get("channel_chat_id"),
                field_name="channelChatId",
            ) or "*"

        target_type = existing.target_type
        if "targetType" in payload or "target_type" in payload:
            target_type = self._normalize_text(
                payload.get("targetType") or payload.get("target_type"),
                required=True,
                field_name="targetType",
            )

        target_id = existing.target_id
        if "targetId" in payload or "target_id" in payload:
            target_id = self._normalize_text(
                payload.get("targetId") or payload.get("target_id"),
                required=True,
                field_name="targetId",
            )

        self._validate_target(target_type, target_id)

        updated = replace(
            existing,
            channel_name=channel_name,
            channel_chat_id=channel_chat_id,
            target_type=target_type,
            target_id=target_id,
            priority=int(payload["priority"]) if "priority" in payload else existing.priority,
            enabled=bool(payload["enabled"]) if "enabled" in payload else existing.enabled,
            metadata=payload["metadata"] if "metadata" in payload and isinstance(payload["metadata"], dict) else existing.metadata,
            updated_at=now_iso(),
        )
        result = self.store.update(updated)
        if result is None:
            raise ChannelBindingNotFoundError(binding_id)
        return result.to_dict()

    def delete_binding(self, binding_id: str) -> bool:
        if not self.store.delete(binding_id):
            raise ChannelBindingNotFoundError(binding_id)
        return True
