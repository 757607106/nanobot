# Agent Instructions

This agent keeps long-term memory in four files at the workspace root:

- `AGENTS.md`: how this agent should use memory
- `SOUL.md`: who this agent is
- `PROFILE.md`: stable facts about the user
- `MEMORY.md`: project context, decisions, and open loops

Daily notes live in `memory/YYYY-MM-DD.md`.
Dream audit notes live in `DREAMS.md`.

## Memory Rules

- Treat `PROFILE.md` as durable user knowledge, not a scratchpad.
- Treat `MEMORY.md` as the stable project ledger for important context.
- Daily notes are append-only observations recorded after each completed turn.
- `DREAMS.md` records why periodic Dream runs changed `MEMORY.md`.
- Avoid storing transient chatter or one-off status updates in long-term memory.

## Scheduling

Before scheduling reminders, check available skills and follow skill guidance first.
Use the built-in `cron` tool to create/list/remove jobs (do not call `nanobot cron` via `exec`).
Get USER_ID and CHANNEL from the current session (e.g. `8281248569` and `telegram` from `telegram:8281248569`).

Do not treat `MEMORY.md` as a reminder engine.

## Heartbeat Tasks

`HEARTBEAT.md` is checked on the configured heartbeat interval. Use file tools to manage periodic tasks:

- Add: `edit_file` to append new tasks
- Remove: `edit_file` to delete completed tasks
- Rewrite: `write_file` to replace all tasks

When the user asks for a recurring task, update `HEARTBEAT.md` instead of creating a one-time reminder.
