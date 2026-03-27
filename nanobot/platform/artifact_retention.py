"""Shared helpers for artifact retention policy normalization."""

from __future__ import annotations

from typing import Any


def normalize_artifact_retention_policy(
    payload: dict[str, Any] | None,
    *,
    error_cls: type[Exception] = ValueError,
    default_action_by: str,
) -> dict[str, Any]:
    raw = payload if isinstance(payload, dict) else {}

    def _raise(message: str) -> None:
        raise error_cls(message)

    def _days(key: str) -> int | None:
        value = raw.get(key)
        if value is None or value == "":
            return None
        try:
            normalized = int(value)
        except (TypeError, ValueError) as exc:
            raise error_cls(f"{key} must be an integer number of days.") from exc
        if normalized < 0:
            _raise(f"{key} cannot be negative.")
        return normalized

    archive_after_days = _days("archiveAfterDays")
    delete_after_days = _days("deleteAfterDays")
    if archive_after_days is not None and delete_after_days is not None and delete_after_days < archive_after_days:
        _raise("deleteAfterDays must be greater than or equal to archiveAfterDays.")

    enabled = bool(raw.get("enabled"))
    if archive_after_days is not None or delete_after_days is not None:
        enabled = True

    return {
        "enabled": enabled,
        "archiveAfterDays": archive_after_days,
        "deleteAfterDays": delete_after_days,
        "reason": str(raw.get("reason") or "").strip() or None,
        "actionBy": str(raw.get("actionBy") or default_action_by).strip() or default_action_by,
        "updatedAt": str(raw.get("updatedAt") or "").strip() or None,
    }
