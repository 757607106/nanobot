"""Service layer for the first embedded enterprise knowledge base slice.

Refactored to use RAG-Anything / LightRAG as the core retrieval engine.
Old FTS5 chunk-based retrieval has been replaced with knowledge-graph +
vector-graph fusion retrieval.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import re
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from threading import Lock
from typing import Any, TYPE_CHECKING

import chardet
import httpx
from loguru import logger
from openpyxl import load_workbook
from readability import Document as ReadabilityDocument
from lxml import html as lxml_html

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge.models import (
    KnowledgeBaseDefinition,
    KnowledgeDocument,
    KnowledgeDocumentStatus,
    KnowledgeIngestJob,
    KnowledgeJobStatus,
    KnowledgeRetrievalProfile,
    KnowledgeSource,
    now_iso,
)
from nanobot.platform.knowledge.store import KnowledgeBaseStore
from nanobot.utils.helpers import ensure_dir, safe_filename

if TYPE_CHECKING:
    from nanobot.platform.knowledge.rag_engine import RAGEngine


class KnowledgeBaseNotFoundError(KeyError):
    """Raised when a knowledge base does not exist."""


class KnowledgeBaseConflictError(RuntimeError):
    """Raised when a knowledge base name would conflict."""


class KnowledgeBaseValidationError(ValueError):
    """Raised when the payload or source data is invalid."""


class KnowledgeSourceNotFoundError(KeyError):
    """Raised when a knowledge source does not exist."""


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "knowledge-base"


def _short_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class KnowledgeBaseService:
    """Instance-scoped knowledge base CRUD, ingest, and retrieval service.

    Uses RAGEngine (RAG-Anything / LightRAG) for document parsing, knowledge
    graph construction, and retrieval.  The SQLite store retains metadata
    (knowledge bases, documents, sources, jobs) but no longer stores chunks.
    """

    def __init__(
        self,
        store: KnowledgeBaseStore,
        *,
        instance: PlatformInstance | None = None,
        instance_id: str = "default",
        tenant_id: str = "default",
        rag_engine: RAGEngine | None = None,
        max_background_jobs: int = 5,
    ) -> None:
        self.store = store
        self.instance = instance
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.rag_engine = rag_engine
        self._retired_rag_engines: list[RAGEngine] = []
        self._rag_engine_lock = Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=max(1, max_background_jobs),
            thread_name_prefix=f"knowledge-{instance_id}",
        )
        self._futures: set[Future[Any]] = set()
        self._futures_lock = Lock()
        
        # Dedicated background event loop for running async RAGEngine operations from sync threads.
        # LightRAG maintains long-lived async primitives (queues, locks) so they MUST live in one loop.
        import threading
        self._loop = asyncio.new_event_loop()
        self._loop_thread = threading.Thread(
            target=self._execute_loop, 
            name=f"KGLoop-{instance_id}", 
            daemon=True
        )
        self._loop_thread.start()

    def _execute_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _run_async(self, coro: Any) -> Any:
        """Run an async coroutine on the dedicated background loop."""
        if not self._loop.is_running():
            raise RuntimeError("Knowledge base background event loop is not running.")
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result()

    def shutdown(self) -> None:
        engines_to_shutdown: list[RAGEngine] = []
        with self._rag_engine_lock:
            if self.rag_engine is not None:
                engines_to_shutdown.append(self.rag_engine)
            engines_to_shutdown.extend(self._retired_rag_engines)
            self._retired_rag_engines = []

        if self._loop.is_running():
            for engine in engines_to_shutdown:
                try:
                    self._run_async(engine.shutdown_async())
                except Exception:
                    logger.exception("Knowledge RAG engine shutdown failed")
        if self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._loop_thread.is_alive():
            self._loop_thread.join(timeout=1.0)
        self._executor.shutdown(wait=False, cancel_futures=True)

    def set_rag_engine(self, rag_engine: RAGEngine | None) -> None:
        """Swap the active RAG engine for future knowledge operations.

        Existing background jobs may still be using the previous engine instance,
        so we retain old engines until service shutdown instead of finalizing them
        immediately.
        """
        with self._rag_engine_lock:
            current = self.rag_engine
            if current is rag_engine:
                return
            if current is not None:
                self._retired_rag_engines.append(current)
            self.rag_engine = rag_engine

    def _track_future(self, future: Future[Any]) -> None:
        with self._futures_lock:
            self._futures.add(future)

        def _cleanup(done: Future[Any]) -> None:
            with self._futures_lock:
                self._futures.discard(done)
            try:
                done.result()
            except Exception:
                logger.exception("Knowledge ingest background job crashed")

        future.add_done_callback(_cleanup)

    def _submit_background_job(self, fn: Any, *args: Any, **kwargs: Any) -> None:
        future = self._executor.submit(fn, *args, **kwargs)
        self._track_future(future)

    @staticmethod
    def _get_value(payload: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in payload:
                return payload[key]
        return None

    @staticmethod
    def _normalize_text(value: Any, *, required: bool = False, field_name: str = "value") -> str:
        text = str(value or "").strip()
        if required and not text:
            raise KnowledgeBaseValidationError(f"{field_name} is required.")
        return text

    @staticmethod
    def _normalize_string_list(value: Any, *, field_name: str) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise KnowledgeBaseValidationError(f"{field_name} must be a list of strings.")
        result: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            result.append(text)
        return result

    def _next_kb_id(self, name: str) -> str:
        base = _slugify(name)
        candidate = base
        counter = 2
        while self.store.get_kb(candidate) is not None:
            candidate = f"{base}-{counter}"
            counter += 1
        return candidate

    def _ensure_unique_name(self, name: str, *, exclude_kb_id: str | None = None) -> None:
        existing = self.store.get_kb_by_name(name, tenant_id=self.tenant_id, instance_id=self.instance_id)
        if existing is None:
            return
        if exclude_kb_id and existing.kb_id == exclude_kb_id:
            return
        raise KnowledgeBaseConflictError(f"Knowledge base name '{name}' already exists.")

    def _create_source(
        self,
        *,
        kb: KnowledgeBaseDefinition,
        source_type: str,
        title: str,
        source_uri: str | None = None,
        config: dict[str, Any] | None = None,
        latest_doc_id: str | None = None,
    ) -> KnowledgeSource:
        now = now_iso()
        return self.store.insert_source(
            KnowledgeSource(
                source_id=_short_id("src"),
                kb_id=kb.kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                source_type=source_type,
                title=title,
                enabled=True,
                source_uri=source_uri,
                latest_doc_id=latest_doc_id,
                sync_count=1 if latest_doc_id else 0,
                last_synced_at=now if latest_doc_id else None,
                config=dict(config or {}),
                created_at=now,
                updated_at=now,
            )
        )

    def _update_source(
        self,
        source: KnowledgeSource,
        *,
        title: str | None = None,
        source_uri: str | None = None,
        latest_doc_id: str | None = None,
        bump_sync: bool = False,
        config: dict[str, Any] | None = None,
    ) -> KnowledgeSource:
        updated = replace(
            source,
            title=source.title if title is None else title,
            source_uri=source.source_uri if source_uri is None else source_uri,
            latest_doc_id=source.latest_doc_id if latest_doc_id is None else latest_doc_id,
            sync_count=source.sync_count + (1 if bump_sync else 0),
            last_synced_at=now_iso() if bump_sync else source.last_synced_at,
            config=source.config if config is None else dict(config),
            updated_at=now_iso(),
        )
        persisted = self.store.update_source(updated)
        if persisted is None:
            raise KnowledgeSourceNotFoundError(source.source_id)
        return persisted

    def _load_faq_source_items(self, document: KnowledgeDocument, source: KnowledgeSource | None = None) -> list[dict[str, Any]]:
        configured = (source.config if source else {}).get("items")
        if isinstance(configured, list):
            return configured
        raw_path = Path(document.file_path or "")
        if raw_path.exists():
            payload = json.loads(raw_path.read_text(encoding="utf-8"))
            if isinstance(payload, list):
                return payload
        raise KnowledgeBaseValidationError("FAQ source payload is missing or invalid.")

    def _build_source_config_from_document(self, document: KnowledgeDocument) -> tuple[str, str | None, dict[str, Any]]:
        if document.source_type == "web_url":
            return (
                document.title,
                document.source_uri,
                {
                    "url": document.source_uri or "",
                    "title": document.title,
                },
            )
        if document.source_type == "faq_table":
            return (
                document.title,
                None,
                {
                    "title": document.title,
                    "items": self._load_faq_source_items(document),
                },
            )
        return (
            document.title,
            document.source_uri,
            {
                "fileName": document.file_name or document.title,
            },
        )

    def _ensure_source_backfill(self, kb_id: str) -> None:
        kb = self.require_kb(kb_id)
        legacy_documents = self.store.list_documents_without_source(kb_id)
        for document in legacy_documents:
            title, source_uri, config = self._build_source_config_from_document(document)
            source = self._create_source(
                kb=kb,
                source_type=document.source_type,
                title=title,
                source_uri=source_uri,
                config=config,
                latest_doc_id=document.doc_id,
            )
            self.store.update_document(
                replace(
                    document,
                    source_id=source.source_id,
                    updated_at=now_iso(),
                )
            )

    def _enrich_source(
        self,
        source: KnowledgeSource,
        *,
        documents: list[KnowledgeDocument] | None = None,
        jobs: list[KnowledgeIngestJob] | None = None,
    ) -> dict[str, Any]:
        source_docs = documents if documents is not None else self.store.list_documents(source.kb_id)
        source_jobs = jobs if jobs is not None else self.store.list_jobs(source.kb_id)
        matched_docs = [item for item in source_docs if item.source_id == source.source_id]
        latest_doc = next((item for item in matched_docs if item.doc_id == source.latest_doc_id), None)
        if latest_doc is None and matched_docs:
            latest_doc = matched_docs[0]
        latest_job = None
        if latest_doc is not None:
            latest_job = next((item for item in source_jobs if item.doc_id == latest_doc.doc_id), None)
        payload = source.to_dict()
        payload["docCount"] = len(matched_docs)
        payload["syncSupported"] = source.source_type in {"upload_file", "web_url", "faq_table"}
        payload["latestDocument"] = latest_doc.to_dict() if latest_doc is not None else None
        payload["latestJob"] = latest_job.to_dict() if latest_job is not None else None
        return payload

    def _refresh_source_from_document(self, document: KnowledgeDocument) -> None:
        if not document.source_id:
            return
        source = self.store.get_source(document.source_id)
        if source is None:
            return
        config = dict(source.config)
        if document.source_type == "web_url":
            config.setdefault("url", document.source_uri or "")
            config["title"] = document.title
        elif document.source_type == "faq_table":
            config["title"] = document.title
        else:
            config["fileName"] = document.file_name or document.title
        self._update_source(
            source,
            title=document.title,
            source_uri=document.source_uri,
            latest_doc_id=document.doc_id,
            config=config,
        )

    def _normalize_create_payload(self, payload: dict[str, Any]) -> KnowledgeBaseDefinition:
        name = self._normalize_text(payload.get("name"), required=True, field_name="name")
        self._ensure_unique_name(name)
        description = self._normalize_text(payload.get("description"), field_name="description")
        tags = self._normalize_string_list(payload.get("tags"), field_name="tags")
        enabled_value = payload.get("enabled")
        enabled = True if enabled_value is None else bool(enabled_value)
        retrieval_profile = KnowledgeRetrievalProfile.from_dict(
            payload.get("retrievalProfile") or payload.get("retrieval_profile")
        )
        now = now_iso()
        return KnowledgeBaseDefinition(
            kb_id=self._next_kb_id(name),
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            name=name,
            description=description,
            enabled=enabled,
            tags=tags,
            retrieval_profile=retrieval_profile,
            created_at=now,
            updated_at=now,
        )

    def _apply_kb_update(self, existing: KnowledgeBaseDefinition, payload: dict[str, Any]) -> KnowledgeBaseDefinition:
        name = existing.name
        if "name" in payload:
            name = self._normalize_text(payload.get("name"), required=True, field_name="name")
            self._ensure_unique_name(name, exclude_kb_id=existing.kb_id)
        retrieval_profile = existing.retrieval_profile
        if "retrievalProfile" in payload or "retrieval_profile" in payload:
            retrieval_profile = KnowledgeRetrievalProfile.from_dict(
                payload.get("retrievalProfile") or payload.get("retrieval_profile")
            )
        return replace(
            existing,
            name=name,
            description=existing.description
            if "description" not in payload
            else self._normalize_text(payload.get("description"), field_name="description"),
            enabled=existing.enabled if "enabled" not in payload else bool(payload.get("enabled")),
            tags=existing.tags
            if "tags" not in payload
            else self._normalize_string_list(payload.get("tags"), field_name="tags"),
            retrieval_profile=retrieval_profile,
            updated_at=now_iso(),
        )

    def list_knowledge_bases(self, *, enabled: bool | None = None) -> list[dict[str, Any]]:
        return [
            kb.to_dict()
            for kb in self.store.list_kbs(tenant_id=self.tenant_id, instance_id=self.instance_id, enabled=enabled)
        ]

    def create_knowledge_base(self, payload: dict[str, Any]) -> dict[str, Any]:
        created = self.store.create_kb(self._normalize_create_payload(payload))
        return created.to_dict()

    def get_knowledge_base(self, kb_id: str) -> dict[str, Any]:
        kb = self.store.get_kb(kb_id)
        if kb is None or kb.instance_id != self.instance_id or kb.tenant_id != self.tenant_id:
            raise KnowledgeBaseNotFoundError(kb_id)
        return kb.to_dict()

    def require_kb(self, kb_id: str) -> KnowledgeBaseDefinition:
        kb = self.store.get_kb(kb_id)
        if kb is None or kb.instance_id != self.instance_id or kb.tenant_id != self.tenant_id:
            raise KnowledgeBaseNotFoundError(kb_id)
        return kb

    def update_knowledge_base(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.require_kb(kb_id)
        updated = self.store.update_kb(self._apply_kb_update(existing, payload))
        if updated is None:
            raise KnowledgeBaseNotFoundError(kb_id)
        return updated.to_dict()

    def delete_knowledge_base(self, kb_id: str) -> bool:
        self.require_kb(kb_id)
        deleted = self.store.delete_kb(kb_id)
        if not deleted:
            raise KnowledgeBaseNotFoundError(kb_id)
        files_root = self.instance.knowledge_files_dir() / kb_id
        parsed_root = self.instance.knowledge_parsed_dir() / kb_id
        if files_root.exists():
            for path in sorted(files_root.rglob("*"), reverse=True):
                if path.is_file():
                    path.unlink()
                elif path.is_dir():
                    path.rmdir()
            if files_root.exists():
                files_root.rmdir()
        if parsed_root.exists():
            for path in sorted(parsed_root.rglob("*"), reverse=True):
                if path.is_file():
                    path.unlink()
                elif path.is_dir():
                    path.rmdir()
            if parsed_root.exists():
                parsed_root.rmdir()
        return True

    def list_documents(self, kb_id: str) -> list[dict[str, Any]]:
        self.require_kb(kb_id)
        return [doc.to_dict() for doc in self.store.list_documents(kb_id)]

    def list_jobs(self, kb_id: str) -> list[dict[str, Any]]:
        self.require_kb(kb_id)
        return [job.to_dict() for job in self.store.list_jobs(kb_id)]

    def list_sources(self, kb_id: str) -> list[dict[str, Any]]:
        self._ensure_source_backfill(kb_id)
        sources = self.store.list_sources(kb_id)
        documents = self.store.list_documents(kb_id)
        jobs = self.store.list_jobs(kb_id)
        return [self._enrich_source(source, documents=documents, jobs=jobs) for source in sources]

    def require_source(self, kb_id: str, source_id: str) -> KnowledgeSource:
        self._ensure_source_backfill(kb_id)
        source = self.store.get_source(source_id)
        if source is None or source.kb_id != kb_id or source.instance_id != self.instance_id or source.tenant_id != self.tenant_id:
            raise KnowledgeSourceNotFoundError(source_id)
        return source

    def update_source(self, kb_id: str, source_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        source = self.require_source(kb_id, source_id)
        document = self.store.get_document(str(source.latest_doc_id or "")) if source.latest_doc_id else None
        next_title = source.title
        next_enabled = source.enabled
        next_source_uri = source.source_uri
        next_config = dict(source.config)

        if "title" in payload:
            next_title = self._normalize_text(payload.get("title"), required=True, field_name="title")
        if "enabled" in payload:
            next_enabled = bool(payload.get("enabled"))

        if source.source_type == "web_url":
            if "url" in payload or "sourceUri" in payload or "source_uri" in payload:
                next_source_uri = self._normalize_text(
                    self._get_value(payload, "url", "sourceUri", "source_uri"),
                    required=True,
                    field_name="url",
                )
            next_config["url"] = next_source_uri or ""
            next_config["title"] = next_title
        elif source.source_type == "faq_table":
            if "items" in payload:
                items = payload.get("items")
                if not isinstance(items, list):
                    raise KnowledgeBaseValidationError("FAQ source update requires an 'items' list.")
                self._faq_chunks(items)
                next_config["items"] = items
            next_config["title"] = next_title

        updated = replace(
            source,
            title=next_title,
            enabled=next_enabled,
            source_uri=next_source_uri,
            config=next_config,
            updated_at=now_iso(),
        )
        persisted = self.store.update_source(updated)
        if persisted is None:
            raise KnowledgeSourceNotFoundError(source_id)

        if document is not None:
            doc_updates: dict[str, Any] = {}
            if document.title != next_title:
                doc_updates["title"] = next_title
            if source.source_type == "web_url" and document.source_uri != next_source_uri:
                doc_updates["source_uri"] = next_source_uri
            if doc_updates:
                self.store.update_document(
                    replace(
                        document,
                        title=doc_updates.get("title", document.title),
                        source_uri=doc_updates.get("source_uri", document.source_uri),
                        updated_at=now_iso(),
                    )
                )

        return self._enrich_source(persisted)

    def delete_document(self, kb_id: str, doc_id: str) -> bool:
        self.require_kb(kb_id)
        document = self.store.get_document(doc_id)
        if document is None or document.kb_id != kb_id:
            raise KnowledgeBaseNotFoundError(doc_id)
        deleted = self.store.delete_document(doc_id)
        if document.source_id:
            self.store.delete_source(document.source_id)
        for raw_path in (document.file_path, document.parsed_path):
            if raw_path:
                path = Path(raw_path)
                if path.exists():
                    path.unlink()
        return deleted

    def delete_documents(self, kb_id: str, doc_ids: list[str] | tuple[str, ...]) -> dict[str, Any]:
        self.require_kb(kb_id)
        normalized_ids: list[str] = []
        seen: set[str] = set()
        for raw_doc_id in doc_ids:
            doc_id = str(raw_doc_id or "").strip()
            if not doc_id or doc_id in seen:
                continue
            normalized_ids.append(doc_id)
            seen.add(doc_id)
        if not normalized_ids:
            raise KnowledgeBaseValidationError("At least one document id is required to delete.")

        missing: list[str] = []
        for doc_id in normalized_ids:
            document = self.store.get_document(doc_id)
            if document is None or document.kb_id != kb_id:
                missing.append(doc_id)
        if missing:
            raise KnowledgeBaseValidationError(
                f"Knowledge base references unknown documents: {', '.join(missing)}"
            )

        deleted_ids: list[str] = []
        for doc_id in normalized_ids:
            if self.delete_document(kb_id, doc_id):
                deleted_ids.append(doc_id)
        return {"deletedCount": len(deleted_ids), "docIds": deleted_ids}

    def resolve_bound_kbs(self, kb_ids: list[str]) -> list[KnowledgeBaseDefinition]:
        result: list[KnowledgeBaseDefinition] = []
        missing: list[str] = []
        for kb_id in kb_ids:
            kb = self.store.get_kb(kb_id)
            if kb is None or kb.instance_id != self.instance_id or kb.tenant_id != self.tenant_id or not kb.enabled:
                missing.append(kb_id)
                continue
            result.append(kb)
        if missing:
            raise KnowledgeBaseValidationError(
                f"Agent references unknown or disabled knowledge bases: {', '.join(missing)}"
            )
        return result

    @staticmethod
    def _detect_encoding(content: bytes) -> str:
        detection = chardet.detect(content)
        encoding = str(detection.get("encoding") or "utf-8")
        return encoding

    def _decode_text(self, content: bytes) -> str:
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode(self._detect_encoding(content), errors="ignore")

    def _html_to_text(self, raw_html: str) -> tuple[str, str | None]:
        doc = ReadabilityDocument(raw_html)
        title = doc.short_title() or None
        summary_html = doc.summary(html_partial=True)
        text = lxml_html.fromstring(summary_html).text_content()
        return self._normalize_whitespace(text), title

    @staticmethod
    def _normalize_whitespace(text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _json_to_text(self, raw_json: str) -> tuple[str, list[dict[str, Any]] | None]:
        payload = json.loads(raw_json)
        if isinstance(payload, list) and payload and all(isinstance(item, dict) for item in payload):
            faq_items = []
            for item in payload:
                question = str(item.get("question") or item.get("q") or "").strip()
                answer = str(item.get("answer") or item.get("a") or "").strip()
                if question and answer:
                    faq_items.append({"question": question, "answer": answer})
            if faq_items:
                text = "\n\n".join(f"Q: {item['question']}\nA: {item['answer']}" for item in faq_items)
                return text, faq_items
        return json.dumps(payload, ensure_ascii=False, indent=2), None

    def _csv_to_text(self, raw_csv: str) -> tuple[str, list[dict[str, Any]] | None]:
        reader = csv.DictReader(io.StringIO(raw_csv))
        rows = list(reader)
        faq_items = []
        lines: list[str] = []
        for row in rows:
            question = str(row.get("question") or row.get("q") or "").strip()
            answer = str(row.get("answer") or row.get("a") or "").strip()
            if question and answer:
                faq_items.append({"question": question, "answer": answer})
            if row:
                lines.append(" | ".join(f"{key}: {value}" for key, value in row.items()))
        if faq_items:
            text = "\n\n".join(f"Q: {item['question']}\nA: {item['answer']}" for item in faq_items)
            return text, faq_items
        return "\n".join(lines), None

    def _xlsx_to_text(self, content: bytes) -> str:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        sections: list[str] = []
        for sheet in workbook.worksheets:
            rows = list(sheet.iter_rows(values_only=True))
            if not rows:
                continue
            header = [str(cell or "").strip() for cell in rows[0]]
            sections.append(f"# Sheet: {sheet.title}")
            for row in rows[1:]:
                line = " | ".join(
                    f"{header[index] or f'column_{index + 1}'}: {str(value or '').strip()}"
                    for index, value in enumerate(row)
                    if str(value or "").strip()
                )
                if line:
                    sections.append(line)
        return "\n".join(sections).strip()

    def _extract_pdf_text(self, content: bytes) -> str:
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise KnowledgeBaseValidationError("PDF parsing requires optional dependency 'pypdf'.") from exc
        reader = PdfReader(io.BytesIO(content))
        return self._normalize_whitespace("\n\n".join(page.extract_text() or "" for page in reader.pages))

    def _extract_docx_text(self, content: bytes) -> str:
        try:
            from docx import Document
        except ImportError as exc:
            raise KnowledgeBaseValidationError("DOCX parsing requires optional dependency 'python-docx'.") from exc
        document = Document(io.BytesIO(content))
        return self._normalize_whitespace("\n".join(paragraph.text for paragraph in document.paragraphs))

    def _parse_file_content(
        self,
        *,
        title: str,
        file_name: str,
        mime_type: str | None,
        content: bytes,
    ) -> tuple[str, str, dict[str, Any], list[dict[str, Any]] | None]:
        suffix = Path(file_name).suffix.lower()
        parser_name = suffix.lstrip(".") or "text"
        metadata: dict[str, Any] = {}
        faq_items: list[dict[str, Any]] | None = None

        if suffix in {".txt", ".md"}:
            text = self._decode_text(content)
        elif suffix in {".html", ".htm"}:
            text, detected_title = self._html_to_text(self._decode_text(content))
            if detected_title and not title:
                metadata["detected_title"] = detected_title
        elif suffix == ".json":
            text, faq_items = self._json_to_text(self._decode_text(content))
        elif suffix == ".csv":
            text, faq_items = self._csv_to_text(self._decode_text(content))
        elif suffix == ".xlsx":
            text = self._xlsx_to_text(content)
        elif suffix == ".pdf":
            text = self._extract_pdf_text(content)
        elif suffix == ".docx":
            text = self._extract_docx_text(content)
        else:
            if mime_type and mime_type.startswith("text/"):
                text = self._decode_text(content)
            else:
                raise KnowledgeBaseValidationError(
                    f"Unsupported file type for knowledge ingestion: {suffix or mime_type or file_name}"
                )

        normalized = self._normalize_whitespace(text)
        if not normalized:
            raise KnowledgeBaseValidationError("Parsed knowledge document is empty.")
        return normalized, parser_name, metadata, faq_items

    def _parse_url(self, url: str) -> tuple[str, str, str]:
        response = httpx.get(url, timeout=15.0, follow_redirects=True)
        response.raise_for_status()
        content_type = str(response.headers.get("content-type") or "text/html")
        if "html" in content_type:
            text, title = self._html_to_text(response.text)
            return text, title or url, "readability"
        if content_type.startswith("text/") or "json" in content_type:
            return self._normalize_whitespace(response.text), url, "http"
        raise KnowledgeBaseValidationError(f"Unsupported URL content type: {content_type}")

    @staticmethod
    def _faq_chunks(items: list[dict[str, Any]]) -> list[str]:
        result: list[str] = []
        for item in items:
            question = str(item.get("question") or "").strip()
            answer = str(item.get("answer") or "").strip()
            if question and answer:
                result.append(f"Q: {question}\nA: {answer}")
        if not result:
            raise KnowledgeBaseValidationError("faq_table requires non-empty question/answer pairs.")
        return result

    def _document_paths(self, kb_id: str, doc_id: str, file_name: str | None, source_type: str) -> tuple[Path | None, Path]:
        raw_dir = ensure_dir(self.instance.knowledge_files_dir() / kb_id)
        parsed_dir = ensure_dir(self.instance.knowledge_parsed_dir() / kb_id)
        suffix = Path(file_name or "").suffix if file_name else ".txt"
        raw_path = raw_dir / f"{doc_id}-{safe_filename(file_name or source_type)}" if file_name else None
        parsed_path = parsed_dir / f"{doc_id}{suffix if suffix in {'.md', '.txt'} else '.md'}"
        return raw_path, parsed_path

    def _create_job(self, kb_id: str, doc_id: str) -> KnowledgeIngestJob:
        now = now_iso()
        return self.store.insert_job(
            KnowledgeIngestJob(
                job_id=_short_id("job"),
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_id=kb_id,
                doc_id=doc_id,
                status=KnowledgeJobStatus.QUEUED,
                track_id=_short_id("track"),
                created_at=now,
                updated_at=now,
            )
        )

    def _start_job(self, job: KnowledgeIngestJob) -> KnowledgeIngestJob:
        updated = replace(job, status=KnowledgeJobStatus.RUNNING, updated_at=now_iso())
        persisted = self.store.update_job(updated)
        if persisted is None:
            raise RuntimeError(f"Failed to start knowledge ingest job {job.job_id}")
        return persisted

    def _finish_job(self, job: KnowledgeIngestJob, *, error_summary: str | None = None) -> KnowledgeIngestJob:
        updated = replace(
            job,
            status=KnowledgeJobStatus.FAILED if error_summary else KnowledgeJobStatus.SUCCEEDED,
            error_summary=error_summary,
            updated_at=now_iso(),
        )
        persisted = self.store.update_job(updated)
        if persisted is None:
            raise RuntimeError(f"Failed to finish knowledge ingest job {job.job_id}")
        return persisted

    def _queue_uploaded_file_job(
        self,
        *,
        kb: KnowledgeBaseDefinition,
        file_name: str,
        mime_type: str | None,
        content: bytes,
    ) -> tuple[KnowledgeDocument, KnowledgeIngestJob]:
        now = now_iso()
        doc_id = _short_id("doc")
        source = self._create_source(
            kb=kb,
            source_type="upload_file",
            title=file_name,
            config={"fileName": file_name},
            latest_doc_id=doc_id,
        )
        raw_path, parsed_path = self._document_paths(kb.kb_id, doc_id, file_name, "upload_file")
        checksum = hashlib.sha256(content).hexdigest()
        if raw_path is not None:
            raw_path.write_bytes(content)
        document = self.store.insert_document(
            KnowledgeDocument(
                doc_id=doc_id,
                kb_id=kb.kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                source_id=source.source_id,
                source_type="upload_file",
                title=file_name,
                mime_type=mime_type,
                file_name=file_name,
                file_path=str(raw_path) if raw_path else None,
                parsed_path=str(parsed_path),
                checksum=checksum,
                doc_status=KnowledgeDocumentStatus.UPLOADED,
                created_at=now,
                updated_at=now,
            )
        )
        job = self._create_job(kb.kb_id, doc_id)
        return document, job

    def _queue_url_job(
        self,
        *,
        kb: KnowledgeBaseDefinition,
        url: str,
        title_override: str | None,
    ) -> tuple[KnowledgeDocument, KnowledgeIngestJob]:
        now = now_iso()
        doc_id = _short_id("doc")
        source = self._create_source(
            kb=kb,
            source_type="web_url",
            title=title_override or url,
            source_uri=url,
            config={"url": url, "title": title_override or url},
            latest_doc_id=doc_id,
        )
        _, parsed_path = self._document_paths(kb.kb_id, doc_id, "web-url.md", "web_url")
        document = self.store.insert_document(
            KnowledgeDocument(
                doc_id=doc_id,
                kb_id=kb.kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                source_id=source.source_id,
                source_type="web_url",
                title=title_override or url,
                source_uri=url,
                parsed_path=str(parsed_path),
                doc_status=KnowledgeDocumentStatus.UPLOADED,
                created_at=now,
                updated_at=now,
            )
        )
        job = self._create_job(kb.kb_id, doc_id)
        return document, job

    def _queue_faq_job(
        self,
        *,
        kb: KnowledgeBaseDefinition,
        title: str,
        items: list[dict[str, Any]],
    ) -> tuple[KnowledgeDocument, KnowledgeIngestJob]:
        now = now_iso()
        doc_id = _short_id("doc")
        source = self._create_source(
            kb=kb,
            source_type="faq_table",
            title=title,
            config={"title": title, "items": items},
            latest_doc_id=doc_id,
        )
        raw_path, parsed_path = self._document_paths(kb.kb_id, doc_id, "faq.json", "faq_table")
        if raw_path is not None:
            raw_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        document = self.store.insert_document(
            KnowledgeDocument(
                doc_id=doc_id,
                kb_id=kb.kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                source_id=source.source_id,
                source_type="faq_table",
                title=title,
                file_name="faq.json",
                file_path=str(raw_path) if raw_path else None,
                parsed_path=str(parsed_path),
                parser_name="faq_table",
                doc_status=KnowledgeDocumentStatus.UPLOADED,
                created_at=now,
                updated_at=now,
            )
        )
        job = self._create_job(kb.kb_id, doc_id)
        return document, job

    def _run_uploaded_file_job(
        self,
        kb_id: str,
        doc_id: str,
        job_id: str,
        *,
        file_name: str,
        mime_type: str | None,
    ) -> None:
        document = self.store.get_document(doc_id)
        job = self.store.get_job(job_id)
        if document is None or job is None:
            return
        phase = "kg_building"
        try:
            job = self._start_job(job)
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.PARSING, error_summary=None, updated_at=now_iso())
            ) or document
            raw_path = Path(document.file_path or "")
            if not raw_path.exists():
                raise KnowledgeBaseValidationError(f"Uploaded knowledge file missing for document {document.doc_id}.")
            if self.rag_engine is None:
                raise KnowledgeBaseValidationError("RAGEngine is not configured.")
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.KG_BUILDING, updated_at=now_iso())
            ) or document
            result = self._run_async(
                self.rag_engine.parse_and_index(
                    kb_id,
                    str(raw_path),
                    doc_id=doc_id,
                )
            )
            if not result.success:
                raise KnowledgeBaseValidationError(f"RAGEngine parse_and_index failed: {result.error}")
            document = self.store.update_document(
                replace(
                    document,
                    parser_name=result.parser_name,
                    metadata=result.metadata,
                    chunk_count=int((result.metadata or {}).get("chunks_count") or document.chunk_count or 0),
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    error_summary=None,
                    updated_at=now_iso(),
                )
            ) or document
            self._refresh_source_from_document(document)
            self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            error_status = {
                "parsing": KnowledgeDocumentStatus.ERROR_PARSING,
                "kg_building": KnowledgeDocumentStatus.ERROR_KG,
            }.get(phase, KnowledgeDocumentStatus.ERROR_INDEXING)
            self.store.update_document(
                replace(
                    document,
                    doc_status=error_status,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            )
            self._finish_job(job, error_summary=message)

    def _run_url_job(self, kb_id: str, doc_id: str, job_id: str) -> None:
        document = self.store.get_document(doc_id)
        job = self.store.get_job(job_id)
        if document is None or job is None:
            return
        phase = "parsing"
        try:
            job = self._start_job(job)
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.PARSING, error_summary=None, updated_at=now_iso())
            ) or document
            url = self._normalize_text(document.source_uri, required=True, field_name="url")
            parsed_text, detected_title, parser_name = self._parse_url(url)
            title = document.title or detected_title or url
            document = self.store.update_document(
                replace(
                    document,
                    title=title,
                    parser_name=parser_name,
                    doc_status=KnowledgeDocumentStatus.PARSED,
                    updated_at=now_iso(),
                )
            ) or document

            if self.rag_engine is None:
                raise KnowledgeBaseValidationError("RAGEngine is not configured.")
            if document.parsed_path:
                Path(document.parsed_path).write_text(f"{parsed_text}\n", encoding="utf-8")

            phase = "kg_building"
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.KG_BUILDING, updated_at=now_iso())
            ) or document
            result = self._run_async(
                self.rag_engine.insert_text(
                    kb_id,
                    parsed_text,
                    doc_id=doc_id,
                    file_path=url,
                )
            )
            if not result.success:
                raise KnowledgeBaseValidationError(f"RAGEngine insert_text failed: {result.error}")
            document = self.store.update_document(
                replace(
                    document,
                    chunk_count=int((result.metadata or {}).get("chunks_count") or document.chunk_count or 0),
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    error_summary=None,
                    updated_at=now_iso(),
                )
            ) or document
            self._refresh_source_from_document(document)
            self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            error_status = {
                "parsing": KnowledgeDocumentStatus.ERROR_PARSING,
                "kg_building": KnowledgeDocumentStatus.ERROR_KG,
            }.get(phase, KnowledgeDocumentStatus.ERROR_INDEXING)
            self.store.update_document(
                replace(
                    document,
                    doc_status=error_status,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            )
            self._finish_job(job, error_summary=message)

    def _run_faq_job(self, kb_id: str, doc_id: str, job_id: str) -> None:
        document = self.store.get_document(doc_id)
        job = self.store.get_job(job_id)
        if document is None or job is None:
            return
        phase = "indexing"
        try:
            job = self._start_job(job)
            raw_path = Path(document.file_path or "")
            if not raw_path.exists():
                raise KnowledgeBaseValidationError(f"FAQ source file missing for document {document.doc_id}.")
            items = json.loads(raw_path.read_text(encoding="utf-8"))
            if not isinstance(items, list):
                raise KnowledgeBaseValidationError("faq_table requires an 'items' list.")
            parsed_text = "\n\n".join(self._faq_chunks(items))
            document = self.store.update_document(
                replace(
                    document,
                    parser_name="faq_table",
                    doc_status=KnowledgeDocumentStatus.PARSED,
                    updated_at=now_iso(),
                )
            ) or document

            if self.rag_engine is None:
                raise KnowledgeBaseValidationError("RAGEngine is not configured.")
            if document.parsed_path:
                Path(document.parsed_path).write_text(f"{parsed_text}\n", encoding="utf-8")

            phase = "kg_building"
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.KG_BUILDING, updated_at=now_iso())
            ) or document
            result = self._run_async(
                self.rag_engine.insert_text(
                    kb_id,
                    parsed_text,
                    doc_id=doc_id,
                    file_path=document.title or document.file_name or "faq.json",
                )
            )
            if not result.success:
                raise KnowledgeBaseValidationError(f"RAGEngine insert_text failed: {result.error}")
            document = self.store.update_document(
                replace(
                    document,
                    chunk_count=int((result.metadata or {}).get("chunks_count") or document.chunk_count or 0),
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    error_summary=None,
                    updated_at=now_iso(),
                )
            ) or document
            self._refresh_source_from_document(document)
            self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            error_status = {
                "kg_building": KnowledgeDocumentStatus.ERROR_KG,
            }.get(phase, KnowledgeDocumentStatus.ERROR_INDEXING)
            self.store.update_document(
                replace(
                    document,
                    doc_status=error_status,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            )
            self._finish_job(job, error_summary=message)

    def enqueue_uploaded_files(
        self,
        kb_id: str,
        files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        documents: list[dict[str, Any]] = []
        jobs: list[dict[str, Any]] = []
        for file in files:
            file_name = self._normalize_text(file.get("file_name"), required=True, field_name="file_name")
            content = file.get("content")
            if not isinstance(content, (bytes, bytearray)):
                raise KnowledgeBaseValidationError("Uploaded knowledge file content is required.")
            mime_type = self._normalize_text(file.get("mime_type"), field_name="mime_type") or None
            document, job = self._queue_uploaded_file_job(
                kb=kb,
                file_name=file_name,
                mime_type=mime_type,
                content=bytes(content),
            )
            try:
                self._submit_background_job(
                    self._run_uploaded_file_job,
                    kb_id,
                    document.doc_id,
                    job.job_id,
                    file_name=file_name,
                    mime_type=mime_type,
                )
            except RuntimeError as exc:
                message = "Knowledge ingest worker is unavailable."
                document = self.store.update_document(
                    replace(
                        document,
                        doc_status=KnowledgeDocumentStatus.ERROR_PARSING,
                        error_summary=message,
                        updated_at=now_iso(),
                    )
                ) or document
                job = self._finish_job(job, error_summary=str(exc))
            documents.append(document.to_dict())
            jobs.append(job.to_dict())
        return {"documents": documents, "jobs": jobs}

    def enqueue_url(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        url = self._normalize_text(payload.get("url"), required=True, field_name="url")
        title_override = self._normalize_text(payload.get("title"), field_name="title") or None
        document, job = self._queue_url_job(kb=kb, url=url, title_override=title_override)
        try:
            self._submit_background_job(self._run_url_job, kb_id, document.doc_id, job.job_id)
        except RuntimeError as exc:
            message = "Knowledge ingest worker is unavailable."
            document = self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.ERROR_PARSING,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job, error_summary=str(exc))
        return {"documents": [document.to_dict()], "jobs": [job.to_dict()]}

    def enqueue_faq_table(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        items = payload.get("items")
        if not isinstance(items, list):
            raise KnowledgeBaseValidationError("faq_table requires an 'items' list.")
        title = self._normalize_text(payload.get("title"), field_name="title") or "FAQ"
        self._faq_chunks(items)
        document, job = self._queue_faq_job(kb=kb, title=title, items=items)
        try:
            self._submit_background_job(self._run_faq_job, kb_id, document.doc_id, job.job_id)
        except RuntimeError as exc:
            message = "Knowledge ingest worker is unavailable."
            document = self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.ERROR_INDEXING,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job, error_summary=str(exc))
        return {"documents": [document.to_dict()], "jobs": [job.to_dict()]}

    def _requeue_document(
        self,
        *,
        kb: KnowledgeBaseDefinition,
        document: KnowledgeDocument,
    ) -> tuple[KnowledgeDocument, KnowledgeIngestJob]:
        updated_document = self.store.update_document(
            replace(
                document,
                doc_status=KnowledgeDocumentStatus.UPLOADED,
                error_summary=None,
                updated_at=now_iso(),
            )
        ) or document
        job = self._create_job(kb.kb_id, document.doc_id)
        try:
            if document.source_type == "upload_file":
                self._submit_background_job(
                    self._run_uploaded_file_job,
                    kb.kb_id,
                    document.doc_id,
                    job.job_id,
                    file_name=document.file_name or document.title,
                    mime_type=document.mime_type,
                )
            elif document.source_type == "web_url":
                self._submit_background_job(
                    self._run_url_job,
                    kb.kb_id,
                    document.doc_id,
                    job.job_id,
                )
            elif document.source_type == "faq_table":
                self._submit_background_job(
                    self._run_faq_job,
                    kb.kb_id,
                    document.doc_id,
                    job.job_id,
                )
            else:
                raise KnowledgeBaseValidationError(
                    f"Unsupported knowledge source type for reindex: {document.source_type}"
                )
        except (KnowledgeBaseValidationError, RuntimeError) as exc:
            message = str(exc)
            updated_document = self.store.update_document(
                replace(
                    updated_document,
                    doc_status=KnowledgeDocumentStatus.ERROR_INDEXING,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            ) or updated_document
            job = self._finish_job(job, error_summary=message)
        return updated_document, job

    def reindex_documents(self, kb_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        payload = payload or {}
        listed = self.store.list_documents(kb_id)
        if not listed:
            raise KnowledgeBaseValidationError("Knowledge base has no documents to reindex.")
        requested_ids = payload.get("docIds") or payload.get("doc_ids")
        if requested_ids is None:
            target_ids = [item.doc_id for item in listed]
        else:
            if not isinstance(requested_ids, list):
                raise KnowledgeBaseValidationError("docIds must be a list of document ids.")
            target_ids = []
            for item in requested_ids:
                text = str(item or "").strip()
                if text and text not in target_ids:
                    target_ids.append(text)
        if not target_ids:
            raise KnowledgeBaseValidationError("At least one document id is required to reindex.")
        docs_by_id = {item.doc_id: item for item in listed}
        missing = [doc_id for doc_id in target_ids if doc_id not in docs_by_id]
        if missing:
            raise KnowledgeBaseValidationError(
                f"Knowledge base references unknown documents: {', '.join(missing)}"
            )
        documents: list[dict[str, Any]] = []
        jobs: list[dict[str, Any]] = []
        for doc_id in target_ids:
            updated_document, job = self._requeue_document(kb=kb, document=docs_by_id[doc_id])
            documents.append(updated_document.to_dict())
            jobs.append(job.to_dict())
        return {"documents": documents, "jobs": jobs}

    def sync_source(self, kb_id: str, source_id: str) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        source = self.require_source(kb_id, source_id)
        if not source.enabled:
            raise KnowledgeBaseValidationError("Knowledge source is disabled.")
        document = self.store.get_document(str(source.latest_doc_id or ""))
        if document is None or document.kb_id != kb_id:
            raise KnowledgeBaseValidationError("Knowledge source has no valid latest document to sync.")

        if source.source_type == "web_url":
            source_url = self._normalize_text(
                source.config.get("url") or source.source_uri,
                required=True,
                field_name="source.url",
            )
            title = self._normalize_text(source.config.get("title"), field_name="source.title") or source.title
            document = self.store.update_document(
                replace(
                    document,
                    title=title,
                    source_uri=source_url,
                    updated_at=now_iso(),
                )
            ) or document
            source = self._update_source(
                source,
                title=title,
                source_uri=source_url,
            )
        elif source.source_type == "faq_table":
            title = self._normalize_text(source.config.get("title"), field_name="source.title") or source.title
            items = self._load_faq_source_items(document, source)
            if not document.file_path:
                raise KnowledgeBaseValidationError("FAQ source raw file path is missing.")
            raw_path = Path(document.file_path)
            raw_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
            document = self.store.update_document(
                replace(
                    document,
                    title=title,
                    updated_at=now_iso(),
                )
            ) or document
            source = self._update_source(source, title=title)

        updated_document, job = self._requeue_document(kb=kb, document=document)
        source = self._update_source(
            source,
            title=updated_document.title,
            source_uri=updated_document.source_uri,
            latest_doc_id=updated_document.doc_id,
            bump_sync=True,
        )
        return {
            "source": self._enrich_source(source),
            "document": updated_document.to_dict(),
            "job": job.to_dict(),
        }

    def ingest_uploaded_files(
        self,
        kb_id: str,
        files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        documents: list[dict[str, Any]] = []
        jobs: list[dict[str, Any]] = []
        for file in files:
            file_name = self._normalize_text(file.get("file_name"), required=True, field_name="file_name")
            content = file.get("content")
            if not isinstance(content, (bytes, bytearray)):
                raise KnowledgeBaseValidationError("Uploaded knowledge file content is required.")
            mime_type = self._normalize_text(file.get("mime_type"), field_name="mime_type") or None
            now = now_iso()
            doc_id = _short_id("doc")
            raw_path, parsed_path = self._document_paths(kb_id, doc_id, file_name, "upload_file")
            checksum = hashlib.sha256(bytes(content)).hexdigest()
            if raw_path is not None:
                raw_path.write_bytes(bytes(content))
            document = self.store.insert_document(
                KnowledgeDocument(
                    doc_id=doc_id,
                    kb_id=kb_id,
                    tenant_id=self.tenant_id,
                    instance_id=self.instance_id,
                    source_type="upload_file",
                    title=file_name,
                    mime_type=mime_type,
                    file_name=file_name,
                    file_path=str(raw_path) if raw_path else None,
                    parsed_path=str(parsed_path),
                    checksum=checksum,
                    doc_status=KnowledgeDocumentStatus.UPLOADED,
                    created_at=now,
                    updated_at=now,
                )
            )
            job = self._create_job(kb_id, doc_id)
            try:
                job = self._start_job(job)
                if self.rag_engine is None:
                    raise KnowledgeBaseValidationError("RAGEngine is not configured.")
                document = self.store.update_document(
                    replace(document, doc_status=KnowledgeDocumentStatus.KG_BUILDING, updated_at=now_iso())
                ) or document
                result = self._run_async(
                    self.rag_engine.parse_and_index(
                        kb_id,
                        str(raw_path or ""),
                        doc_id=doc_id,
                    )
                )
                if not result.success:
                    raise KnowledgeBaseValidationError(f"RAGEngine parse_and_index failed: {result.error}")
                document = self.store.update_document(
                    replace(
                        document,
                        parser_name=result.parser_name,
                        metadata=result.metadata,
                        chunk_count=int((result.metadata or {}).get("chunks_count") or document.chunk_count or 0),
                        doc_status=KnowledgeDocumentStatus.INDEXED,
                        error_summary=None,
                        updated_at=now_iso(),
                    )
                ) or document
                job = self._finish_job(job)
            except Exception as exc:
                message = str(exc)
                document = self.store.update_document(
                    replace(
                        document,
                        doc_status=KnowledgeDocumentStatus.ERROR_KG,
                        error_summary=message,
                        updated_at=now_iso(),
                    )
                ) or document
                job = self._finish_job(job, error_summary=message)
            documents.append(document.to_dict())
            jobs.append(job.to_dict())
        return {"documents": documents, "jobs": jobs}

    def ingest_url(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        url = self._normalize_text(payload.get("url"), required=True, field_name="url")
        title_override = self._normalize_text(payload.get("title"), field_name="title") or None
        now = now_iso()
        doc_id = _short_id("doc")
        _, parsed_path = self._document_paths(kb_id, doc_id, "web-url.md", "web_url")
        document = self.store.insert_document(
            KnowledgeDocument(
                doc_id=doc_id,
                kb_id=kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                source_type="web_url",
                title=title_override or url,
                source_uri=url,
                parsed_path=str(parsed_path),
                doc_status=KnowledgeDocumentStatus.UPLOADED,
                created_at=now,
                updated_at=now,
            )
        )
        job = self._create_job(kb_id, doc_id)
        try:
            job = self._start_job(job)
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.PARSING, updated_at=now_iso())
            ) or document
            parsed_text, detected_title, parser_name = self._parse_url(url)
            title = title_override or detected_title or url
            document = self.store.update_document(
                replace(
                    document,
                    title=title,
                    parser_name=parser_name,
                    doc_status=KnowledgeDocumentStatus.PARSED,
                    updated_at=now_iso(),
                )
            ) or document

            if self.rag_engine is None:
                raise KnowledgeBaseValidationError("RAGEngine is not configured.")
            if document.parsed_path:
                Path(document.parsed_path).write_text(f"{parsed_text}\n", encoding="utf-8")

            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.KG_BUILDING, updated_at=now_iso())
            ) or document
            result = self._run_async(
                self.rag_engine.insert_text(
                    kb_id,
                    parsed_text,
                    doc_id=doc_id,
                    file_path=url,
                )
            )
            if not result.success:
                raise KnowledgeBaseValidationError(f"RAGEngine insert_text failed: {result.error}")
            document = self.store.update_document(
                replace(
                    document,
                    chunk_count=int((result.metadata or {}).get("chunks_count") or document.chunk_count or 0),
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    error_summary=None,
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            document = self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.ERROR_KG,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job, error_summary=message)
        return {"documents": [document.to_dict()], "jobs": [job.to_dict()]}

    def ingest_faq_table(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        items = payload.get("items")
        if not isinstance(items, list):
            raise KnowledgeBaseValidationError("faq_table requires an 'items' list.")
        title = self._normalize_text(payload.get("title"), field_name="title") or "FAQ"
        faq_items = self._faq_chunks(items)
        now = now_iso()
        doc_id = _short_id("doc")
        raw_path, parsed_path = self._document_paths(kb_id, doc_id, "faq.json", "faq_table")
        if raw_path is not None:
            raw_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        parsed_text = "\n\n".join(faq_items)
        document = self.store.insert_document(
            KnowledgeDocument(
                doc_id=doc_id,
                kb_id=kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                source_type="faq_table",
                title=title,
                file_name="faq.json",
                file_path=str(raw_path) if raw_path else None,
                parsed_path=str(parsed_path),
                parser_name="faq_table",
                doc_status=KnowledgeDocumentStatus.UPLOADED,
                created_at=now,
                updated_at=now,
            )
        )
        job = self._create_job(kb_id, doc_id)
        try:
            job = self._start_job(job)
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.PARSED, updated_at=now_iso())
            ) or document
            if self.rag_engine is None:
                raise KnowledgeBaseValidationError("RAGEngine is not configured.")
            if parsed_path:
                parsed_path.write_text(f"{parsed_text}\n", encoding="utf-8")
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.KG_BUILDING, updated_at=now_iso())
            ) or document
            result = self._run_async(
                self.rag_engine.insert_text(
                    kb_id,
                    parsed_text,
                    doc_id=doc_id,
                    file_path=title,
                )
            )
            if not result.success:
                raise KnowledgeBaseValidationError(f"RAGEngine insert_text failed: {result.error}")
            document = self.store.update_document(
                replace(
                    document,
                    chunk_count=int((result.metadata or {}).get("chunks_count") or document.chunk_count or 0),
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    error_summary=None,
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            document = self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.ERROR_KG,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job, error_summary=message)
        return {"documents": [document.to_dict()], "jobs": [job.to_dict()]}

    def retrieve(
        self,
        *,
        kb_ids: list[str],
        query: str,
        limit: int | None = None,
        filters: dict[str, Any] | None = None,
        requested_mode: str | None = None,
    ) -> dict[str, Any]:
        bindings = self.resolve_bound_kbs(kb_ids)
        if not query.strip():
            raise KnowledgeBaseValidationError("query is required.")

        if not bindings:
            requested = str(requested_mode or "hybrid").strip().lower() or "hybrid"
            return {"hits": [], "requestedMode": requested, "effectiveMode": requested}

        primary_profile = bindings[0].retrieval_profile
        requested = str(requested_mode or primary_profile.mode or "hybrid").strip().lower() or "hybrid"
        effective_limit = max(1, min(int(limit or primary_profile.top_k), 20))
        kb_binding_ids = [kb.kb_id for kb in bindings]
        kb_lookup = {kb.kb_id: kb for kb in bindings}

        indexed_docs: list[KnowledgeDocument] = []
        for kb in bindings:
            indexed_docs.extend(
                [
                    item
                    for item in self.store.list_documents(kb.kb_id)
                    if item.doc_status == KnowledgeDocumentStatus.INDEXED
                ]
            )
        if not indexed_docs:
            return {
                "hits": [],
                "requestedMode": requested,
                "effectiveMode": requested,
                "filters": filters or primary_profile.metadata_filters,
            }

        if self.rag_engine is None:
            return {
                "hits": [],
                "requestedMode": requested,
                "effectiveMode": requested,
                "filters": filters or primary_profile.metadata_filters,
                "error": "RAGEngine is not configured.",
            }

        doc_by_reference: dict[str, KnowledgeDocument] = {}
        for document in indexed_docs:
            for candidate in (
                document.file_path,
                Path(document.file_path).name if document.file_path else None,
                document.file_name,
                document.source_uri,
                document.title,
            ):
                normalized = str(candidate or "").strip()
                if normalized and normalized not in doc_by_reference:
                    doc_by_reference[normalized] = document

        try:
            rag_hits = self._run_async(
                self.rag_engine.query(
                    kb_ids=kb_binding_ids,
                    query_text=query,
                    mode=requested,
                    top_k=effective_limit,
                    vlm_enhanced=primary_profile.vlm_enhanced,
                )
            )
        except Exception as exc:
            logger.warning("RAGEngine query failed: {}", exc)
            return {
                "hits": [],
                "requestedMode": requested,
                "effectiveMode": requested,
                "filters": filters or primary_profile.metadata_filters,
                "error": str(exc),
            }

        hits: list[dict[str, Any]] = []
        for hit in rag_hits:
            kb = kb_lookup.get(hit.source or "")
            metadata = dict(hit.metadata or {})
            reference_path = str(metadata.get("file_path") or "").strip()
            reference_doc = (
                doc_by_reference.get(reference_path)
                or doc_by_reference.get(Path(reference_path).name if reference_path else "")
            )
            title = (
                reference_doc.title
                if reference_doc is not None
                else (Path(reference_path).name if reference_path else (kb.name if kb else hit.source))
            )
            hits.append(
                {
                    "kbId": hit.source,
                    "kbName": kb.name if kb else hit.source,
                    "docId": reference_doc.doc_id if reference_doc is not None else None,
                    "title": title,
                    "content": hit.content,
                    "score": hit.score,
                    "metadata": metadata,
                    "citation": {
                        "kbId": hit.source,
                        "kbName": kb.name if kb else hit.source,
                        "docId": reference_doc.doc_id if reference_doc is not None else None,
                        "title": title,
                        "sourceType": reference_doc.source_type if reference_doc is not None else None,
                        "sourceUri": reference_doc.source_uri if reference_doc is not None else reference_path or None,
                        "fileName": reference_doc.file_name if reference_doc is not None else None,
                        "mimeType": reference_doc.mime_type if reference_doc is not None else None,
                        "chunkOrdinal": None,
                    },
                }
            )

        return {
            "hits": hits[:effective_limit],
            "requestedMode": requested,
            "effectiveMode": requested,
            "filters": filters or primary_profile.metadata_filters,
        }
