"""Primary v1 knowledge-base routes for the rebuilt knowledge workspace."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from nanobot.platform.knowledge import KnowledgeBaseValidationError
from nanobot.web.http import _json_response, _ok
from nanobot.web.routers.knowledge_common import _handle_knowledge_error

router = APIRouter()


@router.get("/api/v1/knowledge-bases")
def list_knowledge_bases(
    request: Request,
    enabled: bool | None = Query(default=None),
) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.knowledge.list_knowledge_bases(enabled=enabled)))


@router.get("/api/v1/knowledge-bases/accessible")
def list_accessible_knowledge_bases(
    request: Request,
    enabled: bool | None = Query(default=True),
) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.knowledge.list_accessible_knowledge_bases(enabled=enabled)))


@router.post("/api/v1/knowledge-bases")
def create_knowledge_base(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.create_knowledge_base(payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/generate-description")
def generate_knowledge_base_description(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.generate_description(payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}")
def get_knowledge_base(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_knowledge_base(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.put("/api/v1/knowledge-bases/{kb_id}")
def update_knowledge_base(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.update_knowledge_base(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}")
def delete_knowledge_base(request: Request, kb_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.knowledge.delete_knowledge_base(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok({"deleted": deleted}))


@router.get("/api/v1/knowledge-bases/{kb_id}/files")
def list_knowledge_files(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.list_files(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/documents")
def list_knowledge_documents_alias(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.list_files(kb_id)["items"]
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/folders")
def create_knowledge_folder(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.create_folder(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files")
async def upload_knowledge_files(request: Request, kb_id: str) -> JSONResponse:
    try:
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
        data = request.app.state.knowledge.upload_files(kb_id, files, parent_id=parent_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/fetch-url")
def fetch_knowledge_url_file(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.fetch_url_file(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/sources")
def add_knowledge_source(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.add_source_file(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/move")
def move_knowledge_file(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.move_file(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/files/{file_id}/detail")
def get_knowledge_file_detail(request: Request, kb_id: str, file_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_file_detail(kb_id, file_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/files/{file_id}/download")
def download_knowledge_file(
    request: Request,
    kb_id: str,
    file_id: str,
    variant: str = Query(default="raw"),
):
    try:
        path = request.app.state.knowledge.get_download_path(kb_id, file_id, variant=variant)
    except Exception as exc:
        _handle_knowledge_error(exc)
    filename = path.name if variant == "parsed" else path.name.split("-", 1)[-1]
    return FileResponse(path, filename=filename)


@router.delete("/api/v1/knowledge-bases/{kb_id}/files/{file_id}")
def delete_knowledge_file(request: Request, kb_id: str, file_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.knowledge.delete_file(kb_id, file_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok({"deleted": deleted}))


@router.delete("/api/v1/knowledge-bases/{kb_id}/documents/{doc_id}")
def delete_knowledge_document_alias(request: Request, kb_id: str, doc_id: str) -> JSONResponse:
    return delete_knowledge_file(request, kb_id, doc_id)


@router.post("/api/v1/knowledge-bases/{kb_id}/files/delete")
def delete_knowledge_files(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.delete_files(kb_id, payload.get("fileIds") or payload.get("docIds") or [])
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/documents/delete")
def delete_knowledge_documents_alias(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return delete_knowledge_files(request, kb_id, payload)


@router.post("/api/v1/knowledge-bases/{kb_id}/files/parse")
def parse_knowledge_files(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.parse_files(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/index")
def index_knowledge_files(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.index_files(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/reindex")
def reindex_knowledge_files_alias(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        file_ids = payload.get("fileIds") or payload.get("docIds") or []
        data = request.app.state.knowledge.index_files(
            kb_id,
            {
                "fileIds": file_ids,
                "params": payload.get("params"),
            },
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(202, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/jobs")
def list_knowledge_jobs(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.list_jobs(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/query-params")
def get_knowledge_query_params(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_query_params(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/query-params/schema")
def get_knowledge_query_param_schema(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_query_param_schema(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.put("/api/v1/knowledge-bases/{kb_id}/query-params")
def update_knowledge_query_params(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.update_query_params(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/query")
def query_knowledge_base(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.query_database(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/query-test")
def query_knowledge_base_alias(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return query_knowledge_base(request, kb_id, payload)


@router.post("/api/v1/knowledge-bases/{kb_id}/retrieve-test")
def retrieve_knowledge_base_alias(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return query_knowledge_base(request, kb_id, payload)


@router.get("/api/v1/knowledge-bases/{kb_id}/sample-questions")
def get_sample_questions(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_sample_questions(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/sample-questions")
def generate_sample_questions(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        count = int(payload.get("count") or 10)
        data = request.app.state.knowledge.generate_sample_questions(kb_id, count=count)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/mindmap")
def get_knowledge_mindmap(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_mindmap(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/mindmap")
def generate_knowledge_mindmap(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.generate_mindmap(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/graph/labels")
def get_knowledge_graph_labels(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_graph_labels(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/graph")
def get_knowledge_graph(
    request: Request,
    kb_id: str,
    node_label: str = Query(default="*"),
    max_depth: int = Query(default=2),
    max_nodes: int = Query(default=50),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_graph(
            kb_id,
            node_label=node_label,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/graph/stats")
def get_knowledge_graph_stats(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_graph_stats(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/benchmarks")
def list_knowledge_benchmarks(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.list_benchmarks(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}")
def get_knowledge_benchmark(
    request: Request,
    kb_id: str,
    benchmark_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_benchmark_detail(
            kb_id,
            benchmark_id,
            page=page,
            page_size=page_size,
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/benchmarks/upload")
async def upload_knowledge_benchmark(
    request: Request,
    kb_id: str,
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(default=""),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.upload_benchmark(
            kb_id,
            file_content=await file.read(),
            filename=file.filename or "benchmark.jsonl",
            name=name,
            description=description,
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/benchmarks/generate")
def generate_knowledge_benchmark(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.generate_benchmark(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}")
def delete_knowledge_benchmark(request: Request, kb_id: str, benchmark_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.knowledge.delete_benchmark(kb_id, benchmark_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok({"deleted": deleted}))


@router.get("/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}/download")
def download_knowledge_benchmark(request: Request, kb_id: str, benchmark_id: str):
    try:
        path = request.app.state.knowledge.get_benchmark_download_path(kb_id, benchmark_id)
        meta = request.app.state.knowledge.get_benchmark_detail(kb_id, benchmark_id, page=1, page_size=1)
    except Exception as exc:
        _handle_knowledge_error(exc)
    filename = f"{str(meta.get('name') or benchmark_id).strip() or benchmark_id}.jsonl"
    return FileResponse(path, filename=filename)


@router.get("/api/v1/knowledge-bases/{kb_id}/evaluation/history")
def get_knowledge_evaluation_history(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_evaluation_history(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/evaluation/run")
def run_knowledge_evaluation(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.run_evaluation(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/run")
def run_knowledge_evaluation_alias(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return run_knowledge_evaluation(request, kb_id, payload)


@router.get("/api/v1/knowledge-bases/{kb_id}/evaluation/results/{task_id}")
def get_knowledge_evaluation_result(
    request: Request,
    kb_id: str,
    task_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    error_only: bool = Query(default=False),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_evaluation_result(
            kb_id,
            task_id,
            page=page,
            page_size=page_size,
            error_only=error_only,
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/results/{task_id}")
def get_knowledge_evaluation_result_alias(
    request: Request,
    kb_id: str,
    task_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    error_only: bool = Query(default=False),
) -> JSONResponse:
    return get_knowledge_evaluation_result(
        request,
        kb_id,
        task_id,
        page=page,
        page_size=page_size,
        error_only=error_only,
    )


@router.delete("/api/v1/knowledge-bases/{kb_id}/evaluation/results/{task_id}")
def delete_knowledge_evaluation_result(request: Request, kb_id: str, task_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.knowledge.delete_evaluation_result(kb_id, task_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok({"deleted": deleted}))


@router.delete("/api/v1/knowledge-bases/{kb_id}/results/{task_id}")
def delete_knowledge_evaluation_result_alias(request: Request, kb_id: str, task_id: str) -> JSONResponse:
    return delete_knowledge_evaluation_result(request, kb_id, task_id)
