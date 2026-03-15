"""Memory governance routes for collaboration memory scopes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nanobot.platform.memory import MemoryCandidateNotFoundError, MemoryCandidateValidationError
from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


class TeamMemoryUpdateRequest(BaseModel):
    content: str


class MemorySearchRequest(BaseModel):
    query: str
    teamId: str | None = None
    limit: int = 10
    mode: str = "hybrid"


class MemoryGetRequest(BaseModel):
    sourceType: str
    sourceId: str
    teamId: str | None = None


@router.get("/api/v1/teams/{team_id}/memory")
def get_team_memory(request: Request, team_id: str) -> JSONResponse:
    try:
        data = request.app.state.memory.get_team_memory(team_id)
    except MemoryCandidateValidationError as exc:
        raise APIError(400, "TEAM_MEMORY_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/teams/{team_id}/memory")
def update_team_memory(
    request: Request,
    team_id: str,
    payload: TeamMemoryUpdateRequest,
) -> JSONResponse:
    try:
        data = request.app.state.memory.update_team_memory(team_id, payload.content)
    except MemoryCandidateValidationError as exc:
        raise APIError(400, "TEAM_MEMORY_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/memory-candidates")
def list_memory_candidates(
    request: Request,
    team_id: str | None = Query(default=None, alias="teamId"),
    status: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
) -> JSONResponse:
    try:
        items = request.app.state.memory.list_candidates(
            team_id=team_id,
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
        data = request.app.state.memory.search(
            query=payload.query,
            team_id=payload.teamId,
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
        data = request.app.state.memory.get_memory_source(
            source_type=payload.sourceType,
            source_id=payload.sourceId,
            team_id=payload.teamId,
        )
    except MemoryCandidateValidationError as exc:
        raise APIError(400, "MEMORY_GET_INVALID", str(exc)) from exc
    except MemoryCandidateNotFoundError as exc:
        raise APIError(404, "MEMORY_CANDIDATE_NOT_FOUND", "Memory candidate not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/memory-candidates/{candidate_id}/apply")
def apply_memory_candidate(request: Request, candidate_id: str) -> JSONResponse:
    try:
        data = request.app.state.memory.apply_candidate(candidate_id)
    except MemoryCandidateNotFoundError as exc:
        raise APIError(404, "MEMORY_CANDIDATE_NOT_FOUND", "Memory candidate not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/memory-candidates/{candidate_id}/reject")
def reject_memory_candidate(request: Request, candidate_id: str) -> JSONResponse:
    try:
        data = request.app.state.memory.reject_candidate(candidate_id)
    except MemoryCandidateNotFoundError as exc:
        raise APIError(404, "MEMORY_CANDIDATE_NOT_FOUND", "Memory candidate not found.") from exc
    return _json_response(200, _ok(data))
