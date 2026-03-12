import asyncio

import pytest

from nanobot.cron.service import CronService
from nanobot.cron.types import CronPayload, CronSchedule


def test_add_job_rejects_unknown_timezone(tmp_path) -> None:
    service = CronService(tmp_path / "cron" / "jobs.json")

    with pytest.raises(ValueError, match="unknown timezone 'America/Vancovuer'"):
        service.add_job(
            name="tz typo",
            schedule=CronSchedule(kind="cron", expr="0 9 * * *", tz="America/Vancovuer"),
            message="hello",
        )

    assert service.list_jobs(include_disabled=True) == []


def test_add_job_accepts_valid_timezone(tmp_path) -> None:
    service = CronService(tmp_path / "cron" / "jobs.json")

    job = service.add_job(
        name="tz ok",
        schedule=CronSchedule(kind="cron", expr="0 9 * * *", tz="America/Vancouver"),
        message="hello",
    )

    assert job.schedule.tz == "America/Vancouver"
    assert job.state.next_run_at_ms is not None


@pytest.mark.asyncio
async def test_running_service_honors_external_disable(tmp_path) -> None:
    store_path = tmp_path / "cron" / "jobs.json"
    called: list[str] = []

    async def on_job(job) -> None:
        called.append(job.id)

    service = CronService(store_path, on_job=on_job)
    job = service.add_job(
        name="external-disable",
        schedule=CronSchedule(kind="every", every_ms=200),
        message="hello",
    )
    await service.start()
    try:
        # Wait slightly to ensure file mtime is definitively different
        await asyncio.sleep(0.05)
        external = CronService(store_path)
        updated = external.enable_job(job.id, enabled=False)
        assert updated is not None
        assert updated.enabled is False

        await asyncio.sleep(0.35)
        assert called == []
    finally:
        service.stop()


def test_update_job_recomputes_state_and_persists_changes(tmp_path) -> None:
    service = CronService(tmp_path / "cron" / "jobs.json")
    job = service.add_job(
        name="heartbeat",
        schedule=CronSchedule(kind="every", every_ms=1_000),
        message="old instruction",
    )

    updated = service.update_job(
        job.id,
        name="daily recap",
        enabled=False,
        schedule=CronSchedule(kind="cron", expr="0 9 * * *", tz="Asia/Shanghai"),
        payload=CronPayload(
            kind="agent_turn",
            message="summarize the latest workspace changes",
            deliver=True,
            channel="web",
            to="session-123",
        ),
        delete_after_run=True,
    )

    assert updated is not None
    assert updated.name == "daily recap"
    assert updated.enabled is False
    assert updated.schedule.kind == "cron"
    assert updated.schedule.tz == "Asia/Shanghai"
    assert updated.payload.message == "summarize the latest workspace changes"
    assert updated.payload.channel == "web"
    assert updated.payload.to == "session-123"
    assert updated.delete_after_run is True
    assert updated.state.next_run_at_ms is None

    reloaded = service.get_job(job.id)
    assert reloaded is not None
    assert reloaded.name == "daily recap"
    assert reloaded.enabled is False


def test_add_job_supports_custom_id_payload_kind_and_source(tmp_path) -> None:
    service = CronService(tmp_path / "cron" / "jobs.json")

    job = service.add_job(
        name="calendar reminder",
        schedule=CronSchedule(kind="at", at_ms=9_999_999_999_999),
        message='Reminder: "Design review" starts in 15 minutes.',
        payload_kind="calendar_reminder",
        channel="web",
        to="calendar-reminders",
        delete_after_run=True,
        source="calendar",
        job_id="cal:event-1:15",
    )

    assert job.id == "cal:event-1:15"
    assert job.payload.kind == "calendar_reminder"
    assert job.source == "calendar"

    reloaded = service.get_job("cal:event-1:15")
    assert reloaded is not None
    assert reloaded.payload.kind == "calendar_reminder"
    assert reloaded.source == "calendar"
