# nanobot Skills

This directory contains built-in skills that extend nanobot's capabilities.

Current Web UI marketplace behavior is documented in [`docs/skills-marketplace.md`](../../docs/skills-marketplace.md).

## Skill Format

Each skill is a directory containing a `SKILL.md` file with:
- YAML frontmatter (name, description, metadata)
- Markdown instructions for the agent

`SKILL.md` is also the minimum install contract for the current Web UI:

- SkillHub remote installs require a single-skill ZIP with exactly one `SKILL.md`
- Manual ZIP uploads require a single-skill ZIP with exactly one `SKILL.md`
- Manual folder uploads must resolve to one skill folder that contains `SKILL.md`

Important: in the current product, "installed" only means the skill was imported into the workspace and can be discovered by the loader. It does **not** guarantee that the skill is fully adapted to nanobot's runtime model.

## Attribution

These skills are adapted from [OpenClaw](https://github.com/openclaw/openclaw)'s skill system.
The skill format and metadata structure follow OpenClaw's conventions to maintain compatibility.

That compatibility is mainly at the `SKILL.md` instruction format level. nanobot does not automatically execute other agent runtimes' hook systems, session tools, or platform-specific config directories.

## Available Skills

| Skill | Description |
|-------|-------------|
| `github` | Interact with GitHub using the `gh` CLI |
| `weather` | Get weather info using wttr.in and Open-Meteo |
| `summarize` | Summarize URLs, files, and YouTube videos |
| `tmux` | Remote-control tmux sessions |
| `clawhub` | Search and install skills from ClawHub registry |
| `skill-creator` | Create new skills |
