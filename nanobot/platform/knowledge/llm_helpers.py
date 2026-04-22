"""LLM generation helpers for knowledge-base tasks.

Provides a thin, reusable wrapper around the platform's provider system so
that LLM-dependent features (description generation, evaluation scoring,
sample questions, etc.) don't duplicate provider construction logic.
"""

from __future__ import annotations

import os
import re
from typing import TYPE_CHECKING, Any

from loguru import logger

from nanobot.platform.knowledge.utils import binding_supports_capability, infer_embedding_dim

if TYPE_CHECKING:
    from nanobot.config.schema import Config


class KnowledgeLLMHelper:
    """Stateless helper that builds a provider from *config* on demand and
    provides convenient ``generate`` / ``extract_json`` methods.

    Parameters
    ----------
    config:
        The live platform ``Config`` instance.  May be ``None`` if no LLM
        features are available.
    run_async_fn:
        A callable ``(coro) -> result`` that bridges async provider calls
        into the synchronous knowledge service runtime — typically
        ``KnowledgeBaseService._run_async``.
    """

    def __init__(
        self,
        config: Config | None,
        run_async_fn: Any,
    ) -> None:
        self.config = config
        self._run_async = run_async_fn

    # ── Public API ──

    def generate(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        timeout: float | None = None,
    ) -> str | None:
        """Run a single LLM chat turn and return the text content, or ``None``."""
        try:
            provider = self._provider_from_config()
            if provider is None:
                return None
            response = self._run_async(
                provider.chat_with_retry(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    model=self.config.agents.defaults.model if self.config is not None else None,
                ),
                timeout=timeout,
            )
            content = str(response.content or "").strip()
            return content or None
        except Exception:
            logger.exception("Knowledge LLM generation failed")
            return None

    @staticmethod
    def extract_json(raw: str) -> str | None:
        """Best-effort extraction of a JSON block from raw LLM output.

        Handles:
        - Direct JSON objects / arrays
        - Fenced code blocks (````json ... ````)
        - Embedded ``{…}`` anywhere in the text
        """
        text = str(raw or "").strip()
        if not text:
            return None
        if text.startswith("{") or text.startswith("["):
            return text
        match = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
        if match:
            return match.group(1).strip()
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return text[start:end + 1]
        return None

    # ── Vision helpers ──

    async def describe_image_async(
        self,
        *,
        image_base64: str,
        mime_type: str = "image/png",
        vision_runtime: dict[str, Any],
        prompt: str = "请详细描述这张图片的内容。如果包含文字请完整提取，如果是图表请描述数据和趋势，如果是流程图请描述步骤和关系。使用中文回答。",
        timeout: float = 60.0,
    ) -> str | None:
        """Call a Vision model to describe a single image.

        Parameters
        ----------
        image_base64:
            Base64-encoded image content.
        mime_type:
            MIME type of the image (e.g. ``image/png``, ``image/jpeg``).
        vision_runtime:
            Resolved vision model runtime dict with keys:
            ``model``, ``provider_name``, ``api_key``, ``api_base``,
            ``extra_headers``.
        prompt:
            The user prompt sent alongside the image.
        timeout:
            Request timeout in seconds.

        Returns
        -------
        The text description, or ``None`` on failure.
        """
        model = str(vision_runtime.get("model") or "").strip()
        if not model or not image_base64:
            return None

        try:
            import litellm

            provider_name = str(vision_runtime.get("provider_name") or "").strip()
            api_key = str(vision_runtime.get("api_key") or "").strip() or None
            api_base = str(vision_runtime.get("api_base") or "").strip() or None
            extra_headers = dict(vision_runtime.get("extra_headers") or {})

            # Build litellm-compatible model name with provider prefix
            from nanobot.providers.registry import find_by_name
            provider_spec = find_by_name(provider_name) if provider_name else None
            litellm_model = model
            if provider_spec and provider_spec.litellm_prefix:
                if not model.startswith(provider_spec.litellm_prefix):
                    litellm_model = f"{provider_spec.litellm_prefix}{model}"

            data_url = f"data:{mime_type};base64,{image_base64}"
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                }
            ]

            response = await litellm.acompletion(
                model=litellm_model,
                messages=messages,
                api_key=api_key,
                api_base=api_base,
                extra_headers=extra_headers or None,
                max_tokens=1024,
                temperature=0.1,
                timeout=timeout,
            )
            content = str(
                getattr(response.choices[0].message, "content", None) or ""
            ).strip()
            return content or None

        except Exception:
            logger.exception("Vision image description failed for model {}", model)
            return None

    # ── Binding resolution helpers ──

    def resolve_binding_runtime(
        self,
        *,
        binding_name: str | None,
        model_name: str | None,
        capability_type: str,
    ) -> dict[str, Any]:
        """Resolve a model binding to concrete provider parameters."""
        if self.config is None:
            return {}

        from nanobot.providers.registry import find_by_name

        requested_binding_name = str(binding_name or "").strip()
        requested_model_name = str(model_name or "").strip()
        binding = None
        matched_binding_name: str | None = None

        if requested_binding_name:
            candidate = self.config.model_bindings.get(requested_binding_name)
            if candidate is not None and binding_supports_capability(
                getattr(candidate, "capability_type", None),
                capability_type,
            ):
                binding = candidate
                matched_binding_name = requested_binding_name

        if binding is None and requested_model_name:
            candidate = self.config.get_binding(requested_model_name)
            if candidate is not None and binding_supports_capability(
                getattr(candidate, "capability_type", None),
                capability_type,
            ):
                binding = candidate
                matched_binding_name = self.config.get_binding_name(requested_model_name)

        if binding is None:
            return {}

        provider_name = str(getattr(binding, "provider", "") or "").strip()
        provider_cfg = getattr(self.config.providers, provider_name, None) if provider_name else None
        provider_spec = find_by_name(provider_name) if provider_name else None
        api_key = str(
            getattr(binding, "api_key", None)
            or getattr(provider_cfg, "api_key", None)
            or (os.getenv(provider_spec.env_key) if provider_spec and provider_spec.env_key else None)
            or ""
        )
        api_base = str(
            getattr(binding, "api_base", None)
            or getattr(provider_cfg, "api_base", None)
            or ""
        )
        extra_headers = dict(
            getattr(binding, "extra_headers", None)
            or getattr(provider_cfg, "extra_headers", None)
            or {}
        )
        resolved_model_name = str(
            requested_model_name
            or getattr(binding, "model", None)
            or ""
        ).strip()
        if not resolved_model_name:
            return {}

        runtime = {
            "binding_name": matched_binding_name or requested_binding_name or None,
            "provider_name": provider_name or None,
            "model": resolved_model_name,
            "api_key": api_key,
            "api_base": api_base,
            "extra_headers": extra_headers,
        }
        if capability_type == "embedding":
            runtime["embedding_dim"] = infer_embedding_dim(resolved_model_name, provider_name)
        return runtime

    # ── Internal ──

    def _provider_from_config(self) -> Any:
        """Build a disposable provider instance from the global config."""
        if self.config is None:
            return None
        from nanobot.providers.factory import make_provider_from_config

        provider = make_provider_from_config(
            self.config,
            temperature=0.2,
            max_tokens=min(self.config.agents.defaults.max_tokens, 2000),
        )
        return provider
