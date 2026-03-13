"""Probe, update, and remove MCP servers for the Web UI."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import shutil
import threading
from contextlib import AsyncExitStack
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from nanobot.config.schema import Config, MCPServerConfig
from nanobot.platform.instances import PlatformInstance, coerce_instance
from nanobot.web.mcp_registry import WebMCPRegistryManager


class MCPServerService:
    """Operational actions for installed MCP servers."""

    def __init__(self, config_path: Path | PlatformInstance, registry: WebMCPRegistryManager):
        self._instance = coerce_instance(config_path)
        self._config_path = self._instance.config_path
        self._registry = registry
        self._installs_dir = self._instance.mcp_installs_dir()
        self._repair_lock = threading.RLock()
        self._repair_records: dict[str, dict[str, Any]] = {}

    def get_server(self, config: Config, server_name: str) -> dict[str, Any] | None:
        return self._registry.get_server(config, server_name)

    def set_enabled(
        self,
        server_name: str,
        *,
        enabled: bool,
        current_config: dict[str, Any],
        update_config,
    ) -> dict[str, Any]:
        server_payload = self._require_server_payload(current_config, server_name)
        server_payload["enabled"] = bool(enabled)
        updated_config = update_config(current_config)
        entry = self._registry.get_server(Config.model_validate(updated_config), server_name)
        return {
            "serverName": server_name,
            "enabled": bool(enabled),
            "entry": entry,
            "config": updated_config,
        }

    def update_server(
        self,
        server_name: str,
        *,
        payload: dict[str, Any],
        current_config: dict[str, Any],
        update_config,
    ) -> dict[str, Any]:
        server_payload = self._require_server_payload(current_config, server_name)

        transport = str(payload.get("type") or "").strip()
        if transport not in {"stdio", "sse", "streamableHttp"}:
            raise ValueError("type 必须是 stdio、sse 或 streamableHttp。")

        enabled = bool(payload.get("enabled", server_payload.get("enabled", True)))
        command = str(payload.get("command") or "").strip()
        args = [
            str(item).strip()
            for item in (payload.get("args") or [])
            if str(item).strip()
        ]
        url = str(payload.get("url") or "").strip()
        env = _normalize_mapping(payload.get("env") or {})
        headers = _normalize_mapping(payload.get("headers") or {})
        tool_timeout = int(payload.get("toolTimeout") or 30)

        if tool_timeout <= 0:
            raise ValueError("toolTimeout 必须大于 0。")
        if transport == "stdio" and not command:
            raise ValueError("stdio 类型必须提供 command。")
        if transport in {"sse", "streamableHttp"} and not url:
            raise ValueError("HTTP 类型必须提供 url。")

        server_payload.update(
            {
                "enabled": enabled,
                "type": transport,
                "command": command if transport == "stdio" else "",
                "args": args if transport == "stdio" else [],
                "env": env,
                "url": url if transport in {"sse", "streamableHttp"} else "",
                "headers": headers if transport in {"sse", "streamableHttp"} else {},
                "toolTimeout": tool_timeout,
            }
        )
        updated_config = update_config(current_config)
        self._registry.update_display_name(server_name, payload.get("displayName"))
        entry = self._registry.get_server(Config.model_validate(updated_config), server_name)
        return {
            "serverName": server_name,
            "entry": entry,
            "config": updated_config,
        }

    def remove_server(
        self,
        server_name: str,
        *,
        current_config: dict[str, Any],
        update_config,
    ) -> dict[str, Any]:
        self._require_server_payload(current_config, server_name)
        current_config["tools"]["mcpServers"].pop(server_name, None)
        updated_config = update_config(current_config)

        record = self._registry.remove_server(server_name)
        removed_checkout = False
        install_dir = Path(str(record.install_dir)).expanduser() if record and record.install_dir else None
        if install_dir is not None:
            try:
                if install_dir.resolve().is_relative_to(self._installs_dir.resolve()) and install_dir.exists():
                    shutil.rmtree(install_dir)
                    removed_checkout = True
            except FileNotFoundError:
                removed_checkout = False

        return {
            "deleted": True,
            "serverName": server_name,
            "checkoutRemoved": removed_checkout,
            "config": updated_config,
        }

    def probe_server(self, config: Config, server_name: str) -> dict[str, Any]:
        cfg = config.tools.mcp_servers.get(server_name)
        if cfg is None:
            raise ValueError(f"MCP '{server_name}' 不存在。")

        entry = self._registry.get_server(config, server_name)
        missing_env = [
            key
            for key in (entry.get("requiredEnv") if entry else [])
            if key and not str((cfg.env or {}).get(key, "")).strip()
        ]
        if missing_env:
            self._registry.record_probe_result(
                server_name=server_name,
                status="blocked",
                tool_names=[],
                error="缺少必填环境变量: " + ", ".join(missing_env),
            )
            refreshed = self._registry.get_server(config, server_name)
            return {
                "serverName": server_name,
                "ok": False,
                "status": "blocked",
                "statusLabel": "缺少配置",
                "toolNames": [],
                "toolCount": 0,
                "missingEnv": missing_env,
                "error": "缺少必填环境变量: " + ", ".join(missing_env),
                "entry": refreshed,
            }

        try:
            tool_names = asyncio.run(self._list_server_tools(cfg))
        except Exception as exc:  # noqa: BLE001
            message = str(exc) or type(exc).__name__
            self._registry.record_probe_result(
                server_name=server_name,
                status="failed",
                tool_names=[],
                error=message,
            )
            refreshed = self._registry.get_server(config, server_name)
            return {
                "serverName": server_name,
                "ok": False,
                "status": "failed",
                "statusLabel": "探测失败",
                "toolNames": [],
                "toolCount": 0,
                "missingEnv": [],
                "error": message,
                "entry": refreshed,
            }

        self._registry.record_probe_result(
            server_name=server_name,
            status="passed",
            tool_names=tool_names,
            error=None,
        )
        refreshed = self._registry.get_server(config, server_name)
        return {
            "serverName": server_name,
            "ok": True,
            "status": "passed",
            "statusLabel": "探测通过",
            "toolNames": tool_names,
            "toolCount": len(tool_names),
            "missingEnv": [],
            "error": None,
            "entry": refreshed,
        }

    def get_repair_plan(self, config: Config, server_name: str) -> dict[str, Any]:
        cfg = config.tools.mcp_servers.get(server_name)
        if cfg is None:
            raise ValueError(f"MCP '{server_name}' 不存在。")

        entry = self._registry.get_server(config, server_name)
        diagnosis = self._diagnose_server(config, server_name, cfg, entry or {})
        return {
            "generatedAt": _now_iso(),
            "serverName": server_name,
            "status": diagnosis["status"],
            "diagnosisCode": diagnosis["diagnosisCode"],
            "diagnosisLabel": diagnosis["diagnosisLabel"],
            "summary": diagnosis["summary"],
            "detail": diagnosis["detail"],
            "missingEnv": diagnosis["missingEnv"],
            "steps": diagnosis["steps"],
            "worker": self._build_repair_worker(),
            "run": self._build_repair_run(server_name, config.workspace_path),
            "entry": entry,
        }

    def run_repair(
        self,
        config: Config,
        server_name: str,
        *,
        dangerous_mode: bool,
    ) -> dict[str, Any]:
        plan = self.get_repair_plan(config, server_name)
        worker = plan["worker"]

        if not worker["configured"]:
            raise RuntimeError("当前未配置 MCP 修复 worker 命令。")
        if dangerous_mode and not worker["dangerousAvailable"]:
            raise PermissionError("危险修复模式未启用，需要显式设置环境变量后才能运行。")

        with self._repair_lock:
            current = self._build_repair_run(server_name, config.workspace_path)
            if current["running"]:
                raise RuntimeError("当前修复任务仍在运行，请稍后再试。")

            entry = plan.get("entry") or {}
            install_dir = Path(str(entry.get("installDir"))).expanduser() if entry.get("installDir") else None
            cwd = install_dir if install_dir and install_dir.exists() else config.workspace_path
            process = self._spawn_repair_process(
                command=str(worker["commandPreview"]),
                cwd=cwd,
                extra_env={
                    "NANOBOT_MCP_REPAIR_SERVER": server_name,
                    "NANOBOT_MCP_REPAIR_DANGEROUS": "1" if dangerous_mode else "0",
                    "NANOBOT_MCP_REPAIR_CONTEXT": json.dumps(
                        {
                            "serverName": server_name,
                            "dangerousMode": dangerous_mode,
                            "diagnosisCode": plan["diagnosisCode"],
                            "summary": plan["summary"],
                            "detail": plan["detail"],
                            "missingEnv": plan["missingEnv"],
                            "repoUrl": entry.get("repoUrl"),
                            "installDir": entry.get("installDir"),
                            "installSteps": entry.get("installSteps") or [],
                            "transport": entry.get("transport"),
                        },
                        ensure_ascii=False,
                    ),
                },
            )
            self._repair_records[server_name] = {
                "process": process,
                "requested_at": _now_iso(),
                "pid": process.pid,
                "dangerous_mode": dangerous_mode,
            }

        return self.get_repair_plan(config, server_name)

    async def _list_server_tools(self, cfg: MCPServerConfig) -> list[str]:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.sse import sse_client
        from mcp.client.stdio import stdio_client
        from mcp.client.streamable_http import streamable_http_client

        transport = self._resolve_transport(cfg)
        async with AsyncExitStack() as stack:
            if transport == "stdio":
                params = StdioServerParameters(command=cfg.command, args=cfg.args, env=cfg.env or None)
                read, write = await stack.enter_async_context(stdio_client(params))
            elif transport == "sse":
                def httpx_client_factory(
                    headers: dict[str, str] | None = None,
                    timeout: httpx.Timeout | None = None,
                    auth: httpx.Auth | None = None,
                ) -> httpx.AsyncClient:
                    merged_headers = {**(cfg.headers or {}), **(headers or {})}
                    return httpx.AsyncClient(
                        headers=merged_headers or None,
                        follow_redirects=True,
                        timeout=timeout,
                        auth=auth,
                    )

                read, write = await stack.enter_async_context(
                    sse_client(cfg.url, httpx_client_factory=httpx_client_factory)
                )
            elif transport == "streamableHttp":
                http_client = await stack.enter_async_context(
                    httpx.AsyncClient(
                        headers=cfg.headers or None,
                        follow_redirects=True,
                        timeout=None,
                    )
                )
                read, write, _ = await stack.enter_async_context(
                    streamable_http_client(cfg.url, http_client=http_client)
                )
            else:
                raise ValueError("无法识别该 MCP 的传输方式。")

            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            tools = await session.list_tools()
            return [tool.name for tool in tools.tools]

    @staticmethod
    def _resolve_transport(cfg: MCPServerConfig) -> str:
        transport = str(cfg.type or "").strip()
        if transport in {"stdio", "sse", "streamableHttp"}:
            return transport
        if cfg.command:
            return "stdio"
        if cfg.url:
            return "sse" if cfg.url.rstrip("/").endswith("/sse") else "streamableHttp"
        return "unknown"

    @staticmethod
    def _require_server_payload(current_config: dict[str, Any], server_name: str) -> dict[str, Any]:
        servers = current_config.setdefault("tools", {}).setdefault("mcpServers", {})
        server_payload = servers.get(server_name)
        if not isinstance(server_payload, dict):
            raise ValueError(f"MCP '{server_name}' 不存在。")
        return server_payload

    def _build_repair_worker(self) -> dict[str, Any]:
        command = str(os.getenv("NANOBOT_WEB_MCP_REPAIR_COMMAND", "")).strip()
        dangerous_available = str(os.getenv("NANOBOT_WEB_MCP_REPAIR_ALLOW_DANGEROUS", "")).strip() in {
            "1",
            "true",
            "TRUE",
            "yes",
        }
        return {
            "configured": bool(command),
            "commandPreview": command or None,
            "dangerousAvailable": dangerous_available,
        }

    def _build_repair_run(self, server_name: str, workspace_path: Path) -> dict[str, Any]:
        worker = self._build_repair_worker()
        with self._repair_lock:
            record = self._repair_records.get(server_name, {})
            process = record.get("process")
            exit_code = None
            running = False
            status = "idle"
            if process is not None:
                exit_code = process.poll()
                running = exit_code is None
                if running:
                    status = "running"
                else:
                    status = "success" if exit_code == 0 else "failed"
            if not worker["configured"]:
                status = "unconfigured"

            return {
                "configured": worker["configured"],
                "running": running,
                "status": status,
                "commandPreview": worker["commandPreview"],
                "lastRequestedAt": record.get("requested_at"),
                "lastExitCode": exit_code,
                "pid": record.get("pid"),
                "dangerousMode": bool(record.get("dangerous_mode", False)),
                "workspace": str(workspace_path),
            }

    def _diagnose_server(
        self,
        config: Config,
        server_name: str,
        cfg: MCPServerConfig,
        entry: dict[str, Any],
    ) -> dict[str, Any]:
        missing_env = [
            key
            for key in (entry.get("requiredEnv") or [])
            if key and not str((cfg.env or {}).get(key, "")).strip()
        ]
        if missing_env:
            return {
                "status": "blocked",
                "diagnosisCode": "missing_env",
                "diagnosisLabel": "缺少必填环境变量",
                "summary": "当前 MCP 还不能开始探测，因为缺少仓库声明的必填环境变量。",
                "detail": "请先在环境变量 JSON 中补齐: " + ", ".join(missing_env),
                "missingEnv": missing_env,
                "steps": self._repair_steps_for_missing_env(server_name, missing_env),
            }

        transport = self._resolve_transport(cfg)
        if transport == "stdio" and not str(cfg.command or "").strip():
            return {
                "status": "blocked",
                "diagnosisCode": "missing_command",
                "diagnosisLabel": "stdio 缺少命令",
                "summary": "当前 MCP 标记为 stdio，但没有 command，无法启动子进程。",
                "detail": "请补齐 command，或重新安装仓库版本以恢复受管路径。",
                "missingEnv": [],
                "steps": self._repair_steps_for_incomplete_config(entry, need="command"),
            }
        if transport in {"sse", "streamableHttp"} and not str(cfg.url or "").strip():
            return {
                "status": "blocked",
                "diagnosisCode": "missing_url",
                "diagnosisLabel": "HTTP 连接缺少 URL",
                "summary": "当前 MCP 使用 HTTP 传输，但没有可用的 URL。",
                "detail": "请补齐 URL，确认服务监听地址后再重新探测。",
                "missingEnv": [],
                "steps": self._repair_steps_for_incomplete_config(entry, need="url"),
            }

        last_status = str(entry.get("lastProbeStatus") or "").strip()
        last_error = str(entry.get("lastError") or "").strip()
        if last_status == "failed":
            return {
                "status": "attention",
                "diagnosisCode": self._error_code_from_message(last_error),
                "diagnosisLabel": self._error_label_from_message(last_error),
                "summary": self._error_summary_from_message(last_error),
                "detail": last_error or "最近一次探测失败，但后端没有返回更多错误细节。",
                "missingEnv": [],
                "steps": self._repair_steps_for_error(entry, last_error),
            }

        if entry.get("status") == "incomplete":
            return {
                "status": "attention",
                "diagnosisCode": "incomplete_config",
                "diagnosisLabel": "配置尚未完整",
                "summary": "当前 MCP 还没有达到可稳定探测的配置状态。",
                "detail": str(entry.get("statusDetail") or "请补齐连接参数后再重试。"),
                "missingEnv": [],
                "steps": self._repair_steps_for_incomplete_config(entry, need="connection"),
            }

        if last_status == "passed":
            return {
                "status": "ready",
                "diagnosisCode": "healthy",
                "diagnosisLabel": "无需修复",
                "summary": "最近一次探测已经通过，当前没有需要触发的修复动作。",
                "detail": f"{entry.get('displayName') or server_name} 当前可正常返回工具列表。",
                "missingEnv": [],
                "steps": [
                    {
                        "key": "reprobe",
                        "title": "如有改动再重新探测",
                        "description": "如果你刚修改了命令、URL 或环境变量，可以再次点击“立即探测”确认结果。",
                        "safe": True,
                    },
                ],
            }

        return {
            "status": "attention",
            "diagnosisCode": "not_tested",
            "diagnosisLabel": "等待首次探测",
            "summary": "当前配置结构完整，但还没有形成足够的探测证据。",
            "detail": "建议先执行一次“立即探测”，再决定是否需要进入修复流程。",
            "missingEnv": [],
            "steps": [
                {
                    "key": "probe",
                    "title": "先做一次探测",
                    "description": "探测会返回工具列表、缺失环境变量或底层错误，是后续修复的依据。",
                    "safe": True,
                },
            ],
        }

    @staticmethod
    def _repair_steps_for_missing_env(server_name: str, missing_env: list[str]) -> list[dict[str, Any]]:
        return [
            {
                "key": "fill-env",
                "title": "补齐必填环境变量",
                "description": f"在 {server_name} 的环境变量 JSON 中补齐 {', '.join(missing_env)}。",
                "safe": True,
            },
            {
                "key": "save-config",
                "title": "保存 MCP 详情",
                "description": "保存后会立即写回当前配置文件，避免下一次探测仍然读取旧值。",
                "safe": True,
            },
            {
                "key": "probe-again",
                "title": "重新探测",
                "description": "补齐配置后重新点击“立即探测”，确认工具列表能够正常返回。",
                "safe": True,
            },
        ]

    def _repair_steps_for_incomplete_config(self, entry: dict[str, Any], *, need: str) -> list[dict[str, Any]]:
        steps = [
            {
                "key": "edit-connection",
                "title": "补齐连接参数",
                "description": f"当前优先补齐 {need}，让 MCP 先进入可探测状态。",
                "safe": True,
            },
            {
                "key": "save-config",
                "title": "保存配置",
                "description": "保存后新的 transport、命令或 URL 会立即写回当前工作区配置。",
                "safe": True,
            },
        ]
        if entry.get("installDir") and entry.get("installSteps"):
            steps.append(
                {
                    "key": "reinstall",
                    "title": "按安装步骤复查受管目录",
                    "description": "受管安装目录和 install steps 已保留在元数据里，可以据此对照修复。",
                    "safe": True,
                }
            )
        steps.append(
            {
                "key": "probe-again",
                "title": "重新探测",
                "description": "配置补齐后重新探测，确认问题是否已经解除。",
                "safe": True,
            }
        )
        return steps

    def _repair_steps_for_error(self, entry: dict[str, Any], error: str) -> list[dict[str, Any]]:
        lower = error.lower()
        steps: list[dict[str, Any]] = []
        if "enoent" in lower or "no such file or directory" in lower:
            steps.append(
                {
                    "key": "verify-command",
                    "title": "检查命令或脚本路径",
                    "description": "最近一次失败看起来像是找不到命令、脚本或 installDir 内的可执行文件。",
                    "safe": True,
                }
            )
        elif "connection refused" in lower or "econnrefused" in lower:
            steps.append(
                {
                    "key": "verify-endpoint",
                    "title": "确认远端服务正在监听",
                    "description": "如果是 HTTP MCP，请先确认 URL 对应的服务已经启动且网络可达。",
                    "safe": True,
                }
            )
        elif "401" in lower or "403" in lower or "unauthorized" in lower or "forbidden" in lower:
            steps.append(
                {
                    "key": "verify-auth",
                    "title": "检查鉴权凭据",
                    "description": "最近一次失败像是鉴权问题，请优先核对 env、headers 和 token 是否仍然有效。",
                    "safe": True,
                }
            )
        elif "timeout" in lower or "timed out" in lower:
            steps.append(
                {
                    "key": "raise-timeout",
                    "title": "检查服务耗时或调高超时",
                    "description": "如果服务本身较慢，可以先确认它的健康状态，再考虑调高 toolTimeout。",
                    "safe": True,
                }
            )

        if entry.get("installDir") and entry.get("installSteps"):
            steps.append(
                {
                    "key": "review-install",
                    "title": "复查受管安装目录",
                    "description": "安装目录和 install steps 已保存在元数据里，可据此核对依赖是否完整。",
                    "safe": True,
                }
            )

        steps.extend(
            [
                {
                    "key": "run-bounded-worker",
                    "title": "如已配置 worker，可先运行受限修复",
                    "description": "受限模式只会把 MCP 上下文交给外部 worker，不会自动开启危险权限。",
                    "safe": True,
                },
                {
                    "key": "probe-again",
                    "title": "修复后重新探测",
                    "description": "修复动作完成后，再做一次探测确认工具列表和错误状态是否更新。",
                    "safe": True,
                },
            ]
        )
        return steps

    @staticmethod
    def _error_code_from_message(error: str) -> str:
        lower = error.lower()
        if "enoent" in lower or "no such file or directory" in lower:
            return "runtime_missing"
        if "connection refused" in lower or "econnrefused" in lower:
            return "connection_refused"
        if "401" in lower or "403" in lower or "unauthorized" in lower or "forbidden" in lower:
            return "auth_failed"
        if "timeout" in lower or "timed out" in lower:
            return "timeout"
        return "probe_failed"

    @staticmethod
    def _error_label_from_message(error: str) -> str:
        code = MCPServerService._error_code_from_message(error)
        labels = {
            "runtime_missing": "本地运行时或路径缺失",
            "connection_refused": "连接被拒绝",
            "auth_failed": "远端鉴权失败",
            "timeout": "连接或握手超时",
            "probe_failed": "探测失败",
        }
        return labels.get(code, "探测失败")

    @staticmethod
    def _error_summary_from_message(error: str) -> str:
        code = MCPServerService._error_code_from_message(error)
        summaries = {
            "runtime_missing": "看起来像是本地命令、脚本路径或安装目录丢失。",
            "connection_refused": "远端 MCP 服务当前不可达或没有监听。",
            "auth_failed": "远端返回了鉴权相关错误，需要检查凭据。",
            "timeout": "服务响应过慢或网络连接不稳定，探测在超时前没有完成。",
            "probe_failed": "最近一次探测失败，需要结合错误细节继续诊断。",
        }
        return summaries.get(code, "最近一次探测失败，需要继续诊断。")

    @staticmethod
    def _spawn_repair_process(
        command: str,
        *,
        cwd: Path,
        extra_env: dict[str, str],
    ) -> subprocess.Popen[str]:
        env = os.environ.copy()
        env.update(extra_env)
        if os.name == "nt":
            return subprocess.Popen(
                command,
                cwd=str(cwd),
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
            )
        return subprocess.Popen(
            ["/bin/sh", "-lc", command],
            cwd=str(cwd),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
        )


def _normalize_mapping(payload: dict[str, Any]) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise ValueError("env/headers 必须是对象。")
    result: dict[str, str] = {}
    for key, value in payload.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            continue
        result[normalized_key] = str(value).strip()
    return result


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
