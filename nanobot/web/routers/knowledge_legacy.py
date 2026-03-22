"""Legacy Yuxi-style knowledge routes kept for compatibility."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.routers.knowledge import (
    create_knowledge_base,
    create_knowledge_folder,
    delete_knowledge_base,
    delete_knowledge_evaluation_result,
    delete_knowledge_file,
    delete_knowledge_files,
    download_knowledge_file,
    generate_knowledge_base_description,
    generate_knowledge_benchmark,
    generate_knowledge_mindmap,
    get_knowledge_base,
    get_knowledge_benchmark,
    get_knowledge_evaluation_history,
    get_knowledge_evaluation_result,
    index_knowledge_files,
    list_accessible_knowledge_bases,
    list_knowledge_benchmarks,
    list_knowledge_bases,
    move_knowledge_file,
    parse_knowledge_files,
    query_knowledge_base,
    run_knowledge_evaluation,
    update_knowledge_base,
    upload_knowledge_benchmark,
)
from nanobot.web.routers.knowledge_common import _handle_knowledge_error

router = APIRouter()


def _legacy_query_params_payload(request: Request, kb_id: str) -> dict[str, Any]:
    schema = request.app.state.knowledge.get_query_param_schema(kb_id)
    current = request.app.state.knowledge.get_query_params(kb_id)
    current_options = dict(current.get("options") or {})
    merged_options: list[dict[str, Any]] = []
    for option in list(schema.get("options") or []):
        item = dict(option)
        key = str(item.get("key") or "").strip()
        if key in current:
            item["default"] = current[key]
        elif key in current_options:
            item["default"] = current_options[key]
        merged_options.append(item)
    return {
        "params": {
            **dict(schema),
            "options": merged_options,
        },
        "message": "success",
    }


def _legacy_document_detail_payload(request: Request, kb_id: str, doc_id: str) -> dict[str, Any]:
    detail = request.app.state.knowledge.get_file_detail(kb_id, doc_id)
    file_payload = dict(detail.get("file") or {})
    return {
        **file_payload,
        "meta": file_payload,
        "content": detail.get("content") or "",
        "chunks": list(detail.get("chunks") or []),
        "chunk_count": detail.get("chunkCount") or 0,
        "chunkCount": detail.get("chunkCount") or 0,
    }


@router.get("/api/knowledge/databases")
def legacy_list_knowledge_databases(request: Request) -> JSONResponse:
    return list_knowledge_bases(request)


@router.post("/api/knowledge/databases")
def legacy_create_knowledge_database(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return create_knowledge_base(request, payload)


@router.get("/api/knowledge/databases/accessible")
def legacy_list_accessible_knowledge_databases(request: Request) -> JSONResponse:
    return list_accessible_knowledge_bases(request, enabled=True)


@router.post("/api/knowledge/generate-description")
def legacy_generate_knowledge_description(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return generate_knowledge_base_description(
        request,
        {
            "kbId": payload.get("kb_id") or payload.get("kbId"),
            "name": payload.get("database_name") or payload.get("name"),
            "currentDescription": payload.get("current_description") or payload.get("currentDescription"),
            "fileList": payload.get("file_list") or payload.get("fileList") or [],
        },
    )


@router.get("/api/knowledge/databases/{db_id}")
def legacy_get_knowledge_database(request: Request, db_id: str) -> JSONResponse:
    return get_knowledge_base(request, db_id)


@router.put("/api/knowledge/databases/{db_id}")
def legacy_update_knowledge_database(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return update_knowledge_base(request, db_id, payload)


@router.delete("/api/knowledge/databases/{db_id}")
def legacy_delete_knowledge_database(request: Request, db_id: str) -> JSONResponse:
    return delete_knowledge_base(request, db_id)


@router.post("/api/knowledge/databases/{db_id}/folders")
def legacy_create_knowledge_folder(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return create_knowledge_folder(
        request,
        db_id,
        {
            "folderName": payload.get("folder_name") or payload.get("folderName"),
            "parentId": payload.get("parent_id") or payload.get("parentId"),
        },
    )


@router.post("/api/knowledge/files/upload")
async def legacy_upload_knowledge_file(
    request: Request,
    file: UploadFile = File(...),
    db_id: str | None = Query(default=None),
) -> JSONResponse:
    if not db_id:
        raise APIError(400, "KNOWLEDGE_INVALID", "db_id is required for legacy upload.")
    try:
        data = request.app.state.knowledge.upload_files(
            db_id,
            [
                {
                    "file_name": file.filename or "knowledge-upload.txt",
                    "mime_type": file.content_type,
                    "content": await file.read(),
                }
            ],
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    item = dict((data.get("items") or [{}])[0])
    return _json_response(
        201,
        _ok(
            {
                "file_id": item.get("fileId"),
                "file_path": item.get("filePath") or item.get("rawPath"),
                "content_hash": item.get("contentHash"),
                "filename": item.get("filename"),
                "size": item.get("fileSize"),
                "status": item.get("status"),
                **item,
            }
        ),
    )


@router.post("/api/knowledge/files/fetch-url")
def legacy_fetch_knowledge_url_file(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    db_id = str(payload.get("db_id") or payload.get("dbId") or "").strip()
    if not db_id:
        raise APIError(400, "KNOWLEDGE_INVALID", "db_id is required for legacy URL fetch.")
    try:
        data = request.app.state.knowledge.fetch_url_file(
            db_id,
            {
                "url": payload.get("url"),
                "parentId": payload.get("parent_id") or payload.get("parentId"),
            },
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(
        201,
        _ok(
            {
                "file_id": data.get("fileId"),
                "file_path": data.get("filePath") or data.get("rawPath"),
                "content_hash": data.get("contentHash"),
                "filename": data.get("filename"),
                "size": data.get("fileSize"),
                "status": data.get("status"),
                **dict(data),
            }
        ),
    )


@router.post("/api/knowledge/databases/{db_id}/documents")
def legacy_add_documents(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.ingest_files(
            db_id,
            {
                "items": payload.get("items") or [],
                "params": payload.get("params") or {},
            },
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(
        202,
        _ok(
            {
                "message": "任务已提交，请在任务列表中查看进度",
                "status": "queued",
                "task_id": data["job"]["jobId"],
                "taskId": data["job"]["jobId"],
                **data,
            }
        ),
    )


@router.post("/api/knowledge/databases/{db_id}/documents/parse")
def legacy_parse_documents(
    request: Request,
    db_id: str,
    payload: Any = Body(default_factory=list),
) -> JSONResponse:
    file_ids = payload if isinstance(payload, list) else payload.get("file_ids") or payload.get("fileIds") or []
    return parse_knowledge_files(request, db_id, {"fileIds": file_ids})


@router.post("/api/knowledge/databases/{db_id}/documents/index")
def legacy_index_documents(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return index_knowledge_files(
        request,
        db_id,
        {
            "fileIds": payload.get("file_ids") or payload.get("fileIds") or [],
            "params": payload.get("params") or {},
        },
    )


@router.get("/api/knowledge/databases/{db_id}/documents/{doc_id}")
def legacy_get_document_info(request: Request, db_id: str, doc_id: str) -> JSONResponse:
    try:
        data = _legacy_document_detail_payload(request, db_id, doc_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/knowledge/databases/{db_id}/documents/{doc_id}/basic")
def legacy_get_document_basic_info(request: Request, db_id: str, doc_id: str) -> JSONResponse:
    try:
        data = _legacy_document_detail_payload(request, db_id, doc_id)["meta"]
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/knowledge/databases/{db_id}/documents/{doc_id}/content")
def legacy_get_document_content(request: Request, db_id: str, doc_id: str) -> JSONResponse:
    try:
        detail = _legacy_document_detail_payload(request, db_id, doc_id)
        data = {
            "content": detail.get("content") or "",
            "chunks": detail.get("chunks") or [],
            "chunk_count": detail.get("chunkCount") or 0,
            "chunkCount": detail.get("chunkCount") or 0,
        }
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.put("/api/knowledge/databases/{db_id}/documents/{doc_id}/move")
def legacy_move_document(
    request: Request,
    db_id: str,
    doc_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return move_knowledge_file(
        request,
        db_id,
        {
            "fileId": doc_id,
            "parentId": payload.get("new_parent_id") or payload.get("newParentId"),
            "name": payload.get("new_name") or payload.get("name"),
        },
    )


@router.delete("/api/knowledge/databases/{db_id}/documents/batch")
def legacy_delete_documents_batch(
    request: Request,
    db_id: str,
    payload: Any = Body(default_factory=list),
) -> JSONResponse:
    file_ids = payload if isinstance(payload, list) else payload.get("file_ids") or payload.get("fileIds") or []
    return delete_knowledge_files(request, db_id, {"fileIds": file_ids})


@router.delete("/api/knowledge/databases/{db_id}/documents/{doc_id}")
def legacy_delete_document(request: Request, db_id: str, doc_id: str) -> JSONResponse:
    return delete_knowledge_file(request, db_id, doc_id)


@router.get("/api/knowledge/databases/{db_id}/documents/{doc_id}/download")
def legacy_download_document(request: Request, db_id: str, doc_id: str):
    return download_knowledge_file(request, db_id, doc_id)


@router.post("/api/knowledge/databases/{db_id}/query")
def legacy_query_knowledge(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return query_knowledge_base(
        request,
        db_id,
        {
            "query": payload.get("query"),
            "meta": payload.get("meta") or {},
        },
    )


@router.post("/api/knowledge/databases/{db_id}/query-test")
def legacy_query_test(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return legacy_query_knowledge(request, db_id, payload)


@router.get("/api/knowledge/databases/{db_id}/query-params")
def legacy_get_query_params(request: Request, db_id: str) -> JSONResponse:
    try:
        data = _legacy_query_params_payload(request, db_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.put("/api/knowledge/databases/{db_id}/query-params")
def legacy_update_query_params(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        request.app.state.knowledge.update_query_params(db_id, payload)
        data = {"message": "success", "data": payload}
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/knowledge/databases/{db_id}/sample-questions")
def legacy_get_sample_questions(request: Request, db_id: str) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_sample_questions(db_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(
        200,
        _ok(
            {
                "message": "success",
                "questions": data.get("questions") or [],
                "count": len(data.get("questions") or []),
                "db_id": db_id,
            }
        ),
    )


@router.post("/api/knowledge/databases/{db_id}/sample-questions")
def legacy_generate_sample_questions(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.generate_sample_questions(db_id, count=int(payload.get("count") or 10))
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(
        200,
        _ok(
            {
                "message": "success",
                "questions": data.get("questions") or [],
                "count": len(data.get("questions") or []),
                "db_id": db_id,
                "db_name": data.get("name") or data.get("db_name") or "",
            }
        ),
    )


@router.get("/api/evaluation/databases/{db_id}/benchmarks")
def legacy_list_benchmarks(request: Request, db_id: str) -> JSONResponse:
    return list_knowledge_benchmarks(request, db_id)


@router.post("/api/evaluation/databases/{db_id}/benchmarks/generate")
def legacy_generate_benchmark(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    return generate_knowledge_benchmark(request, db_id, payload)


@router.post("/api/evaluation/databases/{db_id}/benchmarks/upload")
async def legacy_upload_benchmark(
    request: Request,
    db_id: str,
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(default=""),
) -> JSONResponse:
    return await upload_knowledge_benchmark(request, db_id, file=file, name=name, description=description)


@router.get("/api/evaluation/databases/{db_id}/benchmarks/{benchmark_id}")
def legacy_get_benchmark_detail(
    request: Request,
    db_id: str,
    benchmark_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> JSONResponse:
    return get_knowledge_benchmark(request, db_id, benchmark_id, page=page, page_size=page_size)


@router.post("/api/evaluation/databases/{db_id}/run")
def legacy_run_evaluation(
    request: Request,
    db_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    mapped_payload = {
        "benchmarkId": payload.get("benchmark_id") or payload.get("benchmarkId"),
        "modelConfig": payload.get("model_config") or payload.get("modelConfig") or {},
        "retrievalConfig": payload.get("retrieval_config") or payload.get("retrievalConfig") or {},
    }
    return run_knowledge_evaluation(request, db_id, mapped_payload)


@router.get("/api/evaluation/databases/{db_id}/history")
def legacy_evaluation_history(request: Request, db_id: str) -> JSONResponse:
    return get_knowledge_evaluation_history(request, db_id)


@router.get("/api/evaluation/databases/{db_id}/results/{task_id}")
def legacy_get_evaluation_result(
    request: Request,
    db_id: str,
    task_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    error_only: bool = Query(default=False),
) -> JSONResponse:
    return get_knowledge_evaluation_result(
        request,
        db_id,
        task_id,
        page=page,
        page_size=page_size,
        error_only=error_only,
    )


@router.delete("/api/evaluation/databases/{db_id}/results/{task_id}")
def legacy_delete_evaluation_result(request: Request, db_id: str, task_id: str) -> JSONResponse:
    return delete_knowledge_evaluation_result(request, db_id, task_id)


@router.get("/api/mindmap/databases/{db_id}/files")
def legacy_mindmap_files(request: Request, db_id: str) -> JSONResponse:
    try:
        kb = request.app.state.knowledge.get_knowledge_base(db_id)
        files = request.app.state.knowledge.list_files(db_id)["items"]
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(
        200,
        _ok(
            {
                "message": "success",
                "db_id": db_id,
                "db_name": kb.get("name") or "",
                "files": files,
                "total": len(files),
            }
        ),
    )


@router.post("/api/mindmap/generate")
def legacy_generate_mindmap(
    request: Request,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    kb_id = str(payload.get("db_id") or payload.get("dbId") or "").strip()
    if not kb_id:
        raise APIError(400, "KNOWLEDGE_INVALID", "db_id is required for legacy mindmap generation.")
    return generate_knowledge_mindmap(
        request,
        kb_id,
        {
            "fileIds": payload.get("file_ids") or payload.get("fileIds") or [],
            "prompt": payload.get("user_prompt") or payload.get("prompt") or "",
        },
    )


@router.get("/api/graph/list")
def legacy_list_graphs(request: Request) -> JSONResponse:
    try:
        graphs = []
        for kb in request.app.state.knowledge.list_knowledge_bases(enabled=True):
            stats = kb.get("stats") or {}
            graphs.append(
                {
                    "id": kb.get("kbId"),
                    "name": kb.get("name"),
                    "type": "lightrag",
                    "description": kb.get("description") or "",
                    "status": "active" if kb.get("enabled", True) else "disabled",
                    "created_at": kb.get("createdAt"),
                    "node_count": stats.get("indexedCount", 0),
                    "edge_count": 0,
                    "metadata": kb,
                    "capabilities": {
                        "supports_embedding": False,
                        "supports_threshold": False,
                    },
                }
            )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(graphs))


@router.get("/api/graph/subgraph")
def legacy_get_subgraph(
    request: Request,
    db_id: str = Query(...),
    node_label: str = Query(default="*"),
    max_depth: int = Query(default=2, ge=1, le=5),
    max_nodes: int = Query(default=100, ge=1, le=1000),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_graph(
            db_id,
            node_label=node_label,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/graph/labels")
def legacy_get_graph_labels(
    request: Request,
    db_id: str = Query(...),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_graph_labels(db_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))


@router.get("/api/graph/stats")
def legacy_get_graph_stats(
    request: Request,
    db_id: str = Query(...),
) -> JSONResponse:
    try:
        data = request.app.state.knowledge.get_graph_stats(db_id)
    except Exception as exc:
        _handle_knowledge_error(exc)
    return _json_response(200, _ok(data))
