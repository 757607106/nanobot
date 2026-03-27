"""Service layer for memory scopes and candidate updates."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.memory.models import MemoryCandidate, now_iso
from nanobot.platform.memory.store import MemoryStore
from nanobot.platform.tenant_scope import call_with_tenant, clone_service_with_overrides
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


class MemoryService:
    """Manage workspace and agent-profile memory files plus candidates."""

    def __init__(
        self,
        store: MemoryStore,
        *,
        instance: PlatformInstance,
        instance_id: str,
        tenant_id: str = "default",
        agent_lookup: Callable[[str], Any] | None = None,
    ):
        self.store = store
        self.instance = instance
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.agent_lookup = agent_lookup

    @staticmethod
    def _next_candidate_id() -> str:
        return f"memcand_{uuid.uuid4().hex[:12]}"

    def with_tenant(self, tenant_id: str | None) -> MemoryService:
        """Return a lightweight tenant-scoped view over the shared memory service."""
        normalized = str(tenant_id or "default").strip() or "default"
        if normalized == self.tenant_id:
            return self
        return clone_service_with_overrides(self, tenant_id=normalized)

    @staticmethod
    def _normalize_text(value: Any, *, field_name: str = "value", required: bool = False) -> str:
        text = str(value or "").strip()
        if required and not text:
            raise MemoryCandidateValidationError(f"{field_name} is required.")
        return text

    def _require_agent(self, agent_id: str) -> str:
        normalized = self._normalize_text(agent_id, field_name="agentId", required=True)
        if self.agent_lookup is None:
            return normalized
        try:
            call_with_tenant(self.agent_lookup, normalized, tenant_id=self.tenant_id)
        except Exception as exc:  # pragma: no cover - defensive wrapper around injected lookup
            raise MemoryCandidateValidationError(f"agentId '{normalized}' does not exist.") from exc
        return normalized

    def _agent_memory_path(self, agent_id: str) -> Path:
        return self.instance.agent_memory_dir() / f"{safe_filename(agent_id)}.md"

    def _workspace_memory_path(self) -> Path:
        return self.instance.workspace_path() / "memory" / "MEMORY.md"

    @staticmethod
    def _format_candidate_entry(candidate: MemoryCandidate) -> str:
        lines = [f"## {candidate.title}", ""]
        meta = [
            f"- candidate_id: {candidate.candidate_id}",
            f"- source_kind: {candidate.source_kind}",
        ]
        if candidate.agent_id:
            meta.append(f"- agent_id: {candidate.agent_id}")
        if candidate.run_id:
            meta.append(f"- run_id: {candidate.run_id}")
        meta.append(f"- created_at: {candidate.created_at}")
        lines.extend(meta)
        lines.extend(["", candidate.content.strip(), ""])
        return "\n".join(lines).strip() + "\n"

    def get_agent_memory(self, agent_id: str) -> dict[str, Any]:
        agent_id = self._require_agent(agent_id)
        path = self._agent_memory_path(agent_id)
        content = path.read_text(encoding="utf-8") if path.exists() else ""
        updated_at = now_iso()
        if path.exists():
            updated_at = datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat().replace("+00:00", "Z")
        return {
            "agentId": agent_id,
            "content": content,
            "fileName": path.name,
            "candidateCount": self.store.count(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                agent_id=agent_id,
                status="proposed",
                scope="agent_profile",
            ),
            "updatedAt": updated_at,
        }

    @staticmethod
    def _sort_candidates(items: list[MemoryCandidate]) -> list[MemoryCandidate]:
        return sorted(
            items,
            key=lambda item: (item.updated_at, item.created_at, item.candidate_id),
            reverse=True,
        )

    def _list_candidate_records(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
        scope: str | None = None,
        limit: int = 100,
    ) -> list[MemoryCandidate]:
        return self.store.list_all(
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            agent_id=agent_id,
            status=status,
            scope=scope,
            limit=limit,
        )

    def get_memory_source(
        self,
        *,
        source_type: str,
        source_id: str,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_type = self._normalize_text(source_type, field_name="sourceType", required=True)
        normalized_id = self._normalize_text(source_id, field_name="sourceId", required=True)
        normalized_agent_id = self._require_agent(agent_id) if agent_id else None

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

        if normalized_type == "agent_profile":
            agent_key = normalized_agent_id or normalized_id
            snapshot = self.get_agent_memory(agent_key)
            return {
                "sourceType": normalized_type,
                "sourceId": agent_key,
                "title": f"Agent Profile Memory \u00b7 {agent_key}",
                "content": snapshot["content"],
                "metadata": {"fileName": snapshot["fileName"], "updatedAt": snapshot["updatedAt"]},
            }

        if normalized_type == "memory_candidate":
            candidate = self.require_candidate(normalized_id)
            return {
                "sourceType": normalized_type,
                "sourceId": candidate.candidate_id,
                "title": candidate.title,
                "content": candidate.content,
                "metadata": {
                    "status": candidate.status,
                    "agentId": candidate.agent_id,
                    "runId": candidate.run_id,
                },
            }

        raise MemoryCandidateValidationError(f"Unsupported sourceType '{normalized_type}'.")

    def search(
        self,
        *,
        query: str,
        agent_id: str | None = None,
        limit: int = 10,
        mode: str | None = None,
    ) -> dict[str, Any]:
        normalized_query = self._normalize_text(query, field_name="query", required=True)
        normalized_mode = normalize_mode(mode, default="hybrid")
        tokens = normalize_query_tokens(normalized_query)
        if not tokens:
            raise MemoryCandidateValidationError("query is required.")
        normalized_agent_id = self._require_agent(agent_id) if agent_id else None

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
        if normalized_agent_id:
            agent_snapshot = self.get_agent_memory(normalized_agent_id)
            if agent_snapshot["content"]:
                sources.append(
                    {
                        "sourceType": "agent_profile",
                        "sourceId": normalized_agent_id,
                        "title": f"Agent Profile Memory \u00b7 {normalized_agent_id}",
                        "content": agent_snapshot["content"],
                        "metadata": {"updatedAt": agent_snapshot["updatedAt"]},
                    }
                )
        candidate_records: list[MemoryCandidate] = []
        if normalized_agent_id:
            candidate_records.extend(
                self.store.list_all(
                    tenant_id=self.tenant_id,
                    instance_id=self.instance_id,
                    agent_id=normalized_agent_id,
                    status=None,
                    scope="agent_profile",
                    limit=200,
                )
            )
        if not normalized_agent_id:
            candidate_records.extend(
                self.store.list_all(
                    tenant_id=self.tenant_id,
                    instance_id=self.instance_id,
                    status=None,
                    limit=200,
                )
            )
        seen_candidate_ids: set[str] = set()
        for candidate in self._sort_candidates(candidate_records):
            if candidate.candidate_id in seen_candidate_ids:
                continue
            seen_candidate_ids.add(candidate.candidate_id)
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

    def update_agent_memory(self, agent_id: str, content: str) -> dict[str, Any]:
        agent_id = self._require_agent(agent_id)
        normalized = self._normalize_text(content)
        path = self._agent_memory_path(agent_id)
        path.write_text(normalized.rstrip() + ("\n" if normalized else ""), encoding="utf-8")
        return self.get_agent_memory(agent_id)

    def create_candidate(
        self,
        *,
        scope: str,
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
        normalized_agent_id = self._require_agent(agent_id) if agent_id else None
        if normalized_scope == "agent_profile" and not normalized_agent_id:
            raise MemoryCandidateValidationError("agentId is required for scope 'agent_profile'.")
        candidate = MemoryCandidate(
            candidate_id=self._next_candidate_id(),
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            scope=normalized_scope,
            source_kind=normalized_source_kind,
            title=normalized_title,
            content=normalized_content,
            agent_id=normalized_agent_id,
            run_id=self._normalize_text(run_id) or None,
        )
        return self.store.create(candidate).to_dict()

    def list_candidates(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
        scope: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        normalized_agent_id = self._require_agent(agent_id) if agent_id else None
        normalized_status = self._normalize_text(status) or None
        normalized_scope = self._normalize_text(scope) or None
        return [
            candidate.to_dict()
            for candidate in self._list_candidate_records(
                agent_id=normalized_agent_id,
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
        if candidate.scope == "agent_profile" and candidate.agent_id:
            path = self._agent_memory_path(candidate.agent_id)
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

