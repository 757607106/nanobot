"""MCP resource models."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class McpToolDefinition:
    """A tool discovered from a specific MCP server."""

    server_name: str
    tool_name: str
    tenant_id: str
    instance_id: str
    enabled: bool = True
    description: str = ""
    input_schema: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "McpToolDefinition":
        return cls(
            server_name=record["server_name"],
            tool_name=record["tool_name"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            enabled=bool(record.get("enabled", True)),
            description=record.get("description") or "",
            input_schema=json.loads(record.get("input_schema_json") or "{}"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["serverName"] = payload.pop("server_name")
        payload["toolName"] = payload.pop("tool_name")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["inputSchema"] = payload.pop("input_schema")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload


@dataclass(slots=True)
class McpServerDefinition:
    """A reusable MCP server configuration resource."""

    server_name: str
    tenant_id: str
    instance_id: str
    display_name: str | None = None
    source_kind: str = "config"
    source_label: str | None = None
    enabled: bool = True
    transport: str = "stdio"
    command: str | None = None
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    url: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    tool_timeout: int = 30
    repo_url: str | None = None
    clone_url: str | None = None
    install_dir: str | None = None
    install_mode: str | None = None
    install_steps: list[str] = field(default_factory=list)
    required_env: list[str] = field(default_factory=list)
    optional_env: list[str] = field(default_factory=list)
    last_tool_sync_at: str | None = None
    last_checked_at: str | None = None
    last_probe_status: str | None = None
    last_error: str | None = None
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        return json.dumps(
            {
                "display_name": self.display_name,
                "source_kind": self.source_kind,
                "source_label": self.source_label,
                "transport": self.transport,
                "command": self.command,
                "args": self.args,
                "env": self.env,
                "url": self.url,
                "headers": self.headers,
                "tool_timeout": self.tool_timeout,
                "repo_url": self.repo_url,
                "clone_url": self.clone_url,
                "install_dir": self.install_dir,
                "install_mode": self.install_mode,
                "install_steps": self.install_steps,
                "required_env": self.required_env,
                "optional_env": self.optional_env,
                "last_tool_sync_at": self.last_tool_sync_at,
                "last_checked_at": self.last_checked_at,
                "last_probe_status": self.last_probe_status,
                "last_error": self.last_error,
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "McpServerDefinition":
        stored = json.loads(record["config_json"])
        return cls(
            server_name=record["server_name"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            display_name=stored.get("display_name"),
            source_kind=stored.get("source_kind") or "config",
            source_label=stored.get("source_label"),
            enabled=bool(record.get("enabled", True)),
            transport=stored.get("transport") or "stdio",
            command=stored.get("command"),
            args=list(stored.get("args") or []),
            env=dict(stored.get("env") or {}),
            url=stored.get("url"),
            headers=dict(stored.get("headers") or {}),
            tool_timeout=int(stored.get("tool_timeout") or 30),
            repo_url=stored.get("repo_url"),
            clone_url=stored.get("clone_url"),
            install_dir=stored.get("install_dir"),
            install_mode=stored.get("install_mode"),
            install_steps=list(stored.get("install_steps") or []),
            required_env=list(stored.get("required_env") or []),
            optional_env=list(stored.get("optional_env") or []),
            last_tool_sync_at=stored.get("last_tool_sync_at"),
            last_checked_at=stored.get("last_checked_at"),
            last_probe_status=stored.get("last_probe_status"),
            last_error=stored.get("last_error"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["serverName"] = payload.pop("server_name")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["displayName"] = payload.pop("display_name")
        payload["sourceKind"] = payload.pop("source_kind")
        payload["sourceLabel"] = payload.pop("source_label")
        payload["toolTimeout"] = payload.pop("tool_timeout")
        payload["repoUrl"] = payload.pop("repo_url")
        payload["cloneUrl"] = payload.pop("clone_url")
        payload["installDir"] = payload.pop("install_dir")
        payload["installMode"] = payload.pop("install_mode")
        payload["installSteps"] = payload.pop("install_steps")
        payload["requiredEnv"] = payload.pop("required_env")
        payload["optionalEnv"] = payload.pop("optional_env")
        payload["lastToolSyncAt"] = payload.pop("last_tool_sync_at")
        payload["lastCheckedAt"] = payload.pop("last_checked_at")
        payload["lastProbeStatus"] = payload.pop("last_probe_status")
        payload["lastError"] = payload.pop("last_error")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload
