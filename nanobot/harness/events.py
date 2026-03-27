"""Shared execution event payload builders for harness runtimes."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage


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


def summarize_langgraph_message(message: BaseMessage) -> dict[str, Any]:
    """Build a compact event-safe summary for one LangGraph message."""
    if isinstance(message, AIMessage):
        role = "assistant"
    elif isinstance(message, HumanMessage):
        role = "user"
    elif isinstance(message, ToolMessage):
        role = "tool"
    elif isinstance(message, SystemMessage):
        role = "system"
    else:
        role = "message"

    content = ""
    if isinstance(message.content, str):
        content = message.content
    elif message.content:
        content = str(message.content)

    summary: dict[str, Any] = {
        "role": role,
        "messageType": type(message).__name__,
    }
    preview = preview_text(content, limit=280)
    if preview:
        summary["contentPreview"] = preview
        summary["contentLength"] = len(content)

    if isinstance(message, AIMessage) and message.tool_calls:
        tool_names = [
            str(tool_call.get("name") or "").strip()
            for tool_call in message.tool_calls
            if str(tool_call.get("name") or "").strip()
        ]
        if tool_names:
            summary["toolCalls"] = tool_names

    if isinstance(message, ToolMessage) and message.tool_call_id:
        summary["toolCallId"] = message.tool_call_id

    return summary


def summarize_langgraph_chunk(chunk: dict[str, Any]) -> dict[str, Any] | None:
    """Build a compact root-run event summary for one LangGraph stream chunk."""
    node_summaries: list[dict[str, Any]] = []
    last_message: dict[str, Any] | None = None

    for node_name, node_payload in chunk.items():
        if not isinstance(node_payload, dict):
            continue
        messages = node_payload.get("messages")
        if not isinstance(messages, list) or not messages:
            continue
        summary: dict[str, Any] = {
            "node": str(node_name),
            "messageCount": len(messages),
        }
        latest = messages[-1]
        if isinstance(latest, BaseMessage):
            latest_summary = summarize_langgraph_message(latest)
            summary["lastMessage"] = latest_summary
            last_message = latest_summary
        node_summaries.append(summary)

    if not node_summaries:
        return None
    return {
        "nodes": node_summaries,
        "lastMessage": last_message,
    }
