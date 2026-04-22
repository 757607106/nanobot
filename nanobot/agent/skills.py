"""Skills loader for agent capabilities."""

from dataclasses import dataclass
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

# Default builtin skills directory (relative to this file)
BUILTIN_SKILLS_DIR = Path(__file__).parent.parent / "skills"

# Opening ---, YAML body (group 1), closing --- on its own line; supports CRLF.
_STRIP_SKILL_FRONTMATTER = re.compile(
    r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n?",
    re.DOTALL,
)


def _escape_xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


@dataclass(frozen=True, slots=True)
class _SkillDocument:
    """Cached parsed skill document."""

    path: Path
    signature: tuple[bool, int, int]
    content: str
    metadata: dict[str, str] | None
    nanobot_meta: dict[str, Any]


class SkillsLoader:
    """
    Loader for agent skills.

    Skills are markdown files (SKILL.md) that teach the agent how to use
    specific tools or perform certain tasks.
    """

    def __init__(self, workspace: Path, builtin_skills_dir: Path | None = None, disabled_skills: set[str] | None = None):
        self.workspace = workspace
        self.workspace_skills = workspace / "skills"
        self.builtin_skills = builtin_skills_dir or BUILTIN_SKILLS_DIR
        self.disabled_skills = disabled_skills or set()
        self._catalog_cache: tuple[tuple[tuple[str, str, str, int, int], ...], list[dict[str, str]]] | None = None
        self._entry_map: dict[str, dict[str, str]] = {}
        self._document_cache: dict[str, _SkillDocument] = {}
        self._context_cache: dict[tuple[tuple[tuple[str, str, str, int, int], ...], tuple[str, ...]], str] = {}
        self._summary_cache: tuple[tuple[Any, ...], str] | None = None
        self._always_cache: tuple[tuple[Any, ...], list[str]] | None = None

    @staticmethod
    def _file_signature(path: Path) -> tuple[bool, int, int]:
        try:
            stat = path.stat()
        except FileNotFoundError:
            return False, 0, 0
        return True, stat.st_mtime_ns, stat.st_size

    def _catalog_snapshot_and_entries(self) -> tuple[tuple[tuple[str, str, str, int, int], ...], list[dict[str, str]]]:
        skills = self._skill_entries_from_dir(self.workspace_skills, "workspace")
        workspace_names = {entry["name"] for entry in skills}
        if self.builtin_skills and self.builtin_skills.exists():
            skills.extend(
                self._skill_entries_from_dir(self.builtin_skills, "builtin", skip_names=workspace_names)
            )

        if self.disabled_skills:
            skills = [entry for entry in skills if entry["name"] not in self.disabled_skills]

        snapshot = tuple(
            (
                entry["name"],
                entry["source"],
                entry["path"],
                *self._file_signature(Path(entry["path"]))[1:],
            )
            for entry in skills
        )
        return snapshot, skills

    def _catalog_entries(
        self,
        *,
        refresh: bool = False,
    ) -> tuple[list[dict[str, str]], tuple[tuple[str, str, str, int, int], ...]]:
        if self._catalog_cache is None or refresh:
            snapshot, entries = self._catalog_snapshot_and_entries()
            if self._catalog_cache is None or self._catalog_cache[0] != snapshot:
                visible_names = {entry["name"] for entry in entries}
                stale = [name for name in self._document_cache if name not in visible_names]
                for name in stale:
                    self._document_cache.pop(name, None)
                self._context_cache.clear()
                self._summary_cache = None
                self._always_cache = None
                self._catalog_cache = (snapshot, entries)
                self._entry_map = {entry["name"]: entry for entry in entries}
        return self._catalog_cache[1], self._catalog_cache[0]

    def catalog_signature(self) -> tuple[tuple[str, str, str, int, int], ...]:
        """Return a stable snapshot of visible skills for prompt-cache invalidation."""
        _, snapshot = self._catalog_entries(refresh=True)
        return snapshot

    def _requirements_signature(
        self,
        *,
        refresh_catalog: bool,
    ) -> tuple[tuple[str, bool, str], ...]:
        entries, _ = self._catalog_entries(refresh=refresh_catalog)
        signature: list[tuple[str, bool, str]] = []
        for entry in entries:
            meta = self._get_skill_meta(entry["name"])
            available = self._check_requirements(meta)
            signature.append(
                (
                    entry["name"],
                    available,
                    "" if available else self._get_missing_requirements(meta),
                )
            )
        return tuple(signature)

    def requirements_signature(self) -> tuple[tuple[str, bool, str], ...]:
        """Return current availability state for visible skills."""
        return self._requirements_signature(refresh_catalog=True)

    @staticmethod
    def _parse_frontmatter(content: str) -> dict[str, str] | None:
        if not content or not content.startswith("---"):
            return None
        match = _STRIP_SKILL_FRONTMATTER.match(content)
        if not match:
            return None
        metadata: dict[str, str] = {}
        for line in match.group(1).splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip().strip('"\'')
        return metadata

    def _resolve_skill_entry(
        self,
        name: str,
        *,
        refresh_catalog: bool = False,
    ) -> dict[str, str] | None:
        self._catalog_entries(refresh=refresh_catalog)
        return self._entry_map.get(name)

    def _get_skill_document(
        self,
        name: str,
        *,
        refresh_catalog: bool = False,
    ) -> _SkillDocument | None:
        entry = self._resolve_skill_entry(name, refresh_catalog=refresh_catalog)
        if entry is None:
            self._document_cache.pop(name, None)
            return None

        path = Path(entry["path"])
        signature = self._file_signature(path)
        cached = self._document_cache.get(name)
        if cached is not None and cached.path == path and cached.signature == signature:
            return cached

        try:
            content = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            self._document_cache.pop(name, None)
            return None

        metadata = self._parse_frontmatter(content)
        document = _SkillDocument(
            path=path,
            signature=signature,
            content=content,
            metadata=metadata,
            nanobot_meta=self._parse_nanobot_metadata((metadata or {}).get("metadata", "")),
        )
        self._document_cache[name] = document
        return document

    def _list_skills(
        self,
        filter_unavailable: bool,
        *,
        refresh_catalog: bool,
    ) -> list[dict[str, str]]:
        skills, _ = self._catalog_entries(refresh=refresh_catalog)
        if filter_unavailable:
            return [
                dict(skill)
                for skill in skills
                if self._check_requirements(self._get_skill_meta(skill["name"]))
            ]
        return [dict(skill) for skill in skills]

    def _skill_entries_from_dir(self, base: Path, source: str, *, skip_names: set[str] | None = None) -> list[dict[str, str]]:
        if not base.exists():
            return []
        entries: list[dict[str, str]] = []
        for skill_dir in base.iterdir():
            if not skill_dir.is_dir():
                continue
            skill_file = skill_dir / "SKILL.md"
            if not skill_file.exists():
                continue
            name = skill_dir.name
            if skip_names is not None and name in skip_names:
                continue
            entries.append({"name": name, "path": str(skill_file), "source": source})
        return entries

    def list_skills(self, filter_unavailable: bool = True) -> list[dict[str, str]]:
        """
        List all available skills.

        Args:
            filter_unavailable: If True, filter out skills with unmet requirements.

        Returns:
            List of skill info dicts with 'name', 'path', 'source'.
        """
        return self._list_skills(filter_unavailable, refresh_catalog=True)

    def load_skill(self, name: str) -> str | None:
        """
        Load a skill by name.

        Args:
            name: Skill name (directory name).

        Returns:
            Skill content or None if not found.
        """
        document = self._get_skill_document(name, refresh_catalog=True)
        return document.content if document is not None else None

    def load_skills_for_context(self, skill_names: list[str]) -> str:
        """
        Load specific skills for inclusion in agent context.

        Args:
            skill_names: List of skill names to load.

        Returns:
            Formatted skills content.
        """
        _, catalog_signature = self._catalog_entries(refresh=True)
        cache_key = (catalog_signature, tuple(skill_names))
        cached = self._context_cache.get(cache_key)
        if cached is not None:
            return cached

        parts = [
            f"### Skill: {name}\n\n{self._strip_frontmatter(document.content)}"
            for name in skill_names
            if (document := self._get_skill_document(name))
        ]
        rendered = "\n\n---\n\n".join(parts)
        self._context_cache[cache_key] = rendered
        return rendered

    def build_skills_summary(self) -> str:
        """
        Build a summary of all skills (name, description, path, availability).

        This is used for progressive loading - the agent can read the full
        skill content using read_file when needed.

        Returns:
            XML-formatted skills summary.
        """
        all_skills = self._list_skills(filter_unavailable=False, refresh_catalog=True)
        if not all_skills:
            return ""

        _, catalog_signature = self._catalog_entries()
        requirements_items = self._requirements_signature(refresh_catalog=False)
        requirements = {
            name: (available, missing)
            for name, available, missing in requirements_items
        }
        cache_key: tuple[Any, ...] = (catalog_signature, requirements_items)
        if self._summary_cache is not None and self._summary_cache[0] == cache_key:
            return self._summary_cache[1]

        lines: list[str] = ["<skills>"]
        for entry in all_skills:
            skill_name = entry["name"]
            available, missing = requirements.get(skill_name, (True, ""))
            lines.extend(
                [
                    f'  <skill available="{str(available).lower()}">',
                    f"    <name>{_escape_xml(skill_name)}</name>",
                    f"    <description>{_escape_xml(self._get_skill_description(skill_name))}</description>",
                    f"    <location>{entry['path']}</location>",
                ]
            )
            if not available:
                if missing:
                    lines.append(f"    <requires>{_escape_xml(missing)}</requires>")
            lines.append("  </skill>")
        lines.append("</skills>")
        rendered = "\n".join(lines)
        self._summary_cache = (cache_key, rendered)
        return rendered

    def _get_missing_requirements(self, skill_meta: dict) -> str:
        """Get a description of missing requirements."""
        requires = skill_meta.get("requires", {})
        required_bins = requires.get("bins", [])
        required_env_vars = requires.get("env", [])
        return ", ".join(
            [f"CLI: {command_name}" for command_name in required_bins if not shutil.which(command_name)]
            + [f"ENV: {env_name}" for env_name in required_env_vars if not os.environ.get(env_name)]
        )

    def _get_skill_description(self, name: str) -> str:
        """Get the description of a skill from its frontmatter."""
        document = self._get_skill_document(name, refresh_catalog=True)
        meta = document.metadata if document is not None else None
        if meta and meta.get("description"):
            return meta["description"]
        return name  # Fallback to skill name

    def _strip_frontmatter(self, content: str) -> str:
        """Remove YAML frontmatter from markdown content."""
        if not content.startswith("---"):
            return content
        match = _STRIP_SKILL_FRONTMATTER.match(content)
        if match:
            return content[match.end():].strip()
        return content

    def _parse_nanobot_metadata(self, raw: str) -> dict:
        """Parse skill metadata JSON from frontmatter (supports nanobot and openclaw keys)."""
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return {}
        if not isinstance(data, dict):
            return {}
        payload = data.get("nanobot", data.get("openclaw", {}))
        return payload if isinstance(payload, dict) else {}

    def _check_requirements(self, skill_meta: dict) -> bool:
        """Check if skill requirements are met (bins, env vars)."""
        requires = skill_meta.get("requires", {})
        required_bins = requires.get("bins", [])
        required_env_vars = requires.get("env", [])
        return all(shutil.which(cmd) for cmd in required_bins) and all(
            os.environ.get(var) for var in required_env_vars
        )

    def _get_skill_meta(self, name: str) -> dict:
        """Get nanobot metadata for a skill (cached in frontmatter)."""
        document = self._get_skill_document(name)
        return dict(document.nanobot_meta) if document is not None else {}

    def get_always_skills(self) -> list[str]:
        """Get skills marked as always=true that meet requirements."""
        available_skills = self._list_skills(filter_unavailable=True, refresh_catalog=True)
        _, catalog_signature = self._catalog_entries()
        requirements_items = self._requirements_signature(refresh_catalog=False)
        cache_key: tuple[Any, ...] = (catalog_signature, requirements_items)
        if self._always_cache is not None and self._always_cache[0] == cache_key:
            return list(self._always_cache[1])

        always = [
            entry["name"]
            for entry in available_skills
            if (document := self._get_skill_document(entry["name"]))
            and (
                document.nanobot_meta.get("always")
                or (document.metadata or {}).get("always")
            )
        ]
        self._always_cache = (cache_key, always)
        return list(always)

    def get_skill_metadata(self, name: str) -> dict | None:
        """
        Get metadata from a skill's frontmatter.

        Args:
            name: Skill name.

        Returns:
            Metadata dict or None.
        """
        document = self._get_skill_document(name, refresh_catalog=True)
        if document is None or document.metadata is None:
            return None
        return dict(document.metadata)
