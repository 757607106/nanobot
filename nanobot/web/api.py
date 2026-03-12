"""FastAPI-based HTTP API and static file server for the nanobot Web UI."""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import platform
import re
import shutil
import threading
import time
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from importlib.resources import files as pkg_files
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import uvicorn
from fastapi import Body, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from loguru import logger
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from nanobot import __version__
from nanobot.agent.loop import AgentLoop
from nanobot.agent.tools.cron import CronTool
from nanobot.bus.queue import MessageBus
from nanobot.config.loader import get_config_path, save_config
from nanobot.config.paths import get_cron_dir
from nanobot.config.schema import Config
from nanobot.cron.service import CronService
from nanobot.cron.types import CronJob, CronPayload, CronSchedule
from nanobot.providers.base import GenerationSettings
from nanobot.providers.custom_provider import CustomProvider
from nanobot.providers.litellm_provider import LiteLLMProvider
from nanobot.services.agent_templates import AgentTemplateManager
from nanobot.providers.openai_codex_provider import OpenAICodexProvider
from nanobot.services.calendar_reminder import CalendarReminderService
from nanobot.session.manager import Session, SessionManager
from nanobot.storage.calendar_repository import get_calendar_repository
from nanobot.utils.helpers import sync_workspace_templates


def _ok(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data, "error": None}


def _err(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {
        "success": False,
        "data": None,
        "error": {"code": code, "message": message, "details": details},
    }


def _json_response(status_code: int, payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=payload)


def _resolve_static_dir() -> Path | None:
    possible_static_dirs = [
        Path(__file__).resolve().parent.parent.parent / "web-ui" / "dist",
        Path(__file__).resolve().parent / "static",
    ]
    return next((path for path in possible_static_dirs if path.exists()), None)


def _frontend_missing_response() -> HTMLResponse:
    return HTMLResponse(
        (
            "<html><body><h1>nanobot Web UI</h1>"
            "<p>Frontend has not been built yet. "
            "Run <code>cd web-ui && npm install && npm run build</code>.</p>"
            "</body></html>"
        ),
        status_code=200,
    )


def _static_response(static_dir: Path | None, path: str) -> HTMLResponse | FileResponse:
    if not static_dir or not static_dir.exists():
        return _frontend_missing_response()

    relative = path.lstrip("/") or "index.html"
    root = static_dir.resolve()
    target = (root / relative).resolve()
    if not target.exists() or not target.is_file() or not target.is_relative_to(root):
        target = root / "index.html"

    if not target.exists():
        return _frontend_missing_response()

    return FileResponse(target)


def _encode_sse(payload: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


class APIError(Exception):
    """Structured API error that keeps the existing response envelope."""

    def __init__(self, status_code: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


class SessionCreateRequest(BaseModel):
    title: str | None = None


class SessionRenameRequest(BaseModel):
    title: str | None = None


class ChatMessageRequest(BaseModel):
    content: str | None = None


class CronJobMutationRequest(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    triggerType: Literal["at", "every", "cron"] | None = None
    triggerDateMs: int | None = None
    triggerIntervalSeconds: int | None = None
    triggerCronExpr: str | None = None
    triggerTz: str | None = None
    payloadKind: str | None = None
    payloadMessage: str | None = None
    payloadDeliver: bool | None = None
    payloadChannel: str | None = None
    payloadTo: str | None = None
    deleteAfterRun: bool | None = None


class CalendarSettingsUpdateRequest(BaseModel):
    defaultView: Literal["dayGridMonth", "timeGridWeek", "timeGridDay", "listWeek"] | None = None
    defaultPriority: Literal["high", "medium", "low"] | None = None
    soundEnabled: bool | None = None
    notificationEnabled: bool | None = None


class AgentTemplateMutationRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    tools: list[str] | None = None
    rules: list[str] | None = None
    system_prompt: str | None = None
    skills: list[str] | None = None
    model: str | None = None
    backend: str | None = None
    enabled: bool | None = None


class AgentTemplateImportRequest(BaseModel):
    content: str
    on_conflict: Literal["skip", "replace", "rename"] = "skip"


class AgentTemplateExportRequest(BaseModel):
    names: list[str] | None = None


class WebAppState:
    """State holder for the Web UI server."""

    def __init__(self, config: Config):
        self._lock = threading.RLock()
        self.start_time = time.time()
        self.config = config
        self.bus: MessageBus | None = None
        self.agent: AgentLoop | None = None
        self.sessions: SessionManager | None = None
        self.agent_templates: AgentTemplateManager | None = None
        self.calendar_repo = get_calendar_repository(config.workspace_path)
        self.cron = CronService(get_cron_dir() / "jobs.json", on_job=self._on_cron_job)
        self.calendar_reminders = CalendarReminderService(self.cron)
        self._cron_loop: asyncio.AbstractEventLoop | None = None
        self._cron_thread: threading.Thread | None = None
        self._cron_ready = threading.Event()
        self._rebuild(config)
        self._start_cron_runtime()

    def _make_provider(self, config: Config):
        model = config.agents.defaults.model
        provider_name = config.get_provider_name(model)
        provider_cfg = config.get_provider(model)

        if provider_name == "openai_codex" or model.startswith("openai-codex/"):
            provider = OpenAICodexProvider(default_model=model)
        elif provider_name == "custom":
            provider = CustomProvider(
                api_key=(provider_cfg.api_key if provider_cfg and provider_cfg.api_key else "no-key"),
                api_base=config.get_api_base(model) or "http://localhost:8000/v1",
                default_model=model,
            )
        elif provider_name == "azure_openai":
            # Web UI should still be able to start even when Azure config is incomplete.
            if provider_cfg and provider_cfg.api_key and provider_cfg.api_base:
                from nanobot.providers.azure_openai_provider import AzureOpenAIProvider

                provider = AzureOpenAIProvider(
                    api_key=provider_cfg.api_key,
                    api_base=provider_cfg.api_base,
                    default_model=model,
                )
            else:
                provider = LiteLLMProvider(
                    api_key=None,
                    api_base=None,
                    default_model=model,
                    provider_name=provider_name,
                )
        else:
            provider = LiteLLMProvider(
                api_key=provider_cfg.api_key if provider_cfg and provider_cfg.api_key else None,
                api_base=config.get_api_base(model),
                default_model=model,
                extra_headers=provider_cfg.extra_headers if provider_cfg else None,
                provider_name=provider_name,
            )

        defaults = config.agents.defaults
        provider.generation = GenerationSettings(
            temperature=defaults.temperature,
            max_tokens=defaults.max_tokens,
            reasoning_effort=defaults.reasoning_effort,
        )
        return provider

    def _rebuild(self, config: Config) -> None:
        sync_workspace_templates(config.workspace_path)
        self.calendar_repo = get_calendar_repository(config.workspace_path)
        bus = MessageBus()
        sessions = SessionManager(config.workspace_path)
        agent = AgentLoop(
            bus=bus,
            provider=self._make_provider(config),
            workspace=config.workspace_path,
            model=config.agents.defaults.model,
            max_iterations=config.agents.defaults.max_tool_iterations,
            context_window_tokens=config.agents.defaults.context_window_tokens,
            brave_api_key=config.tools.web.search.api_key or None,
            web_proxy=config.tools.web.proxy or None,
            exec_config=config.tools.exec,
            cron_service=self.cron,
            restrict_to_workspace=config.tools.restrict_to_workspace,
            session_manager=sessions,
            mcp_servers=config.tools.mcp_servers,
            channels_config=config.channels,
        )
        self.config = config
        self.bus = bus
        self.sessions = sessions
        self.agent = agent
        self.agent_templates = AgentTemplateManager(
            config.workspace_path,
            tool_catalog_provider=self._get_template_tool_catalog,
        )

    def _start_cron_runtime(self) -> None:
        if self._cron_thread and self._cron_thread.is_alive():
            return

        loop = asyncio.new_event_loop()
        self._cron_loop = loop
        self._cron_ready.clear()

        def runner() -> None:
            asyncio.set_event_loop(loop)
            self._cron_ready.set()
            try:
                loop.run_forever()
            finally:
                pending = [task for task in asyncio.all_tasks(loop) if not task.done()]
                for task in pending:
                    task.cancel()
                if pending:
                    loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                loop.close()

        self._cron_thread = threading.Thread(
            target=runner,
            name="nanobot-web-cron",
            daemon=True,
        )
        self._cron_thread.start()
        if not self._cron_ready.wait(timeout=5):
            raise RuntimeError("Failed to start cron runtime.")
        self._run_cron_coro(self.cron.start())

    def _call_cron(self, func, *args, **kwargs):
        if self._cron_loop is None:
            raise RuntimeError("Cron runtime is not available.")
        if threading.current_thread() is self._cron_thread:
            return func(*args, **kwargs)

        future: concurrent.futures.Future[Any] = concurrent.futures.Future()

        def runner() -> None:
            try:
                future.set_result(func(*args, **kwargs))
            except Exception as exc:  # noqa: BLE001
                future.set_exception(exc)

        self._cron_loop.call_soon_threadsafe(runner)
        return future.result()

    def _run_cron_coro(self, coro):
        if self._cron_loop is None:
            raise RuntimeError("Cron runtime is not available.")
        return asyncio.run_coroutine_threadsafe(coro, self._cron_loop).result()

    def _stop_cron_runtime(self) -> None:
        loop = self._cron_loop
        thread = self._cron_thread
        if loop is None:
            return

        try:
            self._call_cron(self.cron.stop)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to stop cron service cleanly")

        loop.call_soon_threadsafe(loop.stop)
        if thread and thread.is_alive():
            thread.join(timeout=5)

        self._cron_loop = None
        self._cron_thread = None

    async def _on_cron_job(self, job: CronJob) -> str | None:
        if self.agent is None:
            raise RuntimeError("Agent is not available.")

        if job.payload.kind == "calendar_reminder":
            return self._write_calendar_reminder(job)

        reminder_note = (
            "[Scheduled Task] Timer finished.\n\n"
            f"Task '{job.name}' has been triggered.\n"
            f"Scheduled instruction: {job.payload.message}"
        )

        channel = job.payload.channel or "web"
        chat_id = job.payload.to or job.id
        session_key = f"cron:{job.id}"

        # Allow web-targeted jobs to append directly into an existing web session.
        if channel == "web" and job.payload.to and self.sessions is not None:
            session_key = self._session_key(job.payload.to)
            session = self.sessions.get_or_create(session_key)
            if not session.metadata.get("title"):
                session.metadata["title"] = job.name
                self.sessions.save(session)

        cron_tool = self.agent.tools.get("cron")
        cron_token = None
        if isinstance(cron_tool, CronTool):
            cron_token = cron_tool.set_cron_context(True)
        try:
            return await self.agent.process_direct(
                reminder_note,
                session_key=session_key,
                channel=channel,
                chat_id=chat_id,
            )
        finally:
            if isinstance(cron_tool, CronTool) and cron_token is not None:
                cron_tool.reset_cron_context(cron_token)

    def _write_calendar_reminder(self, job: CronJob) -> str:
        if self.sessions is None:
            raise RuntimeError("Session manager is not available.")

        session_id = job.payload.to or CalendarReminderService.default_session_id
        session = self.sessions.get_or_create(self._session_key(session_id))
        if not session.metadata.get("title"):
            session.metadata["title"] = "Calendar Reminders"
        session.add_message("assistant", job.payload.message, name="calendar_reminder")
        self.sessions.save(session)
        return job.payload.message

    def _session_key(self, session_id: str) -> str:
        return f"web:{session_id}"

    def _get_template_tool_catalog(self) -> list[dict[str, str]]:
        if self.agent is None:
            return []
        catalog: list[dict[str, str]] = []
        for name in self.agent.tools.tool_names:
            tool = self.agent.tools.get(name)
            if tool is None:
                continue
            catalog.append({"name": name, "description": tool.description})
        return catalog

    def _require_session(self, session_id: str) -> Session:
        session = self.sessions.get(self._session_key(session_id)) if self.sessions else None
        if session is None:
            raise KeyError(session_id)
        return session

    @staticmethod
    def _default_title(content: str | None = None) -> str:
        if content:
            cleaned = " ".join(content.strip().split())
            if cleaned:
                return cleaned[:40]
        return "New Chat"

    @staticmethod
    def _format_session_summary(item: dict[str, Any]) -> dict[str, Any]:
        key = item["key"]
        session_id = key.split(":", 1)[1] if ":" in key else key
        title = item.get("title") or WebAppState._default_title()
        return {
            "id": session_id,
            "sessionId": session_id,
            "title": title,
            "createdAt": item.get("created_at"),
            "updatedAt": item.get("updated_at"),
            "messageCount": item.get("message_count", 0),
        }

    @staticmethod
    def _format_message(sequence: int, session_id: str, message: dict[str, Any]) -> dict[str, Any]:
        payload = {
            "id": f"msg_{sequence}",
            "sessionId": session_id,
            "sequence": sequence,
            "role": message.get("role", "assistant"),
            "content": message.get("content", ""),
            "createdAt": message.get("timestamp"),
        }
        if message.get("tool_calls"):
            payload["toolCalls"] = message["tool_calls"]
        if message.get("tool_call_id"):
            payload["toolCallId"] = message["tool_call_id"]
        if message.get("name"):
            payload["name"] = message["name"]
        return payload

    @staticmethod
    def _format_cron_job(job: CronJob) -> dict[str, Any]:
        interval_seconds = None
        if job.schedule.every_ms is not None:
            interval_seconds = job.schedule.every_ms // 1000

        return {
            "id": job.id,
            "name": job.name,
            "enabled": job.enabled,
            "source": job.source,
            "trigger": {
                "type": job.schedule.kind,
                "dateMs": job.schedule.at_ms,
                "intervalSeconds": interval_seconds,
                "cronExpr": job.schedule.expr,
                "tz": job.schedule.tz,
            },
            "payload": {
                "kind": job.payload.kind,
                "message": job.payload.message,
                "deliver": job.payload.deliver,
                "channel": job.payload.channel,
                "to": job.payload.to,
            },
            "nextRunAtMs": job.state.next_run_at_ms,
            "lastRunAtMs": job.state.last_run_at_ms,
            "lastStatus": job.state.last_status,
            "lastError": job.state.last_error,
            "deleteAfterRun": job.delete_after_run,
            "createdAtMs": job.created_at_ms,
            "updatedAtMs": job.updated_at_ms,
        }

    @staticmethod
    def _parse_datetime(value: str) -> datetime:
        raw = value.strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(raw)
        except ValueError as exc:
            raise ValueError(f"Invalid datetime value '{value}'. Expected ISO format.") from exc

    @staticmethod
    def _format_calendar_event(event: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": event["id"],
            "title": event["title"],
            "description": event.get("description") or "",
            "start": event["start_time"],
            "end": event["end_time"],
            "isAllDay": bool(event.get("is_all_day", False)),
            "priority": event.get("priority", "medium"),
            "reminders": event.get("reminders") or [],
            "recurrence": event.get("recurrence"),
            "recurrenceId": event.get("recurrence_id"),
            "createdAt": event.get("created_at"),
            "updatedAt": event.get("updated_at"),
        }

    @staticmethod
    def _format_calendar_settings(settings: dict[str, Any]) -> dict[str, Any]:
        return {
            "defaultView": settings.get("default_view", "dayGridMonth"),
            "defaultPriority": settings.get("default_priority", "medium"),
            "soundEnabled": bool(settings.get("sound_enabled", True)),
            "notificationEnabled": bool(settings.get("notification_enabled", True)),
        }

    @staticmethod
    def _format_agent_template(template) -> dict[str, Any]:
        return {
            "name": template.name,
            "description": template.description,
            "tools": template.tools,
            "rules": template.rules,
            "system_prompt": template.system_prompt,
            "skills": template.skills,
            "model": template.model,
            "backend": template.backend,
            "source": template.source,
            "is_builtin": template.is_builtin,
            "is_editable": template.is_editable,
            "is_deletable": template.is_deletable,
            "enabled": template.enabled,
            "created_at": template.created_at,
            "updated_at": template.updated_at,
        }

    def _normalize_calendar_event_payload(
        self,
        payload: dict[str, Any],
        existing: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        title = payload.get("title")
        if title is None and existing is not None:
            title = existing["title"]
        title = str(title or "").strip()
        if not title:
            raise ValueError("title is required.")

        start_time = payload.get("start")
        if start_time is None and existing is not None:
            start_time = existing["start_time"]
        if not start_time:
            raise ValueError("start is required.")

        end_time = payload.get("end")
        if end_time is None and existing is not None:
            end_time = existing["end_time"]
        if not end_time:
            raise ValueError("end is required.")

        start_dt = self._parse_datetime(str(start_time))
        end_dt = self._parse_datetime(str(end_time))
        if end_dt <= start_dt:
            raise ValueError("end must be later than start.")

        description = payload.get("description")
        if description is None and existing is not None:
            description = existing.get("description", "")

        is_all_day = payload.get("isAllDay")
        if is_all_day is None and existing is not None:
            is_all_day = existing.get("is_all_day", False)

        priority = payload.get("priority")
        if priority is None and existing is not None:
            priority = existing.get("priority", "medium")
        priority = str(priority or "medium")
        if priority not in {"high", "medium", "low"}:
            raise ValueError("priority must be one of: high, medium, low.")

        reminders = payload.get("reminders")
        if reminders is None and existing is not None:
            reminders = existing.get("reminders") or []

        recurrence = payload.get("recurrence")
        if recurrence is None and existing is not None:
            recurrence = existing.get("recurrence")

        recurrence_id = payload.get("recurrenceId")
        if recurrence_id is None and existing is not None:
            recurrence_id = existing.get("recurrence_id")

        normalized = {
            "title": title,
            "description": str(description or ""),
            "start_time": str(start_time),
            "end_time": str(end_time),
            "is_all_day": bool(is_all_day),
            "priority": priority,
            "reminders": reminders or [],
            "recurrence": recurrence,
            "recurrence_id": recurrence_id,
        }
        event_id = payload.get("id")
        if event_id:
            normalized["id"] = str(event_id)
        return normalized

    @staticmethod
    def _build_cron_schedule(
        payload: dict[str, Any],
        existing: CronSchedule | None = None,
    ) -> CronSchedule:
        trigger_type = payload.get("triggerType") or (existing.kind if existing else None)
        if trigger_type not in {"at", "every", "cron"}:
            raise ValueError("triggerType must be one of: at, every, cron.")

        if trigger_type == "at":
            date_ms = payload.get("triggerDateMs")
            if date_ms is None:
                date_ms = existing.at_ms if existing and existing.kind == "at" else None
            if date_ms is None:
                raise ValueError("triggerDateMs is required for one-time jobs.")
            return CronSchedule(kind="at", at_ms=int(date_ms))

        if trigger_type == "every":
            interval_seconds = payload.get("triggerIntervalSeconds")
            if interval_seconds is None and existing and existing.kind == "every":
                every_ms = existing.every_ms
            elif interval_seconds is None:
                every_ms = None
            else:
                every_ms = int(interval_seconds) * 1000
            if every_ms is None or every_ms <= 0:
                raise ValueError("triggerIntervalSeconds must be greater than 0.")
            return CronSchedule(kind="every", every_ms=every_ms)

        cron_expr = payload.get("triggerCronExpr")
        if cron_expr is None and existing and existing.kind == "cron":
            cron_expr = existing.expr
        cron_expr = str(cron_expr or "").strip()
        if not cron_expr:
            raise ValueError("triggerCronExpr is required for cron jobs.")

        timezone = payload.get("triggerTz")
        if timezone is None and existing and existing.kind == "cron":
            timezone = existing.tz
        timezone = str(timezone).strip() if timezone else None
        return CronSchedule(kind="cron", expr=cron_expr, tz=timezone)

    @staticmethod
    def _build_cron_payload(
        payload: dict[str, Any],
        existing: CronPayload | None = None,
    ) -> CronPayload:
        payload_kind = payload.get("payloadKind") or (existing.kind if existing else "agent_turn")
        if payload_kind != "agent_turn":
            raise ValueError("Only agent_turn payloads are supported by the Web UI.")

        message = payload.get("payloadMessage")
        if message is None:
            message = existing.message if existing else ""
        message = str(message).strip()
        if not message:
            raise ValueError("payloadMessage is required.")

        deliver = payload.get("payloadDeliver")
        if deliver is None:
            deliver = existing.deliver if existing else False

        channel = payload.get("payloadChannel")
        if channel is None:
            channel = existing.channel if existing else None
        channel = str(channel).strip() if channel else None

        target = payload.get("payloadTo")
        if target is None:
            target = existing.to if existing else None
        target = str(target).strip() if target else None

        return CronPayload(
            kind="agent_turn",
            message=message,
            deliver=bool(deliver),
            channel=channel,
            to=target,
        )

    def _create_cron_job_in_loop(self, payload: dict[str, Any]) -> dict[str, Any]:
        schedule = self._build_cron_schedule(payload)
        cron_payload = self._build_cron_payload(payload)
        name = str(payload.get("name") or "").strip() or cron_payload.message[:40]
        if not name:
            raise ValueError("name is required.")

        delete_after_run = payload.get("deleteAfterRun")
        if delete_after_run is None:
            delete_after_run = schedule.kind == "at"

        job = self.cron.add_job(
            name=name,
            schedule=schedule,
            message=cron_payload.message,
            deliver=cron_payload.deliver,
            channel=cron_payload.channel,
            to=cron_payload.to,
            delete_after_run=bool(delete_after_run),
        )
        return self._format_cron_job(job)

    def _update_cron_job_in_loop(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.cron.get_job(job_id)
        if existing is None:
            raise KeyError(job_id)

        schedule = self._build_cron_schedule(payload, existing.schedule)
        cron_payload = self._build_cron_payload(payload, existing.payload)
        name = str(payload.get("name") or existing.name).strip()
        if not name:
            raise ValueError("name is required.")

        delete_after_run = payload.get("deleteAfterRun")
        if delete_after_run is None:
            delete_after_run = existing.delete_after_run

        enabled = payload.get("enabled")
        if enabled is None:
            enabled = existing.enabled

        updated = self.cron.update_job(
            job_id,
            name=name,
            enabled=bool(enabled),
            schedule=schedule,
            payload=cron_payload,
            delete_after_run=bool(delete_after_run),
        )
        if updated is None:
            raise KeyError(job_id)
        return self._format_cron_job(updated)

    def list_sessions(self, page: int = 1, page_size: int = 20) -> dict[str, Any]:
        items = [
            session
            for session in (self.sessions.list_sessions() if self.sessions else [])
            if session.get("key", "").startswith("web:")
        ]
        total = len(items)
        start = max(0, (page - 1) * page_size)
        end = start + page_size
        return {
            "items": [self._format_session_summary(item) for item in items[start:end]],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }

    def create_session(self, title: str | None = None) -> dict[str, Any]:
        session_id = uuid4().hex
        session = self.sessions.get_or_create(self._session_key(session_id))
        session.metadata["title"] = title or self._default_title()
        self.sessions.save(session)
        return self._format_session_summary(
            {
                "key": session.key,
                "created_at": session.created_at.isoformat(),
                "updated_at": session.updated_at.isoformat(),
                "message_count": len(session.messages),
                "title": session.metadata.get("title"),
            }
        )

    def rename_session(self, session_id: str, title: str) -> dict[str, Any]:
        session = self.sessions.update_metadata(self._session_key(session_id), title=title)
        return self._format_session_summary(
            {
                "key": session.key,
                "created_at": session.created_at.isoformat(),
                "updated_at": session.updated_at.isoformat(),
                "message_count": len(session.messages),
                "title": session.metadata.get("title"),
            }
        )

    def delete_session(self, session_id: str) -> bool:
        return self.sessions.delete(self._session_key(session_id))

    def get_messages(self, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
        session = self._require_session(session_id)
        messages = session.messages[-limit:]
        start_sequence = len(session.messages) - len(messages) + 1
        return [
            self._format_message(start_sequence + index, session_id, message)
            for index, message in enumerate(messages)
        ]

    def get_last_assistant_message(self, session_id: str) -> dict[str, Any] | None:
        session = self._require_session(session_id)
        for index in range(len(session.messages) - 1, -1, -1):
            message = session.messages[index]
            if message.get("role") == "assistant":
                return self._format_message(index + 1, session_id, message)
        return None

    async def chat(
        self,
        session_id: str,
        content: str,
        on_progress,
    ) -> dict[str, Any]:
        key = self._session_key(session_id)
        session = self.sessions.get_or_create(key)
        if not session.metadata.get("title"):
            session.metadata["title"] = self._default_title(content)
            self.sessions.save(session)
        response = await self.agent.process_direct(
            content=content,
            session_key=key,
            channel="web",
            chat_id=session_id,
            on_progress=on_progress,
        )
        return {
            "content": response,
            "assistantMessage": self.get_last_assistant_message(session_id),
        }

    def get_config(self) -> dict[str, Any]:
        return self.config.model_dump(mode="json", by_alias=True)

    def update_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        config = Config.model_validate(payload)
        save_config(config)
        old_agent = self.agent
        if old_agent is not None:
            asyncio.run(old_agent.close_mcp())
        self._rebuild(config)
        return self.get_config()

    def get_system_status(self) -> dict[str, Any]:
        sessions = self.sessions.list_sessions() if self.sessions else []
        web_sessions = [s for s in sessions if s.get("key", "").startswith("web:")]
        cron_status = self.get_cron_status()
        channels_data = self.config.channels.model_dump(mode="json", by_alias=True)
        enabled_channels = [
            name
            for name, value in channels_data.items()
            if isinstance(value, dict) and value.get("enabled")
        ]
        return {
            "web": {
                "version": __version__,
                "uptime": round(time.time() - self.start_time, 2),
                "workspace": str(self.config.workspace_path),
                "configPath": str(get_config_path()),
                "model": self.config.agents.defaults.model,
                "provider": self.config.get_provider_name(self.config.agents.defaults.model) or "auto",
            },
            "stats": {
                "totalSessions": len(sessions),
                "webSessions": len(web_sessions),
                "messages": sum(item.get("message_count", 0) for item in web_sessions),
                "enabledChannels": enabled_channels,
                "enabledChannelCount": len(enabled_channels),
                "scheduledJobs": cron_status["jobs"],
            },
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
            },
            "cron": cron_status,
        }

    def get_cron_status(self) -> dict[str, Any]:
        status = self._call_cron(self.cron.status)
        return {
            "enabled": status["enabled"],
            "jobs": status["jobs"],
            "nextWakeAtMs": status["next_wake_at_ms"],
            "deliveryMode": "agent_only",
        }

    def list_cron_jobs(self, include_disabled: bool = False) -> dict[str, Any]:
        return self._call_cron(
            lambda: {
                "jobs": [
                    self._format_cron_job(job)
                    for job in self.cron.list_jobs(include_disabled=include_disabled)
                ]
            }
        )

    def create_cron_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._call_cron(self._create_cron_job_in_loop, payload)

    def update_cron_job(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._call_cron(self._update_cron_job_in_loop, job_id, payload)

    def delete_cron_job(self, job_id: str) -> bool:
        return self._call_cron(self.cron.remove_job, job_id)

    def run_cron_job(self, job_id: str) -> bool:
        return self._run_cron_coro(self.cron.run_job(job_id, force=True))

    def get_calendar_events(
        self,
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> list[dict[str, Any]]:
        events = self.calendar_repo.get_events(start_time=start_time, end_time=end_time)
        return [self._format_calendar_event(event) for event in events]

    def create_calendar_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = self._normalize_calendar_event_payload(payload)
        event = self.calendar_repo.create_event(normalized)
        self._call_cron(self.calendar_reminders.create_reminder_jobs, event)
        return self._format_calendar_event(event)

    def update_calendar_event(self, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.calendar_repo.get_event(event_id)
        if existing is None:
            raise KeyError(event_id)
        normalized = self._normalize_calendar_event_payload(payload, existing)
        updated = self.calendar_repo.update_event(event_id, normalized)
        if updated is None:
            raise KeyError(event_id)
        self._call_cron(self.calendar_reminders.update_reminder_jobs, updated)
        return self._format_calendar_event(updated)

    def delete_calendar_event(self, event_id: str) -> bool:
        self._call_cron(self.calendar_reminders.delete_reminder_jobs, event_id)
        return self.calendar_repo.delete_event(event_id)

    def get_calendar_settings(self) -> dict[str, Any]:
        return self._format_calendar_settings(self.calendar_repo.get_settings())

    def update_calendar_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        settings = {
            "default_view": payload.get("defaultView"),
            "default_priority": payload.get("defaultPriority"),
            "sound_enabled": payload.get("soundEnabled"),
            "notification_enabled": payload.get("notificationEnabled"),
        }
        cleaned = {key: value for key, value in settings.items() if value is not None}
        if cleaned.get("default_view") and cleaned["default_view"] not in {
            "dayGridMonth",
            "timeGridWeek",
            "timeGridDay",
            "listWeek",
        }:
            raise ValueError("defaultView is invalid.")
        if cleaned.get("default_priority") and cleaned["default_priority"] not in {
            "high",
            "medium",
            "low",
        }:
            raise ValueError("defaultPriority is invalid.")
        updated = self.calendar_repo.update_settings(cleaned)
        return self._format_calendar_settings(updated)

    def get_calendar_jobs(self) -> list[dict[str, Any]]:
        jobs = self._call_cron(self.calendar_reminders.get_calendar_jobs)
        return [self._format_cron_job(job) for job in jobs]

    def list_agent_templates(self) -> list[dict[str, Any]]:
        if self.agent_templates is None:
            return []
        return [
            self._format_agent_template(template)
            for template in self.agent_templates.list_templates()
        ]

    def get_agent_template(self, name: str) -> dict[str, Any]:
        if self.agent_templates is None:
            raise KeyError(name)
        template = self.agent_templates.get_template(name)
        if template is None:
            raise KeyError(name)
        return self._format_agent_template(template)

    def create_agent_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        created = self.agent_templates.create_template(payload)
        return {"name": created.name, "success": True}

    def update_agent_template(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        updated = self.agent_templates.update_template(name, payload)
        if updated is None:
            raise KeyError(name)
        return {"name": updated.name, "success": True}

    def delete_agent_template(self, name: str) -> dict[str, Any]:
        if self.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        deleted = self.agent_templates.delete_template(name)
        if not deleted:
            raise KeyError(name)
        return {"name": name, "success": True}

    def import_agent_templates(self, content: str, on_conflict: str = "skip") -> dict[str, Any]:
        if self.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        return self.agent_templates.import_from_yaml(content, on_conflict)

    def export_agent_templates(self, names: list[str] | None = None) -> dict[str, Any]:
        if self.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        return {"content": self.agent_templates.export_to_yaml(names)}

    def reload_agent_templates(self) -> dict[str, Any]:
        if self.agent_templates is None:
            raise RuntimeError("Template manager is not available.")
        return {"success": self.agent_templates.reload()}

    def get_valid_template_tools(self) -> list[dict[str, str]]:
        if self.agent_templates is None:
            return []
        return self.agent_templates.get_valid_tools()

    def get_installed_skills(self) -> list[dict[str, Any]]:
        if self.agent_templates is None:
            return []
        return self.agent_templates.list_installed_skills()

    def upload_skill(self, files: list[tuple[str, bytes]]) -> dict[str, Any]:
        workspace_skills = self.config.workspace_path / "skills"
        workspace_skills.mkdir(parents=True, exist_ok=True)

        if not files:
            raise ValueError("No skill files were uploaded.")

        def safe_skill_name(name: str) -> bool:
            return bool(re.fullmatch(r"[A-Za-z0-9_-]+", name))

        def safe_rel_path(rel_path: str) -> bool:
            normalized = rel_path.replace("\\", "/").strip()
            return bool(normalized) and ".." not in normalized and not Path(normalized).is_absolute()

        skill_name: str | None = None
        has_skill_md = False

        for rel_path, content in files:
            normalized = rel_path.replace("\\", "/").strip()
            if not safe_rel_path(normalized):
                continue

            parts = [part for part in normalized.split("/") if part]
            if len(parts) < 2:
                continue

            current_skill_name = parts[0]
            if not safe_skill_name(current_skill_name):
                raise ValueError(f"Invalid skill name: {current_skill_name}")

            if skill_name is None:
                skill_name = current_skill_name
            elif skill_name != current_skill_name:
                raise ValueError("Uploaded files must belong to a single skill folder.")

            relative_inside_skill = Path(*parts[1:])
            destination = workspace_skills / current_skill_name / relative_inside_skill
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)

            if relative_inside_skill.as_posix() == "SKILL.md":
                has_skill_md = True

        if not skill_name:
            raise ValueError("Could not determine the uploaded skill name.")

        skill_root = workspace_skills / skill_name
        if not has_skill_md and not (skill_root / "SKILL.md").exists():
            shutil.rmtree(skill_root, ignore_errors=True)
            raise ValueError("A skill folder must include SKILL.md.")

        installed = self.get_installed_skills()
        matched = next((item for item in installed if item["id"] == skill_name), None)
        if matched is None:
            raise RuntimeError(f"Uploaded skill '{skill_name}' could not be loaded.")
        return matched

    def delete_skill(self, skill_id: str) -> bool:
        safe_id = str(skill_id or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]+", safe_id):
            raise ValueError("Invalid skill id.")

        workspace_skill = self.config.workspace_path / "skills" / safe_id
        if workspace_skill.is_dir():
            shutil.rmtree(workspace_skill)
            return True

        builtin_skill = Path(__file__).resolve().parent.parent / "skills" / safe_id
        if builtin_skill.is_dir():
            raise ValueError("Built-in skills cannot be deleted from the Web UI.")

        raise KeyError(skill_id)

    def _main_prompt_path(self) -> Path:
        return self.config.workspace_path / "AGENTS.md"

    def _default_main_prompt(self) -> str:
        template = pkg_files("nanobot") / "templates" / "AGENTS.md"
        return template.read_text(encoding="utf-8")

    def get_main_agent_prompt(self) -> dict[str, Any]:
        prompt_path = self._main_prompt_path()
        if prompt_path.exists():
            content = prompt_path.read_text(encoding="utf-8")
            updated_at = datetime.fromtimestamp(prompt_path.stat().st_mtime).isoformat()
        else:
            content = self._default_main_prompt()
            updated_at = ""
        return {
            "identity_content": content,
            "updated_at": updated_at,
            "source_path": str(prompt_path),
        }

    def update_main_agent_prompt(self, identity_content: str) -> dict[str, Any]:
        prompt_path = self._main_prompt_path()
        prompt_path.parent.mkdir(parents=True, exist_ok=True)
        prompt_path.write_text(identity_content, encoding="utf-8")
        return self.get_main_agent_prompt()

    def reset_main_agent_prompt(self) -> dict[str, Any]:
        prompt_path = self._main_prompt_path()
        prompt_path.parent.mkdir(parents=True, exist_ok=True)
        prompt_path.write_text(self._default_main_prompt(), encoding="utf-8")
        return {"success": True}

    async def shutdown_async(self) -> None:
        self._stop_cron_runtime()
        if self.agent is not None:
            await self.agent.close_mcp()


def create_app(config: Config, static_dir: Path | None = None) -> FastAPI:
    """Create the FastAPI app for the Web UI."""
    resolved_static_dir = static_dir or _resolve_static_dir()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.web = WebAppState(config)
        app.state.static_dir = resolved_static_dir
        try:
            yield
        finally:
            await app.state.web.shutdown_async()

    app = FastAPI(title="nanobot Web UI", version=__version__, lifespan=lifespan)

    @app.exception_handler(APIError)
    async def handle_api_error(_request: Request, exc: APIError) -> JSONResponse:
        return _json_response(exc.status_code, _err(exc.code, exc.message, exc.details))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _json_response(
            422,
            _err("VALIDATION_ERROR", "Request validation failed.", exc.errors()),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return _json_response(404, _err("NOT_FOUND", "Endpoint not found."))
        return _json_response(
            exc.status_code,
            _err("HTTP_ERROR", str(exc.detail or "Request failed."), exc.detail),
        )

    @app.get("/api/v1/health")
    def get_health() -> JSONResponse:
        return _json_response(200, _ok({"status": "ok"}))

    @app.get("/api/v1/config")
    def get_config(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_config()))

    @app.put("/api/v1/config")
    def update_config(
        request: Request,
        payload: dict[str, Any] = Body(default_factory=dict),
    ) -> JSONResponse:
        try:
            data = request.app.state.web.update_config(payload)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Config update failed")
            raise APIError(400, "CONFIG_UPDATE_FAILED", str(exc)) from exc
        return _json_response(200, _ok(data))

    @app.get("/api/v1/system/status")
    def get_system_status(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_system_status()))

    @app.get("/api/v1/cron/status")
    def get_cron_status(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_cron_status()))

    @app.get("/api/v1/cron/jobs")
    def get_cron_jobs(
        request: Request,
        include_disabled: bool = Query(False, alias="includeDisabled"),
    ) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.list_cron_jobs(include_disabled)))

    @app.post("/api/v1/cron/jobs")
    def create_cron_job(request: Request, payload: CronJobMutationRequest) -> JSONResponse:
        try:
            data = request.app.state.web.create_cron_job(payload.model_dump())
        except ValueError as exc:
            raise APIError(400, "CRON_VALIDATION_ERROR", str(exc)) from exc
        return _json_response(201, _ok(data))

    @app.patch("/api/v1/cron/jobs/{job_id}")
    def update_cron_job(
        request: Request,
        job_id: str,
        payload: CronJobMutationRequest,
    ) -> JSONResponse:
        try:
            data = request.app.state.web.update_cron_job(job_id, payload.model_dump())
        except KeyError as exc:
            raise APIError(404, "CRON_JOB_NOT_FOUND", "Cron job not found.") from exc
        except ValueError as exc:
            raise APIError(400, "CRON_VALIDATION_ERROR", str(exc)) from exc
        return _json_response(200, _ok(data))

    @app.delete("/api/v1/cron/jobs/{job_id}")
    def delete_cron_job(request: Request, job_id: str) -> JSONResponse:
        deleted = request.app.state.web.delete_cron_job(job_id)
        if not deleted:
            raise APIError(404, "CRON_JOB_NOT_FOUND", "Cron job not found.")
        return _json_response(200, _ok({"deleted": True}))

    @app.post("/api/v1/cron/jobs/{job_id}/run")
    def run_cron_job(request: Request, job_id: str) -> JSONResponse:
        try:
            ran = request.app.state.web.run_cron_job(job_id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Cron run failed")
            raise APIError(500, "CRON_RUN_FAILED", "Failed to run cron job.", str(exc)) from exc
        if not ran:
            raise APIError(404, "CRON_JOB_NOT_FOUND", "Cron job not found.")
        return _json_response(200, _ok({"ran": True}))

    @app.get("/api/v1/calendar/events")
    def get_calendar_events(
        request: Request,
        start: str | None = Query(None),
        end: str | None = Query(None),
    ) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_calendar_events(start, end)))

    @app.post("/api/v1/calendar/events")
    def create_calendar_event(
        request: Request,
        payload: dict[str, Any] = Body(default_factory=dict),
    ) -> JSONResponse:
        try:
            data = request.app.state.web.create_calendar_event(payload)
        except ValueError as exc:
            raise APIError(400, "CALENDAR_VALIDATION_ERROR", str(exc)) from exc
        return _json_response(201, _ok(data))

    @app.patch("/api/v1/calendar/events/{event_id}")
    def update_calendar_event(
        request: Request,
        event_id: str,
        payload: dict[str, Any] = Body(default_factory=dict),
    ) -> JSONResponse:
        try:
            data = request.app.state.web.update_calendar_event(event_id, payload)
        except KeyError as exc:
            raise APIError(404, "CALENDAR_EVENT_NOT_FOUND", "Calendar event not found.") from exc
        except ValueError as exc:
            raise APIError(400, "CALENDAR_VALIDATION_ERROR", str(exc)) from exc
        return _json_response(200, _ok(data))

    @app.delete("/api/v1/calendar/events/{event_id}")
    def delete_calendar_event(request: Request, event_id: str) -> JSONResponse:
        deleted = request.app.state.web.delete_calendar_event(event_id)
        if not deleted:
            raise APIError(404, "CALENDAR_EVENT_NOT_FOUND", "Calendar event not found.")
        return _json_response(200, _ok({"deleted": True}))

    @app.get("/api/v1/calendar/settings")
    def get_calendar_settings(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_calendar_settings()))

    @app.patch("/api/v1/calendar/settings")
    def update_calendar_settings(
        request: Request,
        payload: CalendarSettingsUpdateRequest,
    ) -> JSONResponse:
        try:
            data = request.app.state.web.update_calendar_settings(payload.model_dump())
        except ValueError as exc:
            raise APIError(400, "CALENDAR_SETTINGS_INVALID", str(exc)) from exc
        return _json_response(200, _ok(data))

    @app.get("/api/v1/calendar/jobs")
    def get_calendar_jobs(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_calendar_jobs()))

    @app.get("/api/v1/agent-templates")
    def get_agent_templates(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.list_agent_templates()))

    @app.get("/api/v1/agent-templates/tools/valid")
    def get_valid_template_tools(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_valid_template_tools()))

    @app.post("/api/v1/agent-templates")
    def create_agent_template(
        request: Request,
        payload: AgentTemplateMutationRequest,
    ) -> JSONResponse:
        try:
            data = request.app.state.web.create_agent_template(payload.model_dump())
        except ValueError as exc:
            raise APIError(400, "AGENT_TEMPLATE_VALIDATION_ERROR", str(exc)) from exc
        return _json_response(201, _ok(data))

    @app.post("/api/v1/agent-templates/import")
    def import_agent_templates(
        request: Request,
        payload: AgentTemplateImportRequest,
    ) -> JSONResponse:
        return _json_response(
            200,
            _ok(
                request.app.state.web.import_agent_templates(
                    payload.content,
                    payload.on_conflict,
                )
            ),
        )

    @app.post("/api/v1/agent-templates/export")
    def export_agent_templates(
        request: Request,
        payload: AgentTemplateExportRequest,
    ) -> JSONResponse:
        return _json_response(
            200,
            _ok(request.app.state.web.export_agent_templates(payload.names)),
        )

    @app.post("/api/v1/agent-templates/reload")
    def reload_agent_templates(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.reload_agent_templates()))

    @app.get("/api/v1/agent-templates/{template_name:path}")
    def get_agent_template(request: Request, template_name: str) -> JSONResponse:
        try:
            data = request.app.state.web.get_agent_template(template_name)
        except KeyError as exc:
            raise APIError(404, "AGENT_TEMPLATE_NOT_FOUND", "Agent template not found.") from exc
        return _json_response(200, _ok(data))

    @app.patch("/api/v1/agent-templates/{template_name:path}")
    def update_agent_template(
        request: Request,
        template_name: str,
        payload: AgentTemplateMutationRequest,
    ) -> JSONResponse:
        try:
            data = request.app.state.web.update_agent_template(
                template_name,
                payload.model_dump(),
            )
        except KeyError as exc:
            raise APIError(404, "AGENT_TEMPLATE_NOT_FOUND", "Agent template not found.") from exc
        except ValueError as exc:
            raise APIError(400, "AGENT_TEMPLATE_VALIDATION_ERROR", str(exc)) from exc
        return _json_response(200, _ok(data))

    @app.delete("/api/v1/agent-templates/{template_name:path}")
    def delete_agent_template(request: Request, template_name: str) -> JSONResponse:
        try:
            data = request.app.state.web.delete_agent_template(template_name)
        except KeyError as exc:
            raise APIError(404, "AGENT_TEMPLATE_NOT_FOUND", "Agent template not found.") from exc
        except ValueError as exc:
            raise APIError(400, "AGENT_TEMPLATE_DELETE_FAILED", str(exc)) from exc
        return _json_response(200, _ok(data))

    @app.get("/api/v1/skills/installed")
    def get_installed_skills(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_installed_skills()))

    @app.post("/api/v1/skills/upload")
    async def upload_skill(request: Request) -> JSONResponse:
        form = await request.form()
        raw_paths = form.getlist("path")
        raw_files = form.getlist("file")
        if not raw_paths or not raw_files or len(raw_paths) != len(raw_files):
            raise APIError(400, "SKILL_UPLOAD_INVALID", "Upload requires matching path and file fields.")

        files: list[tuple[str, bytes]] = []
        for path_value, file_value in zip(raw_paths, raw_files):
            rel_path = str(path_value or "").strip()
            if not rel_path:
                continue
            file_bytes = await file_value.read()
            files.append((rel_path, file_bytes))

        try:
            data = request.app.state.web.upload_skill(files)
        except ValueError as exc:
            raise APIError(400, "SKILL_UPLOAD_INVALID", str(exc)) from exc
        return _json_response(201, _ok(data))

    @app.delete("/api/v1/skills/{skill_id:path}")
    def delete_skill(request: Request, skill_id: str) -> JSONResponse:
        try:
            deleted = request.app.state.web.delete_skill(skill_id)
        except KeyError as exc:
            raise APIError(404, "SKILL_NOT_FOUND", "Skill not found.") from exc
        except ValueError as exc:
            raise APIError(400, "SKILL_DELETE_FAILED", str(exc)) from exc
        return _json_response(200, _ok({"deleted": deleted}))

    @app.get("/api/v1/main-agent-prompt")
    def get_main_agent_prompt(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.get_main_agent_prompt()))

    @app.put("/api/v1/main-agent-prompt")
    def update_main_agent_prompt(
        request: Request,
        payload: dict[str, Any] = Body(default_factory=dict),
    ) -> JSONResponse:
        identity_content = str(payload.get("identity_content") or "")
        return _json_response(200, _ok(request.app.state.web.update_main_agent_prompt(identity_content)))

    @app.post("/api/v1/main-agent-prompt/reset")
    def reset_main_agent_prompt(request: Request) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.reset_main_agent_prompt()))

    @app.get("/api/v1/chat/sessions")
    def get_sessions(
        request: Request,
        page: int = Query(1, ge=1),
        page_size: int = Query(20, alias="pageSize", ge=1, le=100),
    ) -> JSONResponse:
        return _json_response(200, _ok(request.app.state.web.list_sessions(page, page_size)))

    @app.post("/api/v1/chat/sessions")
    def create_session(
        request: Request,
        payload: SessionCreateRequest | None = Body(default=None),
    ) -> JSONResponse:
        title = payload.title if payload else None
        return _json_response(201, _ok(request.app.state.web.create_session(title)))

    @app.patch("/api/v1/chat/sessions/{session_id}")
    def rename_session(
        request: Request,
        session_id: str,
        payload: SessionRenameRequest,
    ) -> JSONResponse:
        title = (payload.title or "").strip()
        if not title:
            raise APIError(400, "VALIDATION_ERROR", "title is required.")
        try:
            data = request.app.state.web.rename_session(session_id, title)
        except KeyError as exc:
            raise APIError(404, "CHAT_SESSION_NOT_FOUND", "Session not found.") from exc
        return _json_response(200, _ok(data))

    @app.delete("/api/v1/chat/sessions/{session_id}")
    def delete_session(request: Request, session_id: str) -> JSONResponse:
        deleted = request.app.state.web.delete_session(session_id)
        if not deleted:
            raise APIError(404, "CHAT_SESSION_NOT_FOUND", "Session not found.")
        return _json_response(200, _ok({"deleted": True}))

    @app.get("/api/v1/chat/sessions/{session_id}/messages")
    def get_messages(
        request: Request,
        session_id: str,
        limit: int = Query(200, ge=1, le=500),
    ) -> JSONResponse:
        try:
            data = request.app.state.web.get_messages(session_id, limit=limit)
        except KeyError as exc:
            raise APIError(404, "CHAT_SESSION_NOT_FOUND", "Session not found.") from exc
        return _json_response(200, _ok(data))

    @app.post("/api/v1/chat/sessions/{session_id}/messages")
    async def create_chat_message(
        request: Request,
        session_id: str,
        payload: ChatMessageRequest,
        stream: bool = Query(False),
    ):
        content = (payload.content or "").strip()
        if not content:
            raise APIError(400, "VALIDATION_ERROR", "content is required.")

        state: WebAppState = request.app.state.web

        if stream:
            async def event_stream():
                queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

                async def on_progress(progress: str, *, tool_hint: bool = False) -> None:
                    await queue.put(
                        {
                            "type": "progress",
                            "content": progress,
                            "toolHint": tool_hint,
                        }
                    )

                async def run_chat() -> None:
                    try:
                        await queue.put({"type": "start", "sessionId": session_id})
                        data = await state.chat(session_id, content, on_progress)
                        await queue.put({"type": "done", **data})
                    except KeyError:
                        await queue.put({"type": "error", "message": "Session not found."})
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("Chat stream failed")
                        await queue.put({"type": "error", "message": str(exc)})
                    finally:
                        await queue.put(None)

                task = asyncio.create_task(run_chat())
                try:
                    while True:
                        event = await queue.get()
                        if event is None:
                            break
                        yield _encode_sse(event)
                except asyncio.CancelledError:
                    task.cancel()
                    raise
                finally:
                    if not task.done():
                        task.cancel()
                    with suppress(Exception):
                        await task

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

        async def on_progress(_progress: str, *, tool_hint: bool = False) -> None:
            _ = tool_hint

        try:
            data = await state.chat(session_id, content, on_progress)
        except KeyError as exc:
            raise APIError(404, "CHAT_SESSION_NOT_FOUND", "Session not found.") from exc
        except Exception as exc:  # noqa: BLE001
            logger.exception("Chat request failed")
            raise APIError(
                500,
                "CHAT_FAILED",
                "Failed to process chat request.",
                str(exc),
            ) from exc
        return _json_response(200, _ok(data))

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        include_in_schema=False,
    )
    def unknown_api_route(path: str):
        _ = path
        raise APIError(404, "NOT_FOUND", "Endpoint not found.")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(request: Request, full_path: str = ""):
        if full_path.startswith("api/"):
            raise APIError(404, "NOT_FOUND", "Endpoint not found.")
        return _static_response(request.app.state.static_dir, full_path)

    return app


def run_server(config: Config, host: str = "127.0.0.1", port: int = 6788) -> None:
    """Run the FastAPI server for the Web UI."""
    static_dir = _resolve_static_dir()
    logger.info("nanobot Web UI running at http://{}:{}", host, port)
    if static_dir is None:
        logger.info("No built frontend found. API is available at /api/v1/*.")
    else:
        logger.info("Serving static files from {}", static_dir)

    uvicorn.run(
        create_app(config, static_dir=static_dir),
        host=host,
        port=port,
        access_log=False,
    )
