"""Agent definition models for reusable single-agent configurations."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class AgentDefinition:
    """Instance-scoped reusable agent definition."""

    agent_id: str
    tenant_id: str
    instance_id: str
    name: str
    description: str = ""
    system_prompt: str = ""
    rules: list[str] = field(default_factory=list)
    model: str | None = None
    binding: str | None = None
    provider: str | None = None
    backend: str | None = None
    enabled: bool = True
    tool_allowlist: list[str] = field(default_factory=list)
    mcp_server_ids: list[str] = field(default_factory=list)
    skill_ids: list[str] = field(default_factory=list)
    knowledge_binding_ids: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    memory_scope: str = "agent_profile"
    source_template_name: str | None = None
    max_execution_timeout_seconds: int = 300
    output_format_hint: str = ""
    artifact_retention_policy: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        payload = {
            "name": self.name,
            "description": self.description,
            "system_prompt": self.system_prompt,
            "rules": self.rules,
            "model": self.model,
            "binding": self.binding,
            "provider": self.provider,
            "backend": self.backend,
            "tool_allowlist": self.tool_allowlist,
            "mcp_server_ids": self.mcp_server_ids,
            "skill_ids": self.skill_ids,
            "knowledge_binding_ids": self.knowledge_binding_ids,
            "tags": self.tags,
            "memory_scope": self.memory_scope,
            "source_template_name": self.source_template_name,
            "max_execution_timeout_seconds": self.max_execution_timeout_seconds,
            "output_format_hint": self.output_format_hint,
            "artifact_retention_policy": self.artifact_retention_policy,
        }
        return json.dumps(payload, ensure_ascii=False)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "AgentDefinition":
        stored = json.loads(record["config_json"])
        memory_scope = stored.get("memory_scope") or "agent_profile"
        if memory_scope not in {"agent_profile", "workspace_shared"}:
            memory_scope = "agent_profile"
        return cls(
            agent_id=record["agent_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            name=record["name"],
            description=stored.get("description", ""),
            system_prompt=stored.get("system_prompt", ""),
            rules=list(stored.get("rules") or []),
            model=stored.get("model"),
            binding=stored.get("binding"),
            provider=stored.get("provider"),
            backend=stored.get("backend"),
            enabled=bool(record.get("enabled", True)),
            tool_allowlist=list(stored.get("tool_allowlist") or []),
            mcp_server_ids=list(stored.get("mcp_server_ids") or []),
            skill_ids=list(stored.get("skill_ids") or []),
            knowledge_binding_ids=list(stored.get("knowledge_binding_ids") or []),
            tags=list(stored.get("tags") or []),
            memory_scope=memory_scope,
            source_template_name=record.get("source_template_name") or stored.get("source_template_name"),
            max_execution_timeout_seconds=int(stored.get("max_execution_timeout_seconds") or 300),
            output_format_hint=stored.get("output_format_hint") or "",
            artifact_retention_policy=dict(stored.get("artifact_retention_policy") or {}),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["agentId"] = payload.pop("agent_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["systemPrompt"] = payload.pop("system_prompt")
        payload["toolAllowlist"] = payload.pop("tool_allowlist")
        payload["mcpServerIds"] = payload.pop("mcp_server_ids")
        payload["skillIds"] = payload.pop("skill_ids")
        payload["knowledgeBindingIds"] = payload.pop("knowledge_binding_ids")
        payload["memoryScope"] = payload.pop("memory_scope")
        payload["sourceTemplateName"] = payload.pop("source_template_name")
        payload["maxExecutionTimeoutSeconds"] = payload.pop("max_execution_timeout_seconds")
        payload["outputFormatHint"] = payload.pop("output_format_hint")
        payload["artifactRetentionPolicy"] = payload.pop("artifact_retention_policy")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload
