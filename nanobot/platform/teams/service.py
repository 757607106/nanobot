"""Service layer for reusable team definitions."""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Any, Callable

from nanobot.platform.teams.models import TeamDefinition, _migrate_workflow_mode, default_member_access_policy, now_iso
from nanobot.platform.teams.store import TeamDefinitionStore


class TeamDefinitionNotFoundError(KeyError):
    """Raised when a team definition does not exist."""


class TeamDefinitionConflictError(RuntimeError):
    """Raised when a team definition would conflict with an existing one."""


class TeamDefinitionValidationError(ValueError):
    """Raised when a team definition payload is invalid."""


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "team"


class TeamDefinitionService:
    """Instance-scoped CRUD service for team definitions."""

    _ALLOWED_WORKFLOW_MODES = {
        "supervisor",
    }

    def __init__(
        self,
        store: TeamDefinitionStore,
        *,
        instance_id: str,
        tenant_id: str = "default",
        agent_lookup: Callable[[str], Any] | None = None,
    ):
        self.store = store
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.agent_lookup = agent_lookup

    @staticmethod
    def _get_value(payload: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in payload:
                return payload[key]
        return None

    @staticmethod
    def _normalize_text(value: Any, *, required: bool = False, field_name: str = "value") -> str:
        text = str(value or "").strip()
        if required and not text:
            raise TeamDefinitionValidationError(f"{field_name} is required.")
        return text

    @staticmethod
    def _normalize_string_list(value: Any, *, field_name: str) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise TeamDefinitionValidationError(f"{field_name} must be a list of strings.")
        result: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            result.append(text)
        return result

    @staticmethod
    def _normalize_policy(value: Any) -> dict[str, Any]:
        if value is None:
            return default_member_access_policy()
        if not isinstance(value, dict):
            raise TeamDefinitionValidationError("memberAccessPolicy must be an object.")
        normalized: dict[str, Any] = {}
        for key, item in value.items():
            name = str(key or "").strip()
            if not name:
                continue
            normalized[name] = item
        return normalized or default_member_access_policy()

    def _ensure_unique_name(self, name: str, *, exclude_team_id: str | None = None) -> None:
        existing = self.store.get_by_name(name, tenant_id=self.tenant_id, instance_id=self.instance_id)
        if existing is None:
            return
        if exclude_team_id and existing.team_id == exclude_team_id:
            return
        raise TeamDefinitionConflictError(f"Team name '{name}' already exists.")

    def _next_team_id(self, name: str) -> str:
        base = _slugify(name)
        candidate = base
        counter = 2
        while self.store.get(candidate) is not None:
            candidate = f"{base}-{counter}"
            counter += 1
        return candidate

    def _next_copy_name(self, name: str) -> str:
        candidate = f"{name} Copy"
        counter = 2
        while self.store.get_by_name(candidate, tenant_id=self.tenant_id, instance_id=self.instance_id) is not None:
            candidate = f"{name} Copy {counter}"
            counter += 1
        return candidate

    def _validate_agent_reference(self, agent_id: str, *, field_name: str) -> str:
        resolved = self._normalize_text(agent_id, required=True, field_name=field_name)
        if self.agent_lookup is None:
            return resolved
        try:
            self.agent_lookup(resolved)
        except Exception as exc:  # pragma: no cover - defensive wrapper for injected lookup
            raise TeamDefinitionValidationError(f"{field_name} '{resolved}' does not exist.") from exc
        return resolved

    def _normalize_workflow_mode(self, value: Any) -> str:
        raw = self._normalize_text(value, field_name="workflowMode") or "supervisor"
        workflow_mode = _migrate_workflow_mode(raw)
        if workflow_mode not in self._ALLOWED_WORKFLOW_MODES:
            allowed = ", ".join(sorted(self._ALLOWED_WORKFLOW_MODES))
            raise TeamDefinitionValidationError(f"workflowMode must be one of: {allowed}.")
        return workflow_mode

    def _normalize_member_agent_ids(self, value: Any, *, leader_agent_id: str) -> list[str]:
        member_agent_ids = self._normalize_string_list(value, field_name="memberAgentIds")
        if leader_agent_id in member_agent_ids:
            raise TeamDefinitionValidationError("memberAgentIds must not include the leader agent.")
        return [
            self._validate_agent_reference(agent_id, field_name="memberAgentIds")
            for agent_id in member_agent_ids
        ]

    def _normalize_create_payload(self, payload: dict[str, Any]) -> TeamDefinition:
        name = self._normalize_text(self._get_value(payload, "name"), required=True, field_name="name")
        self._ensure_unique_name(name)
        leader_agent_id = self._validate_agent_reference(
            self._get_value(payload, "leaderAgentId", "leader_agent_id"),
            field_name="leaderAgentId",
        )
        member_agent_ids = self._normalize_member_agent_ids(
            self._get_value(payload, "memberAgentIds", "member_agent_ids"),
            leader_agent_id=leader_agent_id,
        )
        now = now_iso()
        return TeamDefinition(
            team_id=self._next_team_id(name),
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            name=name,
            leader_agent_id=leader_agent_id,
            description=self._normalize_text(self._get_value(payload, "description"), field_name="description"),
            member_agent_ids=member_agent_ids,
            workflow_mode=self._normalize_workflow_mode(
                self._get_value(payload, "workflowMode", "workflow_mode"),
            ),
            shared_knowledge_binding_ids=self._normalize_string_list(
                self._get_value(payload, "sharedKnowledgeBindingIds", "shared_knowledge_binding_ids"),
                field_name="sharedKnowledgeBindingIds",
            ),
            member_access_policy=self._normalize_policy(
                self._get_value(payload, "memberAccessPolicy", "member_access_policy"),
            ),
            tags=self._normalize_string_list(self._get_value(payload, "tags"), field_name="tags"),
            enabled=True if self._get_value(payload, "enabled") is None else bool(self._get_value(payload, "enabled")),
            created_at=now,
            updated_at=now,
        )

    def _apply_update(self, existing: TeamDefinition, payload: dict[str, Any]) -> TeamDefinition:
        updates = {
            "name": self._get_value(payload, "name"),
            "description": self._get_value(payload, "description"),
            "leader_agent_id": self._get_value(payload, "leaderAgentId", "leader_agent_id"),
            "member_agent_ids": self._get_value(payload, "memberAgentIds", "member_agent_ids"),
            "workflow_mode": self._get_value(payload, "workflowMode", "workflow_mode"),
            "shared_knowledge_binding_ids": self._get_value(
                payload,
                "sharedKnowledgeBindingIds",
                "shared_knowledge_binding_ids",
            ),
            "member_access_policy": self._get_value(payload, "memberAccessPolicy", "member_access_policy"),
            "tags": self._get_value(payload, "tags"),
            "enabled": self._get_value(payload, "enabled"),
        }

        name = existing.name
        if updates["name"] is not None:
            name = self._normalize_text(updates["name"], required=True, field_name="name")
            self._ensure_unique_name(name, exclude_team_id=existing.team_id)

        leader_agent_id = existing.leader_agent_id
        if updates["leader_agent_id"] is not None:
            leader_agent_id = self._validate_agent_reference(
                updates["leader_agent_id"],
                field_name="leaderAgentId",
            )

        member_agent_ids = (
            existing.member_agent_ids
            if updates["member_agent_ids"] is None
            else self._normalize_member_agent_ids(
                updates["member_agent_ids"],
                leader_agent_id=leader_agent_id,
            )
        )

        return replace(
            existing,
            name=name,
            description=existing.description
            if updates["description"] is None
            else self._normalize_text(updates["description"], field_name="description"),
            leader_agent_id=leader_agent_id,
            member_agent_ids=member_agent_ids,
            workflow_mode=existing.workflow_mode
            if updates["workflow_mode"] is None
            else self._normalize_workflow_mode(updates["workflow_mode"]),
            shared_knowledge_binding_ids=existing.shared_knowledge_binding_ids
            if updates["shared_knowledge_binding_ids"] is None
            else self._normalize_string_list(
                updates["shared_knowledge_binding_ids"],
                field_name="sharedKnowledgeBindingIds",
            ),
            member_access_policy=existing.member_access_policy
            if updates["member_access_policy"] is None
            else self._normalize_policy(updates["member_access_policy"]),
            tags=existing.tags
            if updates["tags"] is None
            else self._normalize_string_list(updates["tags"], field_name="tags"),
            enabled=existing.enabled if updates["enabled"] is None else bool(updates["enabled"]),
            updated_at=now_iso(),
        )

    def require_team(self, team_id: str) -> TeamDefinition:
        team = self.store.get(team_id)
        if team is None:
            raise TeamDefinitionNotFoundError(team_id)
        return team

    def list_teams(self, *, enabled: bool | None = None) -> list[dict[str, Any]]:
        return [
            team.to_dict()
            for team in self.store.list_all(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                enabled=enabled,
            )
        ]

    def get_team(self, team_id: str) -> dict[str, Any]:
        return self.require_team(team_id).to_dict()

    def create_team(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.store.create(self._normalize_create_payload(payload)).to_dict()

    def update_team(self, team_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        updated = self.store.update(self._apply_update(self.require_team(team_id), payload))
        if updated is None:
            raise TeamDefinitionNotFoundError(team_id)
        return updated.to_dict()

    def delete_team(self, team_id: str) -> bool:
        if not self.store.delete(team_id):
            raise TeamDefinitionNotFoundError(team_id)
        return True

    def copy_team(self, team_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload or {}
        source = self.require_team(team_id)
        name = self._normalize_text(payload.get("name"), field_name="name") or self._next_copy_name(source.name)
        self._ensure_unique_name(name)
        now = now_iso()
        clone = replace(
            source,
            team_id=self._next_team_id(name),
            name=name,
            created_at=now,
            updated_at=now,
        )
        return self.store.create(clone).to_dict()

    def set_enabled(self, team_id: str, enabled: bool) -> dict[str, Any]:
        team = replace(self.require_team(team_id), enabled=enabled, updated_at=now_iso())
        updated = self.store.update(team)
        if updated is None:
            raise TeamDefinitionNotFoundError(team_id)
        return updated.to_dict()
