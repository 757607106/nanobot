"""Shared model-selection normalization for agent definitions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from nanobot.providers.registry import find_by_model, find_by_name

if TYPE_CHECKING:
    from nanobot.config.schema import Config, ModelBindingConfig


@dataclass(slots=True, frozen=True)
class AgentModelSelection:
    """Canonical runtime selection for one agent definition."""

    model: str | None
    binding: str | None
    provider: str | None


def _clean_text(value: str | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def _clean_provider(value: str | None) -> str | None:
    text = _clean_text(value)
    if text is None or text == "auto":
        return None
    spec = find_by_name(text)
    return spec.name if spec is not None else text


def _matches_provider(binding: ModelBindingConfig, provider_hint: str | None) -> bool:
    return provider_hint is None or binding.provider == provider_hint


def _binding_by_model(
    config: Config,
    model: str | None,
    *,
    provider_hint: str | None = None,
) -> str | None:
    resolved_model = _clean_text(model)
    if resolved_model is None:
        return None

    exact_matches = [
        binding_name
        for binding_name, binding in config.model_bindings.items()
        if _clean_text(binding.model) == resolved_model and _matches_provider(binding, provider_hint)
    ]
    if exact_matches:
        preferred = next(
            (
                binding_name
                for binding_name in exact_matches
                if provider_hint and binding_name == provider_hint
            ),
            None,
        )
        return preferred or sorted(exact_matches)[0]

    inferred = find_by_model(resolved_model)
    if inferred is None:
        return None
    if provider_hint is not None and inferred.name != provider_hint:
        return None
    return _preferred_binding_for_provider(config, inferred.name, model=resolved_model)


def _preferred_binding_for_provider(
    config: Config,
    provider: str | None,
    *,
    model: str | None = None,
) -> str | None:
    provider_name = _clean_provider(provider)
    if provider_name is None:
        return None

    candidates = [
        binding_name
        for binding_name, binding in config.model_bindings.items()
        if binding.provider == provider_name
    ]
    if not candidates:
        return None
    if model:
        exact = next(
            (
                binding_name
                for binding_name in candidates
                if _clean_text(config.model_bindings[binding_name].model) == _clean_text(model)
            ),
            None,
        )
        if exact is not None:
            return exact
    if provider_name in candidates:
        return provider_name
    return sorted(candidates)[0]


def _selection_from_binding(
    binding_name: str,
    binding: ModelBindingConfig,
    *,
    model: str | None,
) -> AgentModelSelection:
    return AgentModelSelection(
        model=_clean_text(model) or _clean_text(binding.model),
        binding=binding_name,
        provider=binding.provider,
    )


def canonicalize_agent_model_selection(
    config: Config | None,
    *,
    model: str | None = None,
    binding: str | None = None,
    provider: str | None = None,
    default_model: str | None = None,
    default_binding: str | None = None,
    default_provider: str | None = None,
) -> AgentModelSelection:
    """Resolve agent model selection into one canonical representation.

    Resolution order is binding-first while staying compatible with legacy
    provider/model payloads and older stored agents whose `binding` field
    accidentally contains a model name.
    """

    resolved_model = _clean_text(model) or _clean_text(default_model)
    resolved_binding = _clean_text(binding) or _clean_text(default_binding)
    resolved_provider = _clean_provider(provider) or _clean_provider(default_provider)

    if config is None:
        if resolved_provider is None and resolved_model is not None:
            inferred = find_by_model(resolved_model)
            resolved_provider = inferred.name if inferred is not None else None
        return AgentModelSelection(
            model=resolved_model,
            binding=resolved_binding,
            provider=resolved_provider,
        )

    original_binding = resolved_binding

    direct_binding = config.model_bindings.get(str(resolved_binding or ""))
    if direct_binding is not None:
        return _selection_from_binding(
            str(resolved_binding),
            direct_binding,
            model=resolved_model,
        )

    if resolved_binding:
        recovered_from_model = _binding_by_model(
            config,
            resolved_binding,
            provider_hint=resolved_provider,
        )
        if recovered_from_model is not None:
            recovered_binding = config.model_bindings[recovered_from_model]
            return _selection_from_binding(
                recovered_from_model,
                recovered_binding,
                model=resolved_model or resolved_binding,
            )

        recovered_from_provider = _preferred_binding_for_provider(
            config,
            resolved_binding,
            model=resolved_model,
        )
        if recovered_from_provider is not None:
            recovered_binding = config.model_bindings[recovered_from_provider]
            return _selection_from_binding(
                recovered_from_provider,
                recovered_binding,
                model=resolved_model,
            )

    if resolved_model:
        recovered_binding_name = _binding_by_model(
            config,
            resolved_model,
            provider_hint=resolved_provider,
        )
        if recovered_binding_name is not None:
            return _selection_from_binding(
                recovered_binding_name,
                config.model_bindings[recovered_binding_name],
                model=resolved_model,
            )

    if resolved_provider:
        recovered_binding_name = _preferred_binding_for_provider(
            config,
            resolved_provider,
            model=resolved_model,
        )
        if recovered_binding_name is not None:
            return _selection_from_binding(
                recovered_binding_name,
                config.model_bindings[recovered_binding_name],
                model=resolved_model,
            )

    if original_binding:
        raise ValueError(f"Agent references unknown model binding: {original_binding}")

    if resolved_provider is None and resolved_model is not None:
        inferred = find_by_model(resolved_model)
        resolved_provider = inferred.name if inferred is not None else None

    return AgentModelSelection(
        model=resolved_model,
        binding=None,
        provider=resolved_provider,
    )
