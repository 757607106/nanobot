"""Shared execution event payload builders for harness runtimes."""

from __future__ import annotations

from typing import Any


def preview_text(value: Any, *, limit: int = 500) -> str:
    """Normalize text-like content into a compact single-line preview."""
    text = str(value or "").strip()
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3] + "..."


def build_model_called_payload(*, iteration: int, model: str, message_count: int) -> dict[str, Any]:
    """Build a normalized model-called event payload."""
    return {
        "iteration": iteration,
        "model": model,
        "messageCount": message_count,
    }


def build_model_result_payload(
    *,
    iteration: int,
    model: str,
    finish_reason: str | None,
    tool_call_count: int,
    has_visible_content: bool,
) -> dict[str, Any]:
    """Build a normalized model-result event payload."""
    return {
        "iteration": iteration,
        "model": model,
        "finishReason": finish_reason,
        "toolCallCount": tool_call_count,
        "hasVisibleContent": has_visible_content,
    }


def build_tool_called_payload(
    *,
    tool_name: str,
    arguments: Any,
    iteration: int | None = None,
) -> dict[str, Any]:
    """Build a normalized tool-called event payload."""
    payload: dict[str, Any] = {
        "toolName": tool_name,
        "arguments": arguments,
    }
    if iteration is not None:
        payload["iteration"] = iteration
    return payload


def build_tool_result_payload(
    *,
    tool_name: str,
    result: str | None,
    iteration: int | None = None,
    preview_limit: int = 500,
) -> dict[str, Any]:
    """Build a normalized tool-result event payload."""
    text = str(result or "")
    payload: dict[str, Any] = {
        "toolName": tool_name,
        "contentPreview": text[:preview_limit],
        "isError": text.startswith("Error"),
    }
    if iteration is not None:
        payload["iteration"] = iteration
    return payload


