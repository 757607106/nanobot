"""Cron service for scheduling agent tasks."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Coroutine

from loguru import logger

from nanobot.config.schema import RagPostgresConfig
from nanobot.cron.store import CronJobStore
from nanobot.cron.types import CronJob, CronJobState, CronPayload, CronSchedule


def _now_ms() -> int:
    return int(time.time() * 1000)


def _compute_next_run(schedule: CronSchedule, now_ms: int) -> int | None:
    """Compute next run time in ms."""
    if schedule.kind == "at":
        return schedule.at_ms if schedule.at_ms and schedule.at_ms > now_ms else None

    if schedule.kind == "every":
        if not schedule.every_ms or schedule.every_ms <= 0:
            return None
        return now_ms + schedule.every_ms

    if schedule.kind == "cron" and schedule.expr:
        try:
            from zoneinfo import ZoneInfo

            from croniter import croniter

            base_time = now_ms / 1000
            tz = ZoneInfo(schedule.tz) if schedule.tz else datetime.now().astimezone().tzinfo
            base_dt = datetime.fromtimestamp(base_time, tz=tz)
            cron = croniter(schedule.expr, base_dt)
            next_dt = cron.get_next(datetime)
            return int(next_dt.timestamp() * 1000)
        except Exception:
            return None

    return None


def _validate_schedule_for_add(schedule: CronSchedule) -> None:
    """Validate schedule fields that would otherwise create non-runnable jobs."""
    if schedule.tz and schedule.kind != "cron":
        raise ValueError("tz can only be used with cron schedules")

    if schedule.kind == "cron" and schedule.tz:
        try:
            from zoneinfo import ZoneInfo

            ZoneInfo(schedule.tz)
        except Exception:
            raise ValueError(f"unknown timezone '{schedule.tz}'") from None


class CronService:
    """Service for managing and executing scheduled jobs."""

    _MAX_RUN_HISTORY = 20

    def __init__(
        self,
        workspace: Path,
        postgres: RagPostgresConfig | dict[str, Any] | None = None,
        on_job: Callable[[CronJob], Coroutine[Any, Any, str | None]] | None = None,
        max_sleep_ms: int = 300_000,
    ):
        self.workspace = Path(workspace).resolve()
        self.store = CronJobStore(self.workspace, postgres)
        self.on_job = on_job
        self.max_sleep_ms = max_sleep_ms
        self._claim_worker_id = f"cron:{uuid.uuid4().hex}"
        self._claim_lease_ms = max(300_000, self.max_sleep_ms * 3)
        self._timer_task: asyncio.Task | None = None
        self._running = False

    def close(self) -> None:
        """Release the underlying store resources."""
        self.store.close()

    def _recompute_next_runs(self) -> None:
        now = _now_ms()
        for job in self.store.list_jobs(include_disabled=True):
            next_run_at_ms = _compute_next_run(job.schedule, now) if job.enabled else None
            updated = replace(
                job,
                state=CronJobState(
                    next_run_at_ms=next_run_at_ms,
                    last_run_at_ms=job.state.last_run_at_ms,
                    last_status=job.state.last_status,
                    last_error=job.state.last_error,
                    run_history=list(job.state.run_history),
                ),
                updated_at_ms=now,
            )
            self.store.put_job(updated)

    def _get_next_wake_ms(self) -> int | None:
        return self.store.get_next_wake_ms(now_ms=_now_ms())

    def _arm_timer(self) -> None:
        if self._timer_task:
            self._timer_task.cancel()

        if not self._running:
            return

        next_wake = self._get_next_wake_ms()
        if next_wake is None:
            delay_ms = self.max_sleep_ms
        else:
            delay_ms = min(self.max_sleep_ms, max(0, next_wake - _now_ms()))
        delay_s = delay_ms / 1000

        async def tick() -> None:
            await asyncio.sleep(delay_s)
            if self._running:
                await self._on_timer()

        self._timer_task = asyncio.create_task(tick())

    async def start(self) -> None:
        """Start the cron service."""
        self._running = True
        self._recompute_next_runs()
        self._arm_timer()
        logger.info("Cron service started with {} jobs", len(self.store.list_jobs(include_disabled=True)))

    def stop(self) -> None:
        """Stop the cron service."""
        self._running = False
        if self._timer_task:
            self._timer_task.cancel()
            self._timer_task = None

    async def _on_timer(self) -> None:
        claimed = self.store.claim_due_jobs(
            worker_id=self._claim_worker_id,
            now_ms=_now_ms(),
            claimed_until_ms=_now_ms() + self._claim_lease_ms,
        )
        try:
            for job in claimed:
                await self._execute_claimed_job(job.id)
        finally:
            self._arm_timer()

    async def _execute_claimed_job(self, job_id: str) -> None:
        latest = self.store.get_job(job_id)
        if latest is None:
            return
        if not latest.enabled or latest.state.next_run_at_ms is None or latest.state.next_run_at_ms > _now_ms():
            self.store.release_claim(job_id, worker_id=self._claim_worker_id)
            return

        start_ms = _now_ms()
        logger.info("Cron: executing job '{}' ({})", latest.name, latest.id)
        status = "ok"
        error = None
        try:
            if self.on_job:
                await self.on_job(latest)
            logger.info("Cron: job '{}' completed", latest.name)
        except Exception as exc:
            status = "error"
            error = str(exc)
            logger.error("Cron: job '{}' failed: {}", latest.name, exc)

        end_ms = _now_ms()
        refreshed = self.store.get_job(job_id)
        if refreshed is None:
            return

        delete_after_run = refreshed.schedule.kind == "at" and refreshed.delete_after_run
        disable_after_run = refreshed.schedule.kind == "at" and not refreshed.delete_after_run
        next_run_at_ms = None
        if not delete_after_run and not disable_after_run and refreshed.enabled:
            next_run_at_ms = _compute_next_run(refreshed.schedule, end_ms)

        self.store.record_execution(
            job_id,
            worker_id=self._claim_worker_id,
            run_at_ms=start_ms,
            duration_ms=end_ms - start_ms,
            status=status,
            error=error,
            next_run_at_ms=next_run_at_ms,
            disable_after_run=disable_after_run,
            delete_after_run=delete_after_run,
        )

    def get_job(self, job_id: str) -> CronJob | None:
        """Return a job by ID."""
        return self.store.get_job(job_id)

    def list_jobs(self, include_disabled: bool = False) -> list[CronJob]:
        """List all jobs."""
        return self.store.list_jobs(include_disabled=include_disabled)

    def add_job(
        self,
        name: str,
        schedule: CronSchedule,
        message: str,
        payload_kind: str = "agent_turn",
        deliver: bool = False,
        channel: str | None = None,
        to: str | None = None,
        delete_after_run: bool = False,
        source: str = "",
        job_id: str | None = None,
    ) -> CronJob:
        """Add a new job."""
        _validate_schedule_for_add(schedule)
        now = _now_ms()
        identifier = job_id or str(uuid.uuid4())[:8]
        if self.store.get_job(identifier) is not None:
            raise ValueError(f"job id '{identifier}' already exists")

        job = CronJob(
            id=identifier,
            name=name,
            enabled=True,
            source=source,
            schedule=schedule,
            payload=CronPayload(
                kind=payload_kind,
                message=message,
                deliver=deliver,
                channel=channel,
                to=to,
            ),
            state=CronJobState(next_run_at_ms=_compute_next_run(schedule, now)),
            created_at_ms=now,
            updated_at_ms=now,
            delete_after_run=delete_after_run,
        )
        stored = self.store.put_job(job)
        logger.info("Cron: added job '{}' ({})", name, stored.id)
        if self._running:
            self._arm_timer()
        return stored

    def register_system_job(self, job: CronJob) -> CronJob:
        """Register an internal system job (idempotent on restart)."""
        now = _now_ms()
        updated = replace(
            job,
            state=CronJobState(next_run_at_ms=_compute_next_run(job.schedule, now)),
            created_at_ms=now,
            updated_at_ms=now,
        )
        stored = self.store.put_job(updated)
        logger.info("Cron: registered system job '{}' ({})", stored.name, stored.id)
        if self._running:
            self._arm_timer()
        return stored

    def remove_job(self, job_id: str) -> str:
        """Remove a job by ID, unless it is a protected system job."""
        job = self.store.get_job(job_id)
        if job is None:
            return "not_found"
        if job.payload.kind == "system_event":
            logger.info("Cron: refused to remove protected system job {}", job_id)
            return "protected"
        removed = self.store.delete_job(job_id)
        if removed:
            logger.info("Cron: removed job {}", job_id)
            if self._running:
                self._arm_timer()
            return "removed"
        return "not_found"

    def enable_job(self, job_id: str, enabled: bool = True) -> CronJob | None:
        """Enable or disable a job."""
        job = self.store.get_job(job_id)
        if job is None:
            return None
        now = _now_ms()
        updated = replace(
            job,
            enabled=enabled,
            state=CronJobState(
                next_run_at_ms=_compute_next_run(job.schedule, now) if enabled else None,
                last_run_at_ms=job.state.last_run_at_ms,
                last_status=job.state.last_status,
                last_error=job.state.last_error,
                run_history=list(job.state.run_history),
            ),
            updated_at_ms=now,
        )
        stored = self.store.put_job(updated)
        if self._running:
            self._arm_timer()
        return stored

    def update_job(
        self,
        job_id: str,
        *,
        name: str | None = None,
        enabled: bool | None = None,
        source: str | None = None,
        schedule: CronSchedule | None = None,
        payload: CronPayload | None = None,
        message: str | None = None,
        deliver: bool | None = None,
        channel: str | None = ...,
        to: str | None = ...,
        delete_after_run: bool | None = None,
    ) -> CronJob | str:
        """Update mutable fields of an existing job. System jobs cannot be updated."""
        job = self.store.get_job(job_id)
        if job is None:
            return "not_found"
        if job.payload.kind == "system_event":
            return "protected"

        if name is not None:
            cleaned = name.strip()
            if not cleaned:
                raise ValueError("name cannot be empty")
            job.name = cleaned

        if source is not None:
            job.source = source

        if schedule is not None:
            _validate_schedule_for_add(schedule)
            job.schedule = schedule

        if payload is not None:
            job.payload = payload
        else:
            if message is not None:
                job.payload.message = message
            if deliver is not None:
                job.payload.deliver = deliver
            if channel is not ...:
                job.payload.channel = channel
            if to is not ...:
                job.payload.to = to

        if delete_after_run is not None:
            job.delete_after_run = delete_after_run

        if enabled is not None:
            job.enabled = enabled

        now = _now_ms()
        job.updated_at_ms = now
        job.state.next_run_at_ms = _compute_next_run(job.schedule, now) if job.enabled else None
        stored = self.store.put_job(job)
        logger.info("Cron: updated job '{}' ({})", stored.name, stored.id)
        if self._running:
            self._arm_timer()
        return stored

    async def run_job(self, job_id: str, force: bool = False) -> bool:
        """Manually run a job without disturbing the service's running state."""
        was_running = self._running
        try:
            job = self.store.get_job(job_id)
            if job is None:
                return False
            if not force and not job.enabled:
                return False

            start_ms = _now_ms()
            status = "ok"
            error = None
            try:
                if self.on_job:
                    await self.on_job(job)
            except Exception as exc:
                status = "error"
                error = str(exc)
            end_ms = _now_ms()

            refreshed = self.store.get_job(job_id)
            if refreshed is None:
                return True
            delete_after_run = refreshed.schedule.kind == "at" and refreshed.delete_after_run
            disable_after_run = refreshed.schedule.kind == "at" and not refreshed.delete_after_run
            next_run_at_ms = None
            if not delete_after_run and not disable_after_run and refreshed.enabled:
                next_run_at_ms = _compute_next_run(refreshed.schedule, end_ms)
            self.store.record_execution(
                job_id,
                worker_id=None,
                run_at_ms=start_ms,
                duration_ms=end_ms - start_ms,
                status=status,
                error=error,
                next_run_at_ms=next_run_at_ms,
                disable_after_run=disable_after_run,
                delete_after_run=delete_after_run,
            )
            return True
        finally:
            self._running = was_running
            if was_running:
                self._arm_timer()

    def status(self) -> dict[str, Any]:
        """Get service status."""
        jobs = self.store.list_jobs(include_disabled=True)
        return {
            "enabled": self._running,
            "jobs": len(jobs),
            "next_wake_at_ms": self._get_next_wake_ms(),
        }
