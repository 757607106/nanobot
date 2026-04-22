"""Runtime path helpers derived from the active config context."""

from __future__ import annotations

from pathlib import Path

from nanobot.config.loader import get_config_path
from nanobot.utils.helpers import ensure_dir


def get_data_dir() -> Path:
    """Return the instance-level runtime data directory."""
    return ensure_dir(get_config_path().parent)


def get_runtime_subdir(name: str) -> Path:
    """Return a named runtime subdirectory under the instance data dir."""
    return ensure_dir(get_data_dir() / name)


def get_media_dir(channel: str | None = None) -> Path:
    """Return the media directory, optionally namespaced per channel."""
    base = get_runtime_subdir("media")
    return ensure_dir(base / channel) if channel else base


def get_logs_dir() -> Path:
    """Return the logs directory."""
    return get_runtime_subdir("logs")


def get_workspace_path(workspace: str | None = None) -> Path:
    """Resolve and ensure the agent workspace path."""
    path = Path(workspace).expanduser() if workspace else Path.home() / ".nanobot" / "workspace"
    return ensure_dir(path)


def get_cli_history_path() -> Path:
    """Return the shared CLI history file path."""
    return Path.home() / ".nanobot" / "history" / "cli_history"


def get_bridge_install_dir() -> Path:
    """Return the shared WhatsApp bridge installation directory."""
    return Path.home() / ".nanobot" / "bridge"


def find_bridge_source_dir() -> Path | None:
    """Locate the bundled WhatsApp bridge source directory.

    Prefer the standardized ``whatsapp_bridge`` directory but keep a fallback
    to the historical ``bridge`` name so dev and installed environments remain
    compatible during the rename.
    """
    current_file = Path(__file__).resolve()
    candidates = (
        current_file.parent.parent / "whatsapp_bridge",
        current_file.parent.parent.parent / "whatsapp_bridge",
        current_file.parent.parent / "bridge",
        current_file.parent.parent.parent / "bridge",
    )
    for candidate in candidates:
        if (candidate / "package.json").exists():
            return candidate
    return None


def get_legacy_sessions_dir() -> Path:
    """Return the legacy global session directory used for migration fallback."""
    return Path.home() / ".nanobot" / "sessions"
