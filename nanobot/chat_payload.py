"""Shared helpers for structured chat payload fields."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Mapping

ATTACHMENT_BLOCK_MARKER = "[附加文件]"
USER_PROMPT_MARKER = "[用户问题]"


def normalize_chat_attachments(items: Iterable[Mapping[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalize attachment refs for API payloads and persisted session messages."""
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in items or []:
        if not isinstance(item, Mapping):
            continue

        relative_path = str(
            item.get("relativePath")
            or item.get("relative_path")
            or item.get("path")
            or ""
        ).strip()
        path = str(item.get("path") or "").strip()
        name = str(item.get("name") or "").strip()
        if not name:
            source = relative_path or path
            name = Path(source).name if source else ""

        key = relative_path or path or name
        if not key or key in seen:
            continue

        ref: dict[str, Any] = {
            "name": name or key,
            "relativePath": relative_path or path or name or key,
        }
        if path:
            ref["path"] = path

        size_bytes = item.get("sizeBytes", item.get("size_bytes"))
        if isinstance(size_bytes, int) and size_bytes >= 0:
            ref["sizeBytes"] = size_bytes

        uploaded_at = str(item.get("uploadedAt") or item.get("uploaded_at") or "").strip()
        if uploaded_at:
            ref["uploadedAt"] = uploaded_at

        normalized.append(ref)
        seen.add(key)

    return normalized


def build_chat_request_content(content: str, attachments: Iterable[Mapping[str, Any]] | None) -> str:
    """Build the LLM-visible user content from clean text plus structured attachments."""
    trimmed = str(content or "").strip()
    normalized = normalize_chat_attachments(attachments)
    if not normalized:
        return trimmed

    if trimmed.startswith(ATTACHMENT_BLOCK_MARKER) and f"\n\n{USER_PROMPT_MARKER}\n" in trimmed:
        return trimmed

    attachment_lines = []
    for item in normalized:
        relative_path = str(item.get("relativePath") or item.get("path") or item.get("name") or "").strip()
        if relative_path:
            attachment_lines.append(f"- {relative_path}")

    if not attachment_lines:
        return trimmed

    return (
        f"{ATTACHMENT_BLOCK_MARKER}\n"
        f"{chr(10).join(attachment_lines)}\n\n"
        f"{USER_PROMPT_MARKER}\n"
        f"{trimmed}"
    )
