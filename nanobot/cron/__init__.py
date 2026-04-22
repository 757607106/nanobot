"""Cron service for scheduled agent tasks."""

__all__ = ["CronService", "CronJob", "CronSchedule"]


def __getattr__(name: str):
    if name == "CronService":
        from nanobot.cron.service import CronService

        return CronService
    if name in {"CronJob", "CronSchedule"}:
        from nanobot.cron.types import CronJob, CronSchedule

        return {"CronJob": CronJob, "CronSchedule": CronSchedule}[name]
    raise AttributeError(name)
