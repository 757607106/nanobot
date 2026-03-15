"""Service layer for reusable agent definitions."""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Any

from nanobot.platform.agents.models import AgentDefinition, now_iso
from nanobot.platform.agents.store import AgentDefinitionStore


class AgentDefinitionNotFoundError(KeyError):
    """Raised when an agent definition does not exist."""


class AgentDefinitionConflictError(RuntimeError):
    """Raised when an agent definition would conflict with an existing one."""


class AgentDefinitionValidationError(ValueError):
    """Raised when an agent definition payload is invalid."""


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "agent"


class AgentDefinitionService:
    """Instance-scoped CRUD service for agent definitions."""

    def __init__(
        self,
        store: AgentDefinitionStore,
        *,
        instance_id: str,
        tenant_id: str = "default",
    ):
        self.store = store
        self.instance_id = instance_id
        self.tenant_id = tenant_id

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
            raise AgentDefinitionValidationError(f"{field_name} is required.")
        return text

    @staticmethod
    def _normalize_string_list(value: Any, *, field_name: str) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise AgentDefinitionValidationError(f"{field_name} must be a list of strings.")
        result: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            result.append(text)
        return result

    def _ensure_unique_name(self, name: str, *, exclude_agent_id: str | None = None) -> None:
        existing = self.store.get_by_name(name, tenant_id=self.tenant_id, instance_id=self.instance_id)
        if existing is None:
            return
        if exclude_agent_id and existing.agent_id == exclude_agent_id:
            return
        raise AgentDefinitionConflictError(f"Agent name '{name}' already exists.")

    def _next_agent_id(self, name: str) -> str:
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

    def _normalize_create_payload(
        self,
        payload: dict[str, Any],
        *,
        default_model: str | None,
        default_tools: list[str],
        template_snapshot: dict[str, Any] | None,
    ) -> AgentDefinition:
        template_snapshot = template_snapshot or {}
        name = self._normalize_text(
            self._get_value(payload, "name") or template_snapshot.get("name"),
            required=True,
            field_name="name",
        )
        self._ensure_unique_name(name)

        description = self._normalize_text(
            self._get_value(payload, "description") if "description" in payload else template_snapshot.get("description"),
            field_name="description",
        )
        system_prompt = self._normalize_text(
            self._get_value(payload, "systemPrompt", "system_prompt")
            if "systemPrompt" in payload or "system_prompt" in payload
            else template_snapshot.get("system_prompt"),
            required=True,
            field_name="systemPrompt",
        )
        rules = self._normalize_string_list(
            self._get_value(payload, "rules") if "rules" in payload else template_snapshot.get("rules"),
            field_name="rules",
        )
        tool_allowlist = self._normalize_string_list(
            self._get_value(payload, "toolAllowlist", "tool_allowlist")
            if "toolAllowlist" in payload or "tool_allowlist" in payload
            else template_snapshot.get("tools", default_tools),
            field_name="toolAllowlist",
        )
        if not tool_allowlist:
            tool_allowlist = list(default_tools)

        skill_ids = self._normalize_string_list(
            self._get_value(payload, "skillIds", "skill_ids")
            if "skillIds" in payload or "skill_ids" in payload
            else template_snapshot.get("skills"),
            field_name="skillIds",
        )
        mcp_server_ids = self._normalize_string_list(
            self._get_value(payload, "mcpServerIds", "mcp_server_ids"),
            field_name="mcpServerIds",
        )
        knowledge_binding_ids = self._normalize_string_list(
            self._get_value(payload, "knowledgeBindingIds", "knowledge_binding_ids"),
            field_name="knowledgeBindingIds",
        )
        tags = self._normalize_string_list(
            self._get_value(payload, "tags"),
            field_name="tags",
        )

        model = self._normalize_text(
            self._get_value(payload, "model") if "model" in payload else template_snapshot.get("model", default_model),
            field_name="model",
        ) or default_model
        backend = self._normalize_text(
            self._get_value(payload, "backend") if "backend" in payload else template_snapshot.get("backend"),
            field_name="backend",
        ) or None
        enabled_value = self._get_value(payload, "enabled")
        enabled = True if enabled_value is None else bool(enabled_value)
        memory_scope = self._normalize_text(
            self._get_value(payload, "memoryScope", "memory_scope"),
            field_name="memoryScope",
        ) or "agent_profile"
        source_template_name = self._normalize_text(
            self._get_value(payload, "sourceTemplateName", "source_template_name")
            if "sourceTemplateName" in payload or "source_template_name" in payload
            else template_snapshot.get("name"),
            field_name="sourceTemplateName",
        ) or None

        now = now_iso()
        return AgentDefinition(
            agent_id=self._next_agent_id(name),
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            name=name,
            description=description,
            system_prompt=system_prompt,
            rules=rules,
            model=model,
            backend=backend,
            enabled=enabled,
            tool_allowlist=tool_allowlist,
            mcp_server_ids=mcp_server_ids,
            skill_ids=skill_ids,
            knowledge_binding_ids=knowledge_binding_ids,
            tags=tags,
            memory_scope=memory_scope,
            source_template_name=source_template_name,
            created_at=now,
            updated_at=now,
        )

    def _apply_update(self, existing: AgentDefinition, payload: dict[str, Any]) -> AgentDefinition:
        updates = {
            "name": self._get_value(payload, "name"),
            "description": self._get_value(payload, "description"),
            "system_prompt": self._get_value(payload, "systemPrompt", "system_prompt"),
            "rules": self._get_value(payload, "rules"),
            "model": self._get_value(payload, "model"),
            "backend": self._get_value(payload, "backend"),
            "enabled": self._get_value(payload, "enabled"),
            "tool_allowlist": self._get_value(payload, "toolAllowlist", "tool_allowlist"),
            "mcp_server_ids": self._get_value(payload, "mcpServerIds", "mcp_server_ids"),
            "skill_ids": self._get_value(payload, "skillIds", "skill_ids"),
            "knowledge_binding_ids": self._get_value(payload, "knowledgeBindingIds", "knowledge_binding_ids"),
            "tags": self._get_value(payload, "tags"),
            "memory_scope": self._get_value(payload, "memoryScope", "memory_scope"),
            "source_template_name": self._get_value(payload, "sourceTemplateName", "source_template_name"),
        }

        name = existing.name
        if updates["name"] is not None:
            name = self._normalize_text(updates["name"], required=True, field_name="name")
            self._ensure_unique_name(name, exclude_agent_id=existing.agent_id)

        return replace(
            existing,
            name=name,
            description=existing.description
            if updates["description"] is None
            else self._normalize_text(updates["description"], field_name="description"),
            system_prompt=existing.system_prompt
            if updates["system_prompt"] is None
            else self._normalize_text(updates["system_prompt"], required=True, field_name="systemPrompt"),
            rules=existing.rules
            if updates["rules"] is None
            else self._normalize_string_list(updates["rules"], field_name="rules"),
            model=existing.model
            if updates["model"] is None
            else (self._normalize_text(updates["model"], field_name="model") or None),
            backend=existing.backend
            if updates["backend"] is None
            else (self._normalize_text(updates["backend"], field_name="backend") or None),
            enabled=existing.enabled if updates["enabled"] is None else bool(updates["enabled"]),
            tool_allowlist=existing.tool_allowlist
            if updates["tool_allowlist"] is None
            else self._normalize_string_list(updates["tool_allowlist"], field_name="toolAllowlist"),
            mcp_server_ids=existing.mcp_server_ids
            if updates["mcp_server_ids"] is None
            else self._normalize_string_list(updates["mcp_server_ids"], field_name="mcpServerIds"),
            skill_ids=existing.skill_ids
            if updates["skill_ids"] is None
            else self._normalize_string_list(updates["skill_ids"], field_name="skillIds"),
            knowledge_binding_ids=existing.knowledge_binding_ids
            if updates["knowledge_binding_ids"] is None
            else self._normalize_string_list(updates["knowledge_binding_ids"], field_name="knowledgeBindingIds"),
            tags=existing.tags
            if updates["tags"] is None
            else self._normalize_string_list(updates["tags"], field_name="tags"),
            memory_scope=existing.memory_scope
            if updates["memory_scope"] is None
            else (self._normalize_text(updates["memory_scope"], field_name="memoryScope") or "agent_profile"),
            source_template_name=existing.source_template_name
            if updates["source_template_name"] is None
            else (self._normalize_text(updates["source_template_name"], field_name="sourceTemplateName") or None),
            updated_at=now_iso(),
        )

    def require_agent(self, agent_id: str) -> AgentDefinition:
        agent = self.store.get(agent_id)
        if agent is None:
            raise AgentDefinitionNotFoundError(agent_id)
        return agent

    def list_agents(self, *, enabled: bool | None = None) -> list[dict[str, Any]]:
        return [
            agent.to_dict()
            for agent in self.store.list_all(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                enabled=enabled,
            )
        ]

    def get_agent(self, agent_id: str) -> dict[str, Any]:
        return self.require_agent(agent_id).to_dict()

    def create_agent(
        self,
        payload: dict[str, Any],
        *,
        default_model: str | None,
        default_tools: list[str],
        template_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        agent = self._normalize_create_payload(
            payload,
            default_model=default_model,
            default_tools=default_tools,
            template_snapshot=template_snapshot,
        )
        return self.store.create(agent).to_dict()

    def update_agent(self, agent_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        updated = self.store.update(self._apply_update(self.require_agent(agent_id), payload))
        if updated is None:
            raise AgentDefinitionNotFoundError(agent_id)
        return updated.to_dict()

    def delete_agent(self, agent_id: str) -> bool:
        if not self.store.delete(agent_id):
            raise AgentDefinitionNotFoundError(agent_id)
        return True

    def copy_agent(self, agent_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload or {}
        source = self.require_agent(agent_id)
        name = self._normalize_text(payload.get("name"), field_name="name") or self._next_copy_name(source.name)
        self._ensure_unique_name(name)
        now = now_iso()
        clone = replace(
            source,
            agent_id=self._next_agent_id(name),
            name=name,
            created_at=now,
            updated_at=now,
        )
        return self.store.create(clone).to_dict()

    def set_enabled(self, agent_id: str, enabled: bool) -> dict[str, Any]:
        agent = replace(self.require_agent(agent_id), enabled=enabled, updated_at=now_iso())
        updated = self.store.update(agent)
        if updated is None:
            raise AgentDefinitionNotFoundError(agent_id)
        return updated.to_dict()
