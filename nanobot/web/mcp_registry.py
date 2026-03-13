"""MCP registry metadata for the nanobot Web UI."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from nanobot.config.schema import Config, MCPServerConfig
from nanobot.platform.instances import PlatformInstance, coerce_instance


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _default_source_label(source_kind: str) -> str:
    if source_kind == "repository":
        return "仓库安装"
    if source_kind == "manual":
        return "手动登记"
    return "现有配置"


@dataclass(slots=True)
class MCPRegistryRecord:
    """Persisted metadata for a single MCP entry."""

    name: str
    display_name: str | None = None
    source_kind: Literal["config", "manual", "repository"] = "config"
    source_label: str | None = None
    repo_url: str | None = None
    clone_url: str | None = None
    install_dir: str | None = None
    install_mode: str | None = None
    install_steps: list[str] = field(default_factory=list)
    required_env: list[str] = field(default_factory=list)
    optional_env: list[str] = field(default_factory=list)
    tool_names: list[str] = field(default_factory=list)
    tool_count: int | None = None
    last_tool_sync_at: str | None = None
    last_checked_at: str | None = None
    last_probe_status: str | None = None
    last_error: str | None = None
    updated_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "display_name": self.display_name,
            "source_kind": self.source_kind,
            "source_label": self.source_label,
            "repo_url": self.repo_url,
            "clone_url": self.clone_url,
            "install_dir": self.install_dir,
            "install_mode": self.install_mode,
            "install_steps": list(self.install_steps),
            "required_env": list(self.required_env),
            "optional_env": list(self.optional_env),
            "tool_names": list(self.tool_names),
            "tool_count": self.tool_count,
            "last_tool_sync_at": self.last_tool_sync_at,
            "last_checked_at": self.last_checked_at,
            "last_probe_status": self.last_probe_status,
            "last_error": self.last_error,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, name: str, payload: dict[str, Any]) -> "MCPRegistryRecord":
        source_kind = str(payload.get("source_kind") or "config")
        if source_kind not in {"config", "manual", "repository"}:
            source_kind = "config"
        tool_count = payload.get("tool_count")
        return cls(
            name=name,
            display_name=payload.get("display_name"),
            source_kind=source_kind,
            source_label=payload.get("source_label"),
            repo_url=payload.get("repo_url"),
            clone_url=payload.get("clone_url"),
            install_dir=payload.get("install_dir"),
            install_mode=payload.get("install_mode"),
            install_steps=[
                str(item).strip()
                for item in (payload.get("install_steps") or [])
                if str(item).strip()
            ],
            required_env=[
                str(item).strip()
                for item in (payload.get("required_env") or [])
                if str(item).strip()
            ],
            optional_env=[
                str(item).strip()
                for item in (payload.get("optional_env") or [])
                if str(item).strip()
            ],
            tool_names=[
                str(item).strip()
                for item in (payload.get("tool_names") or [])
                if str(item).strip()
            ],
            tool_count=tool_count if isinstance(tool_count, int) and tool_count >= 0 else None,
            last_tool_sync_at=payload.get("last_tool_sync_at"),
            last_checked_at=payload.get("last_checked_at"),
            last_probe_status=payload.get("last_probe_status"),
            last_error=payload.get("last_error"),
            updated_at=payload.get("updated_at"),
        )


@dataclass(slots=True)
class MCPRegistryState:
    """Persisted state for MCP registry metadata."""

    version: int = 1
    entries: dict[str, MCPRegistryRecord] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "entries": {
                name: record.to_dict()
                for name, record in sorted(self.entries.items(), key=lambda item: item[0])
            },
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "MCPRegistryState":
        raw_entries = payload.get("entries")
        if not isinstance(raw_entries, dict):
            raw_entries = {}
        entries = {
            str(name): MCPRegistryRecord.from_dict(str(name), item)
            for name, item in raw_entries.items()
            if isinstance(item, dict)
        }
        return cls(version=int(payload.get("version") or 1), entries=entries)


class WebMCPRegistryManager:
    """Maintains MCP registry metadata independently from raw config."""

    def __init__(self, config_path: Path | PlatformInstance):
        self._instance = coerce_instance(config_path)
        self._state_path = self._instance.mcp_registry_path()
        self._lock = threading.RLock()
        self._state = self._load_state()

    def list_servers(self, config: Config) -> dict[str, Any]:
        with self._lock:
            self._sync_with_config(config)
            items = [
                self._build_item(name, config.tools.mcp_servers[name], self._state.entries.get(name))
                for name in sorted(config.tools.mcp_servers)
            ]

            summary = {
                "total": len(items),
                "enabled": sum(1 for item in items if item["enabled"]),
                "disabled": sum(1 for item in items if not item["enabled"]),
                "ready": sum(1 for item in items if item["status"] == "ready"),
                "incomplete": sum(1 for item in items if item["status"] == "incomplete"),
                "knownToolCount": sum(item["toolCount"] or 0 for item in items),
                "verifiedServers": sum(1 for item in items if item["toolCountKnown"]),
            }
            return {"items": items, "summary": summary}

    def get_server(self, config: Config, server_name: str) -> dict[str, Any] | None:
        with self._lock:
            self._sync_with_config(config)
            cfg = config.tools.mcp_servers.get(server_name)
            if cfg is None:
                return None
            return self._build_item(server_name, cfg, self._state.entries.get(server_name))

    def find_duplicate_repo(self, repo_url: str, *, exclude_name: str | None = None) -> str | None:
        normalized = self._normalize_repo_url(repo_url)
        if not normalized:
            return None

        with self._lock:
            for name, record in self._state.entries.items():
                if exclude_name and name == exclude_name:
                    continue
                if self._normalize_repo_url(record.repo_url or "") == normalized:
                    return name
        return None

    def upsert_repository_install(
        self,
        *,
        server_name: str,
        display_name: str | None,
        repo_url: str,
        clone_url: str,
        install_dir: str | None,
        install_mode: str,
        install_steps: list[str],
        required_env: list[str],
        optional_env: list[str],
    ) -> None:
        with self._lock:
            record = self._state.entries.get(server_name) or MCPRegistryRecord(name=server_name)
            record.display_name = display_name or record.display_name or server_name
            record.source_kind = "repository"
            record.source_label = _default_source_label("repository")
            record.repo_url = self._normalize_repo_url(repo_url)
            record.clone_url = clone_url
            record.install_dir = install_dir
            record.install_mode = install_mode
            record.install_steps = list(install_steps)
            record.required_env = list(required_env)
            record.optional_env = list(optional_env)
            record.updated_at = _now_iso()
            self._state.entries[server_name] = record
            self._persist_state()

    def update_display_name(self, server_name: str, display_name: str | None) -> None:
        with self._lock:
            record = self._state.entries.get(server_name) or MCPRegistryRecord(name=server_name)
            cleaned = str(display_name or "").strip()
            record.display_name = cleaned or None
            record.updated_at = _now_iso()
            self._state.entries[server_name] = record
            self._persist_state()

    def record_probe_result(
        self,
        *,
        server_name: str,
        status: str,
        tool_names: list[str] | None,
        error: str | None,
    ) -> None:
        with self._lock:
            record = self._state.entries.get(server_name) or MCPRegistryRecord(name=server_name)
            now = _now_iso()
            cleaned_tools = [
                str(item).strip()
                for item in (tool_names or [])
                if str(item).strip()
            ]
            record.tool_names = cleaned_tools
            record.tool_count = len(cleaned_tools) if status == "passed" else record.tool_count
            record.last_tool_sync_at = now if status == "passed" else record.last_tool_sync_at
            record.last_checked_at = now
            record.last_probe_status = status
            record.last_error = str(error or "").strip() or None
            record.updated_at = now
            self._state.entries[server_name] = record
            self._persist_state()

    def remove_server(self, server_name: str) -> MCPRegistryRecord | None:
        with self._lock:
            record = self._state.entries.pop(server_name, None)
            self._persist_state()
            return record

    def _load_state(self) -> MCPRegistryState:
        if not self._state_path.exists():
            return MCPRegistryState()

        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return MCPRegistryState()

        if not isinstance(payload, dict):
            return MCPRegistryState()
        return MCPRegistryState.from_dict(payload)

    def _persist_state(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self._state_path.with_suffix(f"{self._state_path.suffix}.tmp")
        temp_path.write_text(
            json.dumps(self._state.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        temp_path.replace(self._state_path)

    def _sync_with_config(self, config: Config) -> None:
        changed = False
        now = _now_iso()
        for name in config.tools.mcp_servers:
            if name in self._state.entries:
                continue
            self._state.entries[name] = MCPRegistryRecord(
                name=name,
                source_kind="config",
                source_label=_default_source_label("config"),
                updated_at=now,
            )
            changed = True

        if changed:
            self._persist_state()

    def _build_item(
        self,
        name: str,
        cfg: MCPServerConfig,
        record: MCPRegistryRecord | None,
    ) -> dict[str, Any]:
        record = record or MCPRegistryRecord(name=name)
        transport = self._resolve_transport(cfg)
        status, status_detail = self._resolve_status(cfg, transport)
        return {
            "name": name,
            "displayName": record.display_name or name,
            "enabled": bool(cfg.enabled),
            "transport": transport,
            "status": status,
            "statusDetail": status_detail,
            "toolCount": record.tool_count,
            "toolCountKnown": record.tool_count is not None,
            "toolTimeout": cfg.tool_timeout,
            "command": cfg.command or None,
            "args": list(cfg.args),
            "env": dict(cfg.env or {}),
            "url": cfg.url or None,
            "headers": dict(cfg.headers or {}),
            "envCount": len(cfg.env or {}),
            "headerCount": len(cfg.headers or {}),
            "sourceKind": record.source_kind,
            "sourceLabel": record.source_label or _default_source_label(record.source_kind),
            "repoUrl": record.repo_url,
            "cloneUrl": record.clone_url,
            "installDir": record.install_dir,
            "installMode": record.install_mode,
            "installSteps": list(record.install_steps),
            "requiredEnv": list(record.required_env),
            "optionalEnv": list(record.optional_env),
            "toolNames": list(record.tool_names),
            "lastToolSyncAt": record.last_tool_sync_at,
            "lastCheckedAt": record.last_checked_at,
            "lastProbeStatus": record.last_probe_status,
            "lastError": record.last_error,
            "updatedAt": record.updated_at,
        }

    @staticmethod
    def _resolve_transport(cfg: MCPServerConfig) -> str:
        transport = (cfg.type or "").strip()
        if transport in {"stdio", "sse", "streamableHttp"}:
            return transport
        if cfg.command:
            return "stdio"
        if cfg.url:
            return "sse" if cfg.url.rstrip("/").endswith("/sse") else "streamableHttp"
        return "unknown"

    @staticmethod
    def _resolve_status(cfg: MCPServerConfig, transport: str) -> tuple[str, str]:
        if not cfg.enabled:
            return "disabled", "该 MCP 已停用，不会参与聊天运行时加载。"
        if transport == "stdio" and not cfg.command:
            return "incomplete", "stdio 传输缺少 command，当前只能作为未完成配置展示。"
        if transport in {"sse", "streamableHttp"} and not cfg.url:
            return "incomplete", "HTTP 传输缺少 url，当前无法建立连接。"
        if transport == "unknown":
            return "incomplete", "既没有 command，也没有 url，无法判断传输方式。"
        return "ready", "配置结构完整，等待首次探测或运行时按需加载。"

    @staticmethod
    def _normalize_repo_url(value: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        normalized = raw.rstrip("/")
        if normalized.endswith(".git"):
            normalized = normalized[:-4]
        return normalized.lower()
