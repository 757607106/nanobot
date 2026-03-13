"""Instance lookup and coercion helpers for the platform layer."""

from __future__ import annotations

import re
from pathlib import Path

from nanobot.config.loader import get_config_path
from nanobot.platform.instances.models import PlatformInstance


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "instance"


class PlatformInstanceService:
    """Creates instance references without changing the legacy runtime contract."""

    def get_default_instance(self, config_path: Path | None = None) -> PlatformInstance:
        path = (config_path or get_config_path()).expanduser().resolve()
        default_path = (Path.home() / ".nanobot" / "config.json").expanduser().resolve()

        if path == default_path:
            instance_id = "default"
            label = "默认实例"
        else:
            instance_id = _slugify(path.parent.name or path.stem)
            label = path.parent.name or path.stem or "实例"

        return PlatformInstance(
            id=instance_id,
            label=label,
            config_path=path,
        )


def coerce_instance(instance_or_path: PlatformInstance | Path | None = None) -> PlatformInstance:
    """Accept a platform instance, a config path, or nothing and return a PlatformInstance."""
    if isinstance(instance_or_path, PlatformInstance):
        return instance_or_path
    return PlatformInstanceService().get_default_instance(instance_or_path)
