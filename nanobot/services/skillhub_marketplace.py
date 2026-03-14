"""Official SkillHub marketplace integration for remote skill discovery and install."""

from __future__ import annotations

import io
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import httpx

SKILLHUB_INDEX_URL = "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json"
SKILLHUB_SEARCH_URL = "http://lb-3zbg86f6-0gwe3n7q8t4sv2za.clb.gz-tencentclb.com/api/v1/search"
SKILLHUB_PRIMARY_DOWNLOAD_URL_TEMPLATE = (
    "http://lb-3zbg86f6-0gwe3n7q8t4sv2za.clb.gz-tencentclb.com/api/v1/download?slug={slug}"
)
SKILLHUB_FALLBACK_DOWNLOAD_URL_TEMPLATE = (
    "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills/{slug}.zip"
)

_SKILL_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_COMPATIBILITY_LABELS = {
    "native": "原生可用",
    "partial": "部分兼容",
    "unsupported": "不建议安装",
    "unknown": "待验证",
}
_UNSUPPORTED_CONTENT_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"\bsessions_(?:list|history|send|spawn)\b", re.IGNORECASE),
        "说明里要求 `sessions_*` 会话工具，nanobot 当前没有这组运行时工具。",
    ),
    (
        re.compile(r"\b(?:openclaw|claude|codex)\s+hooks?\s+enable\b", re.IGNORECASE),
        "说明里要求启用平台 hooks，nanobot 当前没有通用 skill hook 运行时。",
    ),
)
_PARTIAL_CONTENT_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"openclaw is the primary platform", re.IGNORECASE),
        "技能说明把 OpenClaw 标成主平台，通常意味着行为是按其他 agent 运行时设计的。",
    ),
    (
        re.compile(r"~/(?:\.openclaw|\.claude|\.codex)/", re.IGNORECASE),
        "安装路径写死为其他 agent 的用户目录，需要额外改造后才能自然接入 nanobot。",
    ),
    (
        re.compile(r"\.(?:openclaw|claude|codex)/", re.IGNORECASE),
        "技能说明包含其他 agent 的目录约定，nanobot 不会自动执行这些目录下的配置或 hooks。",
    ),
)
_ARCHIVE_PATH_RULES: tuple[tuple[str, str], ...] = (
    (
        "hooks/openclaw/",
        "技能包包含 OpenClaw hooks 目录，nanobot 只会读取 `SKILL.md`，不会自动执行这些 hooks。",
    ),
    (
        "hooks/claude/",
        "技能包包含 Claude hooks 目录，nanobot 不会自动执行这些 hooks。",
    ),
    (
        "hooks/codex/",
        "技能包包含 Codex hooks 目录，nanobot 不会自动执行这些 hooks。",
    ),
    (
        ".openclaw/",
        "技能包包含 `.openclaw/` 配置目录，nanobot 当前不会消费这套配置。",
    ),
    (
        ".claude/",
        "技能包包含 `.claude/` 配置目录，nanobot 当前不会消费这套配置。",
    ),
    (
        ".codex/",
        "技能包包含 `.codex/` 配置目录，nanobot 当前不会消费这套配置。",
    ),
)


class SkillHubMarketplaceError(RuntimeError):
    """Raised when SkillHub marketplace operations fail."""


class SkillHubMarketplaceClient:
    """Remote SkillHub client backed by the official public index and download endpoints."""

    def __init__(
        self,
        *,
        index_url: str = SKILLHUB_INDEX_URL,
        search_url: str = SKILLHUB_SEARCH_URL,
        primary_download_url_template: str = SKILLHUB_PRIMARY_DOWNLOAD_URL_TEMPLATE,
        fallback_download_url_template: str = SKILLHUB_FALLBACK_DOWNLOAD_URL_TEMPLATE,
        timeout: float = 20.0,
    ) -> None:
        self.index_url = index_url
        self.search_url = search_url
        self.primary_download_url_template = primary_download_url_template
        self.fallback_download_url_template = fallback_download_url_template
        self.timeout = timeout
        self._compatibility_cache: dict[str, dict[str, Any]] = {}

    def list_skills(self, query: str = "", limit: int = 24) -> list[dict[str, Any]]:
        normalized_query = str(query or "").strip()
        safe_limit = max(1, min(int(limit or 24), 100))

        if normalized_query:
            remote_matches = self._search_remote(normalized_query, safe_limit)
            if remote_matches:
                return [self._with_compatibility(skill) for skill in remote_matches[:safe_limit]]

        skills = self._load_index_skills()
        if normalized_query:
            query_lc = normalized_query.lower()
            scored = []
            for skill in skills:
                score = self._match_score(skill, query_lc)
                if score <= 0:
                    continue
                scored.append((score, skill))
            scored.sort(
                key=lambda item: (
                    -item[0],
                    -int(item[1].get("downloads") or 0),
                    item[1]["name"].lower(),
                )
            )
            return [self._with_compatibility(skill) for _, skill in scored[:safe_limit]]

        skills.sort(
            key=lambda item: (
                -int(item.get("downloads") or 0),
                -int(item.get("updatedAt") or 0),
                item["name"].lower(),
            )
        )
        return [self._with_compatibility(skill) for skill in skills[:safe_limit]]

    def install_skill(self, workspace_root: Path, slug: str, *, force: bool = False) -> dict[str, Any]:
        safe_slug = self.normalize_skill_id(slug)
        target_root = workspace_root.expanduser().resolve() / "skills"
        target_root.mkdir(parents=True, exist_ok=True)
        target_dir = target_root / safe_slug

        archive_bytes = self._download_skill_archive(safe_slug)
        with tempfile.TemporaryDirectory(prefix="nanobot-skillhub-") as tmp_dir:
            extracted_root = Path(tmp_dir)
            self._extract_archive(archive_bytes, extracted_root)
            source_dir = self._resolve_skill_dir(extracted_root)

            if target_dir.exists():
                if not force:
                    raise SkillHubMarketplaceError(f"Skill '{safe_slug}' is already installed.")
                shutil.rmtree(target_dir)

            shutil.copytree(source_dir, target_dir)

        return {"id": safe_slug, "path": str(target_dir)}

    @staticmethod
    def normalize_skill_id(skill_id: str) -> str:
        candidate = str(skill_id or "").strip()
        if not candidate or not _SKILL_ID_RE.fullmatch(candidate):
            raise SkillHubMarketplaceError("Invalid skill id.")
        return candidate

    def _search_remote(self, query: str, limit: int) -> list[dict[str, Any]]:
        try:
            payload = self._get_json(
                self.search_url,
                params={"q": query, "limit": max(1, limit)},
                timeout=min(self.timeout, 8.0),
            )
        except SkillHubMarketplaceError:
            return []

        raw_results = payload.get("results")
        if not isinstance(raw_results, list):
            return []
        results = []
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            normalized = self._normalize_skill(item, default_source="skillhub")
            if normalized:
                results.append(normalized)
        return results

    def _load_index_skills(self) -> list[dict[str, Any]]:
        payload = self._get_json(self.index_url, timeout=self.timeout)
        raw_skills = payload.get("skills")
        if not isinstance(raw_skills, list):
            raise SkillHubMarketplaceError("SkillHub index is missing a skills array.")

        skills = []
        for item in raw_skills:
            if not isinstance(item, dict):
                continue
            normalized = self._normalize_skill(item, default_source="skillhub")
            if normalized:
                skills.append(normalized)
        return skills

    def _download_skill_archive(self, slug: str) -> bytes:
        candidates = [
            self.primary_download_url_template.format(slug=slug),
            self.fallback_download_url_template.format(slug=slug),
        ]
        last_error = "Unknown download error."

        for url in candidates:
            try:
                response = httpx.get(
                    url,
                    headers={"Accept": "application/zip,application/octet-stream,*/*"},
                    follow_redirects=True,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                content = response.content
                if not self._is_zip_bytes(content):
                    raise SkillHubMarketplaceError("Downloaded payload is not a valid zip archive.")
                return content
            except (httpx.HTTPError, SkillHubMarketplaceError) as exc:
                last_error = str(exc)

        raise SkillHubMarketplaceError(
            f"Failed to download skill '{slug}' from SkillHub: {last_error}"
        )

    def _get_json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        timeout: float,
    ) -> dict[str, Any]:
        try:
            response = httpx.get(
                url,
                params=params,
                headers={"Accept": "application/json"},
                follow_redirects=True,
                timeout=timeout,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise SkillHubMarketplaceError(f"Failed to fetch SkillHub data: {exc}") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise SkillHubMarketplaceError("SkillHub returned invalid JSON.") from exc

        if not isinstance(payload, dict):
            raise SkillHubMarketplaceError("SkillHub response must be a JSON object.")
        return payload

    def _normalize_skill(self, item: dict[str, Any], *, default_source: str) -> dict[str, Any] | None:
        slug = str(item.get("slug") or item.get("id") or "").strip()
        if not slug or not _SKILL_ID_RE.fullmatch(slug):
            return None

        tags = item.get("tags") if isinstance(item.get("tags"), list) else []
        stats = item.get("stats") if isinstance(item.get("stats"), dict) else {}
        homepage = str(item.get("homepage") or "").strip() or None
        description = str(
            item.get("description") or item.get("summary") or ""
        ).strip()

        return {
            "id": slug,
            "slug": slug,
            "name": str(item.get("name") or item.get("displayName") or slug).strip() or slug,
            "description": description,
            "version": str(item.get("version") or "").strip() or None,
            "tags": [str(tag).strip() for tag in tags if str(tag).strip()],
            "source": str(item.get("source") or default_source).strip() or default_source,
            "homepage": homepage,
            "updatedAt": int(item.get("updated_at") or 0) or None,
            "downloads": int(
                stats.get("downloads")
                or item.get("downloads")
                or item.get("downloadCount")
                or 0
            )
            or None,
        }

    @staticmethod
    def _skill_search_text(skill: dict[str, Any]) -> str:
        return " ".join(
            [
                str(skill.get("slug") or ""),
                str(skill.get("name") or ""),
                str(skill.get("description") or ""),
                " ".join(skill.get("tags") or []),
            ]
        ).lower()

    def _match_score(self, skill: dict[str, Any], query: str) -> int:
        text = self._skill_search_text(skill)
        if not text:
            return 0
        if query == str(skill.get("slug") or "").lower():
            return 100
        if query == str(skill.get("name") or "").lower():
            return 90
        score = 0
        for part in query.split():
            if part and part in text:
                score += 10
        if query in text:
            score += 20
        return score

    def _with_compatibility(self, skill: dict[str, Any]) -> dict[str, Any]:
        slug = str(skill.get("slug") or skill.get("id") or "").strip()
        if not slug:
            return skill
        compatibility = self._compatibility_cache.get(slug)
        if compatibility is None:
            compatibility = self._inspect_skill_compatibility(slug)
            self._compatibility_cache[slug] = compatibility

        enriched = dict(skill)
        enriched.update(compatibility)
        return enriched

    def _inspect_skill_compatibility(self, slug: str) -> dict[str, Any]:
        try:
            archive_bytes = self._download_skill_archive(slug)
        except SkillHubMarketplaceError as exc:
            return self._compatibility_payload(
                "unknown",
                [
                    "还没拿到技能包本体，当前只能确认它存在于 SkillHub 市场里。",
                    f"兼容性分析失败：{exc}",
                ],
            )

        return self._analyze_skill_archive(slug, archive_bytes)

    def _analyze_skill_archive(self, slug: str, content: bytes) -> dict[str, Any]:
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                members = [info.filename for info in archive.infolist() if not info.is_dir()]
                skill_markdowns = [name for name in members if Path(name).name.lower() == "skill.md"]
                if not skill_markdowns:
                    return self._compatibility_payload(
                        "unsupported",
                        ["技能包缺少 `SKILL.md`，nanobot 无法按技能规范把它加载成可用 skill。"],
                    )
                if len(skill_markdowns) != 1:
                    return self._compatibility_payload(
                        "unsupported",
                        ["技能包里包含多个 `SKILL.md`，nanobot 当前只支持单技能包安装。"],
                    )

                skill_text = archive.read(skill_markdowns[0]).decode("utf-8", errors="replace")
        except zipfile.BadZipFile:
            return self._compatibility_payload(
                "unsupported",
                ["技能下载包不是有效 ZIP，无法验证也无法安全安装。"],
            )

        member_names = [member.lower() for member in members]
        unsupported_reasons = [
            reason for pattern, reason in _UNSUPPORTED_CONTENT_RULES if pattern.search(skill_text)
        ]
        partial_reasons = [
            reason for pattern, reason in _PARTIAL_CONTENT_RULES if pattern.search(skill_text)
        ]
        partial_reasons.extend(
            reason
            for prefix, reason in _ARCHIVE_PATH_RULES
            if any(member.startswith(prefix) or f"/{prefix}" in member for member in member_names)
        )

        if unsupported_reasons:
            return self._compatibility_payload(
                "unsupported",
                self._unique_reasons(
                    [
                        "包含 `SKILL.md`，所以它能被安装并被 nanobot 发现。",
                        *unsupported_reasons,
                        *partial_reasons,
                        "这类 skill 往往不是完全不能读，而是核心行为依赖 nanobot 当前没有接入的专属运行时。",
                    ]
                ),
            )

        if partial_reasons:
            return self._compatibility_payload(
                "partial",
                self._unique_reasons(
                    [
                        "包含 `SKILL.md`，可以安装并出现在 nanobot 的技能列表里。",
                        *partial_reasons,
                        "没有发现会直接阻止加载的结构性问题，但部分行为可能需要手工改造后才会完整生效。",
                    ]
                ),
            )

        return self._compatibility_payload(
            "native",
            [
                "包含标准 `SKILL.md`，可以被 nanobot 技能加载器识别。",
                "未发现 OpenClaw、Claude 或 Codex 专属 hooks、目录约定或 `sessions_*` 依赖。",
            ],
        )

    @staticmethod
    def _compatibility_payload(level: str, reasons: list[str]) -> dict[str, Any]:
        normalized_reasons = SkillHubMarketplaceClient._unique_reasons(reasons)
        label = _COMPATIBILITY_LABELS.get(level, _COMPATIBILITY_LABELS["unknown"])
        return {
            "compatibility": level,
            "compatibilityLabel": label,
            "compatibilitySummary": normalized_reasons[0] if normalized_reasons else label,
            "compatibilityReasons": normalized_reasons[:3],
        }

    @staticmethod
    def _unique_reasons(reasons: list[str]) -> list[str]:
        unique: list[str] = []
        seen: set[str] = set()
        for reason in reasons:
            normalized = str(reason or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            unique.append(normalized)
        return unique

    @staticmethod
    def _is_zip_bytes(content: bytes) -> bool:
        try:
            with zipfile.ZipFile(io.BytesIO(content)):
                return True
        except zipfile.BadZipFile:
            return False

    @staticmethod
    def _extract_archive(content: bytes, destination: Path) -> None:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            for info in archive.infolist():
                member = Path(info.filename)
                if member.is_absolute() or ".." in member.parts:
                    raise SkillHubMarketplaceError(f"Unsafe path found in archive: {info.filename}")
            archive.extractall(destination)

    @staticmethod
    def _resolve_skill_dir(extracted_root: Path) -> Path:
        if (extracted_root / "SKILL.md").exists():
            return extracted_root

        skill_roots = sorted({path.parent for path in extracted_root.rglob("SKILL.md")})
        if len(skill_roots) != 1:
            raise SkillHubMarketplaceError("Downloaded archive must contain exactly one skill.")
        return skill_roots[0]
