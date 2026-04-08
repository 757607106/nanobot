"""File management subsystem for knowledge bases."""

from __future__ import annotations

import csv
import hashlib
import io
import mimetypes
import shutil
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse
from dataclasses import replace

import chardet
import httpx
from loguru import logger
from lxml import html as lxml_html
from openpyxl import load_workbook
from readability import Document as ReadabilityDocument

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge.models import (
    KnowledgeDocumentStatus,
    KnowledgeFile,
    now_iso,
)
from nanobot.platform.knowledge.store import KnowledgeBaseStore
from nanobot.platform.knowledge.service import (
    KnowledgeBaseValidationError,
    KnowledgeSourceNotFoundError,
)
from nanobot.platform.knowledge.utils import get_value, normalize_text, short_id, normalize_string_list
from nanobot.utils.helpers import safe_filename, ensure_dir

if TYPE_CHECKING:
    pass

class KnowledgeFileManager:
    """Handles folder, file, and web source CRUD for a knowledge base."""

    def __init__(
        self,
        *,
        store: KnowledgeBaseStore,
        instance: PlatformInstance | None,
        tenant_id: str,
        instance_id: str,
        artifacts: Any,
        rag_engine: Any,
        run_async_fn: Any,
        raw_dir_fn: Any,
        parsed_dir_fn: Any,
        create_job_fn: Any,
        start_job_fn: Any,
        submit_job_fn: Any,
        parse_job_fn: Any,
        require_kb_fn: Any,
        ingest_files_fn: Any,
    ) -> None:
        self.store = store
        self.instance = instance
        self.tenant_id = tenant_id
        self.instance_id = instance_id
        self.artifacts = artifacts
        self.rag_engine = rag_engine
        self._run_async = run_async_fn
        self._kb_raw_dir = raw_dir_fn
        self._kb_parsed_dir = parsed_dir_fn
        self._create_job = create_job_fn
        self._start_job = start_job_fn
        self._submit_background_job = submit_job_fn
        self._run_parse_job = parse_job_fn
        self.require_kb = require_kb_fn
        self.ingest_files = ingest_files_fn

    # ── Internal Helpers ──

    def _file_storage_paths(self, kb_id: str, file_id: str, filename: str) -> tuple[Path, Path]:
        raw_dir = self._kb_raw_dir(kb_id)
        parsed_dir = self._kb_parsed_dir(kb_id)
        parsed_path = parsed_dir / f"{file_id}.md"
        suffix = Path(filename).suffix
        raw_path = raw_dir / (f"{file_id}{suffix}" if suffix else file_id)
        return raw_path, parsed_path

    def _list_descendant_ids(self, kb_id: str, root_file_id: str) -> list[str]:
        files = self.store.list_files(kb_id)
        by_parent: dict[str | None, list[KnowledgeFile]] = {}
        for item in files:
            by_parent.setdefault(item.parent_id, []).append(item)
        result: list[str] = []
        stack = [root_file_id]
        while stack:
            current = stack.pop()
            result.append(current)
            for child in by_parent.get(current, []):
                stack.append(child.file_id)
        return result

    def _require_file(self, kb_id: str, file_id: str) -> KnowledgeFile:
        file = self.store.get_file(file_id)
        if file is None or file.kb_id != kb_id:
            raise KnowledgeSourceNotFoundError(file_id)
        return file

    def _ensure_parent_folder(self, kb_id: str, parent_id: str | None) -> KnowledgeFile | None:
        if not parent_id:
            return None
        parent = self._require_file(kb_id, parent_id)
        if not parent.is_folder:
            raise KnowledgeBaseValidationError("parentId must reference a folder.")
        return parent

    def _logical_path(self, parent: KnowledgeFile | None, filename: str) -> str:
        clean_name = filename.strip()
        if not clean_name:
            raise KnowledgeBaseValidationError("filename is required.")
        if parent is None:
            return f"/{clean_name}"
        return f"{parent.path.rstrip('/')}/{clean_name}"

    def _dedupe_filename(
        self,
        kb_id: str,
        parent_id: str | None,
        filename: str,
        *,
        exclude_file_id: str | None = None,
    ) -> str:
        files = self.store.list_files(kb_id)
        sibling_names = {
            item.filename.lower()
            for item in files
            if item.parent_id == parent_id and item.file_id != exclude_file_id
        }
        if filename.lower() not in sibling_names:
            return filename
        stem = Path(filename).stem
        suffix = Path(filename).suffix
        counter = 2
        while True:
            candidate = f"{stem}-{counter}{suffix}"
            if candidate.lower() not in sibling_names:
                return candidate
            counter += 1

    def _update_file(self, file: KnowledgeFile) -> KnowledgeFile:
        updated = self.store.update_file(file)
        if updated is None:
            raise KnowledgeSourceNotFoundError(file.file_id)
        return updated

    def _update_file_path_recursive(self, kb_id: str, file: KnowledgeFile, *, parent: KnowledgeFile | None) -> None:
        next_path = self._logical_path(parent, file.filename)
        updated = self._update_file(replace(file, path=next_path, updated_at=now_iso()))
        children = [item for item in self.store.list_files(kb_id) if item.parent_id == file.file_id]
        for child in children:
            self._update_file_path_recursive(kb_id, child, parent=updated)

    def _serialize_file(self, file: KnowledgeFile) -> dict[str, Any]:
        return file.to_dict()

    # ── Public API ──

    def list_files(self, kb_id: str) -> dict[str, Any]:
        self.require_kb(kb_id)
        files = self.store.list_files(kb_id)
        return {
            "items": [self._serialize_file(item) for item in files],
            "stats": self.store.get_kb_stats(kb_id),
        }

    def create_folder(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.require_kb(kb_id)
        parent = self._ensure_parent_folder(kb_id, normalize_text(payload.get("parentId"), field_name="parentId") or None)
        name = normalize_text(get_value(payload, "name", "filename"), required=True, field_name="name")
        filename = self._dedupe_filename(kb_id, parent.file_id if parent else None, name)
        now = now_iso()
        folder = self.store.insert_file(
            KnowledgeFile(
                file_id=short_id("file"),
                kb_id=kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                parent_id=parent.file_id if parent else None,
                filename=filename,
                original_filename=filename,
                file_type="folder",
                path=self._logical_path(parent, filename),
                raw_path=None,
                markdown_file=None,
                status=KnowledgeDocumentStatus.FOLDER,
                is_folder=True,
                created_at=now,
                updated_at=now,
            )
        )
        return self._serialize_file(folder)

    def upload_files(self, kb_id: str, files: list[dict[str, Any]], *, parent_id: str | None = None) -> dict[str, Any]:
        self.require_kb(kb_id)
        parent = self._ensure_parent_folder(kb_id, parent_id)
        created: list[dict[str, Any]] = []
        for item in files:
            content = item.get("content")
            if not isinstance(content, (bytes, bytearray)) or not content:
                raise KnowledgeBaseValidationError("Uploaded knowledge file content is required.")
            file_name = normalize_text(item.get("file_name"), required=True, field_name="file_name")
            mime_type = normalize_text(item.get("mime_type"), field_name="mime_type") or None
            filename = self._dedupe_filename(kb_id, parent.file_id if parent else None, file_name)
            file_id = short_id("file")
            raw_path, parsed_path = self._file_storage_paths(kb_id, file_id, filename)
            raw_path.write_bytes(bytes(content))
            now = now_iso()
            record = self.store.insert_file(
                KnowledgeFile(
                    file_id=file_id,
                    kb_id=kb_id,
                    tenant_id=self.tenant_id,
                    instance_id=self.instance_id,
                    parent_id=parent.file_id if parent else None,
                    filename=filename,
                    original_filename=file_name,
                    file_type=(Path(filename).suffix.lower().lstrip(".") or "file"),
                    path=self._logical_path(parent, filename),
                    raw_path=str(raw_path),
                    markdown_file=str(parsed_path),
                    status=KnowledgeDocumentStatus.UPLOADED,
                    content_hash=hashlib.sha256(bytes(content)).hexdigest(),
                    file_size=len(content),
                    content_type=mime_type,
                    processing_params={"sourceType": "upload"},
                    is_folder=False,
                    created_at=now,
                    updated_at=now,
                )
            )
            created.append(self._serialize_file(record))
        return {"items": created}

    def fetch_url_file(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.require_kb(kb_id)
        url = normalize_text(get_value(payload, "url"), required=True, field_name="url")
        parent = self._ensure_parent_folder(kb_id, normalize_text(payload.get("parentId"), field_name="parentId") or None)

        response = httpx.get(url, timeout=20.0, follow_redirects=True)
        response.raise_for_status()
        content_type = str(response.headers.get("content-type") or "").split(";")[0].strip() or None
        suffix = Path(urlparse(url).path).suffix
        if not suffix and content_type:
            suffix = mimetypes.guess_extension(content_type) or ".html"
        base_name = Path(urlparse(url).path).name or "web-source"
        filename = base_name if Path(base_name).suffix else f"{base_name}{suffix or '.html'}"
        filename = self._dedupe_filename(kb_id, parent.file_id if parent else None, safe_filename(filename))
        file_id = short_id("file")
        raw_path, parsed_path = self._file_storage_paths(kb_id, file_id, filename)
        raw_path.write_bytes(response.content)
        now = now_iso()
        record = self.store.insert_file(
            KnowledgeFile(
                file_id=file_id,
                kb_id=kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                parent_id=parent.file_id if parent else None,
                filename=filename,
                original_filename=filename,
                file_type="web_url",
                path=self._logical_path(parent, filename),
                raw_path=str(raw_path),
                markdown_file=str(parsed_path),
                status=KnowledgeDocumentStatus.UPLOADED,
                content_hash=hashlib.sha256(response.content).hexdigest(),
                file_size=len(response.content),
                content_type=content_type,
                processing_params={
                    "sourceType": "web_url",
                    "sourceUrl": url,
                    "sourceTitle": base_name,
                    "sourceEnabled": True,
                    "syncCount": 1,
                },
                created_at=now,
                updated_at=now,
            )
        )
        return self._serialize_file(record)

    def _normalize_faq_items(self, items: Any) -> list[dict[str, str]]:
        if not isinstance(items, list) or not items:
            raise KnowledgeBaseValidationError("FAQ table source requires a non-empty items list.")
        normalized_items: list[dict[str, str]] = []
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                raise KnowledgeBaseValidationError(f"FAQ item {index} must be an object.")
            question = normalize_text(item.get("question"), required=True, field_name=f"items[{index}].question")
            answer = normalize_text(item.get("answer"), required=True, field_name=f"items[{index}].answer")
            normalized_items.append({"question": question, "answer": answer})
        return normalized_items

    def add_source_file(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        source_type = normalize_text(payload.get("sourceType"), required=True, field_name="sourceType")
        if source_type == "web_url":
            return self.fetch_url_file(kb_id, payload)
        if source_type != "faq_table":
            raise KnowledgeBaseValidationError(f"Unsupported knowledge source type: {source_type}")

        self.require_kb(kb_id)
        normalized_items = self._normalize_faq_items(payload.get("items"))

        parent = self._ensure_parent_folder(kb_id, normalize_text(payload.get("parentId"), field_name="parentId") or None)
        title = normalize_text(payload.get("title"), field_name="title") or "faq-table"
        filename = self._dedupe_filename(kb_id, parent.file_id if parent else None, safe_filename(f"{title}.json"))
        file_id = short_id("file")
        raw_path, parsed_path = self._file_storage_paths(kb_id, file_id, filename)
        raw_bytes = json.dumps(normalized_items, ensure_ascii=False, indent=2).encode("utf-8")
        raw_path.write_bytes(raw_bytes)
        now = now_iso()
        record = self.store.insert_file(
            KnowledgeFile(
                file_id=file_id,
                kb_id=kb_id,
                tenant_id=self.tenant_id,
                instance_id=self.instance_id,
                parent_id=parent.file_id if parent else None,
                filename=filename,
                original_filename=filename,
                file_type="faq_table",
                path=self._logical_path(parent, filename),
                raw_path=str(raw_path),
                markdown_file=str(parsed_path),
                status=KnowledgeDocumentStatus.UPLOADED,
                content_hash=hashlib.sha256(raw_bytes).hexdigest(),
                file_size=len(raw_bytes),
                content_type="application/json",
                processing_params={
                    "sourceType": "faq_table",
                    "faqItems": normalized_items,
                    "sourceTitle": title,
                    "sourceEnabled": True,
                    "syncCount": 1,
                },
                created_at=now,
                updated_at=now,
            )
        )
        return self._serialize_file(record)

    @staticmethod
    def _is_source_type_supported(source_type: str) -> bool:
        return source_type in {"faq_table", "web_url"}

    def _is_source_file(self, file: KnowledgeFile) -> bool:
        source_type = str(file.processing_params.get("sourceType") or "").strip()
        return not file.is_folder and self._is_source_type_supported(source_type)

    def _source_title(self, file: KnowledgeFile) -> str:
        return (
            normalize_text(file.processing_params.get("sourceTitle"), field_name="sourceTitle")
            or Path(file.filename).stem
            or file.filename
        )

    def _serialize_source(self, file: KnowledgeFile) -> dict[str, Any]:
        source_type = str(file.processing_params.get("sourceType") or file.file_type or "").strip()
        return {
            "sourceId": file.file_id,
            "kbId": file.kb_id,
            "sourceType": source_type,
            "title": self._source_title(file),
            "enabled": bool(file.processing_params.get("sourceEnabled", True)),
            "syncSupported": self._is_source_type_supported(source_type),
            "syncCount": int(file.processing_params.get("syncCount") or 1),
            "docCount": 1,
            "latestDocument": self._serialize_file(file),
            "config": {
                "title": self._source_title(file),
                "items": list(file.processing_params.get("faqItems") or []),
                "url": normalize_text(file.processing_params.get("sourceUrl"), field_name="sourceUrl") or None,
            },
            "createdAt": file.created_at,
            "updatedAt": file.updated_at,
        }

    def list_sources(self, kb_id: str) -> list[dict[str, Any]]:
        self.require_kb(kb_id)
        files = [item for item in self.store.list_files(kb_id) if self._is_source_file(item)]
        files.sort(key=lambda item: item.updated_at, reverse=True)
        return [self._serialize_source(item) for item in files]

    def update_source(self, kb_id: str, source_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        source = self._require_file(kb_id, source_id)
        if not self._is_source_file(source):
            raise KnowledgeSourceNotFoundError(source_id)

        source_type = str(source.processing_params.get("sourceType") or "").strip()
        processing_params = dict(source.processing_params)
        title = normalize_text(payload.get("title"), field_name="title") or self._source_title(source)
        enabled = (
            bool(payload.get("enabled"))
            if "enabled" in payload
            else bool(processing_params.get("sourceEnabled", True))
        )

        content_hash = source.content_hash
        file_size = source.file_size
        content_type = source.content_type

        if source_type == "faq_table":
            items = payload.get("items") if "items" in payload else processing_params.get("faqItems")
            normalized_items = self._normalize_faq_items(items)
            raw_bytes = json.dumps(normalized_items, ensure_ascii=False, indent=2).encode("utf-8")
            raw_path = Path(source.raw_path or self._file_storage_paths(kb_id, source.file_id, source.filename)[0])
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(raw_bytes)
            processing_params["faqItems"] = normalized_items
            content_hash = hashlib.sha256(raw_bytes).hexdigest()
            file_size = len(raw_bytes)
            content_type = "application/json"
        elif source_type == "web_url":
            url_value = (
                normalize_text(payload.get("url"), field_name="url")
                or normalize_text(payload.get("sourceUrl"), field_name="sourceUrl")
                or normalize_text(processing_params.get("sourceUrl"), field_name="sourceUrl")
            )
            if not url_value:
                raise KnowledgeBaseValidationError("Web source requires a non-empty url.")
            processing_params["sourceUrl"] = url_value

        processing_params["sourceTitle"] = title
        processing_params["sourceEnabled"] = enabled
        updated = self._update_file(
            replace(
                source,
                content_hash=content_hash,
                file_size=file_size,
                content_type=content_type,
                processing_params=processing_params,
                updated_at=now_iso(),
            )
        )
        return self._serialize_source(updated)

    def sync_source(self, kb_id: str, source_id: str) -> dict[str, Any]:
        source = self._require_file(kb_id, source_id)
        if not self._is_source_file(source):
            raise KnowledgeSourceNotFoundError(source_id)

        source_type = str(source.processing_params.get("sourceType") or "").strip()
        processing_params = dict(source.processing_params)
        updated_source = source

        if source_type == "faq_table":
            raw_bytes = json.dumps(
                self._normalize_faq_items(processing_params.get("faqItems")),
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8")
            raw_path = Path(source.raw_path or self._file_storage_paths(kb_id, source.file_id, source.filename)[0])
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(raw_bytes)
            processing_params["syncCount"] = int(processing_params.get("syncCount") or 1) + 1
            updated_source = self._update_file(
                replace(
                    source,
                    status=KnowledgeDocumentStatus.UPLOADED,
                    content_hash=hashlib.sha256(raw_bytes).hexdigest(),
                    file_size=len(raw_bytes),
                    content_type="application/json",
                    processing_params=processing_params,
                    error_message=None,
                    updated_at=now_iso(),
                )
            )
        elif source_type == "web_url":
            url = normalize_text(processing_params.get("sourceUrl"), required=True, field_name="sourceUrl")
            response = httpx.get(url, timeout=20.0, follow_redirects=True)
            response.raise_for_status()
            raw_path = Path(source.raw_path or self._file_storage_paths(kb_id, source.file_id, source.filename)[0])
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(response.content)
            processing_params["syncCount"] = int(processing_params.get("syncCount") or 1) + 1
            updated_source = self._update_file(
                replace(
                    source,
                    status=KnowledgeDocumentStatus.UPLOADED,
                    content_hash=hashlib.sha256(response.content).hexdigest(),
                    file_size=len(response.content),
                    content_type=str(response.headers.get("content-type") or "").split(";")[0].strip() or None,
                    processing_params=processing_params,
                    error_message=None,
                    updated_at=now_iso(),
                )
            )

        ingest = self.store.ingest_files(
            kb_id,
            {
                "fileIds": [updated_source.file_id],
                "params": {"autoIndex": True},
            },
        )
        refreshed = self._require_file(kb_id, updated_source.file_id)
        return {
            "source": self._serialize_source(refreshed),
            "document": self._serialize_file(refreshed),
            "job": dict(ingest.get("job") or {}),
        }

    def move_file(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.require_kb(kb_id)
        file_id = normalize_text(payload.get("fileId"), required=True, field_name="fileId")
        target_parent_id = normalize_text(payload.get("targetParentId"), field_name="targetParentId") or None
        rename_to = normalize_text(payload.get("filename"), field_name="filename") or None

        file = self._require_file(kb_id, file_id)
        parent = self._ensure_parent_folder(kb_id, target_parent_id)
        if file.is_folder and parent is not None:
            descendants = set(self._list_descendant_ids(kb_id, file.file_id))
            if parent.file_id in descendants:
                raise KnowledgeBaseValidationError("Cannot move a folder into its own descendant.")

        filename = self._dedupe_filename(
            kb_id,
            parent.file_id if parent else None,
            rename_to or file.filename,
            exclude_file_id=file.file_id,
        )
        updated = self._update_file(
            replace(
                file,
                parent_id=parent.file_id if parent else None,
                filename=filename,
                path=self._logical_path(parent, filename),
                updated_at=now_iso(),
            )
        )
        for child in [item for item in self.store.list_files(kb_id) if item.parent_id == updated.file_id]:
            self._update_file_path_recursive(kb_id, child, parent=updated)
        return self._serialize_file(updated)

    def delete_file(self, kb_id: str, file_id: str) -> bool:
        self.require_kb(kb_id)
        descendants = list(reversed(self._list_descendant_ids(kb_id, file_id)))
        for target_id in descendants:
            file = self._require_file(kb_id, target_id)
            if (
                not file.is_folder
                and file.status == KnowledgeDocumentStatus.INDEXED
            ):
                # Delete from LightRAG Server
                if self.rag_engine is not None:
                    try:
                        self._run_async(self.rag_engine.delete_document(kb_id, file.file_id))
                    except Exception:
                        logger.exception("Failed to delete indexed knowledge file {}", file.file_id)
            if not file.is_folder:
                self.artifacts.remove_chunk_entries_for_file(kb_id, file.file_id)
            for candidate in (file.raw_path, file.markdown_file):
                if candidate:
                    path = Path(candidate)
                    if path.exists():
                        try:
                            path.unlink()
                        except OSError:
                            logger.warning("Failed to remove knowledge artifact {}", candidate)
            self.store.delete_file(target_id)
        return True

    def delete_files(self, kb_id: str, file_ids: list[str]) -> dict[str, Any]:
        deleted: list[str] = []
        for file_id in normalize_string_list(file_ids, field_name="fileIds"):
            if self.delete_file(kb_id, file_id):
                deleted.append(file_id)
        return {"deletedCount": len(deleted), "fileIds": deleted}

    def get_file_detail(self, kb_id: str, file_id: str) -> dict[str, Any]:
        self.require_kb(kb_id)
        file = self._require_file(kb_id, file_id)
        return self._serialize_file(file)

    def get_download_path(self, kb_id: str, file_id: str, *, variant: str = "raw") -> Path:
        self.require_kb(kb_id)
        file = self._require_file(kb_id, file_id)
        if file.is_folder:
            raise KnowledgeBaseValidationError("Cannot download a folder.")
        path = self._kb_raw_dir(kb_id) / file.file_id
        if not path.is_file():
            raise KnowledgeSourceNotFoundError(f"Blob for file {file_id}")
        return path
