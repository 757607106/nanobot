"""Memory governance routes for collaboration memory scopes."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nanobot.platform.memory import MemoryCandidateNotFoundError, MemoryCandidateValidationError
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_memory_service

router = APIRouter()


def _memory_service(request: Request):
    return get_tenant_memory_service(request)


class MemorySearchRequest(BaseModel):
    query: str
    agentId: str | None = None
    limit: int = 10
    mode: str = "hybrid"


class MemoryGetRequest(BaseModel):
    sourceType: str
    sourceId: str
    agentId: str | None = None


@router.get("/api/v1/memory-candidates")
def list_memory_candidates(
    request: Request,
    agent_id: str | None = Query(default=None, alias="agentId"),
    status: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
) -> JSONResponse:
    try:
        items = _memory_service(request).list_candidates(
            agent_id=agent_id,
            status=status,
            scope=scope,
            limit=limit,
        )
    except MemoryCandidateValidationError as exc:
        raise APIError(400, "MEMORY_CANDIDATE_INVALID", str(exc)) from exc
    return _json_response(200, _ok({"items": items, "total": len(items)}))


@router.post("/api/v1/memory-search")
def search_memory(
    request: Request,
    payload: MemorySearchRequest,
) -> JSONResponse:
    try:
        data = _memory_service(request).search(
            query=payload.query,
            agent_id=payload.agentId,
            limit=payload.limit,
            mode=payload.mode,
        )
    except MemoryCandidateValidationError as exc:
        raise APIError(400, "MEMORY_SEARCH_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/memory-get")
def get_memory_source(
    request: Request,
    payload: MemoryGetRequest,
) -> JSONResponse:
    try:
        data = _memory_service(request).get_memory_source(
            source_type=payload.sourceType,
            source_id=payload.sourceId,
            agent_id=payload.agentId,
        )
    except MemoryCandidateValidationError as exc:
        raise APIError(400, "MEMORY_GET_INVALID", str(exc)) from exc
    except MemoryCandidateNotFoundError as exc:
        raise APIError(404, "MEMORY_CANDIDATE_NOT_FOUND", "Memory candidate not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/memory-candidates/{candidate_id}/apply")
def apply_memory_candidate(request: Request, candidate_id: str) -> JSONResponse:
    try:
        data = _memory_service(request).apply_candidate(candidate_id)
    except MemoryCandidateNotFoundError as exc:
        raise APIError(404, "MEMORY_CANDIDATE_NOT_FOUND", "Memory candidate not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/memory-candidates/{candidate_id}/reject")
def reject_memory_candidate(request: Request, candidate_id: str) -> JSONResponse:
    try:
        data = _memory_service(request).reject_candidate(candidate_id)
    except MemoryCandidateNotFoundError as exc:
        raise APIError(404, "MEMORY_CANDIDATE_NOT_FOUND", "Memory candidate not found.") from exc
    return _json_response(200, _ok(data))
