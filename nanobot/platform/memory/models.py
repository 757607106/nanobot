"""Models for team shared memory and candidate memory updates."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class MemoryCandidate:
    """Proposed memory update awaiting review or application."""

    candidate_id: str
    tenant_id: str
    instance_id: str
    scope: str
    source_kind: str
    title: str
    content: str
    team_id: str | None = None
    agent_id: str | None = None
    run_id: str | None = None
    status: str = "proposed"
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)
    applied_at: str | None = None

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "MemoryCandidate":
        return cls(
            candidate_id=record["candidate_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            scope=record["scope"],
            source_kind=record["source_kind"],
            title=record["title"],
            content=record["content"],
            team_id=record.get("team_id"),
            agent_id=record.get("agent_id"),
            run_id=record.get("run_id"),
            status=record.get("status") or "proposed",
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
            applied_at=record.get("applied_at"),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["candidateId"] = payload.pop("candidate_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["sourceKind"] = payload.pop("source_kind")
        payload["teamId"] = payload.pop("team_id")
        payload["agentId"] = payload.pop("agent_id")
        payload["runId"] = payload.pop("run_id")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        payload["appliedAt"] = payload.pop("applied_at")
        return payload
