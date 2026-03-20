"""Service layer for model provider resources."""

from __future__ import annotations

import re
import os
from dataclasses import replace
from typing import Any

import httpx

from nanobot.config.schema import Config
from nanobot.platform.model_resources.models import (
    ALLOWED_MODEL_CAPABILITIES,
    ModelProvider,
    ModelSelection,
    SystemModelDefaults,
    now_iso,
)
from nanobot.platform.model_resources.store import ModelProviderStore
from nanobot.providers.registry import PROVIDERS, find_by_name


class ModelProviderNotFoundError(KeyError):
    """Raised when a model provider resource does not exist."""


class ModelProviderConflictError(RuntimeError):
    """Raised when a model provider would conflict with an existing one."""


class ModelProviderValidationError(ValueError):
    """Raised when a model provider payload is invalid."""


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "provider"


class ModelProviderService:
    """Instance-scoped CRUD service for chat/embedding/reranker providers."""

    def __init__(self, store: ModelProviderStore, *, instance_id: str):
        self.store = store
        self.instance_id = instance_id

    @staticmethod
    def _get_value(payload: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in payload:
                return payload[key]
        return None

    @staticmethod
    def _normalize_text(value: Any, *, field_name: str, required: bool = False) -> str:
        text = str(value or "").strip()
        if required and not text:
            raise ModelProviderValidationError(f"{field_name} is required.")
        return text

    @staticmethod
    def _normalize_string_list(value: Any, *, field_name: str) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ModelProviderValidationError(f"{field_name} must be a list of strings.")
        result: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            result.append(text)
        return result

    @staticmethod
    def _normalize_headers(value: Any, *, field_name: str) -> dict[str, str]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise ModelProviderValidationError(f"{field_name} must be an object.")
        return {
            str(key).strip(): str(item).strip()
            for key, item in value.items()
            if str(key).strip() and str(item).strip()
        }

    @staticmethod
    def _normalize_capabilities(value: Any) -> list[str]:
        raw = value if value is not None else ["chat"]
        if not isinstance(raw, list):
            raise ModelProviderValidationError("capabilities must be a list.")
        capabilities: list[str] = []
        for item in raw:
            text = str(item or "").strip().lower()
            if text in ALLOWED_MODEL_CAPABILITIES and text not in capabilities:
                capabilities.append(text)
        if not capabilities:
            raise ModelProviderValidationError("capabilities must include chat, embedding, or reranker.")
        return capabilities

    def _ensure_unique_name(
        self,
        display_name: str,
        *,
        tenant_id: str,
        exclude_provider_id: str | None = None,
    ) -> None:
        existing = self.store.get_provider_by_name(display_name, tenant_id=tenant_id, instance_id=self.instance_id)
        if existing is None:
            return
        if exclude_provider_id and existing.provider_id == exclude_provider_id:
            return
        raise ModelProviderConflictError(f"Model provider '{display_name}' already exists.")

    def _next_provider_id(self, display_name: str) -> str:
        base = _slugify(display_name)
        candidate = base
        counter = 2
        while self.store.get_provider(candidate) is not None:
            candidate = f"{base}-{counter}"
            counter += 1
        return candidate

    def _normalize_selection(
        self,
        value: Any,
        *,
        capability: str,
        required: bool = False,
    ) -> ModelSelection | None:
        if value is None:
            if required:
                raise ModelProviderValidationError(f"default{capability.title()} is required.")
            return None
        if not isinstance(value, dict):
            raise ModelProviderValidationError(f"default{capability.title()} must be an object.")
        selection = ModelSelection.from_dict(value, default_capability=capability)
        if selection is None and required:
            raise ModelProviderValidationError(f"default{capability.title()} is required.")
        if selection is not None and selection.capability != capability:
            selection = replace(selection, capability=capability)
        return selection

    def _validate_selection_exists(self, selection: ModelSelection | None) -> ModelSelection | None:
        if selection is None:
            return None
        provider = self.store.get_provider(selection.provider_id)
        if provider is None or not provider.enabled:
            raise ModelProviderValidationError(f"Referenced model provider '{selection.provider_id}' does not exist.")
        if selection.capability not in provider.capabilities:
            raise ModelProviderValidationError(
                f"Provider '{selection.provider_id}' does not support capability '{selection.capability}'.",
            )
        if provider.models and selection.model_name not in provider.models:
            raise ModelProviderValidationError(
                f"Model '{selection.model_name}' is not registered under provider '{selection.provider_id}'.",
            )
        return selection

    def _normalize_create_payload(self, payload: dict[str, Any], *, tenant_id: str) -> ModelProvider:
        display_name = self._normalize_text(
            self._get_value(payload, "displayName", "display_name"),
            required=True,
            field_name="displayName",
        )
        self._ensure_unique_name(display_name, tenant_id=tenant_id)
        capabilities = self._normalize_capabilities(self._get_value(payload, "capabilities"))
        models = self._normalize_string_list(self._get_value(payload, "models"), field_name="models")
        default_model = self._normalize_text(
            self._get_value(payload, "defaultModel", "default_model"),
            field_name="defaultModel",
        ) or None
        if default_model and models and default_model not in models:
            models.append(default_model)
        now = now_iso()
        return ModelProvider(
            provider_id=self._next_provider_id(display_name),
            tenant_id=tenant_id,
            instance_id=self.instance_id,
            display_name=display_name,
            provider_type=self._normalize_text(
                self._get_value(payload, "providerType", "provider_type"),
                field_name="providerType",
            ) or "openai_compatible",
            capabilities=capabilities,
            base_url=self._normalize_text(
                self._get_value(payload, "baseUrl", "base_url"),
                field_name="baseUrl",
            ) or None,
            api_key=self._normalize_text(self._get_value(payload, "apiKey", "api_key"), field_name="apiKey") or None,
            api_key_env=self._normalize_text(
                self._get_value(payload, "apiKeyEnv", "api_key_env"),
                field_name="apiKeyEnv",
            ) or None,
            extra_headers=self._normalize_headers(
                self._get_value(payload, "extraHeaders", "extra_headers"),
                field_name="extraHeaders",
            ),
            models=models,
            default_model=default_model,
            enabled=True if self._get_value(payload, "enabled") is None else bool(self._get_value(payload, "enabled")),
            created_at=now,
            updated_at=now,
        )

    def _apply_update(self, existing: ModelProvider, payload: dict[str, Any]) -> ModelProvider:
        display_name = existing.display_name
        if self._get_value(payload, "displayName", "display_name") is not None:
            display_name = self._normalize_text(
                self._get_value(payload, "displayName", "display_name"),
                required=True,
                field_name="displayName",
            )
            self._ensure_unique_name(display_name, tenant_id=existing.tenant_id, exclude_provider_id=existing.provider_id)
        models = existing.models
        if self._get_value(payload, "models") is not None:
            models = self._normalize_string_list(self._get_value(payload, "models"), field_name="models")
        default_model = existing.default_model
        if self._get_value(payload, "defaultModel", "default_model") is not None:
            default_model = self._normalize_text(
                self._get_value(payload, "defaultModel", "default_model"),
                field_name="defaultModel",
            ) or None
        if default_model and models and default_model not in models:
            models = [*models, default_model]
        return replace(
            existing,
            display_name=display_name,
            provider_type=existing.provider_type
            if self._get_value(payload, "providerType", "provider_type") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "providerType", "provider_type"),
                    field_name="providerType",
                ) or "openai_compatible"
            ),
            capabilities=existing.capabilities
            if self._get_value(payload, "capabilities") is None
            else self._normalize_capabilities(self._get_value(payload, "capabilities")),
            base_url=existing.base_url
            if self._get_value(payload, "baseUrl", "base_url") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "baseUrl", "base_url"),
                    field_name="baseUrl",
                ) or None
            ),
            api_key=existing.api_key
            if self._get_value(payload, "apiKey", "api_key") is None
            else (self._normalize_text(self._get_value(payload, "apiKey", "api_key"), field_name="apiKey") or None),
            api_key_env=existing.api_key_env
            if self._get_value(payload, "apiKeyEnv", "api_key_env") is None
            else (
                self._normalize_text(
                    self._get_value(payload, "apiKeyEnv", "api_key_env"),
                    field_name="apiKeyEnv",
                ) or None
            ),
            extra_headers=existing.extra_headers
            if self._get_value(payload, "extraHeaders", "extra_headers") is None
            else self._normalize_headers(
                self._get_value(payload, "extraHeaders", "extra_headers"),
                field_name="extraHeaders",
            ),
            models=models,
            default_model=default_model,
            enabled=existing.enabled if self._get_value(payload, "enabled") is None else bool(self._get_value(payload, "enabled")),
            updated_at=now_iso(),
        )

    def seed_from_legacy_config(self, config: Config, *, tenant_id: str = "default") -> dict[str, Any]:
        created: list[str] = []
        defaults = self.store.get_defaults(tenant_id=tenant_id, instance_id=self.instance_id)
        providers = self.store.list_providers(tenant_id=tenant_id, instance_id=self.instance_id)
        existing_by_type = {item.provider_type: item for item in providers}

        for spec in PROVIDERS:
            provider_cfg = getattr(config.providers, spec.name, None)
            model_name = ""
            if config.get_provider_name(config.agents.defaults.model) == spec.name:
                model_name = config.agents.defaults.model
            if provider_cfg is None:
                continue
            if not any([
                provider_cfg.api_key,
                provider_cfg.api_base,
                provider_cfg.extra_headers,
                spec.is_oauth,
                spec.is_local,
                model_name,
            ]):
                continue
            if spec.name in existing_by_type:
                continue
            display_name = spec.label
            provider = ModelProvider(
                provider_id=self._next_provider_id(display_name),
                tenant_id=tenant_id,
                instance_id=self.instance_id,
                display_name=display_name,
                provider_type=spec.name,
                capabilities=["chat"],
                base_url=provider_cfg.api_base or spec.default_api_base,
                api_key=provider_cfg.api_key or None,
                api_key_env=None,
                extra_headers=provider_cfg.extra_headers or {},
                models=[model_name] if model_name else [],
                default_model=model_name or None,
                enabled=True,
            )
            self.store.create_provider(provider)
            existing_by_type[spec.name] = provider
            created.append(provider.provider_id)

        if defaults is None:
            default_chat = None
            provider_name = config.get_provider_name(config.agents.defaults.model)
            if provider_name and provider_name in existing_by_type and config.agents.defaults.model:
                default_chat = ModelSelection(
                    provider_id=existing_by_type[provider_name].provider_id,
                    model_name=config.agents.defaults.model,
                    capability="chat",
                )
            defaults = self.store.save_defaults(
                SystemModelDefaults(
                    tenant_id=tenant_id,
                    instance_id=self.instance_id,
                    default_chat=default_chat,
                )
            )
        return {
            "createdProviderIds": created,
            "defaults": defaults.to_dict(),
        }

    def list_providers(self, *, tenant_id: str, enabled: bool | None = None) -> list[dict[str, Any]]:
        return [
            item.to_dict()
            for item in self.store.list_providers(
                tenant_id=tenant_id,
                instance_id=self.instance_id,
                enabled=enabled,
            )
        ]

    def get_provider(self, provider_id: str, *, tenant_id: str | None = None) -> dict[str, Any]:
        provider = self.store.get_provider(provider_id, tenant_id=tenant_id)
        if provider is None:
            raise ModelProviderNotFoundError(provider_id)
        return provider.to_dict()

    def require_provider(self, provider_id: str, *, tenant_id: str | None = None) -> ModelProvider:
        provider = self.store.get_provider(provider_id, tenant_id=tenant_id)
        if provider is None:
            raise ModelProviderNotFoundError(provider_id)
        return provider

    def create_provider(self, payload: dict[str, Any], *, tenant_id: str) -> dict[str, Any]:
        return self.store.create_provider(self._normalize_create_payload(payload, tenant_id=tenant_id)).to_dict()

    def update_provider(self, provider_id: str, payload: dict[str, Any], *, tenant_id: str | None = None) -> dict[str, Any]:
        provider = self.require_provider(provider_id, tenant_id=tenant_id)
        updated = self.store.update_provider(self._apply_update(provider, payload), tenant_id=tenant_id)
        if updated is None:
            raise ModelProviderNotFoundError(provider_id)
        return updated.to_dict()

    def delete_provider(self, provider_id: str, *, tenant_id: str | None = None) -> bool:
        if not self.store.delete_provider(provider_id, tenant_id=tenant_id):
            raise ModelProviderNotFoundError(provider_id)
        defaults = self.store.get_defaults(tenant_id=tenant_id or "default", instance_id=self.instance_id)
        if defaults is not None:
            changed = False
            for attr in ("default_chat", "default_embedding", "default_reranker"):
                selection = getattr(defaults, attr)
                if selection is not None and selection.provider_id == provider_id:
                    setattr(defaults, attr, None)
                    changed = True
            if changed:
                defaults.updated_at = now_iso()
                self.store.save_defaults(defaults)
        return True

    def get_defaults(self, *, tenant_id: str) -> dict[str, Any]:
        defaults = self.store.get_defaults(tenant_id=tenant_id, instance_id=self.instance_id)
        if defaults is None:
            defaults = self.store.save_defaults(
                SystemModelDefaults(tenant_id=tenant_id, instance_id=self.instance_id),
            )
        return defaults.to_dict()

    def update_defaults(self, payload: dict[str, Any], *, tenant_id: str) -> dict[str, Any]:
        defaults = self.store.get_defaults(tenant_id=tenant_id, instance_id=self.instance_id) or SystemModelDefaults(
            tenant_id=tenant_id,
            instance_id=self.instance_id,
        )
        if self._get_value(payload, "defaultChat", "default_chat") is not None:
            defaults.default_chat = self._validate_selection_exists(
                self._normalize_selection(
                    self._get_value(payload, "defaultChat", "default_chat"),
                    capability="chat",
                ),
            )
        if self._get_value(payload, "defaultEmbedding", "default_embedding") is not None:
            defaults.default_embedding = self._validate_selection_exists(
                self._normalize_selection(
                    self._get_value(payload, "defaultEmbedding", "default_embedding"),
                    capability="embedding",
                ),
            )
        if self._get_value(payload, "defaultReranker", "default_reranker") is not None:
            defaults.default_reranker = self._validate_selection_exists(
                self._normalize_selection(
                    self._get_value(payload, "defaultReranker", "default_reranker"),
                    capability="reranker",
                ),
            )
        defaults.updated_at = now_iso()
        return self.store.save_defaults(defaults).to_dict()

    def test_provider(self, provider_id: str, *, tenant_id: str | None = None) -> dict[str, Any]:
        provider = self.require_provider(provider_id, tenant_id=tenant_id)
        model_name = provider.default_model or (provider.models[0] if provider.models else "")
        if not provider.base_url:
            raise ModelProviderValidationError("Provider test requires baseUrl.")
        if not model_name:
            raise ModelProviderValidationError("Provider test requires defaultModel or at least one model entry.")
        headers = dict(provider.extra_headers)
        if provider.api_key:
            headers.setdefault("Authorization", f"Bearer {provider.api_key}")
        timeout = httpx.Timeout(20.0, connect=10.0)
        endpoint = provider.base_url.rstrip("/")
        payload: dict[str, Any]
        capabilities = {str(item).strip().lower() for item in provider.capabilities}
        if "chat" not in capabilities and "reranker" in capabilities:
            url = endpoint if endpoint.endswith("/rerank") else f"{endpoint}/rerank"
            payload = {
                "model": model_name,
                "query": "ping",
                "documents": ["ping", "pong"],
                "top_n": 1,
            }
        elif "embedding" in capabilities and "chat" not in capabilities:
            url = endpoint if endpoint.endswith("/embeddings") else f"{endpoint}/embeddings"
            payload = {"model": model_name, "input": ["ping"]}
        else:
            url = endpoint if endpoint.endswith("/chat/completions") else f"{endpoint}/chat/completions"
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
            }
        last_error = None
        last_test_status = "failed"
        try:
            with httpx.Client(timeout=timeout, headers=headers or None) as client:
                response = client.post(url, json=payload)
                response.raise_for_status()
            last_test_status = "passed"
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc) or type(exc).__name__
        updated = replace(
            provider,
            last_test_status=last_test_status,
            last_error=last_error,
            updated_at=now_iso(),
        )
        self.store.update_provider(updated, tenant_id=tenant_id)
        return {
            "providerId": provider_id,
            "ok": last_test_status == "passed",
            "status": last_test_status,
            "error": last_error,
            "provider": updated.to_dict(),
        }

    def selection_to_legacy_config(self, selection: ModelSelection, *, tenant_id: str) -> dict[str, Any]:
        provider = self.require_provider(selection.provider_id, tenant_id=tenant_id)
        provider_type = provider.provider_type
        spec = find_by_name(provider_type)
        legacy_provider_name = provider_type if spec is not None else "custom"
        api_key = provider.api_key
        if not api_key and provider.api_key_env:
            api_key = os.getenv(provider.api_key_env)
        return {
            "providerName": legacy_provider_name,
            "model": selection.model_name,
            "baseUrl": provider.base_url,
            "apiKey": api_key,
            "extraHeaders": provider.extra_headers,
        }
