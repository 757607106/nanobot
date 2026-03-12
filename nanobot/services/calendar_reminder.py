"""Calendar reminder jobs backed by the cron service."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from loguru import logger

from nanobot.cron.service import CronService
from nanobot.cron.types import CronJob, CronSchedule


class CalendarReminderService:
    """Create and manage calendar-derived cron reminder jobs."""

    default_session_id = "calendar-reminders"

    def __init__(self, cron_service: CronService):
        self.cron_service = cron_service

    @staticmethod
    def _parse_datetime(value: str) -> datetime:
        raw = value.strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        return datetime.fromisoformat(raw)

    @staticmethod
    def _job_id(event_id: str, reminder_time: int) -> str:
        return f"cal:{event_id}:{reminder_time}"

    @staticmethod
    def _job_name(title: str) -> str:
        return f"[Calendar] {title}"[:80]

    @staticmethod
    def _job_message(title: str, start_time: datetime, reminder_time: int) -> str:
        if reminder_time <= 0:
            return f'Reminder: "{title}" starts now at {start_time.strftime("%Y-%m-%d %H:%M")}.'
        return (
            f'Reminder: "{title}" starts in {reminder_time} minutes at '
            f'{start_time.strftime("%Y-%m-%d %H:%M")}.'
        )

    @staticmethod
    def _normalize_reminder(reminder: dict[str, Any]) -> tuple[int, str, str]:
        reminder_time = int(reminder.get("time", 15))
        channel = str(reminder.get("channel") or "web").strip() or "web"
        target = str(reminder.get("target") or CalendarReminderService.default_session_id).strip()
        return reminder_time, channel, target

    def create_reminder_jobs(self, event: dict[str, Any]) -> list[CronJob]:
        event_id = str(event.get("id") or "")
        title = str(event.get("title") or "Event").strip() or "Event"
        reminders = event.get("reminders") or []
        if not event_id or not reminders:
            return []

        start_raw = event.get("start_time") or event.get("start")
        if not start_raw:
            return []

        try:
            start_time = self._parse_datetime(str(start_raw))
        except ValueError as exc:
            logger.warning("Calendar reminder skipped for {}: {}", event_id, exc)
            return []

        created: list[CronJob] = []
        now = datetime.now(start_time.tzinfo) if start_time.tzinfo else datetime.now()

        for reminder in reminders:
            reminder_time, channel, target = self._normalize_reminder(reminder)
            trigger_time = start_time - timedelta(minutes=reminder_time)
            if trigger_time <= now:
                logger.info(
                    "Calendar reminder for {} skipped because trigger time {} is in the past",
                    event_id,
                    trigger_time.isoformat(),
                )
                continue

            try:
                job = self.cron_service.add_job(
                    name=self._job_name(title),
                    schedule=CronSchedule(kind="at", at_ms=int(trigger_time.timestamp() * 1000)),
                    message=self._job_message(title, start_time, reminder_time),
                    payload_kind="calendar_reminder",
                    deliver=True,
                    channel=channel,
                    to=target,
                    delete_after_run=True,
                    source="calendar",
                    job_id=self._job_id(event_id, reminder_time),
                )
                created.append(job)
            except ValueError as exc:
                logger.warning("Calendar reminder creation skipped for {}: {}", event_id, exc)

        return created

    def delete_reminder_jobs(self, event_id: str) -> list[str]:
        deleted_ids: list[str] = []
        prefix = f"cal:{event_id}:"
        for job in self.cron_service.list_jobs(include_disabled=True):
            if job.source == "calendar" and job.id.startswith(prefix):
                if self.cron_service.remove_job(job.id):
                    deleted_ids.append(job.id)
        return deleted_ids

    def update_reminder_jobs(self, event: dict[str, Any]) -> list[CronJob]:
        event_id = str(event.get("id") or "")
        if event_id:
            self.delete_reminder_jobs(event_id)
        return self.create_reminder_jobs(event)

    def get_calendar_jobs(self) -> list[CronJob]:
        return [job for job in self.cron_service.list_jobs(include_disabled=True) if job.source == "calendar"]
