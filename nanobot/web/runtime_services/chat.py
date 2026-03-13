"""Chat-related runtime services for the nanobot Web UI."""

from __future__ import annotations

import re
import time
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from nanobot.agent.loop import AgentLoop
from nanobot.session.manager import Session

if TYPE_CHECKING:
    from nanobot.web.runtime import WebAppState


class WebChatRuntimeService:
    """Encapsulates chat sessions, uploads, and MCP test chat helpers."""

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
        return {
            "id": session_id,
            "sessionId": session_id,
            "title": title,
            "createdAt": item.get("created_at"),
            "updatedAt": item.get("updated_at"),
            "messageCount": item.get("message_count", 0),
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
            if name in {"send_progress", "send_tool_hints"}:
                continue
            channel = getattr(self.state.config.channels, name, None)
            if getattr(channel, "enabled", False):
                enabled_channels.append(name)
        return enabled_channels

    def get_chat_workspace(self) -> dict[str, Any]:
        active_mcp = self.list_active_mcp()
        return {
            "generatedAt": datetime.now().isoformat(),
            "runtime": {
                "workspace": str(self.state.config.workspace_path),
                "provider": self.state.config.agents.defaults.provider,
                "model": self.state.config.agents.defaults.model,
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
            brave_api_key=isolated_config.tools.web.search.api_key or None,
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
    ) -> dict[str, Any]:
        key = self.session_key(session_id)
        session = self.state.sessions.get_or_create(key)
        if not session.metadata.get("title"):
            session.metadata["title"] = self.default_title(content)
            self.state.sessions.save(session)
        response = await self.state.agent.process_direct(
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
