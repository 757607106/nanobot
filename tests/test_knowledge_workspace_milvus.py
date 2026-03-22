from __future__ import annotations

import time
from pathlib import Path

import pytest

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import KnowledgeBaseService, KnowledgeBaseStore, KnowledgeBaseValidationError


def _make_instance(tmp_path: Path) -> PlatformInstance:
    return PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "instance" / "config.json",
    )


def _fake_embed(texts: list[str], kb=None) -> list[list[float]]:
    del kb
    vocabulary = ("restart", "worker", "token", "cache", "queue", "incident")
    vectors: list[list[float]] = []
    for text in texts:
        lowered = str(text or "").lower()
        vectors.append([float(lowered.count(token)) for token in vocabulary])
    return vectors


def _wait_for_job(service: KnowledgeBaseService, kb_id: str, job_id: str) -> dict[str, object]:
    deadline = time.time() + 5.0
    while time.time() < deadline:
        job = next((item for item in service.list_jobs(kb_id) if item["jobId"] == job_id), None)
        if job and job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for job {job_id}")


def _wait_for_evaluation(service: KnowledgeBaseService, kb_id: str, task_id: str) -> dict[str, object]:
    deadline = time.time() + 5.0
    while time.time() < deadline:
        result = service.get_evaluation_result(kb_id, task_id)
        if result["status"] in {"completed", "failed"}:
            return result
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for evaluation {task_id}")


def test_milvus_workspace_supports_index_query_benchmark_and_evaluation(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=None,
        config=None,
    )
    service._embed_texts = _fake_embed  # type: ignore[method-assign]
    service._generate_with_llm = lambda **kwargs: None  # type: ignore[method-assign]

    created = service.create_knowledge_base(
        {
            "name": "Ops Milvus KB",
            "description": "Incident and runbook knowledge",
            "kbType": "milvus",
            "queryParams": {
                "mode": "vector",
                "topK": 4,
                "options": {
                    "search_mode": "vector",
                    "similarity_threshold": 0.0,
                },
            },
        }
    )
    kb_id = created["kbId"]
    schema = service.get_query_param_schema(kb_id)
    assert schema["type"] == "milvus"
    assert any(item["key"] == "similarity_threshold" for item in schema["options"])

    uploaded = service.upload_files(
        kb_id,
        [
            {
                "file_name": "runbook.md",
                "mime_type": "text/markdown",
                "content": (
                    b"# Worker Runbook\n\n"
                    b"Restart the worker after draining the queue.\n\n"
                    b"Clear the token cache before reopening traffic.\n"
                ),
            }
        ],
    )
    file_id = uploaded["items"][0]["fileId"]

    with pytest.raises(KnowledgeBaseValidationError):
        service.parse_files(kb_id, {})
    with pytest.raises(KnowledgeBaseValidationError):
        service.index_files(kb_id, {})

    parse_result = service.parse_files(kb_id, {"fileIds": [file_id]})
    parse_job = _wait_for_job(service, kb_id, parse_result["job"]["jobId"])
    assert parse_job["status"] == "succeeded"

    index_result = service.index_files(kb_id, {"fileIds": [file_id]})
    index_job = _wait_for_job(service, kb_id, index_result["job"]["jobId"])
    assert index_job["status"] == "succeeded"
    indexed_file = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == file_id)
    assert indexed_file["processingParams"]["indexBackend"] == "pymilvus-lite"
    vector_dir = instance.runtime_dir("knowledge-vectors") / kb_id
    assert (vector_dir / "milvus.db").exists()
    assert not (vector_dir / "chunks.json").exists()

    queried = service.query_database(
        kb_id,
        {
            "query": "How do we restart the worker and handle the token cache?",
            "mode": "vector",
            "topK": 4,
            "search_mode": "vector",
        },
    )
    assert queried["metadata"]["kbType"] == "milvus"
    assert queried["data"]["chunks"]
    assert "Restart the worker" in (queried["message"] or "")

    retrieved = service.retrieve([kb_id], "restart worker token cache", limit=4, requested_mode="vector")
    assert retrieved["hits"]
    assert any("token cache" in hit["content"].lower() for hit in retrieved["hits"])

    faq_file = service.add_source_file(
        kb_id,
        {
            "sourceType": "faq_table",
            "title": "FAQ Source",
            "items": [
                {
                    "question": "How do we clear the token cache?",
                    "answer": "Drain the queue, then clear the token cache before resuming traffic.",
                }
            ],
        },
    )
    faq_parse_job = service.parse_files(kb_id, {"fileIds": [faq_file["fileId"]]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, faq_parse_job)["status"] == "succeeded"
    faq_index_job = service.index_files(kb_id, {"fileIds": [faq_file["fileId"]]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, faq_index_job)["status"] == "succeeded"

    faq_query = service.query_database(kb_id, {"query": "How do we clear the token cache?"})
    assert any("token cache" in str(item.get("content") or "").lower() for item in faq_query["data"]["chunks"])

    qa_upload = service.upload_files(
        kb_id,
        [
            {
                "file_name": "faq.md",
                "mime_type": "text/markdown",
                "content": (
                    b"Q: How do we drain the queue?\n"
                    b"A: Pause intake and wait for workers to finish.\n"
                    b"Q: How do we clear the cache?\n"
                    b"A: Run the cache reset task before resuming traffic.\n"
                ),
            }
        ],
    )
    qa_file_id = qa_upload["items"][0]["fileId"]
    qa_parse_job = service.parse_files(kb_id, {"fileIds": [qa_file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, qa_parse_job)["status"] == "succeeded"
    qa_index_job = service.index_files(
        kb_id,
        {
            "fileIds": [qa_file_id],
            "params": {
                "chunkPresetId": "qa",
                "chunkSize": 400,
                "chunkOverlap": 50,
            },
        },
    )["job"]["jobId"]
    assert _wait_for_job(service, kb_id, qa_index_job)["status"] == "succeeded"

    qa_file = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == qa_file_id)
    assert qa_file["processingParams"]["chunk_preset_id"] == "qa"
    assert qa_file["chunkCount"] == 2

    qa_detail = service.get_file_detail(kb_id, qa_file_id)
    assert "How do we drain the queue?" in qa_detail["content"]
    assert len(qa_detail["chunks"]) == 2

    qa_query = service.query_database(kb_id, {"query": "How do we clear the cache?"})
    assert any("cache reset task" in str(item.get("content") or "").lower() for item in qa_query["data"]["chunks"])

    updated_query_params = service.update_query_params(
        kb_id,
        {
            "keyword_top_k": 33,
            "similarity_threshold": 0.25,
        },
    )
    assert updated_query_params["mode"] == "vector"
    assert updated_query_params["options"]["keyword_top_k"] == 33
    assert updated_query_params["options"]["similarity_threshold"] == 0.25

    description = service.generate_description({"name": "Ops Milvus KB", "fileList": ["/runbook.md", "/faq.md"]})
    assert description["description"]

    benchmark = service.generate_benchmark(kb_id, {"count": 1, "name": "Smoke Benchmark"})
    assert benchmark["questionCount"] == 1

    benchmarks = service.list_benchmarks(kb_id)
    assert len(benchmarks) == 1
    assert benchmarks[0]["benchmarkId"] == benchmark["benchmarkId"]

    task = service.run_evaluation(kb_id, {"benchmarkId": benchmark["benchmarkId"]})
    result = _wait_for_evaluation(service, kb_id, task["taskId"])
    assert result["status"] == "completed"
    assert result["details"]
    assert result["overallScore"] is not None


def test_evaluation_uses_saved_retrieval_config_snapshot(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=None,
        config=None,
    )

    created = service.create_knowledge_base(
        {
            "name": "Eval Config KB",
            "description": "Evaluation config snapshot test",
            "kbType": "milvus",
        }
    )
    kb_id = created["kbId"]
    benchmark_id = "benchmark_snapshot"
    service._save_benchmark(
        kb_id,
        benchmark_id,
        name="Snapshot Benchmark",
        description="Snapshot benchmark",
        questions=[{"query": "How do we restart the worker?"}],
    )

    captured_payloads: list[dict[str, object]] = []

    def _fake_query_database(target_kb_id: str, payload: dict[str, object]) -> dict[str, object]:
        assert target_kb_id == kb_id
        captured_payloads.append(payload)
        return {
            "message": "",
            "data": {
                "chunks": [],
            },
        }

    service.query_database = _fake_query_database  # type: ignore[method-assign]

    task_id = "eval_snapshot"
    now = "2026-03-22T00:00:00Z"
    service._save_evaluation_result(
        kb_id,
        task_id,
        {
            "taskId": task_id,
            "task_id": task_id,
            "kbId": kb_id,
            "dbId": kb_id,
            "benchmarkId": benchmark_id,
            "benchmark_id": benchmark_id,
            "status": "queued",
            "overallScore": None,
            "overall_score": None,
            "totalQuestions": 0,
            "total_questions": 0,
            "completedQuestions": 0,
            "completed_questions": 0,
            "retrievalConfig": {
                "mode": "keyword",
                "topK": 2,
                "options": {
                    "search_mode": "keyword",
                    "similarity_threshold": 0.15,
                },
            },
            "retrieval_config": {
                "mode": "keyword",
                "topK": 2,
                "options": {
                    "search_mode": "keyword",
                    "similarity_threshold": 0.15,
                },
            },
            "modelConfig": {},
            "model_config": {},
            "details": [],
            "metrics": {},
            "createdAt": now,
            "created_at": now,
            "updatedAt": now,
            "updated_at": now,
        },
    )

    service._run_evaluation_task(kb_id, task_id)

    assert captured_payloads
    assert captured_payloads[0]["query"] == "How do we restart the worker?"
    assert captured_payloads[0]["mode"] == "keyword"
    assert captured_payloads[0]["topK"] == 2
