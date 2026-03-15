"""Team definition models for multi-agent productization."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def default_member_access_policy() -> dict[str, Any]:
    return {
        "teamSharedKnowledge": "explicit_only",
        "teamSharedMemory": "leader_write_member_read",
    }


@dataclass(slots=True)
class TeamDefinition:
    """Instance-scoped reusable team definition."""

    team_id: str
    tenant_id: str
    instance_id: str
    name: str
    leader_agent_id: str
    description: str = ""
    member_agent_ids: list[str] = field(default_factory=list)
    workflow_mode: str = "parallel_fanout"
    shared_knowledge_binding_ids: list[str] = field(default_factory=list)
    member_access_policy: dict[str, Any] = field(default_factory=default_member_access_policy)
    tags: list[str] = field(default_factory=list)
    enabled: bool = True
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        payload = {
            "description": self.description,
            "leader_agent_id": self.leader_agent_id,
            "member_agent_ids": self.member_agent_ids,
            "workflow_mode": self.workflow_mode,
            "shared_knowledge_binding_ids": self.shared_knowledge_binding_ids,
            "member_access_policy": self.member_access_policy,
            "tags": self.tags,
        }
        return json.dumps(payload, ensure_ascii=False)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "TeamDefinition":
        stored = json.loads(record["config_json"])
        return cls(
            team_id=record["team_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            name=record["name"],
            leader_agent_id=stored.get("leader_agent_id") or "",
            description=stored.get("description", ""),
            member_agent_ids=list(stored.get("member_agent_ids") or []),
            workflow_mode=stored.get("workflow_mode") or "parallel_fanout",
            shared_knowledge_binding_ids=list(stored.get("shared_knowledge_binding_ids") or []),
            member_access_policy=dict(stored.get("member_access_policy") or default_member_access_policy()),
            tags=list(stored.get("tags") or []),
            enabled=bool(record.get("enabled", True)),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["teamId"] = payload.pop("team_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["leaderAgentId"] = payload.pop("leader_agent_id")
        payload["memberAgentIds"] = payload.pop("member_agent_ids")
        payload["workflowMode"] = payload.pop("workflow_mode")
        payload["sharedKnowledgeBindingIds"] = payload.pop("shared_knowledge_binding_ids")
        payload["memberAccessPolicy"] = payload.pop("member_access_policy")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        payload["memberCount"] = 1 + len(self.member_agent_ids)
        return payload
