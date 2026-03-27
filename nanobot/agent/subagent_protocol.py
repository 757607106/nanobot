"""Explicit bus protocol for subagent completion events."""

from __future__ import annotations

from typing import Any

SUBAGENT_RESULT_EVENT_TYPE = "subagent_result"
SUBAGENT_RESULT_METADATA_KEY = "_subagent_result"
SYSTEM_EVENT_TYPE_METADATA_KEY = "_system_event_type"
SUBAGENT_RESULT_PROTOCOL_VERSION = 1


def build_subagent_result_metadata(
    *,
    task_id: str,
    label: str,
    task: str,
    result: str,
    status: str,
    origin_channel: str,
    origin_chat_id: str,
    session_key: str,
) -> dict[str, Any]:
    """Build the structured metadata payload for a subagent completion event."""
    return {
        SYSTEM_EVENT_TYPE_METADATA_KEY: SUBAGENT_RESULT_EVENT_TYPE,
        SUBAGENT_RESULT_METADATA_KEY: {
            "protocolVersion": SUBAGENT_RESULT_PROTOCOL_VERSION,
            "taskId": str(task_id or "").strip(),
            "label": str(label or "").strip(),
            "task": str(task or "").strip(),
            "result": str(result or "").strip(),
            "status": str(status or "").strip() or "ok",
            "originChannel": str(origin_channel or "").strip() or "cli",
            "originChatId": str(origin_chat_id or "").strip() or "direct",
            "sessionKey": str(session_key or "").strip(),
        },
    }


def parse_subagent_result_metadata(metadata: dict[str, Any] | None) -> dict[str, Any] | None:
    """Parse and validate a structured subagent completion event payload."""
    if not isinstance(metadata, dict):
        return None
    if str(metadata.get(SYSTEM_EVENT_TYPE_METADATA_KEY) or "").strip() != SUBAGENT_RESULT_EVENT_TYPE:
        return None

    payload = metadata.get(SUBAGENT_RESULT_METADATA_KEY)
    if not isinstance(payload, dict):
        return None

    normalized = {
        "protocolVersion": int(payload.get("protocolVersion") or SUBAGENT_RESULT_PROTOCOL_VERSION),
        "taskId": str(payload.get("taskId") or "").strip(),
        "label": str(payload.get("label") or "").strip(),
        "task": str(payload.get("task") or "").strip(),
        "result": str(payload.get("result") or "").strip(),
        "status": str(payload.get("status") or "").strip() or "ok",
        "originChannel": str(payload.get("originChannel") or "").strip() or "cli",
        "originChatId": str(payload.get("originChatId") or "").strip() or "direct",
        "sessionKey": str(payload.get("sessionKey") or "").strip(),
    }
    if not normalized["taskId"] or not normalized["result"]:
        return None
    if not normalized["sessionKey"]:
        normalized["sessionKey"] = f"{normalized['originChannel']}:{normalized['originChatId']}"
    return normalized


def build_subagent_followup_prompt(payload: dict[str, Any]) -> str:
    """Convert a structured subagent result into the parent-agent follow-up prompt."""
    status = str(payload.get("status") or "ok").strip().lower()
    status_text = "succeeded" if status == "ok" else "failed"
    guidance = (
        "Tell the user the useful outcome briefly and continue helping with the task."
        if status == "ok"
        else "Explain the failure plainly, include the useful error details, and suggest a sensible next step."
    )

    lines = [
        "A background task you delegated has finished.",
        f"Completion status: {status_text}",
    ]
    label = str(payload.get("label") or "").strip()
    if label:
        lines.append(f"Task label: {label}")
    lines.extend(
        [
            "",
            "Original task:",
            str(payload.get("task") or "").strip(),
            "",
            "Subagent result:",
            str(payload.get("result") or "").strip(),
            "",
            guidance,
            "Do not mention internal runtime details like subagents, task IDs, or background orchestration unless the user explicitly asks.",
        ]
    )
    return "\n".join(lines).strip()
