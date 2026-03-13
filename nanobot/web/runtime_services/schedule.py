"""Cron and calendar runtime helpers for the nanobot Web UI."""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading
from datetime import datetime
from typing import TYPE_CHECKING, Any

from nanobot.agent.tools.cron import CronTool
from nanobot.cron.types import CronJob, CronPayload, CronSchedule
from nanobot.services.calendar_reminder import CalendarReminderService

if TYPE_CHECKING:
    from nanobot.web.runtime import WebAppState


class WebScheduleRuntimeService:
    """Encapsulates cron and calendar business logic."""

    def __init__(self, state: WebAppState):
        self.state = state

    def start_runtime(self) -> None:
        if self.state._cron_thread and self.state._cron_thread.is_alive():
            return

        loop = asyncio.new_event_loop()
        self.state._cron_loop = loop
        self.state._cron_ready.clear()

        def runner() -> None:
            asyncio.set_event_loop(loop)
            self.state._cron_ready.set()
            try:
                loop.run_forever()
            finally:
                pending = [task for task in asyncio.all_tasks(loop) if not task.done()]
                for task in pending:
                    task.cancel()
                if pending:
                    loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                loop.close()

        self.state._cron_thread = threading.Thread(
            target=runner,
            name="nanobot-web-cron",
            daemon=True,
        )
        self.state._cron_thread.start()
        if not self.state._cron_ready.wait(timeout=5):
            raise RuntimeError("Failed to start cron runtime.")
        self.run_coro(self.state.cron.start())

    def call(self, func, *args, **kwargs):
        if self.state._cron_loop is None:
            raise RuntimeError("Cron runtime is not available.")
        if threading.current_thread() is self.state._cron_thread:
            return func(*args, **kwargs)

        future: concurrent.futures.Future[Any] = concurrent.futures.Future()

        def runner() -> None:
            try:
                future.set_result(func(*args, **kwargs))
            except Exception as exc:  # noqa: BLE001
                future.set_exception(exc)

        self.state._cron_loop.call_soon_threadsafe(runner)
        return future.result()

    def run_coro(self, coro):
        if self.state._cron_loop is None:
            raise RuntimeError("Cron runtime is not available.")
        return asyncio.run_coroutine_threadsafe(coro, self.state._cron_loop).result()

    def stop_runtime(self) -> None:
        loop = self.state._cron_loop
        thread = self.state._cron_thread
        if loop is None:
            return

        try:
            self.call(self.state.cron.stop)
        except Exception:  # noqa: BLE001
            from loguru import logger

            logger.exception("Failed to stop cron service cleanly")

        loop.call_soon_threadsafe(loop.stop)
        if thread and thread.is_alive():
            thread.join(timeout=5)

        self.state._cron_loop = None
        self.state._cron_thread = None

    async def handle_cron_job(self, job: CronJob) -> str | None:
        if self.state.agent is None:
            raise RuntimeError("Agent is not available.")

        if job.payload.kind == "calendar_reminder":
            return self.write_calendar_reminder(job)

        reminder_note = (
            "[Scheduled Task] Timer finished.\n\n"
            f"Task '{job.name}' has been triggered.\n"
            f"Scheduled instruction: {job.payload.message}"
        )

        channel = job.payload.channel or "web"
        chat_id = job.payload.to or job.id
        session_key = f"cron:{job.id}"

        if channel == "web" and job.payload.to and self.state.sessions is not None:
            session_key = self.state.chat_runtime.session_key(job.payload.to)
            session = self.state.sessions.get_or_create(session_key)
            if not session.metadata.get("title"):
                session.metadata["title"] = job.name
                self.state.sessions.save(session)

        cron_tool = self.state.agent.tools.get("cron")
        cron_token = None
        if isinstance(cron_tool, CronTool):
            cron_token = cron_tool.set_cron_context(True)
        try:
            return await self.state.agent.process_direct(
                reminder_note,
                session_key=session_key,
                channel=channel,
                chat_id=chat_id,
            )
        finally:
            if isinstance(cron_tool, CronTool) and cron_token is not None:
                cron_tool.reset_cron_context(cron_token)

    @staticmethod
    def format_cron_job(job: CronJob) -> dict[str, Any]:
        interval_seconds = None
        if job.schedule.every_ms is not None:
            interval_seconds = job.schedule.every_ms // 1000

        return {
            "id": job.id,
            "name": job.name,
            "enabled": job.enabled,
            "source": job.source,
            "trigger": {
                "type": job.schedule.kind,
                "dateMs": job.schedule.at_ms,
                "intervalSeconds": interval_seconds,
                "cronExpr": job.schedule.expr,
                "tz": job.schedule.tz,
            },
            "payload": {
                "kind": job.payload.kind,
                "message": job.payload.message,
                "deliver": job.payload.deliver,
                "channel": job.payload.channel,
                "to": job.payload.to,
            },
            "nextRunAtMs": job.state.next_run_at_ms,
            "lastRunAtMs": job.state.last_run_at_ms,
            "lastStatus": job.state.last_status,
            "lastError": job.state.last_error,
            "deleteAfterRun": job.delete_after_run,
            "createdAtMs": job.created_at_ms,
            "updatedAtMs": job.updated_at_ms,
        }

    @staticmethod
    def parse_datetime(value: str) -> datetime:
        raw = value.strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(raw)
        except ValueError as exc:
            raise ValueError(f"Invalid datetime value '{value}'. Expected ISO format.") from exc

    @staticmethod
    def format_calendar_event(event: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": event["id"],
            "title": event["title"],
            "description": event.get("description") or "",
            "start": event["start_time"],
            "end": event["end_time"],
            "isAllDay": bool(event.get("is_all_day", False)),
            "priority": event.get("priority", "medium"),
            "reminders": event.get("reminders") or [],
            "recurrence": event.get("recurrence"),
            "recurrenceId": event.get("recurrence_id"),
            "createdAt": event.get("created_at"),
            "updatedAt": event.get("updated_at"),
        }

    @staticmethod
    def format_calendar_settings(settings: dict[str, Any]) -> dict[str, Any]:
        return {
            "defaultView": settings.get("default_view", "dayGridMonth"),
            "defaultPriority": settings.get("default_priority", "medium"),
            "soundEnabled": bool(settings.get("sound_enabled", True)),
            "notificationEnabled": bool(settings.get("notification_enabled", True)),
        }

    def normalize_calendar_event_payload(
        self,
        payload: dict[str, Any],
        existing: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        title = payload.get("title")
        if title is None and existing is not None:
            title = existing["title"]
        title = str(title or "").strip()
        if not title:
            raise ValueError("title is required.")

        start_time = payload.get("start")
        if start_time is None and existing is not None:
            start_time = existing["start_time"]
        if not start_time:
            raise ValueError("start is required.")

        end_time = payload.get("end")
        if end_time is None and existing is not None:
            end_time = existing["end_time"]
        if not end_time:
            raise ValueError("end is required.")

        start_dt = self.parse_datetime(str(start_time))
        end_dt = self.parse_datetime(str(end_time))
        if end_dt <= start_dt:
            raise ValueError("end must be later than start.")

        description = payload.get("description")
        if description is None and existing is not None:
            description = existing.get("description", "")

        is_all_day = payload.get("isAllDay")
        if is_all_day is None and existing is not None:
            is_all_day = existing.get("is_all_day", False)

        priority = payload.get("priority")
        if priority is None and existing is not None:
            priority = existing.get("priority", "medium")
        priority = str(priority or "medium")
        if priority not in {"high", "medium", "low"}:
            raise ValueError("priority must be one of: high, medium, low.")

        reminders = payload.get("reminders")
        if reminders is None and existing is not None:
            reminders = existing.get("reminders") or []

        recurrence = payload.get("recurrence")
        if recurrence is None and existing is not None:
            recurrence = existing.get("recurrence")

        recurrence_id = payload.get("recurrenceId")
        if recurrence_id is None and existing is not None:
            recurrence_id = existing.get("recurrence_id")

        normalized = {
            "title": title,
            "description": str(description or ""),
            "start_time": str(start_time),
            "end_time": str(end_time),
            "is_all_day": bool(is_all_day),
            "priority": priority,
            "reminders": reminders or [],
            "recurrence": recurrence,
            "recurrence_id": recurrence_id,
        }
        event_id = payload.get("id")
        if event_id:
            normalized["id"] = str(event_id)
        return normalized

    @staticmethod
    def build_cron_schedule(
        payload: dict[str, Any],
        existing: CronSchedule | None = None,
    ) -> CronSchedule:
        trigger_type = payload.get("triggerType") or (existing.kind if existing else None)
        if trigger_type not in {"at", "every", "cron"}:
            raise ValueError("triggerType must be one of: at, every, cron.")

        if trigger_type == "at":
            date_ms = payload.get("triggerDateMs")
            if date_ms is None:
                date_ms = existing.at_ms if existing and existing.kind == "at" else None
            if date_ms is None:
                raise ValueError("triggerDateMs is required for one-time jobs.")
            return CronSchedule(kind="at", at_ms=int(date_ms))

        if trigger_type == "every":
            interval_seconds = payload.get("triggerIntervalSeconds")
            if interval_seconds is None and existing and existing.kind == "every":
                every_ms = existing.every_ms
            elif interval_seconds is None:
                every_ms = None
            else:
                every_ms = int(interval_seconds) * 1000
            if every_ms is None or every_ms <= 0:
                raise ValueError("triggerIntervalSeconds must be greater than 0.")
            return CronSchedule(kind="every", every_ms=every_ms)

        cron_expr = payload.get("triggerCronExpr")
        if cron_expr is None and existing and existing.kind == "cron":
            cron_expr = existing.expr
        cron_expr = str(cron_expr or "").strip()
        if not cron_expr:
            raise ValueError("triggerCronExpr is required for cron jobs.")

        timezone = payload.get("triggerTz")
        if timezone is None and existing and existing.kind == "cron":
            timezone = existing.tz
        timezone = str(timezone).strip() if timezone else None
        return CronSchedule(kind="cron", expr=cron_expr, tz=timezone)

    @staticmethod
    def build_cron_payload(
        payload: dict[str, Any],
        existing: CronPayload | None = None,
    ) -> CronPayload:
        payload_kind = payload.get("payloadKind") or (existing.kind if existing else "agent_turn")
        if payload_kind != "agent_turn":
            raise ValueError("Only agent_turn payloads are supported by the Web UI.")

        message = payload.get("payloadMessage")
        if message is None:
            message = existing.message if existing else ""
        message = str(message).strip()
        if not message:
            raise ValueError("payloadMessage is required.")

        deliver = payload.get("payloadDeliver")
        if deliver is None:
            deliver = existing.deliver if existing else False

        channel = payload.get("payloadChannel")
        if channel is None:
            channel = existing.channel if existing else None
        channel = str(channel).strip() if channel else None

        target = payload.get("payloadTo")
        if target is None:
            target = existing.to if existing else None
        target = str(target).strip() if target else None

        return CronPayload(
            kind="agent_turn",
            message=message,
            deliver=bool(deliver),
            channel=channel,
            to=target,
        )

    def create_cron_job_in_loop(self, payload: dict[str, Any]) -> dict[str, Any]:
        schedule = self.build_cron_schedule(payload)
        cron_payload = self.build_cron_payload(payload)
        name = str(payload.get("name") or "").strip() or cron_payload.message[:40]
        if not name:
            raise ValueError("name is required.")

        delete_after_run = payload.get("deleteAfterRun")
        if delete_after_run is None:
            delete_after_run = schedule.kind == "at"

        job = self.state.cron.add_job(
            name=name,
            schedule=schedule,
            message=cron_payload.message,
            deliver=cron_payload.deliver,
            channel=cron_payload.channel,
            to=cron_payload.to,
            delete_after_run=bool(delete_after_run),
        )
        return self.format_cron_job(job)

    def update_cron_job_in_loop(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.state.cron.get_job(job_id)
        if existing is None:
            raise KeyError(job_id)

        schedule = self.build_cron_schedule(payload, existing.schedule)
        cron_payload = self.build_cron_payload(payload, existing.payload)
        name = str(payload.get("name") or existing.name).strip()
        if not name:
            raise ValueError("name is required.")

        delete_after_run = payload.get("deleteAfterRun")
        if delete_after_run is None:
            delete_after_run = existing.delete_after_run

        enabled = payload.get("enabled")
        if enabled is None:
            enabled = existing.enabled

        updated = self.state.cron.update_job(
            job_id,
            name=name,
            enabled=bool(enabled),
            schedule=schedule,
            payload=cron_payload,
            delete_after_run=bool(delete_after_run),
        )
        if updated is None:
            raise KeyError(job_id)
        return self.format_cron_job(updated)

    def write_calendar_reminder(self, job: CronJob) -> str:
        if self.state.sessions is None:
            raise RuntimeError("Session manager is not available.")

        session_id = job.payload.to or CalendarReminderService.default_session_id
        session = self.state.sessions.get_or_create(self.state.chat_runtime.session_key(session_id))
        if not session.metadata.get("title"):
            session.metadata["title"] = "Calendar Reminders"
        session.add_message("assistant", job.payload.message, name="calendar_reminder")
        self.state.sessions.save(session)
        return job.payload.message

    def get_cron_status(self) -> dict[str, Any]:
        status = self.call(self.state.cron.status)
        return {
            "enabled": status["enabled"],
            "jobs": status["jobs"],
            "nextWakeAtMs": status["next_wake_at_ms"],
            "deliveryMode": "agent_only",
        }

    def list_cron_jobs(self, include_disabled: bool = False) -> dict[str, Any]:
        return self.call(
            lambda: {
                "jobs": [
                    self.format_cron_job(job)
                    for job in self.state.cron.list_jobs(include_disabled=include_disabled)
                ]
            }
        )

    def create_cron_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.call(self.create_cron_job_in_loop, payload)

    def update_cron_job(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.call(self.update_cron_job_in_loop, job_id, payload)

    def delete_cron_job(self, job_id: str) -> bool:
        return self.call(self.state.cron.remove_job, job_id)

    def run_cron_job(self, job_id: str) -> bool:
        return self.run_coro(self.state.cron.run_job(job_id, force=True))

    def get_calendar_events(
        self,
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> list[dict[str, Any]]:
        events = self.state.calendar_repo.get_events(start_time=start_time, end_time=end_time)
        return [self.format_calendar_event(event) for event in events]

    def create_calendar_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = self.normalize_calendar_event_payload(payload)
        event = self.state.calendar_repo.create_event(normalized)
        self.call(self.state.calendar_reminders.create_reminder_jobs, event)
        return self.format_calendar_event(event)

    def update_calendar_event(self, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.state.calendar_repo.get_event(event_id)
        if existing is None:
            raise KeyError(event_id)
        normalized = self.normalize_calendar_event_payload(payload, existing)
        updated = self.state.calendar_repo.update_event(event_id, normalized)
        if updated is None:
            raise KeyError(event_id)
        self.call(self.state.calendar_reminders.update_reminder_jobs, updated)
        return self.format_calendar_event(updated)

    def delete_calendar_event(self, event_id: str) -> bool:
        self.call(self.state.calendar_reminders.delete_reminder_jobs, event_id)
        return self.state.calendar_repo.delete_event(event_id)

    def get_calendar_settings(self) -> dict[str, Any]:
        return self.format_calendar_settings(self.state.calendar_repo.get_settings())

    def update_calendar_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        settings = {
            "default_view": payload.get("defaultView"),
            "default_priority": payload.get("defaultPriority"),
            "sound_enabled": payload.get("soundEnabled"),
            "notification_enabled": payload.get("notificationEnabled"),
        }
        cleaned = {key: value for key, value in settings.items() if value is not None}
        if cleaned.get("default_view") and cleaned["default_view"] not in {
            "dayGridMonth",
            "timeGridWeek",
            "timeGridDay",
            "listWeek",
        }:
            raise ValueError("defaultView is invalid.")
        if cleaned.get("default_priority") and cleaned["default_priority"] not in {
            "high",
            "medium",
            "low",
        }:
            raise ValueError("defaultPriority is invalid.")
        updated = self.state.calendar_repo.update_settings(cleaned)
        return self.format_calendar_settings(updated)

    def get_calendar_jobs(self) -> list[dict[str, Any]]:
        jobs = self.call(self.state.calendar_reminders.get_calendar_jobs)
        return [self.format_cron_job(job) for job in jobs]
