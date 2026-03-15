"""Channel routing runtime service for binding-based message dispatch."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from loguru import logger

from nanobot.platform.channel_bindings import ChannelBindingService


@dataclass
class RoutingTarget:
    """Resolved routing target for an inbound message."""

    target_type: str  # "agent" or "team"
    target_id: str
    binding_id: str
    metadata: dict[str, Any]


class ChannelRoutingService:
    """Resolves inbound channel messages to their target agent or team.

    Uses the ChannelBindingService for database-configured routing:
    1. Exact match on (channel_name, chat_id) for the tenant
    2. Wildcard fallback on (channel_name, '*') for the tenant
    3. Returns None when no binding exists (caller decides default behavior)
    """

    def __init__(
        self,
        channel_bindings: ChannelBindingService,
    ):
        self.channel_bindings = channel_bindings

    def resolve_target(
        self,
        channel_name: str,
        chat_id: str,
        *,
        tenant_id: str = "default",
    ) -> RoutingTarget | None:
        """Resolve a routing target for the given channel and chat.

        Returns a RoutingTarget if a binding exists, None otherwise.
        The caller is responsible for dispatching to the resolved target.
        """
        binding = self.channel_bindings.resolve_binding(
            channel_name,
            chat_id,
            tenant_id=tenant_id,
        )
        if binding is None:
            return None

        logger.debug(
            "Channel routing resolved: {}:{} -> {} {} (binding={})",
            channel_name,
            chat_id,
            binding.target_type,
            binding.target_id,
            binding.binding_id,
        )

        return RoutingTarget(
            target_type=binding.target_type,
            target_id=binding.target_id,
            binding_id=binding.binding_id,
            metadata=binding.metadata,
        )
