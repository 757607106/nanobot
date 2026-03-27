"""Run registry routes for subagent and future multi-agent runtime state."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse

from nanobot.platform.runs import (
    RunArtifactLifecycleError,
    RunArtifactNotFoundError,
    RunNotFoundError,
    RunStateError,
)
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_runs_service

router = APIRouter()


def _runs_service(request: Request):
    return get_tenant_runs_service(request)


def _artifact_payload_reason(payload: dict[str, Any]) -> str | None:
    reason = str(payload.get("reason") or "").strip()
    return reason or None


def _artifact_payload_days(payload: dict[str, Any], key: str) -> int | None:
    value = payload.get(key)
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise APIError(400, "RUN_ARTIFACT_RETENTION_INVALID", f"{key} must be an integer.") from exc


@router.get("/api/v1/runs")
def list_runs(
    request: Request,
    status: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    agent_id: str | None = Query(default=None, alias="agentId"),
    team_id: str | None = Query(default=None, alias="teamId"),
    session_key: str | None = Query(default=None, alias="sessionKey"),
    parent_run_id: str | None = Query(default=None, alias="parentRunId"),
    root_run_id: str | None = Query(default=None, alias="rootRunId"),
    thread_id: str | None = Query(default=None, alias="threadId"),
    limit: int = Query(default=50, ge=1, le=200),
) -> JSONResponse:
    items = _runs_service(request).list_runs(
        status=status,
        kind=kind,
        agent_id=agent_id,
        team_id=team_id,
        session_key=session_key,
        parent_run_id=parent_run_id,
        root_run_id=root_run_id,
        thread_id=thread_id,
        limit=limit,
    )
    return _json_response(200, _ok({"items": items, "total": len(items)}))


@router.post("/api/v1/runs/artifacts/retention/sweep")
def sweep_artifact_retention(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    limit = payload.get("limit", 200)
    try:
        normalized_limit = int(limit)
    except (TypeError, ValueError) as exc:
        raise APIError(400, "RUN_ARTIFACT_RETENTION_INVALID", "limit must be an integer.") from exc
    if normalized_limit < 1 or normalized_limit > 1000:
        raise APIError(400, "RUN_ARTIFACT_RETENTION_INVALID", "limit must be between 1 and 1000.")
    result = _runs_service(request).sweep_artifact_retention(
        now=str(payload.get("now") or "").strip() or None,
        limit=normalized_limit,
    )
    return _json_response(200, _ok(result))


@router.get("/api/v1/runs/{run_id}")
def get_run(request: Request, run_id: str) -> JSONResponse:
    try:
        data = _runs_service(request).get_run(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/runs/{run_id}/children")
def get_run_children(request: Request, run_id: str) -> JSONResponse:
    try:
        items = _runs_service(request).list_children(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    return _json_response(200, _ok({"items": items, "total": len(items)}))


@router.get("/api/v1/runs/{run_id}/tree")
def get_run_tree(request: Request, run_id: str) -> JSONResponse:
    try:
        runs = _runs_service(request)
        run = runs.get_run(run_id, include_events=False)
        root_run_id = run.get("rootRunId") or run_id
        tree = runs.get_run_tree(root_run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    return _json_response(200, _ok(tree))


@router.get("/api/v1/runs/{run_id}/artifact")
def get_run_artifact(request: Request, run_id: str) -> JSONResponse:
    try:
        artifact = _runs_service(request).get_artifact(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    return _json_response(200, _ok(artifact))


@router.get("/api/v1/runs/{run_id}/artifact/audit")
def get_run_artifact_audit(request: Request, run_id: str) -> JSONResponse:
    try:
        audit = _runs_service(request).get_artifact_audit(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    return _json_response(200, _ok(audit))


@router.get("/api/v1/runs/{run_id}/artifact/policy")
def get_run_artifact_retention_policy(request: Request, run_id: str) -> JSONResponse:
    try:
        policy = _runs_service(request).get_artifact_retention_policy(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    return _json_response(200, _ok(policy))


@router.post("/api/v1/runs/{run_id}/artifact/policy")
def set_run_artifact_retention_policy(
    request: Request,
    run_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        policy = _runs_service(request).set_artifact_retention_policy(
            run_id,
            archive_after_days=_artifact_payload_days(payload, "archiveAfterDays"),
            delete_after_days=_artifact_payload_days(payload, "deleteAfterDays"),
            reason=_artifact_payload_reason(payload),
        )
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    except RunArtifactLifecycleError as exc:
        raise APIError(409, "RUN_ARTIFACT_RETENTION_INVALID", str(exc)) from exc
    return _json_response(200, _ok(policy))


@router.post("/api/v1/runs/{run_id}/artifact/retention/apply")
def apply_run_artifact_retention_policy(
    request: Request,
    run_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        result = _runs_service(request).apply_artifact_retention_policy(
            run_id,
            now=str(payload.get("now") or "").strip() or None,
        )
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    except RunArtifactLifecycleError as exc:
        raise APIError(409, "RUN_ARTIFACT_RETENTION_INVALID", str(exc)) from exc
    return _json_response(200, _ok(result))


@router.post("/api/v1/runs/{run_id}/artifact/archive")
def archive_run_artifact(
    request: Request,
    run_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        audit = _runs_service(request).archive_artifact(
            run_id,
            reason=_artifact_payload_reason(payload),
        )
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    except RunArtifactLifecycleError as exc:
        raise APIError(409, "RUN_ARTIFACT_LIFECYCLE_INVALID", str(exc)) from exc
    return _json_response(200, _ok(audit))


@router.post("/api/v1/runs/{run_id}/artifact/quarantine")
def quarantine_run_artifact(
    request: Request,
    run_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        audit = _runs_service(request).quarantine_artifact(
            run_id,
            reason=_artifact_payload_reason(payload),
        )
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    except RunArtifactLifecycleError as exc:
        raise APIError(409, "RUN_ARTIFACT_LIFECYCLE_INVALID", str(exc)) from exc
    return _json_response(200, _ok(audit))


@router.post("/api/v1/runs/{run_id}/artifact/restore")
def restore_run_artifact(
    request: Request,
    run_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        audit = _runs_service(request).restore_artifact(
            run_id,
            reason=_artifact_payload_reason(payload),
        )
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    except RunArtifactLifecycleError as exc:
        raise APIError(409, "RUN_ARTIFACT_LIFECYCLE_INVALID", str(exc)) from exc
    return _json_response(200, _ok(audit))


@router.post("/api/v1/runs/{run_id}/artifact/delete")
def delete_run_artifact(
    request: Request,
    run_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        audit = _runs_service(request).delete_artifact(
            run_id,
            reason=_artifact_payload_reason(payload),
        )
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    except RunArtifactLifecycleError as exc:
        raise APIError(409, "RUN_ARTIFACT_LIFECYCLE_INVALID", str(exc)) from exc
    return _json_response(200, _ok(audit))


@router.get("/api/v1/runs/{run_id}/boundary-audit")
def get_run_boundary_audit(request: Request, run_id: str) -> JSONResponse:
    try:
        audit = _runs_service(request).get_boundary_audit(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    return _json_response(200, _ok(audit))


@router.post("/api/v1/runs/{run_id}/cancel")
async def cancel_run(request: Request, run_id: str) -> JSONResponse:
    runs = _runs_service(request)
    try:
        runs.request_cancel(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunStateError as exc:
        raise APIError(409, "RUN_CANCEL_INVALID", str(exc)) from exc

    task_cancel_sent = False
    run = runs.get_run(run_id, include_events=False)
    agent = getattr(request.app.state.web, "agent", None)
    subagents = getattr(agent, "subagents", None)
    if subagents is not None:
        task_cancel_sent = await subagents.cancel_run(run_id)
    if not task_cancel_sent:
        team_runtime = getattr(request.app.state.web, "team_runtime", None)
        if team_runtime is not None:
            team_root_run_id = None
            if run.get("kind") == "team":
                team_root_run_id = run_id
            elif run.get("teamId") and run.get("rootRunId"):
                team_root_run_id = str(run["rootRunId"])
                try:
                    runs.request_cancel(team_root_run_id)
                except (RunNotFoundError, RunStateError):
                    pass
            if team_root_run_id:
                task_cancel_sent = await team_runtime.cancel_run(team_root_run_id)

    return _json_response(
        202,
        _ok(
            {
                **runs.get_run(run_id),
                "taskCancellationSent": task_cancel_sent,
            }
        ),
    )
