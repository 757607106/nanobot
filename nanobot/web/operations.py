"""Dashboard and validation helpers for the Web UI."""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from nanobot.config.schema import Config
from nanobot.platform.instances import PlatformInstance, coerce_instance
from nanobot.providers.registry import PROVIDERS
from nanobot.web.mcp_registry import WebMCPRegistryManager
from nanobot.web.setup import WebSetupManager

ACTION_DEFINITIONS = {
    "restart": {
        "label": "重启实例",
        "env_var": "NANOBOT_WEB_RESTART_COMMAND",
        "description": "显式调用外部重启命令，适用于受控部署或 supervisor 环境。",
        "caution": "只会执行已经通过环境变量声明的命令，不会自动推断部署方式。",
    },
    "update": {
        "label": "更新实例",
        "env_var": "NANOBOT_WEB_UPDATE_COMMAND",
        "description": "显式调用外部更新命令，适用于受控的拉取/部署流水线。",
        "caution": "更新动作不会默认开放，必须由部署方提供命令并承担执行语义。",
    },
}


def get_logs_dir() -> Path:
    """Compatibility wrapper for legacy callers while instance migration is in progress."""
    return coerce_instance(None).logs_dir()


class WebOperationsService:
    """Builds validation, logs, and operations payloads from current runtime state."""

    def __init__(
        self,
        setup: WebSetupManager,
        mcp_registry: WebMCPRegistryManager,
        instance: PlatformInstance | Path | None = None,
    ):
        self._setup = setup
        self._mcp_registry = mcp_registry
        self._instance = coerce_instance(instance)
        self._action_lock = threading.RLock()
        self._action_records: dict[str, dict[str, Any]] = {}

    def run_validation(self, *, config: Config) -> dict[str, Any]:
        setup_status = self._setup.get_status(config)
        checks = [
            self._provider_check(config, setup_status),
            self._runtime_check(config),
            self._gateway_check(config),
            self._paths_check(config),
            self._mcp_check(config),
        ]
        dangerous_options = self._dangerous_options(config)

        passed = sum(1 for item in checks if item["status"] == "pass")
        warnings = sum(1 for item in checks if item["status"] == "warn")
        failures = sum(1 for item in checks if item["status"] == "fail")
        summary_status = "ready" if failures == 0 and warnings == 0 else "attention" if failures == 0 else "blocked"

        return {
            "generatedAt": _iso_now(),
            "summary": {
                "status": summary_status,
                "passed": passed,
                "warnings": warnings,
                "failures": failures,
            },
            "checks": checks,
            "dangerousOptions": dangerous_options,
        }

    def get_logs(self, *, lines: int = 200) -> dict[str, Any]:
        limit = min(max(int(lines or 200), 20), 400)
        logs_dir = self._instance.logs_dir()
        items = []
        for path in sorted(logs_dir.glob("*"), key=lambda item: item.stat().st_mtime, reverse=True):
            if not path.is_file():
                continue
            raw_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            stat = path.stat()
            items.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "sizeBytes": stat.st_size,
                    "lineCount": len(raw_lines),
                    "updatedAt": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat().replace("+00:00", "Z"),
                    "tail": raw_lines[-limit:],
                }
            )
        return {"items": items}

    def get_actions(self, *, config: Config) -> dict[str, Any]:
        with self._action_lock:
            return {
                "items": [
                    self._build_action_item(name, config.workspace_path)
                    for name in ACTION_DEFINITIONS
                ]
            }

    def trigger_action(self, action_name: str, *, config: Config) -> dict[str, Any]:
        if action_name not in ACTION_DEFINITIONS:
            raise ValueError("Unknown action.")

        with self._action_lock:
            item = self._build_action_item(action_name, config.workspace_path)
            if not item["configured"]:
                raise ValueError(f"{item['label']} 未配置环境变量命令。")
            if item["running"]:
                raise ValueError(f"{item['label']} 正在执行，请稍后再试。")

            definition = ACTION_DEFINITIONS[action_name]
            command = str(os.getenv(definition["env_var"], "")).strip()
            process = self._spawn_action(command, config.workspace_path)
            self._action_records[action_name] = {
                "process": process,
                "requested_at": _iso_now(),
                "pid": process.pid,
            }
            return {
                "item": self._build_action_item(action_name, config.workspace_path),
            }

    def _provider_check(self, config: Config, setup_status: dict[str, Any]) -> dict[str, Any]:
        provider_name = str(config.agents.defaults.provider or "").strip()
        model = str(config.agents.defaults.model or "").strip()
        step = next(item for item in setup_status["steps"] if item["key"] == "provider")
        if not step["complete"]:
            return _check(
                key="provider",
                category="provider",
                status="fail",
                label="模型供应商",
                summary="模型供应商尚未完成初始化。",
                detail="请先补齐 provider、model 和 API 凭据。",
                href="/setup",
                action_label="继续向导",
            )

        spec = next((item for item in PROVIDERS if item.name == provider_name), None)
        provider_cfg = getattr(config.providers, provider_name, None)
        detail = f"当前使用 {provider_name or 'unknown'} · 模型 {model or '--'}"
        if spec is None:
            return _check(
                key="provider",
                category="provider",
                status="warn",
                label="模型供应商",
                summary="当前 provider 不在内置注册表中。",
                detail=detail,
                href="/models",
                action_label="检查模型",
            )
        if provider_cfg and (provider_cfg.api_key or provider_cfg.api_base or spec.is_oauth or spec.is_local):
            return _check(
                key="provider",
                category="provider",
                status="pass",
                label="模型供应商",
                summary="模型供应商配置完整。",
                detail=detail,
                href="/models",
                action_label="查看模型",
            )
        return _check(
            key="provider",
            category="provider",
            status="warn",
            label="模型供应商",
            summary="当前 provider 缺少显式凭据或 API Base。",
            detail=detail,
            href="/models",
            action_label="补齐模型",
        )

    def _runtime_check(self, config: Config) -> dict[str, Any]:
        required = ["python3", "git"]
        mcp_payload = self._mcp_registry.list_servers(config)
        for item in mcp_payload["items"]:
            install_mode = str(item.get("installMode") or "").strip()
            if install_mode == "source":
                for step in item.get("installSteps") or []:
                    lower = str(step).lower()
                    if lower.startswith("npm "):
                        required.extend(["node", "npm"])
                    if lower.startswith("uv "):
                        required.append("uv")
                    if lower.startswith("python") or "pip install" in lower:
                        required.append("python3")
            if item.get("transport") == "stdio" and item.get("command"):
                required.append(str(item["command"]))

        ordered: list[str] = []
        for command in required:
            if command not in ordered:
                ordered.append(command)

        missing = [command for command in ordered if shutil.which(command) is None]
        if missing:
            return _check(
                key="runtime",
                category="runtime",
                status="warn",
                label="本地运行时",
                summary="发现部分本地运行时缺失。",
                detail="缺失命令: " + ", ".join(missing),
                href="/system/validation",
                action_label="查看验证",
            )
        return _check(
            key="runtime",
            category="runtime",
            status="pass",
            label="本地运行时",
            summary="核心运行时已就绪。",
            detail="已检查: " + ", ".join(ordered),
            href="/system/validation",
            action_label="查看详情",
        )

    def _gateway_check(self, config: Config) -> dict[str, Any]:
        host = str(config.gateway.host or "").strip()
        port = int(config.gateway.port or 0)
        if not host or port <= 0 or port > 65535:
            return _check(
                key="gateway",
                category="gateway",
                status="fail",
                label="网关与服务地址",
                summary="当前网关 host/port 无效。",
                detail=f"host={host or '--'} · port={port or '--'}",
                href="/system/validation",
                action_label="查看验证",
            )
        heartbeat = config.gateway.heartbeat
        if heartbeat.enabled and heartbeat.interval_s <= 0:
            return _check(
                key="gateway",
                category="gateway",
                status="warn",
                label="网关与服务地址",
                summary="心跳已启用，但间隔设置无效。",
                detail=f"host={host} · port={port} · heartbeat={heartbeat.interval_s}",
                href="/system/validation",
                action_label="查看验证",
            )
        return _check(
            key="gateway",
            category="gateway",
            status="pass",
            label="网关与服务地址",
            summary="网关监听配置有效。",
            detail=f"host={host} · port={port}",
            href="/system",
            action_label="查看系统状态",
        )

    def _paths_check(self, config: Config) -> dict[str, Any]:
        workspace = config.workspace_path
        config_path = self._instance.config_path
        logs_dir = self._instance.logs_dir()
        issues: list[str] = []
        if not workspace.exists():
            issues.append("工作区不存在")
        if not os.access(workspace, os.W_OK):
            issues.append("工作区不可写")
        if not config_path.exists():
            issues.append("配置文件不存在")
        if not logs_dir.exists():
            issues.append("日志目录不存在")

        if issues:
            return _check(
                key="paths",
                category="paths",
                status="fail",
                label="工作区与路径",
                summary="运行时路径存在问题。",
                detail="；".join(issues),
                href="/system/validation",
                action_label="查看验证",
            )
        return _check(
            key="paths",
            category="paths",
            status="pass",
            label="工作区与路径",
            summary="工作区、配置和日志目录均可访问。",
            detail=f"workspace={workspace} · config={config_path}",
            href="/system",
            action_label="查看系统状态",
        )

    def _mcp_check(self, config: Config) -> dict[str, Any]:
        payload = self._mcp_registry.list_servers(config)
        items = payload["items"]
        if not items:
            return _check(
                key="mcp",
                category="mcp",
                status="warn",
                label="MCP 服务",
                summary="当前还没有配置任何 MCP。",
                detail="如果当前工作流依赖外部工具或私有知识库，可以在 MCP 页面中继续安装。",
                href="/mcp",
                action_label="打开 MCP",
            )

        failing = [
            item["displayName"]
            for item in items
            if item["enabled"] and (item["status"] == "incomplete" or item.get("lastProbeStatus") == "failed")
        ]
        blocked = [
            item["displayName"]
            for item in items
            if item.get("lastProbeStatus") == "blocked"
        ]
        if failing or blocked:
            names = failing + blocked
            return _check(
                key="mcp",
                category="mcp",
                status="warn",
                label="MCP 服务",
                summary="有 MCP 仍需补齐配置或重新探测。",
                detail="待处理: " + ", ".join(names),
                href="/mcp",
                action_label="检查 MCP",
            )

        return _check(
            key="mcp",
            category="mcp",
            status="pass",
            label="MCP 服务",
            summary="MCP 索引可用，未发现阻塞项。",
            detail=f"共 {payload['summary']['total']} 个 MCP，其中 {payload['summary']['enabled']} 个已启用。",
            href="/mcp",
            action_label="查看 MCP",
        )

    def _dangerous_options(self, config: Config) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if not config.tools.restrict_to_workspace:
            items.append(
                {
                    "key": "workspace-scope",
                    "label": "未限制到工作区",
                    "status": "warn",
                    "summary": "Exec/Web 等能力当前不受工作区目录限制。",
                    "detail": "如果这是生产环境，建议启用 restrictToWorkspace 以降低误操作范围。",
                    "href": "/system/validation",
                    "actionLabel": "查看验证",
                }
            )
        if str(config.gateway.host or "").strip() in {"0.0.0.0", "::"}:
            items.append(
                {
                    "key": "public-bind",
                    "label": "对所有地址监听",
                    "status": "warn",
                    "summary": "当前网关绑定了公网/全局监听地址。",
                    "detail": "请确认部署网络边界已经妥善隔离。",
                    "href": "/system/validation",
                    "actionLabel": "查看验证",
                }
            )
        return items

    def _build_action_item(self, action_name: str, workspace_path: Path) -> dict[str, Any]:
        definition = ACTION_DEFINITIONS[action_name]
        command = str(os.getenv(definition["env_var"], "")).strip()
        record = self._action_records.get(action_name, {})
        process = record.get("process")
        exit_code = None
        running = False
        last_status = "idle"
        if process is not None:
            exit_code = process.poll()
            running = exit_code is None
            if running:
                last_status = "running"
            else:
                last_status = "success" if exit_code == 0 else "failed"
        if not command:
            last_status = "unconfigured"

        return {
            "name": action_name,
            "label": definition["label"],
            "configured": bool(command),
            "running": running,
            "commandPreview": command or None,
            "workspace": str(workspace_path),
            "description": definition["description"],
            "caution": definition["caution"],
            "lastRequestedAt": record.get("requested_at"),
            "lastStatus": last_status,
            "lastExitCode": exit_code,
            "pid": record.get("pid"),
        }

    @staticmethod
    def _spawn_action(command: str, workspace_path: Path) -> subprocess.Popen[str]:
        if os.name == "nt":
            return subprocess.Popen(
                command,
                cwd=str(workspace_path),
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        return subprocess.Popen(
            ["/bin/sh", "-lc", command],
            cwd=str(workspace_path),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

def _check(
    *,
    key: str,
    category: str,
    status: str,
    label: str,
    summary: str,
    detail: str,
    href: str,
    action_label: str,
) -> dict[str, Any]:
    return {
        "key": key,
        "category": category,
        "status": status,
        "label": label,
        "summary": summary,
        "detail": detail,
        "href": href,
        "actionLabel": action_label,
    }

def _iso_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
