"""Cross-cutting services not owned by a single platform domain."""

from .calendar_reminder import CalendarReminderService

__all__ = ["CalendarReminderService"]
