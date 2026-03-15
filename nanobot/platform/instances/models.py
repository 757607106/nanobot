"""Typed instance model used by the Web control plane."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from nanobot.config import loader as config_loader
from nanobot.config.paths import get_workspace_path
from nanobot.config.schema import Config
from nanobot.utils.helpers import ensure_dir


@dataclass(frozen=True, slots=True)
class PlatformInstance:
    """Represents a single nanobot instance boundary for Web/platform code."""

    id: str
    label: str
    config_path: Path

    def bind(self) -> None:
        """Bind this instance as the active config context for legacy runtime helpers."""
        config_loader.set_config_path(self.config_path)

    def load_config(self) -> Config:
        """Load the config for this instance."""
        return config_loader.load_config(self.config_path)

    def save_config(self, config: Config) -> None:
        """Persist the config for this instance."""
        config_loader.save_config(config, self.config_path)

    @property
    def data_dir(self) -> Path:
        """Return the runtime data directory scoped to this instance."""
        return ensure_dir(self.config_path.parent)

    def runtime_dir(self, name: str) -> Path:
        """Return a named runtime directory for this instance."""
        return ensure_dir(self.data_dir / name)

    def logs_dir(self) -> Path:
        return self.runtime_dir("logs")

    def cron_dir(self) -> Path:
        return self.runtime_dir("cron")

    def media_dir(self, channel: str | None = None) -> Path:
        base = self.runtime_dir("media")
        return ensure_dir(base / channel) if channel else base

    def workspace_path(self, config: Config | None = None) -> Path:
        """Resolve the workspace path for this instance."""
        resolved = config.workspace_path if config is not None else self.load_config().workspace_path
        return get_workspace_path(str(resolved))

    def auth_state_path(self) -> Path:
        return self.data_dir / "web-auth.json"

    def profile_dir(self) -> Path:
        return ensure_dir(self.data_dir / "web-profile")

    def setup_state_path(self) -> Path:
        return self.data_dir / "web-setup.json"

    def agent_runs_db_path(self) -> Path:
        return self.data_dir / "web-agent-runs.db"

    def agent_definitions_db_path(self) -> Path:
        return self.data_dir / "web-agents.db"

    def agent_artifacts_dir(self) -> Path:
        return ensure_dir(self.data_dir / "agent-artifacts")

    def agent_run_exports_dir(self) -> Path:
        return ensure_dir(self.data_dir / "agent-run-exports")

    def knowledge_db_path(self) -> Path:
        return self.data_dir / "web-knowledge.db"

    def team_definitions_db_path(self) -> Path:
        return self.data_dir / "web-teams.db"

    def memory_db_path(self) -> Path:
        return self.data_dir / "web-memory.db"

    def team_memory_dir(self) -> Path:
        return ensure_dir(self.data_dir / "team-memory")

    def knowledge_files_dir(self) -> Path:
        return ensure_dir(self.data_dir / "knowledge-files")

    def knowledge_parsed_dir(self) -> Path:
        return ensure_dir(self.data_dir / "knowledge-parsed")

    def mcp_registry_path(self) -> Path:
        return self.data_dir / "web-mcp-registry.json"

    def tenants_db_path(self) -> Path:
        return self.data_dir / "web-tenants.db"

    def channel_bindings_db_path(self) -> Path:
        return self.data_dir / "web-channel-bindings.db"

    def mcp_installs_dir(self) -> Path:
        return ensure_dir(self.data_dir / "mcp-installs")

    def bridge_install_dir(self) -> Path:
        return ensure_dir(self.data_dir / "bridge")
