"""Agent loop: the core processing engine."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import time
from contextlib import AsyncExitStack, nullcontext
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from loguru import logger

from nanobot.agent.autocompact import AutoCompact
from nanobot.agent.context import ContextBuilder
from nanobot.agent.hook import AgentHook, AgentHookContext, CompositeHook
from nanobot.agent.memory import Consolidator, Dream, PostConversationMemoryExtractor, TurnMaintenanceCoordinator
from nanobot.agent.response_validation import FinalResponseValidationResult, FinalResponseValidator
from nanobot.agent.runner import _MAX_INJECTIONS_PER_TURN, AgentRunner, AgentRunSpec
from nanobot.agent.subagent import SubagentManager
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.message import MessageTool
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.chat_payload import normalize_chat_attachments
from nanobot.command import CommandContext, CommandRouter, register_builtin_commands
from nanobot.config.schema import AgentDefaults
from nanobot.harness import build_workspace_tool_registry
from nanobot.harness.environment import resolve_execution_environment
from nanobot.harness.sandbox import SandboxBinding, build_sandbox_provider
from nanobot.harness.workspace import WorkspaceContext
from nanobot.providers.base import LLMProvider
from nanobot.session.manager import Session, SessionExecutionObservation, SessionManager
from nanobot.utils.document import extract_documents
from nanobot.utils.helpers import image_placeholder_text
from nanobot.utils.helpers import truncate_text as truncate_text_fn
from nanobot.utils.runtime import EMPTY_FINAL_RESPONSE_MESSAGE

if TYPE_CHECKING:
    from nanobot.config.schema import ChannelsConfig, ExecToolConfig, WebToolsConfig
    from nanobot.cron.service import CronService
    from nanobot.platform.runs import RunService


UNIFIED_SESSION_KEY = "unified:default"


class _LoopHook(AgentHook):
    """Core hook for the main loop."""

    def __init__(
        self,
        agent_loop: AgentLoop,
        on_progress: Callable[..., Awaitable[None]] | None = None,
        on_stream: Callable[[str, str | None], Awaitable[None]] | None = None,
        on_stream_end: Callable[..., Awaitable[None]] | None = None,
        *,
        channel: str = "cli",
        chat_id: str = "direct",
        message_id: str | None = None,
        session_key: str | None = None,
    ) -> None:
        super().__init__(reraise=True)
        self._loop = agent_loop
        self._on_progress = on_progress
        self._on_stream = on_stream
        self._on_stream_end = on_stream_end
        self._channel = channel
        self._chat_id = chat_id
        self._message_id = message_id
        self._session_key = session_key
        self._stream_buf = ""

    async def on_tool_complete(self, tool_call, result, event, error) -> None:
        """Push a progress event when a single tool finishes execution."""
        if self._on_progress is None:
            return
        tool_name = getattr(tool_call, "name", "tool")
        tool_call_id = getattr(tool_call, "id", "") or ""
        status = event.get("status", "ok") if isinstance(event, dict) else "ok"
        detail = event.get("detail", "") if isinstance(event, dict) else ""
        summary = f"{tool_name}: {detail}" if detail else tool_name
        await self._on_progress(
            summary,
            tool_hint=False,
            tool_complete=True,
            tool_name=tool_name,
            tool_status=status,
            tool_call_id=tool_call_id,
        )

    def wants_streaming(self) -> bool:
        return self._on_stream is not None

    async def on_stream(self, context: AgentHookContext, delta: str, reasoning_delta: str | None = None) -> None:
        from nanobot.utils.helpers import extract_think, strip_think

        prev_clean = strip_think(self._stream_buf)
        prev_think = extract_think(self._stream_buf)

        self._stream_buf += delta
        if reasoning_delta:
            self._stream_buf += f"<think>{reasoning_delta}</think>"

        new_clean = strip_think(self._stream_buf)
        new_think = extract_think(self._stream_buf)

        inc_clean = new_clean[len(prev_clean or ""):] if new_clean else ""
        inc_think = new_think[len(prev_think or ""):] if new_think else ""

        if (inc_clean or inc_think) and self._on_stream:
            # Type signature allows two arguments mapping to chunk_content and reasoning_content
            try:
                await self._on_stream(inc_clean, inc_think)
            except TypeError:
                await self._on_stream(inc_clean)

    async def on_stream_end(self, context: AgentHookContext, *, resuming: bool) -> None:
        if self._on_stream_end:
            await self._on_stream_end(resuming=resuming)
        self._stream_buf = ""

    async def before_execute_tools(self, context: AgentHookContext) -> None:
        if self._on_progress:
            if not self._on_stream:
                thought = self._loop._strip_think(
                    context.response.content if context.response else None
                )
                if thought:
                    await self._on_progress(thought)
            tool_hint = self._loop._strip_think(self._loop._tool_hint(context.tool_calls))
            await self._on_progress(
                tool_hint,
                tool_hint=True,
                tool_calls=[tc.to_openai_tool_call() for tc in context.tool_calls],
            )
        for tc in context.tool_calls:
            args_str = json.dumps(tc.arguments, ensure_ascii=False)
            logger.info("Tool call: {}({})", tc.name, args_str[:200])
        self._loop._set_tool_context(
            self._channel,
            self._chat_id,
            self._message_id,
            self._session_key,
        )

    async def after_iteration(self, context: AgentHookContext) -> None:
        u = context.usage or {}
        logger.debug(
            "LLM usage: prompt={} completion={} cached={}",
            u.get("prompt_tokens", 0),
            u.get("completion_tokens", 0),
            u.get("cached_tokens", 0),
        )

    def finalize_content(self, context: AgentHookContext, content: str | None) -> str | None:
        return self._loop._strip_think(content)


class _LoopHookChain(AgentHook):
    """Run the core hook before extra hooks."""

    __slots__ = ("_primary", "_extras")

    def __init__(self, primary: AgentHook, extra_hooks: list[AgentHook]) -> None:
        self._primary = primary
        self._extras = CompositeHook(extra_hooks)

    def wants_streaming(self) -> bool:
        return self._primary.wants_streaming() or self._extras.wants_streaming()

    async def before_iteration(self, context: AgentHookContext) -> None:
        await self._primary.before_iteration(context)
        await self._extras.before_iteration(context)

    async def on_stream(self, context: AgentHookContext, delta: str, reasoning_delta: str | None = None) -> None:
        await self._primary.on_stream(context, delta, reasoning_delta)
        await self._extras.on_stream(context, delta, reasoning_delta)

    async def on_stream_end(self, context: AgentHookContext, *, resuming: bool) -> None:
        await self._primary.on_stream_end(context, resuming=resuming)
        await self._extras.on_stream_end(context, resuming=resuming)

    async def before_execute_tools(self, context: AgentHookContext) -> None:
        await self._primary.before_execute_tools(context)
        await self._extras.before_execute_tools(context)

    async def after_iteration(self, context: AgentHookContext) -> None:
        await self._primary.after_iteration(context)
        await self._extras.after_iteration(context)

    def finalize_content(self, context: AgentHookContext, content: str | None) -> str | None:
        content = self._primary.finalize_content(context, content)
        return self._extras.finalize_content(context, content)


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

    _RUNTIME_CHECKPOINT_KEY = "runtime_checkpoint"
    _PENDING_USER_TURN_KEY = "pending_user_turn"
    _TURN_RESULT_KEY = "turn_result"

    def __init__(
        self,
        bus: MessageBus,
        provider: LLMProvider,
        workspace: Path,
        context_workspace: Path | None = None,
        memory_workspace: Path | None = None,
        model: str | None = None,
        max_iterations: int | None = None,
        context_window_tokens: int | None = None,
        context_block_limit: int | None = None,
        max_tool_result_chars: int | None = None,
        provider_retry_mode: str = "standard",
        web_config: WebToolsConfig | None = None,
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
        session_ttl_minutes: int = 0,
        hooks: list[AgentHook] | None = None,
        unified_session: bool = False,
        disabled_skills: list[str] | None = None,
        include_always_skills: bool = True,
        include_skills_summary: bool = True,
    ):
        from nanobot.config.schema import ExecToolConfig, WebToolsConfig

        defaults = AgentDefaults()
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
        self.max_iterations = (
            max_iterations if max_iterations is not None else defaults.max_tool_iterations
        )
        self.context_window_tokens = (
            context_window_tokens
            if context_window_tokens is not None
            else defaults.context_window_tokens
        )
        self.context_block_limit = context_block_limit
        self.max_tool_result_chars = (
            max_tool_result_chars
            if max_tool_result_chars is not None
            else defaults.max_tool_result_chars
        )
        self.provider_retry_mode = provider_retry_mode
        self.web_config = web_config or WebToolsConfig()
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
        self._start_time = time.time()
        self._last_usage: dict[str, int] = {}
        self._extra_hooks: list[AgentHook] = hooks or []

        virtual_workspace_path = str(getattr(self.sandbox_binding, "runtime_workdir", workspace) or workspace)
        resolved_context_workspace = Path(context_workspace) if context_workspace is not None else workspace
        resolved_memory_workspace = (
            Path(memory_workspace)
            if memory_workspace is not None
            else resolved_context_workspace
        )
        self._ws_ctx = WorkspaceContext(
            memory_root=resolved_memory_workspace,
            work_root=workspace,
            virtual_path=Path(virtual_workspace_path),
        )
        self.context = ContextBuilder(
            resolved_memory_workspace,
            memory_workspace=resolved_memory_workspace,
            skills_workspace=resolved_context_workspace,
            virtual_workspace_path=virtual_workspace_path,
            timezone=timezone,
            workspace_context=self._ws_ctx,
            disabled_skills=disabled_skills,
            include_always_skills=include_always_skills,
            include_skills_summary=include_skills_summary,
        )
        self.sessions = session_manager or SessionManager(workspace)
        self.runner = AgentRunner(provider)
        self.subagents = SubagentManager(
            provider=provider,
            workspace=workspace,
            bus=bus,
            model=self.model,
            web_config=self.web_config,
            max_tool_result_chars=self.max_tool_result_chars,
            exec_config=self.exec_config,
            restrict_to_workspace=restrict_to_workspace,
            workspace_context=self._ws_ctx,
            disabled_skills=disabled_skills,
        )
        self._unified_session = unified_session
        self._running = False
        self._channel_dispatcher = channel_dispatcher
        self._extra_tools = list(extra_tools or [])
        self._mcp_servers = mcp_servers or {}
        self._run_registry = run_registry
        self._mcp_stacks: dict[str, AsyncExitStack] = {}
        self._mcp_connected = False
        self._mcp_connecting = False
        self._active_tasks: dict[str, list[asyncio.Task]] = {}  # session_key -> tasks
        self._background_tasks: list[asyncio.Task] = []
        # Per-session pending queues for mid-turn message injection.
        # When a session has an active task, new messages for that session
        # are routed here instead of creating a new task.
        self._pending_queues: dict[str, asyncio.Queue] = {}
        # NANOBOT_MAX_CONCURRENT_REQUESTS: <=0 means unlimited; default 3.
        _max = int(os.environ.get("NANOBOT_MAX_CONCURRENT_REQUESTS", "3"))
        self._concurrency_gate: asyncio.Semaphore | None = (
            asyncio.Semaphore(_max) if _max > 0 else None
        )
        self.tools = self._build_tool_registry()
        self.consolidator = Consolidator(
            store=self.context.memory,
            provider=provider,
            model=self.model,
            sessions=self.sessions,
            context_window_tokens=self.context_window_tokens,
            build_messages=self.context.build_messages,
            get_tool_definitions=self.tools.get_definitions,
            max_completion_tokens=provider.generation.max_tokens,
        )
        self.auto_compact = AutoCompact(
            sessions=self.sessions,
            consolidator=self.consolidator,
            session_ttl_minutes=session_ttl_minutes,
        )
        self.dream = Dream(
            store=self.context.memory,
            provider=provider,
            model=self.model,
        )
        self.memory_extractor = PostConversationMemoryExtractor(
            store=self.context.memory,
            provider=provider,
            model=self.model,
        )
        self.turn_maintenance = TurnMaintenanceCoordinator(
            consolidator=self.consolidator,
            memory_extractor=self.memory_extractor,
        )
        self.commands = CommandRouter()
        register_builtin_commands(self.commands)

    def _build_tool_registry(self) -> ToolRegistry:
        """Build the canonical tool registry for this loop."""
        return build_workspace_tool_registry(
            workspace=self.workspace,
            restrict_to_workspace=self.restrict_to_workspace,
            exec_timeout=self.exec_config.timeout,
            exec_path_append=self.exec_config.path_append,
            web_enabled=self.web_config.enable,
            web_search_config=self.web_config.search,
            web_proxy=self.web_config.proxy,
            sandbox_binding=self.sandbox_binding,
            sandbox_provider=self._sandbox_provider,
            exec_enabled=self.exec_config.enable,
            tool_allowlist=self.tool_allowlist,
            message_send_callback=self.bus.publish_outbound,
            spawn_manager=self.subagents,
            cron_service=self.cron_service,
            extra_tools=self._extra_tools,
            timezone=self.context.timezone,
            allowed_env_keys=self.exec_config.allowed_env_keys,
        )

    async def _connect_mcp(self) -> None:
        """Connect to configured MCP servers (one-time, lazy)."""
        if self._mcp_connected or self._mcp_connecting or not self._mcp_servers:
            return
        self._mcp_connecting = True
        from nanobot.agent.tools.mcp import connect_mcp_servers

        try:
            self._mcp_stacks = await connect_mcp_servers(self._mcp_servers, self.tools)
            if self._mcp_stacks:
                self._mcp_connected = True
            else:
                logger.warning("No MCP servers connected successfully (will retry next message)")
        except asyncio.CancelledError:
            logger.warning("MCP connection cancelled (will retry next message)")
            self._mcp_stacks.clear()
        except BaseException as e:
            logger.error("Failed to connect MCP servers (will retry next message): {}", e)
            self._mcp_stacks.clear()
        finally:
            self._mcp_connecting = False

    def _set_tool_context(
        self,
        channel: str,
        chat_id: str,
        message_id: str | None = None,
        session_key: str | None = None,
    ) -> None:
        """Update context for all tools that need routing info."""
        effective_key = session_key or (
            UNIFIED_SESSION_KEY if self._unified_session else f"{channel}:{chat_id}"
        )
        for name in ("message", "spawn", "cron"):
            if tool := self.tools.get(name):
                if hasattr(tool, "set_context"):
                    if name == "spawn":
                        tool.set_context(channel, chat_id, effective_key=effective_key)
                    else:
                        tool.set_context(channel, chat_id, *([message_id] if name == "message" else []))

    @staticmethod
    def _strip_think(text: str | None) -> str | None:
        """Remove <think>…</think> blocks that some models embed in content."""
        if not text:
            return None
        from nanobot.utils.helpers import strip_think

        return strip_think(text) or None

    @staticmethod
    def _tool_hint(tool_calls: list) -> str:
        """Format tool calls as concise hints with smart abbreviation."""
        from nanobot.utils.tool_hints import format_tool_hints

        return format_tool_hints(tool_calls)

    def _effective_session_key(self, msg: InboundMessage) -> str:
        """Return the session key used for task routing and mid-turn injections."""
        if self._unified_session and not msg.session_key_override:
            return UNIFIED_SESSION_KEY
        return msg.session_key

    def _processing_session_key(self, msg: InboundMessage, session_key: str | None = None) -> str:
        """Resolve the persisted session key for the current message."""
        if session_key is not None:
            return session_key
        if msg.channel != "system":
            return msg.session_key
        channel, chat_id = (
            msg.chat_id.split(":", 1) if ":" in msg.chat_id else ("cli", msg.chat_id)
        )
        default_key = f"{msg.channel}:{msg.chat_id}"
        if msg.session_key != default_key:
            return msg.session_key
        return f"{channel}:{chat_id}"

    def _build_final_response_validator(
        self,
        run_context: dict[str, Any] | None,
        *,
        on_stream: Callable[[str, str | None], Awaitable[None]] | None = None,
    ) -> Callable[..., Awaitable[FinalResponseValidationResult]] | None:
        if not isinstance(run_context, dict):
            return None
        config = run_context.get("response_validation")
        if not isinstance(config, dict):
            return None
        task = str(config.get("task") or "").strip()
        if not task:
            return None
        if on_stream is not None and not bool(config.get("allow_streaming", False)):
            return None

        validator = FinalResponseValidator(self.provider, self.model)
        event_sink = run_context.get("run_event_sink")

        async def _validate(
            *,
            candidate: str,
            tool_messages: list[dict[str, Any]],
            tools_used: list[str],
        ) -> FinalResponseValidationResult:
            result = await validator.validate(
                task=task,
                candidate=candidate,
                tool_messages=tool_messages,
                tools_used=tools_used,
            )
            if callable(event_sink):
                payload = {
                    "accepted": result.accepted,
                    "reason": result.reason,
                    "retryMessage": result.retry_message,
                    "toolsUsed": list(dict.fromkeys(tools_used)),
                }
                try:
                    await event_sink(
                        "final_response_validated" if result.accepted else "final_response_rejected",
                        payload,
                    )
                except Exception:
                    logger.exception("run_event_sink failed during final response validation")
            return result

        return _validate

    async def _record_session_execution_observation(
        self,
        session_key: str,
        observation: SessionExecutionObservation | None,
        run_context: dict[str, Any] | None,
    ) -> None:
        if not isinstance(observation, SessionExecutionObservation):
            return
        payload = observation.to_payload(session_key)
        if isinstance(run_context, dict):
            run_context["session_execution"] = payload

        if not observation.queued:
            return

        logger.info(
            "Session {} waited {:.2f}ms in the local execution queue",
            session_key,
            observation.wait_ms,
        )

        if not isinstance(run_context, dict):
            return
        event_sink = run_context.get("run_event_sink")
        if not callable(event_sink):
            return
        try:
            await event_sink("session_execution_queued", payload)
        except Exception:
            logger.exception("run_event_sink failed during session execution observation")

    async def _run_agent_loop(
        self,
        initial_messages: list[dict],
        on_progress: Callable[..., Awaitable[None]] | None = None,
        on_stream: Callable[[str, str | None], Awaitable[None]] | None = None,
        on_stream_end: Callable[..., Awaitable[None]] | None = None,
        on_retry_wait: Callable[[str], Awaitable[None]] | None = None,
        *,
        session: Session | None = None,
        channel: str = "cli",
        chat_id: str = "direct",
        message_id: str | None = None,
        reasoning_effort: str | None = None,
        pending_queue: asyncio.Queue | None = None,
        final_response_validator: Callable[..., Awaitable[FinalResponseValidationResult]] | None = None,
    ) -> tuple[str | None, list[str], list[dict], str, bool]:
        """Run the agent iteration loop.

        *on_stream*: called with each content delta during streaming.
        *on_stream_end(resuming)*: called when a streaming session finishes.
        ``resuming=True`` means tool calls follow (spinner should restart);
        ``resuming=False`` means this is the final response.

        Returns (final_content, tools_used, messages, stop_reason, had_injections).
        """
        loop_hook = _LoopHook(
            self,
            on_progress=on_progress,
            on_stream=on_stream,
            on_stream_end=on_stream_end,
            channel=channel,
            chat_id=chat_id,
            message_id=message_id,
            session_key=session.key if session else None,
        )
        hook: AgentHook = (
            CompositeHook([loop_hook] + self._extra_hooks) if self._extra_hooks else loop_hook
        )

        async def _checkpoint(payload: dict[str, Any]) -> None:
            if session is None:
                return
            self._set_runtime_checkpoint(session, payload)

        async def _drain_pending(*, limit: int = _MAX_INJECTIONS_PER_TURN) -> list[dict[str, Any]]:
            """Non-blocking drain of follow-up messages from the pending queue."""
            if pending_queue is None:
                return []
            items: list[dict[str, Any]] = []
            while len(items) < limit:
                try:
                    pending_msg = pending_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                content = pending_msg.content
                media = pending_msg.media if pending_msg.media else None
                if media:
                    content, media = extract_documents(content, media)
                    media = media or None
                user_content = self.context._build_user_content(content, media)
                runtime_ctx = self.context._build_runtime_context(
                    pending_msg.channel,
                    pending_msg.chat_id,
                    self.context.timezone,
                )
                if isinstance(user_content, str):
                    merged: str | list[dict[str, Any]] = f"{runtime_ctx}\n\n{user_content}"
                else:
                    merged = [{"type": "text", "text": runtime_ctx}] + user_content
                items.append({"role": "user", "content": merged})
            return items

        result = await self.runner.run(AgentRunSpec(
            initial_messages=initial_messages,
            tools=self.tools,
            model=self.model,
            max_iterations=self.max_iterations,
            max_tool_result_chars=self.max_tool_result_chars,
            reasoning_effort=reasoning_effort,
            hook=hook,
            error_message="Sorry, I encountered an error calling the AI model.",
            concurrent_tools=True,
            workspace=self.workspace,
            session_key=session.key if session else None,
            context_window_tokens=self.context_window_tokens,
            context_block_limit=self.context_block_limit,
            provider_retry_mode=self.provider_retry_mode,
            progress_callback=on_progress,
            retry_wait_callback=on_retry_wait,
            checkpoint_callback=_checkpoint,
            tool_complete_callback=loop_hook.on_tool_complete,
            injection_callback=_drain_pending,
            final_response_validator=final_response_validator,
        ))
        self._last_usage = result.usage
        self._last_tools_used = result.tools_used
        if result.stop_reason == "max_iterations":
            logger.warning("Max iterations ({}) reached", self.max_iterations)
        elif result.stop_reason == "error":
            logger.error("LLM returned error: {}", (result.final_content or "")[:200])
        return result.final_content, result.tools_used, result.messages, result.stop_reason, result.had_injections

    async def run(self) -> None:
        """Run the agent loop, dispatching messages as tasks to stay responsive to /stop."""
        self._running = True
        await self._connect_mcp()
        logger.info("Agent loop started")

        while self._running:
            try:
                msg = await asyncio.wait_for(self.bus.consume_inbound(), timeout=1.0)
            except asyncio.TimeoutError:
                self.auto_compact.check_expired(
                    self._schedule_background,
                    active_session_keys=self._pending_queues.keys(),
                )
                continue
            except asyncio.CancelledError:
                # Preserve real task cancellation so shutdown can complete cleanly.
                # Only ignore non-task CancelledError signals that may leak from integrations.
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
                if result:
                    await self.bus.publish_outbound(result)
                continue
            effective_key = self._effective_session_key(msg)
            # If this session already has an active pending queue (i.e. a task
            # is processing this session), route the message there for mid-turn
            # injection instead of creating a competing task.
            if effective_key in self._pending_queues:
                pending_msg = msg
                if effective_key != msg.session_key:
                    pending_msg = dataclasses.replace(
                        msg,
                        session_key_override=effective_key,
                    )
                try:
                    self._pending_queues[effective_key].put_nowait(pending_msg)
                except asyncio.QueueFull:
                    logger.warning(
                        "Pending queue full for session {}, falling back to queued task",
                        effective_key,
                    )
                else:
                    logger.info(
                        "Routed follow-up message to pending queue for session {}",
                        effective_key,
                    )
                    continue
            # Compute the effective session key before dispatching
            # This ensures /stop command can find tasks correctly when unified session is enabled
            task = asyncio.create_task(self._dispatch(msg))
            self._active_tasks.setdefault(effective_key, []).append(task)
            task.add_done_callback(
                lambda t, k=effective_key: self._active_tasks.get(k, [])
                and self._active_tasks[k].remove(t)
                if t in self._active_tasks.get(k, [])
                else None
            )

    async def _dispatch(self, msg: InboundMessage) -> None:
        """Process a message: per-session serial, cross-session concurrent."""
        if self._channel_dispatcher is not None:
            handled = await self._channel_dispatcher.dispatch(msg)
            if handled:
                return
        session_key = self._effective_session_key(msg)
        if session_key != msg.session_key:
            msg = dataclasses.replace(msg, session_key_override=session_key)
        run_id = None
        if self._run_registry is not None:
            try:
                from nanobot.platform.runs.models import RunKind
                record = self._run_registry.create_run(
                    kind=RunKind.AGENT,
                    label="Fallback Agent",
                    task_preview=(msg.content or "")[:280],
                    tenant_id=getattr(self._run_registry, "tenant_id", "default"),
                    instance_id=getattr(self._run_registry, "instance_id", "default"),
                    agent_id="default",
                    thread_id=msg.chat_id,
                    session_key=session_key,
                    origin_channel=msg.channel,
                    origin_chat_id=msg.chat_id,
                    workspace_path=str(self.workspace),
                )
                run_id = record.run_id
                self._run_registry.start_run(run_id)
            except Exception as e:
                logger.warning("Failed to create fallback run record: {}", e)

        # Register a pending queue so follow-up messages for this session are
        # routed here (mid-turn injection) instead of spawning a new task.
        pending = asyncio.Queue(maxsize=20)
        self._pending_queues[session_key] = pending

        try:
            try:
                on_stream = on_stream_end = None
                if msg.metadata and msg.metadata.get("_wants_stream"):
                    # Split one answer into distinct stream segments.
                    stream_base_id = f"{session_key}:{time.time_ns()}"
                    stream_segment = 0

                    def _current_stream_id() -> str:
                        return f"{stream_base_id}:{stream_segment}"

                    async def on_stream(delta: str, reasoning_delta: str | None = None) -> None:
                        meta = dict(msg.metadata or {})
                        meta["_stream_delta"] = True
                        meta["_stream_id"] = _current_stream_id()
                        if reasoning_delta:
                            meta["_reasoning_delta"] = reasoning_delta
                        await self.bus.publish_outbound(OutboundMessage(
                            channel=msg.channel, chat_id=msg.chat_id,
                            content=delta,
                            metadata=meta,
                        ))

                    async def on_stream_end(*, resuming: bool = False) -> None:
                        nonlocal stream_segment
                        meta = dict(msg.metadata or {})
                        meta["_stream_end"] = True
                        meta["_resuming"] = resuming
                        meta["_stream_id"] = _current_stream_id()
                        await self.bus.publish_outbound(OutboundMessage(
                            channel=msg.channel, chat_id=msg.chat_id,
                            content="",
                            metadata=meta,
                        ))
                        stream_segment += 1

                response = await self._process_message(
                    msg, on_stream=on_stream, on_stream_end=on_stream_end,
                    pending_queue=pending,
                    session_key=session_key,
                )
                if run_id:
                    try:
                        from nanobot.platform.runs.models import RunResultSummary
                        self._run_registry.complete_run(
                            run_id,
                            RunResultSummary(content=response.content if response else "(no response)"),
                        )
                    except Exception as e:
                        logger.warning("Failed to complete fallback run record: {}", e)

                if response is not None:
                    await self.bus.publish_outbound(response)
                elif msg.channel == "cli":
                    await self.bus.publish_outbound(OutboundMessage(
                        channel=msg.channel, chat_id=msg.chat_id,
                        content="", metadata=msg.metadata or {},
                    ))
            except asyncio.CancelledError:
                if run_id:
                    try:
                        self._run_registry.cancel_run(run_id)
                    except Exception:
                        pass
                logger.info("Task cancelled for session {}", session_key)
                raise
            except Exception as exc:
                if run_id:
                    try:
                        self._run_registry.fail_run(run_id, "FALLBACK_ERROR", str(exc))
                    except Exception:
                        pass
                logger.exception("Error processing message for session {}", session_key)
                await self.bus.publish_outbound(OutboundMessage(
                    channel=msg.channel, chat_id=msg.chat_id,
                    content="Sorry, I encountered an error.",
                ))
        finally:
            queue = self._pending_queues.pop(session_key, None)
            if queue is not None:
                leftover = 0
                while True:
                    try:
                        item = queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    await self.bus.publish_inbound(item)
                    leftover += 1
                if leftover:
                    logger.info(
                        "Re-published {} leftover message(s) to bus for session {}",
                        leftover, session_key,
                    )

    async def close_mcp(self) -> None:
        """Drain pending background archives, then close MCP connections."""
        if self._background_tasks:
            await asyncio.gather(*self._background_tasks, return_exceptions=True)
            self._background_tasks.clear()
        for name, stack in self._mcp_stacks.items():
            try:
                await stack.aclose()
            except (RuntimeError, BaseExceptionGroup):
                logger.debug("MCP server '{}' cleanup error (can be ignored)", name)
        self._mcp_stacks.clear()

    def _schedule_background(self, coro) -> None:
        """Schedule a coroutine as a tracked background task (drained on shutdown)."""
        task = asyncio.create_task(coro)
        self._background_tasks.append(task)

        def _on_done(done: asyncio.Task) -> None:
            if done in self._background_tasks:
                self._background_tasks.remove(done)
            try:
                done.result()
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("Background maintenance task failed")

        task.add_done_callback(_on_done)

    def stop(self) -> None:
        """Stop the agent loop."""
        self._running = False
        logger.info("Agent loop stopping")

    async def _process_message(
        self,
        msg: InboundMessage,
        session_key: str | None = None,
        on_progress: Callable[[str], Awaitable[None]] | None = None,
        on_stream: Callable[[str, str | None], Awaitable[None]] | None = None,
        on_stream_end: Callable[..., Awaitable[None]] | None = None,
        run_context: dict[str, Any] | None = None,
        pending_queue: asyncio.Queue | None = None,
    ) -> OutboundMessage | None:
        """Process a single inbound message and return the response."""
        await self._connect_mcp()
        key = self._processing_session_key(msg, session_key)
        gate = self._concurrency_gate or nullcontext()
        async with gate:
            async with self.sessions.execution(key) as execution_observation:
                await self._record_session_execution_observation(
                    key,
                    execution_observation,
                    run_context,
                )
                return await self._process_message_locked(
                    msg,
                    session_key=key,
                    on_progress=on_progress,
                    on_stream=on_stream,
                    on_stream_end=on_stream_end,
                    run_context=run_context,
                    pending_queue=pending_queue,
                )

    async def _process_message_locked(
        self,
        msg: InboundMessage,
        session_key: str,
        on_progress: Callable[[str], Awaitable[None]] | None = None,
        on_stream: Callable[[str, str | None], Awaitable[None]] | None = None,
        on_stream_end: Callable[..., Awaitable[None]] | None = None,
        run_context: dict[str, Any] | None = None,
        pending_queue: asyncio.Queue | None = None,
    ) -> OutboundMessage | None:
        """Execute a single message while already holding the session execution lock."""
        # System messages: parse origin from chat_id ("channel:chat_id")
        if msg.channel == "system":
            channel, chat_id = (
                msg.chat_id.split(":", 1) if ":" in msg.chat_id else ("cli", msg.chat_id)
            )
            logger.info("Processing system message from {}", msg.sender_id)
            session = self.sessions.get_or_create(session_key)
            persisted_count = len(session.messages)
            if self._restore_runtime_checkpoint(session):
                self.sessions.save(session, append_from=persisted_count)
                persisted_count = len(session.messages)
            if self._restore_pending_user_turn(session):
                self.sessions.save(session, append_from=persisted_count)
                persisted_count = len(session.messages)

            session, pending = self.auto_compact.prepare_session(session, session_key)

            await self.turn_maintenance.prepare_session(session)
            self._set_tool_context(channel, chat_id, msg.metadata.get("message_id"), session_key)
            history = session.get_history(max_messages=0)
            current_role = "assistant" if msg.sender_id == "subagent" else "user"

            messages = self.context.build_messages(
                history=history,
                current_message=msg.content,
                skill_names=self.skill_names,
                extra_system_prompt=self.system_prompt_override,
                include_workspace_memory=self.include_workspace_memory,
                memory_sections=self.memory_sections,
                channel=channel,
                chat_id=chat_id,
                session_summary=pending,
                current_role=current_role,
            )
            final_content, _, all_msgs, _, _ = await self._run_agent_loop(
                messages, session=session, channel=channel, chat_id=chat_id,
                message_id=msg.metadata.get("message_id"),
            )
            persisted_count = len(session.messages)
            saved_entries = self._save_turn(session, all_msgs, 1 + len(history))
            self._store_turn_result(
                run_context,
                saved_entries=saved_entries,
                first_sequence=persisted_count + 1,
            )
            self._clear_runtime_checkpoint(session)
            self.sessions.save(session, append_from=persisted_count)
            self.turn_maintenance.schedule_after_system_turn(
                schedule_background=self._schedule_background,
                session=session,
            )
            return OutboundMessage(
                channel=channel,
                chat_id=chat_id,
                content=final_content or "Background task completed.",
            )

        # Extract document text from media at the processing boundary so all
        # channels benefit without format-specific logic in ContextBuilder.
        if msg.media:
            new_content, image_only = extract_documents(msg.content, msg.media)
            msg = dataclasses.replace(msg, content=new_content, media=image_only)

        preview = msg.content[:80] + "..." if len(msg.content) > 80 else msg.content
        logger.info("Processing message from {}:{}: {}", msg.channel, msg.sender_id, preview)

        session = self.sessions.get_or_create(session_key)
        persisted_count = len(session.messages)
        if self._restore_runtime_checkpoint(session):
            self.sessions.save(session, append_from=persisted_count)
            persisted_count = len(session.messages)
        if self._restore_pending_user_turn(session):
            self.sessions.save(session, append_from=persisted_count)
            persisted_count = len(session.messages)

        session, pending = self.auto_compact.prepare_session(session, session_key)
        persisted_count = len(session.messages)

        # Slash commands
        raw = msg.content.strip()
        ctx = CommandContext(msg=msg, session=session, key=session_key, raw=raw, loop=self)
        if result := await self.commands.dispatch(ctx):
            return result

        await self.turn_maintenance.prepare_session(session)

        self._set_tool_context(msg.channel, msg.chat_id, msg.metadata.get("message_id"), session_key)
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
            session_summary=pending,
            media=msg.media if msg.media else None,
            channel=msg.channel,
            chat_id=msg.chat_id,
        )

        async def _bus_progress(content: str, *, tool_hint: bool = False, **kwargs) -> None:
            meta = dict(msg.metadata or {})
            meta["_progress"] = True
            meta["_tool_hint"] = tool_hint
            await self.bus.publish_outbound(
                OutboundMessage(
                    channel=msg.channel,
                    chat_id=msg.chat_id,
                    content=content,
                    metadata=meta,
                )
            )

        async def _on_retry_wait(content: str) -> None:
            meta = dict(msg.metadata or {})
            meta["_retry_wait"] = True
            await self.bus.publish_outbound(
                OutboundMessage(
                    channel=msg.channel,
                    chat_id=msg.chat_id,
                    content=content,
                    metadata=meta,
                )
            )

        _reasoning_effort = (run_context or {}).get("reasoning_effort") if isinstance(run_context, dict) else None
        final_response_validator = self._build_final_response_validator(
            run_context,
            on_stream=on_stream,
        )

        # Persist the triggering user message immediately, before running the
        # agent loop. If the process is killed mid-turn (OOM, SIGKILL, self-
        # restart, etc.), the existing runtime_checkpoint preserves the
        # in-flight assistant/tool state but NOT the user message itself, so
        # the user's prompt is silently lost on recovery. Saving it up front
        # makes recovery possible from the session log alone.
        user_persisted_early = False
        if isinstance(msg.content, str) and msg.content.strip():
            session.add_message("user", msg.content)
            self._mark_pending_user_turn(session)
            self.sessions.save(session, append_from=persisted_count)
            user_persisted_early = True

        final_content, _, all_msgs, stop_reason, had_injections = await self._run_agent_loop(
            initial_messages,
            on_progress=on_progress or _bus_progress,
            on_stream=on_stream,
            on_stream_end=on_stream_end,
            on_retry_wait=_on_retry_wait,
            session=session,
            channel=msg.channel,
            chat_id=msg.chat_id,
            message_id=msg.metadata.get("message_id"),
            reasoning_effort=_reasoning_effort,
            pending_queue=pending_queue,
            final_response_validator=final_response_validator,
        )

        if final_content is None or not final_content.strip():
            final_content = EMPTY_FINAL_RESPONSE_MESSAGE

        chat_context = (run_context or {}).get("chat_message") if isinstance(run_context, dict) else None

        # Skip the already-persisted user message when saving the turn
        save_skip = 1 + len(history) + (1 if user_persisted_early else 0)
        persisted_count = len(session.messages)
        saved_entries = self._save_turn(
            session,
            all_msgs,
            save_skip,
            user_message_overrides=chat_context,
        )
        self._store_turn_result(
            run_context,
            saved_entries=saved_entries,
            first_sequence=persisted_count + 1,
        )
        self._clear_pending_user_turn(session)
        self._clear_runtime_checkpoint(session)
        self.sessions.save(session, append_from=persisted_count)
        turn_skip = max(0, save_skip - (1 if user_persisted_early else 0))
        self.turn_maintenance.schedule_after_user_turn(
            schedule_background=self._schedule_background,
            session=session,
            turn_messages=all_msgs[turn_skip:],
            capture_memory=stop_reason != "error",
        )

        # When follow-up messages were injected mid-turn, a later natural
        # language reply may address those follow-ups and should not be
        # suppressed just because MessageTool was used earlier in the turn.
        # However, if the turn falls back to the empty-final-response
        # placeholder, suppress it when the real user-visible output already
        # came from MessageTool.
        if (mt := self.tools.get("message")) and isinstance(mt, MessageTool) and mt._sent_in_turn:
            if not had_injections or stop_reason == "empty_final_response":
                return None

        preview = final_content[:120] + "..." if len(final_content) > 120 else final_content
        logger.info("Response to {}:{}: {}", msg.channel, msg.sender_id, preview)

        meta = dict(msg.metadata or {})
        if on_stream is not None and stop_reason != "error":
            meta["_streamed"] = True
        return OutboundMessage(
            channel=msg.channel,
            chat_id=msg.chat_id,
            content=final_content,
            metadata=meta,
        )

    def _sanitize_persisted_blocks(
        self,
        content: list[dict[str, Any]],
        *,
        should_truncate_text: bool = False,
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

            if block.get("type") == "image_url" and block.get("image_url", {}).get(
                "url", ""
            ).startswith("data:image/"):
                path = (block.get("_meta") or {}).get("path", "")
                filtered.append({"type": "text", "text": image_placeholder_text(path)})
                continue

            if block.get("type") == "text" and isinstance(block.get("text"), str):
                text = block["text"]
                if should_truncate_text and len(text) > self.max_tool_result_chars:
                    text = truncate_text_fn(text, self.max_tool_result_chars)
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
    ) -> list[dict[str, Any]]:
        """Save new-turn messages into session, truncating large tool results."""
        from datetime import datetime

        applied_user_overrides = False
        saved_entries: list[dict[str, Any]] = []
        for m in messages[skip:]:
            entry = dict(m)
            if entry.get("_internal"):
                continue
            role, content = entry.get("role"), entry.get("content")
            if role == "assistant" and not content and not entry.get("tool_calls"):
                continue  # skip empty assistant messages — they poison session context
            if role == "tool":
                if isinstance(content, str) and len(content) > self.max_tool_result_chars:
                    entry["content"] = truncate_text_fn(content, self.max_tool_result_chars)
                elif isinstance(content, list):
                    filtered = self._sanitize_persisted_blocks(content, should_truncate_text=True)
                    if not filtered:
                        continue
                    entry["content"] = filtered
            elif role == "user":
                if isinstance(content, str) and content.startswith(ContextBuilder._RUNTIME_CONTEXT_TAG):
                    # Strip the entire runtime-context block (including any session summary).
                    # The block is bounded by _RUNTIME_CONTEXT_TAG and _RUNTIME_CONTEXT_END.
                    end_marker = ContextBuilder._RUNTIME_CONTEXT_END
                    end_pos = content.find(end_marker)
                    if end_pos >= 0:
                        after = content[end_pos + len(end_marker):].lstrip("\n")
                        if after:
                            entry["content"] = after
                        else:
                            continue
                    else:
                        # Fallback: no end marker found, strip the tag prefix
                        after_tag = content[len(ContextBuilder._RUNTIME_CONTEXT_TAG):].lstrip("\n")
                        if after_tag.strip():
                            entry["content"] = after_tag
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
            saved_entries.append(entry)
        session.updated_at = datetime.now()
        return saved_entries

    @classmethod
    def get_turn_result(cls, run_context: dict[str, Any] | None) -> dict[str, Any] | None:
        """Return the turn-scoped snapshot captured during process_direct."""
        if not isinstance(run_context, dict):
            return None
        result = run_context.get(cls._TURN_RESULT_KEY)
        return result if isinstance(result, dict) else None

    @staticmethod
    def _build_turn_assistant_snapshot(
        saved_entries: list[dict[str, Any]],
        *,
        first_sequence: int,
    ) -> dict[str, Any] | None:
        for offset in range(len(saved_entries) - 1, -1, -1):
            entry = saved_entries[offset]
            if entry.get("role") != "assistant":
                continue
            return {
                "sequence": first_sequence + offset,
                "entry": dict(entry),
            }
        return None

    def _store_turn_result(
        self,
        run_context: dict[str, Any] | None,
        *,
        saved_entries: list[dict[str, Any]],
        first_sequence: int,
    ) -> None:
        if not isinstance(run_context, dict):
            return
        assistant_message = self._build_turn_assistant_snapshot(
            saved_entries,
            first_sequence=first_sequence,
        )
        if assistant_message is None:
            return
        run_context[self._TURN_RESULT_KEY] = {
            "assistant_message": assistant_message,
        }

    def _set_runtime_checkpoint(self, session: Session, payload: dict[str, Any]) -> None:
        """Persist the latest in-flight turn state into session metadata."""
        session.metadata[self._RUNTIME_CHECKPOINT_KEY] = payload
        self.sessions.save(session, append_from=len(session.messages))

    def _mark_pending_user_turn(self, session: Session) -> None:
        session.metadata[self._PENDING_USER_TURN_KEY] = True

    def _clear_pending_user_turn(self, session: Session) -> None:
        session.metadata.pop(self._PENDING_USER_TURN_KEY, None)

    def _clear_runtime_checkpoint(self, session: Session) -> None:
        if self._RUNTIME_CHECKPOINT_KEY in session.metadata:
            session.metadata.pop(self._RUNTIME_CHECKPOINT_KEY, None)

    @staticmethod
    def _checkpoint_message_key(message: dict[str, Any]) -> tuple[Any, ...]:
        return (
            message.get("role"),
            message.get("content"),
            message.get("tool_call_id"),
            message.get("name"),
            message.get("tool_calls"),
            message.get("reasoning_content"),
            message.get("thinking_blocks"),
        )

    def _restore_runtime_checkpoint(self, session: Session) -> bool:
        """Materialize an unfinished turn into session history before a new request."""
        from datetime import datetime

        checkpoint = session.metadata.get(self._RUNTIME_CHECKPOINT_KEY)
        if not isinstance(checkpoint, dict):
            return False

        assistant_message = checkpoint.get("assistant_message")
        completed_tool_results = checkpoint.get("completed_tool_results") or []
        pending_tool_calls = checkpoint.get("pending_tool_calls") or []

        restored_messages: list[dict[str, Any]] = []
        if isinstance(assistant_message, dict):
            restored = dict(assistant_message)
            restored.setdefault("timestamp", datetime.now().isoformat())
            restored_messages.append(restored)
        for message in completed_tool_results:
            if isinstance(message, dict):
                restored = dict(message)
                restored.setdefault("timestamp", datetime.now().isoformat())
                restored_messages.append(restored)
        for tool_call in pending_tool_calls:
            if not isinstance(tool_call, dict):
                continue
            tool_id = tool_call.get("id")
            name = ((tool_call.get("function") or {}).get("name")) or "tool"
            restored_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "name": name,
                    "content": "Error: Task interrupted before this tool finished.",
                    "timestamp": datetime.now().isoformat(),
                }
            )

        overlap = 0
        max_overlap = min(len(session.messages), len(restored_messages))
        for size in range(max_overlap, 0, -1):
            existing = session.messages[-size:]
            restored = restored_messages[:size]
            if all(
                self._checkpoint_message_key(left) == self._checkpoint_message_key(right)
                for left, right in zip(existing, restored)
            ):
                overlap = size
                break
        session.messages.extend(restored_messages[overlap:])

        self._clear_pending_user_turn(session)
        self._clear_runtime_checkpoint(session)
        return True

    def _restore_pending_user_turn(self, session: Session) -> bool:
        """Close a turn that only persisted the user message before crashing."""
        from datetime import datetime

        if not session.metadata.get(self._PENDING_USER_TURN_KEY):
            return False

        if session.messages and session.messages[-1].get("role") == "user":
            session.messages.append(
                {
                    "role": "assistant",
                    "content": "Error: Task interrupted before a response was generated.",
                    "timestamp": datetime.now().isoformat(),
                }
            )
            session.updated_at = datetime.now()

        self._clear_pending_user_turn(session)
        return True

    async def process_direct(
        self,
        content: str,
        session_key: str = "cli:direct",
        channel: str = "cli",
        chat_id: str = "direct",
        media: list[str] | None = None,
        on_progress: Callable[[str], Awaitable[None]] | None = None,
        on_stream: Callable[[str, str | None], Awaitable[None]] | None = None,
        on_stream_end: Callable[..., Awaitable[None]] | None = None,
        run_context: dict[str, Any] | None = None,
    ) -> OutboundMessage | None:
        """Process a message directly and return the outbound payload."""
        msg = InboundMessage(
            channel=channel, sender_id="user", chat_id=chat_id,
            content=content, media=media or [],
        )
        return await self._process_message(
            msg,
            session_key=session_key,
            on_progress=on_progress,
            on_stream=on_stream,
            on_stream_end=on_stream_end,
            run_context=run_context,
        )
