"""Agent chat runtime services with isolated session and workspace boundaries."""

from __future__ import annotations

import re
import time
from datetime import datetime
from typing import TYPE_CHECKING, Any

from nanobot.chat_payload import normalize_chat_attachments
from nanobot.harness import AgentThreadWorkspaceProvider
from nanobot.platform.agents import AgentDefinitionNotFoundError
from nanobot.session.manager import Session

if TYPE_CHECKING:
    from nanobot.web.runtime import WebAppState


class WebAgentChatRuntimeService:
    """Runtime helpers for real agent chat sessions in isolated workspaces."""

    def __init__(self, state: WebAppState):
        self.state = state

    @staticmethod
    def session_key(agent_id: str, session_id: str) -> str:
        return f"agent:{agent_id}:session:{session_id}"

    @staticmethod
    def session_prefix(agent_id: str) -> str:
        return f"agent:{agent_id}:session:"

    def _require_agent(self, agent_id: str, *, tenant_id: str | None = None) -> dict[str, Any]:
        try:
            return self.state.app_agents.get_agent(agent_id, tenant_id=tenant_id)
        except AgentDefinitionNotFoundError as exc:
            raise KeyError(agent_id) from exc

    def _format_session_summary(self, agent_id: str, item: dict[str, Any]) -> dict[str, Any]:
        prefix = self.session_prefix(agent_id)
        key = str(item.get("key") or "")
        session_id = key[len(prefix):] if key.startswith(prefix) else key
        metadata = item.get("metadata", {}) or {}
        file_count = item.get("file_count")
        if file_count is None:
            file_count = len(
                normalize_chat_attachments(
                    metadata.get(self.state.chat_runtime.SESSION_FILES_METADATA_KEY) or []
                )
            )
        return {
            "id": session_id,
            "sessionId": session_id,
            "title": item.get("title") or self.state.chat_runtime.default_title(),
            "createdAt": item.get("created_at"),
            "updatedAt": item.get("updated_at"),
            "messageCount": item.get("message_count", 0),
            "fileCount": file_count,
        }

    def require_session(self, agent_id: str, session_id: str) -> Session:
        key = self.session_key(agent_id, session_id)
        session = self.state.sessions.get(key) if self.state.sessions else None
        if session is None:
            raise KeyError(session_id)
        return session

    def list_sessions(
        self,
        agent_id: str,
        *,
        tenant_id: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        self._require_agent(agent_id, tenant_id=tenant_id)
        prefix = self.session_prefix(agent_id)
        items = [
            item
            for item in (self.state.sessions.list_sessions() if self.state.sessions else [])
            if str(item.get("key") or "").startswith(prefix)
        ]
        total = len(items)
        start = max(0, (page - 1) * page_size)
        end = start + page_size
        return {
            "items": [self._format_session_summary(agent_id, item) for item in items[start:end]],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }

    def create_session(
        self,
        agent_id: str,
        *,
        tenant_id: str | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        self._require_agent(agent_id, tenant_id=tenant_id)
        session_id = self.state.instance.next_id("agent-session") if hasattr(self.state.instance, "next_id") else None
        if not session_id:
            from uuid import uuid4

            session_id = uuid4().hex
        key = self.session_key(agent_id, session_id)
        session = self.state.sessions.get_or_create(key)
        session.metadata["title"] = title or self.state.chat_runtime.default_title()
        session.metadata["agentId"] = agent_id
        self.state.sessions.save(session)
        return self.state.chat_runtime.format_session_summary_from_session(session, session_id)

    def rename_session(
        self,
        agent_id: str,
        session_id: str,
        title: str,
        *,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        self._require_agent(agent_id, tenant_id=tenant_id)
        session = self.state.sessions.update_metadata(
            self.session_key(agent_id, session_id),
            title=title,
            agentId=agent_id,
        )
        return self.state.chat_runtime.format_session_summary_from_session(session, session_id)

    def delete_session(
        self,
        agent_id: str,
        session_id: str,
        *,
        tenant_id: str | None = None,
    ) -> bool:
        self._require_agent(agent_id, tenant_id=tenant_id)
        return self.state.sessions.delete(self.session_key(agent_id, session_id))

    def get_messages(
        self,
        agent_id: str,
        session_id: str,
        *,
        tenant_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        self._require_agent(agent_id, tenant_id=tenant_id)
        session = self.require_session(agent_id, session_id)
        messages = session.messages[-limit:]
        start_sequence = len(session.messages) - len(messages) + 1
        return [
            self.state.chat_runtime.format_message(start_sequence + index, session_id, message)
            for index, message in enumerate(messages)
        ]

    def get_last_assistant_message(
        self,
        agent_id: str,
        session_id: str,
        *,
        tenant_id: str | None = None,
    ) -> dict[str, Any] | None:
        self._require_agent(agent_id, tenant_id=tenant_id)
        session = self.require_session(agent_id, session_id)
        for index in range(len(session.messages) - 1, -1, -1):
            message = session.messages[index]
            if message.get("role") == "assistant":
                return self.state.chat_runtime.format_message(index + 1, session_id, message)
        return None

    def get_session_files(
        self,
        agent_id: str,
        session_id: str,
        *,
        tenant_id: str | None = None,
    ) -> list[dict[str, Any]]:
        self._require_agent(agent_id, tenant_id=tenant_id)
        session = self.require_session(agent_id, session_id)
        return self.state.chat_runtime.get_session_file_refs(session)

    def get_chat_workspace(
        self,
        agent_id: str,
        session_id: str,
        *,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        agent = self._require_agent(agent_id, tenant_id=tenant_id)
        _session = self.require_session(agent_id, session_id)
        environment = self.state.agent_runtime.resolve_agent_environment(
            agent,
            thread_id=session_id,
            session_key=self.session_key(agent_id, session_id),
            workspace_provider=AgentThreadWorkspaceProvider(),
        )
        upload_dir = environment.workspace.path / "uploads"
        recent_uploads: list[dict[str, Any]] = []
        if upload_dir.is_dir():
            for path in sorted(upload_dir.iterdir(), key=lambda entry: entry.stat().st_mtime, reverse=True):
                if not path.is_file():
                    continue
                recent_uploads.append(self.state.chat_runtime.format_upload_item(path, environment.workspace.path))
                if len(recent_uploads) >= 6:
                    break
        payload = dict(self.state.chat_runtime.get_chat_workspace())
        payload["generatedAt"] = datetime.now().isoformat()
        runtime = dict(payload.get("runtime") or {})
        runtime["workspace"] = str(environment.workspace.path)
        payload["runtime"] = runtime
        payload["recentUploads"] = recent_uploads
        return payload

    def upload_chat_file_to_session(
        self,
        agent_id: str,
        session_id: str,
        file_name: str,
        content: bytes,
        *,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        agent = self._require_agent(agent_id, tenant_id=tenant_id)
        session = self.require_session(agent_id, session_id)
        raw_name = re.sub(r"[^A-Za-z0-9._-]+", "-", (file_name or "").strip().split("/")[-1]).strip("-.")
        if not raw_name:
            raise ValueError("Uploaded file name is invalid.")
        if not content:
            raise ValueError("Uploaded file is empty.")
        if len(content) > 10 * 1024 * 1024:
            raise ValueError("Uploaded file must be 10 MB or smaller.")
        environment = self.state.agent_runtime.resolve_agent_environment(
            agent,
            thread_id=session_id,
            session_key=self.session_key(agent_id, session_id),
            workspace_provider=AgentThreadWorkspaceProvider(),
        )
        upload_dir = environment.workspace.path / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        destination = upload_dir / f"{int(time.time())}-{raw_name}"
        destination.write_bytes(content)
        uploaded = self.state.chat_runtime.format_upload_item(destination, environment.workspace.path)
        self.state.chat_runtime.add_session_file_refs(session, [uploaded])
        return uploaded

    def import_session_files(
        self,
        agent_id: str,
        session_id: str,
        attachments: list[dict[str, Any]] | None,
        *,
        tenant_id: str | None = None,
    ) -> list[dict[str, Any]]:
        agent = self._require_agent(agent_id, tenant_id=tenant_id)
        session = self.require_session(agent_id, session_id)
        environment = self.state.agent_runtime.resolve_agent_environment(
            agent,
            thread_id=session_id,
            session_key=self.session_key(agent_id, session_id),
            workspace_provider=AgentThreadWorkspaceProvider(),
        )
        resolved = [
            self.state.chat_runtime.resolve_workspace_file_in_root(
                environment.workspace.path,
                str(item.get("relativePath") or item.get("path") or ""),
            )
            for item in normalize_chat_attachments(attachments)
        ]
        return self.state.chat_runtime.add_session_file_refs(session, resolved)

    def remove_session_file(
        self,
        agent_id: str,
        session_id: str,
        relative_path: str,
        *,
        tenant_id: str | None = None,
    ) -> list[dict[str, Any]]:
        self._require_agent(agent_id, tenant_id=tenant_id)
        session = self.require_session(agent_id, session_id)
        target = str(relative_path or "").strip()
        if not target:
            raise ValueError("File path is required.")
        remaining = [
            item
            for item in self.state.chat_runtime.get_session_file_refs(session)
            if str(item.get("relativePath") or item.get("path") or "") != target
        ]
        return self.state.chat_runtime.set_session_file_refs(session, remaining)

    async def chat(
        self,
        agent_id: str,
        session_id: str,
        content: str,
        on_progress,
        *,
        tenant_id: str | None = None,
        display_content: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        on_stream=None,
    ) -> dict[str, Any]:
        agent = self._require_agent(agent_id, tenant_id=tenant_id)
        key = self.session_key(agent_id, session_id)
        session = self.state.sessions.get_or_create(key)
        if not session.metadata.get("title"):
            session.metadata["title"] = self.state.chat_runtime.default_title(display_content or content)
            session.metadata["agentId"] = agent_id
            self.state.sessions.save(session)
        normalized_attachments = normalize_chat_attachments(attachments)
        if normalized_attachments:
            self.state.chat_runtime.add_session_file_refs(session, normalized_attachments)
        environment = self.state.agent_runtime.resolve_agent_environment(
            agent,
            thread_id=session_id,
            session_key=key,
            workspace_provider=AgentThreadWorkspaceProvider(),
        )
        result = await self.state.agent_runtime.run_agent_definition(
            agent,
            task=content,
            label=str(agent.get("name") or "Agent"),
            session_key=key,
            session_id=session_id,
            session_title=str(session.metadata.get("title") or self.state.chat_runtime.default_title()),
            origin_chat_id=session_id,
            thread_id=session_id,
            workspace_memory_resolver=self.state.agent_runtime.build_workspace_memory_resolver(
                environment.workspace.path,
                heading="Agent Workspace Memory",
            ),
            workspace_binding=environment.workspace,
            sandbox_binding=environment.sandbox,
            on_progress=on_progress,
            on_stream=on_stream,
            display_content=display_content,
            attachments=attachments,
        )
        assistant_message = result.get("assistantMessage")
        return {
            "content": (
                str((assistant_message or {}).get("content") or "")
                or str(((result.get("run") or {}).get("resultSummary") or {}).get("content") or "")
            ),
            "message": assistant_message,
            "session": result.get("session"),
            "messages": result.get("messages"),
            "knowledgeHits": result.get("knowledgeHits", []),
        }
