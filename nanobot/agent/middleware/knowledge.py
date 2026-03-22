"""Knowledge binding middleware for agent runtime assembly."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from nanobot.agent.toolkits.knowledge import build_bound_knowledge_tools
from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.knowledge import KnowledgeBindingContext


def build_knowledge_prompt_block(hits: list[dict[str, Any]]) -> str:
    if not hits:
        return ""
    sections = [
        "# Retrieved Knowledge",
        "Use the following evidence only when it is relevant to the user's request.",
        "Prefer citing the source title or URL in plain language when you rely on it.",
    ]
    for index, hit in enumerate(hits, start=1):
        citation = hit.get("citation") or {}
        label = citation.get("title") or hit.get("title") or f"Chunk {index}"
        source_uri = citation.get("sourceUri")
        source_type = citation.get("sourceType") or "knowledge"
        header = f"## Evidence {index}: {label}"
        meta = f"Source Type: {source_type}"
        if source_uri:
            meta += f"\nSource URI: {source_uri}"
        sections.append(f"{header}\n{meta}\n\n{hit.get('content', '').strip()}")
    return "\n\n".join(sections)


@dataclass(slots=True)
class KnowledgeBindingResult:
    binding_context: KnowledgeBindingContext | None
    extra_tools: list[Tool]
    effective_tool_allowlist: list[str]
    knowledge_hits: list[dict[str, Any]]
    prompt_sections: list[str]
    event_payload: dict[str, Any]


class KnowledgeBindingMiddleware:
    """Resolve agent knowledge bindings into extra tools, prompt blocks, and events."""

    def __init__(self, knowledge_service: Any | None) -> None:
        self.knowledge_service = knowledge_service

    def apply(
        self,
        agent: dict[str, Any],
        task: str,
        *,
        base_tool_allowlist: list[str] | None = None,
    ) -> KnowledgeBindingResult:
        binding_ids = list(agent.get("knowledgeBindingIds") or [])
        binding_context, extra_tools = build_bound_knowledge_tools(self.knowledge_service, binding_ids)
        effective_tool_allowlist = (
            binding_context.extend_tool_allowlist(base_tool_allowlist)
            if binding_context is not None
            else list(base_tool_allowlist or [])
        )

        knowledge_result: dict[str, Any] = {"hits": [], "requestedMode": "hybrid", "effectiveMode": "hybrid"}
        if self.knowledge_service and binding_context is not None and binding_context.has_bindings:
            knowledge_result = self.knowledge_service.retrieve(
                kb_ids=list(binding_context.bound_kb_ids),
                query=str(task or ""),
                limit=6,
            )

        knowledge_hits = list(knowledge_result.get("hits") or [])
        prompt_sections: list[str] = []
        prompt_block = build_knowledge_prompt_block(knowledge_hits)
        if prompt_block:
            prompt_sections.append(prompt_block)

        knowledge_names = list(getattr(binding_context, "knowledges", []) or [])
        event_payload = {
            "knowledgeBindingIds": binding_ids,
            "knowledgeNames": knowledge_names,
            "requestedMode": knowledge_result.get("requestedMode"),
            "effectiveMode": knowledge_result.get("effectiveMode"),
            "hitCount": len(knowledge_hits),
        }
        return KnowledgeBindingResult(
            binding_context=binding_context,
            extra_tools=extra_tools,
            effective_tool_allowlist=effective_tool_allowlist,
            knowledge_hits=knowledge_hits,
            prompt_sections=prompt_sections,
            event_payload=event_payload,
        )
