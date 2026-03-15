"""Service layer for the first embedded enterprise knowledge base slice."""

from __future__ import annotations

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
from typing import Any

import chardet
import httpx
from lxml import html as lxml_html
from loguru import logger
from openpyxl import load_workbook
from readability import Document as ReadabilityDocument

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
from nanobot.platform.search_scoring import (
    build_preview,
    normalize_mode,
    normalize_query_tokens,
    retrieval_score,
    score_threshold,
)
from nanobot.utils.helpers import ensure_dir, safe_filename


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
    """Instance-scoped knowledge base CRUD, ingest, and retrieval service."""

    def __init__(
        self,
        store: KnowledgeBaseStore,
        *,
        instance: PlatformInstance,
        instance_id: str,
        tenant_id: str = "default",
        max_background_jobs: int = 2,
    ):
        self.store = store
        self.instance = instance
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self._executor = ThreadPoolExecutor(
            max_workers=max(1, max_background_jobs),
            thread_name_prefix=f"knowledge-{instance_id}",
        )
        self._futures: set[Future[Any]] = set()
        self._futures_lock = Lock()

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

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

    @staticmethod
    def _split_text(text: str, *, chunk_size: int, chunk_overlap: int) -> list[str]:
        paragraphs = [item.strip() for item in re.split(r"\n\s*\n", text) if item.strip()]
        if not paragraphs:
            return [text]
        chunks: list[str] = []
        current = ""
        step = max(1, chunk_size - chunk_overlap)
        for paragraph in paragraphs:
            candidate = paragraph if not current else f"{current}\n\n{paragraph}"
            if len(candidate) <= chunk_size:
                current = candidate
                continue
            if current:
                chunks.append(current)
            if len(paragraph) <= chunk_size:
                overlap_prefix = current[-chunk_overlap:].strip() if current and chunk_overlap else ""
                current = f"{overlap_prefix}\n{paragraph}".strip() if overlap_prefix else paragraph
                if len(current) <= chunk_size:
                    continue
            for start in range(0, len(paragraph), step):
                piece = paragraph[start:start + chunk_size].strip()
                if piece:
                    chunks.append(piece)
            current = ""
        if current:
            chunks.append(current)
        deduped: list[str] = []
        for chunk in chunks:
            if chunk and (not deduped or deduped[-1] != chunk):
                deduped.append(chunk)
        return deduped or [text]

    def _build_chunk_rows(
        self,
        *,
        content: str,
        title: str,
        profile: KnowledgeRetrievalProfile,
        faq_items: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        raw_chunks = self._faq_chunks(faq_items) if faq_items else self._split_text(
            content,
            chunk_size=profile.chunk_size,
            chunk_overlap=profile.chunk_overlap,
        )
        rows: list[dict[str, Any]] = []
        for ordinal, chunk in enumerate(raw_chunks, start=1):
            rows.append(
                {
                    "chunk_id": _short_id("chunk"),
                    "ordinal": ordinal,
                    "content": chunk,
                    "metadata": {"title": title, "length": len(chunk)},
                    "created_at": now_iso(),
                }
            )
        return rows

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
        kb = self.store.get_kb(kb_id)
        document = self.store.get_document(doc_id)
        job = self.store.get_job(job_id)
        if kb is None or document is None or job is None:
            return
        phase = "parsing"
        try:
            job = self._start_job(job)
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.PARSING, error_summary=None, updated_at=now_iso())
            ) or document
            raw_path = Path(document.file_path or "")
            if not raw_path.exists():
                raise KnowledgeBaseValidationError(f"Uploaded knowledge file missing for document {document.doc_id}.")
            parsed_text, parser_name, metadata, faq_items = self._parse_file_content(
                title=document.title,
                file_name=file_name,
                mime_type=mime_type,
                content=raw_path.read_bytes(),
            )
            parsed_path = Path(document.parsed_path or self._document_paths(kb_id, doc_id, file_name, "upload_file")[1])
            parsed_path.write_text(parsed_text, encoding="utf-8")
            document = self.store.update_document(
                replace(
                    document,
                    parser_name=parser_name,
                    metadata=metadata,
                    parsed_path=str(parsed_path),
                    doc_status=KnowledgeDocumentStatus.PARSED,
                    updated_at=now_iso(),
                )
            ) or document
            phase = "indexing"
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.INDEXING, updated_at=now_iso())
            ) or document
            chunks = self._build_chunk_rows(
                content=parsed_text,
                title=document.title,
                profile=kb.retrieval_profile,
                faq_items=faq_items,
            )
            self.store.replace_chunks(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_id=kb_id,
                doc_id=doc_id,
                title=document.title,
                chunks=chunks,
            )
            self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    chunk_count=len(chunks),
                    error_summary=None,
                    updated_at=now_iso(),
                )
            )
            self._refresh_source_from_document(document)
            self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            self.store.update_document(
                replace(
                    document,
                    doc_status=(
                        KnowledgeDocumentStatus.ERROR_INDEXING
                        if phase == "indexing"
                        else KnowledgeDocumentStatus.ERROR_PARSING
                    ),
                    error_summary=message,
                    updated_at=now_iso(),
                )
            )
            self._finish_job(job, error_summary=message)

    def _run_url_job(self, kb_id: str, doc_id: str, job_id: str) -> None:
        kb = self.store.get_kb(kb_id)
        document = self.store.get_document(doc_id)
        job = self.store.get_job(job_id)
        if kb is None or document is None or job is None:
            return
        phase = "parsing"
        try:
            job = self._start_job(job)
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.PARSING, error_summary=None, updated_at=now_iso())
            ) or document
            url = self._normalize_text(document.source_uri, required=True, field_name="url")
            parsed_text, detected_title, parser_name = self._parse_url(url)
            parsed_path = Path(document.parsed_path or self._document_paths(kb_id, doc_id, "web-url.md", "web_url")[1])
            parsed_path.write_text(parsed_text, encoding="utf-8")
            title = document.title or detected_title or url
            document = self.store.update_document(
                replace(
                    document,
                    title=title,
                    parser_name=parser_name,
                    parsed_path=str(parsed_path),
                    doc_status=KnowledgeDocumentStatus.PARSED,
                    updated_at=now_iso(),
                )
            ) or document
            phase = "indexing"
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.INDEXING, updated_at=now_iso())
            ) or document
            chunks = self._build_chunk_rows(content=parsed_text, title=title, profile=kb.retrieval_profile)
            self.store.replace_chunks(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_id=kb_id,
                doc_id=doc_id,
                title=title,
                chunks=chunks,
            )
            self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    chunk_count=len(chunks),
                    error_summary=None,
                    updated_at=now_iso(),
                )
            )
            self._refresh_source_from_document(document)
            self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            self.store.update_document(
                replace(
                    document,
                    doc_status=(
                        KnowledgeDocumentStatus.ERROR_INDEXING
                        if phase == "indexing"
                        else KnowledgeDocumentStatus.ERROR_PARSING
                    ),
                    error_summary=message,
                    updated_at=now_iso(),
                )
            )
            self._finish_job(job, error_summary=message)

    def _run_faq_job(self, kb_id: str, doc_id: str, job_id: str) -> None:
        kb = self.store.get_kb(kb_id)
        document = self.store.get_document(doc_id)
        job = self.store.get_job(job_id)
        if kb is None or document is None or job is None:
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
            parsed_path = Path(document.parsed_path or self._document_paths(kb_id, doc_id, "faq.json", "faq_table")[1])
            parsed_path.write_text(parsed_text, encoding="utf-8")
            document = self.store.update_document(
                replace(
                    document,
                    parsed_path=str(parsed_path),
                    parser_name="faq_table",
                    doc_status=KnowledgeDocumentStatus.PARSED,
                    updated_at=now_iso(),
                )
            ) or document
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.INDEXING, updated_at=now_iso())
            ) or document
            chunks = self._build_chunk_rows(
                content=parsed_text,
                title=document.title,
                profile=kb.retrieval_profile,
                faq_items=items,
            )
            self.store.replace_chunks(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_id=kb_id,
                doc_id=doc_id,
                title=document.title,
                chunks=chunks,
            )
            self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    chunk_count=len(chunks),
                    error_summary=None,
                    updated_at=now_iso(),
                )
            )
            self._refresh_source_from_document(document)
            self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.ERROR_INDEXING,
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
                document = self.store.update_document(
                    replace(document, doc_status=KnowledgeDocumentStatus.PARSING, updated_at=now_iso())
                ) or document
                parsed_text, parser_name, metadata, faq_items = self._parse_file_content(
                    title=document.title,
                    file_name=file_name,
                    mime_type=mime_type,
                    content=bytes(content),
                )
                parsed_path.write_text(parsed_text, encoding="utf-8")
                document = self.store.update_document(
                    replace(
                        document,
                        parser_name=parser_name,
                        metadata=metadata,
                        parsed_path=str(parsed_path),
                        doc_status=KnowledgeDocumentStatus.PARSED,
                        updated_at=now_iso(),
                    )
                ) or document
                document = self.store.update_document(
                    replace(document, doc_status=KnowledgeDocumentStatus.INDEXING, updated_at=now_iso())
                ) or document
                chunks = self._build_chunk_rows(
                    content=parsed_text,
                    title=document.title,
                    profile=kb.retrieval_profile,
                    faq_items=faq_items,
                )
                self.store.replace_chunks(
                    tenant_id=self.tenant_id,
                    instance_id=self.instance_id,
                    kb_id=kb_id,
                    doc_id=doc_id,
                    title=document.title,
                    chunks=chunks,
                )
                document = self.store.update_document(
                    replace(
                        document,
                        doc_status=KnowledgeDocumentStatus.INDEXED,
                        chunk_count=len(chunks),
                        updated_at=now_iso(),
                    )
                ) or document
                job = self._finish_job(job)
            except Exception as exc:
                message = str(exc)
                document = self.store.update_document(
                    replace(
                        document,
                        doc_status=(
                            KnowledgeDocumentStatus.ERROR_INDEXING
                            if document.doc_status == KnowledgeDocumentStatus.INDEXING
                            else KnowledgeDocumentStatus.ERROR_PARSING
                        ),
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
            parsed_path.write_text(parsed_text, encoding="utf-8")
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
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.INDEXING, updated_at=now_iso())
            ) or document
            chunks = self._build_chunk_rows(content=parsed_text, title=title, profile=kb.retrieval_profile)
            self.store.replace_chunks(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_id=kb_id,
                doc_id=doc_id,
                title=title,
                chunks=chunks,
            )
            document = self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    chunk_count=len(chunks),
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            document = self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.ERROR_PARSING,
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
        parsed_path.write_text(parsed_text, encoding="utf-8")
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
            document = self.store.update_document(
                replace(document, doc_status=KnowledgeDocumentStatus.INDEXING, updated_at=now_iso())
            ) or document
            chunks = self._build_chunk_rows(
                content=parsed_text,
                title=title,
                profile=kb.retrieval_profile,
                faq_items=items,
            )
            self.store.replace_chunks(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_id=kb_id,
                doc_id=doc_id,
                title=title,
                chunks=chunks,
            )
            document = self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.INDEXED,
                    chunk_count=len(chunks),
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job)
        except Exception as exc:
            message = str(exc)
            document = self.store.update_document(
                replace(
                    document,
                    doc_status=KnowledgeDocumentStatus.ERROR_INDEXING,
                    error_summary=message,
                    updated_at=now_iso(),
                )
            ) or document
            job = self._finish_job(job, error_summary=message)
        return {"documents": [document.to_dict()], "jobs": [job.to_dict()]}

    @staticmethod
    def _build_match_query(query: str) -> str:
        terms = normalize_query_tokens(query)
        if not terms:
            return query.strip()
        return " OR ".join(f'"{term}"' for term in terms[:8])

    @staticmethod
    def _build_prefix_match_query(query: str) -> str:
        terms = normalize_query_tokens(query)
        if not terms:
            return query.strip()
        parts: list[str] = []
        for term in terms[:8]:
            variants = {term}
            for suffix in ("ing", "ed", "es", "s"):
                if len(term) > len(suffix) + 2 and term.endswith(suffix):
                    variants.add(term[: -len(suffix)])
            for variant in sorted(variants):
                if len(variant) >= 3:
                    parts.append(f"{variant}*")
                else:
                    parts.append(f'"{variant}"')
        return " OR ".join(parts)

    @staticmethod
    def _row_retrieval_score(row: dict[str, Any], *, mode: str, query: str, query_tokens: list[str]) -> float:
        text = "\n".join(
            part
            for part in [str(row.get("title") or "").strip(), str(row.get("content") or "").strip()]
            if part
        )
        base_score = retrieval_score(mode, query, text, query_tokens=query_tokens)
        raw_rank = float(row.get("rank") or 0.0)
        fts_score = 0.0 if raw_rank == 0.0 else round(1.0 / (1.0 + abs(raw_rank)), 6)
        if mode == "keyword":
            return max(base_score, fts_score)
        if mode == "hybrid":
            return round((base_score * 0.8) + (fts_score * 0.2), 6)
        return base_score

    @staticmethod
    def _apply_filters(rows: list[dict[str, Any]], filters: dict[str, Any]) -> list[dict[str, Any]]:
        if not filters:
            return rows
        doc_id = str(filters.get("doc_id") or filters.get("docId") or "").strip()
        source_type = str(filters.get("source_type") or filters.get("sourceType") or "").strip()
        locale = str(filters.get("locale") or "").strip()
        tags = filters.get("tags") or []
        normalized_tags = {str(item).strip() for item in tags if str(item).strip()} if isinstance(tags, list) else set()

        result: list[dict[str, Any]] = []
        for row in rows:
            doc_metadata = json.loads(row.get("document_metadata_json") or "{}")
            if doc_id and row["doc_id"] != doc_id:
                continue
            if source_type and row["source_type"] != source_type:
                continue
            if locale and str(doc_metadata.get("locale") or "") != locale:
                continue
            if normalized_tags:
                doc_tags = {str(item).strip() for item in doc_metadata.get("tags") or [] if str(item).strip()}
                if not normalized_tags.intersection(doc_tags):
                    continue
            result.append(row)
        return result

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
            requested = normalize_mode(requested_mode, default="hybrid")
            return {"hits": [], "requestedMode": requested, "effectiveMode": requested}
        primary_profile = bindings[0].retrieval_profile
        requested = normalize_mode(requested_mode, default=normalize_mode(primary_profile.mode, default="hybrid"))
        effective_limit = max(1, min(int(limit or primary_profile.top_k), 20))
        query_tokens = normalize_query_tokens(query)
        kb_binding_ids = [kb.kb_id for kb in bindings]
        pool_limit = max(primary_profile.chunk_top_k * 4, effective_limit * 6, 40)
        candidate_rows: dict[str, dict[str, Any]] = {}

        match_queries = [self._build_match_query(query)]
        if requested in {"semantic", "hybrid"}:
            prefix_query = self._build_prefix_match_query(query)
            if prefix_query and prefix_query not in match_queries:
                match_queries.append(prefix_query)

        for match_query in match_queries:
            if not match_query:
                continue
            for row in self.store.search_chunks(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_ids=kb_binding_ids,
                query_text=match_query,
                limit=pool_limit,
            ):
                candidate_rows.setdefault(row["chunk_id"], row)

        if requested in {"semantic", "hybrid"}:
            for row in self.store.list_chunks(
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                kb_ids=kb_binding_ids,
                limit=max(primary_profile.chunk_top_k * 10, effective_limit * 12, 120),
            ):
                candidate_rows.setdefault(row["chunk_id"], row)

        rows = list(candidate_rows.values())
        filtered_rows = self._apply_filters(rows, filters or primary_profile.metadata_filters)
        kb_lookup = {kb.kb_id: kb for kb in bindings}
        hits: list[dict[str, Any]] = []
        for row in filtered_rows:
            kb = kb_lookup.get(row["kb_id"])
            metadata = json.loads(row.get("metadata_json") or "{}")
            score = self._row_retrieval_score(row, mode=requested, query=query, query_tokens=query_tokens)
            if score <= score_threshold(requested):
                continue
            preview = build_preview(row["content"], query_tokens, width=240)
            hits.append(
                {
                    "chunkId": row["chunk_id"],
                    "kbId": row["kb_id"],
                    "kbName": kb.name if kb else row["kb_id"],
                    "docId": row["doc_id"],
                    "title": row["title"],
                    "content": row["content"],
                    "preview": preview,
                    "score": score,
                    "metadata": metadata,
                    "citation": {
                        "kbId": row["kb_id"],
                        "kbName": kb.name if kb else row["kb_id"],
                        "docId": row["doc_id"],
                        "title": row["title"],
                        "sourceType": row["source_type"],
                        "sourceUri": row["source_uri"],
                        "fileName": row["file_name"],
                        "mimeType": row["mime_type"],
                        "chunkOrdinal": row["ordinal"],
                    },
                }
            )
        hits.sort(key=lambda item: (item["score"], item["title"]), reverse=True)
        return {
            "hits": hits[:effective_limit],
            "requestedMode": requested,
            "effectiveMode": requested,
            "filters": filters or primary_profile.metadata_filters,
        }
