"""Domain routers for the nanobot Web UI."""

from nanobot.web.routers.agents import router as agents_router
from nanobot.web.routers.auth import router as auth_router
from nanobot.web.routers.channel_bindings import router as channel_bindings_router
from nanobot.web.routers.channels import router as channels_router
from nanobot.web.routers.chat import router as chat_router
from nanobot.web.routers.knowledge import router as knowledge_router
from nanobot.web.routers.mcp import router as mcp_router
from nanobot.web.routers.memory import router as memory_router
from nanobot.web.routers.operations import router as operations_router
from nanobot.web.routers.runs import router as runs_router
from nanobot.web.routers.schedule import router as schedule_router
from nanobot.web.routers.setup import router as setup_router
from nanobot.web.routers.teams import router as teams_router
from nanobot.web.routers.tenants import router as tenants_router
from nanobot.web.routers.workspace import router as workspace_router

__all__ = [
    "auth_router",
    "agents_router",
    "channel_bindings_router",
    "chat_router",
    "channels_router",
    "knowledge_router",
    "memory_router",
    "mcp_router",
    "operations_router",
    "runs_router",
    "schedule_router",
    "setup_router",
    "teams_router",
    "tenants_router",
    "workspace_router",
]
