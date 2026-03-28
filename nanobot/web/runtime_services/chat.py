"""Chat-related runtime services for the nanobot Web UI."""

from __future__ import annotations

import re
import time
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from nanobot.agent.loop import AgentLoop
from nanobot.chat_payload import normalize_chat_attachments
from nanobot.session.manager import Session

if TYPE_CHECKING:
    from nanobot.web.runtime import WebAppState


class WebChatRuntimeService:
    """Encapsulates chat sessions, uploads, and MCP test chat helpers."""

    SESSION_FILES_METADATA_KEY = "chatFiles"

    def __init__(self, state: WebAppState):
        self.state = state

    @staticmethod
    def default_title(content: str | None = None) -> str:
        if content:
            cleaned = " ".join(content.strip().split())
            if cleaned:
                return cleaned[:40]
        return "New Chat"

    def session_key(self, session_id: str) -> str:
        return f"web:{session_id}"

    def require_session(self, session_id: str) -> Session:
        session = self.state.sessions.get(self.session_key(session_id)) if self.state.sessions else None
        if session is None:
            raise KeyError(session_id)
        return session

    @classmethod
    def format_session_summary(cls, item: dict[str, Any]) -> dict[str, Any]:
        key = item["key"]
        session_id = key.split(":", 1)[1] if ":" in key else key
        title = item.get("title") or cls.default_title()
        metadata = item.get("metadata", {}) or {}
        file_count = item.get("file_count")
        if file_count is None:
            file_count = len(normalize_chat_attachments(metadata.get(cls.SESSION_FILES_METADATA_KEY) or []))
        return {
            "id": session_id,
            "sessionId": session_id,
            "title": title,
            "createdAt": item.get("created_at"),
            "updatedAt": item.get("updated_at"),
            "messageCount": item.get("message_count", 0),
            "fileCount": file_count,
        }

    @staticmethod
    def format_message(sequence: int, session_id: str, message: dict[str, Any]) -> dict[str, Any]:
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
        attachments = normalize_chat_attachments(message.get("attachments") or [])
        if attachments:
            payload["attachments"] = attachments
        return payload

    @staticmethod
    def format_upload_item(path: Path, workspace_path: Path) -> dict[str, Any]:
        stat = path.stat()
        uploaded_at = datetime.fromtimestamp(stat.st_mtime).isoformat()
        return {
            "name": path.name,
            "path": str(path),
            "relativePath": str(path.relative_to(workspace_path)),
            "sizeBytes": stat.st_size,
            "uploadedAt": uploaded_at,
        }

    def resolve_workspace_file(self, relative_path: str) -> dict[str, Any]:
        raw_relative_path = str(relative_path or "").strip()
        if not raw_relative_path:
            raise ValueError("File path is required.")

        candidate = Path(raw_relative_path)
        if candidate.is_absolute():
            try:
                candidate = candidate.relative_to(self.state.config.workspace_path)
            except ValueError as exc:
                raise ValueError("File must stay inside the workspace.") from exc

        workspace_root = self.state.config.workspace_path.resolve()
        resolved = (workspace_root / candidate).resolve()
        try:
            resolved.relative_to(workspace_root)
        except ValueError as exc:
            raise ValueError("File must stay inside the workspace.") from exc

        if not resolved.exists() or not resolved.is_file():
            raise ValueError("Referenced file does not exist.")

        return self.format_upload_item(resolved, workspace_root)

    @staticmethod
    def collect_message_attachment_refs(session: Session) -> list[dict[str, Any]]:
        attachments: list[dict[str, Any]] = []
        for message in session.messages:
            attachments.extend(normalize_chat_attachments(message.get("attachments") or []))
        return normalize_chat_attachments(attachments)

    def get_session_file_refs(self, session: Session) -> list[dict[str, Any]]:
        session_files = normalize_chat_attachments(session.metadata.get(self.SESSION_FILES_METADATA_KEY) or [])
        if session_files:
            return session_files

        migrated_files = self.collect_message_attachment_refs(session)
        if migrated_files:
            session.metadata[self.SESSION_FILES_METADATA_KEY] = migrated_files
            self.state.sessions.save(session)
        return migrated_files

    def set_session_file_refs(self, session: Session, attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized = normalize_chat_attachments(attachments)
        session.metadata[self.SESSION_FILES_METADATA_KEY] = normalized
        self.state.sessions.save(session)
        return normalized

    def add_session_file_refs(self, session: Session, attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        current = self.get_session_file_refs(session)
        merged = normalize_chat_attachments([*current, *attachments])
        return self.set_session_file_refs(session, merged)

    def list_sessions(self, page: int = 1, page_size: int = 20) -> dict[str, Any]:
        items = [
            session
            for session in (self.state.sessions.list_sessions() if self.state.sessions else [])
            if session.get("key", "").startswith("web:")
        ]
        total = len(items)
        start = max(0, (page - 1) * page_size)
        end = start + page_size
        return {
            "items": [self.format_session_summary(item) for item in items[start:end]],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }

    def create_session(self, title: str | None = None) -> dict[str, Any]:
        session_id = self.state.instance.next_id("web-session") if hasattr(self.state.instance, "next_id") else None
        if not session_id:
            from uuid import uuid4

            session_id = uuid4().hex
        session = self.state.sessions.get_or_create(self.session_key(session_id))
        session.metadata["title"] = title or self.default_title()
        self.state.sessions.save(session)
        return self.format_session_summary(
            {
                "key": session.key,
                "created_at": session.created_at.isoformat(),
                "updated_at": session.updated_at.isoformat(),
                "message_count": len(session.messages),
                "title": session.metadata.get("title"),
            }
        )

    def rename_session(self, session_id: str, title: str) -> dict[str, Any]:
        session = self.state.sessions.update_metadata(self.session_key(session_id), title=title)
        return self.format_session_summary(
            {
                "key": session.key,
                "created_at": session.created_at.isoformat(),
                "updated_at": session.updated_at.isoformat(),
                "message_count": len(session.messages),
                "title": session.metadata.get("title"),
            }
        )

    def delete_session(self, session_id: str) -> bool:
        return self.state.sessions.delete(self.session_key(session_id))

    def get_messages(self, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
        session = self.require_session(session_id)
        messages = session.messages[-limit:]
        start_sequence = len(session.messages) - len(messages) + 1
        return [
            self.format_message(start_sequence + index, session_id, message)
            for index, message in enumerate(messages)
        ]

    def get_last_assistant_message(self, session_id: str) -> dict[str, Any] | None:
        session = self.require_session(session_id)
        for index in range(len(session.messages) - 1, -1, -1):
            message = session.messages[index]
            if message.get("role") == "assistant":
                return self.format_message(index + 1, session_id, message)
        return None

    def upload_chat_file(self, file_name: str, content: bytes) -> dict[str, Any]:
        raw_name = Path(str(file_name or "").strip()).name
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", raw_name).strip("-.")
        if not safe_name:
            raise ValueError("Uploaded file name is invalid.")
        if not content:
            raise ValueError("Uploaded file is empty.")
        if len(content) > 10 * 1024 * 1024:
            raise ValueError("Uploaded file must be 10 MB or smaller.")

        upload_dir = self.state.config.workspace_path / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        destination = upload_dir / f"{int(time.time())}-{safe_name}"
        destination.write_bytes(content)
        return self.format_upload_item(destination, self.state.config.workspace_path)

    def get_session_files(self, session_id: str) -> list[dict[str, Any]]:
        session = self.state.sessions.get_or_create(self.session_key(session_id))
        return self.get_session_file_refs(session)

    def upload_chat_file_to_session(self, session_id: str, file_name: str, content: bytes) -> dict[str, Any]:
        uploaded = self.upload_chat_file(file_name, content)
        session = self.require_session(session_id)
        self.add_session_file_refs(session, [uploaded])
        return uploaded

    def import_session_files(
        self,
        session_id: str,
        attachments: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        session = self.require_session(session_id)
        resolved = [
            self.resolve_workspace_file(str(item.get("relativePath") or item.get("path") or ""))
            for item in normalize_chat_attachments(attachments)
        ]
        return self.add_session_file_refs(session, resolved)

    def remove_session_file(self, session_id: str, relative_path: str) -> list[dict[str, Any]]:
        session = self.require_session(session_id)
        target = str(relative_path or "").strip()
        if not target:
            raise ValueError("File path is required.")
        remaining = [
            item
            for item in self.get_session_file_refs(session)
            if str(item.get("relativePath") or item.get("path") or "") != target
        ]
        return self.set_session_file_refs(session, remaining)

    def list_chat_uploads(self, limit: int = 6) -> list[dict[str, Any]]:
        upload_dir = self.state.config.workspace_path / "uploads"
        if not upload_dir.exists():
            return []

        items: list[dict[str, Any]] = []
        for path in sorted(upload_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
            if not path.is_file():
                continue
            items.append(self.format_upload_item(path, self.state.config.workspace_path))
            if len(items) >= limit:
                break
        return items

    @staticmethod
    def mcp_test_session_key(server_name: str) -> str:
        return f"mcp-test:{server_name}"

    @staticmethod
    def mcp_test_session_id(server_name: str) -> str:
        return f"mcp-test:{server_name}"

    def ensure_mcp_test_session(self, server_name: str) -> Session:
        entry = self.state.config.tools.mcp_servers.get(server_name)
        if entry is None:
            raise KeyError(server_name)
        session_key = self.mcp_test_session_key(server_name)
        session = self.state.sessions.get_or_create(session_key)
        if not session.metadata.get("title"):
            session.metadata["title"] = f"MCP Test · {server_name}"
            self.state.sessions.save(session)
        return session

    def format_session_summary_from_session(self, session: Session, session_id: str) -> dict[str, Any]:
        return {
            "id": session_id,
            "sessionId": session_id,
            "title": session.metadata.get("title") or self.default_title(),
            "createdAt": session.created_at.isoformat(),
            "updatedAt": session.updated_at.isoformat(),
            "messageCount": len(session.messages),
            "fileCount": len(self.get_session_file_refs(session)),
        }

    def format_recent_tool_activity(
        self,
        messages: list[dict[str, Any]],
        *,
        session_id: str,
        session_title: str,
        limit: int = 8,
    ) -> list[dict[str, Any]]:
        recent_tool_activity: list[dict[str, Any]] = []
        for message in reversed(messages):
            tool_calls = message.get("toolCalls") or []
            for tool_call in tool_calls:
                function = tool_call.get("function") if isinstance(tool_call, dict) else None
                tool_name = (
                    str(function.get("name") or "").strip()
                    if isinstance(function, dict)
                    else str(tool_call.get("name") or "").strip()
                    if isinstance(tool_call, dict)
                    else ""
                )
                if tool_name:
                    recent_tool_activity.append(
                        {
                            "sessionId": session_id,
                            "sessionTitle": session_title,
                            "toolName": tool_name,
                            "source": "tool_call",
                            "createdAt": message.get("createdAt"),
                        }
                    )
            if message.get("role") == "tool":
                recent_tool_activity.append(
                    {
                        "sessionId": session_id,
                        "sessionTitle": session_title,
                        "toolName": message.get("name") or "tool",
                        "source": "tool_result",
                        "createdAt": message.get("createdAt"),
                    }
                )
            if len(recent_tool_activity) >= limit:
                break
        return recent_tool_activity[:limit]

    def list_recent_tool_activity(self, limit: int = 8) -> list[dict[str, Any]]:
        if not self.state.sessions:
            return []

        sessions = [
            item
            for item in self.state.sessions.list_sessions()
            if item.get("key", "").startswith("web:")
        ]
        sessions.sort(key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)

        recent_activity: list[dict[str, Any]] = []
        for item in sessions:
            summary = self.format_session_summary(item)
            messages = self.get_messages(summary["id"], limit=200)
            recent_activity.extend(
                self.format_recent_tool_activity(
                    messages,
                    session_id=summary["id"],
                    session_title=summary["title"],
                    limit=limit,
                )
            )
            if len(recent_activity) >= limit:
                break

        recent_activity.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
        return recent_activity[:limit]

    def list_active_mcp(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for name, entry in self.state.config.tools.mcp_servers.items():
            if not getattr(entry, "enabled", True):
                continue
            items.append(
                {
                    "name": name,
                    "displayName": name,
                    "toolCount": None,
                    "toolNames": [],
                    "status": "enabled",
                }
            )
        return items

    def list_enabled_channels(self) -> list[str]:
        enabled_channels: list[str] = []
        for name in type(self.state.config.channels).model_fields:
            if name in {"send_progress", "send_tool_hints", "send_max_retries"}:
                continue
            channel = getattr(self.state.config.channels, name, None)
            if getattr(channel, "enabled", False):
                enabled_channels.append(name)
        return enabled_channels

    def get_chat_workspace(self) -> dict[str, Any]:
        active_mcp = self.list_active_mcp()
        defaults = self.state.config.agents.defaults
        resolved_provider = self.state.config.get_provider_name(defaults.model) or defaults.provider
        resolved_binding = self.state.config.get_binding_name(defaults.model) or defaults.binding
        return {
            "generatedAt": datetime.now().isoformat(),
            "runtime": {
                "workspace": str(self.state.config.workspace_path),
                "provider": defaults.provider,
                "resolvedProvider": resolved_provider,
                "resolvedBinding": resolved_binding,
                "model": defaults.model,
                "reasoningEffort": defaults.reasoning_effort,
                "maxToolIterations": defaults.max_tool_iterations,
                "restrictToWorkspace": self.state.config.tools.restrict_to_workspace,
                "sendProgress": self.state.config.channels.send_progress,
                "sendToolHints": self.state.config.channels.send_tool_hints,
                "sendMaxRetries": self.state.config.channels.send_max_retries,
                "status": "ready",
                "enabledChannels": self.list_enabled_channels(),
                "activeMcpCount": len(active_mcp),
            },
            "recentUploads": self.list_chat_uploads(limit=6),
            "recentToolActivity": self.list_recent_tool_activity(limit=8),
            "activeMcp": active_mcp,
            "quickPrompts": [
                "帮我先梳理这个工作区最近最值得关注的内容",
                "结合当前会话和附件，给我一个下一步执行计划",
                "检查这个项目里现在最需要优先修复的问题",
            ],
        }

    def get_mcp_test_chat(self, server_name: str, limit: int = 120) -> dict[str, Any]:
        session = self.ensure_mcp_test_session(server_name)
        entry = self.state.config.tools.mcp_servers.get(server_name)
        if entry is None:
            raise KeyError(server_name)
        session_id = self.mcp_test_session_id(server_name)
        messages = [
            self.format_message(index + 1, session_id, message)
            for index, message in enumerate(session.messages[-limit:])
        ]
        summary = self.format_session_summary_from_session(session, session_id)
        return {
            "session": summary,
            "messages": messages,
            "toolNames": [],
            "recentToolActivity": self.format_recent_tool_activity(
                messages,
                session_id=session_id,
                session_title=summary["title"],
            ),
        }

    def clear_mcp_test_chat(self, server_name: str) -> bool:
        if self.state.config.tools.mcp_servers.get(server_name) is None:
            raise KeyError(server_name)
        return self.state.sessions.delete(self.mcp_test_session_key(server_name))

    async def chat_with_mcp_test(
        self,
        server_name: str,
        content: str,
        on_progress,
    ) -> dict[str, Any]:
        cfg = self.state.config.tools.mcp_servers.get(server_name)
        if cfg is None:
            raise KeyError(server_name)

        self.ensure_mcp_test_session(server_name)
        session_id = self.mcp_test_session_id(server_name)
        session_key = self.mcp_test_session_key(server_name)

        isolated_config = self.state.config.model_copy(deep=True)
        isolated_target = isolated_config.tools.mcp_servers.get(server_name)
        isolated_config.tools.mcp_servers = {server_name: isolated_target} if isolated_target else {}

        isolated_agent = AgentLoop(
            bus=self.state.bus,
            provider=self.state.config_runtime.make_provider(isolated_config),
            workspace=isolated_config.workspace_path,
            model=isolated_config.agents.defaults.model,
            max_iterations=isolated_config.agents.defaults.max_tool_iterations,
            context_window_tokens=isolated_config.agents.defaults.context_window_tokens,
            web_search_config=isolated_config.tools.web.search,
            web_proxy=isolated_config.tools.web.proxy or None,
            exec_config=isolated_config.tools.exec,
            cron_service=self.state.cron,
            restrict_to_workspace=isolated_config.tools.restrict_to_workspace,
            session_manager=self.state.sessions,
            mcp_servers=isolated_config.tools.mcp_servers,
            channels_config=isolated_config.channels,
        )
        try:
            response = await isolated_agent.process_direct(
                content=content,
                session_key=session_key,
                channel="web",
                chat_id=session_id,
                on_progress=on_progress,
            )
        finally:
            await isolated_agent.close_mcp()

        payload = self.get_mcp_test_chat(server_name)
        assistant_message = next(
            (message for message in reversed(payload["messages"]) if message["role"] == "assistant"),
            None,
        )
        return {
            "content": response,
            "assistantMessage": assistant_message,
            "session": payload["session"],
            "messages": payload["messages"],
            "toolNames": payload["toolNames"],
            "recentToolActivity": payload["recentToolActivity"],
        }

    async def chat(
        self,
        session_id: str,
        content: str,
        on_progress,
        *,
        display_content: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        key = self.session_key(session_id)
        session = self.state.sessions.get_or_create(key)
        if not session.metadata.get("title"):
            session.metadata["title"] = self.default_title(display_content or content)
            self.state.sessions.save(session)
        normalized_attachments = normalize_chat_attachments(attachments)
        if normalized_attachments:
            self.add_session_file_refs(session, normalized_attachments)
        response = await self.state.agent.process_direct(
            content=content,
            session_key=key,
            channel="web",
            chat_id=session_id,
            on_progress=on_progress,
            run_context={
                "chat_message": {
                    "display_content": display_content or content,
                    "attachments": normalized_attachments,
                },
            },
        )
        return {
            "content": response,
            "assistantMessage": self.get_last_assistant_message(session_id),
        }
