"""Run registry routes for subagent and future multi-agent runtime state."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from nanobot.platform.runs import RunArtifactNotFoundError, RunNotFoundError, RunStateError
from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


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
    items = request.app.state.runs.list_runs(
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


@router.get("/api/v1/runs/{run_id}")
def get_run(request: Request, run_id: str) -> JSONResponse:
    try:
        data = request.app.state.runs.get_run(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/runs/{run_id}/children")
def get_run_children(request: Request, run_id: str) -> JSONResponse:
    try:
        items = request.app.state.runs.list_children(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    return _json_response(200, _ok({"items": items, "total": len(items)}))


@router.get("/api/v1/runs/{run_id}/tree")
def get_run_tree(request: Request, run_id: str) -> JSONResponse:
    try:
        run = request.app.state.runs.get_run(run_id, include_events=False)
        root_run_id = run.get("rootRunId") or run_id
        tree = request.app.state.runs.get_run_tree(root_run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    return _json_response(200, _ok(tree))


@router.get("/api/v1/runs/{run_id}/artifact")
def get_run_artifact(request: Request, run_id: str) -> JSONResponse:
    try:
        artifact = request.app.state.runs.get_artifact(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunArtifactNotFoundError as exc:
        raise APIError(404, "RUN_ARTIFACT_NOT_FOUND", str(exc)) from exc
    return _json_response(200, _ok(artifact))


@router.post("/api/v1/runs/{run_id}/cancel")
async def cancel_run(request: Request, run_id: str) -> JSONResponse:
    try:
        request.app.state.runs.request_cancel(run_id)
    except RunNotFoundError as exc:
        raise APIError(404, "RUN_NOT_FOUND", "Run not found.") from exc
    except RunStateError as exc:
        raise APIError(409, "RUN_CANCEL_INVALID", str(exc)) from exc

    task_cancel_sent = False
    run = request.app.state.runs.get_run(run_id, include_events=False)
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
                    request.app.state.runs.request_cancel(team_root_run_id)
                except (RunNotFoundError, RunStateError):
                    pass
            if team_root_run_id:
                task_cancel_sent = await team_runtime.cancel_run(team_root_run_id)

    return _json_response(
        202,
        _ok(
            {
                **request.app.state.runs.get_run(run_id),
                "taskCancellationSent": task_cancel_sent,
            }
        ),
    )
