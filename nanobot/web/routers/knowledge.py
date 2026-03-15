"""Knowledge-base routes for the collaboration control plane."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse

from nanobot.platform.knowledge import (
    KnowledgeBaseConflictError,
    KnowledgeBaseNotFoundError,
    KnowledgeSourceNotFoundError,
    KnowledgeBaseValidationError,
)
from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


@router.get("/api/v1/knowledge-bases")
def list_knowledge_bases(
    request: Request,
    enabled: bool | None = Query(default=None),
) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.knowledge.list_knowledge_bases(enabled=enabled)))


@router.post("/api/v1/knowledge-bases")
def create_knowledge_base(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.create_knowledge_base(payload)
    except KnowledgeBaseConflictError as exc:
        raise APIError(409, "KNOWLEDGE_BASE_CONFLICT", str(exc)) from exc
    except KnowledgeBaseValidationError as exc:
        raise APIError(400, "KNOWLEDGE_BASE_INVALID", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}")
def get_knowledge_base(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_knowledge_base(kb_id)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/knowledge-bases/{kb_id}")
def update_knowledge_base(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.update_knowledge_base(kb_id, payload)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    except KnowledgeBaseConflictError as exc:
        raise APIError(409, "KNOWLEDGE_BASE_CONFLICT", str(exc)) from exc
    except KnowledgeBaseValidationError as exc:
        raise APIError(400, "KNOWLEDGE_BASE_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}")
def delete_knowledge_base(request: Request, kb_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.knowledge.delete_knowledge_base(kb_id)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))


@router.get("/api/v1/knowledge-bases/{kb_id}/documents")
def list_knowledge_documents(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.list_documents(kb_id)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/sources")
def list_knowledge_sources(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.list_sources(kb_id)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/knowledge-bases/{kb_id}/sources/{source_id}")
def update_knowledge_source(
    request: Request,
    kb_id: str,
    source_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.update_source(kb_id, source_id, payload)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    except KnowledgeSourceNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_SOURCE_NOT_FOUND", "Knowledge source not found.") from exc
    except KnowledgeBaseValidationError as exc:
        raise APIError(400, "KNOWLEDGE_SOURCE_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}/documents/{doc_id}")
def delete_knowledge_document(request: Request, kb_id: str, doc_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.knowledge.delete_document(kb_id, doc_id)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_DOCUMENT_NOT_FOUND", "Knowledge document not found.") from exc
    return _json_response(200, _ok({"deleted": deleted}))


@router.post("/api/v1/knowledge-bases/{kb_id}/documents/delete")
def delete_knowledge_documents(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    raw_doc_ids = payload.get("docIds")
    doc_ids = raw_doc_ids if isinstance(raw_doc_ids, list) else []
    try:
        data = request.app.state.knowledge.delete_documents(kb_id, doc_ids)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    except KnowledgeBaseValidationError as exc:
        raise APIError(400, "KNOWLEDGE_DOCUMENT_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/jobs")
def list_knowledge_jobs(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.list_jobs(kb_id)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/documents")
async def ingest_knowledge_documents(request: Request, kb_id: str) -> JSONResponse:
    content_type = request.headers.get("content-type", "")
    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            raw_files = [item for item in form.getlist("file") if hasattr(item, "read")]
            if not raw_files:
                raise KnowledgeBaseValidationError("Knowledge upload requires at least one file.")
            files = []
            for item in raw_files:
                files.append(
                    {
                        "file_name": getattr(item, "filename", None) or "knowledge-upload.txt",
                        "mime_type": getattr(item, "content_type", None),
                        "content": await item.read(),
                    }
                )
            data = request.app.state.knowledge.enqueue_uploaded_files(kb_id, files)
        else:
            payload = await request.json()
            source_type = str(payload.get("sourceType") or payload.get("source_type") or "").strip()
            if source_type == "web_url":
                data = request.app.state.knowledge.enqueue_url(kb_id, payload)
            elif source_type == "faq_table":
                data = request.app.state.knowledge.enqueue_faq_table(kb_id, payload)
            else:
                raise KnowledgeBaseValidationError(
                    "Unsupported knowledge sourceType. Use multipart file upload, web_url, or faq_table."
                )
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    except KnowledgeBaseValidationError as exc:
        raise APIError(400, "KNOWLEDGE_DOCUMENT_INVALID", str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise APIError(400, "KNOWLEDGE_DOCUMENT_INVALID", "Invalid JSON payload.") from exc
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/retrieve-test")
def retrieve_test(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    query = str(payload.get("query") or "").strip()
    filters = payload.get("filters")
    mode = payload.get("mode")
    limit = payload.get("limit")
    try:
        data = request.app.state.knowledge.retrieve(
            kb_ids=[kb_id],
            query=query,
            limit=limit,
            filters=filters if isinstance(filters, dict) else None,
            requested_mode=str(mode).strip() if mode else None,
        )
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    except KnowledgeBaseValidationError as exc:
        raise APIError(400, "KNOWLEDGE_RETRIEVE_INVALID", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/reindex")
def reindex_knowledge_documents(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.reindex_documents(kb_id, payload)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    except KnowledgeBaseValidationError as exc:
        raise APIError(400, "KNOWLEDGE_REINDEX_INVALID", str(exc)) from exc
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/sources/{source_id}/sync")
def sync_knowledge_source(request: Request, kb_id: str, source_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.sync_source(kb_id, source_id)
    except KnowledgeBaseNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    except KnowledgeSourceNotFoundError as exc:
        raise APIError(404, "KNOWLEDGE_SOURCE_NOT_FOUND", "Knowledge source not found.") from exc
    except KnowledgeBaseValidationError as exc:
        raise APIError(400, "KNOWLEDGE_SOURCE_INVALID", str(exc)) from exc
    return _json_response(202, _ok(data))
