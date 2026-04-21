"""Shared builders for config-driven agent loop construction."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from nanobot.bus.queue import MessageBus
    from nanobot.config.schema import Config
    from nanobot.providers.base import LLMProvider
    from nanobot.session.manager import SessionManager
    from nanobot.agent.loop import AgentLoop


def build_agent_loop_from_config(
    *,
    config: "Config",
    bus: "MessageBus",
    provider: "LLMProvider",
    workspace: Path,
    context_workspace: Path | None = None,
    memory_workspace: Path | None = None,
    run_registry: Any | None = None,
    session_manager: "SessionManager | None" = None,
    cron_service: Any | None = None,
    restrict_to_workspace: bool | None = None,
    mcp_servers: dict[str, Any] | None = None,
    tool_allowlist: list[str] | None = None,
    skill_names: list[str] | None = None,
    system_prompt_override: str | None = None,
    include_workspace_memory: bool = True,
    memory_sections: list[tuple[str, str]] | None = None,
    extra_tools: list[Any] | None = None,
    channel_dispatcher: Any | None = None,
    workspace_provider: Any | None = None,
    sandbox_binding: Any | None = None,
    sandbox_provider: Any | None = None,
    timezone: str | None = None,
    unified_session: bool | None = None,
    session_ttl_minutes: int | None = None,
    include_always_skills: bool = True,
    include_skills_summary: bool = True,
    disabled_skills: list[str] | None = None,
    agent_loop_cls: type["AgentLoop"] | None = None,
) -> "AgentLoop":
    """Build an AgentLoop using one canonical config-to-loop mapping."""
    if agent_loop_cls is None:
        from nanobot.agent.loop import AgentLoop as agent_loop_cls
    defaults = config.agents.defaults
    return agent_loop_cls(
        bus=bus,
        provider=provider,
        workspace=workspace,
        context_workspace=context_workspace,
        memory_workspace=memory_workspace,
        model=defaults.model,
        max_iterations=defaults.max_tool_iterations,
        context_window_tokens=defaults.context_window_tokens,
        context_block_limit=defaults.context_block_limit,
        max_tool_result_chars=defaults.max_tool_result_chars,
        provider_retry_mode=defaults.provider_retry_mode,
        web_config=config.tools.web,
        exec_config=config.tools.exec,
        cron_service=cron_service,
        restrict_to_workspace=(
            config.tools.restrict_to_workspace
            if restrict_to_workspace is None
            else restrict_to_workspace
        ),
        session_manager=session_manager,
        mcp_servers=mcp_servers if mcp_servers is not None else config.tools.mcp_servers,
        channels_config=config.channels,
        run_registry=run_registry,
        tool_allowlist=tool_allowlist,
        skill_names=skill_names,
        system_prompt_override=system_prompt_override,
        include_workspace_memory=include_workspace_memory,
        memory_sections=memory_sections,
        channel_dispatcher=channel_dispatcher,
        extra_tools=extra_tools,
        workspace_provider=workspace_provider,
        sandbox_binding=sandbox_binding,
        sandbox_provider=sandbox_provider,
        timezone=timezone if timezone is not None else defaults.timezone,
        session_ttl_minutes=(
            defaults.session_ttl_minutes
            if session_ttl_minutes is None
            else session_ttl_minutes
        ),
        unified_session=(
            defaults.unified_session
            if unified_session is None
            else unified_session
        ),
        disabled_skills=(
            defaults.disabled_skills if disabled_skills is None else disabled_skills
        ),
        include_always_skills=include_always_skills,
        include_skills_summary=include_skills_summary,
    )
