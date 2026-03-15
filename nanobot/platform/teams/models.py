"""Team definition models for multi-agent productization."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
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
class SupervisorConfig:
    """Configuration for the LangGraph supervisor in a team."""

    recursion_limit: int = 25
    max_member_calls_per_run: int = 20
    supervisor_prompt_template: str = ""
    response_mode: str = "synthesize"

    def to_dict(self) -> dict[str, Any]:
        return {
            "recursionLimit": self.recursion_limit,
            "maxMemberCallsPerRun": self.max_member_calls_per_run,
            "supervisorPromptTemplate": self.supervisor_prompt_template,
            "responseMode": self.response_mode,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> SupervisorConfig:
        if not data:
            return cls()
        return cls(
            recursion_limit=int(data.get("recursion_limit") or data.get("recursionLimit") or 25),
            max_member_calls_per_run=int(
                data.get("max_member_calls_per_run") or data.get("maxMemberCallsPerRun") or 20
            ),
            supervisor_prompt_template=str(
                data.get("supervisor_prompt_template") or data.get("supervisorPromptTemplate") or ""
            ),
            response_mode=str(data.get("response_mode") or data.get("responseMode") or "synthesize"),
        )

    def to_storage_dict(self) -> dict[str, Any]:
        return {
            "recursion_limit": self.recursion_limit,
            "max_member_calls_per_run": self.max_member_calls_per_run,
            "supervisor_prompt_template": self.supervisor_prompt_template,
            "response_mode": self.response_mode,
        }


@dataclass(slots=True)
class TeamDefinition:
    """Instance-scoped reusable team definition."""

    team_id: str
    tenant_id: str
    instance_id: str
    name: str
    supervisor_agent_id: str
    description: str = ""
    member_agent_ids: list[str] = field(default_factory=list)
    supervisor_config: SupervisorConfig = field(default_factory=SupervisorConfig)
    shared_knowledge_binding_ids: list[str] = field(default_factory=list)
    member_access_policy: dict[str, Any] = field(default_factory=default_member_access_policy)
    tags: list[str] = field(default_factory=list)
    enabled: bool = True
    team_thread_enabled: bool = True
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        payload = {
            "description": self.description,
            "supervisor_agent_id": self.supervisor_agent_id,
            "member_agent_ids": self.member_agent_ids,
            "supervisor_config": self.supervisor_config.to_storage_dict(),
            "shared_knowledge_binding_ids": self.shared_knowledge_binding_ids,
            "member_access_policy": self.member_access_policy,
            "tags": self.tags,
            "team_thread_enabled": self.team_thread_enabled,
        }
        return json.dumps(payload, ensure_ascii=False)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> TeamDefinition:
        stored = json.loads(record["config_json"])
        # Support legacy field name: leader_agent_id -> supervisor_agent_id
        supervisor_agent_id = (
            stored.get("supervisor_agent_id")
            or stored.get("leader_agent_id")
            or ""
        )
        return cls(
            team_id=record["team_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            name=record["name"],
            supervisor_agent_id=supervisor_agent_id,
            description=stored.get("description", ""),
            member_agent_ids=list(stored.get("member_agent_ids") or []),
            supervisor_config=SupervisorConfig.from_dict(stored.get("supervisor_config")),
            shared_knowledge_binding_ids=list(stored.get("shared_knowledge_binding_ids") or []),
            member_access_policy=dict(stored.get("member_access_policy") or default_member_access_policy()),
            tags=list(stored.get("tags") or []),
            enabled=bool(record.get("enabled", True)),
            team_thread_enabled=bool(stored.get("team_thread_enabled", True)),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "teamId": self.team_id,
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "name": self.name,
            "supervisorAgentId": self.supervisor_agent_id,
            "description": self.description,
            "memberAgentIds": self.member_agent_ids,
            "supervisorConfig": self.supervisor_config.to_dict(),
            "sharedKnowledgeBindingIds": self.shared_knowledge_binding_ids,
            "memberAccessPolicy": self.member_access_policy,
            "tags": self.tags,
            "enabled": self.enabled,
            "teamThreadEnabled": self.team_thread_enabled,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "memberCount": 1 + len(self.member_agent_ids),
        }
        return payload
