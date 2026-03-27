"""Primary v1 knowledge-base routes for the rebuilt knowledge workspace."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from nanobot.platform.knowledge import KnowledgeBaseValidationError
from nanobot.web.http import _json_response, _ok
from nanobot.web.routers.knowledge_common import _handle_knowledge_error
from nanobot.web.tenant_context import get_tenant_knowledge_service

router = APIRouter()


def _knowledge_service(request: Request):
    return get_tenant_knowledge_service(request)


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
def create_knowledge_base(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = _knowledge_service(request).create_knowledge_base(payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.post("/api/v1/knowledge-bases/generate-description")
def generate_knowledge_base_description(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = _knowledge_service(request).generate_description(payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}")
def get_knowledge_base(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).get_knowledge_base(kb_id)
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
        data = _knowledge_service(request).update_knowledge_base(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}")
def delete_knowledge_base(request: Request, kb_id: str) -> JSONResponse:
    try:
        deleted = _knowledge_service(request).delete_knowledge_base(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok({"deleted": deleted}))


@router.get("/api/v1/knowledge-bases/{kb_id}/files")
def list_knowledge_files(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).list_files(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/documents")
def list_knowledge_documents_alias(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).list_files(kb_id)["items"]
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


def _format_document_ingest_payload(
    *,
    documents: list[dict[str, Any]],
    jobs: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "documents": documents,
        "jobs": jobs,
    }


def _override_document_status(documents: list[dict[str, Any]], status: str) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in documents:
        payload = dict(item)
        payload["status"] = status
        payload["docStatus"] = status
        normalized.append(payload)
    return normalized


def _with_auto_index(params: dict[str, Any] | None = None) -> dict[str, Any]:
    normalized = dict(params or {})
    normalized["auto_index"] = True
    normalized["autoIndex"] = True
    return normalized


def _expand_jobs_for_documents(documents: list[dict[str, Any]], job: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not job:
        return []
    if len(documents) <= 1:
        return [dict(job)]
    return [dict(job) for _ in documents]


@router.post("/api/v1/knowledge-bases/{kb_id}/documents")
async def create_knowledge_documents_alias(
    request: Request,
    kb_id: str,
) -> JSONResponse:
    try:
        content_type = str(request.headers.get("content-type") or "").lower()
        knowledge = _knowledge_service(request)

        if "multipart/form-data" in content_type:
            form = await request.form()
            parent_id = str(form.get("parentId") or "").strip() or None
            raw_files = [item for item in form.getlist("file") if hasattr(item, "read")]
            if not raw_files:
                raise KnowledgeBaseValidationError("Knowledge upload requires at least one file.")
            files = [
                {
                    "file_name": getattr(item, "filename", None) or "knowledge-upload.txt",
                    "mime_type": getattr(item, "content_type", None),
                    "content": await item.read(),
                }
                for item in raw_files
            ]
            uploaded = knowledge.upload_files(kb_id, files, parent_id=parent_id)
            documents = list(uploaded.get("items") or [])
            ingest = knowledge.ingest_files(
                kb_id,
                {
                    "fileIds": [item["fileId"] for item in documents],
                    "params": _with_auto_index({"parentId": parent_id} if parent_id else {}),
                },
            )
            jobs = _expand_jobs_for_documents(documents, ingest.get("job"))
            data = _format_document_ingest_payload(documents=documents, jobs=jobs)
        else:
            payload = await request.json()
            source = knowledge.add_source_file(kb_id, payload)
            ingest = knowledge.ingest_files(
                kb_id,
                {
                    "fileIds": [source["fileId"]],
                    "params": _with_auto_index(payload.get("params") or {}),
                },
            )
            jobs = _expand_jobs_for_documents([source], ingest.get("job"))
            data = _format_document_ingest_payload(documents=[source], jobs=jobs)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/folders")
def create_knowledge_folder(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = _knowledge_service(request).create_folder(kb_id, payload)
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
        data = _knowledge_service(request).upload_files(kb_id, files, parent_id=parent_id)
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
        data = _knowledge_service(request).fetch_url_file(kb_id, payload)
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
        data = _knowledge_service(request).add_source_file(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/sources")
def list_knowledge_sources(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).list_sources(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.put("/api/v1/knowledge-bases/{kb_id}/sources/{source_id}")
def update_knowledge_source(
    request: Request,
    kb_id: str,
    source_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = _knowledge_service(request).update_source(kb_id, source_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/sources/{source_id}/sync")
def sync_knowledge_source(
    request: Request,
    kb_id: str,
    source_id: str,
) -> JSONResponse:
    try:
        data = _knowledge_service(request).sync_source(kb_id, source_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(202, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/files/move")
def move_knowledge_file(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = _knowledge_service(request).move_file(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/files/{file_id}/detail")
def get_knowledge_file_detail(request: Request, kb_id: str, file_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).get_file_detail(kb_id, file_id)
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
        path = _knowledge_service(request).get_download_path(kb_id, file_id, variant=variant)
    except Exception as exc:
        _handle_knowledge_error(exc)
    filename = path.name if variant == "parsed" else path.name.split("-", 1)[-1]
    return FileResponse(path, filename=filename)


@router.delete("/api/v1/knowledge-bases/{kb_id}/files/{file_id}")
def delete_knowledge_file(request: Request, kb_id: str, file_id: str) -> JSONResponse:
    try:
        deleted = _knowledge_service(request).delete_file(kb_id, file_id)
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
        data = _knowledge_service(request).delete_files(kb_id, payload.get("fileIds") or payload.get("docIds") or [])
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.post("/api/v1/knowledge-bases/{kb_id}/documents/delete")
def delete_knowledge_documents_alias(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = _knowledge_service(request).delete_files(kb_id, payload.get("fileIds") or payload.get("docIds") or [])
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(
        200,
        _ok(
            {
                **data,
                "docIds": list(data.get("fileIds") or []),
            }
        ),
    )


@router.post("/api/v1/knowledge-bases/{kb_id}/files/parse")
def parse_knowledge_files(
    request: Request,
    kb_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = _knowledge_service(request).parse_files(kb_id, payload)
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
        data = _knowledge_service(request).index_files(kb_id, payload)
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
        data = _knowledge_service(request).index_files(
            kb_id,
            {
                "fileIds": file_ids,
                "params": payload.get("params"),
            },
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(
        202,
        _ok(
            _format_document_ingest_payload(
                documents=_override_document_status(list(data.get("items") or []), "uploaded"),
                jobs=[dict(data.get("job") or {})] if data.get("job") else [],
            )
        ),
    )


@router.get("/api/v1/knowledge-bases/{kb_id}/jobs")
def list_knowledge_jobs(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).list_jobs(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/query-params")
def get_knowledge_query_params(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).get_query_params(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/query-params/schema")
def get_knowledge_query_param_schema(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).get_query_param_schema(kb_id)
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
        data = _knowledge_service(request).update_query_params(kb_id, payload)
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
        data = _knowledge_service(request).query_database(kb_id, payload)
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
    try:
        query = str(payload.get("query") or payload.get("queryText") or "").strip()
        if not query:
            raise KnowledgeBaseValidationError("query is required.")
        requested_mode = str(payload.get("mode") or "").strip() or None
        limit = payload.get("topK") or payload.get("limit") or 8
        data = _knowledge_service(request).retrieve(
            [kb_id],
            query,
            limit=max(1, int(limit)),
            requested_mode=requested_mode,
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/sample-questions")
def get_sample_questions(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).get_sample_questions(kb_id)
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
        data = _knowledge_service(request).generate_sample_questions(kb_id, count=count)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/mindmap")
def get_knowledge_mindmap(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).get_mindmap(kb_id)
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
        data = _knowledge_service(request).generate_mindmap(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/graph/labels")
def get_knowledge_graph_labels(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).get_graph_labels(kb_id)
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
        data = _knowledge_service(request).get_graph(
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
        data = _knowledge_service(request).get_graph_stats(kb_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/v1/knowledge-bases/{kb_id}/benchmarks")
def list_knowledge_benchmarks(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).list_benchmarks(kb_id)
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
        data = _knowledge_service(request).get_benchmark_detail(
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
        data = _knowledge_service(request).upload_benchmark(
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
        data = _knowledge_service(request).generate_benchmark(kb_id, payload)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(201, _ok(data))


@router.delete("/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}")
def delete_knowledge_benchmark(request: Request, kb_id: str, benchmark_id: str) -> JSONResponse:
    try:
        deleted = _knowledge_service(request).delete_benchmark(kb_id, benchmark_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok({"deleted": deleted}))


@router.get("/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}/download")
def download_knowledge_benchmark(request: Request, kb_id: str, benchmark_id: str):
    try:
        path = _knowledge_service(request).get_benchmark_download_path(kb_id, benchmark_id)
        meta = _knowledge_service(request).get_benchmark_detail(kb_id, benchmark_id, page=1, page_size=1)
    except Exception as exc:
        _handle_knowledge_error(exc)
    filename = f"{str(meta.get('name') or benchmark_id).strip() or benchmark_id}.jsonl"
    return FileResponse(path, filename=filename)


@router.get("/api/v1/knowledge-bases/{kb_id}/evaluation/history")
def get_knowledge_evaluation_history(request: Request, kb_id: str) -> JSONResponse:
    try:
        data = _knowledge_service(request).get_evaluation_history(kb_id)
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
        data = _knowledge_service(request).run_evaluation(kb_id, payload)
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
        data = _knowledge_service(request).get_evaluation_result(
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
        deleted = _knowledge_service(request).delete_evaluation_result(kb_id, task_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok({"deleted": deleted}))


@router.delete("/api/v1/knowledge-bases/{kb_id}/results/{task_id}")
def delete_knowledge_evaluation_result_alias(request: Request, kb_id: str, task_id: str) -> JSONResponse:
    return delete_knowledge_evaluation_result(request, kb_id, task_id)
