"""Agent loop: the core processing engine."""

from __future__ import annotations

import asyncio
import os
import sys
from contextlib import AsyncExitStack
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from loguru import logger

from nanobot.agent.context import ContextBuilder
from nanobot.agent.execution import (
    ToolLoopHooks,
    build_workspace_tool_registry,
    format_tool_hint,
    run_tool_loop,
    strip_think,
)
from nanobot.agent.memory import MemoryConsolidator
from nanobot.agent.tools.knowledge import (
    KnowledgeBindingContext,
    build_knowledge_binding_context,
    get_common_kb_tools,
)
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.message import MessageTool
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.chat_payload import normalize_chat_attachments
from nanobot.harness.events import (
    build_model_called_payload,
    build_model_result_payload,
    build_tool_called_payload,
    build_tool_result_payload,
)
from nanobot.harness.environment import resolve_execution_environment
from nanobot.harness.sandbox import LocalSandboxProvider, SandboxBinding, build_sandbox_provider
from nanobot.harness.workspace import WorkspaceBinding
from nanobot.providers.base import LLMProvider
from nanobot.session.manager import Session, SessionManager

if TYPE_CHECKING:
    from nanobot.config.schema import ChannelsConfig, ExecToolConfig, WebSearchConfig
    from nanobot.cron.service import CronService
    from nanobot.harness import ExecutionContext
    from nanobot.platform.runs import RunService


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
        knowledge_binding_context: KnowledgeBindingContext | None = None,
        knowledge_service: Any | None = None,
        bound_knowledge_ids: list[str] | None = None,
        workspace_provider: Any | None = None,
        sandbox_binding: SandboxBinding | None = None,
        sandbox_provider: Any | None = None,
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
        self.context = ContextBuilder(workspace, virtual_workspace_path=virtual_workspace_path)
        self.sessions = session_manager or SessionManager(workspace)
        self.tools = ToolRegistry()
        self._running = False
        self._channel_dispatcher = channel_dispatcher
        self._knowledge_binding_context = knowledge_binding_context or build_knowledge_binding_context(
            knowledge_service,
            bound_knowledge_ids,
        )
        self._extra_tools = list(extra_tools or [])
        if self._knowledge_binding_context is not None:
            self._extra_tools.extend(get_common_kb_tools(self._knowledge_binding_context))
        self._mcp_servers = mcp_servers or {}
        self._run_registry = run_registry
        self._mcp_stack: AsyncExitStack | None = None
        self._mcp_connected = False
        self._mcp_connecting = False
        self._active_tasks: dict[str, list[asyncio.Task]] = {}  # session_key -> tasks
        self._background_tasks: list[asyncio.Task] = []
        self._processing_lock = asyncio.Lock()
        self._register_default_tools()
        self.memory_consolidator = MemoryConsolidator(
            workspace=workspace,
            provider=provider,
            model=self.model,
            sessions=self.sessions,
            context_window_tokens=context_window_tokens,
            build_messages=self.context.build_messages,
            get_tool_definitions=self.tools.get_definitions,
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
            tool_allowlist=self.tool_allowlist,
            message_send_callback=self.bus.publish_outbound,
            cron_service=self.cron_service,
            extra_tools=self._extra_tools,
        )

    @staticmethod
    def _strip_think(text: str | None) -> str | None:
        """Backward-compatible wrapper around shared hidden-thought stripping."""
        return strip_think(text)

    @staticmethod
    def _tool_hint(tool_calls: list) -> str:
        """Backward-compatible wrapper around shared tool-hint formatting."""
        return format_tool_hint(tool_calls)

    async def _run_agent_loop(
        self,
        initial_messages: list[dict],
        on_progress: Callable[..., Awaitable[None]] | None = None,
        run_context: dict[str, Any] | None = None,
    ) -> tuple[str | None, list[str], list[dict]]:
        """Run the agent iteration loop."""
        hooks = self._build_tool_loop_hooks(run_context)
        result = await run_tool_loop(
            provider=self.provider,
            model=self.model,
            tools=self.tools,
            context=self.context,
            initial_messages=initial_messages,
            max_iterations=self.max_iterations,
            on_progress=on_progress,
            hooks=hooks,
        )
        return result.final_content, result.tools_used, result.messages

    def _build_tool_loop_hooks(self, run_context: dict[str, Any] | None) -> ToolLoopHooks | None:
        if self._run_registry is None:
            return None
        run_id = str((run_context or {}).get("run_id") or "").strip()
        if not run_id:
            return None
        run_event_sink = (run_context or {}).get("run_event_sink")

        async def _before_model(*, iteration: int, messages: list[dict[str, Any]], model: str, **_: Any) -> None:
            payload = build_model_called_payload(
                iteration=iteration,
                model=model,
                message_count=len(messages),
            )
            self._run_registry.append_event(run_id, "model_called", payload)
            if run_event_sink is not None:
                await run_event_sink("model_called", payload)

        async def _after_model(*, iteration: int, response: Any, model: str, **_: Any) -> None:
            payload = build_model_result_payload(
                iteration=iteration,
                model=model,
                finish_reason=getattr(response, "finish_reason", None),
                tool_call_count=len(getattr(response, "tool_calls", []) or []),
                has_visible_content=bool(strip_think(getattr(response, "content", None))),
            )
            self._run_registry.append_event(run_id, "model_result", payload)
            if run_event_sink is not None:
                await run_event_sink("model_result", payload)

        async def _before_tool(*, iteration: int, tool_call: Any, **_: Any) -> None:
            payload = build_tool_called_payload(
                iteration=iteration,
                tool_name=tool_call.name,
                arguments=tool_call.arguments,
            )
            self._run_registry.append_event(run_id, "tool_called", payload)
            if run_event_sink is not None:
                await run_event_sink("tool_called", payload)

        async def _after_tool(*, iteration: int, tool_call: Any, result: str, **_: Any) -> None:
            payload = build_tool_result_payload(
                iteration=iteration,
                tool_name=tool_call.name,
                result=result,
            )
            self._run_registry.append_event(run_id, "tool_result", payload)
            if run_event_sink is not None:
                await run_event_sink("tool_result", payload)

        return ToolLoopHooks(
            before_model=_before_model,
            after_model=_after_model,
            before_tool=_before_tool,
            after_tool=_after_tool,
        )

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

    def _set_tool_context(
        self,
        channel: str,
        chat_id: str,
        session_key: str | None = None,
        message_id: str | None = None,
        run_context: dict[str, Any] | None = None,
    ) -> None:
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
            except Exception as e:
                logger.warning("Error consuming inbound message: {}, continuing...", e)
                continue

            cmd = msg.content.strip().lower()
            if cmd == "/stop":
                await self._handle_stop(msg)
            elif cmd == "/restart":
                await self._handle_restart(msg)
            else:
                task = asyncio.create_task(self._dispatch(msg))
                self._active_tasks.setdefault(msg.session_key, []).append(task)
                task.add_done_callback(lambda t, k=msg.session_key: self._active_tasks.get(k, []) and self._active_tasks[k].remove(t) if t in self._active_tasks.get(k, []) else None)

    async def _handle_stop(self, msg: InboundMessage) -> None:
        """Cancel all active tasks for the session."""
        tasks = self._active_tasks.pop(msg.session_key, [])
        cancelled = sum(1 for t in tasks if not t.done() and t.cancel())
        for t in tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        content = f"Stopped {cancelled} task(s)." if cancelled else "No active task to stop."
        await self.bus.publish_outbound(OutboundMessage(
            channel=msg.channel, chat_id=msg.chat_id, content=content,
        ))

    async def _handle_restart(self, msg: InboundMessage) -> None:
        """Restart the process in-place via os.execv."""
        await self.bus.publish_outbound(OutboundMessage(
            channel=msg.channel, chat_id=msg.chat_id, content="Restarting...",
        ))

        async def _do_restart():
            await asyncio.sleep(1)
            # Use -m nanobot instead of sys.argv[0] for Windows compatibility
            # (sys.argv[0] may be just "nanobot" without full path on Windows)
            os.execv(sys.executable, [sys.executable, "-m", "nanobot"] + sys.argv[1:])

        asyncio.create_task(_do_restart())

    async def _dispatch(self, msg: InboundMessage) -> None:
        """Process a message under the global lock.

        If a ``channel_dispatcher`` is configured and the message carries
        ``_routing_target_type`` metadata, dispatch via the channel
        dispatcher instead of the default agent processing pipeline.
        """
        # Check for channel routing metadata
        if self._channel_dispatcher is not None:
            handled = await self._channel_dispatcher.dispatch(msg)
            if handled:
                return

        async with self._processing_lock:
            try:
                response = await self._process_message(msg)
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
        run_context: dict[str, Any] | None = None,
    ) -> OutboundMessage | None:
        """Process a single inbound message and return the response."""
        # System messages: parse origin from chat_id ("channel:chat_id")
        if msg.channel == "system":
            channel, chat_id, key = self._resolve_system_target(msg)
            logger.info("Processing system message from {}", msg.sender_id)
            session = self.sessions.get_or_create(key)
            await self.memory_consolidator.maybe_consolidate_by_tokens(session)
            self._set_tool_context(
                channel,
                chat_id,
                session_key=key,
                message_id=msg.metadata.get("message_id"),
                run_context=run_context,
            )
            history = session.get_history(max_messages=0)
            current_message = msg.content
            current_role = "user"
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
                current_role=current_role,
            )
            final_content, _, all_msgs = await self._run_agent_loop(messages, run_context=run_context)
            self._save_turn(session, all_msgs, skip)
            self.sessions.save(session)
            self._schedule_background(self.memory_consolidator.maybe_consolidate_by_tokens(session))
            return OutboundMessage(channel=channel, chat_id=chat_id,
                                  content=final_content or "Background task completed.")

        preview = msg.content[:80] + "..." if len(msg.content) > 80 else msg.content
        logger.info("Processing message from {}:{}: {}", msg.channel, msg.sender_id, preview)

        key = session_key or msg.session_key
        session = self.sessions.get_or_create(key)

        # Slash commands
        cmd = msg.content.strip().lower()
        if cmd == "/new":
            snapshot = session.messages[session.last_consolidated:]
            session.clear()
            self.sessions.save(session)
            self.sessions.invalidate(session.key)

            if snapshot:
                self._schedule_background(self.memory_consolidator.archive_messages(snapshot))

            return OutboundMessage(channel=msg.channel, chat_id=msg.chat_id,
                                  content="New session started.")
        if cmd == "/help":
            lines = [
                "🐈 nanobot commands:",
                "/new — Start a new conversation",
                "/stop — Stop the current task",
                "/restart — Restart the bot",
                "/help — Show available commands",
            ]
            return OutboundMessage(
                channel=msg.channel, chat_id=msg.chat_id, content="\n".join(lines),
            )
        await self.memory_consolidator.maybe_consolidate_by_tokens(session)

        self._set_tool_context(
            msg.channel,
            msg.chat_id,
            session_key=key,
            message_id=msg.metadata.get("message_id"),
            run_context=run_context,
        )
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
        return OutboundMessage(
            channel=msg.channel, chat_id=msg.chat_id, content=final_content,
            metadata=msg.metadata or {},
        )

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
            if role == "tool" and isinstance(content, str) and len(content) > self._TOOL_RESULT_MAX_CHARS:
                entry["content"] = content[:self._TOOL_RESULT_MAX_CHARS] + "\n... (truncated)"
            elif role == "user":
                if isinstance(content, str) and content.startswith(ContextBuilder._RUNTIME_CONTEXT_TAG):
                    # Strip the runtime-context prefix, keep only the user text.
                    parts = content.split("\n\n", 1)
                    if len(parts) > 1 and parts[1].strip():
                        entry["content"] = parts[1]
                    else:
                        continue
                if isinstance(content, list):
                    filtered = []
                    for c in content:
                        if c.get("type") == "text" and isinstance(c.get("text"), str) and c["text"].startswith(ContextBuilder._RUNTIME_CONTEXT_TAG):
                            continue  # Strip runtime context from multimodal messages
                        if (c.get("type") == "image_url"
                                and c.get("image_url", {}).get("url", "").startswith("data:image/")):
                            path = (c.get("_meta") or {}).get("path", "")
                            placeholder = f"[image: {path}]" if path else "[image]"
                            filtered.append({"type": "text", "text": placeholder})
                        else:
                            filtered.append(c)
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
        run_context: dict[str, Any] | None = None,
        execution_context: "ExecutionContext | None" = None,
    ) -> str:
        """Process a message directly (for CLI or cron usage)."""
        await self._connect_mcp()
        merged_run_context = dict(run_context or {})
        if execution_context is not None:
            session_key = str(execution_context.session_key or session_key)
            channel = str(execution_context.origin_channel or channel)
            chat_id = str(execution_context.session_id or chat_id)
            merged_run_context = {
                **execution_context.to_agent_loop_run_context(),
                **merged_run_context,
            }
        msg = InboundMessage(channel=channel, sender_id="user", chat_id=chat_id, content=content)
        response = await self._process_message(
            msg,
            session_key=session_key,
            on_progress=on_progress,
            run_context=merged_run_context or None,
        )
        return response.content if response else ""
