"""Reasoning capability and effort normalization helpers."""

from __future__ import annotations

import re

_REASONING_MODEL_PATTERNS = (
    re.compile(r"\bgpt-5(?:[\W_]|$)", re.IGNORECASE),
    re.compile(r"\bo[134](?:[\W_]|$)", re.IGNORECASE),
    re.compile(r"deepseek[-_/]?reasoner", re.IGNORECASE),
    re.compile(r"deepseek[-_/]?r1", re.IGNORECASE),
    re.compile(r"\bqwq\b", re.IGNORECASE),
    re.compile(r"\breason(?:er|ing)\b", re.IGNORECASE),
)

_REASONING_PROVIDERS = {
    "anthropic",
    "azure_openai",
    "openai_codex",
    "dashscope",
    "volcengine",
    "volcengine_coding_plan",
    "byteplus",
    "byteplus_coding_plan",
}

_REASONING_BACKENDS = {
    "anthropic",
    "azure_openai",
    "openai_codex",
}

_NON_CHAT_CAPABILITIES = {
    "embedding",
    "rerank",
}

_DISABLED_REASONING_VALUES = {
    "none",
    "off",
    "false",
    "0",
    "disabled",
}

_ALLOWED_REASONING_LEVELS = {
    "low",
    "medium",
    "high",
}


def normalize_reasoning_effort(value: str | None) -> str | None:
    """Normalize reasoning effort to ``low|medium|high|none|None``."""
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    if normalized in _DISABLED_REASONING_VALUES:
        return "none"
    if normalized in _ALLOWED_REASONING_LEVELS:
        return normalized
    return None


def supports_reasoning_mode(
    *,
    model: str | None,
    provider_name: str | None,
    provider_backend: str | None,
    capability_type: str | None,
) -> bool:
    """Return whether the selected model should expose reasoning controls."""
    capability = str(capability_type or "").strip().lower()
    if capability and capability in _NON_CHAT_CAPABILITIES:
        return False

    provider = str(provider_name or "").strip().lower()
    backend = str(provider_backend or "").strip().lower()
    model_name = str(model or "").strip()

    if provider in _REASONING_PROVIDERS or backend in _REASONING_BACKENDS:
        return True
    if not model_name:
        return False
    return any(pattern.search(model_name) for pattern in _REASONING_MODEL_PATTERNS)
