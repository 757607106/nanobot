---
name: memory
description: Agent-root memory skeleton with Dream-managed profile, memory, and daily notes.
always: true
---

# Memory

## Structure

- `AGENTS.md` — how this agent should use memory.
- `SOUL.md` — agent identity and tone.
- `PROFILE.md` — stable facts about the user. **Managed by Dream.**
- `MEMORY.md` — project context, decisions, and open loops. **Managed by Dream.**
- `memory/YYYY-MM-DD.md` — append-only daily notes. Prefer the built-in `grep` tool to search them.

## Search Past Events

Daily notes are Markdown files with timestamped sections.

- For broad searches, start with `grep(..., path="memory", glob="*.md", output_mode="count")` or the default `files_with_matches` mode before expanding to full content
- Use `output_mode="content"` plus `context_before` / `context_after` when you need the exact matching lines
- Use `fixed_strings=true` for literal timestamps
- Use `head_limit` / `offset` to page through long histories
- Use `exec` only as a last-resort fallback when the built-in search cannot express what you need

Examples (replace `keyword`):
- `grep(pattern="keyword", path="memory", glob="*.md", case_insensitive=true)`
- `grep(pattern="2026-04-02 10:00", path="memory", glob="*.md", fixed_strings=true)`
- `grep(pattern="keyword", path="memory", glob="*.md", output_mode="count", case_insensitive=true)`
- `grep(pattern="oauth|token", path="memory", glob="*.md", output_mode="content", case_insensitive=true)`

## Important

- Do not edit `PROFILE.md` or `MEMORY.md` unless the user explicitly asks to change long-term memory directly.
- If you notice outdated information, it will be corrected when Dream runs next.
- Users can view Dream's activity with the `/dream-log` command.
