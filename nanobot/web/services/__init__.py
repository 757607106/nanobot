"""Web-surface service objects used by the FastAPI control plane."""

from nanobot.web.services.agent_templates import AgentTemplateManager
from nanobot.web.services.auth import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    AuthAlreadyInitializedError,
    AuthAvatarNotFoundError,
    AuthInvalidCredentialsError,
    AuthNotInitializedError,
    WebAuthManager,
)
from nanobot.web.services.channel_testing import WebChannelTestService
from nanobot.web.services.mcp_registry import WebMCPRegistryManager
from nanobot.web.services.mcp_repository import MCPRepositoryService
from nanobot.web.services.mcp_servers import MCPServerService
from nanobot.web.services.operations import WebOperationsService
from nanobot.web.services.setup import WebSetupManager
from nanobot.web.services.whatsapp_binding import WebWhatsAppBindingService
from nanobot.web.services.weixin_binding import WebWeixinBindingService

__all__ = [
    "AgentTemplateManager",
    "SESSION_COOKIE_NAME",
    "SESSION_MAX_AGE_SECONDS",
    "AuthAlreadyInitializedError",
    "AuthAvatarNotFoundError",
    "AuthInvalidCredentialsError",
    "AuthNotInitializedError",
    "WebAuthManager",
    "WebChannelTestService",
    "WebMCPRegistryManager",
    "MCPRepositoryService",
    "MCPServerService",
    "WebOperationsService",
    "WebSetupManager",
    "WebWhatsAppBindingService",
    "WebWeixinBindingService",
]
