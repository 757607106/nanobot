"""Schedule routes for cron and calendar management."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel

from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


class CronJobMutationRequest(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    triggerType: Literal["at", "every", "cron"] | None = None
    triggerDateMs: int | None = None
    triggerIntervalSeconds: int | None = None
    triggerCronExpr: str | None = None
    triggerTz: str | None = None
    payloadKind: str | None = None
    payloadMessage: str | None = None
    payloadDeliver: bool | None = None
    payloadChannel: str | None = None
    payloadTo: str | None = None
    deleteAfterRun: bool | None = None


class CalendarSettingsUpdateRequest(BaseModel):
    defaultView: Literal["dayGridMonth", "timeGridWeek", "timeGridDay", "listWeek"] | None = None
    defaultPriority: Literal["high", "medium", "low"] | None = None
    soundEnabled: bool | None = None
    notificationEnabled: bool | None = None


@router.get("/api/v1/cron/status")
def get_cron_status(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_cron_status()))


@router.get("/api/v1/cron/jobs")
def get_cron_jobs(
    request: Request,
    include_disabled: bool = Query(False, alias="includeDisabled"),
) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.list_cron_jobs(include_disabled)))


@router.post("/api/v1/cron/jobs")
def create_cron_job(request: Request, payload: CronJobMutationRequest) -> JSONResponse:
    try:
        data = request.app.state.web.create_cron_job(payload.model_dump())
    except ValueError as exc:
        raise APIError(400, "CRON_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.patch("/api/v1/cron/jobs/{job_id}")
def update_cron_job(
    request: Request,
    job_id: str,
    payload: CronJobMutationRequest,
) -> JSONResponse:
    try:
        data = request.app.state.web.update_cron_job(job_id, payload.model_dump())
    except KeyError as exc:
        raise APIError(404, "CRON_JOB_NOT_FOUND", "Cron job not found.") from exc
    except ValueError as exc:
        raise APIError(400, "CRON_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/cron/jobs/{job_id}")
def delete_cron_job(request: Request, job_id: str) -> JSONResponse:
    deleted = request.app.state.web.delete_cron_job(job_id)
    if not deleted:
        raise APIError(404, "CRON_JOB_NOT_FOUND", "Cron job not found.")
    return _json_response(200, _ok({"deleted": True}))


@router.post("/api/v1/cron/jobs/{job_id}/run")
def run_cron_job(request: Request, job_id: str) -> JSONResponse:
    try:
        ran = request.app.state.web.run_cron_job(job_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Cron run failed")
        raise APIError(500, "CRON_RUN_FAILED", "Failed to run cron job.", str(exc)) from exc
    if not ran:
        raise APIError(404, "CRON_JOB_NOT_FOUND", "Cron job not found.")
    return _json_response(200, _ok({"ran": True}))


@router.get("/api/v1/calendar/events")
def get_calendar_events(
    request: Request,
    start: str | None = Query(None),
    end: str | None = Query(None),
) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_calendar_events(start, end)))


@router.post("/api/v1/calendar/events")
def create_calendar_event(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.web.create_calendar_event(payload)
    except ValueError as exc:
        raise APIError(400, "CALENDAR_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.patch("/api/v1/calendar/events/{event_id}")
def update_calendar_event(
    request: Request,
    event_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.web.update_calendar_event(event_id, payload)
    except KeyError as exc:
        raise APIError(404, "CALENDAR_EVENT_NOT_FOUND", "Calendar event not found.") from exc
    except ValueError as exc:
        raise APIError(400, "CALENDAR_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/calendar/events/{event_id}")
def delete_calendar_event(request: Request, event_id: str) -> JSONResponse:
    deleted = request.app.state.web.delete_calendar_event(event_id)
    if not deleted:
        raise APIError(404, "CALENDAR_EVENT_NOT_FOUND", "Calendar event not found.")
    return _json_response(200, _ok({"deleted": True}))


@router.get("/api/v1/calendar/settings")
def get_calendar_settings(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_calendar_settings()))


@router.patch("/api/v1/calendar/settings")
def update_calendar_settings(
    request: Request,
    payload: CalendarSettingsUpdateRequest,
) -> JSONResponse:
    try:
        data = request.app.state.web.update_calendar_settings(payload.model_dump())
    except ValueError as exc:
        raise APIError(400, "CALENDAR_SETTINGS_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/calendar/jobs")
def get_calendar_jobs(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_calendar_jobs()))
