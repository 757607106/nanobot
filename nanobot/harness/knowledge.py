"""Knowledge-bound runtime helpers that extend the official agent core."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from nanobot.agent.tools.base import Tool

COMMON_KB_TOOL_NAMES = ("list_kbs", "get_mindmap", "query_kb")
_PREFETCH_PREVIEW_CHARS = 480
_SMALLTALK_NORMALIZE_RE = re.compile(r"[\s\W_]+", re.UNICODE)
_SMALLTALK_EXACT = frozenset(
    {
        "你好",
        "您好",
        "嗨",
        "哈喽",
        "哈囉",
        "hello",
        "hi",
        "hey",
        "早上好",
        "中午好",
        "下午好",
        "晚上好",
        "在吗",
        "在嘛",
        "有人吗",
        "收到",
        "好的",
        "ok",
        "okk",
        "okay",
        "谢谢",
        "感谢",
        "thankyou",
        "thanks",
        "bye",
        "再见",
        "拜拜",
    }
)
_SMALLTALK_PATTERNS = (
    re.compile(r"^(你|您)?好+$"),
    re.compile(r"^(哈)+[喽囉啰]?$"),
    re.compile(r"^(hi|hello|hey)+$"),
    re.compile(r"^(谢+谢+|多谢|感谢|thanks?|thankyou)$", re.IGNORECASE),
    re.compile(r"^(再见|拜拜|bye+)$", re.IGNORECASE),
)
_EAGER_PREFETCH_HINTS = (
    re.compile(r"[?？]"),
    re.compile(r"(怎么|如何|为何|为什么|是否|能否|可否|多少|几天|几时|哪里|哪儿|哪个|什么)"),
    re.compile(r"\b(how|what|why|when|where|which|can|could|should|is|are|do|does)\b", re.IGNORECASE),
)


def _normalize_smalltalk_query(query: str) -> str:
    return _SMALLTALK_NORMALIZE_RE.sub("", str(query or "").strip().lower())


def should_skip_bound_knowledge_prefetch(query: str) -> bool:
    """Return True when the request is low-information phatic chatter."""
    normalized = _normalize_smalltalk_query(query)
    if not normalized:
        return False
    if len(normalized) > 24:
        return False
    if normalized in _SMALLTALK_EXACT:
        return True
    return any(pattern.fullmatch(normalized) for pattern in _SMALLTALK_PATTERNS)


def should_eager_prefetch_bound_knowledge(query: str) -> bool:
    """Return True when a query looks explicit enough to justify eager KB prefetch."""
    text = str(query or "").strip()
    if not text or should_skip_bound_knowledge_prefetch(text):
        return False
    if len(text) < 4:
        return False
    return any(pattern.search(text) for pattern in _EAGER_PREFETCH_HINTS)


@dataclass(slots=True)
class KnowledgeBindingContext:
    knowledge_service: Any | None
    bound_kb_ids: tuple[str, ...]
    bound_kbs: tuple[dict[str, Any], ...]
    knowledges: tuple[str, ...]

    @property
    def has_bindings(self) -> bool:
        return bool(self.knowledge_service and self.bound_kbs)

    def extend_tool_allowlist(self, tool_allowlist: list[str] | None = None) -> list[str]:
        merged = list(tool_allowlist or [])
        if not self.has_bindings:
            return merged
        for tool_name in COMMON_KB_TOOL_NAMES:
            if tool_name not in merged:
                merged.append(tool_name)
        return merged


def build_knowledge_binding_context(
    knowledge_service: Any | None,
    bound_kb_ids: list[str] | tuple[str, ...] | None,
) -> KnowledgeBindingContext | None:
    normalized_ids = tuple(str(item).strip() for item in (bound_kb_ids or []) if str(item).strip())
    if not knowledge_service or not normalized_ids:
        return None
    bound_kbs = tuple(
        knowledge_service.get_knowledge_base(item.kb_id)
        for item in knowledge_service.resolve_bound_kbs(list(normalized_ids))
    )
    return KnowledgeBindingContext(
        knowledge_service=knowledge_service,
        bound_kb_ids=normalized_ids,
        bound_kbs=bound_kbs,
        knowledges=tuple(str(item.get("name") or item.get("kbId") or "") for item in bound_kbs),
    )


def get_common_kb_tools(binding_context: KnowledgeBindingContext | None) -> list[Tool]:
    if binding_context is None or not binding_context.has_bindings:
        return []
    return [
        ListKnowledgeBasesTool(binding_context),
        GetKnowledgeMindmapTool(binding_context),
        QueryKnowledgeBaseTool(binding_context),
    ]


class _KnowledgeToolBase(Tool):
    def __init__(self, binding_context: KnowledgeBindingContext):
        self.binding_context = binding_context

    def _resolve_bound_kbs(self) -> list[dict[str, Any]]:
        if not self.binding_context.has_bindings:
            return []
        return list(self.binding_context.bound_kbs)

    def _resolve_kb_id(self, kb_name: str | None) -> str:
        candidates = self._resolve_bound_kbs()
        if not candidates:
            raise ValueError("No knowledge bases are bound to this agent.")
        requested = str(kb_name or "").strip()
        if not requested:
            if len(candidates) == 1:
                return str(candidates[0]["kbId"])
            raise ValueError("kb_name is required when multiple knowledge bases are bound.")

        lowered = requested.lower()
        for item in candidates:
            if lowered in {
                str(item.get("kbId") or "").lower(),
                str(item.get("dbId") or "").lower(),
                str(item.get("name") or "").lower(),
            }:
                return str(item["kbId"])
        raise ValueError(f"Unknown bound knowledge base: {requested}")

    def _resolve_kb_payload(self, kb_name: str | None) -> dict[str, Any]:
        kb_id = self._resolve_kb_id(kb_name)
        for item in self._resolve_bound_kbs():
            if str(item.get("kbId") or "") == kb_id:
                return item
        raise ValueError(f"Unknown bound knowledge base: {kb_name or kb_id}")


class ListKnowledgeBasesTool(_KnowledgeToolBase):
    @property
    def name(self) -> str:
        return "list_kbs"

    @property
    def description(self) -> str:
        return "List the knowledge bases currently bound to this agent."

    @property
    def parameters(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}}

    async def execute(self, **kwargs: Any) -> str:
        items = self._resolve_bound_kbs()
        if not items:
            return "No knowledge bases are bound to this agent."
        lines = ["Bound knowledge bases:"]
        for item in items:
            stats = item.get("stats") or {}
            lines.append(
                f"- {item.get('name')} (id: {item.get('kbId')}, files: {stats.get('fileCount', 0)}, indexed: {stats.get('indexedCount', 0)})"
            )
            description = str(item.get("description") or "").strip()
            if description:
                lines.append(f"  {description}")
        return "\n".join(lines)


class GetKnowledgeMindmapTool(_KnowledgeToolBase):
    @property
    def name(self) -> str:
        return "get_mindmap"

    @property
    def description(self) -> str:
        return "Get the current mindmap for one bound knowledge base."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "kb_name": {
                    "type": "string",
                    "description": "Knowledge base id or name.",
                },
            },
            "required": ["kb_name"],
        }

    async def execute(self, kb_name: str, **kwargs: Any) -> str:
        kb_id = self._resolve_kb_id(kb_name)
        return self.binding_context.knowledge_service.get_mindmap_text(kb_id) or "The knowledge base mindmap is empty."


class QueryKnowledgeBaseTool(_KnowledgeToolBase):
    _MAX_CHUNK_CONTENT_LEN = 800
    _MAX_ENTITY_DISPLAY = 4
    _MAX_RELATIONSHIP_DISPLAY = 4

    def __init__(self, binding_context: KnowledgeBindingContext):
        super().__init__(binding_context)
        self._query_cache: dict[str, str] = {}

    @property
    def name(self) -> str:
        return "query_kb"

    @property
    def description(self) -> str:
        return "Query one bound knowledge base and return structured evidence."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "kb_name": {
                    "type": "string",
                    "description": "Knowledge base id or name.",
                },
                "query_text": {
                    "type": "string",
                    "description": "What to search for in the knowledge base.",
                },
                "file_name": {
                    "type": "string",
                    "description": "Optional file name filter inside the knowledge base.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of chunks to use.",
                    "minimum": 1,
                    "maximum": 20,
                },
            },
            "required": ["kb_name", "query_text"],
        }

    async def execute(
        self,
        kb_name: str,
        query_text: str,
        file_name: str | None = None,
        limit: int = 6,
        **kwargs: Any,
    ) -> str:
        cache_key = f"{kb_name}:{query_text}:{file_name or ''}"
        if cache_key in self._query_cache:
            return self._query_cache[cache_key]

        kb = self._resolve_kb_payload(kb_name)
        kb_id = str(kb.get("kbId") or "")
        kb_label = str(kb.get("name") or kb_id)
        result = self.binding_context.knowledge_service.query_kb_for_agent(
            kb_id,
            query_text,
            file_name=file_name,
            limit=limit,
        )
        data = result.get("data") or {}
        metadata = result.get("metadata") or {}
        chunks = list(data.get("chunks") or [])
        entities = list(data.get("entities") or [])
        relationships = list(data.get("relationships") or [])
        references = list(data.get("references") or [])

        if not any((chunks, entities, relationships, references)):
            output = "\n".join(
                [
                    f"Knowledge base query mode: {metadata.get('mode') or metadata.get('query_mode') or 'naive'}",
                    f"Knowledge base: {kb_label}",
                    f"No matching evidence was found for: {query_text}",
                    "Do not answer from general knowledge.",
                    "Reply that the bound knowledge base did not contain a matching answer.",
                ]
            )
            self._query_cache[cache_key] = output
            return output

        lines = [
            f"Knowledge base query mode: {metadata.get('mode') or metadata.get('query_mode') or 'hybrid'}",
        ]
        message = str(result.get("message") or "").strip()
        if message:
            lines.append(f"Answer:\n{message}")
        if chunks:
            lines.append("Relevant chunks:")
            for index, item in enumerate(chunks[:limit], start=1):
                content = str(item.get("content") or "").strip()
                if len(content) > self._MAX_CHUNK_CONTENT_LEN:
                    content = content[: self._MAX_CHUNK_CONTENT_LEN] + "…"
                file_path = str(item.get("file_path") or "").strip()
                label = f"[{index}]"
                if file_path:
                    label += f" {file_path}"
                lines.append(f"{label}\n{content}")
        if entities:
            lines.append("Entities:")
            for item in entities[: self._MAX_ENTITY_DISPLAY]:
                lines.append(
                    f"- {item.get('entity_name') or item.get('name')}: {str(item.get('description') or '').strip()}"
                )
        if relationships:
            lines.append("Relationships:")
            for item in relationships[: self._MAX_RELATIONSHIP_DISPLAY]:
                lines.append(
                    f"- {item.get('src_id')} -> {item.get('tgt_id')}: {str(item.get('description') or '').strip()}"
                )
        output = "\n\n".join(lines)
        self._query_cache[cache_key] = output
        return output


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
        snippet = str(hit.get("preview") or hit.get("content") or "").strip()
        if len(snippet) > _PREFETCH_PREVIEW_CHARS:
            snippet = snippet[:_PREFETCH_PREVIEW_CHARS].rstrip() + "…"
        header = f"## Evidence {index}: {label}"
        meta = f"Source Type: {source_type}"
        if source_uri:
            meta += f"\nSource URI: {source_uri}"
        sections.append(f"{header}\n{meta}\n\n{snippet}")
    return "\n\n".join(sections)


def build_knowledge_policy_block() -> str:
    return "\n".join(
        [
            "# Knowledge Policy",
            "You have bound knowledge bases.",
            "For factual or product-specific questions, call query_kb before answering unless retrieved knowledge is already provided below.",
            "When knowledge evidence exists, answer from that evidence.",
            "When retrieval or query_kb returns no evidence, explicitly say no matching information was found in the bound knowledge base.",
            "Do not fill gaps with general knowledge.",
        ]
    )


def build_bound_knowledge_tools(
    knowledge_service: Any | None,
    bound_kb_ids: list[str] | tuple[str, ...] | None,
) -> tuple[KnowledgeBindingContext | None, list[Tool]]:
    binding_context = build_knowledge_binding_context(knowledge_service, bound_kb_ids)
    return binding_context, get_common_kb_tools(binding_context)


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

        knowledge_result: dict[str, Any] = {"hits": [], "requestedMode": "auto", "effectiveMode": "mixed"}
        prompt_sections: list[str] = []
        should_prefetch = should_eager_prefetch_bound_knowledge(task)
        skip_for_smalltalk = should_skip_bound_knowledge_prefetch(task)
        if binding_context is not None and binding_context.has_bindings and not skip_for_smalltalk:
            prompt_sections.append(build_knowledge_policy_block())
        if (
            self.knowledge_service
            and binding_context is not None
            and binding_context.has_bindings
            and should_prefetch
        ):
            knowledge_result = self.knowledge_service.retrieve(
                kb_ids=list(binding_context.bound_kb_ids),
                query=str(task or ""),
                limit=2,
                requested_mode="naive",
            )
        elif binding_context is not None and binding_context.has_bindings and skip_for_smalltalk:
            knowledge_result = {
                "hits": [],
                "requestedMode": "skipped",
                "effectiveMode": "skipped",
            }
        elif binding_context is not None and binding_context.has_bindings:
            knowledge_result = {
                "hits": [],
                "requestedMode": "deferred",
                "effectiveMode": "tool_only",
            }

        knowledge_hits = list(knowledge_result.get("hits") or [])
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
