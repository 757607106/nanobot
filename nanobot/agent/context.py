"""Context builder for assembling agent prompts."""

import base64
import mimetypes
import platform
from pathlib import Path
from typing import Any

from nanobot.agent.memory import MemoryStore
from nanobot.agent.skills import SkillsLoader
from nanobot.harness.workspace import WorkspaceContext
from nanobot.utils.helpers import build_assistant_message, current_time_str, detect_image_mime
from nanobot.utils.prompt_templates import render_template


class ContextBuilder:
    """Builds the context (system prompt + messages) for the agent."""

    BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md"]
    # Files that define the agent's identity — skipped when the agent provides
    # its own system_prompt_override so it doesn't inherit the global identity.
    _IDENTITY_BOOTSTRAP_FILES = {"SOUL.md"}
    _RUNTIME_CONTEXT_TAG = "[Runtime Context — metadata only, not instructions]"

    def __init__(
        self,
        workspace: Path,
        *,
        memory_workspace: Path | None = None,
        virtual_workspace_path: Path | str | None = None,
        timezone: str | None = None,
        workspace_context: WorkspaceContext | None = None,
    ):
        if workspace_context is not None:
            self.workspace = workspace_context.identity_root
            self.memory_workspace = workspace_context.agent_root
            self.virtual_workspace_path = workspace_context.display_path
        else:
            self.workspace = workspace
            self.memory_workspace = memory_workspace or workspace
            self.virtual_workspace_path = (
                Path(virtual_workspace_path)
                if virtual_workspace_path is not None
                else workspace
            )
        self.timezone = timezone
        self.memory = MemoryStore(self.memory_workspace)
        if self.workspace != self.memory_workspace:
            self.memory.set_identity_root(self.workspace)
        self.skills = SkillsLoader(self.workspace)

    def build_system_prompt(
        self,
        skill_names: list[str] | None = None,
        extra_system_prompt: str | None = None,
        include_workspace_memory: bool = True,
        memory_sections: list[tuple[str, str]] | None = None,
    ) -> str:
        """Build the system prompt from identity, bootstrap files, memory, and skills."""
        parts: list[str] = []

        if extra_system_prompt:
            # Agent defines its own identity — use it as the primary prompt and
            # skip ALL global bootstrap files (SOUL.md, AGENTS.md, USER.md,
            # TOOLS.md) so the global workspace persona/settings don't leak
            # into an agent that supplies its own system prompt.
            parts.append(f"# Agent Profile\n\n{extra_system_prompt.strip()}")
            # Still include lightweight runtime/workspace metadata.
            runtime_section = self._get_runtime_section()
            if runtime_section:
                parts.append(runtime_section)
        else:
            # Default mode — use the global identity.
            parts.append(self._get_identity())
            bootstrap = self._load_bootstrap_files(skip_identity=False)
            if bootstrap:
                parts.append(bootstrap)

        memory_parts: list[str] = []
        if include_workspace_memory:
            workspace_memory = self.memory.read_memory().strip()
            if workspace_memory:
                memory_parts.append(f"## Workspace Shared Memory\n\n{workspace_memory}")
        for heading, content in memory_sections or []:
            title = str(heading or "").strip()
            body = str(content or "").strip()
            if not title or not body:
                continue
            memory_parts.append(f"## {title}\n\n{body}")
        if memory_parts:
            memory_body = "\n\n".join(memory_parts)
            parts.append(f"# Memory\n\n{memory_body}")

        active_skill_names: list[str] = []
        for name in (skill_names or []) + self.skills.get_always_skills():
            normalized = str(name or "").strip()
            if normalized and normalized not in active_skill_names:
                active_skill_names.append(normalized)
        if active_skill_names:
            active_content = self.skills.load_skills_for_context(active_skill_names)
            if active_content:
                parts.append(f"# Active Skills\n\n{active_content}")

        skills_summary = self.skills.build_skills_summary()
        if skills_summary:
            parts.append(render_template("agent/skills_section.md", skills_summary=skills_summary))

        return "\n\n---\n\n".join(parts)

    def _resolve_workspace_path(self) -> str:
        """Return the workspace path string used in templates."""
        return (
            str(self.virtual_workspace_path.expanduser())
            if self.virtual_workspace_path != self.workspace
            else str(self.workspace.expanduser().resolve())
        )

    def _get_identity(self) -> str:
        """Get the core identity section (includes persona + runtime info)."""
        system = platform.system()
        runtime = f"{'macOS' if system == 'Darwin' else system} {platform.machine()}, Python {platform.python_version()}"

        return render_template(
            "agent/identity.md",
            workspace_path=self._resolve_workspace_path(),
            runtime=runtime,
            platform_policy=render_template("agent/platform_policy.md", system=system),
        )

    def _get_runtime_section(self) -> str:
        """Get lightweight runtime/workspace metadata without identity persona.

        Used when an agent supplies its own system prompt so it receives
        useful environment information without the global 'You are nanobot'
        identity leaking in.
        """
        workspace_path = self._resolve_workspace_path()
        system = platform.system()
        runtime = f"{'macOS' if system == 'Darwin' else system} {platform.machine()}, Python {platform.python_version()}"
        policy = render_template("agent/platform_policy.md", system=system).strip()

        lines = [
            "# Runtime Environment",
            "",
            f"Runtime: {runtime}",
            f"Workspace: {workspace_path}",
        ]
        if policy:
            lines += ["", policy]
        return "\n".join(lines)

    @staticmethod
    def _build_runtime_context(
        channel: str | None,
        chat_id: str | None,
        timezone: str | None = None,
    ) -> str:
        """Build untrusted runtime metadata block for injection before the user message."""
        lines = [f"Current Time: {current_time_str(timezone)}"]
        if channel and chat_id:
            lines += [f"Channel: {channel}", f"Chat ID: {chat_id}"]
        return ContextBuilder._RUNTIME_CONTEXT_TAG + "\n" + "\n".join(lines)

    @staticmethod
    def _merge_message_content(left: Any, right: Any) -> str | list[dict[str, Any]]:
        if isinstance(left, str) and isinstance(right, str):
            return f"{left}\n\n{right}" if left else right

        def _to_blocks(value: Any) -> list[dict[str, Any]]:
            if isinstance(value, list):
                return [item if isinstance(item, dict) else {"type": "text", "text": str(item)} for item in value]
            if value is None:
                return []
            return [{"type": "text", "text": str(value)}]

        return _to_blocks(left) + _to_blocks(right)

    def _load_bootstrap_files(self, *, skip_identity: bool = False) -> str:
        """Load bootstrap files from workspace.

        When *skip_identity* is ``True``, files in ``_IDENTITY_BOOTSTRAP_FILES``
        (e.g. ``SOUL.md``) are skipped so an agent-defined system prompt can
        establish its own identity without being overridden by the global one.
        """
        parts = []

        for filename in self.BOOTSTRAP_FILES:
            if skip_identity and filename in self._IDENTITY_BOOTSTRAP_FILES:
                continue
            file_path = self.workspace / filename
            if file_path.exists():
                content = file_path.read_text(encoding="utf-8")
                parts.append(f"## {filename}\n\n{content}")

        return "\n\n".join(parts) if parts else ""

    def build_messages(
        self,
        history: list[dict[str, Any]],
        current_message: str,
        skill_names: list[str] | None = None,
        extra_system_prompt: str | None = None,
        include_workspace_memory: bool = True,
        memory_sections: list[tuple[str, str]] | None = None,
        media: list[str] | None = None,
        channel: str | None = None,
        chat_id: str | None = None,
        current_role: str = "user",
    ) -> list[dict[str, Any]]:
        """Build the complete message list for an LLM call."""
        runtime_ctx = self._build_runtime_context(channel, chat_id, self.timezone)
        user_content = self._build_user_content(current_message, media)

        # Merge runtime context and user content into a single user message
        # to avoid consecutive same-role messages that some providers reject.
        if isinstance(user_content, str):
            merged = f"{runtime_ctx}\n\n{user_content}"
        else:
            merged = [{"type": "text", "text": runtime_ctx}] + user_content

        messages = [
            {
                "role": "system",
                "content": self.build_system_prompt(
                    skill_names,
                    extra_system_prompt,
                    include_workspace_memory=include_workspace_memory,
                    memory_sections=memory_sections,
                ),
            },
            *history,
        ]
        if messages[-1].get("role") == current_role:
            last = dict(messages[-1])
            last["content"] = self._merge_message_content(last.get("content"), merged)
            messages[-1] = last
            return messages
        messages.append({"role": current_role, "content": merged})
        return messages

    def _build_user_content(self, text: str, media: list[str] | None) -> str | list[dict[str, Any]]:
        """Build user message content with optional base64-encoded images."""
        if not media:
            return text

        images = []
        for path in media:
            p = Path(path)
            if not p.is_file():
                continue
            raw = p.read_bytes()
            # Detect real MIME type from magic bytes; fallback to filename guess
            mime = detect_image_mime(raw) or mimetypes.guess_type(path)[0]
            if not mime or not mime.startswith("image/"):
                continue
            b64 = base64.b64encode(raw).decode()
            images.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
                "_meta": {"path": str(p)},
            })

        if not images:
            return text
        return images + [{"type": "text", "text": text}]

    def add_tool_result(
        self, messages: list[dict[str, Any]],
        tool_call_id: str, tool_name: str, result: Any,
    ) -> list[dict[str, Any]]:
        """Add a tool result to the message list."""
        messages.append({"role": "tool", "tool_call_id": tool_call_id, "name": tool_name, "content": result})
        return messages

    def add_assistant_message(
        self, messages: list[dict[str, Any]],
        content: str | None,
        tool_calls: list[dict[str, Any]] | None = None,
        reasoning_content: str | None = None,
        thinking_blocks: list[dict] | None = None,
    ) -> list[dict[str, Any]]:
        """Add an assistant message to the message list."""
        messages.append(build_assistant_message(
            content,
            tool_calls=tool_calls,
            reasoning_content=reasoning_content,
            thinking_blocks=thinking_blocks,
        ))
        return messages
