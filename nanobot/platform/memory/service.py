"""Service layer for team shared memory and candidate updates."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.memory.models import MemoryCandidate, now_iso
from nanobot.platform.memory.store import TeamMemoryStore
from nanobot.platform.search_scoring import (
    build_preview,
    normalize_mode,
    normalize_query_tokens,
    retrieval_score,
    score_threshold,
)
from nanobot.utils.helpers import safe_filename


class MemoryCandidateNotFoundError(KeyError):
    """Raised when a memory candidate is not found."""


class MemoryCandidateValidationError(ValueError):
    """Raised when a memory request is invalid."""


class TeamMemoryService:
    """Manage team shared memory files and candidate memory updates."""

    def __init__(
        self,
        store: TeamMemoryStore,
        *,
        instance: PlatformInstance,
        instance_id: str,
        tenant_id: str = "default",
        team_lookup: Callable[[str], Any] | None = None,
        team_thread_source_loader: Callable[[str], dict[str, Any] | None] | None = None,
        team_artifact_sources_loader: Callable[[str], list[dict[str, Any]]] | None = None,
    ):
        self.store = store
        self.instance = instance
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.team_lookup = team_lookup
        self.team_thread_source_loader = team_thread_source_loader
        self.team_artifact_sources_loader = team_artifact_sources_loader

    def bind_runtime_sources(
        self,
        *,
        team_thread_source_loader: Callable[[str], dict[str, Any] | None] | None = None,
        team_artifact_sources_loader: Callable[[str], list[dict[str, Any]]] | None = None,
    ) -> None:
        self.team_thread_source_loader = team_thread_source_loader
        self.team_artifact_sources_loader = team_artifact_sources_loader

    @staticmethod
    def _next_candidate_id() -> str:
        return f"memcand_{uuid.uuid4().hex[:12]}"

    @staticmethod
    def _normalize_text(value: Any, *, field_name: str = "value", required: bool = False) -> str:
        text = str(value or "").strip()
        if required and not text:
            raise MemoryCandidateValidationError(f"{field_name} is required.")
        return text

    def _require_team(self, team_id: str) -> str:
        normalized = self._normalize_text(team_id, field_name="teamId", required=True)
        if self.team_lookup is None:
            return normalized
        try:
            self.team_lookup(normalized)
        except Exception as exc:  # pragma: no cover - defensive wrapper around injected lookup
            raise MemoryCandidateValidationError(f"teamId '{normalized}' does not exist.") from exc
        return normalized

    def _team_memory_path(self, team_id: str) -> Path:
        return self.instance.team_memory_dir() / f"{safe_filename(team_id)}.md"

    def _workspace_memory_path(self) -> Path:
        return self.instance.workspace_path() / "memory" / "MEMORY.md"

    @staticmethod
    def _format_candidate_entry(candidate: MemoryCandidate) -> str:
        lines = [f"## {candidate.title}", ""]
        meta = [
            f"- candidate_id: {candidate.candidate_id}",
            f"- source_kind: {candidate.source_kind}",
        ]
        if candidate.team_id:
            meta.append(f"- team_id: {candidate.team_id}")
        if candidate.agent_id:
            meta.append(f"- agent_id: {candidate.agent_id}")
        if candidate.run_id:
            meta.append(f"- run_id: {candidate.run_id}")
        meta.append(f"- created_at: {candidate.created_at}")
        lines.extend(meta)
        lines.extend(["", candidate.content.strip(), ""])
        return "\n".join(lines).strip() + "\n"

    def get_team_memory(self, team_id: str) -> dict[str, Any]:
        team_id = self._require_team(team_id)
        path = self._team_memory_path(team_id)
        content = path.read_text(encoding="utf-8") if path.exists() else ""
        updated_at = now_iso()
        if path.exists():
            updated_at = datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat().replace("+00:00", "Z")
        return {
            "teamId": team_id,
            "content": content,
            "fileName": path.name,
            "candidateCount": self.store.count(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                team_id=team_id,
                status="proposed",
            ),
            "updatedAt": updated_at,
        }

    @staticmethod
    def _team_id_from_thread_id(thread_id: str) -> str | None:
        normalized = str(thread_id or "").strip()
        if normalized.startswith("team-thread:"):
            team_id = normalized.split(":", 1)[1].strip()
            return team_id or None
        return None

    def _load_team_thread_source(self, team_id: str) -> dict[str, Any] | None:
        if self.team_thread_source_loader is None:
            return None
        try:
            source = self.team_thread_source_loader(team_id)
        except Exception:  # pragma: no cover - injected runtime loader
            return None
        if not isinstance(source, dict):
            return None
        content = str(source.get("content") or "").strip()
        if not content:
            return None
        return {
            "sourceType": "team_thread",
            "sourceId": str(source.get("sourceId") or source.get("threadId") or f"team-thread:{team_id}"),
            "title": str(source.get("title") or f"Team Thread · {team_id}"),
            "content": content,
            "metadata": dict(source.get("metadata") or {}),
        }

    def _load_team_artifact_sources(self, team_id: str) -> list[dict[str, Any]]:
        if self.team_artifact_sources_loader is None:
            return []
        try:
            sources = self.team_artifact_sources_loader(team_id)
        except Exception:  # pragma: no cover - injected runtime loader
            return []
        normalized_sources: list[dict[str, Any]] = []
        for source in sources:
            if not isinstance(source, dict):
                continue
            content = str(source.get("content") or "").strip()
            source_id = str(source.get("sourceId") or "").strip()
            if not content or not source_id:
                continue
            normalized_sources.append(
                {
                    "sourceType": "run_artifact",
                    "sourceId": source_id,
                    "title": str(source.get("title") or f"Run Artifact · {source_id}"),
                    "content": content,
                    "metadata": dict(source.get("metadata") or {}),
                }
            )
        return normalized_sources

    def get_memory_source(
        self,
        *,
        source_type: str,
        source_id: str,
        team_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_type = self._normalize_text(source_type, field_name="sourceType", required=True)
        normalized_id = self._normalize_text(source_id, field_name="sourceId", required=True)
        normalized_team_id = self._require_team(team_id) if team_id else None

        if normalized_type == "workspace_memory":
            path = self._workspace_memory_path()
            content = path.read_text(encoding="utf-8") if path.exists() else ""
            return {
                "sourceType": normalized_type,
                "sourceId": "workspace",
                "title": "Workspace Shared Memory",
                "content": content,
                "metadata": {"path": str(path)},
            }

        if normalized_type == "team_memory":
            team_key = normalized_team_id or normalized_id
            snapshot = self.get_team_memory(team_key)
            return {
                "sourceType": normalized_type,
                "sourceId": team_key,
                "title": f"Team Shared Memory · {team_key}",
                "content": snapshot["content"],
                "metadata": {"fileName": snapshot["fileName"], "updatedAt": snapshot["updatedAt"]},
            }

        if normalized_type == "team_thread":
            team_key = normalized_team_id or self._team_id_from_thread_id(normalized_id)
            if not team_key:
                raise MemoryCandidateValidationError("teamId is required for sourceType 'team_thread'.")
            source = self._load_team_thread_source(team_key)
            if source is None:
                raise MemoryCandidateValidationError("Requested team thread source is not available.")
            return source

        if normalized_type == "run_artifact":
            team_key = normalized_team_id
            if not team_key:
                raise MemoryCandidateValidationError("teamId is required for sourceType 'run_artifact'.")
            for source in self._load_team_artifact_sources(team_key):
                if source["sourceId"] == normalized_id:
                    return source
            raise MemoryCandidateValidationError("Requested run artifact source is not available.")

        if normalized_type == "memory_candidate":
            candidate = self.require_candidate(normalized_id)
            return {
                "sourceType": normalized_type,
                "sourceId": candidate.candidate_id,
                "title": candidate.title,
                "content": candidate.content,
                "metadata": {
                    "status": candidate.status,
                    "teamId": candidate.team_id,
                    "agentId": candidate.agent_id,
                    "runId": candidate.run_id,
                },
            }

        raise MemoryCandidateValidationError(f"Unsupported sourceType '{normalized_type}'.")

    def search(
        self,
        *,
        query: str,
        team_id: str | None = None,
        limit: int = 10,
        mode: str | None = None,
    ) -> dict[str, Any]:
        normalized_query = self._normalize_text(query, field_name="query", required=True)
        normalized_mode = normalize_mode(mode, default="hybrid")
        tokens = normalize_query_tokens(normalized_query)
        if not tokens:
            raise MemoryCandidateValidationError("query is required.")
        normalized_team_id = self._require_team(team_id) if team_id else None

        sources: list[dict[str, Any]] = []
        workspace_path = self._workspace_memory_path()
        if workspace_path.exists():
            sources.append(
                {
                    "sourceType": "workspace_memory",
                    "sourceId": "workspace",
                    "title": "Workspace Shared Memory",
                    "content": workspace_path.read_text(encoding="utf-8"),
                    "metadata": {"path": str(workspace_path)},
                }
            )
        if normalized_team_id:
            team_snapshot = self.get_team_memory(normalized_team_id)
            if team_snapshot["content"]:
                sources.append(
                    {
                        "sourceType": "team_memory",
                        "sourceId": normalized_team_id,
                        "title": f"Team Shared Memory · {normalized_team_id}",
                        "content": team_snapshot["content"],
                        "metadata": {"updatedAt": team_snapshot["updatedAt"]},
                    }
                )
            thread_source = self._load_team_thread_source(normalized_team_id)
            if thread_source is not None:
                sources.append(thread_source)
            sources.extend(self._load_team_artifact_sources(normalized_team_id))
        for candidate in self.store.list_all(
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            team_id=normalized_team_id,
            status=None,
            scope="team_shared" if normalized_team_id else None,
            limit=200,
        ):
            # Applied candidates are already merged into team shared memory; searching them again
            # creates duplicate hits with no extra value.
            if candidate.status != "proposed":
                continue
            sources.append(
                {
                    "sourceType": "memory_candidate",
                    "sourceId": candidate.candidate_id,
                    "title": candidate.title,
                    "content": candidate.content,
                    "metadata": {
                        "status": candidate.status,
                        "teamId": candidate.team_id,
                        "agentId": candidate.agent_id,
                        "runId": candidate.run_id,
                    },
                }
            )

        hits: list[dict[str, Any]] = []
        for source in sources:
            content = str(source.get("content") or "")
            if not content.strip():
                continue
            score = retrieval_score(normalized_mode, normalized_query, content, query_tokens=tokens)
            if score <= score_threshold(normalized_mode):
                continue
            hits.append(
                {
                    "sourceType": source["sourceType"],
                    "sourceId": source["sourceId"],
                    "title": source["title"],
                    "content": content,
                    "preview": build_preview(content, tokens),
                    "score": score,
                    "metadata": source.get("metadata") or {},
                }
            )

        hits.sort(key=lambda item: (item["score"], item["title"]), reverse=True)
        return {
            "query": normalized_query,
            "requestedMode": normalized_mode,
            "effectiveMode": normalized_mode,
            "items": hits[:limit],
            "total": len(hits),
        }

    def update_team_memory(self, team_id: str, content: str) -> dict[str, Any]:
        team_id = self._require_team(team_id)
        normalized = self._normalize_text(content)
        path = self._team_memory_path(team_id)
        path.write_text(normalized.rstrip() + ("\n" if normalized else ""), encoding="utf-8")
        return self.get_team_memory(team_id)

    def create_candidate(
        self,
        *,
        scope: str,
        team_id: str | None,
        agent_id: str | None,
        run_id: str | None,
        source_kind: str,
        title: str,
        content: str,
    ) -> dict[str, Any] | None:
        normalized_content = self._normalize_text(content)
        if not normalized_content:
            return None
        normalized_scope = self._normalize_text(scope, field_name="scope", required=True)
        normalized_source_kind = self._normalize_text(source_kind, field_name="sourceKind", required=True)
        normalized_title = self._normalize_text(title, field_name="title", required=True)
        normalized_team_id = self._require_team(team_id) if team_id else None
        candidate = MemoryCandidate(
            candidate_id=self._next_candidate_id(),
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            scope=normalized_scope,
            source_kind=normalized_source_kind,
            title=normalized_title,
            content=normalized_content,
            team_id=normalized_team_id,
            agent_id=self._normalize_text(agent_id) or None,
            run_id=self._normalize_text(run_id) or None,
        )
        return self.store.create(candidate).to_dict()

    def list_candidates(
        self,
        *,
        team_id: str | None = None,
        status: str | None = None,
        scope: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        normalized_team_id = self._require_team(team_id) if team_id else None
        normalized_status = self._normalize_text(status) or None
        normalized_scope = self._normalize_text(scope) or None
        return [
            candidate.to_dict()
            for candidate in self.store.list_all(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                team_id=normalized_team_id,
                status=normalized_status,
                scope=normalized_scope,
                limit=limit,
            )
        ]

    def require_candidate(self, candidate_id: str) -> MemoryCandidate:
        normalized = self._normalize_text(candidate_id, field_name="candidateId", required=True)
        candidate = self.store.get(normalized)
        if candidate is None:
            raise MemoryCandidateNotFoundError(normalized)
        return candidate

    def apply_candidate(self, candidate_id: str) -> dict[str, Any]:
        candidate = self.require_candidate(candidate_id)
        if candidate.scope == "team_shared" and candidate.team_id:
            path = self._team_memory_path(candidate.team_id)
            existing = path.read_text(encoding="utf-8").rstrip() if path.exists() else ""
            entry = self._format_candidate_entry(candidate)
            next_content = f"{existing}\n\n{entry}".strip() + "\n"
            path.write_text(next_content, encoding="utf-8")

        updated = self.store.update_status(
            candidate.candidate_id,
            status="applied",
            updated_at=now_iso(),
            applied_at=now_iso(),
        )
        if updated is None:
            raise MemoryCandidateNotFoundError(candidate.candidate_id)
        return updated.to_dict()

    def reject_candidate(self, candidate_id: str) -> dict[str, Any]:
        candidate = self.require_candidate(candidate_id)
        updated = self.store.update_status(
            candidate.candidate_id,
            status="rejected",
            updated_at=now_iso(),
            applied_at=None,
        )
        if updated is None:
            raise MemoryCandidateNotFoundError(candidate.candidate_id)
        return updated.to_dict()
