"""Service layer for MCP server and tool resources."""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Any

from nanobot.platform.mcp_resources.models import McpServerDefinition, McpToolDefinition, now_iso
from nanobot.platform.mcp_resources.store import McpResourceStore


class McpResourceNotFoundError(KeyError):
    """Raised when an MCP server or tool does not exist."""


class McpResourceConflictError(RuntimeError):
    """Raised when an MCP server resource would conflict."""


class McpResourceValidationError(ValueError):
    """Raised when an MCP payload is invalid."""


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "mcp-server"


class McpResourceService:
    """Instance-scoped CRUD service for MCP servers and tool states."""

    def __init__(self, store: McpResourceStore, *, instance_id: str):
        self.store = store
        self.instance_id = instance_id

    @staticmethod
    def _get_value(payload: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in payload:
                return payload[key]
        return None

    @staticmethod
    def _normalize_text(value: Any, *, field_name: str, required: bool = False) -> str:
        text = str(value or "").strip()
        if required and not text:
            raise McpResourceValidationError(f"{field_name} is required.")
        return text

    @staticmethod
    def _normalize_string_list(value: Any, *, field_name: str) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise McpResourceValidationError(f"{field_name} must be a list.")
        result: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if text and text not in result:
                result.append(text)
        return result

    @staticmethod
    def _normalize_mapping(value: Any, *, field_name: str) -> dict[str, str]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise McpResourceValidationError(f"{field_name} must be an object.")
        return {
            str(key).strip(): str(item).strip()
            for key, item in value.items()
            if str(key).strip() and str(item).strip()
        }

    def _next_server_name(self, raw_name: str) -> str:
        base = _slugify(raw_name)
        candidate = base
        counter = 2
        while self.store.get_server(candidate) is not None:
            candidate = f"{base}-{counter}"
            counter += 1
        return candidate

    def _normalize_server_create(self, payload: dict[str, Any], *, tenant_id: str) -> McpServerDefinition:
        transport = self._normalize_text(
            self._get_value(payload, "transport", "type"),
            field_name="transport",
            required=True,
        )
        if transport not in {"stdio", "sse", "streamableHttp"}:
            raise McpResourceValidationError("transport must be stdio, sse, or streamableHttp.")
        display_name = self._normalize_text(
            self._get_value(payload, "displayName", "display_name"),
            field_name="displayName",
        ) or None
        raw_name = self._normalize_text(
            self._get_value(payload, "serverName", "server_name"),
            field_name="serverName",
        ) or display_name or transport
        server_name = self._next_server_name(raw_name)
        command = self._normalize_text(self._get_value(payload, "command"), field_name="command") or None
        url = self._normalize_text(self._get_value(payload, "url"), field_name="url") or None
        if transport == "stdio" and not command:
            raise McpResourceValidationError("stdio transport requires command.")
        if transport in {"sse", "streamableHttp"} and not url:
            raise McpResourceValidationError("HTTP transport requires url.")
        now = now_iso()
        return McpServerDefinition(
            server_name=server_name,
            tenant_id=tenant_id,
            instance_id=self.instance_id,
            display_name=display_name,
            source_kind=self._normalize_text(
                self._get_value(payload, "sourceKind", "source_kind"),
                field_name="sourceKind",
            ) or "manual",
            source_label=self._normalize_text(
                self._get_value(payload, "sourceLabel", "source_label"),
                field_name="sourceLabel",
            ) or "手动登记",
            enabled=True if self._get_value(payload, "enabled") is None else bool(self._get_value(payload, "enabled")),
            transport=transport,
            command=command,
            args=self._normalize_string_list(self._get_value(payload, "args"), field_name="args"),
            env=self._normalize_mapping(self._get_value(payload, "env"), field_name="env"),
            url=url,
            headers=self._normalize_mapping(self._get_value(payload, "headers"), field_name="headers"),
            tool_timeout=max(1, int(self._get_value(payload, "toolTimeout", "tool_timeout") or 30)),
            repo_url=self._normalize_text(self._get_value(payload, "repoUrl", "repo_url"), field_name="repoUrl") or None,
            clone_url=self._normalize_text(self._get_value(payload, "cloneUrl", "clone_url"), field_name="cloneUrl") or None,
            install_dir=self._normalize_text(
                self._get_value(payload, "installDir", "install_dir"), field_name="installDir",
            ) or None,
            install_mode=self._normalize_text(
                self._get_value(payload, "installMode", "install_mode"), field_name="installMode",
            ) or None,
            install_steps=self._normalize_string_list(
                self._get_value(payload, "installSteps", "install_steps"), field_name="installSteps",
            ),
            required_env=self._normalize_string_list(
                self._get_value(payload, "requiredEnv", "required_env"), field_name="requiredEnv",
            ),
            optional_env=self._normalize_string_list(
                self._get_value(payload, "optionalEnv", "optional_env"), field_name="optionalEnv",
            ),
            last_tool_sync_at=self._normalize_text(
                self._get_value(payload, "lastToolSyncAt", "last_tool_sync_at"),
                field_name="lastToolSyncAt",
            ) or None,
            last_checked_at=self._normalize_text(
                self._get_value(payload, "lastCheckedAt", "last_checked_at"),
                field_name="lastCheckedAt",
            ) or None,
            last_probe_status=self._normalize_text(
                self._get_value(payload, "lastProbeStatus", "last_probe_status"),
                field_name="lastProbeStatus",
            ) or None,
            last_error=self._normalize_text(
                self._get_value(payload, "lastError", "last_error"),
                field_name="lastError",
            ) or None,
            created_at=now,
            updated_at=now,
        )

    def _apply_server_update(self, existing: McpServerDefinition, payload: dict[str, Any]) -> McpServerDefinition:
        transport = existing.transport
        if self._get_value(payload, "transport", "type") is not None:
            transport = self._normalize_text(
                self._get_value(payload, "transport", "type"),
                field_name="transport",
                required=True,
            )
            if transport not in {"stdio", "sse", "streamableHttp"}:
                raise McpResourceValidationError("transport must be stdio, sse, or streamableHttp.")
        command = existing.command
        if self._get_value(payload, "command") is not None:
            command = self._normalize_text(self._get_value(payload, "command"), field_name="command") or None
        url = existing.url
        if self._get_value(payload, "url") is not None:
            url = self._normalize_text(self._get_value(payload, "url"), field_name="url") or None
        if transport == "stdio" and not command:
            raise McpResourceValidationError("stdio transport requires command.")
        if transport in {"sse", "streamableHttp"} and not url:
            raise McpResourceValidationError("HTTP transport requires url.")
        return replace(
            existing,
            display_name=existing.display_name
            if self._get_value(payload, "displayName", "display_name") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "displayName", "display_name"),
                    field_name="displayName",
                ) or None
            ),
            source_kind=existing.source_kind
            if self._get_value(payload, "sourceKind", "source_kind") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "sourceKind", "source_kind"),
                    field_name="sourceKind",
                ) or "manual"
            ),
            source_label=existing.source_label
            if self._get_value(payload, "sourceLabel", "source_label") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "sourceLabel", "source_label"),
                    field_name="sourceLabel",
                ) or None
            ),
            enabled=existing.enabled if self._get_value(payload, "enabled") is None else bool(self._get_value(payload, "enabled")),
            transport=transport,
            command=command,
            args=existing.args
            if self._get_value(payload, "args") is None
            else self._normalize_string_list(self._get_value(payload, "args"), field_name="args"),
            env=existing.env
            if self._get_value(payload, "env") is None
            else self._normalize_mapping(self._get_value(payload, "env"), field_name="env"),
            url=url,
            headers=existing.headers
            if self._get_value(payload, "headers") is None
            else self._normalize_mapping(self._get_value(payload, "headers"), field_name="headers"),
            tool_timeout=existing.tool_timeout
            if self._get_value(payload, "toolTimeout", "tool_timeout") is None
            else max(1, int(self._get_value(payload, "toolTimeout", "tool_timeout") or existing.tool_timeout)),
            repo_url=existing.repo_url
            if self._get_value(payload, "repoUrl", "repo_url") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "repoUrl", "repo_url"),
                    field_name="repoUrl",
                ) or None
            ),
            clone_url=existing.clone_url
            if self._get_value(payload, "cloneUrl", "clone_url") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "cloneUrl", "clone_url"),
                    field_name="cloneUrl",
                ) or None
            ),
            install_dir=existing.install_dir
            if self._get_value(payload, "installDir", "install_dir") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "installDir", "install_dir"),
                    field_name="installDir",
                ) or None
            ),
            install_mode=existing.install_mode
            if self._get_value(payload, "installMode", "install_mode") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "installMode", "install_mode"),
                    field_name="installMode",
                ) or None
            ),
            install_steps=existing.install_steps
            if self._get_value(payload, "installSteps", "install_steps") is None
            else self._normalize_string_list(
                self._get_value(payload, "installSteps", "install_steps"),
                field_name="installSteps",
            ),
            required_env=existing.required_env
            if self._get_value(payload, "requiredEnv", "required_env") is None
            else self._normalize_string_list(
                self._get_value(payload, "requiredEnv", "required_env"),
                field_name="requiredEnv",
            ),
            optional_env=existing.optional_env
            if self._get_value(payload, "optionalEnv", "optional_env") is None
            else self._normalize_string_list(
                self._get_value(payload, "optionalEnv", "optional_env"),
                field_name="optionalEnv",
            ),
            last_tool_sync_at=existing.last_tool_sync_at
            if self._get_value(payload, "lastToolSyncAt", "last_tool_sync_at") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "lastToolSyncAt", "last_tool_sync_at"),
                    field_name="lastToolSyncAt",
                ) or None
            ),
            last_checked_at=existing.last_checked_at
            if self._get_value(payload, "lastCheckedAt", "last_checked_at") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "lastCheckedAt", "last_checked_at"),
                    field_name="lastCheckedAt",
                ) or None
            ),
            last_probe_status=existing.last_probe_status
            if self._get_value(payload, "lastProbeStatus", "last_probe_status") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "lastProbeStatus", "last_probe_status"),
                    field_name="lastProbeStatus",
                ) or None
            ),
            last_error=existing.last_error
            if self._get_value(payload, "lastError", "last_error") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "lastError", "last_error"),
                    field_name="lastError",
                ) or None
            ),
            updated_at=now_iso(),
        )

    def seed_from_legacy(self, legacy_servers: dict[str, Any], legacy_items: list[dict[str, Any]], *, tenant_id: str = "default") -> dict[str, Any]:
        created: list[str] = []
        item_lookup = {str(item.get("name") or ""): item for item in legacy_items}
        for server_name, cfg in (legacy_servers or {}).items():
            if self.store.get_server(server_name, tenant_id=tenant_id) is not None:
                continue
            item = item_lookup.get(server_name) or {}
            server = McpServerDefinition(
                server_name=server_name,
                tenant_id=tenant_id,
                instance_id=self.instance_id,
                display_name=item.get("displayName"),
                source_kind=item.get("sourceKind") or ("repository" if item.get("repoUrl") else "config"),
                source_label=item.get("sourceLabel") or ("仓库安装" if item.get("repoUrl") else "现有配置"),
                enabled=bool(getattr(cfg, "enabled", True)),
                transport=str(getattr(cfg, "type", None) or ("stdio" if getattr(cfg, "command", "") else "streamableHttp")),
                command=str(getattr(cfg, "command", "") or "") or None,
                args=[str(arg).strip() for arg in list(getattr(cfg, "args", []) or []) if str(arg).strip()],
                env={str(key).strip(): str(val).strip() for key, val in dict(getattr(cfg, "env", {}) or {}).items() if str(key).strip()},
                url=str(getattr(cfg, "url", "") or "") or None,
                headers={str(key).strip(): str(val).strip() for key, val in dict(getattr(cfg, "headers", {}) or {}).items() if str(key).strip()},
                tool_timeout=int(getattr(cfg, "tool_timeout", 30) or 30),
                repo_url=item.get("repoUrl"),
                clone_url=item.get("cloneUrl"),
                install_dir=item.get("installDir"),
                install_mode=item.get("installMode"),
                install_steps=list(item.get("installSteps") or []),
                required_env=list(item.get("requiredEnv") or []),
                optional_env=list(item.get("optionalEnv") or []),
                last_tool_sync_at=item.get("lastToolSyncAt"),
                last_checked_at=item.get("lastCheckedAt"),
                last_probe_status=item.get("lastProbeStatus"),
                last_error=item.get("lastError"),
            )
            self.store.create_server(server)
            created.append(server_name)
            tool_names = [str(item_name).strip() for item_name in list(item.get("toolNames") or []) if str(item_name).strip()]
            if tool_names:
                self.store.replace_tools(
                    server_name=server_name,
                    tenant_id=tenant_id,
                    instance_id=self.instance_id,
                    tools=[
                        McpToolDefinition(
                            server_name=server_name,
                            tool_name=tool_name,
                            tenant_id=tenant_id,
                            instance_id=self.instance_id,
                            enabled=True,
                        )
                        for tool_name in tool_names
                    ],
                )
        return {"createdServerNames": created}

    def list_servers(self, *, tenant_id: str, enabled: bool | None = None) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for server in self.store.list_servers(tenant_id=tenant_id, instance_id=self.instance_id, enabled=enabled):
            payload = server.to_dict()
            tools = self.store.list_tools(
                server_name=server.server_name,
                tenant_id=tenant_id,
                instance_id=self.instance_id,
            )
            payload["toolCount"] = len(tools)
            payload["tools"] = [tool.to_dict() for tool in tools]
            payload["status"] = "ready" if tools else "incomplete"
            items.append(payload)
        return items

    def get_server(self, server_name: str, *, tenant_id: str) -> dict[str, Any]:
        server = self.store.get_server(server_name, tenant_id=tenant_id)
        if server is None:
            raise McpResourceNotFoundError(server_name)
        payload = server.to_dict()
        payload["tools"] = [
            tool.to_dict()
            for tool in self.store.list_tools(
                server_name=server_name,
                tenant_id=tenant_id,
                instance_id=self.instance_id,
            )
        ]
        payload["toolCount"] = len(payload["tools"])
        return payload

    def require_server(self, server_name: str, *, tenant_id: str) -> McpServerDefinition:
        server = self.store.get_server(server_name, tenant_id=tenant_id)
        if server is None:
            raise McpResourceNotFoundError(server_name)
        return server

    def create_server(self, payload: dict[str, Any], *, tenant_id: str) -> dict[str, Any]:
        return self.store.create_server(self._normalize_server_create(payload, tenant_id=tenant_id)).to_dict()

    def update_server(self, server_name: str, payload: dict[str, Any], *, tenant_id: str) -> dict[str, Any]:
        server = self.require_server(server_name, tenant_id=tenant_id)
        updated = self.store.update_server(self._apply_server_update(server, payload), tenant_id=tenant_id)
        if updated is None:
            raise McpResourceNotFoundError(server_name)
        return updated.to_dict()

    def delete_server(self, server_name: str, *, tenant_id: str) -> bool:
        if not self.store.delete_server(server_name, tenant_id=tenant_id):
            raise McpResourceNotFoundError(server_name)
        return True

    def replace_tools(self, server_name: str, tools: list[dict[str, Any]], *, tenant_id: str) -> list[dict[str, Any]]:
        self.require_server(server_name, tenant_id=tenant_id)
        replaced = self.store.replace_tools(
            server_name=server_name,
            tenant_id=tenant_id,
            instance_id=self.instance_id,
            tools=[
                McpToolDefinition(
                    server_name=server_name,
                    tool_name=self._normalize_text(item.get("toolName"), field_name="toolName", required=True),
                    tenant_id=tenant_id,
                    instance_id=self.instance_id,
                    enabled=bool(item.get("enabled", True)),
                    description=self._normalize_text(item.get("description"), field_name="description"),
                    input_schema=item.get("inputSchema") or {},
                )
                for item in tools
            ],
        )
        return [tool.to_dict() for tool in replaced]

    def set_tool_enabled(self, server_name: str, tool_name: str, enabled: bool, *, tenant_id: str) -> dict[str, Any]:
        self.require_server(server_name, tenant_id=tenant_id)
        tool = self.store.set_tool_enabled(
            server_name=server_name,
            tool_name=tool_name,
            tenant_id=tenant_id,
            instance_id=self.instance_id,
            enabled=enabled,
        )
        if tool is None:
            raise McpResourceNotFoundError(f"{server_name}:{tool_name}")
        return tool.to_dict()
