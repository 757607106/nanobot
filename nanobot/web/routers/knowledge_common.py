"""Shared helpers for knowledge-base routers."""

from __future__ import annotations

from nanobot.platform.knowledge import (
    KnowledgeBaseConflictError,
    KnowledgeBaseNotFoundError,
    KnowledgeBaseValidationError,
    KnowledgeSourceNotFoundError,
)
from nanobot.web.http import APIError


def _handle_knowledge_error(exc: Exception) -> None:
    if isinstance(exc, KnowledgeBaseNotFoundError):
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    if isinstance(exc, KnowledgeSourceNotFoundError):
        raise APIError(404, "KNOWLEDGE_FILE_NOT_FOUND", "Knowledge file not found.") from exc
    if isinstance(exc, KnowledgeBaseConflictError):
        raise APIError(409, "KNOWLEDGE_BASE_CONFLICT", str(exc)) from exc
    if isinstance(exc, KnowledgeBaseValidationError):
        raise APIError(400, "KNOWLEDGE_INVALID", str(exc)) from exc
    raise exc
