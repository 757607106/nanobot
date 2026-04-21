"""Agent memory store, token-pressure consolidation, and long-term memory upkeep."""

from __future__ import annotations

import asyncio
import re
import weakref
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from loguru import logger

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


_RUNTIME_CONTEXT_RE = re.compile(
    r"\[Runtime Context[^\n]*\]\n.*?\n\[/Runtime Context\]\s*",
    re.DOTALL,
)
_SHARED_MEMORY_LOCKS: weakref.WeakValueDictionary[str, asyncio.Lock] = (
    weakref.WeakValueDictionary()
)


def _memory_lock_for(workspace: Path) -> asyncio.Lock:
    key = str(Path(workspace).resolve())
    return _SHARED_MEMORY_LOCKS.setdefault(key, asyncio.Lock())


def _normalize_markdown_document(content: str) -> str:
    stripped = str(content or "").strip()
    return f"{stripped}\n" if stripped else ""


def _extract_tagged_section(text: str, name: str) -> str | None:
    match = re.search(rf"\[{name}\]\s*(.*?)\s*\[/{name}\]", text, flags=re.DOTALL)
    if not match:
        return None
    value = match.group(1).strip()
    return value or None


def _flatten_message_content(content: Any) -> str:
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        text = "\n".join(part for part in parts if part)
    elif content is None:
        text = ""
    else:
        text = str(content)
    text = _RUNTIME_CONTEXT_RE.sub("", text)
    return (strip_think(text) or text).strip()


def _format_turn_transcript(
    messages: list[dict[str, Any]],
    *,
    max_chars: int = 12_000,
    max_message_chars: int = 2_000,
) -> str:
    lines: list[str] = []
    for message in messages:
        role = str(message.get("role", "")).lower()
        if role not in {"user", "assistant", "tool"}:
            continue
        if role == "tool":
            name = str(message.get("name") or "tool").strip() or "tool"
            lines.append(f"TOOL {name}: used")
            continue
        content = _flatten_message_content(message.get("content"))
        if len(content) > max_message_chars:
            content = f"{content[:max_message_chars].rstrip()}..."
        tool_calls = message.get("tool_calls") or []
        tool_names = [
            str(call.get("function", {}).get("name") or call.get("name") or "").strip()
            for call in tool_calls
            if isinstance(call, dict)
        ]
        tool_hint = ""
        tool_names = [name for name in tool_names if name]
        if tool_names:
            tool_hint = f" [tool_calls: {', '.join(tool_names)}]"
        label = role.upper()
        if content:
            lines.append(f"{label}{tool_hint}: {content}")
        elif tool_hint:
            lines.append(f"{label}{tool_hint}")
    transcript = "\n".join(lines).strip()
    if len(transcript) > max_chars:
        transcript = f"...\n{transcript[-max_chars:]}"
    return transcript


def _fallback_daily_note(turn_messages: list[dict[str, Any]]) -> str:
    transcript = _format_turn_transcript(turn_messages, max_chars=4_000, max_message_chars=1_000)
    if not transcript:
        return "Conversation completed."
    return f"## Conversation Snapshot\n\n{transcript}"


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
        self.dreams_file = self.workspace / "DREAMS.md"
        self._cursor_file = self.memory_dir / ".cursor"
        self._dream_cursor_file = self.memory_dir / ".dream_cursor"
        self._git = GitStore(
            self.workspace,
            tracked_files=[
                "AGENTS.md",
                "SOUL.md",
                "PROFILE.md",
                "MEMORY.md",
                "DREAMS.md",
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

    def read_dreams(self) -> str:
        return self.read_file(self.dreams_file)

    def write_dreams(self, content: str) -> None:
        self.dreams_file.write_text(content, encoding="utf-8")

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

    def append_dream_entry(self, entry: str, *, timestamp: datetime | None = None) -> None:
        when = timestamp or datetime.now()
        content = strip_think(entry.rstrip()) or entry.rstrip()
        heading = f"## {when.strftime('%Y-%m-%d %H:%M')}"
        block = f"{heading}\n\n{content}\n"
        if self.dreams_file.exists() and self.dreams_file.stat().st_size > 0:
            block = f"\n{block}"
        with open(self.dreams_file, "a", encoding="utf-8") as handle:
            handle.write(block)

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


class PostConversationMemoryExtractor:
    """Extract durable facts from the latest turn into long-term memory files."""

    def __init__(
        self,
        store: MemoryStore,
        provider: LLMProvider,
        model: str,
    ):
        self.store = store
        self.provider = provider
        self.model = model

    async def run(self, turn_messages: list[dict[str, Any]]) -> bool:
        transcript = _format_turn_transcript(turn_messages)
        if not transcript:
            return False

        lock = _memory_lock_for(self.store.workspace)
        async with lock:
            current_profile_raw = self.store.read_profile()
            current_memory_raw = self.store.read_memory()
            current_profile = _normalize_markdown_document(current_profile_raw)
            current_memory = _normalize_markdown_document(current_memory_raw)

            prompt = "\n\n".join(
                [
                    f"## Current Date\n{datetime.now().strftime('%Y-%m-%d')}",
                    f"## Current PROFILE.md\n{current_profile or '(empty)'}",
                    f"## Current MEMORY.md\n{current_memory or '(empty)'}",
                    f"## Latest Turn Transcript\n{transcript}",
                ]
            )

            try:
                response = await self.provider.chat_with_retry(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": render_template(
                                "agent/post_conversation_extract.md",
                                strip=True,
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    tools=None,
                    tool_choice=None,
                )
            except Exception:
                logger.exception("Post-conversation extraction failed")
                self.store.append_daily_note(_fallback_daily_note(turn_messages))
                return True

            content = response.content or ""
            profile_section = _extract_tagged_section(content, "PROFILE")
            memory_section = _extract_tagged_section(content, "MEMORY")
            daily_note = _extract_tagged_section(content, "DAILY_NOTE") or _fallback_daily_note(
                turn_messages
            )

            updated_profile = (
                _normalize_markdown_document(profile_section)
                if profile_section is not None
                else current_profile
            )
            updated_memory = (
                _normalize_markdown_document(memory_section)
                if memory_section is not None
                else current_memory
            )

            changed = False
            if updated_profile and updated_profile != current_profile:
                self.store.write_profile(updated_profile)
                changed = True
            if updated_memory and updated_memory != current_memory:
                self.store.write_memory(updated_memory)
                changed = True

            self.store.append_daily_note(daily_note)
            return changed or bool(daily_note.strip())


class Dream:
    """Periodic emergence that consolidates daily notes into MEMORY.md."""

    def __init__(
        self,
        store: MemoryStore,
        provider: LLMProvider,
        model: str,
        max_batch_size: int = 20,
    ):
        self.store = store
        self.provider = provider
        self.model = model
        self.max_batch_size = max_batch_size

    async def run(self) -> bool:
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

        lock = _memory_lock_for(self.store.workspace)
        async with lock:
            current_profile = _normalize_markdown_document(self.store.read_profile())
            current_memory = _normalize_markdown_document(self.store.read_memory())
            prompt = "\n\n".join(
                [
                    f"## Current Date\n{datetime.now().strftime('%Y-%m-%d')}",
                    f"## Current PROFILE.md (read-only context)\n{current_profile or '(empty)'}",
                    f"## Current MEMORY.md\n{current_memory or '(empty)'}",
                    f"## Recent Daily Notes\n{notes_text}",
                ]
            )

            try:
                response = await self.provider.chat_with_retry(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": render_template(
                                "agent/dream_emergence.md",
                                strip=True,
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    tools=None,
                    tool_choice=None,
                )
            except Exception:
                logger.exception("Dream emergence failed")
                return False

            content = response.content or ""
            memory_section = _extract_tagged_section(content, "MEMORY")
            dream_summary = _extract_tagged_section(content, "DREAM")
            if memory_section is None:
                logger.warning("Dream skipped: missing MEMORY section")
                return False

            updated_memory = _normalize_markdown_document(memory_section)
            changed = updated_memory != current_memory
            if changed:
                self.store.write_memory(updated_memory)
                summary = (dream_summary or "Updated MEMORY.md from recent daily notes.").strip()
                first_cursor = batch[0]["cursor"]
                last_processed = batch[-1]["cursor"]
                self.store.append_dream_entry(
                    "\n".join(
                        [
                            f"- Processed note cursors: #{first_cursor} -> #{last_processed}",
                            f"- Note count: {len(batch)}",
                            f"- Summary: {summary}",
                        ]
                    )
                )
            self.store.set_last_dream_cursor(batch[-1]["cursor"])

            if changed and self.store.git.is_initialized():
                sha = self.store.git.auto_commit(
                    f"dream: {batch[-1]['timestamp']}, memory update"
                )
                if sha:
                    logger.info("Dream commit: {}", sha)

            logger.info(
                "Dream done: changed={}, cursor advanced to {}",
                changed,
                batch[-1]["cursor"],
            )
            return True
