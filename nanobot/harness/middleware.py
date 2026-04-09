"""Thin execution middleware chain for runtime materialization."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from .context import KnowledgePolicy, MemoryPolicy, ToolPolicy
from .knowledge import KnowledgeBindingMiddleware, KnowledgeBindingResult

if TYPE_CHECKING:
    from nanobot.config.schema import Config


@dataclass(slots=True)
class ExecutionAssemblyState:
    """Mutable assembly state passed through execution middlewares."""

    agent: dict[str, Any]
    task: str
    config: Config
    additional_prompt_sections: tuple[str, ...] = ()
    include_workspace_memory_override: bool | None = None
    requested_memory_sections: tuple[tuple[str, str], ...] = ()
    prompt_sections: list[str] = field(default_factory=list)
    knowledge_binding: KnowledgeBindingResult | None = None
    tool_policy: ToolPolicy = field(default_factory=ToolPolicy)
    memory_policy: MemoryPolicy = field(default_factory=MemoryPolicy)
    knowledge_policy: KnowledgePolicy = field(default_factory=KnowledgePolicy)
    runtime_prompt_sections: list[str] = field(default_factory=list)
    runtime_memory_sections: list[tuple[str, str]] = field(default_factory=list)
    system_prompt_override: str | None = None
    middleware_trace: list[str] = field(default_factory=list)


class ExecutionMiddlewareError(RuntimeError):
    """Raised when one middleware stage fails during runtime assembly."""

    def __init__(self, stage: str, cause: Exception):
        self.stage = str(stage or "").strip() or "ExecutionMiddleware"
        self.cause = cause
        super().__init__(f"{self.stage} failed: {cause}")


class ExecutionMiddleware(Protocol):
    """One assembly step in the runtime materialization chain."""

    def apply(self, state: ExecutionAssemblyState) -> None: ...


@dataclass(slots=True)
class ExecutionMiddlewareChain:
    """Apply a small ordered set of execution middlewares."""

    middlewares: tuple[ExecutionMiddleware, ...]

    def apply(self, state: ExecutionAssemblyState) -> ExecutionAssemblyState:
        for middleware in self.middlewares:
            stage = type(middleware).__name__
            state.middleware_trace.append(stage)
            try:
                middleware.apply(state)
            except ExecutionMiddlewareError:
                raise
            except Exception as exc:
                raise ExecutionMiddlewareError(stage, exc) from exc
        return state


@dataclass(slots=True)
class PromptSeedMiddleware:
    """Seed prompt sections with static agent prompt and caller additions."""

    def apply(self, state: ExecutionAssemblyState) -> None:
        system_prompt = str(state.agent.get("systemPrompt") or "").strip()
        state.prompt_sections.append(system_prompt or "You are a helpful AI assistant.")
        for section in state.additional_prompt_sections:
            text = str(section or "").strip()
            if text:
                state.prompt_sections.append(text)


@dataclass(slots=True)
class MemoryPolicyMiddleware:
    """Resolve runtime memory policy from the platform memory boundary."""

    resolver: Any

    def apply(self, state: ExecutionAssemblyState) -> None:
        include_workspace_memory, resolved_sections = self.resolver(
            state.agent,
            include_workspace_memory=state.include_workspace_memory_override,
            memory_sections=list(state.requested_memory_sections),
        )
        state.memory_policy = MemoryPolicy(
            scope=str(state.agent.get("memoryScope") or "agent_profile"),
            include_workspace_memory=include_workspace_memory,
            sections=tuple(resolved_sections),
        )


@dataclass(slots=True)
class KnowledgePolicyMiddleware:
    """Resolve knowledge bindings, retrieval state, and knowledge policy."""

    knowledge_service: Any | None

    def apply(self, state: ExecutionAssemblyState) -> None:
        knowledge_binding = KnowledgeBindingMiddleware(self.knowledge_service).apply(
            state.agent,
            state.task,
            base_tool_allowlist=list(state.agent.get("toolAllowlist", [])),
        )
        state.knowledge_binding = knowledge_binding
        state.knowledge_policy = KnowledgePolicy(
            scope="bindings" if state.agent.get("knowledgeBindingIds") else "workspace",
            binding_ids=tuple(state.agent.get("knowledgeBindingIds") or []),
            names=tuple(knowledge_binding.event_payload.get("knowledgeNames") or []),
            hits=tuple(knowledge_binding.knowledge_hits),
            event_payload=dict(knowledge_binding.event_payload),
        )


@dataclass(slots=True)
class ToolPolicyMiddleware:
    """Resolve the final tool policy after knowledge bindings extend tools."""

    def apply(self, state: ExecutionAssemblyState) -> None:
        effective_allowlist = (
            state.knowledge_binding.effective_tool_allowlist
            if state.knowledge_binding is not None
            else list(state.agent.get("toolAllowlist", []))
        )
        state.tool_policy = ToolPolicy(
            allowlist=tuple(effective_allowlist),
            mcp_server_ids=tuple(state.agent.get("mcpServerIds") or []),
            skill_ids=tuple(state.agent.get("skillIds") or []),
        )


@dataclass(slots=True)
class RuntimePromptFragmentsMiddleware:
    """Render reusable runtime prompt fragments from resolved policies."""

    workspace_memory_resolver: Any | None = None

    @staticmethod
    def _normalize_memory_sections(
        sections: list[tuple[str, str]] | tuple[tuple[str, str], ...],
    ) -> list[tuple[str, str]]:
        normalized: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for heading, content in sections:
            title = str(heading or "").strip()
            body = str(content or "").strip()
            if not title or not body:
                continue
            entry = (title, body)
            if entry in seen:
                continue
            seen.add(entry)
            normalized.append(entry)
        return normalized

    def apply(self, state: ExecutionAssemblyState) -> None:
        state.runtime_prompt_sections = []
        if state.knowledge_binding is not None:
            state.runtime_prompt_sections.extend(
                str(section).strip()
                for section in state.knowledge_binding.prompt_sections
                if str(section or "").strip()
            )
        memory_sections: list[tuple[str, str]] = []
        if state.memory_policy.include_workspace_memory and callable(self.workspace_memory_resolver):
            memory_sections.extend(self.workspace_memory_resolver() or [])
        memory_sections.extend(state.memory_policy.sections_as_list())
        state.runtime_memory_sections = self._normalize_memory_sections(memory_sections)


@dataclass(slots=True)
class PromptAssemblyMiddleware:
    """Finalize the runtime system prompt from accumulated prompt sections."""

    def apply(self, state: ExecutionAssemblyState) -> None:
        state.prompt_sections.extend(state.runtime_prompt_sections)
        state.system_prompt_override = (
            "\n\n".join(section for section in state.prompt_sections if section).strip() or None
        )
