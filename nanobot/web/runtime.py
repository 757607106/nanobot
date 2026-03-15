"""Runtime state for the nanobot Web UI."""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from typing import Any

from nanobot import __version__
from nanobot.agent.loop import AgentLoop
from nanobot.bus.queue import MessageBus
from nanobot.config.loader import get_config_path
from nanobot.config.schema import Config
from nanobot.cron.service import CronService
from nanobot.platform.instances import PlatformInstance, PlatformInstanceService
from nanobot.platform.runs import RunService
from nanobot.services.agent_templates import AgentTemplateManager
from nanobot.services.calendar_reminder import CalendarReminderService
from nanobot.session.manager import SessionManager
from nanobot.storage.calendar_repository import get_calendar_repository
from nanobot.web.runtime_services import (
    WebAgentRuntimeService,
    WebChatRuntimeService,
    WebConfigRuntimeService,
    WebScheduleRuntimeService,
    WebTeamRuntimeService,
    WebWorkspaceRuntimeService,
)

DOCUMENT_DEFINITIONS: dict[str, dict[str, Any]] = {
    "AGENTS.md": {
        "label": "AGENTS.md",
        "relative_path": Path("AGENTS.md"),
        "template_segments": ("AGENTS.md",),
    },
    "SOUL.md": {
        "label": "SOUL.md",
        "relative_path": Path("SOUL.md"),
        "template_segments": ("SOUL.md",),
    },
    "USER.md": {
        "label": "USER.md",
        "relative_path": Path("USER.md"),
        "template_segments": ("USER.md",),
    },
    "TOOLS.md": {
        "label": "TOOLS.md",
        "relative_path": Path("TOOLS.md"),
        "template_segments": ("TOOLS.md",),
    },
    "HEARTBEAT.md": {
        "label": "HEARTBEAT.md",
        "relative_path": Path("HEARTBEAT.md"),
        "template_segments": ("HEARTBEAT.md",),
    },
    "memory/MEMORY.md": {
        "label": "MEMORY.md",
        "relative_path": Path("memory") / "MEMORY.md",
        "template_segments": ("memory", "MEMORY.md"),
    },
    "memory/HISTORY.md": {
        "label": "HISTORY.md",
        "relative_path": Path("memory") / "HISTORY.md",
        "template_segments": None,
    },
}


class WebAppState:
    """State holder for the Web UI server."""

    def __init__(
        self,
        config: Config,
        instance: PlatformInstance | None = None,
        runs: RunService | None = None,
    ):
        self._lock = threading.RLock()
        self.version = __version__
        self.start_time = time.time()
        self.instance = instance or PlatformInstanceService().get_default_instance(get_config_path())
        self.instance.bind()
        self.config = config
        self.runs = runs
        self.bus: MessageBus | None = None
        self.agent: AgentLoop | None = None
        self.sessions: SessionManager | None = None
        self.agent_templates: AgentTemplateManager | None = None
        self.app_agents = None
        self.app_teams = None
        self.app_knowledge = None
        self.app_memory = None
        self.calendar_repo = get_calendar_repository(config.workspace_path)

        self.agent_runtime = WebAgentRuntimeService(self)
        self.team_runtime = WebTeamRuntimeService(self)
        self.chat_runtime = WebChatRuntimeService(self)
        self.schedule_runtime = WebScheduleRuntimeService(self)
        self.workspace_runtime = WebWorkspaceRuntimeService(self, DOCUMENT_DEFINITIONS)
        self.config_runtime = WebConfigRuntimeService(self)
        self.cron = CronService(self.instance.cron_dir() / "jobs.json", on_job=self.schedule_runtime.handle_cron_job)
        self.calendar_reminders = CalendarReminderService(self.cron)
        self._cron_loop: asyncio.AbstractEventLoop | None = None
        self._cron_thread: threading.Thread | None = None
        self._cron_ready = threading.Event()

        self.config_runtime.rebuild_runtime(config)
        self.schedule_runtime.start_runtime()

    def _session_key(self, session_id: str) -> str:
        return self.chat_runtime.session_key(session_id)

    @staticmethod
    def _default_title(content: str | None = None) -> str:
        return WebChatRuntimeService.default_title(content)

    def _mcp_test_session_key(self, server_name: str) -> str:
        return self.chat_runtime.mcp_test_session_key(server_name)

    def list_sessions(self, page: int = 1, page_size: int = 20) -> dict[str, Any]:
        return self.chat_runtime.list_sessions(page, page_size)

    def create_session(self, title: str | None = None) -> dict[str, Any]:
        return self.chat_runtime.create_session(title)

    def rename_session(self, session_id: str, title: str) -> dict[str, Any]:
        return self.chat_runtime.rename_session(session_id, title)

    def delete_session(self, session_id: str) -> bool:
        return self.chat_runtime.delete_session(session_id)

    def get_messages(self, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
        return self.chat_runtime.get_messages(session_id, limit)

    def get_last_assistant_message(self, session_id: str) -> dict[str, Any] | None:
        return self.chat_runtime.get_last_assistant_message(session_id)

    def upload_chat_file(self, file_name: str, content: bytes) -> dict[str, Any]:
        return self.chat_runtime.upload_chat_file(file_name, content)

    def get_chat_workspace(self) -> dict[str, Any]:
        return self.chat_runtime.get_chat_workspace()

    def get_mcp_test_chat(self, server_name: str, limit: int = 120) -> dict[str, Any]:
        return self.chat_runtime.get_mcp_test_chat(server_name, limit)

    def clear_mcp_test_chat(self, server_name: str) -> bool:
        return self.chat_runtime.clear_mcp_test_chat(server_name)

    async def chat_with_mcp_test(
        self,
        server_name: str,
        content: str,
        on_progress,
    ) -> dict[str, Any]:
        return await self.chat_runtime.chat_with_mcp_test(server_name, content, on_progress)

    async def chat(
        self,
        session_id: str,
        content: str,
        on_progress,
    ) -> dict[str, Any]:
        return await self.chat_runtime.chat(session_id, content, on_progress)

    def get_config(self) -> dict[str, Any]:
        return self.config_runtime.get_config()

    def get_config_meta(self) -> dict[str, Any]:
        return self.config_runtime.get_config_meta()

    def update_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.config_runtime.update_config(payload)

    def get_system_status(self) -> dict[str, Any]:
        return self.config_runtime.get_system_status()

    def get_cron_status(self) -> dict[str, Any]:
        return self.schedule_runtime.get_cron_status()

    def list_cron_jobs(self, include_disabled: bool = False) -> dict[str, Any]:
        return self.schedule_runtime.list_cron_jobs(include_disabled)

    def create_cron_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.schedule_runtime.create_cron_job(payload)

    def update_cron_job(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.schedule_runtime.update_cron_job(job_id, payload)

    def delete_cron_job(self, job_id: str) -> bool:
        return self.schedule_runtime.delete_cron_job(job_id)

    def run_cron_job(self, job_id: str) -> bool:
        return self.schedule_runtime.run_cron_job(job_id)

    def get_calendar_events(
        self,
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.schedule_runtime.get_calendar_events(start_time, end_time)

    def create_calendar_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.schedule_runtime.create_calendar_event(payload)

    def update_calendar_event(self, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.schedule_runtime.update_calendar_event(event_id, payload)

    def delete_calendar_event(self, event_id: str) -> bool:
        return self.schedule_runtime.delete_calendar_event(event_id)

    def get_calendar_settings(self) -> dict[str, Any]:
        return self.schedule_runtime.get_calendar_settings()

    def update_calendar_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.schedule_runtime.update_calendar_settings(payload)

    def get_calendar_jobs(self) -> list[dict[str, Any]]:
        return self.schedule_runtime.get_calendar_jobs()

    def list_agent_templates(self) -> list[dict[str, Any]]:
        return self.workspace_runtime.list_agent_templates()

    def get_agent_template(self, name: str) -> dict[str, Any]:
        return self.workspace_runtime.get_agent_template(name)

    async def test_agent_run(self, agent_id: str, content: str) -> dict[str, Any]:
        return await self.agent_runtime.test_run_agent(agent_id, content)

    async def test_team_run(self, team_id: str, content: str) -> dict[str, Any]:
        return await self.team_runtime.start_team_run(team_id, content)

    def create_agent_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.workspace_runtime.create_agent_template(payload)

    def update_agent_template(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.workspace_runtime.update_agent_template(name, payload)

    def delete_agent_template(self, name: str) -> dict[str, Any]:
        return self.workspace_runtime.delete_agent_template(name)

    def import_agent_templates(self, content: str, on_conflict: str = "skip") -> dict[str, Any]:
        return self.workspace_runtime.import_agent_templates(content, on_conflict)

    def export_agent_templates(self, names: list[str] | None = None) -> dict[str, Any]:
        return self.workspace_runtime.export_agent_templates(names)

    def reload_agent_templates(self) -> dict[str, Any]:
        return self.workspace_runtime.reload_agent_templates()

    def get_valid_template_tools(self) -> list[dict[str, str]]:
        return self.workspace_runtime.get_valid_template_tools()

    def get_installed_skills(self) -> list[dict[str, Any]]:
        return self.workspace_runtime.get_installed_skills()

    def list_marketplace_skills(self, query: str = "", limit: int = 24) -> list[dict[str, Any]]:
        return self.workspace_runtime.list_marketplace_skills(query, limit)

    def install_marketplace_skill(self, slug: str, force: bool = False) -> dict[str, Any]:
        return self.workspace_runtime.install_marketplace_skill(slug, force)

    def upload_skill(self, files: list[tuple[str, bytes]]) -> dict[str, Any]:
        return self.workspace_runtime.upload_skill(files)

    def upload_skill_zip(self, filename: str, content: bytes) -> dict[str, Any]:
        return self.workspace_runtime.upload_skill_zip(filename, content)

    def delete_skill(self, skill_id: str) -> bool:
        return self.workspace_runtime.delete_skill(skill_id)

    def list_documents(self) -> list[dict[str, Any]]:
        return self.workspace_runtime.list_documents()

    def get_document(self, document_id: str) -> dict[str, Any]:
        return self.workspace_runtime.get_document(document_id)

    def update_document(self, document_id: str, content: str) -> dict[str, Any]:
        return self.workspace_runtime.update_document(document_id, content)

    def reset_document(self, document_id: str) -> dict[str, Any]:
        return self.workspace_runtime.reset_document(document_id)

    async def shutdown_async(self) -> None:
        self.schedule_runtime.stop_runtime()
        await self.team_runtime.shutdown_async()
        if self.agent is not None:
            await self.agent.close_mcp()


__all__ = [
    "DOCUMENT_DEFINITIONS",
    "WebAppState",
]
