"""Agent template management for the Web UI."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from loguru import logger

from nanobot.agent.skills import SkillsLoader
from nanobot.harness.runtime_tools import RUNTIME_TOOL_CATALOG

DEFAULT_BUILTIN_TEMPLATES: dict[str, dict[str, Any]] = {
    "minimal": {
        "description": "Reference-style lightweight worker for focused tasks.",
        "tools": ["read_file", "write_file", "list_dir", "exec", "web_search", "web_fetch"],
        "rules": [
            "Stay focused on the assigned task.",
            "Keep the response concise and practical.",
            "Summarize the outcome clearly when finished.",
        ],
        "system_prompt": """# Minimal Worker

You are a focused helper for a single background task.

## Task
{task}

## Rules
{all_rules}

## Workspace
{workspace}

Complete the work efficiently and report the result clearly.""",
    },
    "coder": {
        "description": "Code-oriented template derived from the reference repository.",
        "tools": ["read_file", "write_file", "edit_file", "list_dir", "exec"],
        "rules": [
            "Follow the project's existing style and patterns.",
            "Prefer small, readable changes over clever shortcuts.",
            "Validate the result when tests or build steps are available.",
        ],
        "system_prompt": """# Coder Template

You are a software engineering assistant.

## Task
{task}

## Rules
{all_rules}

## Workspace
{workspace}

Read the surrounding code before making changes, then implement and verify the result.""",
        "backend": "claude_code",
    },
    "researcher": {
        "description": "Research-oriented template for source-backed investigation.",
        "tools": ["web_search", "web_fetch", "read_file"],
        "rules": [
            "Verify important claims with sources.",
            "Separate confirmed facts from inference.",
            "End with a concise summary and next steps.",
        ],
        "system_prompt": """# Researcher Template

You are a research assistant focused on source-backed findings.

## Task
{task}

## Rules
{all_rules}

Use the available tools to gather information, compare sources, and deliver a clear summary.""",
    },
    "analyst": {
        "description": "Analysis template for evidence-based reports and reviews.",
        "tools": ["read_file", "write_file", "exec", "web_search", "web_fetch"],
        "rules": [
            "Base conclusions on evidence you can show.",
            "Call out uncertainty explicitly.",
            "Present the result in a structured, readable format.",
        ],
        "system_prompt": """# Analyst Template

You are an analyst helping with a scoped task.

## Task
{task}

## Rules
{all_rules}

## Workspace
{workspace}

Gather evidence, analyze it carefully, and provide a practical summary.""",
    },
}


@dataclass
class AgentTemplateConfig:
    """Management-only agent template definition."""

    name: str
    description: str
    tools: list[str]
    rules: list[str]
    system_prompt: str
    skills: list[str] = field(default_factory=list)
    model: str | None = None
    backend: str | None = None
    source: str = "user"
    is_system: bool = False
    enabled: bool = True
    created_at: str | None = None
    updated_at: str | None = None

    @property
    def is_builtin(self) -> bool:
        return self.is_system

    @property
    def is_editable(self) -> bool:
        return not self.is_system

    @property
    def is_deletable(self) -> bool:
        return not self.is_system

    def to_storage_json(self) -> str:
        return json.dumps(
            {
                "name": self.name,
                "description": self.description,
                "tools": self.tools,
                "rules": self.rules,
                "system_prompt": self.system_prompt,
                "skills": self.skills,
                "model": self.model,
                "backend": self.backend,
            },
            ensure_ascii=False,
        )

    def to_export_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "tools": self.tools,
            "rules": self.rules,
            "system_prompt": self.system_prompt,
        }
        if self.skills:
            payload["skills"] = self.skills
        if self.model:
            payload["model"] = self.model
        if self.backend:
            payload["backend"] = self.backend
        return payload

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "AgentTemplateConfig":
        stored = json.loads(record["config_json"])
        return cls(
            name=stored["name"],
            description=stored.get("description", ""),
            tools=list(stored.get("tools") or []),
            rules=list(stored.get("rules") or []),
            system_prompt=stored.get("system_prompt", ""),
            skills=list(stored.get("skills") or []),
            model=stored.get("model"),
            backend=stored.get("backend"),
            source="builtin" if bool(record.get("is_system")) else "user",
            is_system=bool(record.get("is_system", False)),
            enabled=bool(record.get("enabled", True)),
            created_at=record.get("created_at"),
            updated_at=record.get("updated_at"),
        )


class AgentTemplateManager:
    """Workspace-scoped template library for the Web UI."""

    def __init__(
        self,
        workspace: Path,
        tool_catalog_provider: Callable[[], list[dict[str, str]]] | None = None,
    ):
        self.workspace = workspace.expanduser().resolve()
        self._tool_catalog_provider = tool_catalog_provider
        self._templates: dict[str, AgentTemplateConfig] = {}
        self._lock = threading.RLock()
        self._load()

    def _load(self) -> None:
        with self._lock:
            self._templates.clear()
            self._init_builtin_templates()
            logger.info("Loaded {} built-in agent templates", len(self._templates))

    def _init_builtin_templates(self) -> None:
        for name, payload in DEFAULT_BUILTIN_TEMPLATES.items():
            template = AgentTemplateConfig(
                name=name,
                description=payload["description"],
                tools=list(payload["tools"]),
                rules=list(payload["rules"]),
                system_prompt=payload["system_prompt"],
                skills=list(payload.get("skills") or []),
                model=payload.get("model"),
                backend=payload.get("backend"),
                source="builtin",
                is_system=True,
                enabled=True,
                created_at=datetime.now().isoformat(),
                updated_at=datetime.now().isoformat(),
            )
            self._templates[template.name] = template

    def reload(self) -> bool:
        try:
            self._load()
            return True
        except Exception:  # noqa: BLE001
            logger.exception("Failed to reload agent templates")
            return False

    def list_templates(self) -> list[AgentTemplateConfig]:
        with self._lock:
            return list(self._templates.values())

    def get_template(self, name: str) -> AgentTemplateConfig | None:
        with self._lock:
            return self._templates.get(name)

    def create_template(self, payload: dict[str, Any]) -> AgentTemplateConfig:
        raise NotImplementedError("Custom templates are unified as instances. Please create an Agent directly.")

    def update_template(self, name: str, payload: dict[str, Any]) -> AgentTemplateConfig | None:
        raise NotImplementedError("Custom templates are unified as instances. Please create an Agent directly.")

    def delete_template(self, name: str) -> bool:
        raise NotImplementedError("Custom templates are unified as instances. Please delete the Agent directly.")

    def import_from_yaml(self, content: str, on_conflict: str = "skip") -> dict[str, Any]:
        raise NotImplementedError("Template import is disabled. Please import Agents directly.")

    def export_to_yaml(self, names: list[str] | None = None) -> str:
        with self._lock:
            templates = (
                [self._templates[name] for name in names if name in self._templates]
                if names
                else list(self._templates.values())
            )

        payload = {
            "version": "1.0",
            "exported_at": datetime.now().isoformat(),
            "agents": [template.to_export_dict() for template in templates],
        }
        return yaml.safe_dump(payload, allow_unicode=True, sort_keys=False)

    def get_valid_tools(self) -> list[dict[str, str]]:
        catalog = self._tool_catalog_provider() if self._tool_catalog_provider else []
        items: dict[str, str] = {}
        for entry in catalog:
            name = str(entry.get("name") or "").strip()
            if not name:
                continue
            desc = str(entry.get("description") or "").strip()
            if not desc and name in RUNTIME_TOOL_CATALOG:
                desc = RUNTIME_TOOL_CATALOG[name]
            items[name] = desc

        for name, description in RUNTIME_TOOL_CATALOG.items():
            items.setdefault(name, description)

        return [{"name": name, "description": desc} for name, desc in items.items()]

    def list_installed_skills(self) -> list[dict[str, Any]]:
        loader = SkillsLoader(self.workspace)
        installed = []
        for item in loader.list_skills(filter_unavailable=False):
            metadata = loader.get_skill_metadata(item["name"]) or {}
            tags_value = metadata.get("tags", "")
            tags = [tag.strip() for tag in str(tags_value).split(",") if tag.strip()]
            source = item.get("source", "builtin")
            installed.append(
                {
                    "id": item["name"],
                    "name": item["name"],
                    "description": metadata.get("description", item["name"]),
                    "source": source,
                    "path": item.get("path", ""),
                    "version": metadata.get("version", "1.0.0"),
                    "author": metadata.get("author"),
                    "tags": tags,
                    "enabled": True,
                    "isDeletable": source == "workspace",
                }
            )
        return installed

    def _validate_template_payload(
        self,
        payload: dict[str, Any],
        existing: AgentTemplateConfig | None = None,
    ) -> dict[str, Any]:
        raw_name = payload.get("name")
        if raw_name is None and existing is not None:
            raw_name = existing.name
        name = str(raw_name or "").strip()
        if not name:
            raise ValueError("name is required.")

        description = payload.get("description")
        if description is None and existing is not None:
            description = existing.description

        tools = payload.get("tools")
        if tools is None and existing is not None:
            tools = existing.tools
        cleaned_tools = self._clean_list(tools)
        if not cleaned_tools:
            raise ValueError("At least one tool is required.")
        valid_tool_names = {item["name"] for item in self.get_valid_tools()}
        invalid = [tool for tool in cleaned_tools if tool not in valid_tool_names]
        if invalid:
            raise ValueError(f"Invalid tools: {', '.join(invalid)}")

        rules = payload.get("rules")
        if rules is None and existing is not None:
            rules = existing.rules
        cleaned_rules = self._clean_list(rules)
        if not cleaned_rules:
            raise ValueError("At least one rule is required.")

        system_prompt = payload.get("system_prompt")
        if system_prompt is None and existing is not None:
            system_prompt = existing.system_prompt
        system_prompt = str(system_prompt or "").strip()
        if not system_prompt:
            raise ValueError("system_prompt is required.")

        skills = payload.get("skills")
        if skills is None and existing is not None:
            skills = existing.skills

        model = payload.get("model")
        if model is None and existing is not None:
            model = existing.model
        model = str(model).strip() if model else None

        backend = payload.get("backend")
        if backend is None and existing is not None:
            backend = existing.backend
        backend = str(backend).strip() if backend else None

        enabled = payload.get("enabled")
        if enabled is None:
            enabled = existing.enabled if existing is not None else True

        return {
            "name": name,
            "description": str(description or "").strip(),
            "tools": cleaned_tools,
            "rules": cleaned_rules,
            "system_prompt": system_prompt,
            "skills": self._clean_list(skills),
            "model": model,
            "backend": backend,
            "enabled": bool(enabled),
        }

    @staticmethod
    def _clean_list(values: Any) -> list[str]:
        if values is None:
            return []
        if not isinstance(values, list):
            raise ValueError("Expected a list value.")
        seen: set[str] = set()
        cleaned: list[str] = []
        for value in values:
            item = str(value or "").strip()
            if not item or item in seen:
                continue
            cleaned.append(item)
            seen.add(item)
        return cleaned

    def _unique_name(self, base_name: str) -> str:
        candidate = base_name
        counter = 1
        with self._lock:
            while candidate in self._templates:
                candidate = f"{base_name}-{counter}"
                counter += 1
        return candidate
