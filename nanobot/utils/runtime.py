"""Runtime-specific helper functions and constants."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from loguru import logger

from nanobot.utils.helpers import stringify_text_blocks

_MAX_REPEAT_EXTERNAL_LOOKUPS = 2
_HARD_STOP_AFTER_LOOKUPS = 5

EMPTY_FINAL_RESPONSE_MESSAGE = (
    "I completed the tool steps but couldn't produce a final answer. "
    "Please try again or narrow the task."
)

FINALIZATION_RETRY_PROMPT = (
    "Please provide your response to the user based on the conversation above."
)

LENGTH_RECOVERY_PROMPT = (
    "Output limit reached. Continue exactly where you left off "
    "— no recap, no apology. Break remaining work into smaller steps if needed."
)


@dataclass(slots=True, frozen=True)
class ExternalLookupBlock:
    """Result of a repeated-lookup check.  *fatal* forces the runner to stop."""

    message: str
    fatal: bool


def empty_tool_result_message(tool_name: str) -> str:
    """Short prompt-safe marker for tools that completed without visible output."""
    return f"({tool_name} completed with no output)"


def ensure_nonempty_tool_result(tool_name: str, content: Any) -> Any:
    """Replace semantically empty tool results with a short marker string."""
    if content is None:
        return empty_tool_result_message(tool_name)
    if isinstance(content, str) and not content.strip():
        return empty_tool_result_message(tool_name)
    if isinstance(content, list):
        if not content:
            return empty_tool_result_message(tool_name)
        text_payload = stringify_text_blocks(content)
        if text_payload is not None and not text_payload.strip():
            return empty_tool_result_message(tool_name)
    return content


def is_blank_text(content: str | None) -> bool:
    """True when *content* is missing or only whitespace."""
    return content is None or not content.strip()


def build_finalization_retry_message() -> dict[str, str]:
    """A short no-tools-allowed prompt for final answer recovery."""
    return {"role": "user", "content": FINALIZATION_RETRY_PROMPT}


def build_length_recovery_message() -> dict[str, str]:
    """Prompt the model to continue after hitting output token limit."""
    return {"role": "user", "content": LENGTH_RECOVERY_PROMPT}


def external_lookup_signature(tool_name: str, arguments: dict[str, Any]) -> str | None:
    """Stable signature for repeated external lookups we want to throttle."""
    if tool_name == "web_fetch":
        url = str(arguments.get("url") or "").strip()
        if url:
            return f"web_fetch:{url.lower()}"
    if tool_name == "web_search":
        query = str(arguments.get("query") or arguments.get("search_term") or "").strip()
        if query:
            return f"web_search:{query.lower()}"
    if tool_name == "query_kb":
        kb_name = str(arguments.get("kb_name") or "").strip()
        query = str(arguments.get("query_text") or "").strip()
        if query:
            return f"query_kb:{kb_name.lower()}:{query.lower()}"
    return None


def repeated_external_lookup_error(
    tool_name: str,
    arguments: dict[str, Any],
    seen_counts: dict[str, int],
) -> ExternalLookupBlock | None:
    """Block repeated external lookups after a small retry budget.

    Returns ``None`` when the call is allowed, an `ExternalLookupBlock`
    otherwise.  After `_HARD_STOP_AFTER_LOOKUPS` attempts the block is
    marked *fatal* so the runner terminates the tool loop.
    """
    signature = external_lookup_signature(tool_name, arguments)
    if signature is None:
        return None
    count = seen_counts.get(signature, 0) + 1
    seen_counts[signature] = count
    if count <= _MAX_REPEAT_EXTERNAL_LOOKUPS:
        return None
    fatal = count > _HARD_STOP_AFTER_LOOKUPS
    logger.warning(
        "Blocking repeated external lookup {} on attempt {} (fatal={})",
        signature[:160],
        count,
        fatal,
    )
    return ExternalLookupBlock(
        message=(
            "STOP: This exact query has already been executed and returned results. "
            "You MUST use the results already in the conversation to answer the user. "
            "Do NOT call this tool again with the same or similar query."
        ),
        fatal=fatal,
    )
