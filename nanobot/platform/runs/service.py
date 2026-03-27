"""High-level run registry service."""

from __future__ import annotations

import shutil
import uuid
from collections import deque
from datetime import UTC, datetime, timedelta
from pathlib import Path
import re
from typing import Any, Callable

from nanobot.platform.artifact_retention import normalize_artifact_retention_policy
from nanobot.platform.tenant_scope import clone_service_with_overrides
from nanobot.platform.runs.models import (
    RunControlScope,
    RunEvent,
    RunKind,
    RunLimits,
    RunRecord,
    RunResultSummary,
    RunStatus,
    now_iso,
)
from nanobot.platform.runs.store import RunStore


class RunNotFoundError(KeyError):
    """Raised when the requested run does not exist."""


class RunLimitExceededError(RuntimeError):
    """Raised when a new subagent would exceed configured limits."""


class RunStateError(RuntimeError):
    """Raised when the requested run transition is invalid."""


class RunArtifactNotFoundError(FileNotFoundError):
    """Raised when the requested run artifact does not exist."""


class RunArtifactLifecycleError(RuntimeError):
    """Raised when the requested artifact lifecycle transition is invalid."""


class RunService:
    """Run registry facade used by the Web layer and subagent manager."""

    _ACTIVE_STATUSES = (
        RunStatus.QUEUED.value,
        RunStatus.RUNNING.value,
        RunStatus.CANCEL_REQUESTED.value,
    )
    _TERMINAL_STATUSES = {
        RunStatus.SUCCEEDED,
        RunStatus.FAILED,
        RunStatus.CANCELLED,
        RunStatus.TIMED_OUT,
    }

    def __init__(
        self,
        store: RunStore,
        *,
        instance_id: str,
        tenant_id: str = "default",
        limits: RunLimits | None = None,
        artifact_dir: Path | None = None,
        tenant_settings_loader: Callable[[str], dict[str, Any] | None] | None = None,
        agent_definition_loader: Callable[[str, str | None], dict[str, Any] | None] | None = None,
        team_definition_loader: Callable[[str, str | None], dict[str, Any] | None] | None = None,
    ):
        self.store = store
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.limits = limits or RunLimits()
        self.artifact_dir = artifact_dir
        self.tenant_settings_loader = tenant_settings_loader
        self.agent_definition_loader = agent_definition_loader
        self.team_definition_loader = team_definition_loader
        self._scope_enforced = False
        if self.artifact_dir is not None:
            self.artifact_dir.mkdir(parents=True, exist_ok=True)

    def bind_tenant_settings_loader(
        self,
        loader: Callable[[str], dict[str, Any] | None] | None,
    ) -> None:
        self.tenant_settings_loader = loader

    def bind_definition_policy_loaders(
        self,
        *,
        agent_loader: Callable[[str, str | None], dict[str, Any] | None] | None = None,
        team_loader: Callable[[str, str | None], dict[str, Any] | None] | None = None,
    ) -> None:
        self.agent_definition_loader = agent_loader
        self.team_definition_loader = team_loader

    def with_tenant(self, tenant_id: str | None) -> RunService:
        """Return a tenant-scoped facade over the shared run registry."""
        normalized = str(tenant_id or "default").strip() or "default"
        if normalized == self.tenant_id and self._scope_enforced:
            return self
        return clone_service_with_overrides(
            self,
            tenant_id=normalized,
            _scope_enforced=True,
        )

    @staticmethod
    def _new_run_id() -> str:
        return f"run_{uuid.uuid4().hex[:12]}"

    @staticmethod
    def _sanitize_artifact_segment(value: str | None) -> str:
        normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip("-.")
        return normalized[:96] or "default"

    def _artifact_scope_root(
        self,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> Path:
        if self.artifact_dir is None:
            raise RunArtifactNotFoundError("Artifact storage is not configured.")
        return (
            self.artifact_dir
            / "tenants"
            / self._sanitize_artifact_segment(tenant_id or self.tenant_id)
            / self._sanitize_artifact_segment(instance_id or self.instance_id)
        )

    def create_run(
        self,
        *,
        kind: RunKind,
        label: str,
        task_preview: str,
        tenant_id: str | None = None,
        instance_id: str | None = None,
        agent_id: str | None = None,
        team_id: str | None = None,
        thread_id: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        session_key: str | None = None,
        origin_channel: str | None = None,
        origin_chat_id: str | None = None,
        spawn_depth: int = 0,
        control_scope: RunControlScope = RunControlScope.TOP_LEVEL,
        workspace_path: str | None = None,
        memory_scope: str | None = None,
        knowledge_scope: str | None = None,
        run_id: str | None = None,
    ) -> RunRecord:
        run_id = run_id or self._new_run_id()
        record = RunRecord(
            run_id=run_id,
            tenant_id=str(tenant_id or self.tenant_id).strip() or self.tenant_id,
            instance_id=str(instance_id or self.instance_id).strip() or self.instance_id,
            kind=kind,
            status=RunStatus.QUEUED,
            label=label,
            task_preview=task_preview,
            agent_id=agent_id,
            team_id=team_id,
            thread_id=thread_id,
            parent_run_id=parent_run_id,
            root_run_id=root_run_id or run_id,
            session_key=session_key,
            origin_channel=origin_channel,
            origin_chat_id=origin_chat_id,
            spawn_depth=spawn_depth,
            control_scope=control_scope,
            workspace_path=workspace_path,
            memory_scope=memory_scope,
            knowledge_scope=knowledge_scope,
        )
        self.store.insert_run(record)
        self.append_event(run_id, "queued", {"label": label, "taskPreview": task_preview})
        return self.require_run(run_id)

    def _is_visible_in_scope(self, record: RunRecord) -> bool:
        if not self._scope_enforced:
            return True
        return (
            str(record.tenant_id or "default").strip() == str(self.tenant_id or "default").strip()
            and str(record.instance_id or self.instance_id).strip() == str(self.instance_id).strip()
        )

    def require_run(self, run_id: str) -> RunRecord:
        record = self.store.get_run(run_id)
        if record is None or not self._is_visible_in_scope(record):
            raise RunNotFoundError(run_id)
        return record

    def _ensure_transition(self, record: RunRecord, *, allowed_from: set[RunStatus]) -> None:
        if record.status not in allowed_from:
            raise RunStateError(f"Run {record.run_id} cannot transition from {record.status.value}.")

    def start_run(self, run_id: str) -> RunRecord:
        record = self.require_run(run_id)
        self._ensure_transition(record, allowed_from={RunStatus.QUEUED})
        updated = self.store.update_run(run_id, status=RunStatus.RUNNING, started_at=now_iso())
        assert updated is not None
        self.append_event(run_id, "started")
        return updated

    def complete_run(
        self,
        run_id: str,
        summary: RunResultSummary,
        *,
        artifact_path: str | None = None,
    ) -> RunRecord:
        record = self.require_run(run_id)
        self._ensure_transition(record, allowed_from={RunStatus.RUNNING})
        updated = self.store.update_run(
            run_id,
            status=RunStatus.SUCCEEDED,
            result_summary=summary,
            artifact_path=artifact_path,
            finished_at=now_iso(),
        )
        assert updated is not None
        self.append_event(run_id, "completed", {"artifactPath": artifact_path})
        return updated

    def fail_run(self, run_id: str, error_code: str, error_message: str) -> RunRecord:
        record = self.require_run(run_id)
        self._ensure_transition(record, allowed_from={RunStatus.RUNNING, RunStatus.QUEUED})
        updated = self.store.update_run(
            run_id,
            status=RunStatus.FAILED,
            last_error_code=error_code,
            last_error_message=error_message,
            finished_at=now_iso(),
        )
        assert updated is not None
        self.append_event(run_id, "failed", {"code": error_code, "message": error_message})
        return updated

    def timeout_run(self, run_id: str, message: str | None = None) -> RunRecord:
        record = self.require_run(run_id)
        self._ensure_transition(record, allowed_from={RunStatus.RUNNING, RunStatus.QUEUED, RunStatus.CANCEL_REQUESTED})
        text = str(message or "").strip() or "Run timed out."
        updated = self.store.update_run(
            run_id,
            status=RunStatus.TIMED_OUT,
            last_error_code="TIMEOUT",
            last_error_message=text,
            finished_at=now_iso(),
        )
        assert updated is not None
        self.append_event(run_id, "timed_out", {"message": text})
        return updated

    def request_cancel(self, run_id: str) -> RunRecord:
        record = self.require_run(run_id)
        if record.status in self._TERMINAL_STATUSES:
            return record
        updated = self.store.update_run(run_id, status=RunStatus.CANCEL_REQUESTED)
        assert updated is not None
        self.append_event(run_id, "cancel_requested")
        return updated

    def cancel_run(self, run_id: str) -> RunRecord:
        record = self.require_run(run_id)
        if record.status == RunStatus.CANCELLED:
            return record
        if record.status in self._TERMINAL_STATUSES and record.status != RunStatus.CANCELLED:
            raise RunStateError(f"Run {run_id} already finished with {record.status.value}.")
        updated = self.store.update_run(
            run_id,
            status=RunStatus.CANCELLED,
            finished_at=now_iso(),
        )
        assert updated is not None
        self.append_event(run_id, "cancelled")
        return updated

    def append_event(self, run_id: str, event_type: str, payload: dict[str, Any] | None = None) -> RunEvent:
        self.require_run(run_id)
        return self.store.insert_event(RunEvent(run_id=run_id, event_type=event_type, payload=payload))

    def write_markdown_artifact(
        self,
        run_id: str,
        *,
        title: str,
        metadata: dict[str, Any] | None = None,
        sections: list[tuple[str, str]] | None = None,
    ) -> str | None:
        if self.artifact_dir is None:
            return None
        record = self.require_run(run_id)
        lines = [f"# {title}", ""]
        if metadata:
            lines.append("## Metadata")
            lines.append("")
            for key, value in metadata.items():
                if value is None or value == "":
                    continue
                text = ", ".join(str(item) for item in value) if isinstance(value, list) else str(value)
                lines.append(f"- **{key}**: {text}")
            lines.append("")
        for heading, content in sections or []:
            text = str(content or "").strip()
            if not text:
                continue
            lines.append(f"## {heading}")
            lines.append("")
            lines.append(text)
            lines.append("")
        artifact_file = self._artifact_scope_root(
            tenant_id=record.tenant_id,
            instance_id=record.instance_id,
        ) / f"{run_id}.md"
        artifact_file.parent.mkdir(parents=True, exist_ok=True)
        artifact_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        self.append_event(
            run_id,
            "artifact_written",
            self._artifact_audit_payload(
                record,
                resolved_path=artifact_file,
                storage_scope="tenant_instance_scoped",
                exists=True,
            ),
        )
        return artifact_file.name

    def _resolve_artifact_path(self, artifact_path: str) -> Path:
        if self.artifact_dir is None:
            raise RunArtifactNotFoundError("Artifact storage is not configured.")
        base = self.artifact_dir.resolve()
        resolved = (self.artifact_dir / artifact_path).resolve()
        if resolved != base and base not in resolved.parents:
            raise RunArtifactNotFoundError("Artifact path is outside the configured storage.")
        return resolved

    def _artifact_candidates(self, record: RunRecord) -> list[Path]:
        artifact_path = str(record.artifact_path or "").strip()
        if not artifact_path:
            return []
        if "/" in artifact_path or "\\" in artifact_path:
            return [self._resolve_artifact_path(artifact_path)]
        scoped = self._artifact_scope_root(
            tenant_id=record.tenant_id,
            instance_id=record.instance_id,
        ) / artifact_path
        legacy = self._resolve_artifact_path(artifact_path)
        return [scoped, legacy]

    def _resolve_record_artifact_path(self, record: RunRecord) -> Path:
        candidates = self._artifact_candidates(record)
        if not candidates:
            raise RunArtifactNotFoundError(f"Run {record.run_id} has no artifact.")
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return candidates[0]

    def _artifact_storage_scope(self, record: RunRecord, resolved_path: Path) -> str:
        scoped = self._artifact_scope_root(
            tenant_id=record.tenant_id,
            instance_id=record.instance_id,
        )
        try:
            resolved = resolved_path.resolve()
            scoped_root = scoped.resolve()
        except Exception:
            resolved = resolved_path
            scoped_root = scoped
        if resolved == scoped_root or scoped_root in resolved.parents:
            return "tenant_instance_scoped"
        return "legacy_root"

    def _artifact_storage_key(self, resolved_path: Path) -> str | None:
        if self.artifact_dir is None:
            return None
        try:
            return resolved_path.resolve().relative_to(self.artifact_dir.resolve()).as_posix()
        except Exception:
            return resolved_path.name

    def _artifact_path_from_storage_key(self, storage_key: str | None) -> Path:
        if self.artifact_dir is None:
            raise RunArtifactNotFoundError("Artifact storage is not configured.")
        key = str(storage_key or "").strip()
        if not key:
            raise RunArtifactNotFoundError("Artifact storage key is missing.")
        return (self.artifact_dir / key).resolve()

    def _artifact_governance_storage_key(self, state: str, storage_key: str | None) -> str:
        key = str(storage_key or "").strip()
        if not key:
            raise RunArtifactNotFoundError("Artifact storage key is missing.")
        return f"governance/{state}/{key}"

    @staticmethod
    def _parse_iso_datetime(value: str | None) -> datetime | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)
        except ValueError:
            return None

    @staticmethod
    def _format_iso_datetime(value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _normalize_retention_days(value: Any, field_name: str) -> int | None:
        if value is None or value == "":
            return None
        try:
            normalized = int(value)
        except (TypeError, ValueError) as exc:
            raise RunArtifactLifecycleError(f"{field_name} must be an integer number of days.") from exc
        if normalized < 0:
            raise RunArtifactLifecycleError(f"{field_name} cannot be negative.")
        return normalized

    @staticmethod
    def _artifact_retention_reason(reason: str | None) -> str:
        text = str(reason or "").strip()
        return text or "artifact retention policy"

    @staticmethod
    def _artifact_retention_basis_timestamp(record: RunRecord) -> str:
        return str(record.finished_at or record.created_at)

    def _tenant_artifact_retention_policy(self, tenant_id: str | None) -> dict[str, Any]:
        loader = self.tenant_settings_loader
        normalized_tenant_id = str(tenant_id or self.tenant_id or "default").strip() or "default"
        if loader is None:
            return {
                "enabled": False,
                "archiveAfterDays": None,
                "deleteAfterDays": None,
                "reason": None,
                "actionBy": None,
                "updatedAt": None,
                "source": "none",
                "tenantId": normalized_tenant_id,
            }
        try:
            tenant_payload = loader(normalized_tenant_id) or {}
        except Exception:
            return {
                "enabled": False,
                "archiveAfterDays": None,
                "deleteAfterDays": None,
                "reason": None,
                "actionBy": None,
                "updatedAt": None,
                "source": "none",
                "tenantId": normalized_tenant_id,
            }
        settings = tenant_payload.get("settings") if isinstance(tenant_payload, dict) else {}
        if not isinstance(settings, dict):
            settings = {}
        raw_policy = settings.get("artifactRetention") or settings.get("artifact_retention") or {}
        if not isinstance(raw_policy, dict):
            raw_policy = {}
        archive_after_days = self._normalize_retention_days(
            raw_policy.get("archiveAfterDays", raw_policy.get("archive_after_days")),
            "archiveAfterDays",
        )
        delete_after_days = self._normalize_retention_days(
            raw_policy.get("deleteAfterDays", raw_policy.get("delete_after_days")),
            "deleteAfterDays",
        )
        enabled = bool(raw_policy.get("enabled"))
        if archive_after_days is not None or delete_after_days is not None:
            enabled = True
        return {
            "enabled": enabled,
            "archiveAfterDays": archive_after_days,
            "deleteAfterDays": delete_after_days,
            "reason": raw_policy.get("reason"),
            "actionBy": raw_policy.get("actionBy", raw_policy.get("action_by")),
            "updatedAt": raw_policy.get("updatedAt", raw_policy.get("updated_at")) or tenant_payload.get("updatedAt"),
            "source": "tenant_default" if enabled else "none",
            "tenantId": normalized_tenant_id,
        }

    def _definition_artifact_retention_policy(self, record: RunRecord) -> dict[str, Any]:
        candidate_source = "none"
        candidate_loader: Callable[[str, str | None], dict[str, Any] | None] | None = None
        candidate_id: str | None = None
        if record.team_id and self.team_definition_loader is not None:
            candidate_source = "team_template"
            candidate_loader = self.team_definition_loader
            candidate_id = record.team_id
        elif record.agent_id and self.agent_definition_loader is not None:
            candidate_source = "agent_template"
            candidate_loader = self.agent_definition_loader
            candidate_id = record.agent_id
        if candidate_loader is None or not candidate_id:
            return {
                "enabled": False,
                "archiveAfterDays": None,
                "deleteAfterDays": None,
                "reason": None,
                "actionBy": None,
                "updatedAt": None,
                "source": "none",
                "templateId": None,
            }
        try:
            definition_payload = candidate_loader(candidate_id, record.tenant_id) or {}
        except Exception:
            return {
                "enabled": False,
                "archiveAfterDays": None,
                "deleteAfterDays": None,
                "reason": None,
                "actionBy": None,
                "updatedAt": None,
                "source": "none",
                "templateId": None,
            }
        raw_policy = definition_payload.get("artifactRetentionPolicy") or definition_payload.get("artifact_retention_policy") or {}
        policy = normalize_artifact_retention_policy(
            raw_policy,
            default_action_by="team_template" if candidate_source == "team_template" else "agent_template",
        )
        policy["source"] = candidate_source if policy.get("enabled") else "none"
        policy["templateId"] = candidate_id if policy.get("enabled") else None
        return policy

    def _artifact_audit_payload(
        self,
        record: RunRecord,
        *,
        resolved_path: Path | None = None,
        storage_scope: str | None = None,
        exists: bool | None = None,
    ) -> dict[str, Any]:
        path = resolved_path or self._resolve_record_artifact_path(record)
        scope = storage_scope or self._artifact_storage_scope(record, path)
        exists_flag = path.exists() if exists is None else bool(exists)
        return {
            "runId": record.run_id,
            "tenantId": record.tenant_id,
            "instanceId": record.instance_id,
            "artifactPath": record.artifact_path,
            "fileName": path.name,
            "storageScope": scope,
            "storageKey": self._artifact_storage_key(path),
            "isLegacyFallback": scope == "legacy_root",
            "exists": exists_flag,
        }

    def _artifact_governance_snapshot(
        self,
        record: RunRecord,
        *,
        events: list[RunEvent] | None = None,
    ) -> dict[str, Any]:
        snapshot: dict[str, Any]
        try:
            base_audit = self._artifact_audit_payload(record)
            snapshot = {
                **base_audit,
                "lifecycleStatus": "active",
                "currentStorageScope": base_audit.get("storageScope"),
                "currentStorageKey": base_audit.get("storageKey"),
                "originalStorageScope": base_audit.get("storageScope"),
                "originalStorageKey": base_audit.get("storageKey"),
                "governanceReason": None,
                "governanceActionBy": None,
                "governanceUpdatedAt": None,
                "canRestore": False,
            }
        except RunArtifactNotFoundError:
            snapshot = {
                "runId": record.run_id,
                "tenantId": record.tenant_id,
                "instanceId": record.instance_id,
                "artifactPath": record.artifact_path,
                "fileName": None,
                "storageScope": None,
                "storageKey": None,
                "isLegacyFallback": False,
                "exists": False,
                "lifecycleStatus": "missing",
                "currentStorageScope": None,
                "currentStorageKey": None,
                "originalStorageScope": None,
                "originalStorageKey": None,
                "governanceReason": None,
                "governanceActionBy": None,
                "governanceUpdatedAt": None,
                "canRestore": False,
            }

        relevant_events = events if events is not None else self.store.list_events(record.run_id)
        for event in relevant_events:
            payload = dict(event.payload or {})
            if event.event_type == "artifact_written":
                snapshot.update(
                    {
                        "fileName": payload.get("fileName") or snapshot.get("fileName"),
                        "storageScope": payload.get("storageScope") or snapshot.get("storageScope"),
                        "storageKey": payload.get("storageKey") or snapshot.get("storageKey"),
                        "isLegacyFallback": bool(payload.get("isLegacyFallback")),
                        "exists": bool(payload.get("exists", snapshot.get("exists"))),
                        "lifecycleStatus": "active",
                        "currentStorageScope": payload.get("storageScope") or snapshot.get("currentStorageScope"),
                        "currentStorageKey": payload.get("storageKey") or snapshot.get("currentStorageKey"),
                        "originalStorageScope": payload.get("storageScope") or snapshot.get("originalStorageScope"),
                        "originalStorageKey": payload.get("storageKey") or snapshot.get("originalStorageKey"),
                        "governanceReason": None,
                        "governanceActionBy": None,
                        "governanceUpdatedAt": event.created_at,
                        "canRestore": False,
                    }
                )
            elif event.event_type in {"artifact_quarantined", "artifact_archived", "artifact_deleted", "artifact_restored"}:
                lifecycle_status = payload.get("lifecycleStatus")
                current_key = payload.get("currentStorageKey") or snapshot.get("currentStorageKey")
                current_scope = payload.get("currentStorageScope") or snapshot.get("currentStorageScope")
                current_exists = snapshot.get("exists")
                if current_key:
                    try:
                        current_exists = self._artifact_path_from_storage_key(str(current_key)).exists()
                    except Exception:
                        current_exists = False
                snapshot.update(
                    {
                        "storageScope": current_scope,
                        "storageKey": current_key,
                        "isLegacyFallback": str(current_scope or "") == "legacy_root",
                        "lifecycleStatus": lifecycle_status or snapshot.get("lifecycleStatus"),
                        "currentStorageScope": current_scope,
                        "currentStorageKey": current_key,
                        "originalStorageScope": payload.get("originalStorageScope") or snapshot.get("originalStorageScope"),
                        "originalStorageKey": payload.get("originalStorageKey") or snapshot.get("originalStorageKey"),
                        "governanceReason": payload.get("reason"),
                        "governanceActionBy": payload.get("actionBy"),
                        "governanceUpdatedAt": event.created_at,
                        "exists": bool(current_exists),
                        "canRestore": str(lifecycle_status or "") in {"quarantined", "archived", "deleted"},
                    }
                )
        return snapshot

    def _artifact_retention_policy_snapshot(
        self,
        record: RunRecord,
        *,
        events: list[RunEvent] | None = None,
        artifact_snapshot: dict[str, Any] | None = None,
        now: str | None = None,
    ) -> dict[str, Any]:
        relevant_events = events if events is not None else self.store.list_events(record.run_id)
        artifact = artifact_snapshot or self._artifact_governance_snapshot(record, events=relevant_events)
        basis_timestamp = self._artifact_retention_basis_timestamp(record)
        basis_dt = self._parse_iso_datetime(basis_timestamp)
        now_dt = self._parse_iso_datetime(now) or datetime.now(UTC)
        policy: dict[str, Any] = {
            "runId": record.run_id,
            "tenantId": record.tenant_id,
            "instanceId": record.instance_id,
            "artifactPath": record.artifact_path,
            "lifecycleStatus": artifact.get("lifecycleStatus"),
            "enabled": False,
            "basisTimestamp": basis_timestamp,
            "archiveAfterDays": None,
            "deleteAfterDays": None,
            "archiveDueAt": None,
            "deleteDueAt": None,
            "archiveDue": False,
            "deleteDue": False,
            "nextAction": "none",
            "nextActionAt": None,
            "canApplyNow": False,
            "reason": None,
            "actionBy": None,
            "updatedAt": None,
            "source": "none",
        }
        template_policy = self._definition_artifact_retention_policy(record)
        if template_policy.get("enabled"):
            policy.update(
                {
                    "enabled": True,
                    "archiveAfterDays": template_policy.get("archiveAfterDays"),
                    "deleteAfterDays": template_policy.get("deleteAfterDays"),
                    "reason": template_policy.get("reason"),
                    "actionBy": template_policy.get("actionBy"),
                    "updatedAt": template_policy.get("updatedAt"),
                    "source": template_policy.get("source") or "none",
                }
            )
        else:
            tenant_policy = self._tenant_artifact_retention_policy(record.tenant_id)
            if tenant_policy.get("enabled"):
                policy.update(
                    {
                        "enabled": True,
                        "archiveAfterDays": tenant_policy.get("archiveAfterDays"),
                        "deleteAfterDays": tenant_policy.get("deleteAfterDays"),
                        "reason": tenant_policy.get("reason"),
                        "actionBy": tenant_policy.get("actionBy"),
                        "updatedAt": tenant_policy.get("updatedAt"),
                        "source": tenant_policy.get("source") or "tenant_default",
                    }
                )
        for event in relevant_events:
            if event.event_type != "artifact_retention_policy_set":
                continue
            payload = dict(event.payload or {})
            archive_after_days = self._normalize_retention_days(payload.get("archiveAfterDays"), "archiveAfterDays")
            delete_after_days = self._normalize_retention_days(payload.get("deleteAfterDays"), "deleteAfterDays")
            policy.update(
                {
                    "enabled": archive_after_days is not None or delete_after_days is not None,
                    "archiveAfterDays": archive_after_days,
                    "deleteAfterDays": delete_after_days,
                    "reason": payload.get("reason"),
                    "actionBy": payload.get("actionBy"),
                    "updatedAt": event.created_at,
                    "source": "run",
                }
            )

        if basis_dt is not None:
            if policy.get("archiveAfterDays") is not None:
                archive_due_at = basis_dt + timedelta(days=int(policy["archiveAfterDays"]))
                policy["archiveDueAt"] = self._format_iso_datetime(archive_due_at)
                policy["archiveDue"] = now_dt >= archive_due_at
            if policy.get("deleteAfterDays") is not None:
                delete_due_at = basis_dt + timedelta(days=int(policy["deleteAfterDays"]))
                policy["deleteDueAt"] = self._format_iso_datetime(delete_due_at)
                policy["deleteDue"] = now_dt >= delete_due_at

        lifecycle_status = str(artifact.get("lifecycleStatus") or "missing")
        next_action = "none"
        next_action_at: str | None = None
        if policy["enabled"] and lifecycle_status != "missing":
            if lifecycle_status != "deleted" and policy.get("deleteDue"):
                next_action = "delete"
                next_action_at = policy.get("deleteDueAt")
            elif lifecycle_status == "active" and policy.get("archiveDue"):
                next_action = "archive"
                next_action_at = policy.get("archiveDueAt")
        policy["nextAction"] = next_action
        policy["nextActionAt"] = next_action_at
        policy["canApplyNow"] = next_action in {"archive", "delete"}
        return policy

    def _resolve_artifact_read_path(
        self,
        record: RunRecord,
        *,
        snapshot: dict[str, Any] | None = None,
    ) -> Path:
        current = snapshot or self._artifact_governance_snapshot(record)
        lifecycle_status = str(current.get("lifecycleStatus") or "missing")
        storage_key = str(current.get("currentStorageKey") or "").strip()
        if lifecycle_status == "deleted":
            raise RunArtifactNotFoundError(f"Artifact for run {record.run_id} has been deleted.")
        if not storage_key:
            raise RunArtifactNotFoundError(f"Run {record.run_id} has no artifact.")
        path = self._artifact_path_from_storage_key(storage_key)
        if not path.exists():
            raise RunArtifactNotFoundError(f"Artifact for run {record.run_id} was not found.")
        return path

    def get_artifact_audit(self, run_id: str) -> dict[str, Any]:
        record = self.require_run(run_id)
        if not record.artifact_path:
            raise RunArtifactNotFoundError(f"Run {run_id} has no artifact.")
        snapshot = self._artifact_governance_snapshot(record)
        if not snapshot.get("storageKey") and not snapshot.get("currentStorageKey"):
            raise RunArtifactNotFoundError(f"Artifact for run {run_id} was not found.")
        snapshot["retentionPolicy"] = self._artifact_retention_policy_snapshot(
            record,
            artifact_snapshot=snapshot,
        )
        return snapshot

    def _move_artifact_lifecycle(
        self,
        run_id: str,
        *,
        target_status: str,
        reason: str | None = None,
        action_by: str = "control_plane",
    ) -> dict[str, Any]:
        record = self.require_run(run_id)
        if not record.artifact_path:
            raise RunArtifactNotFoundError(f"Run {run_id} has no artifact.")
        events = self.store.list_events(run_id)
        snapshot = self._artifact_governance_snapshot(record, events=events)
        current_status = str(snapshot.get("lifecycleStatus") or "missing")
        current_storage_key = str(snapshot.get("currentStorageKey") or snapshot.get("storageKey") or "").strip()
        original_storage_key = str(snapshot.get("originalStorageKey") or snapshot.get("storageKey") or current_storage_key).strip()
        original_storage_scope = str(snapshot.get("originalStorageScope") or snapshot.get("storageScope") or "").strip() or None
        current_storage_scope = str(snapshot.get("currentStorageScope") or snapshot.get("storageScope") or "").strip() or None

        if target_status == "quarantined":
            if current_status == "quarantined":
                raise RunArtifactLifecycleError(f"Artifact for run {run_id} is already quarantined.")
            if current_status == "deleted":
                raise RunArtifactLifecycleError(f"Artifact for run {run_id} has been deleted; restore it before quarantine.")
            event_type = "artifact_quarantined"
            target_storage_key = self._artifact_governance_storage_key("quarantine", current_storage_key or original_storage_key)
            target_storage_scope = "governance_quarantine"
        elif target_status == "archived":
            if current_status == "archived":
                raise RunArtifactLifecycleError(f"Artifact for run {run_id} is already archived.")
            if current_status != "active":
                raise RunArtifactLifecycleError(f"Artifact for run {run_id} can only be archived from active, not {current_status}.")
            event_type = "artifact_archived"
            target_storage_key = self._artifact_governance_storage_key("archive", current_storage_key or original_storage_key)
            target_storage_scope = "governance_archive"
        elif target_status == "deleted":
            if current_status == "deleted":
                raise RunArtifactLifecycleError(f"Artifact for run {run_id} has already been deleted.")
            event_type = "artifact_deleted"
            target_storage_key = self._artifact_governance_storage_key("deleted", original_storage_key or current_storage_key)
            target_storage_scope = "governance_deleted"
        elif target_status == "active":
            if current_status == "active":
                raise RunArtifactLifecycleError(f"Artifact for run {run_id} is already active.")
            if current_status not in {"quarantined", "archived", "deleted"}:
                raise RunArtifactLifecycleError(f"Artifact for run {run_id} cannot be restored from {current_status}.")
            event_type = "artifact_restored"
            target_storage_key = original_storage_key
            target_storage_scope = original_storage_scope or "tenant_instance_scoped"
        else:
            raise RunArtifactLifecycleError(f"Unsupported lifecycle target: {target_status}")

        source_key = current_storage_key or original_storage_key
        if not source_key:
            raise RunArtifactNotFoundError(f"Artifact for run {run_id} was not found.")
        source_path = self._artifact_path_from_storage_key(source_key)
        if not source_path.exists():
            raise RunArtifactNotFoundError(f"Artifact for run {run_id} was not found.")
        target_path = self._artifact_path_from_storage_key(target_storage_key)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source_path), str(target_path))

        payload = {
            "runId": run_id,
            "artifactPath": record.artifact_path,
            "fileName": target_path.name,
            "lifecycleStatus": target_status,
            "reason": str(reason or "").strip() or None,
            "actionBy": str(action_by or "").strip() or "control_plane",
            "sourceStorageScope": current_storage_scope,
            "sourceStorageKey": source_key,
            "targetStorageScope": target_storage_scope,
            "targetStorageKey": target_storage_key,
            "currentStorageScope": target_storage_scope,
            "currentStorageKey": target_storage_key,
            "originalStorageScope": original_storage_scope,
            "originalStorageKey": original_storage_key,
        }
        self.append_event(run_id, event_type, payload)
        return self.get_artifact_audit(run_id)

    def archive_artifact(
        self,
        run_id: str,
        *,
        reason: str | None = None,
        action_by: str = "control_plane",
    ) -> dict[str, Any]:
        return self._move_artifact_lifecycle(
            run_id,
            target_status="archived",
            reason=reason,
            action_by=action_by,
        )

    def quarantine_artifact(
        self,
        run_id: str,
        *,
        reason: str | None = None,
        action_by: str = "control_plane",
    ) -> dict[str, Any]:
        return self._move_artifact_lifecycle(
            run_id,
            target_status="quarantined",
            reason=reason,
            action_by=action_by,
        )

    def restore_artifact(
        self,
        run_id: str,
        *,
        reason: str | None = None,
        action_by: str = "control_plane",
    ) -> dict[str, Any]:
        return self._move_artifact_lifecycle(
            run_id,
            target_status="active",
            reason=reason,
            action_by=action_by,
        )

    def delete_artifact(
        self,
        run_id: str,
        *,
        reason: str | None = None,
        action_by: str = "control_plane",
    ) -> dict[str, Any]:
        return self._move_artifact_lifecycle(
            run_id,
            target_status="deleted",
            reason=reason,
            action_by=action_by,
        )

    def get_artifact_retention_policy(self, run_id: str, *, now: str | None = None) -> dict[str, Any]:
        record = self.require_run(run_id)
        if not record.artifact_path:
            raise RunArtifactNotFoundError(f"Run {run_id} has no artifact.")
        events = self.store.list_events(run_id)
        artifact_snapshot = self._artifact_governance_snapshot(record, events=events)
        return self._artifact_retention_policy_snapshot(
            record,
            events=events,
            artifact_snapshot=artifact_snapshot,
            now=now,
        )

    def set_artifact_retention_policy(
        self,
        run_id: str,
        *,
        archive_after_days: int | None = None,
        delete_after_days: int | None = None,
        reason: str | None = None,
        action_by: str = "control_plane",
    ) -> dict[str, Any]:
        record = self.require_run(run_id)
        if not record.artifact_path:
            raise RunArtifactNotFoundError(f"Run {run_id} has no artifact.")
        archive_days = self._normalize_retention_days(archive_after_days, "archiveAfterDays")
        delete_days = self._normalize_retention_days(delete_after_days, "deleteAfterDays")
        if archive_days is not None and delete_days is not None and delete_days < archive_days:
            raise RunArtifactLifecycleError("deleteAfterDays must be greater than or equal to archiveAfterDays.")
        payload = {
            "runId": run_id,
            "artifactPath": record.artifact_path,
            "archiveAfterDays": archive_days,
            "deleteAfterDays": delete_days,
            "enabled": archive_days is not None or delete_days is not None,
            "reason": str(reason or "").strip() or None,
            "actionBy": str(action_by or "").strip() or "control_plane",
            "basisTimestamp": self._artifact_retention_basis_timestamp(record),
        }
        self.append_event(run_id, "artifact_retention_policy_set", payload)
        return self.get_artifact_retention_policy(run_id)

    def apply_artifact_retention_policy(
        self,
        run_id: str,
        *,
        now: str | None = None,
        action_by: str = "retention_sweeper",
    ) -> dict[str, Any]:
        record = self.require_run(run_id)
        if not record.artifact_path:
            raise RunArtifactNotFoundError(f"Run {run_id} has no artifact.")
        events = self.store.list_events(run_id)
        artifact_snapshot = self._artifact_governance_snapshot(record, events=events)
        policy = self._artifact_retention_policy_snapshot(
            record,
            events=events,
            artifact_snapshot=artifact_snapshot,
            now=now,
        )
        action = str(policy.get("nextAction") or "none")
        if action == "archive":
            audit = self.archive_artifact(
                run_id,
                reason=self._artifact_retention_reason(policy.get("reason")),
                action_by=action_by,
            )
            return {"runId": run_id, "applied": True, "action": "archive", "artifact": audit}
        if action == "delete":
            audit = self.delete_artifact(
                run_id,
                reason=self._artifact_retention_reason(policy.get("reason")),
                action_by=action_by,
            )
            return {"runId": run_id, "applied": True, "action": "delete", "artifact": audit}
        return {
            "runId": run_id,
            "applied": False,
            "action": "none",
            "artifact": artifact_snapshot,
            "retentionPolicy": policy,
        }

    def sweep_artifact_retention(
        self,
        *,
        now: str | None = None,
        limit: int = 200,
        action_by: str = "retention_sweeper",
    ) -> dict[str, Any]:
        records = self.store.list_runs(
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            limit=limit,
        )
        items: list[dict[str, Any]] = []
        archived = 0
        deleted = 0
        applied = 0
        evaluated = 0
        for record in records:
            if not record.artifact_path or record.status not in self._TERMINAL_STATUSES:
                continue
            evaluated += 1
            result = self.apply_artifact_retention_policy(
                record.run_id,
                now=now,
                action_by=action_by,
            )
            action = str(result.get("action") or "none")
            if bool(result.get("applied")):
                applied += 1
                if action == "archive":
                    archived += 1
                elif action == "delete":
                    deleted += 1
            items.append(
                {
                    "runId": record.run_id,
                    "applied": bool(result.get("applied")),
                    "action": action,
                    "artifact": result.get("artifact"),
                    "retentionPolicy": result.get("retentionPolicy"),
                }
            )
        return {
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "evaluated": evaluated,
            "applied": applied,
            "archived": archived,
            "deleted": deleted,
            "skipped": max(evaluated - applied, 0),
            "items": items,
        }

    def get_artifact(self, run_id: str) -> dict[str, Any]:
        record = self.require_run(run_id)
        if not record.artifact_path:
            raise RunArtifactNotFoundError(f"Run {run_id} has no artifact.")
        audit = self._artifact_governance_snapshot(record)
        artifact_file = self._resolve_artifact_read_path(record, snapshot=audit)
        return {
            "runId": run_id,
            "tenantId": record.tenant_id,
            "instanceId": record.instance_id,
            "artifactPath": record.artifact_path,
            "fileName": artifact_file.name,
            "contentType": "text/markdown",
            "content": artifact_file.read_text(encoding="utf-8"),
            "audit": {
                **audit,
                "retentionPolicy": self._artifact_retention_policy_snapshot(
                    record,
                    artifact_snapshot=audit,
                ),
                "fileName": artifact_file.name,
                "exists": True,
            },
        }

    def get_run(self, run_id: str, *, include_events: bool = True) -> dict[str, Any]:
        record = self.require_run(run_id)
        children_count = len(self.store.list_runs(parent_run_id=run_id, limit=1000))
        events = self.store.list_events(run_id) if include_events else None
        return record.to_dict(children_count=children_count, events=events)

    def list_runs(
        self,
        *,
        tenant_id: str | None = None,
        status: str | None = None,
        kind: str | None = None,
        agent_id: str | None = None,
        team_id: str | None = None,
        session_key: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        thread_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        records = self.store.list_runs(
            tenant_id=tenant_id or self.tenant_id,
            instance_id=self.instance_id,
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
        return [
            record.to_dict(children_count=self.store.count_runs(parent_run_id=record.run_id))
            for record in records
        ]

    def list_children(self, parent_run_id: str) -> list[dict[str, Any]]:
        self.require_run(parent_run_id)
        return self.list_runs(parent_run_id=parent_run_id, limit=1000)

    def get_run_tree(self, root_run_id: str) -> dict[str, Any]:
        root = self.get_run(root_run_id, include_events=True)
        nodes: dict[str, dict[str, Any]] = {root["runId"]: root}
        queue: deque[str] = deque([root["runId"]])
        while queue:
            parent_id = queue.popleft()
            children = self.list_children(parent_id)
            nodes[parent_id]["children"] = children
            for child in children:
                nodes[child["runId"]] = child
                queue.append(child["runId"])
        return root

    def get_boundary_audit(self, run_id: str) -> dict[str, Any]:
        record = self.require_run(run_id)
        events = self.store.list_events(run_id)
        execution_event = next(
            (event for event in events if event.event_type == "execution_context_materialized"),
            None,
        )
        bindings_event = next(
            (event for event in events if event.event_type == "bindings_resolved"),
            None,
        )
        channel_event = next(
            (event for event in events if event.event_type == "channel_dispatch_resolved"),
            None,
        )
        artifact_event = next(
            (event for event in reversed(events) if event.event_type == "artifact_written"),
            None,
        )
        artifact_quarantined_event = next(
            (event for event in reversed(events) if event.event_type == "artifact_quarantined"),
            None,
        )
        artifact_archived_event = next(
            (event for event in reversed(events) if event.event_type == "artifact_archived"),
            None,
        )
        artifact_restored_event = next(
            (event for event in reversed(events) if event.event_type == "artifact_restored"),
            None,
        )
        artifact_deleted_event = next(
            (event for event in reversed(events) if event.event_type == "artifact_deleted"),
            None,
        )
        retention_policy_event = next(
            (event for event in reversed(events) if event.event_type == "artifact_retention_policy_set"),
            None,
        )
        artifact_audit = None
        if record.artifact_path:
            try:
                artifact_audit = self.get_artifact_audit(run_id)
            except RunArtifactNotFoundError:
                artifact_audit = {
                    "runId": record.run_id,
                    "tenantId": record.tenant_id,
                    "instanceId": record.instance_id,
                    "artifactPath": record.artifact_path,
                    "exists": False,
                }
        execution_payload = dict(execution_event.payload or {}) if execution_event else {}
        bindings_payload = dict(bindings_event.payload or {}) if bindings_event else {}
        channel_payload = dict(channel_event.payload or {}) if channel_event else {}
        return {
            "runId": record.run_id,
            "tenantId": record.tenant_id,
            "instanceId": record.instance_id,
            "lineage": {
                "kind": record.kind.value,
                "status": record.status.value,
                "controlScope": record.control_scope.value,
                "parentRunId": record.parent_run_id,
                "rootRunId": record.root_run_id,
                "threadId": record.thread_id,
                "sessionKey": record.session_key,
                "spawnDepth": record.spawn_depth,
            },
            "principal": {
                "principalKind": execution_payload.get("principalKind") or execution_payload.get("principal_kind"),
                "principalId": execution_payload.get("principalId") or execution_payload.get("principal_id") or record.agent_id or record.team_id or record.run_id,
                "agentId": record.agent_id,
                "teamId": record.team_id,
                "label": execution_payload.get("label"),
                "role": execution_payload.get("role"),
            },
            "channel": {
                "originChannel": record.origin_channel,
                "originChatId": record.origin_chat_id,
                "routing": channel_payload or None,
            },
            "environment": {
                "workspacePath": execution_payload.get("workspacePath") or record.workspace_path,
                "workspaceScope": execution_payload.get("workspaceScope"),
                "sandboxKind": execution_payload.get("sandboxKind"),
                "execWorkingDir": execution_payload.get("execWorkingDir"),
                "restrictToWorkspace": execution_payload.get("restrictToWorkspace"),
                "execTimeoutSeconds": execution_payload.get("execTimeoutSeconds"),
            },
            "governance": {
                "memoryScope": record.memory_scope,
                "knowledgeScope": record.knowledge_scope,
                "knowledgeBindingIds": bindings_payload.get("knowledgeBindingIds") or [],
                "knowledgeNames": bindings_payload.get("knowledgeNames") or [],
                "toolAllowlist": bindings_payload.get("toolAllowlist") or [],
                "mcpServerIds": bindings_payload.get("mcpServerIds") or [],
                "skillIds": bindings_payload.get("skillIds") or [],
            },
            "artifact": artifact_audit,
            "eventRefs": {
                "executionContextMaterialized": execution_event.to_dict() if execution_event else None,
                "bindingsResolved": bindings_event.to_dict() if bindings_event else None,
                "channelDispatchResolved": channel_event.to_dict() if channel_event else None,
                "artifactWritten": artifact_event.to_dict() if artifact_event else None,
                "artifactQuarantined": artifact_quarantined_event.to_dict() if artifact_quarantined_event else None,
                "artifactArchived": artifact_archived_event.to_dict() if artifact_archived_event else None,
                "artifactRestored": artifact_restored_event.to_dict() if artifact_restored_event else None,
                "artifactDeleted": artifact_deleted_event.to_dict() if artifact_deleted_event else None,
                "artifactRetentionPolicySet": retention_policy_event.to_dict() if retention_policy_event else None,
            },
        }

    def count_running_global(self) -> int:
        tenant_id = self.tenant_id if self._scope_enforced else None
        instance_id = self.instance_id if self._scope_enforced else None
        return self.store.count_runs(
            tenant_id=tenant_id,
            instance_id=instance_id,
            statuses=self._ACTIVE_STATUSES,
        )

    def count_running_for_session(
        self,
        session_key: str,
        *,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> int:
        effective_tenant_id = self.tenant_id if self._scope_enforced else tenant_id
        effective_instance_id = self.instance_id if self._scope_enforced else instance_id
        return self.store.count_runs(
            tenant_id=effective_tenant_id,
            instance_id=effective_instance_id,
            statuses=self._ACTIVE_STATUSES,
            session_key=session_key,
        )

    def check_limits(
        self,
        *,
        session_key: str | None,
        parent_run_id: str | None,
        spawn_depth: int,
        tenant_id: str | None = None,
        instance_id: str | None = None,
    ) -> None:
        effective_tenant_id = self.tenant_id if self._scope_enforced else tenant_id
        effective_instance_id = self.instance_id if self._scope_enforced else instance_id
        if spawn_depth > self.limits.max_spawn_depth:
            raise RunLimitExceededError("Child task depth limit exceeded.")
        if self.store.count_runs(
            tenant_id=effective_tenant_id,
            instance_id=effective_instance_id,
            statuses=self._ACTIVE_STATUSES,
        ) >= self.limits.max_global_running:
            raise RunLimitExceededError("Global child task concurrency limit exceeded.")
        if session_key and self.count_running_for_session(
            session_key,
            tenant_id=effective_tenant_id,
            instance_id=effective_instance_id,
        ) >= self.limits.max_running_per_session:
            raise RunLimitExceededError("Session child task concurrency limit exceeded.")
        if parent_run_id and self.store.count_runs(
            tenant_id=effective_tenant_id,
            instance_id=effective_instance_id,
            statuses=self._ACTIVE_STATUSES,
            parent_run_id=parent_run_id,
        ) >= self.limits.max_children_per_parent:
            raise RunLimitExceededError("Parent child task fan-out limit exceeded.")
