"""Model provider resource models."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

ALLOWED_MODEL_CAPABILITIES = {"chat", "embedding", "reranker"}


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class ModelSelection:
    """A resolved model choice for a specific capability."""

    provider_id: str
    model_name: str
    capability: str = "chat"

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None, *, default_capability: str = "chat") -> "ModelSelection | None":
        if not payload:
            return None
        provider_id = str(payload.get("provider_id") or payload.get("providerId") or "").strip()
        model_name = str(payload.get("model_name") or payload.get("modelName") or "").strip()
        capability = str(payload.get("capability") or default_capability).strip().lower() or default_capability
        if not provider_id or not model_name:
            return None
        if capability not in ALLOWED_MODEL_CAPABILITIES:
            capability = default_capability
        return cls(provider_id=provider_id, model_name=model_name, capability=capability)

    def to_dict(self) -> dict[str, Any]:
        return {
            "providerId": self.provider_id,
            "modelName": self.model_name,
            "capability": self.capability,
        }

    def to_storage_dict(self) -> dict[str, Any]:
        return {
            "provider_id": self.provider_id,
            "model_name": self.model_name,
            "capability": self.capability,
        }

    @property
    def qualified_model_name(self) -> str:
        return self.model_name


@dataclass(slots=True)
class SystemModelDefaults:
    """Instance-scoped defaults for each model capability."""

    tenant_id: str
    instance_id: str
    default_chat: ModelSelection | None = None
    default_embedding: ModelSelection | None = None
    default_reranker: ModelSelection | None = None
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        return json.dumps(
            {
                "default_chat": self.default_chat.to_storage_dict() if self.default_chat else None,
                "default_embedding": self.default_embedding.to_storage_dict() if self.default_embedding else None,
                "default_reranker": self.default_reranker.to_storage_dict() if self.default_reranker else None,
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "SystemModelDefaults":
        stored = json.loads(record.get("config_json") or "{}")
        return cls(
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            default_chat=ModelSelection.from_dict(stored.get("default_chat"), default_capability="chat"),
            default_embedding=ModelSelection.from_dict(
                stored.get("default_embedding"), default_capability="embedding",
            ),
            default_reranker=ModelSelection.from_dict(
                stored.get("default_reranker"), default_capability="reranker",
            ),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenantId": self.tenant_id,
            "instanceId": self.instance_id,
            "defaultChat": self.default_chat.to_dict() if self.default_chat else None,
            "defaultEmbedding": self.default_embedding.to_dict() if self.default_embedding else None,
            "defaultReranker": self.default_reranker.to_dict() if self.default_reranker else None,
            "updatedAt": self.updated_at,
        }


@dataclass(slots=True)
class ModelProvider:
    """A reusable model provider definition used by chat/embedding/reranker."""

    provider_id: str
    tenant_id: str
    instance_id: str
    display_name: str
    provider_type: str
    capabilities: list[str] = field(default_factory=lambda: ["chat"])
    base_url: str | None = None
    api_key: str | None = None
    api_key_env: str | None = None
    extra_headers: dict[str, str] = field(default_factory=dict)
    models: list[str] = field(default_factory=list)
    default_model: str | None = None
    enabled: bool = True
    last_test_status: str | None = None
    last_error: str | None = None
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)

    def to_storage_json(self) -> str:
        return json.dumps(
            {
                "provider_type": self.provider_type,
                "capabilities": self.capabilities,
                "base_url": self.base_url,
                "api_key": self.api_key,
                "api_key_env": self.api_key_env,
                "extra_headers": self.extra_headers,
                "models": self.models,
                "default_model": self.default_model,
                "last_test_status": self.last_test_status,
                "last_error": self.last_error,
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "ModelProvider":
        stored = json.loads(record["config_json"])
        return cls(
            provider_id=record["provider_id"],
            tenant_id=record["tenant_id"],
            instance_id=record["instance_id"],
            display_name=record["display_name"],
            provider_type=stored.get("provider_type") or "openai_compatible",
            capabilities=list(stored.get("capabilities") or ["chat"]),
            base_url=stored.get("base_url"),
            api_key=stored.get("api_key"),
            api_key_env=stored.get("api_key_env"),
            extra_headers=dict(stored.get("extra_headers") or {}),
            models=list(stored.get("models") or []),
            default_model=stored.get("default_model"),
            enabled=bool(record.get("enabled", True)),
            last_test_status=stored.get("last_test_status"),
            last_error=stored.get("last_error"),
            created_at=record.get("created_at") or now_iso(),
            updated_at=record.get("updated_at") or now_iso(),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["providerId"] = payload.pop("provider_id")
        payload["tenantId"] = payload.pop("tenant_id")
        payload["instanceId"] = payload.pop("instance_id")
        payload["displayName"] = payload.pop("display_name")
        payload["providerType"] = payload.pop("provider_type")
        payload["baseUrl"] = payload.pop("base_url")
        payload["apiKey"] = payload.pop("api_key")
        payload["apiKeyEnv"] = payload.pop("api_key_env")
        payload["extraHeaders"] = payload.pop("extra_headers")
        payload["defaultModel"] = payload.pop("default_model")
        payload["lastTestStatus"] = payload.pop("last_test_status")
        payload["lastError"] = payload.pop("last_error")
        payload["createdAt"] = payload.pop("created_at")
        payload["updatedAt"] = payload.pop("updated_at")
        return payload
