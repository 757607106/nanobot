"""Knowledge toolkit helpers for agent runtime assembly."""

from __future__ import annotations

from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.knowledge import (
    KnowledgeBindingContext,
    build_knowledge_binding_context,
    get_common_kb_tools,
)


def build_bound_knowledge_tools(
    knowledge_service: Any | None,
    bound_kb_ids: list[str] | tuple[str, ...] | None,
) -> tuple[KnowledgeBindingContext | None, list[Tool]]:
    binding_context = build_knowledge_binding_context(knowledge_service, bound_kb_ids)
    return binding_context, get_common_kb_tools(binding_context)
