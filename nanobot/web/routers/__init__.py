"""Domain routers for the nanobot Web UI."""

from nanobot.web.routers.auth import router as auth_router
from nanobot.web.routers.chat import router as chat_router
from nanobot.web.routers.channels import router as channels_router
from nanobot.web.routers.mcp import router as mcp_router
from nanobot.web.routers.operations import router as operations_router
from nanobot.web.routers.schedule import router as schedule_router
from nanobot.web.routers.setup import router as setup_router
from nanobot.web.routers.workspace import router as workspace_router

__all__ = [
    "auth_router",
    "chat_router",
    "channels_router",
    "mcp_router",
    "operations_router",
    "schedule_router",
    "setup_router",
    "workspace_router",
]
