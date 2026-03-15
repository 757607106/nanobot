"""Service layer for reusable team definitions."""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Any, Callable

from nanobot.platform.teams.models import (
    SupervisorConfig,
    TeamDefinition,
    default_member_access_policy,
    now_iso,
)
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

    _ALLOWED_RESPONSE_MODES = {"synthesize", "last_member", "custom"}

    def __init__(
        self,
        store: TeamDefinitionStore,
        *,
        instance_id: str,
        agent_lookup: Callable[[str], Any] | None = None,
    ):
        self.store = store
        self.instance_id = instance_id
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

    def _normalize_supervisor_config(self, value: Any) -> SupervisorConfig:
        if value is None:
            return SupervisorConfig()
        if not isinstance(value, dict):
            raise TeamDefinitionValidationError("supervisorConfig must be an object.")
        recursion_limit = value.get("recursionLimit") or value.get("recursion_limit") or 25
        try:
            recursion_limit = int(recursion_limit)
        except (TypeError, ValueError) as exc:
            raise TeamDefinitionValidationError("recursionLimit must be an integer.") from exc
        if recursion_limit < 5 or recursion_limit > 100:
            raise TeamDefinitionValidationError("recursionLimit must be between 5 and 100.")

        max_calls = value.get("maxMemberCallsPerRun") or value.get("max_member_calls_per_run") or 20
        try:
            max_calls = int(max_calls)
        except (TypeError, ValueError) as exc:
            raise TeamDefinitionValidationError("maxMemberCallsPerRun must be an integer.") from exc
        if max_calls < 1 or max_calls > 50:
            raise TeamDefinitionValidationError("maxMemberCallsPerRun must be between 1 and 50.")

        response_mode = str(
            value.get("responseMode") or value.get("response_mode") or "synthesize"
        ).strip()
        if response_mode not in self._ALLOWED_RESPONSE_MODES:
            allowed = ", ".join(sorted(self._ALLOWED_RESPONSE_MODES))
            raise TeamDefinitionValidationError(f"responseMode must be one of: {allowed}.")

        supervisor_prompt_template = str(
            value.get("supervisorPromptTemplate") or value.get("supervisor_prompt_template") or ""
        ).strip()

        return SupervisorConfig(
            recursion_limit=recursion_limit,
            max_member_calls_per_run=max_calls,
            supervisor_prompt_template=supervisor_prompt_template,
            response_mode=response_mode,
        )

    def _ensure_unique_name(
        self, name: str, *, tenant_id: str, exclude_team_id: str | None = None,
    ) -> None:
        existing = self.store.get_by_name(name, tenant_id=tenant_id, instance_id=self.instance_id)
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

    def _next_copy_name(self, name: str, *, tenant_id: str) -> str:
        candidate = f"{name} Copy"
        counter = 2
        while self.store.get_by_name(candidate, tenant_id=tenant_id, instance_id=self.instance_id) is not None:
            candidate = f"{name} Copy {counter}"
            counter += 1
        return candidate

    def _validate_agent_reference(self, agent_id: str, *, field_name: str) -> str:
        resolved = self._normalize_text(agent_id, required=True, field_name=field_name)
        if self.agent_lookup is None:
            return resolved
        try:
            self.agent_lookup(resolved)
        except Exception as exc:
            raise TeamDefinitionValidationError(f"{field_name} '{resolved}' does not exist.") from exc
        return resolved

    def _normalize_member_agent_ids(self, value: Any, *, supervisor_agent_id: str) -> list[str]:
        member_agent_ids = self._normalize_string_list(value, field_name="memberAgentIds")
        if supervisor_agent_id in member_agent_ids:
            raise TeamDefinitionValidationError("memberAgentIds must not include the supervisor agent.")
        return [
            self._validate_agent_reference(agent_id, field_name="memberAgentIds")
            for agent_id in member_agent_ids
        ]

    def _normalize_create_payload(self, payload: dict[str, Any], *, tenant_id: str) -> TeamDefinition:
        name = self._normalize_text(self._get_value(payload, "name"), required=True, field_name="name")
        self._ensure_unique_name(name, tenant_id=tenant_id)
        supervisor_agent_id = self._validate_agent_reference(
            self._get_value(payload, "supervisorAgentId", "supervisor_agent_id"),
            field_name="supervisorAgentId",
        )
        member_agent_ids = self._normalize_member_agent_ids(
            self._get_value(payload, "memberAgentIds", "member_agent_ids"),
            supervisor_agent_id=supervisor_agent_id,
        )
        supervisor_config = self._normalize_supervisor_config(
            self._get_value(payload, "supervisorConfig", "supervisor_config"),
        )
        team_thread_raw = self._get_value(payload, "teamThreadEnabled", "team_thread_enabled")
        team_thread_enabled = True if team_thread_raw is None else bool(team_thread_raw)

        now = now_iso()
        return TeamDefinition(
            team_id=self._next_team_id(name),
            tenant_id=tenant_id,
            instance_id=self.instance_id,
            name=name,
            supervisor_agent_id=supervisor_agent_id,
            description=self._normalize_text(self._get_value(payload, "description"), field_name="description"),
            member_agent_ids=member_agent_ids,
            supervisor_config=supervisor_config,
            shared_knowledge_binding_ids=self._normalize_string_list(
                self._get_value(payload, "sharedKnowledgeBindingIds", "shared_knowledge_binding_ids"),
                field_name="sharedKnowledgeBindingIds",
            ),
            member_access_policy=self._normalize_policy(
                self._get_value(payload, "memberAccessPolicy", "member_access_policy"),
            ),
            tags=self._normalize_string_list(self._get_value(payload, "tags"), field_name="tags"),
            enabled=True if self._get_value(payload, "enabled") is None else bool(self._get_value(payload, "enabled")),
            team_thread_enabled=team_thread_enabled,
            created_at=now,
            updated_at=now,
        )

    def _apply_update(self, existing: TeamDefinition, payload: dict[str, Any]) -> TeamDefinition:
        updates = {
            "name": self._get_value(payload, "name"),
            "description": self._get_value(payload, "description"),
            "supervisor_agent_id": self._get_value(payload, "supervisorAgentId", "supervisor_agent_id"),
            "member_agent_ids": self._get_value(payload, "memberAgentIds", "member_agent_ids"),
            "supervisor_config": self._get_value(payload, "supervisorConfig", "supervisor_config"),
            "shared_knowledge_binding_ids": self._get_value(
                payload,
                "sharedKnowledgeBindingIds",
                "shared_knowledge_binding_ids",
            ),
            "member_access_policy": self._get_value(payload, "memberAccessPolicy", "member_access_policy"),
            "tags": self._get_value(payload, "tags"),
            "enabled": self._get_value(payload, "enabled"),
            "team_thread_enabled": self._get_value(payload, "teamThreadEnabled", "team_thread_enabled"),
        }

        name = existing.name
        if updates["name"] is not None:
            name = self._normalize_text(updates["name"], required=True, field_name="name")
            self._ensure_unique_name(name, tenant_id=existing.tenant_id, exclude_team_id=existing.team_id)

        supervisor_agent_id = existing.supervisor_agent_id
        if updates["supervisor_agent_id"] is not None:
            supervisor_agent_id = self._validate_agent_reference(
                updates["supervisor_agent_id"],
                field_name="supervisorAgentId",
            )

        member_agent_ids = (
            existing.member_agent_ids
            if updates["member_agent_ids"] is None
            else self._normalize_member_agent_ids(
                updates["member_agent_ids"],
                supervisor_agent_id=supervisor_agent_id,
            )
        )

        supervisor_config = (
            existing.supervisor_config
            if updates["supervisor_config"] is None
            else self._normalize_supervisor_config(updates["supervisor_config"])
        )

        team_thread_enabled = (
            existing.team_thread_enabled
            if updates["team_thread_enabled"] is None
            else bool(updates["team_thread_enabled"])
        )

        return replace(
            existing,
            name=name,
            description=existing.description
            if updates["description"] is None
            else self._normalize_text(updates["description"], field_name="description"),
            supervisor_agent_id=supervisor_agent_id,
            member_agent_ids=member_agent_ids,
            supervisor_config=supervisor_config,
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
            team_thread_enabled=team_thread_enabled,
            updated_at=now_iso(),
        )

    def require_team(self, team_id: str) -> TeamDefinition:
        team = self.store.get(team_id)
        if team is None:
            raise TeamDefinitionNotFoundError(team_id)
        return team

    def list_teams(self, *, tenant_id: str, enabled: bool | None = None) -> list[dict[str, Any]]:
        return [
            team.to_dict()
            for team in self.store.list_all(
                tenant_id=tenant_id,
                instance_id=self.instance_id,
                enabled=enabled,
            )
        ]

    def get_team(self, team_id: str) -> dict[str, Any]:
        return self.require_team(team_id).to_dict()

    def create_team(self, payload: dict[str, Any], *, tenant_id: str) -> dict[str, Any]:
        return self.store.create(self._normalize_create_payload(payload, tenant_id=tenant_id)).to_dict()

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
        name = (
            self._normalize_text(payload.get("name"), field_name="name")
            or self._next_copy_name(source.name, tenant_id=source.tenant_id)
        )
        self._ensure_unique_name(name, tenant_id=source.tenant_id)
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
