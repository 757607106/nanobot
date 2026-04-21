"""Service layer for agent-root long-term memory workspaces."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from nanobot.harness.workspace import AgentWorkspaceProvider, TenantScopedWorkspaceProvider
from nanobot.platform.instances import PlatformInstance
from nanobot.platform.tenant_scope import call_with_tenant, clone_service_with_overrides
from nanobot.utils.helpers import safe_filename, sync_workspace_templates


class MemoryCandidateValidationError(ValueError):
    """Raised when an agent memory request is invalid."""


class MemoryService:
    """Manage one stable four-file memory workspace per agent."""

    ROOT_FILES = ("AGENTS.md", "SOUL.md", "PROFILE.md", "MEMORY.md")

    def __init__(
        self,
        *,
        instance: PlatformInstance,
        instance_id: str,
        tenant_id: str = "default",
        agent_lookup: Callable[[str], Any] | None = None,
    ):
        self.instance = instance
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.agent_lookup = agent_lookup

    def with_tenant(self, tenant_id: str | None) -> MemoryService:
        """Return a lightweight tenant-scoped view over the shared service."""
        normalized = str(tenant_id or "default").strip() or "default"
        if normalized == self.tenant_id:
            return self
        return clone_service_with_overrides(self, tenant_id=normalized)

    @staticmethod
    def _normalize_text(value: Any, *, field_name: str = "value", required: bool = False) -> str:
        text = str(value or "").strip()
        if required and not text:
            raise MemoryCandidateValidationError(f"{field_name} is required.")
        return text

    def _require_agent(self, agent_id: str) -> str:
        normalized = self._normalize_text(agent_id, field_name="agentId", required=True)
        if self.agent_lookup is None:
            return normalized
        try:
            call_with_tenant(self.agent_lookup, normalized, tenant_id=self.tenant_id)
        except Exception as exc:  # pragma: no cover - defensive wrapper around injected lookup
            raise MemoryCandidateValidationError(f"agentId '{normalized}' does not exist.") from exc
        return normalized

    @staticmethod
    def _read_file(path: Path) -> str:
        return path.read_text(encoding="utf-8") if path.exists() else ""

    @staticmethod
    def _write_file(path: Path, content: str) -> None:
        normalized = str(content or "").replace("\r\n", "\n").replace("\r", "\n")
        path.write_text(normalized.rstrip() + ("\n" if normalized else ""), encoding="utf-8")

    @staticmethod
    def _updated_at_for(path: Path) -> str | None:
        if not path.exists():
            return None
        return datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat().replace("+00:00", "Z")

    def _agent_memory_root(self, agent_id: str) -> Path:
        binding = TenantScopedWorkspaceProvider(delegate=AgentWorkspaceProvider()).resolve(
            workspace=self.instance.workspace_path(),
            restrict_to_workspace=False,
            principal_kind="agent",
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            principal_id=safe_filename(agent_id),
        )
        binding.path.mkdir(parents=True, exist_ok=True)
        if any(not (binding.path / name).exists() for name in self.ROOT_FILES):
            sync_workspace_templates(binding.path, silent=True)
        else:
            (binding.path / "memory").mkdir(parents=True, exist_ok=True)
        return binding.path

    def _build_file_snapshot(self, path: Path) -> dict[str, Any]:
        return {
            "fileName": path.name,
            "content": self._read_file(path),
            "updatedAt": self._updated_at_for(path),
        }

    def get_agent_memory(self, agent_id: str) -> dict[str, Any]:
        agent_id = self._require_agent(agent_id)
        root = self._agent_memory_root(agent_id)

        files = {
            name: self._build_file_snapshot(root / name)
            for name in self.ROOT_FILES
        }

        notes_dir = root / "memory"
        daily_note_paths = sorted(
            (
                path
                for path in notes_dir.glob("*.md")
                if path.is_file()
            ),
            key=lambda path: path.name,
            reverse=True,
        )
        daily_notes = [
            self._build_file_snapshot(path)
            for path in daily_note_paths[:14]
        ]

        updated_candidates = [
            snapshot.get("updatedAt")
            for snapshot in list(files.values()) + daily_notes
            if snapshot.get("updatedAt")
        ]
        updated_at = max(updated_candidates) if updated_candidates else None

        return {
            "agentId": agent_id,
            "rootPath": str(root),
            "files": files,
            "dailyNotes": daily_notes,
            "updatedAt": updated_at,
        }

    def update_agent_memory(self, agent_id: str, files: dict[str, Any]) -> dict[str, Any]:
        agent_id = self._require_agent(agent_id)
        if not isinstance(files, dict):
            raise MemoryCandidateValidationError("files must be an object.")
        unknown = sorted(set(files) - set(self.ROOT_FILES))
        if unknown:
            raise MemoryCandidateValidationError(
                f"Unsupported memory files: {', '.join(unknown)}."
            )

        root = self._agent_memory_root(agent_id)
        for name in self.ROOT_FILES:
            if name not in files:
                continue
            self._write_file(root / name, str(files.get(name) or ""))
        return self.get_agent_memory(agent_id)
