"""Helpers for assembling workspace-scoped runtime tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Awaitable, Callable

from nanobot.agent.skills import BUILTIN_SKILLS_DIR
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.cron import CronTool
from nanobot.agent.tools.filesystem import EditFileTool, ListDirTool, ReadFileTool, WriteFileTool
from nanobot.agent.tools.message import MessageTool
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.agent.tools.shell import ExecTool
from nanobot.agent.tools.web import WebFetchTool, WebSearchTool
from nanobot.providers.base import ToolCallRequest


def format_tool_hint(tool_calls: list[ToolCallRequest]) -> str:
    """Format tool calls as a concise human-facing hint."""

    def _fmt(tool_call: ToolCallRequest) -> str:
        args = (tool_call.arguments[0] if isinstance(tool_call.arguments, list) else tool_call.arguments) or {}
        value = next(iter(args.values()), None) if isinstance(args, dict) else None
        if not isinstance(value, str):
            return tool_call.name
        return (
            f'{tool_call.name}("{value[:40]}…")'
            if len(value) > 40
            else f'{tool_call.name}("{value}")'
        )

    return ", ".join(_fmt(tool_call) for tool_call in tool_calls)


def build_workspace_tool_registry(
    *,
    workspace: Path,
    restrict_to_workspace: bool,
    exec_timeout: int,
    exec_path_append: str | None,
    web_search_config: Any,
    web_proxy: str | None,
    sandbox_binding: Any | None = None,
    sandbox_provider: Any | None = None,
    exec_enabled: bool = True,
    tool_allowlist: set[str] | list[str] | tuple[str, ...] | None = None,
    message_send_callback: Callable[..., Awaitable[None]] | None = None,
    cron_service: Any | None = None,
    extra_tools: list[Tool] | None = None,
    timezone: str | None = None,
) -> ToolRegistry:
    """Build the standard workspace-scoped tool registry."""
    registry = ToolRegistry()
    allowlist = set(tool_allowlist) if tool_allowlist is not None else None
    resolved_working_dir = Path(getattr(sandbox_binding, "working_dir", workspace))
    resolved_restrict = bool(getattr(sandbox_binding, "restrict_to_workspace", restrict_to_workspace))
    resolved_timeout = int(getattr(sandbox_binding, "exec_timeout", exec_timeout) or exec_timeout)
    resolved_path_append = str(getattr(sandbox_binding, "path_append", exec_path_append) or "")
    resolved_host_workspace = Path(getattr(sandbox_binding, "host_workspace_path", workspace) or workspace)
    resolved_runtime_workdir = str(getattr(sandbox_binding, "runtime_workdir", resolved_working_dir) or resolved_working_dir)
    sandbox_executor = (
        sandbox_provider.get_executor(sandbox_binding)
        if sandbox_binding is not None and sandbox_provider is not None and hasattr(sandbox_provider, "get_executor")
        else None
    )
    allowed_dir = workspace if resolved_restrict else None
    extra_read = [BUILTIN_SKILLS_DIR] if allowed_dir else None

    def _register(tool: Tool) -> None:
        if allowlist is not None and tool.name not in allowlist:
            return
        registry.register(tool)

    _register(ReadFileTool(
        workspace=workspace,
        virtual_workspace=Path(resolved_runtime_workdir),
        allowed_dir=allowed_dir,
        extra_allowed_dirs=extra_read,
    ))
    for tool_cls in (WriteFileTool, EditFileTool, ListDirTool):
        _register(tool_cls(workspace=workspace, virtual_workspace=Path(resolved_runtime_workdir), allowed_dir=allowed_dir))

    if exec_enabled:
        _register(ExecTool(
            working_dir=str(resolved_working_dir),
            host_working_dir=str(resolved_host_workspace),
            runtime_workdir=resolved_runtime_workdir,
            timeout=resolved_timeout,
            restrict_to_workspace=resolved_restrict,
            path_append=resolved_path_append,
            sandbox_executor=sandbox_executor,
            env=dict(getattr(sandbox_binding, "env", {}) or {}),
        ))
    _register(WebSearchTool(config=web_search_config, proxy=web_proxy))
    _register(WebFetchTool(proxy=web_proxy))

    if message_send_callback is not None:
        _register(MessageTool(send_callback=message_send_callback))
    if cron_service is not None:
        _register(CronTool(cron_service, default_timezone=timezone or "UTC"))
    for tool in extra_tools or []:
        _register(tool)
    return registry
