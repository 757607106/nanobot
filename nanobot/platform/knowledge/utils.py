"""Common utility functions and constants for the knowledge subsystem."""

from __future__ import annotations

import re
import uuid
from typing import Any


# ── Defaults ──

DEFAULT_KNOWLEDGE_CHUNK_SIZE = 500
DEFAULT_KNOWLEDGE_CHUNK_OVERLAP = 80
DEFAULT_BEST_EFFORT_RETRIEVE_TIMEOUT_SECONDS = 30.0


# ── ID / naming helpers ──

def slugify(value: str) -> str:
    """Generate a URL-safe slug from a human-readable label."""
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "knowledge-base"


def short_id(prefix: str) -> str:
    """Return a compact random ID like ``kb_a1b2c3d4e5f6``."""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ── Payload validation helpers ──

def get_value(payload: dict[str, Any], *keys: str) -> Any:
    """Return the first matching key from *payload*, or ``None``."""
    for key in keys:
        if key in payload:
            return payload[key]
    return None


def normalize_text(value: Any, *, required: bool = False, field_name: str = "value") -> str:
    """Coerce a single value to a stripped string; optionally require non-empty."""
    from nanobot.platform.knowledge.service import KnowledgeBaseValidationError

    text = str(value or "").strip()
    if required and not text:
        raise KnowledgeBaseValidationError(f"{field_name} is required.")
    return text


def normalize_string_list(value: Any, *, field_name: str) -> list[str]:
    """Coerce *value* to a de-duplicated list of non-empty strings."""
    from nanobot.platform.knowledge.service import KnowledgeBaseValidationError

    if value is None:
        return []
    if not isinstance(value, list):
        raise KnowledgeBaseValidationError(f"{field_name} must be a list of strings.")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def normalize_object(value: Any, *, field_name: str) -> dict[str, Any]:
    """Coerce *value* to a plain ``dict``."""
    from nanobot.platform.knowledge.service import KnowledgeBaseValidationError

    if value is None:
        return {}
    if not isinstance(value, dict):
        raise KnowledgeBaseValidationError(f"{field_name} must be an object.")
    return dict(value)


def normalize_eval_text(text: str) -> str:
    """Lowercase, strip punctuation, and collapse whitespace for evaluation comparison."""
    lowered = str(text or "").strip().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\u4e00-\u9fff]+", " ", lowered)).strip()


def knowledge_model_value(info: dict[str, Any] | None, *keys: str) -> str:
    """Extract the first truthy string from nested model-info dicts."""
    for key in keys:
        value = str((info or {}).get(key) or "").strip()
        if value:
            return value
    return ""


def binding_supports_capability(
    binding_capability: str | None,
    requested_capability: str | None,
) -> bool:
    """Return whether a binding can satisfy the requested knowledge capability."""
    requested = str(requested_capability or "").strip()
    current = str(binding_capability or "").strip()
    if not requested:
        return True
    if requested == "text_chat":
        return current in {"text_chat", "multimodal"}
    return current == requested


def first_binding_name_by_capability(
    bindings: dict[str, Any] | None,
    capability_type: str,
) -> str | None:
    """Return the first configured binding that satisfies the requested capability."""
    items = list(dict(bindings or {}).items())
    for binding_name, binding in items:
        if str(getattr(binding, "capability_type", None) or "").strip() == capability_type:
            return str(binding_name)
    for binding_name, binding in items:
        if binding_supports_capability(
            getattr(binding, "capability_type", None),
            capability_type,
        ):
            return str(binding_name)
    return None


def infer_embedding_dim(model: str | None, provider_name: str | None = None) -> int:
    """Infer the expected embedding dimensionality for common providers/models."""
    model_name = str(model or "").strip().lower()
    provider = str(provider_name or "").strip().lower()
    if provider == "dashscope" and "text-embedding-v4" in model_name:
        return 1024
    if "text-embedding-3-small" in model_name or "text-embedding-ada-002" in model_name:
        return 1536
    return 3072


def split_large_block(text: str, *, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Split an oversized text block into fixed-size overlapping windows."""
    if len(text) <= chunk_size:
        return [text]
    result: list[str] = []
    start = 0
    step = max(1, chunk_size - max(0, chunk_overlap))
    while start < len(text):
        result.append(text[start : start + chunk_size].strip())
        start += step
    return [item for item in result if item]
