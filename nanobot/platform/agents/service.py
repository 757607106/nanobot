"""Service layer for reusable agent definitions."""

from __future__ import annotations

import re
from dataclasses import replace
from typing import TYPE_CHECKING, Any, Callable

from nanobot.platform.agents.model_selection import canonicalize_agent_model_selection
from nanobot.platform.artifact_retention import normalize_artifact_retention_policy
from nanobot.platform.agents.models import AgentDefinition, now_iso
from nanobot.platform.agents.store import AgentDefinitionStore

if TYPE_CHECKING:
    from nanobot.config.schema import Config


class AgentDefinitionNotFoundError(KeyError):
    """Raised when an agent definition does not exist."""


class AgentDefinitionConflictError(RuntimeError):
    """Raised when an agent definition would conflict with an existing one."""


class AgentDefinitionValidationError(ValueError):
    """Raised when an agent definition payload is invalid."""


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "agent"


_MISSING = object()


class AgentDefinitionService:
    """Instance-scoped CRUD service for agent definitions."""

    def __init__(
        self,
        store: AgentDefinitionStore,
        *,
        instance_id: str,
        config_loader: Callable[[], Config | None] | None = None,
    ):
        self.store = store
        self.instance_id = instance_id
        self._config_loader = config_loader

    @staticmethod
    def _get_value(payload: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in payload:
                return payload[key]
        return None

    @staticmethod
    def _get_optional_value(payload: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in payload:
                return payload[key]
        return _MISSING

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

    @staticmethod
    def _normalize_positive_int(
        value: Any,
        *,
        field_name: str,
        default: int,
        min_val: int = 1,
        max_val: int = 3600,
    ) -> int:
        if value is None:
            return default
        try:
            result = int(value)
        except (TypeError, ValueError) as exc:
            raise AgentDefinitionValidationError(f"{field_name} must be an integer.") from exc
        if result < min_val or result > max_val:
            raise AgentDefinitionValidationError(
                f"{field_name} must be between {min_val} and {max_val}."
            )
        return result

    def _ensure_unique_name(
        self, name: str, *, tenant_id: str, exclude_agent_id: str | None = None,
    ) -> None:
        existing = self.store.get_by_name(name, tenant_id=tenant_id, instance_id=self.instance_id)
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

    def _next_copy_name(self, name: str, *, tenant_id: str) -> str:
        candidate = f"{name} Copy"
        counter = 2
        while self.store.get_by_name(candidate, tenant_id=tenant_id, instance_id=self.instance_id) is not None:
            candidate = f"{name} Copy {counter}"
            counter += 1
        return candidate

    def _load_config(self) -> Config | None:
        return self._config_loader() if self._config_loader is not None else None

    def _canonicalize_model_selection(
        self,
        *,
        model: str | None,
        binding: str | None,
        provider: str | None,
        default_model: str | None = None,
        default_binding: str | None = None,
        default_provider: str | None = None,
    ) -> tuple[str | None, str | None, str | None]:
        try:
            selection = canonicalize_agent_model_selection(
                self._load_config(),
                model=model,
                binding=binding,
                provider=provider,
                default_model=default_model,
                default_binding=default_binding,
                default_provider=default_provider,
            )
        except ValueError as exc:
            raise AgentDefinitionValidationError(str(exc)) from exc
        return selection.model, selection.binding, selection.provider

    def _repair_agent_selection(self, agent: AgentDefinition) -> AgentDefinition:
        config = self._load_config()
        if config is None:
            return agent
        try:
            selection = canonicalize_agent_model_selection(
                config,
                model=agent.model,
                binding=agent.binding,
                provider=agent.provider,
            )
        except ValueError:
            return agent

        if (
            selection.model == agent.model
            and selection.binding == agent.binding
            and selection.provider == agent.provider
        ):
            return agent

        repaired = replace(
            agent,
            model=selection.model,
            binding=selection.binding,
            provider=selection.provider,
        )
        persisted = self.store.update(repaired, tenant_id=agent.tenant_id)
        return persisted or repaired

    def _normalize_create_payload(
        self,
        payload: dict[str, Any],
        *,
        tenant_id: str,
        default_model: str | None,
        default_binding: str | None,
        default_provider: str | None,
        default_tools: list[str],
        template_snapshot: dict[str, Any] | None,
    ) -> AgentDefinition:
        template_snapshot = template_snapshot or {}
        name = self._normalize_text(
            self._get_value(payload, "name") or template_snapshot.get("name"),
            required=True,
            field_name="name",
        )
        self._ensure_unique_name(name, tenant_id=tenant_id)

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

        raw_model = self._normalize_text(
            self._get_value(payload, "model") if "model" in payload else template_snapshot.get("model"),
            field_name="model",
        ) or None
        raw_binding = self._normalize_text(
            self._get_value(payload, "binding") if "binding" in payload else template_snapshot.get("binding"),
            field_name="binding",
        ) or None
        raw_provider = self._normalize_text(
            self._get_value(payload, "provider") if "provider" in payload else template_snapshot.get("provider"),
            field_name="provider",
        ) or None
        model = raw_model or default_model
        use_binding_defaults = raw_model is None and raw_binding is None and raw_provider is None
        model, binding, provider = self._canonicalize_model_selection(
            model=model,
            binding=raw_binding,
            provider=raw_provider,
            default_model=default_model,
            default_binding=default_binding if use_binding_defaults else None,
            default_provider=default_provider if use_binding_defaults else None,
        )
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
        if memory_scope not in {"agent_profile", "workspace_shared"}:
            memory_scope = "agent_profile"
        source_template_name = self._normalize_text(
            self._get_value(payload, "sourceTemplateName", "source_template_name")
            if "sourceTemplateName" in payload or "source_template_name" in payload
            else template_snapshot.get("name"),
            field_name="sourceTemplateName",
        ) or None
        max_execution_timeout_seconds = self._normalize_positive_int(
            self._get_value(payload, "maxExecutionTimeoutSeconds", "max_execution_timeout_seconds"),
            field_name="maxExecutionTimeoutSeconds",
            default=300,
            min_val=10,
            max_val=3600,
        )
        output_format_hint = self._normalize_text(
            self._get_value(payload, "outputFormatHint", "output_format_hint"),
            field_name="outputFormatHint",
        )
        artifact_retention_policy = normalize_artifact_retention_policy(
            self._get_value(payload, "artifactRetentionPolicy", "artifact_retention_policy"),
            error_cls=AgentDefinitionValidationError,
            default_action_by="agent_template",
        )

        now = now_iso()
        return AgentDefinition(
            agent_id=self._next_agent_id(name),
            tenant_id=tenant_id,
            instance_id=self.instance_id,
            name=name,
            description=description,
            system_prompt=system_prompt,
            rules=rules,
            model=model,
            binding=binding,
            provider=provider,
            backend=backend,
            enabled=enabled,
            tool_allowlist=tool_allowlist,
            mcp_server_ids=mcp_server_ids,
            skill_ids=skill_ids,
            knowledge_binding_ids=knowledge_binding_ids,
            tags=tags,
            memory_scope=memory_scope,
            source_template_name=source_template_name,
            max_execution_timeout_seconds=max_execution_timeout_seconds,
            output_format_hint=output_format_hint,
            artifact_retention_policy=artifact_retention_policy,
            created_at=now,
            updated_at=now,
        )

    def _apply_update(self, existing: AgentDefinition, payload: dict[str, Any]) -> AgentDefinition:
        updates = {
            "name": self._get_optional_value(payload, "name"),
            "description": self._get_optional_value(payload, "description"),
            "system_prompt": self._get_optional_value(payload, "systemPrompt", "system_prompt"),
            "rules": self._get_optional_value(payload, "rules"),
            "model": self._get_optional_value(payload, "model"),
            "binding": self._get_optional_value(payload, "binding"),
            "provider": self._get_optional_value(payload, "provider"),
            "backend": self._get_optional_value(payload, "backend"),
            "enabled": self._get_optional_value(payload, "enabled"),
            "tool_allowlist": self._get_optional_value(payload, "toolAllowlist", "tool_allowlist"),
            "mcp_server_ids": self._get_optional_value(payload, "mcpServerIds", "mcp_server_ids"),
            "skill_ids": self._get_optional_value(payload, "skillIds", "skill_ids"),
            "knowledge_binding_ids": self._get_optional_value(payload, "knowledgeBindingIds", "knowledge_binding_ids"),
            "tags": self._get_optional_value(payload, "tags"),
            "memory_scope": self._get_optional_value(payload, "memoryScope", "memory_scope"),
            "source_template_name": self._get_optional_value(payload, "sourceTemplateName", "source_template_name"),
            "max_execution_timeout_seconds": self._get_optional_value(
                payload, "maxExecutionTimeoutSeconds", "max_execution_timeout_seconds",
            ),
            "output_format_hint": self._get_optional_value(payload, "outputFormatHint", "output_format_hint"),
            "artifact_retention_policy": self._get_optional_value(payload, "artifactRetentionPolicy", "artifact_retention_policy"),
        }

        name = existing.name
        if updates["name"] is not _MISSING:
            name = self._normalize_text(updates["name"], required=True, field_name="name")
            self._ensure_unique_name(name, tenant_id=existing.tenant_id, exclude_agent_id=existing.agent_id)

        next_model = existing.model
        next_binding = existing.binding
        next_provider = existing.provider
        selection_updated = any(
            updates[key] is not _MISSING
            for key in ("model", "binding", "provider")
        )
        if selection_updated:
            raw_model = existing.model
            if updates["model"] is not _MISSING:
                raw_model = self._normalize_text(updates["model"], field_name="model") or None
            raw_binding = existing.binding
            if updates["binding"] is not _MISSING:
                raw_binding = self._normalize_text(updates["binding"], field_name="binding") or None
            raw_provider = existing.provider
            if updates["provider"] is not _MISSING:
                raw_provider = self._normalize_text(updates["provider"], field_name="provider") or None
            next_model, next_binding, next_provider = self._canonicalize_model_selection(
                model=raw_model,
                binding=raw_binding,
                provider=raw_provider,
            )

        return replace(
            existing,
            name=name,
            description=existing.description
            if updates["description"] is _MISSING
            else self._normalize_text(updates["description"], field_name="description"),
            system_prompt=existing.system_prompt
            if updates["system_prompt"] is _MISSING
            else self._normalize_text(updates["system_prompt"], required=True, field_name="systemPrompt"),
            rules=existing.rules
            if updates["rules"] is _MISSING
            else self._normalize_string_list(updates["rules"], field_name="rules"),
            model=next_model,
            binding=next_binding,
            provider=next_provider,
            backend=existing.backend
            if updates["backend"] is _MISSING
            else (self._normalize_text(updates["backend"], field_name="backend") or None),
            enabled=existing.enabled if updates["enabled"] is _MISSING else bool(updates["enabled"]),
            tool_allowlist=existing.tool_allowlist
            if updates["tool_allowlist"] is _MISSING
            else self._normalize_string_list(updates["tool_allowlist"], field_name="toolAllowlist"),
            mcp_server_ids=existing.mcp_server_ids
            if updates["mcp_server_ids"] is _MISSING
            else self._normalize_string_list(updates["mcp_server_ids"], field_name="mcpServerIds"),
            skill_ids=existing.skill_ids
            if updates["skill_ids"] is _MISSING
            else self._normalize_string_list(updates["skill_ids"], field_name="skillIds"),
            knowledge_binding_ids=existing.knowledge_binding_ids
            if updates["knowledge_binding_ids"] is _MISSING
            else self._normalize_string_list(updates["knowledge_binding_ids"], field_name="knowledgeBindingIds"),
            tags=existing.tags
            if updates["tags"] is _MISSING
            else self._normalize_string_list(updates["tags"], field_name="tags"),
            memory_scope=existing.memory_scope
            if updates["memory_scope"] is _MISSING
            else (
                (normalized if normalized in {"agent_profile", "workspace_shared"} else "agent_profile")
                if (normalized := (self._normalize_text(updates["memory_scope"], field_name="memoryScope") or "agent_profile"))
                else "agent_profile"
            ),
            source_template_name=existing.source_template_name
            if updates["source_template_name"] is _MISSING
            else (self._normalize_text(updates["source_template_name"], field_name="sourceTemplateName") or None),
            max_execution_timeout_seconds=existing.max_execution_timeout_seconds
            if updates["max_execution_timeout_seconds"] is _MISSING
            else self._normalize_positive_int(
                updates["max_execution_timeout_seconds"],
                field_name="maxExecutionTimeoutSeconds",
                default=existing.max_execution_timeout_seconds,
                min_val=10,
                max_val=3600,
            ),
            output_format_hint=existing.output_format_hint
            if updates["output_format_hint"] is _MISSING
            else self._normalize_text(updates["output_format_hint"], field_name="outputFormatHint"),
            artifact_retention_policy=existing.artifact_retention_policy
            if updates["artifact_retention_policy"] is _MISSING
            else normalize_artifact_retention_policy(
                updates["artifact_retention_policy"],
                error_cls=AgentDefinitionValidationError,
                default_action_by="agent_template",
            ),
            updated_at=now_iso(),
        )

    def require_agent(self, agent_id: str, *, tenant_id: str | None = None) -> AgentDefinition:
        agent = self.store.get(agent_id, tenant_id=tenant_id)
        if agent is None:
            raise AgentDefinitionNotFoundError(agent_id)
        return self._repair_agent_selection(agent)

    def list_agents(self, *, tenant_id: str, enabled: bool | None = None) -> list[dict[str, Any]]:
        return [
            self._repair_agent_selection(agent).to_dict()
            for agent in self.store.list_all(
                tenant_id=tenant_id,
                instance_id=self.instance_id,
                enabled=enabled,
            )
        ]

    def get_agent(self, agent_id: str, *, tenant_id: str | None = None) -> dict[str, Any]:
        return self.require_agent(agent_id, tenant_id=tenant_id).to_dict()

    def create_agent(
        self,
        payload: dict[str, Any],
        *,
        tenant_id: str,
        default_model: str | None,
        default_binding: str | None = None,
        default_provider: str | None = None,
        default_tools: list[str],
        template_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        config = self._load_config()
        agent = self._normalize_create_payload(
            payload,
            tenant_id=tenant_id,
            default_model=default_model
            if default_model is not None
            else (config.agents.defaults.model if config is not None else None),
            default_binding=default_binding
            if default_binding is not None
            else (config.agents.defaults.binding if config is not None else None),
            default_provider=default_provider
            if default_provider is not None
            else (config.agents.defaults.provider if config is not None else None),
            default_tools=default_tools,
            template_snapshot=template_snapshot,
        )
        return self.store.create(agent).to_dict()

    def update_agent(self, agent_id: str, payload: dict[str, Any], *, tenant_id: str | None = None) -> dict[str, Any]:
        updated = self.store.update(
            self._apply_update(self.require_agent(agent_id, tenant_id=tenant_id), payload),
            tenant_id=tenant_id,
        )
        if updated is None:
            raise AgentDefinitionNotFoundError(agent_id)
        return updated.to_dict()

    def delete_agent(self, agent_id: str, *, tenant_id: str | None = None) -> bool:
        if not self.store.delete(agent_id, tenant_id=tenant_id):
            raise AgentDefinitionNotFoundError(agent_id)
        return True

    def copy_agent(self, agent_id: str, payload: dict[str, Any] | None = None, *, tenant_id: str | None = None) -> dict[str, Any]:
        payload = payload or {}
        source = self.require_agent(agent_id, tenant_id=tenant_id)
        name = (
            self._normalize_text(payload.get("name"), field_name="name")
            or self._next_copy_name(source.name, tenant_id=source.tenant_id)
        )
        self._ensure_unique_name(name, tenant_id=source.tenant_id)
        now = now_iso()
        clone = replace(
            source,
            agent_id=self._next_agent_id(name),
            name=name,
            created_at=now,
            updated_at=now,
        )
        return self.store.create(clone).to_dict()

    def set_enabled(self, agent_id: str, enabled: bool, *, tenant_id: str | None = None) -> dict[str, Any]:
        agent = replace(self.require_agent(agent_id, tenant_id=tenant_id), enabled=enabled, updated_at=now_iso())
        updated = self.store.update(agent, tenant_id=tenant_id)
        if updated is None:
            raise AgentDefinitionNotFoundError(agent_id)
        return updated.to_dict()
