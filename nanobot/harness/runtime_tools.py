"""Shared runtime tool catalog and registry assembly helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Awaitable, Callable

from nanobot.agent.skills import BUILTIN_SKILLS_DIR
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.cron import CronTool
from nanobot.agent.tools.filesystem import EditFileTool, ListDirTool, ReadFileTool, WriteFileTool
from nanobot.agent.tools.message import MessageTool
from nanobot.agent.tools.notebook import NotebookEditTool
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.agent.tools.search import GlobTool, GrepTool
from nanobot.agent.tools.shell import ExecTool
from nanobot.agent.tools.spawn import SpawnTool
from nanobot.agent.tools.web import WebFetchTool, WebSearchTool

RUNTIME_TOOL_CATALOG: dict[str, str] = {
    "read_file": "Read a file from the workspace.",
    "write_file": "Create or overwrite a file in the workspace.",
    "edit_file": "Edit an existing file using patch-style operations.",
    "list_dir": "Inspect files and directories in the workspace.",
    "glob": "Find files or directories with glob patterns.",
    "grep": "Search file contents with regex or fixed-string matching.",
    "notebook_edit": "Edit a Jupyter notebook cell by index.",
    "exec": "Run a shell command inside the workspace.",
    "web_search": "Search the web for public information.",
    "web_fetch": "Fetch and summarize a web page.",
    "message": "Send a message back to the active user or chat session.",
    "spawn": "Spawn a subagent to handle an independent background task.",
    "cron": "Create or manage scheduled jobs.",
    "list_kbs": "List the knowledge bases bound to the current agent.",
    "get_mindmap": "Read the current knowledge mindmap for a bound knowledge base.",
    "query_kb": "Query a bound knowledge base for evidence and structured results.",
}


def list_runtime_tool_names(
    *,
    exec_enabled: bool = True,
    web_enabled: bool = True,
    include_message: bool = True,
    include_spawn: bool = True,
    include_cron: bool = True,
) -> list[str]:
    """Return the canonical runtime tool names for one execution surface."""
    names = [
        "read_file",
        "write_file",
        "edit_file",
        "list_dir",
        "glob",
        "grep",
        "notebook_edit",
    ]
    if exec_enabled:
        names.append("exec")
    if web_enabled:
        names.extend(["web_search", "web_fetch"])
    if include_message:
        names.append("message")
    if include_spawn:
        names.append("spawn")
    if include_cron:
        names.append("cron")
    return names


def build_workspace_tool_registry(
    *,
    workspace: Path,
    restrict_to_workspace: bool,
    exec_timeout: int,
    exec_path_append: str | None,
    web_enabled: bool = True,
    web_search_config: Any,
    web_proxy: str | None,
    sandbox_binding: Any | None = None,
    sandbox_provider: Any | None = None,
    exec_enabled: bool = True,
    tool_allowlist: set[str] | list[str] | tuple[str, ...] | None = None,
    message_send_callback: Callable[..., Awaitable[None]] | None = None,
    spawn_manager: Any | None = None,
    cron_service: Any | None = None,
    extra_tools: list[Tool] | None = None,
    timezone: str | None = None,
    allowed_env_keys: list[str] | None = None,
) -> ToolRegistry:
    """Build the standard workspace-scoped tool registry."""
    registry = ToolRegistry()
    allowlist = set(tool_allowlist) if tool_allowlist is not None else None
    resolved_working_dir = Path(getattr(sandbox_binding, "working_dir", workspace))
    resolved_restrict = bool(getattr(sandbox_binding, "restrict_to_workspace", restrict_to_workspace))
    resolved_timeout = int(getattr(sandbox_binding, "exec_timeout", exec_timeout) or exec_timeout)
    resolved_path_append = str(getattr(sandbox_binding, "path_append", exec_path_append) or "")
    resolved_host_workspace = Path(getattr(sandbox_binding, "host_workspace_path", workspace) or workspace)
    resolved_runtime_workdir = str(
        getattr(sandbox_binding, "runtime_workdir", resolved_working_dir) or resolved_working_dir
    )
    sandbox_executor = (
        sandbox_provider.get_executor(sandbox_binding)
        if sandbox_binding is not None and sandbox_provider is not None and hasattr(sandbox_provider, "get_executor")
        else None
    )
    allowed_dir = workspace if resolved_restrict else None
    extra_read = [BUILTIN_SKILLS_DIR] if allowed_dir else None
    virtual_workspace = Path(resolved_runtime_workdir)

    def _register(tool: Tool) -> None:
        if allowlist is not None and tool.name not in allowlist:
            return
        registry.register(tool)

    _register(
        ReadFileTool(
            workspace=workspace,
            virtual_workspace=virtual_workspace,
            allowed_dir=allowed_dir,
            extra_allowed_dirs=extra_read,
        )
    )
    for tool_cls in (WriteFileTool, EditFileTool, ListDirTool, GlobTool, GrepTool, NotebookEditTool):
        _register(
            tool_cls(
                workspace=workspace,
                virtual_workspace=virtual_workspace,
                allowed_dir=allowed_dir,
            )
        )

    if exec_enabled:
        _register(
            ExecTool(
                working_dir=str(resolved_working_dir),
                host_working_dir=str(resolved_host_workspace),
                runtime_workdir=resolved_runtime_workdir,
                timeout=resolved_timeout,
                restrict_to_workspace=resolved_restrict,
                path_append=resolved_path_append,
                sandbox_executor=sandbox_executor,
                env=dict(getattr(sandbox_binding, "env", {}) or {}),
                allowed_env_keys=allowed_env_keys,
            )
        )
    if web_enabled:
        _register(WebSearchTool(config=web_search_config, proxy=web_proxy))
        _register(WebFetchTool(proxy=web_proxy))

    if message_send_callback is not None:
        _register(MessageTool(send_callback=message_send_callback))
    if spawn_manager is not None:
        _register(SpawnTool(manager=spawn_manager))
    if cron_service is not None:
        _register(CronTool(cron_service, default_timezone=timezone or "UTC"))
    for tool in extra_tools or []:
        _register(tool)
    return registry
