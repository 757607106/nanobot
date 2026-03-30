"""Agent loop: the core processing engine."""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import AsyncExitStack, nullcontext
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from loguru import logger

from nanobot.agent.context import ContextBuilder
from nanobot.agent.hook import AgentHook, AgentHookContext
from nanobot.agent.memory import MemoryConsolidator
from nanobot.agent.runner import AgentRunSpec, AgentRunner
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.message import MessageTool
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.command import CommandContext, CommandRouter, register_builtin_commands
from nanobot.bus.queue import MessageBus
from nanobot.chat_payload import normalize_chat_attachments
from nanobot.harness.events import (
    build_model_called_payload,
    build_model_result_payload,
    build_tool_called_payload,
    build_tool_result_payload,
)
from nanobot.harness.environment import resolve_execution_environment
from nanobot.harness.sandbox import SandboxBinding, build_sandbox_provider
from nanobot.harness.runtime_tools import build_workspace_tool_registry, format_tool_hint
from nanobot.providers.base import LLMProvider
from nanobot.session.manager import Session, SessionManager
from nanobot.utils.helpers import strip_think

if TYPE_CHECKING:
    from nanobot.config.schema import ChannelsConfig, ExecToolConfig, WebSearchConfig
    from nanobot.cron.service import CronService
    from nanobot.platform.runs import RunService


class _AgentLoopHook(AgentHook):
    """Bridge shared runner hooks into nanobot's platform-specific behaviors."""

    def __init__(
        self,
        *,
        model: str,
        run_registry: "RunService | None",
        run_context: dict[str, Any] | None,
        on_progress: Callable[..., Awaitable[None]] | None,
        on_stream: Callable[[str], Awaitable[None]] | None,
        on_stream_end: Callable[..., Awaitable[None]] | None,
        set_tool_context: Callable[[str, str, str | None], None],
        channel: str,
        chat_id: str,
        message_id: str | None,
    ) -> None:
        self._model = model
        self._run_registry = run_registry
        self._run_id = str((run_context or {}).get("run_id") or "").strip()
        self._run_event_sink = (run_context or {}).get("run_event_sink")
        self._on_progress = on_progress
        self._on_stream = on_stream
        self._on_stream_end = on_stream_end
        self._set_tool_context = set_tool_context
        self._channel = channel
        self._chat_id = chat_id
        self._message_id = message_id
        self._stream_buffer = ""
        self._reported_model_iterations: set[int] = set()

    def wants_streaming(self) -> bool:
        return self._on_stream is not None

    async def before_iteration(self, context: AgentHookContext) -> None:
        self._stream_buffer = ""
        payload = build_model_called_payload(
            iteration=self._iteration(context),
            model=self._model,
            message_count=len(context.messages),
        )
        await self._emit_event("model_called", payload)

    async def on_stream(self, context: AgentHookContext, delta: str) -> None:
        if self._on_stream is None:
            return
        previous = strip_think(self._stream_buffer or "") or ""
        self._stream_buffer += delta
        current = strip_think(self._stream_buffer) or ""
        incremental = current[len(previous):]
        if incremental:
            await self._on_stream(incremental)

    async def on_stream_end(self, context: AgentHookContext, *, resuming: bool) -> None:
        await self._emit_model_result(context)
        self._stream_buffer = ""
        if self._on_stream_end is not None:
            await self._on_stream_end(resuming=resuming)

    async def before_execute_tools(self, context: AgentHookContext) -> None:
        await self._emit_model_result(context)
        if self._on_progress is not None:
            if self._on_stream is None:
                thought = strip_think(getattr(context.response, "content", None) or "")
                if thought:
                    await self._on_progress(thought)
            tool_hint = format_tool_hint(context.tool_calls)
            if tool_hint:
                await self._on_progress(tool_hint, tool_hint=True)
        for tool_call in context.tool_calls:
            args_str = json.dumps(tool_call.arguments, ensure_ascii=False)
            logger.info("Tool call: {}({})", tool_call.name, args_str[:200])
        self._set_tool_context(self._channel, self._chat_id, self._message_id)
        for tool_call in context.tool_calls:
            payload = build_tool_called_payload(
                iteration=self._iteration(context),
                tool_name=tool_call.name,
                arguments=tool_call.arguments,
            )
            await self._emit_event("tool_called", payload)

    async def after_iteration(self, context: AgentHookContext) -> None:
        await self._emit_model_result(context)
        if not context.tool_calls:
            return
        for tool_call, result in zip(context.tool_calls, context.tool_results):
            payload = build_tool_result_payload(
                iteration=self._iteration(context),
                tool_name=tool_call.name,
                result=result,
            )
            await self._emit_event("tool_result", payload)

    def finalize_content(self, context: AgentHookContext, content: str | None) -> str | None:
        if not content:
            return None
        return strip_think(content) or None

    @staticmethod
    def _iteration(context: AgentHookContext) -> int:
        return context.iteration + 1

    async def _emit_model_result(self, context: AgentHookContext) -> None:
        if context.response is None or context.iteration in self._reported_model_iterations:
            return
        payload = build_model_result_payload(
            iteration=self._iteration(context),
            model=self._model,
            finish_reason=getattr(context.response, "finish_reason", None),
            tool_call_count=len(context.tool_calls),
            has_visible_content=bool(strip_think(getattr(context.response, "content", None) or "")),
        )
        self._reported_model_iterations.add(context.iteration)
        await self._emit_event("model_result", payload)

    async def _emit_event(self, event_type: str, payload: dict[str, Any]) -> None:
        if self._run_registry is None or not self._run_id:
            return
        self._run_registry.append_event(self._run_id, event_type, payload)
        if self._run_event_sink is not None:
            await self._run_event_sink(event_type, payload)


class AgentLoop:
    """
    The agent loop is the core processing engine.

    It:
    1. Receives messages from the bus
    2. Builds context with history, memory, skills
    3. Calls the LLM
    4. Executes tool calls
    5. Sends responses back
    """

    _TOOL_RESULT_MAX_CHARS = 16_000

    def __init__(
        self,
        bus: MessageBus,
        provider: LLMProvider,
        workspace: Path,
        context_workspace: Path | None = None,
        model: str | None = None,
        max_iterations: int = 40,
        context_window_tokens: int = 65_536,
        web_search_config: WebSearchConfig | None = None,
        web_proxy: str | None = None,
        exec_config: ExecToolConfig | None = None,
        cron_service: CronService | None = None,
        restrict_to_workspace: bool = False,
        session_manager: SessionManager | None = None,
        mcp_servers: dict | None = None,
        channels_config: ChannelsConfig | None = None,
        run_registry: RunService | None = None,
        tool_allowlist: list[str] | None = None,
        skill_names: list[str] | None = None,
        system_prompt_override: str | None = None,
        include_workspace_memory: bool = True,
        memory_sections: list[tuple[str, str]] | None = None,
        channel_dispatcher: Any | None = None,
        extra_tools: list[Tool] | None = None,
        workspace_provider: Any | None = None,
        sandbox_binding: SandboxBinding | None = None,
        sandbox_provider: Any | None = None,
        timezone: str | None = None,
    ):
        from nanobot.config.schema import ExecToolConfig, WebSearchConfig

        self.bus = bus
        self.channels_config = channels_config
        self.provider = provider
        self.workspace = workspace
        self.model = model or provider.get_default_model()
        self.tool_allowlist = set(tool_allowlist) if tool_allowlist is not None else None
        self.skill_names = [name for name in (skill_names or []) if str(name or "").strip()]
        self.system_prompt_override = (system_prompt_override or "").strip() or None
        self.include_workspace_memory = include_workspace_memory
        self.memory_sections = [
            (str(heading or "").strip(), str(content or "").strip())
            for heading, content in (memory_sections or [])
            if str(heading or "").strip() and str(content or "").strip()
        ]
        self.max_iterations = max_iterations
        self.context_window_tokens = context_window_tokens
        self.web_search_config = web_search_config or WebSearchConfig()
        self.web_proxy = web_proxy
        self.exec_config = exec_config or ExecToolConfig()
        self.cron_service = cron_service
        self.restrict_to_workspace = restrict_to_workspace
        self._sandbox_provider = sandbox_provider or build_sandbox_provider(self.exec_config)
        if sandbox_binding is not None:
            self.sandbox_binding = sandbox_binding
        else:
            self.sandbox_binding = resolve_execution_environment(
                workspace=workspace,
                restrict_to_workspace=restrict_to_workspace,
                exec_config=self.exec_config,
                principal_kind="agent",
                tenant_id=getattr(run_registry, "tenant_id", "default"),
                instance_id=getattr(run_registry, "instance_id", "default"),
                workspace_provider=workspace_provider,
                sandbox_provider=self._sandbox_provider,
            ).sandbox

        virtual_workspace_path = str(getattr(self.sandbox_binding, "runtime_workdir", workspace) or workspace)
        resolved_context_workspace = Path(context_workspace) if context_workspace is not None else workspace
        self.context = ContextBuilder(
            resolved_context_workspace,
            memory_workspace=workspace,
            virtual_workspace_path=virtual_workspace_path,
            timezone=timezone,
        )
        self.sessions = session_manager or SessionManager(workspace)
        self.tools = ToolRegistry()
        self.runner = AgentRunner(provider)
        self.commands = CommandRouter()
        register_builtin_commands(self.commands)
        self._running = False
        self._start_time = time.time()
        self._last_usage: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0}
        self._channel_dispatcher = channel_dispatcher
        self._extra_tools = list(extra_tools or [])
        self._mcp_servers = mcp_servers or {}
        self._run_registry = run_registry
        self._mcp_stack: AsyncExitStack | None = None
        self._mcp_connected = False
        self._mcp_connecting = False
        self._active_tasks: dict[str, list[asyncio.Task]] = {}  # session_key -> tasks
        self._background_tasks: list[asyncio.Task] = []
        self._session_locks: dict[str, asyncio.Lock] = {}
        max_concurrent_requests = int(os.environ.get("NANOBOT_MAX_CONCURRENT_REQUESTS", "3"))
        self._concurrency_gate: asyncio.Semaphore | None = (
            asyncio.Semaphore(max_concurrent_requests)
            if max_concurrent_requests > 0
            else None
        )
        self._register_default_tools()
        self.memory_consolidator = MemoryConsolidator(
            workspace=workspace,
            provider=provider,
            model=self.model,
            sessions=self.sessions,
            context_window_tokens=context_window_tokens,
            build_messages=self.context.build_messages,
            get_tool_definitions=self.tools.get_definitions,
            max_completion_tokens=provider.generation.max_tokens,
        )

    def _register_default_tools(self) -> None:
        """Register the default set of tools."""
        self.tools = build_workspace_tool_registry(
            workspace=self.workspace,
            restrict_to_workspace=self.restrict_to_workspace,
            exec_timeout=self.exec_config.timeout,
            exec_path_append=self.exec_config.path_append,
            web_search_config=self.web_search_config,
            web_proxy=self.web_proxy,
            sandbox_binding=self.sandbox_binding,
            sandbox_provider=self._sandbox_provider,
            exec_enabled=self.exec_config.enable,
            tool_allowlist=self.tool_allowlist,
            message_send_callback=self.bus.publish_outbound,
            cron_service=self.cron_service,
            extra_tools=self._extra_tools,
            timezone=self.context.timezone,
        )

    @staticmethod
    def _strip_think(text: str | None) -> str | None:
        """Backward-compatible wrapper around shared hidden-thought stripping."""
        return strip_think(text) or None

    @staticmethod
    def _tool_hint(tool_calls: list) -> str:
        """Backward-compatible wrapper around shared tool-hint formatting."""
        return format_tool_hint(tool_calls)

    async def _run_agent_loop(
        self,
        initial_messages: list[dict],
        on_progress: Callable[..., Awaitable[None]] | None = None,
        on_stream: Callable[[str], Awaitable[None]] | None = None,
        on_stream_end: Callable[..., Awaitable[None]] | None = None,
        *,
        channel: str = "cli",
        chat_id: str = "direct",
        message_id: str | None = None,
        run_context: dict[str, Any] | None = None,
    ) -> tuple[str | None, list[str], list[dict]]:
        """Run the agent iteration loop.

        ``resuming=True`` in ``on_stream_end`` means tool calls follow;
        ``resuming=False`` means the final response has completed.
        """
        hook = _AgentLoopHook(
            model=self.model,
            run_registry=self._run_registry,
            run_context=run_context,
            on_progress=on_progress,
            on_stream=on_stream,
            on_stream_end=on_stream_end,
            set_tool_context=self._set_tool_context,
            channel=channel,
            chat_id=chat_id,
            message_id=message_id,
        )
        result = await self.runner.run(AgentRunSpec(
            initial_messages=initial_messages,
            tools=self.tools,
            model=self.model,
            max_iterations=self.max_iterations,
            hook=hook,
            error_message="Sorry, I encountered an error calling the AI model.",
            concurrent_tools=True,
        ))
        self._last_usage = result.usage or {"prompt_tokens": 0, "completion_tokens": 0}
        if result.stop_reason == "max_iterations":
            logger.warning("Max iterations ({}) reached", self.max_iterations)
        elif result.stop_reason == "error":
            logger.error("LLM returned error: {}", (result.final_content or "")[:200])
        return result.final_content, result.tools_used, result.messages

    async def _connect_mcp(self) -> None:
        """Connect to configured MCP servers (one-time, lazy)."""
        if self._mcp_connected or self._mcp_connecting or not self._mcp_servers:
            return
        self._mcp_connecting = True
        from nanobot.agent.tools.mcp import connect_mcp_servers
        try:
            self._mcp_stack = AsyncExitStack()
            await self._mcp_stack.__aenter__()
            await connect_mcp_servers(self._mcp_servers, self.tools, self._mcp_stack)
            self._mcp_connected = True
        except BaseException as e:
            logger.error("Failed to connect MCP servers (will retry next message): {}", e)
            if self._mcp_stack:
                try:
                    await self._mcp_stack.aclose()
                except Exception:
                    pass
                self._mcp_stack = None
        finally:
            self._mcp_connecting = False

    def _set_tool_context(self, channel: str, chat_id: str, message_id: str | None = None) -> None:
        """Update context for all tools that need routing info."""
        for name in ("message", "cron"):
            if tool := self.tools.get(name):
                if name == "message" and hasattr(tool, "set_context"):
                    tool.set_context(channel, chat_id, *([message_id] if message_id else []))
                elif hasattr(tool, "set_context"):
                    tool.set_context(channel, chat_id)

    @staticmethod
    def _resolve_system_target(msg: InboundMessage) -> tuple[str, str, str]:
        """Resolve the real parent session for a system-originated event."""
        if ":" in msg.chat_id:
            channel, chat_id = msg.chat_id.split(":", 1)
        else:
            channel, chat_id = "cli", msg.chat_id
        key = msg.session_key if msg.session_key != f"{msg.channel}:{msg.chat_id}" else f"{channel}:{chat_id}"
        return channel, chat_id, key


    async def run(self) -> None:
        """Run the agent loop, dispatching messages as tasks to stay responsive to /stop."""
        self._running = True
        await self._connect_mcp()
        logger.info("Agent loop started")

        while self._running:
            try:
                msg = await asyncio.wait_for(self.bus.consume_inbound(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                if not self._running or asyncio.current_task().cancelling():
                    raise
                continue
            except Exception as e:
                logger.warning("Error consuming inbound message: {}, continuing...", e)
                continue

            raw = msg.content.strip()
            if self.commands.is_priority(raw):
                ctx = CommandContext(msg=msg, session=None, key=msg.session_key, raw=raw, loop=self)
                result = await self.commands.dispatch_priority(ctx)
                if result is not None:
                    await self.bus.publish_outbound(result)
                continue

            task = asyncio.create_task(self._dispatch(msg))
            self._active_tasks.setdefault(msg.session_key, []).append(task)
            task.add_done_callback(lambda t, k=msg.session_key: self._active_tasks.get(k, []) and self._active_tasks[k].remove(t) if t in self._active_tasks.get(k, []) else None)

    async def _dispatch(self, msg: InboundMessage) -> None:
        """Process a message: per-session serial, cross-session concurrent."""
        if self._channel_dispatcher is not None:
            handled = await self._channel_dispatcher.dispatch(msg)
            if handled:
                return

        lock = self._session_locks.setdefault(msg.session_key, asyncio.Lock())
        gate = self._concurrency_gate or nullcontext()
        async with lock, gate:
            try:
                on_stream = on_stream_end = None
                if (msg.metadata or {}).get("_wants_stream"):
                    stream_base_id = f"{msg.session_key}:{time.time_ns()}"
                    stream_segment = 0

                    def _current_stream_id() -> str:
                        return f"{stream_base_id}:{stream_segment}"

                    async def on_stream(delta: str) -> None:
                        await self.bus.publish_outbound(OutboundMessage(
                            channel=msg.channel,
                            chat_id=msg.chat_id,
                            content=delta,
                            metadata={
                                "_stream_delta": True,
                                "_stream_id": _current_stream_id(),
                            },
                        ))

                    async def on_stream_end(*, resuming: bool = False) -> None:
                        nonlocal stream_segment
                        await self.bus.publish_outbound(OutboundMessage(
                            channel=msg.channel,
                            chat_id=msg.chat_id,
                            content="",
                            metadata={
                                "_stream_end": True,
                                "_resuming": resuming,
                                "_stream_id": _current_stream_id(),
                            },
                        ))
                        stream_segment += 1

                response = await self._process_message(
                    msg,
                    on_stream=on_stream,
                    on_stream_end=on_stream_end,
                )
                if response is not None:
                    await self.bus.publish_outbound(response)
                elif msg.channel == "cli":
                    await self.bus.publish_outbound(OutboundMessage(
                        channel=msg.channel, chat_id=msg.chat_id,
                        content="", metadata=msg.metadata or {},
                    ))
            except asyncio.CancelledError:
                logger.info("Task cancelled for session {}", msg.session_key)
                raise
            except Exception:
                logger.exception("Error processing message for session {}", msg.session_key)
                await self.bus.publish_outbound(OutboundMessage(
                    channel=msg.channel, chat_id=msg.chat_id,
                    content="Sorry, I encountered an error.",
                ))

    async def close_mcp(self) -> None:
        """Drain pending background archives, then close MCP connections."""
        if self._background_tasks:
            await asyncio.gather(*self._background_tasks, return_exceptions=True)
            self._background_tasks.clear()
        if self._mcp_stack:
            try:
                await self._mcp_stack.aclose()
            except (RuntimeError, BaseExceptionGroup):
                pass  # MCP SDK cancel scope cleanup is noisy but harmless
            self._mcp_stack = None

    def _schedule_background(self, coro) -> None:
        """Schedule a coroutine as a tracked background task (drained on shutdown)."""
        task = asyncio.create_task(coro)
        self._background_tasks.append(task)
        task.add_done_callback(self._background_tasks.remove)

    def stop(self) -> None:
        """Stop the agent loop."""
        self._running = False
        logger.info("Agent loop stopping")

    async def _process_message(
        self,
        msg: InboundMessage,
        session_key: str | None = None,
        on_progress: Callable[[str], Awaitable[None]] | None = None,
        on_stream: Callable[[str], Awaitable[None]] | None = None,
        on_stream_end: Callable[..., Awaitable[None]] | None = None,
        run_context: dict[str, Any] | None = None,
    ) -> OutboundMessage | None:
        """Process a single inbound message and return the response."""
        # System messages: parse origin from chat_id ("channel:chat_id")
        if msg.channel == "system":
            channel, chat_id, key = self._resolve_system_target(msg)
            logger.info("Processing system message from {}", msg.sender_id)
            session = self.sessions.get_or_create(key)
            await self.memory_consolidator.maybe_consolidate_by_tokens(session)
            history = session.get_history(max_messages=0)
            current_message = msg.content
            skip = 1 + len(history)
            messages = self.context.build_messages(
                history=history,
                current_message=current_message,
                skill_names=self.skill_names,
                extra_system_prompt=self.system_prompt_override,
                include_workspace_memory=self.include_workspace_memory,
                memory_sections=self.memory_sections,
                channel=channel,
                chat_id=chat_id,
                current_role="user",
            )
            final_content, _, all_msgs = await self._run_agent_loop(
                messages,
                channel=channel,
                chat_id=chat_id,
                message_id=msg.metadata.get("message_id"),
                run_context=run_context,
            )
            self._save_turn(session, all_msgs, skip)
            self.sessions.save(session)
            self._schedule_background(self.memory_consolidator.maybe_consolidate_by_tokens(session))
            return OutboundMessage(channel=channel, chat_id=chat_id,
                                  content=final_content or "Background task completed.")

        preview = msg.content[:80] + "..." if len(msg.content) > 80 else msg.content
        logger.info("Processing message from {}:{}: {}", msg.channel, msg.sender_id, preview)

        key = session_key or msg.session_key
        session = self.sessions.get_or_create(key)

        raw = msg.content.strip()
        ctx = CommandContext(msg=msg, session=session, key=key, raw=raw, loop=self)
        if result := await self.commands.dispatch(ctx):
            return result

        await self.memory_consolidator.maybe_consolidate_by_tokens(session)

        if message_tool := self.tools.get("message"):
            if isinstance(message_tool, MessageTool):
                message_tool.start_turn()

        history = session.get_history(max_messages=0)
        initial_messages = self.context.build_messages(
            history=history,
            current_message=msg.content,
            skill_names=self.skill_names,
            extra_system_prompt=self.system_prompt_override,
            include_workspace_memory=self.include_workspace_memory,
            memory_sections=self.memory_sections,
            media=msg.media if msg.media else None,
            channel=msg.channel, chat_id=msg.chat_id,
        )

        async def _bus_progress(content: str, *, tool_hint: bool = False) -> None:
            meta = dict(msg.metadata or {})
            meta["_progress"] = True
            meta["_tool_hint"] = tool_hint
            await self.bus.publish_outbound(OutboundMessage(
                channel=msg.channel, chat_id=msg.chat_id, content=content, metadata=meta,
            ))

        final_content, _, all_msgs = await self._run_agent_loop(
            initial_messages,
            on_progress=on_progress or _bus_progress,
            on_stream=on_stream,
            on_stream_end=on_stream_end,
            channel=msg.channel,
            chat_id=msg.chat_id,
            message_id=msg.metadata.get("message_id"),
            run_context=run_context,
        )

        if final_content is None:
            final_content = "I've completed processing but have no response to give."

        chat_context = (run_context or {}).get("chat_message") if isinstance(run_context, dict) else None
        self._save_turn(session, all_msgs, 1 + len(history), user_message_overrides=chat_context)
        self.sessions.save(session)
        self._schedule_background(self.memory_consolidator.maybe_consolidate_by_tokens(session))

        if (mt := self.tools.get("message")) and isinstance(mt, MessageTool) and mt._sent_in_turn:
            return None

        preview = final_content[:120] + "..." if len(final_content) > 120 else final_content
        logger.info("Response to {}:{}: {}", msg.channel, msg.sender_id, preview)
        meta = dict(msg.metadata or {})
        if on_stream is not None:
            meta["_streamed"] = True
        return OutboundMessage(
            channel=msg.channel, chat_id=msg.chat_id, content=final_content,
            metadata=meta,
        )

    @staticmethod
    def _image_placeholder(block: dict[str, Any]) -> dict[str, str]:
        """Convert an inline image block into a compact text placeholder."""
        path = (block.get("_meta") or {}).get("path", "")
        return {"type": "text", "text": f"[image: {path}]" if path else "[image]"}

    def _sanitize_persisted_blocks(
        self,
        content: list[dict[str, Any]],
        *,
        truncate_text: bool = False,
        drop_runtime: bool = False,
    ) -> list[dict[str, Any]]:
        """Strip volatile multimodal payloads before writing session history."""
        filtered: list[dict[str, Any]] = []
        for block in content:
            if not isinstance(block, dict):
                filtered.append(block)
                continue

            if (
                drop_runtime
                and block.get("type") == "text"
                and isinstance(block.get("text"), str)
                and block["text"].startswith(ContextBuilder._RUNTIME_CONTEXT_TAG)
            ):
                continue

            if (
                block.get("type") == "image_url"
                and block.get("image_url", {}).get("url", "").startswith("data:image/")
            ):
                filtered.append(self._image_placeholder(block))
                continue

            if block.get("type") == "text" and isinstance(block.get("text"), str):
                text = block["text"]
                if truncate_text and len(text) > self._TOOL_RESULT_MAX_CHARS:
                    text = text[:self._TOOL_RESULT_MAX_CHARS] + "\n... (truncated)"
                filtered.append({**block, "text": text})
                continue

            filtered.append(block)

        return filtered

    def _save_turn(
        self,
        session: Session,
        messages: list[dict],
        skip: int,
        user_message_overrides: dict[str, Any] | None = None,
    ) -> None:
        """Save new-turn messages into session, truncating large tool results."""
        from datetime import datetime

        applied_user_overrides = False
        for m in messages[skip:]:
            entry = dict(m)
            role, content = entry.get("role"), entry.get("content")
            if role == "assistant" and not content and not entry.get("tool_calls"):
                continue  # skip empty assistant messages — they poison session context
            if role == "tool":
                if isinstance(content, str) and len(content) > self._TOOL_RESULT_MAX_CHARS:
                    entry["content"] = content[:self._TOOL_RESULT_MAX_CHARS] + "\n... (truncated)"
                elif isinstance(content, list):
                    filtered = self._sanitize_persisted_blocks(content, truncate_text=True)
                    if not filtered:
                        continue
                    entry["content"] = filtered
            elif role == "user":
                if isinstance(content, str) and content.startswith(ContextBuilder._RUNTIME_CONTEXT_TAG):
                    # Strip the runtime-context prefix, keep only the user text.
                    parts = content.split("\n\n", 1)
                    if len(parts) > 1 and parts[1].strip():
                        entry["content"] = parts[1]
                    else:
                        continue
                if isinstance(content, list):
                    filtered = self._sanitize_persisted_blocks(content, drop_runtime=True)
                    if not filtered:
                        continue
                    entry["content"] = filtered
                if not applied_user_overrides and user_message_overrides:
                    display_content = str(
                        user_message_overrides.get("display_content")
                        or user_message_overrides.get("displayContent")
                        or entry.get("content")
                        or ""
                    ).strip()
                    attachments = normalize_chat_attachments(user_message_overrides.get("attachments"))
                    entry["content"] = display_content
                    if attachments:
                        entry["attachments"] = attachments
                    applied_user_overrides = True
            entry.setdefault("timestamp", datetime.now().isoformat())
            session.messages.append(entry)
        session.updated_at = datetime.now()

    async def process_direct(
        self,
        content: str,
        session_key: str = "cli:direct",
        channel: str = "cli",
        chat_id: str = "direct",
        on_progress: Callable[[str], Awaitable[None]] | None = None,
        on_stream: Callable[[str], Awaitable[None]] | None = None,
        on_stream_end: Callable[..., Awaitable[None]] | None = None,
    ) -> OutboundMessage | None:
        """Process a message directly using the upstream-style contract."""
        await self._connect_mcp()
        msg = InboundMessage(channel=channel, sender_id="user", chat_id=chat_id, content=content)
        return await self._process_message(
            msg,
            session_key=session_key,
            on_progress=on_progress,
            on_stream=on_stream,
            on_stream_end=on_stream_end,
        )
