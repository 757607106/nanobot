"""Shared execution helpers for the agent runtime."""

from __future__ import annotations

import inspect
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from loguru import logger

from nanobot.agent.context import ContextBuilder
from nanobot.agent.skills import BUILTIN_SKILLS_DIR
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.cron import CronTool
from nanobot.agent.tools.filesystem import EditFileTool, ListDirTool, ReadFileTool, WriteFileTool
from nanobot.agent.tools.message import MessageTool
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.agent.tools.shell import ExecTool
from nanobot.agent.tools.web import WebFetchTool, WebSearchTool
from nanobot.providers.base import LLMProvider, ToolCallRequest


@dataclass(slots=True)
class ToolLoopResult:
    """Normalized result from one LLM + tool execution loop."""

    final_content: str | None
    tools_used: list[str]
    messages: list[dict[str, Any]]
    iterations: int


@dataclass(slots=True)
class ToolLoopHooks:
    """Optional execution hooks around model and tool steps."""

    before_model: Callable[..., Awaitable[None]] | None = None
    after_model: Callable[..., Awaitable[None]] | None = None
    before_tool: Callable[..., Awaitable[None]] | None = None
    after_tool: Callable[..., Awaitable[None]] | None = None


def strip_think(text: str | None) -> str | None:
    """Remove hidden `<think>` blocks from visible content."""
    if not text:
        return None
    return re.sub(r"<think>[\s\S]*?</think>", "", text).strip() or None


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


async def _maybe_call(callback: Callable[..., Any] | None, *args: Any, **kwargs: Any) -> None:
    """Invoke a sync or async callback when present."""
    if callback is None:
        return
    result = callback(*args, **kwargs)
    if inspect.isawaitable(result):
        await result


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
    tool_allowlist: set[str] | list[str] | tuple[str, ...] | None = None,
    message_send_callback: Callable[..., Awaitable[None]] | None = None,
    cron_service: Any | None = None,
    extra_tools: list[Tool] | None = None,
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
        _register(CronTool(cron_service))
    for tool in extra_tools or []:
        _register(tool)
    return registry


async def run_tool_loop(
    *,
    provider: LLMProvider,
    model: str,
    tools: ToolRegistry,
    context: ContextBuilder,
    initial_messages: list[dict[str, Any]],
    max_iterations: int,
    on_progress: Callable[..., Awaitable[None]] | None = None,
    on_tool_call: Callable[[ToolCallRequest], Any] | None = None,
    on_tool_result: Callable[[ToolCallRequest, str], Any] | None = None,
    hooks: ToolLoopHooks | None = None,
    log_prefix: str | None = None,
) -> ToolLoopResult:
    """Execute the standard LLM/tool loop for the main agent."""
    messages = list(initial_messages)
    iteration = 0
    final_content = None
    tools_used: list[str] = []
    prefix = f"{log_prefix} " if log_prefix else ""

    while iteration < max_iterations:
        iteration += 1
        await _maybe_call(
            hooks.before_model if hooks else None,
            iteration=iteration,
            messages=list(messages),
            model=model,
        )

        response = await provider.chat_with_retry(
            messages=messages,
            tools=tools.get_definitions(),
            model=model,
        )
        await _maybe_call(
            hooks.after_model if hooks else None,
            iteration=iteration,
            messages=list(messages),
            response=response,
            model=model,
        )

        if response.has_tool_calls:
            if on_progress:
                thought = strip_think(response.content)
                if thought:
                    await on_progress(thought)
                tool_hint = strip_think(format_tool_hint(response.tool_calls))
                if tool_hint:
                    await on_progress(tool_hint, tool_hint=True)

            tool_call_dicts = [tool_call.to_openai_tool_call() for tool_call in response.tool_calls]
            messages = context.add_assistant_message(
                messages,
                response.content,
                tool_call_dicts,
                reasoning_content=response.reasoning_content,
                thinking_blocks=response.thinking_blocks,
            )

            for tool_call in response.tool_calls:
                tools_used.append(tool_call.name)
                args_str = json.dumps(tool_call.arguments, ensure_ascii=False)
                logger.info("{}Tool call: {}({})", prefix, tool_call.name, args_str[:200])
                await _maybe_call(
                    hooks.before_tool if hooks else None,
                    iteration=iteration,
                    tool_call=tool_call,
                )
                await _maybe_call(on_tool_call, tool_call)
                result = await tools.execute(tool_call.name, tool_call.arguments)
                await _maybe_call(on_tool_result, tool_call, result)
                await _maybe_call(
                    hooks.after_tool if hooks else None,
                    iteration=iteration,
                    tool_call=tool_call,
                    result=result,
                )
                messages = context.add_tool_result(messages, tool_call.id, tool_call.name, result)
            continue

        clean = strip_think(response.content)
        if response.finish_reason == "error":
            logger.error("{}LLM returned error: {}", prefix, (clean or "")[:200])
            final_content = clean or "Sorry, I encountered an error calling the AI model."
            break

        messages = context.add_assistant_message(
            messages,
            clean,
            reasoning_content=response.reasoning_content,
            thinking_blocks=response.thinking_blocks,
        )
        final_content = clean
        break

    if final_content is None and iteration >= max_iterations:
        logger.warning("{}Max iterations ({}) reached", prefix, max_iterations)
        final_content = (
            f"I reached the maximum number of tool call iterations ({max_iterations}) "
            "without completing the task. You can try breaking the task into smaller steps."
        )

    return ToolLoopResult(
        final_content=final_content,
        tools_used=tools_used,
        messages=messages,
        iterations=iteration,
    )
