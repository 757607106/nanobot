"""Agent memory store, token-pressure consolidation, and Dream processing."""

from __future__ import annotations

import asyncio
import re
import weakref
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from loguru import logger

from nanobot.agent.runner import AgentRunner, AgentRunSpec
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.utils.gitstore import GitStore
from nanobot.utils.helpers import (
    ensure_dir,
    estimate_message_tokens,
    estimate_prompt_tokens_chain,
    strip_think,
)
from nanobot.utils.prompt_templates import render_template

if TYPE_CHECKING:
    from nanobot.providers.base import LLMProvider
    from nanobot.session.manager import Session, SessionManager


class MemoryStore:
    """File-backed memory rooted at one stable agent workspace."""

    _NOTE_ENTRY_RE = re.compile(
        r"^## (?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \[#(?P<cursor>\d+)\]\s*$",
        re.MULTILINE,
    )

    def __init__(self, workspace: Path):
        self.workspace = Path(workspace)
        self.memory_dir = ensure_dir(self.workspace / "memory")
        self.agents_file = self.workspace / "AGENTS.md"
        self.soul_file = self.workspace / "SOUL.md"
        self.profile_file = self.workspace / "PROFILE.md"
        self.memory_file = self.workspace / "MEMORY.md"
        self._cursor_file = self.memory_dir / ".cursor"
        self._dream_cursor_file = self.memory_dir / ".dream_cursor"
        self._git = GitStore(
            self.workspace,
            tracked_files=[
                "AGENTS.md",
                "SOUL.md",
                "PROFILE.md",
                "MEMORY.md",
            ],
        )

    @property
    def git(self) -> GitStore:
        return self._git

    @staticmethod
    def read_file(path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""

    def read_agents(self) -> str:
        return self.read_file(self.agents_file)

    def write_agents(self, content: str) -> None:
        self.agents_file.write_text(content, encoding="utf-8")

    def read_soul(self) -> str:
        return self.read_file(self.soul_file)

    def write_soul(self, content: str) -> None:
        self.soul_file.write_text(content, encoding="utf-8")

    def read_profile(self) -> str:
        return self.read_file(self.profile_file)

    def write_profile(self, content: str) -> None:
        self.profile_file.write_text(content, encoding="utf-8")

    def read_memory(self) -> str:
        return self.read_file(self.memory_file)

    def write_memory(self, content: str) -> None:
        self.memory_file.write_text(content, encoding="utf-8")

    def note_file_for_date(self, when: datetime | None = None) -> Path:
        stamp = when or datetime.now()
        return self.memory_dir / f"{stamp.strftime('%Y-%m-%d')}.md"

    def list_note_files(self) -> list[Path]:
        return sorted(
            path
            for path in self.memory_dir.glob("*.md")
            if path.name != "HISTORY.md"
        )

    def append_daily_note(self, entry: str, *, timestamp: datetime | None = None) -> int:
        cursor = self._next_cursor()
        when = timestamp or datetime.now()
        target = self.note_file_for_date(when)
        content = strip_think(entry.rstrip()) or entry.rstrip()
        heading = f"## {when.strftime('%Y-%m-%d %H:%M')} [#{cursor}]"
        block = f"{heading}\n\n{content}\n"
        if target.exists() and target.stat().st_size > 0:
            block = f"\n{block}"
        with open(target, "a", encoding="utf-8") as handle:
            handle.write(block)
        self._cursor_file.write_text(str(cursor), encoding="utf-8")
        return cursor

    def read_unprocessed_notes(self, since_cursor: int) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for note_file in self.list_note_files():
            text = self.read_file(note_file)
            if not text.strip():
                continue
            matches = list(self._NOTE_ENTRY_RE.finditer(text))
            for index, match in enumerate(matches):
                start = match.end()
                end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
                cursor = int(match.group("cursor"))
                if cursor <= since_cursor:
                    continue
                body = text[start:end].strip()
                if not body:
                    continue
                entries.append(
                    {
                        "cursor": cursor,
                        "timestamp": match.group("timestamp"),
                        "content": body,
                        "path": str(note_file),
                    }
                )
        return entries

    def _next_cursor(self) -> int:
        if self._cursor_file.exists():
            try:
                return int(self._cursor_file.read_text(encoding="utf-8").strip()) + 1
            except (ValueError, OSError):
                pass
        last_cursor = 0
        for entry in self.read_unprocessed_notes(0):
            last_cursor = max(last_cursor, int(entry["cursor"]))
        return last_cursor + 1

    def get_last_dream_cursor(self) -> int:
        if self._dream_cursor_file.exists():
            try:
                return int(self._dream_cursor_file.read_text(encoding="utf-8").strip())
            except (ValueError, OSError):
                pass
        return 0

    def set_last_dream_cursor(self, cursor: int) -> None:
        self._dream_cursor_file.write_text(str(cursor), encoding="utf-8")

    @staticmethod
    def _format_messages(messages: list[dict]) -> str:
        lines = []
        for message in messages:
            if not message.get("content"):
                continue
            tools = (
                f" [tools: {', '.join(message['tools_used'])}]"
                if message.get("tools_used")
                else ""
            )
            lines.append(
                f"[{message.get('timestamp', '?')[:16]}] "
                f"{message['role'].upper()}{tools}: {message['content']}"
            )
        return "\n".join(lines)

    def raw_archive(self, messages: list[dict]) -> None:
        self.append_daily_note(
            f"[RAW] {len(messages)} messages\n{self._format_messages(messages)}"
        )
        logger.warning(
            "Memory consolidation degraded: raw-archived {} messages",
            len(messages),
        )


class Consolidator:
    """Lightweight token-budget triggered consolidation into daily notes."""

    _MAX_CONSOLIDATION_ROUNDS = 5
    _MAX_CHUNK_MESSAGES = 60
    _SAFETY_BUFFER = 1024

    def __init__(
        self,
        store: MemoryStore,
        provider: LLMProvider,
        model: str,
        sessions: SessionManager,
        context_window_tokens: int,
        build_messages: Callable[..., list[dict[str, Any]]],
        get_tool_definitions: Callable[[], list[dict[str, Any]]],
        max_completion_tokens: int = 4096,
    ):
        self.store = store
        self.provider = provider
        self.model = model
        self.sessions = sessions
        self.context_window_tokens = context_window_tokens
        self.max_completion_tokens = max_completion_tokens
        self._build_messages = build_messages
        self._get_tool_definitions = get_tool_definitions
        self._locks: weakref.WeakValueDictionary[str, asyncio.Lock] = (
            weakref.WeakValueDictionary()
        )

    def get_lock(self, session_key: str) -> asyncio.Lock:
        return self._locks.setdefault(session_key, asyncio.Lock())

    def pick_consolidation_boundary(
        self,
        session: Session,
        tokens_to_remove: int,
    ) -> tuple[int, int] | None:
        start = session.last_consolidated
        if start >= len(session.messages) or tokens_to_remove <= 0:
            return None

        removed_tokens = 0
        last_boundary: tuple[int, int] | None = None
        for idx in range(start, len(session.messages)):
            message = session.messages[idx]
            if idx > start and message.get("role") == "user":
                last_boundary = (idx, removed_tokens)
                if removed_tokens >= tokens_to_remove:
                    return last_boundary
            removed_tokens += estimate_message_tokens(message)

        return last_boundary

    def _cap_consolidation_boundary(
        self,
        session: Session,
        end_idx: int,
    ) -> int | None:
        start = session.last_consolidated
        if end_idx - start <= self._MAX_CHUNK_MESSAGES:
            return end_idx

        capped_end = start + self._MAX_CHUNK_MESSAGES
        for idx in range(capped_end, start, -1):
            if session.messages[idx].get("role") == "user":
                return idx
        return None

    def estimate_session_prompt_tokens(self, session: Session) -> tuple[int, str]:
        history = session.get_history(max_messages=0)
        channel, chat_id = (
            session.key.split(":", 1) if ":" in session.key else (None, None)
        )
        probe_messages = self._build_messages(
            history=history,
            current_message="[token-probe]",
            channel=channel,
            chat_id=chat_id,
        )
        return estimate_prompt_tokens_chain(
            self.provider,
            self.model,
            probe_messages,
            self._get_tool_definitions(),
        )

    async def archive(self, messages: list[dict]) -> str | None:
        if not messages:
            return None
        try:
            formatted = MemoryStore._format_messages(messages)
            response = await self.provider.chat_with_retry(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": render_template(
                            "agent/consolidator_archive.md",
                            strip=True,
                        ),
                    },
                    {"role": "user", "content": formatted},
                ],
                tools=None,
                tool_choice=None,
            )
            summary = response.content or "[no summary]"
            self.store.append_daily_note(summary)
            return summary
        except Exception:
            logger.warning("Consolidation LLM call failed, raw-dumping to notes")
            self.store.raw_archive(messages)
            return None

    async def maybe_consolidate_by_tokens(self, session: Session) -> None:
        if not session.messages:
            return

        context_window_tokens = int(self.context_window_tokens or 0)
        if context_window_tokens <= 0:
            return

        lock = self.get_lock(session.key)
        async with lock:
            budget = (
                context_window_tokens
                - self.max_completion_tokens
                - self._SAFETY_BUFFER
            )
            target = budget // 2
            try:
                estimated, source = self.estimate_session_prompt_tokens(session)
            except Exception:
                logger.exception("Token estimation failed for {}", session.key)
                estimated, source = 0, "error"
            if estimated <= 0:
                return
            if estimated < budget:
                unconsolidated_count = len(session.messages) - session.last_consolidated
                logger.debug(
                    "Token consolidation idle {}: {}/{} via {}, msgs={}",
                    session.key,
                    estimated,
                    context_window_tokens,
                    source,
                    unconsolidated_count,
                )
                return

            for round_num in range(self._MAX_CONSOLIDATION_ROUNDS):
                if estimated <= target:
                    return

                boundary = self.pick_consolidation_boundary(
                    session,
                    max(1, estimated - target),
                )
                if boundary is None:
                    logger.debug(
                        "Token consolidation: no safe boundary for {} (round {})",
                        session.key,
                        round_num,
                    )
                    return

                end_idx = self._cap_consolidation_boundary(session, boundary[0])
                if end_idx is None:
                    logger.debug(
                        "Token consolidation: no capped boundary for {} (round {})",
                        session.key,
                        round_num,
                    )
                    return

                chunk = session.messages[session.last_consolidated:end_idx]
                if not chunk:
                    return

                logger.info(
                    "Token consolidation round {} for {}: {}/{} via {}, chunk={} msgs",
                    round_num,
                    session.key,
                    estimated,
                    context_window_tokens,
                    source,
                    len(chunk),
                )
                if not await self.archive(chunk):
                    return
                session.last_consolidated = end_idx
                self.sessions.save(session)

                try:
                    estimated, source = self.estimate_session_prompt_tokens(session)
                except Exception:
                    logger.exception("Token estimation failed for {}", session.key)
                    estimated, source = 0, "error"
                if estimated <= 0:
                    return


class Dream:
    """Two-phase memory processor over daily notes plus stable memory files."""

    def __init__(
        self,
        store: MemoryStore,
        provider: LLMProvider,
        model: str,
        max_batch_size: int = 20,
        max_iterations: int = 10,
        max_tool_result_chars: int = 16_000,
    ):
        self.store = store
        self.provider = provider
        self.model = model
        self.max_batch_size = max_batch_size
        self.max_iterations = max_iterations
        self.max_tool_result_chars = max_tool_result_chars
        self._runner = AgentRunner(provider)
        self._tools = self._build_tools()

    def _build_tools(self) -> ToolRegistry:
        from nanobot.agent.skills import BUILTIN_SKILLS_DIR
        from nanobot.agent.tools.filesystem import EditFileTool, ReadFileTool, WriteFileTool

        tools = ToolRegistry()
        workspace = self.store.workspace
        extra_read = [BUILTIN_SKILLS_DIR] if BUILTIN_SKILLS_DIR.exists() else None
        tools.register(
            ReadFileTool(
                workspace=workspace,
                allowed_dir=workspace,
                extra_allowed_dirs=extra_read,
            )
        )
        tools.register(EditFileTool(workspace=workspace, allowed_dir=workspace))
        skills_dir = workspace / "skills"
        skills_dir.mkdir(parents=True, exist_ok=True)
        tools.register(WriteFileTool(workspace=workspace, allowed_dir=skills_dir))
        return tools

    def _list_existing_skills(self) -> list[str]:
        import re as _re

        from nanobot.agent.skills import BUILTIN_SKILLS_DIR

        desc_re = _re.compile(
            r"^description:\s*(.+)$",
            _re.MULTILINE | _re.IGNORECASE,
        )
        entries: dict[str, str] = {}
        for base in (self.store.workspace / "skills", BUILTIN_SKILLS_DIR):
            if not base.exists():
                continue
            for directory in base.iterdir():
                if not directory.is_dir():
                    continue
                skill_md = directory / "SKILL.md"
                if not skill_md.exists():
                    continue
                if directory.name in entries and base == BUILTIN_SKILLS_DIR:
                    continue
                content = skill_md.read_text(encoding="utf-8")[:500]
                match = desc_re.search(content)
                entries[directory.name] = (
                    match.group(1).strip() if match else "(no description)"
                )
        return [f"{name} — {desc}" for name, desc in sorted(entries.items())]

    async def run(self) -> bool:
        from nanobot.agent.skills import BUILTIN_SKILLS_DIR

        last_cursor = self.store.get_last_dream_cursor()
        entries = self.store.read_unprocessed_notes(since_cursor=last_cursor)
        if not entries:
            return False

        batch = entries[: self.max_batch_size]
        logger.info(
            "Dream: processing {} note entries (cursor {}→{}), batch={}",
            len(entries),
            last_cursor,
            batch[-1]["cursor"],
            len(batch),
        )

        notes_text = "\n\n".join(
            f"[{entry['timestamp']}] {entry['content']}" for entry in batch
        )

        current_date = datetime.now().strftime("%Y-%m-%d")
        current_agents = self.store.read_agents() or "(empty)"
        current_soul = self.store.read_soul() or "(empty)"
        current_profile = self.store.read_profile() or "(empty)"
        current_memory = self.store.read_memory() or "(empty)"

        file_context = "\n".join(
            [
                f"## Current Date\n{current_date}\n",
                f"## Current AGENTS.md ({len(current_agents)} chars)\n{current_agents}\n",
                f"## Current SOUL.md ({len(current_soul)} chars)\n{current_soul}\n",
                f"## Current PROFILE.md ({len(current_profile)} chars)\n{current_profile}\n",
                f"## Current MEMORY.md ({len(current_memory)} chars)\n{current_memory}",
            ]
        )

        phase1_prompt = f"## Daily Notes\n{notes_text}\n\n{file_context}"

        try:
            phase1_response = await self.provider.chat_with_retry(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": render_template("agent/dream_phase1.md", strip=True),
                    },
                    {"role": "user", "content": phase1_prompt},
                ],
                tools=None,
                tool_choice=None,
            )
            analysis = phase1_response.content or ""
            logger.debug(
                "Dream Phase 1 analysis ({} chars): {}",
                len(analysis),
                analysis[:500],
            )
        except Exception:
            logger.exception("Dream Phase 1 failed")
            return False

        existing_skills = self._list_existing_skills()
        skills_section = ""
        if existing_skills:
            skills_section = "\n\n## Existing Skills\n" + "\n".join(
                f"- {item}" for item in existing_skills
            )
        phase2_prompt = f"## Analysis Result\n{analysis}\n\n{file_context}{skills_section}"
        skill_creator_path = BUILTIN_SKILLS_DIR / "skill-creator" / "SKILL.md"
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": render_template(
                    "agent/dream_phase2.md",
                    strip=True,
                    skill_creator_path=str(skill_creator_path),
                ),
            },
            {"role": "user", "content": phase2_prompt},
        ]

        try:
            result = await self._runner.run(
                AgentRunSpec(
                    initial_messages=messages,
                    tools=self._tools,
                    model=self.model,
                    max_iterations=self.max_iterations,
                    max_tool_result_chars=self.max_tool_result_chars,
                    fail_on_tool_error=False,
                )
            )
            logger.debug(
                "Dream Phase 2 complete: stop_reason={}, tool_events={}",
                result.stop_reason,
                len(result.tool_events),
            )
            for event in result.tool_events or []:
                logger.info(
                    "Dream tool_event: name={}, status={}, detail={}",
                    event.get("name"),
                    event.get("status"),
                    event.get("detail", "")[:200],
                )
        except Exception:
            logger.exception("Dream Phase 2 failed")
            result = None

        changelog = [
            f"{event['name']}: {event['detail']}"
            for event in (result.tool_events or [])
            if event.get("status") == "ok"
        ] if result else []

        new_cursor = batch[-1]["cursor"]
        self.store.set_last_dream_cursor(new_cursor)

        if result and result.stop_reason == "completed":
            logger.info(
                "Dream done: {} change(s), cursor advanced to {}",
                len(changelog),
                new_cursor,
            )
        else:
            logger.warning(
                "Dream incomplete ({}): cursor advanced to {}",
                result.stop_reason if result else "exception",
                new_cursor,
            )

        if changelog and self.store.git.is_initialized():
            sha = self.store.git.auto_commit(
                f"dream: {batch[-1]['timestamp']}, {len(changelog)} change(s)"
            )
            if sha:
                logger.info("Dream commit: {}", sha)

        return True
