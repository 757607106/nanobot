"""First-run setup state for the nanobot Web UI."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from nanobot.config.schema import Config
from nanobot.platform.instances import PlatformInstance, coerce_instance
from nanobot.providers.registry import PROVIDERS


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class SetupState:
    """Persisted setup progress."""

    provider_configured_at: str | None = None
    channel_configured_at: str | None = None
    channel_skipped: bool = False
    agent_configured_at: str | None = None
    completed_at: str | None = None
    updated_at: str | None = None
    version: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "provider_configured_at": self.provider_configured_at,
            "channel_configured_at": self.channel_configured_at,
            "channel_skipped": self.channel_skipped,
            "agent_configured_at": self.agent_configured_at,
            "completed_at": self.completed_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "SetupState":
        return cls(
            provider_configured_at=payload.get("provider_configured_at"),
            channel_configured_at=payload.get("channel_configured_at"),
            channel_skipped=bool(payload.get("channel_skipped", False)),
            agent_configured_at=payload.get("agent_configured_at"),
            completed_at=payload.get("completed_at"),
            updated_at=payload.get("updated_at"),
            version=int(payload.get("version") or 1),
        )


class WebSetupManager:
    """Tracks first-run setup completion independently from the config payload."""

    def __init__(self, config_path: Path | PlatformInstance):
        self._instance = coerce_instance(config_path)
        self._state_path = self._instance.setup_state_path()
        self._lock = threading.RLock()
        self._state = self._load_state()
        self._baseline = Config().agents.defaults

    def get_status(self, config: Config) -> dict[str, Any]:
        with self._lock:
            provider_complete = bool(self._state.provider_configured_at) or self._provider_ready(config)
            channel_complete = (
                self._state.channel_skipped
                or bool(self._state.channel_configured_at)
                or self._channel_ready(config)
            )
            agent_complete = bool(self._state.agent_configured_at) or self._agent_ready(config)

            steps = [
                {
                    "key": "provider",
                    "label": "模型供应商",
                    "optional": False,
                    "complete": provider_complete,
                },
                {
                    "key": "channel",
                    "label": "消息频道",
                    "optional": True,
                    "complete": channel_complete,
                    "skipped": self._state.channel_skipped,
                },
                {
                    "key": "agent",
                    "label": "Agent 默认值",
                    "optional": False,
                    "complete": agent_complete,
                },
            ]

            completed = all(item["complete"] for item in steps)
            if completed and not self._state.completed_at:
                now = _now_iso()
                self._state.completed_at = now
                self._state.updated_at = now
                self._persist_state(self._state)
            if not completed and self._state.completed_at:
                self._state.completed_at = None
                self._state.updated_at = _now_iso()
                self._persist_state(self._state)

            current_step = next((item["key"] for item in steps if not item["complete"]), "done")
            return {
                "completed": completed,
                "currentStep": current_step,
                "completedAt": self._state.completed_at,
                "steps": steps,
            }

    def mark_provider_configured(self, config: Config) -> dict[str, Any]:
        with self._lock:
            now = _now_iso()
            self._state.provider_configured_at = now
            self._state.updated_at = now
            self._persist_state(self._state)
        return self.get_status(config)

    def mark_channel_configured(self, config: Config) -> dict[str, Any]:
        with self._lock:
            now = _now_iso()
            self._state.channel_configured_at = now
            self._state.channel_skipped = False
            self._state.updated_at = now
            self._persist_state(self._state)
        return self.get_status(config)

    def mark_channel_skipped(self, config: Config) -> dict[str, Any]:
        with self._lock:
            now = _now_iso()
            self._state.channel_skipped = True
            self._state.channel_configured_at = None
            self._state.updated_at = now
            self._persist_state(self._state)
        return self.get_status(config)

    def mark_agent_configured(self, config: Config) -> dict[str, Any]:
        with self._lock:
            now = _now_iso()
            self._state.agent_configured_at = now
            self._state.updated_at = now
            self._persist_state(self._state)
        return self.get_status(config)

    def _load_state(self) -> SetupState:
        if not self._state_path.exists():
            return SetupState()

        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Failed to parse setup state from {self._state_path}.") from exc

        return SetupState.from_dict(payload)

    def _persist_state(self, state: SetupState) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self._state_path.with_suffix(f"{self._state_path.suffix}.tmp")
        temp_path.write_text(
            json.dumps(state.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        temp_path.replace(self._state_path)

    def _provider_ready(self, config: Config) -> bool:
        provider_name = str(config.agents.defaults.provider or "").strip()
        model = str(config.agents.defaults.model or "").strip()
        if not provider_name or provider_name == "auto" or not model:
            return False

        spec = next((item for item in PROVIDERS if item.name == provider_name), None)
        provider = getattr(config.providers, provider_name, None)
        if spec is None:
            return False
        if spec.is_oauth:
            return True
        if provider_name == "custom":
            return bool(provider and provider.api_base)
        if provider_name == "azure_openai":
            return bool(provider and provider.api_base and provider.api_key)
        if spec.is_local:
            return bool(provider and (provider.api_base or spec.default_api_base))
        return bool(
            provider
            and (
                provider.api_key
                or provider.api_base
                or (provider.extra_headers and len(provider.extra_headers) > 0)
            )
        )

    def _channel_ready(self, config: Config) -> bool:
        channels = config.channels.model_dump(by_alias=True)
        for key, value in channels.items():
            if key in {"sendProgress", "sendToolHints"}:
                continue
            if isinstance(value, dict) and value.get("enabled"):
                return True
        return False

    def _agent_ready(self, config: Config) -> bool:
        defaults = config.agents.defaults
        return any(
            [
                defaults.max_tokens != self._baseline.max_tokens,
                defaults.context_window_tokens != self._baseline.context_window_tokens,
                defaults.temperature != self._baseline.temperature,
                defaults.max_tool_iterations != self._baseline.max_tool_iterations,
                (defaults.reasoning_effort or None) != (self._baseline.reasoning_effort or None),
            ]
        )
