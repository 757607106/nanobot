"""Primary v1 knowledge-base routes for the rebuilt knowledge workspace."""

from __future__ import annotations

import functools
from typing import Any

from fastapi import APIRouter, Body, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from nanobot.platform.knowledge import (
    KnowledgeBaseConflictError,
    KnowledgeBaseNotFoundError,
    KnowledgeBaseValidationError,
    KnowledgeSourceNotFoundError,
)
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_knowledge_service

router = APIRouter()


def _handle_knowledge_error(exc: Exception) -> None:
    if isinstance(exc, KnowledgeBaseNotFoundError):
        raise APIError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found.") from exc
    if isinstance(exc, KnowledgeSourceNotFoundError):
        raise APIError(404, "KNOWLEDGE_FILE_NOT_FOUND", "Knowledge file not found.") from exc
    if isinstance(exc, KnowledgeBaseConflictError):
        raise APIError(409, "KNOWLEDGE_BASE_CONFLICT", str(exc)) from exc
    if isinstance(exc, KnowledgeBaseValidationError):
        raise APIError(400, "KNOWLEDGE_INVALID", str(exc)) from exc
    raise exc


def _kb_error_handler(fn):
    """Decorator that wraps a route handler with standard knowledge error handling."""
    @functools.wraps(fn)
    async def _async_wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except Exception as exc:
            _handle_knowledge_error(exc)

    @functools.wraps(fn)
    def _sync_wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            _handle_knowledge_error(exc)

    import asyncio
    return _async_wrapper if asyncio.iscoroutinefunction(fn) else _sync_wrapper


def _knowledge_service(request: Request):
    return get_tenant_knowledge_service(request)


@router.get("/api/v1/knowledge-bases/available-models")
def list_available_models(request: Request) -> JSONResponse:
    return _json_response(200, _ok(_knowledge_service(request).list_available_models()))


@router.get("/api/v1/knowledge-bases")
def list_knowledge_bases(
    request: Request,
    enabled: bool | None = Query(default=None),
) -> JSONResponse:
    return _json_response(200, _ok(_knowledge_service(request).list_knowledge_bases(enabled=enabled)))


@router.get("/api/v1/knowledge-bases/accessible")
def list_accessible_knowledge_bases(
    request: Request,
    enabled: bool | None = Query(default=True),
) -> JSONResponse:
    return _json_response(200, _ok(_knowledge_service(request).list_accessible_knowledge_bases(enabled=enabled)))


@router.post("/api/v1/knowledge-bases")
@_kb_error_handler
def create_knowledge_base(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).create_knowledge_base(payload)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/generate-description")
@_kb_error_handler
def generate_knowledge_base_description(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).generate_description(payload)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}")
@_kb_error_handler
def get_knowledge_base(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_knowledge_base(kb_id)
    return _json_response(200, _ok(data))


@router.put("/api/v1/knowledge-bases/{kb_id}")
@_kb_error_handler
def update_knowledge_base(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).update_knowledge_base(kb_id, payload)
    return _json_response(200, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}")
@_kb_error_handler
def delete_knowledge_base(request: Request, kb_id: str) -> JSONResponse:
    deleted = _knowledge_service(request).delete_knowledge_base(kb_id)
    return _json_response(200, _ok({"deleted": deleted}))


@router.get("/api/v1/knowledge-bases/{kb_id}/files")
@_kb_error_handler
def list_knowledge_files(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).list_files(kb_id)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/folders")
@_kb_error_handler
def create_knowledge_folder(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).create_folder(kb_id, payload)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files")
@_kb_error_handler
async def upload_knowledge_files(request: Request, kb_id: str) -> JSONResponse:
    form = await request.form()
    parent_id = str(form.get("parentId") or "").strip() or None
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
    data = _knowledge_service(request).upload_files(kb_id, files, parent_id=parent_id)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/fetch-url")
@_kb_error_handler
def fetch_knowledge_url_file(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).fetch_url_file(kb_id, payload)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/sources")
@_kb_error_handler
def add_knowledge_source(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).add_source_file(kb_id, payload)
    return _json_response(201, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/sources")
@_kb_error_handler
def list_knowledge_sources(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).list_sources(kb_id)
    return _json_response(200, _ok(data))


@router.put("/api/v1/knowledge-bases/{kb_id}/sources/{source_id}")
@_kb_error_handler
def update_knowledge_source(
    request: Request,
    kb_id: str,
    source_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).update_source(kb_id, source_id, payload)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/sources/{source_id}/sync")
@_kb_error_handler
def sync_knowledge_source(
    request: Request,
    kb_id: str,
    source_id: str,
) -> JSONResponse:
    data = _knowledge_service(request).sync_source(kb_id, source_id)
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/move")
@_kb_error_handler
def move_knowledge_file(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).move_file(kb_id, payload)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/files/{file_id}/detail")
@_kb_error_handler
def get_knowledge_file_detail(request: Request, kb_id: str, file_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_file_detail(kb_id, file_id)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/files/{file_id}/download")
@_kb_error_handler
def download_knowledge_file(
    request: Request,
    kb_id: str,
    file_id: str,
    variant: str = Query(default="raw"),
):
    path = _knowledge_service(request).get_download_path(kb_id, file_id, variant=variant)
    filename = path.name if variant == "parsed" else path.name.split("-", 1)[-1]
    return FileResponse(path, filename=filename)


@router.delete("/api/v1/knowledge-bases/{kb_id}/files/{file_id}")
@_kb_error_handler
def delete_knowledge_file(request: Request, kb_id: str, file_id: str) -> JSONResponse:
    deleted = _knowledge_service(request).delete_file(kb_id, file_id)
    return _json_response(200, _ok({"deleted": deleted}))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/delete")
@_kb_error_handler
def delete_knowledge_files(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).delete_files(kb_id, payload.get("file_ids") or [])
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/parse")
@_kb_error_handler
def parse_knowledge_files(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).parse_files(kb_id, payload)
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/index")
@_kb_error_handler
def index_knowledge_files(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).index_files(kb_id, payload)
    return _json_response(202, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/jobs")
@_kb_error_handler
def list_knowledge_jobs(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).list_jobs(kb_id)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/query-params")
@_kb_error_handler
def get_knowledge_query_params(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_query_params(kb_id)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/query-params/schema")
@_kb_error_handler
def get_knowledge_query_param_schema(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_query_param_schema(kb_id)
    return _json_response(200, _ok(data))


@router.put("/api/v1/knowledge-bases/{kb_id}/query-params")
@_kb_error_handler
def update_knowledge_query_params(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).update_query_params(kb_id, payload)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/query")
@_kb_error_handler
def query_knowledge_base(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).query_database(kb_id, payload)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/sample-questions")
@_kb_error_handler
def get_sample_questions(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_sample_questions(kb_id)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/sample-questions")
@_kb_error_handler
def generate_sample_questions(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    count = int(payload.get("count") or 10)
    data = _knowledge_service(request).generate_sample_questions(kb_id, count=count)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/mindmap")
@_kb_error_handler
def get_knowledge_mindmap(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_mindmap(kb_id)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/mindmap")
@_kb_error_handler
def generate_knowledge_mindmap(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).generate_mindmap(kb_id, payload)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/graph/labels")
@_kb_error_handler
def get_knowledge_graph_labels(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_graph_labels(kb_id)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/graph")
@_kb_error_handler
def get_knowledge_graph(
    request: Request,
    kb_id: str,
    node_label: str = Query(default="*"),
    max_depth: int = Query(default=2),
    max_nodes: int = Query(default=50),
) -> JSONResponse:
    data = _knowledge_service(request).get_graph(
        kb_id,
        node_label=node_label,
        max_depth=max_depth,
        max_nodes=max_nodes,
    )
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/graph/stats")
@_kb_error_handler
def get_knowledge_graph_stats(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_graph_stats(kb_id)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/benchmarks")
@_kb_error_handler
def list_knowledge_benchmarks(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).list_benchmarks(kb_id)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}")
@_kb_error_handler
def get_knowledge_benchmark(
    request: Request,
    kb_id: str,
    benchmark_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> JSONResponse:
    data = _knowledge_service(request).get_benchmark_detail(
        kb_id,
        benchmark_id,
        page=page,
        page_size=page_size,
    )
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/benchmarks/upload")
@_kb_error_handler
async def upload_knowledge_benchmark(
    request: Request,
    kb_id: str,
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(default=""),
) -> JSONResponse:
    data = _knowledge_service(request).upload_benchmark(
        kb_id,
        file_content=await file.read(),
        filename=file.filename or "benchmark.jsonl",
        name=name,
        description=description,
    )
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/benchmarks/generate")
@_kb_error_handler
def generate_knowledge_benchmark(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).generate_benchmark(kb_id, payload)
    return _json_response(201, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}")
@_kb_error_handler
def delete_knowledge_benchmark(request: Request, kb_id: str, benchmark_id: str) -> JSONResponse:
    deleted = _knowledge_service(request).delete_benchmark(kb_id, benchmark_id)
    return _json_response(200, _ok({"deleted": deleted}))


@router.get("/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}/download")
@_kb_error_handler
def download_knowledge_benchmark(request: Request, kb_id: str, benchmark_id: str):
    path = _knowledge_service(request).get_benchmark_download_path(kb_id, benchmark_id)
    meta = _knowledge_service(request).get_benchmark_detail(kb_id, benchmark_id, page=1, page_size=1)
    filename = f"{str(meta.get('name') or benchmark_id).strip() or benchmark_id}.jsonl"
    return FileResponse(path, filename=filename)


@router.get("/api/v1/knowledge-bases/{kb_id}/evaluation/history")
@_kb_error_handler
def get_knowledge_evaluation_history(request: Request, kb_id: str) -> JSONResponse:
    data = _knowledge_service(request).get_evaluation_history(kb_id)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/evaluation/run")
@_kb_error_handler
def run_knowledge_evaluation(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    data = _knowledge_service(request).run_evaluation(kb_id, payload)
    return _json_response(202, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/evaluation/results/{task_id}")
@_kb_error_handler
def get_knowledge_evaluation_result(
    request: Request,
    kb_id: str,
    task_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    error_only: bool = Query(default=False),
) -> JSONResponse:
    data = _knowledge_service(request).get_evaluation_result(
        kb_id,
        task_id,
        page=page,
        page_size=page_size,
        error_only=error_only,
    )
    return _json_response(200, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}/evaluation/results/{task_id}")
@_kb_error_handler
def delete_knowledge_evaluation_result(request: Request, kb_id: str, task_id: str) -> JSONResponse:
    deleted = _knowledge_service(request).delete_evaluation_result(kb_id, task_id)
    return _json_response(200, _ok({"deleted": deleted}))
