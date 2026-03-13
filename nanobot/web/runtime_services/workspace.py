"""Workspace, templates, skills, and document runtime helpers."""

from __future__ import annotations

import re
import shutil
from datetime import datetime
from importlib.resources import files as pkg_files
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from nanobot.web.runtime import WebAppState


class WebWorkspaceRuntimeService:
    """Encapsulates workspace assets exposed by the Web UI."""

    def __init__(self, state: WebAppState, document_definitions: dict[str, dict[str, Any]]):
        self.state = state
        self.document_definitions = document_definitions

    def get_template_tool_catalog(self) -> list[dict[str, str]]:
        if self.state.agent is None:
            return []
        catalog: list[dict[str, str]] = []
        for name in self.state.agent.tools.tool_names:
            tool = self.state.agent.tools.get(name)
            if tool is None:
                continue
            catalog.append({"name": name, "description": tool.description})
        return catalog

    @staticmethod
    def format_agent_template(template) -> dict[str, Any]:
        return {
            "name": template.name,
            "description": template.description,
            "tools": template.tools,
            "rules": template.rules,
            "system_prompt": template.system_prompt,
            "skills": template.skills,
            "model": template.model,
            "backend": template.backend,
            "source": template.source,
            "is_builtin": template.is_builtin,
            "is_editable": template.is_editable,
            "is_deletable": template.is_deletable,
            "enabled": template.enabled,
            "created_at": template.created_at,
            "updated_at": template.updated_at,
        }

    def list_agent_templates(self) -> list[dict[str, Any]]:
        if self.state.agent_templates is None:
            return []
        return [
            self.format_agent_template(template)
            for template in self.state.agent_templates.list_templates()
        ]

    def get_agent_template(self, name: str) -> dict[str, Any]:
        if self.state.agent_templates is None:
            raise KeyError(name)
        template = self.state.agent_templates.get_template(name)
        if template is None:
            raise KeyError(name)
        return self.format_agent_template(template)

    def create_agent_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.state.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        created = self.state.agent_templates.create_template(payload)
        return {"name": created.name, "success": True}

    def update_agent_template(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.state.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        updated = self.state.agent_templates.update_template(name, payload)
        if updated is None:
            raise KeyError(name)
        return {"name": updated.name, "success": True}

    def delete_agent_template(self, name: str) -> dict[str, Any]:
        if self.state.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        deleted = self.state.agent_templates.delete_template(name)
        if not deleted:
            raise KeyError(name)
        return {"name": name, "success": True}

    def import_agent_templates(self, content: str, on_conflict: str = "skip") -> dict[str, Any]:
        if self.state.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        return self.state.agent_templates.import_from_yaml(content, on_conflict)

    def export_agent_templates(self, names: list[str] | None = None) -> dict[str, Any]:
        if self.state.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        return {"content": self.state.agent_templates.export_to_yaml(names)}

    def reload_agent_templates(self) -> dict[str, Any]:
        if self.state.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        return {"success": self.state.agent_templates.reload()}

    def get_valid_template_tools(self) -> list[dict[str, str]]:
        if self.state.agent_templates is None:
            return []
        return self.state.agent_templates.get_valid_tools()

    def get_installed_skills(self) -> list[dict[str, Any]]:
        if self.state.agent_templates is None:
            return []
        return self.state.agent_templates.list_installed_skills()

    def upload_skill(self, files: list[tuple[str, bytes]]) -> dict[str, Any]:
        workspace_skills = self.state.config.workspace_path / "skills"
        workspace_skills.mkdir(parents=True, exist_ok=True)

        if not files:
            raise ValueError("No skill files were uploaded.")

        def safe_skill_name(name: str) -> bool:
            return bool(re.fullmatch(r"[A-Za-z0-9_-]+", name))

        def safe_rel_path(rel_path: str) -> bool:
            normalized = rel_path.replace("\\", "/").strip()
            return bool(normalized) and ".." not in normalized and not Path(normalized).is_absolute()

        skill_name: str | None = None
        has_skill_md = False

        for rel_path, content in files:
            normalized = rel_path.replace("\\", "/").strip()
            if not safe_rel_path(normalized):
                continue

            parts = [part for part in normalized.split("/") if part]
            if len(parts) < 2:
                continue

            current_skill_name = parts[0]
            if not safe_skill_name(current_skill_name):
                raise ValueError(f"Invalid skill name: {current_skill_name}")

            if skill_name is None:
                skill_name = current_skill_name
            elif skill_name != current_skill_name:
                raise ValueError("Uploaded files must belong to a single skill folder.")

            relative_inside_skill = Path(*parts[1:])
            destination = workspace_skills / current_skill_name / relative_inside_skill
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)

            if relative_inside_skill.as_posix() == "SKILL.md":
                has_skill_md = True

        if not skill_name:
            raise ValueError("Could not determine the uploaded skill name.")

        skill_root = workspace_skills / skill_name
        if not has_skill_md and not (skill_root / "SKILL.md").exists():
            shutil.rmtree(skill_root, ignore_errors=True)
            raise ValueError("A skill folder must include SKILL.md.")

        installed = self.get_installed_skills()
        matched = next((item for item in installed if item["id"] == skill_name), None)
        if matched is None:
            raise RuntimeError(f"Uploaded skill '{skill_name}' could not be loaded.")
        return matched

    def delete_skill(self, skill_id: str) -> bool:
        safe_id = str(skill_id or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]+", safe_id):
            raise ValueError("Invalid skill id.")

        workspace_skill = self.state.config.workspace_path / "skills" / safe_id
        if workspace_skill.is_dir():
            shutil.rmtree(workspace_skill)
            return True

        builtin_skill = Path(__file__).resolve().parents[2] / "skills" / safe_id
        if builtin_skill.is_dir():
            raise ValueError("Built-in skills cannot be deleted from the Web UI.")

        raise KeyError(skill_id)

    def document_definition(self, document_id: str) -> dict[str, Any]:
        definition = self.document_definitions.get(document_id)
        if definition is None:
            raise KeyError(document_id)
        return definition

    def document_path(self, document_id: str) -> Path:
        definition = self.document_definition(document_id)
        return self.state.config.workspace_path / Path(definition["relative_path"])

    def default_document_content(self, document_id: str) -> str:
        definition = self.document_definition(document_id)
        template_segments = definition.get("template_segments")
        if not template_segments:
            return ""
        template = pkg_files("nanobot") / "templates"
        for segment in template_segments:
            template = template / segment
        return template.read_text(encoding="utf-8")

    def list_documents(self) -> list[dict[str, Any]]:
        items = []
        for document_id, definition in self.document_definitions.items():
            path = self.document_path(document_id)
            updated_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat() if path.exists() else ""
            items.append(
                {
                    "id": document_id,
                    "label": definition["label"],
                    "path": str(path),
                    "hasTemplate": definition.get("template_segments") is not None,
                    "updatedAt": updated_at,
                }
            )
        return items

    def get_document(self, document_id: str) -> dict[str, Any]:
        definition = self.document_definition(document_id)
        path = self.document_path(document_id)
        if path.exists():
            content = path.read_text(encoding="utf-8")
            updated_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat()
        else:
            content = self.default_document_content(document_id)
            updated_at = ""
        return {
            "id": document_id,
            "label": definition["label"],
            "content": content,
            "updatedAt": updated_at,
            "sourcePath": str(path),
            "hasTemplate": definition.get("template_segments") is not None,
        }

    def update_document(self, document_id: str, content: str) -> dict[str, Any]:
        path = self.document_path(document_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return self.get_document(document_id)

    def reset_document(self, document_id: str) -> dict[str, Any]:
        path = self.document_path(document_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.default_document_content(document_id), encoding="utf-8")
        return self.get_document(document_id)
