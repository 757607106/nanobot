"""Backward-compatible alias for the legacy custom provider entry point."""

from __future__ import annotations

from nanobot.providers.openai_compat_provider import OpenAICompatProvider


class CustomProvider(OpenAICompatProvider):
    """Compatibility shim that preserves the old import path."""

