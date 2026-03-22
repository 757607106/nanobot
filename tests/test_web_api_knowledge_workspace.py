from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from nanobot.config import loader as config_loader
from nanobot.config.loader import save_config
from nanobot.config.schema import Config
from nanobot.web.app import create_app
from tests.knowledge_test_utils import FakeRAGEngine


def _make_test_config(tmp_path, monkeypatch) -> Config:
    config_path = tmp_path / "config.json"
    workspace = tmp_path / "workspace"
    config = Config()
    config.agents.defaults.workspace = str(workspace)
    save_config(config, config_path)
    monkeypatch.setattr(config_loader, "_current_config_path", config_path)
    return config


def _bootstrap_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/bootstrap",
        json={"username": "admin", "password": "bootstrap-pass-123"},
    )
    assert response.status_code == 201

def _wait_for_job(client: TestClient, kb_id: str, job_id: str) -> dict:
    deadline = time.time() + 5.0
    while time.time() < deadline:
        response = client.get(f"/api/v1/knowledge-bases/{kb_id}/jobs")
        assert response.status_code == 200
        job = next((item for item in response.json()["data"] if item["jobId"] == job_id), None)
        if job and job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for job {job_id}")


def _wait_for_evaluation(client: TestClient, kb_id: str, task_id: str) -> dict:
    deadline = time.time() + 5.0
    while time.time() < deadline:
        response = client.get(f"/api/v1/knowledge-bases/{kb_id}/evaluation/results/{task_id}")
        assert response.status_code == 200
        result = response.json()["data"]
        if result["status"] in {"completed", "failed"}:
            return result
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for evaluation {task_id}")


def test_web_api_unified_workspace_flow(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    monkeypatch.setattr("nanobot.web.app.create_rag_engine_from_config", lambda config, instance_dir: FakeRAGEngine())
    monkeypatch.setattr(
        "nanobot.web.runtime_services.config.create_rag_engine_from_config",
        lambda config, instance_dir: FakeRAGEngine(),
    )

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)
        client.app.state.knowledge._generate_with_llm = lambda **kwargs: None  # type: ignore[method-assign]

        created = client.post(
            "/api/v1/knowledge-bases",
            json={
                "name": "Ops API KB",
                "kbType": "milvus",
                "description": "API smoke test",
            },
        )
        assert created.status_code == 201
        kb_id = created.json()["data"]["kbId"]
        assert created.json()["data"]["kbType"] == "lightrag"
        assert created.json()["data"]["queryParams"]["mode"] == "mix"

        unsupported = client.post(
            "/api/v1/knowledge-bases",
            json={
                "name": "Unsupported KB",
                "kbType": "dify",
                "description": "Should fail",
            },
        )
        assert unsupported.status_code == 400

        schema = client.get(f"/api/v1/knowledge-bases/{kb_id}/query-params/schema")
        assert schema.status_code == 200
        assert schema.json()["data"]["type"] == "lightrag"

        description = client.post(
            "/api/v1/knowledge-bases/generate-description",
            json={"name": "Ops API KB", "currentDescription": "", "fileList": ["/runbook.md"]},
        )
        assert description.status_code == 200
        assert description.json()["data"]["description"]

        uploaded = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/files",
            files={
                "file": (
                    "runbook.md",
                    b"# API Runbook\n\nRestart the worker after draining the queue.\n\nClear the token cache.\n",
                    "text/markdown",
                )
            },
        )
        assert uploaded.status_code == 201
        file_id = uploaded.json()["data"]["items"][0]["fileId"]

        parse_missing_ids = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/parse", json={})
        assert parse_missing_ids.status_code == 400

        index_missing_ids = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/index", json={})
        assert index_missing_ids.status_code == 400

        parsed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/parse", json={"fileIds": [file_id]})
        assert parsed.status_code == 202
        assert _wait_for_job(client, kb_id, parsed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        indexed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/index", json={"fileIds": [file_id]})
        assert indexed.status_code == 202
        assert _wait_for_job(client, kb_id, indexed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        queried = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/query",
            json={
                "query": "How do we restart the worker?",
                "mode": "mix",
                "topK": 4,
                "onlyNeedContext": False,
            },
        )
        assert queried.status_code == 200
        query_payload = queried.json()["data"]
        assert query_payload["metadata"]["kbType"] == "lightrag"
        assert query_payload["data"]["chunks"]

        faq_source = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/sources",
            json={
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
        assert faq_source.status_code == 201
        faq_file_id = faq_source.json()["data"]["fileId"]

        faq_parsed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/parse", json={"fileIds": [faq_file_id]})
        assert faq_parsed.status_code == 202
        assert _wait_for_job(client, kb_id, faq_parsed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        faq_indexed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/index", json={"fileIds": [faq_file_id]})
        assert faq_indexed.status_code == 202
        assert _wait_for_job(client, kb_id, faq_indexed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        qa_upload = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/files",
            files={
                "file": (
                    "faq.md",
                    (
                        b"Q: How do we drain the queue?\n"
                        b"A: Pause intake and wait for workers to finish.\n"
                        b"Q: How do we clear the cache?\n"
                        b"A: Run the cache reset task before resuming traffic.\n"
                    ),
                    "text/markdown",
                )
            },
        )
        assert qa_upload.status_code == 201
        qa_file_id = qa_upload.json()["data"]["items"][0]["fileId"]

        qa_parsed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/parse", json={"fileIds": [qa_file_id]})
        assert qa_parsed.status_code == 202
        assert _wait_for_job(client, kb_id, qa_parsed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        qa_indexed = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/files/index",
            json={
                "fileIds": [qa_file_id],
                "params": {
                    "chunkPresetId": "qa",
                    "chunkSize": 400,
                    "chunkOverlap": 50,
                },
            },
        )
        assert qa_indexed.status_code == 202
        assert _wait_for_job(client, kb_id, qa_indexed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        files_after_index = client.get(f"/api/v1/knowledge-bases/{kb_id}/files")
        assert files_after_index.status_code == 200
        qa_file = next(item for item in files_after_index.json()["data"]["items"] if item["fileId"] == qa_file_id)
        assert qa_file["processingParams"]["chunk_preset_id"] == "qa"

        qa_detail = client.get(f"/api/v1/knowledge-bases/{kb_id}/files/{qa_file_id}/detail")
        assert qa_detail.status_code == 200
        detail_payload = qa_detail.json()["data"]
        assert "How do we drain the queue?" in detail_payload["content"]
        assert len(detail_payload["chunks"]) == 2

        updated_query_params = client.put(
            f"/api/v1/knowledge-bases/{kb_id}/query-params",
            json={
                "chunkTopK": 8,
                "enableRerank": True,
            },
        )
        assert updated_query_params.status_code == 200
        query_params_payload = updated_query_params.json()["data"]
        assert query_params_payload["mode"] == "mix"
        assert query_params_payload["chunkTopK"] == 8
        assert query_params_payload["enableRerank"] is True

        query_test = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/query-test",
            json={
                "query": "How do we clear the cache?",
                "meta": {
                    "file_ids": [qa_file_id],
                    "mode": "mix",
                    "top_k": 2,
                },
            },
        )
        assert query_test.status_code == 200
        query_test_payload = query_test.json()["data"]
        assert query_test_payload["metadata"]["fileFilterApplied"] is True
        assert any("cache reset task" in str(item.get("content") or "").lower() for item in query_test_payload["data"]["chunks"])

        generated = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/benchmarks/generate",
            json={"count": 1, "name": "API Benchmark"},
        )
        assert generated.status_code == 201
        benchmark_id = generated.json()["data"]["benchmarkId"]

        listed = client.get(f"/api/v1/knowledge-bases/{kb_id}/benchmarks")
        assert listed.status_code == 200
        assert listed.json()["data"][0]["benchmarkId"] == benchmark_id

        evaluation = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/evaluation/run",
            json={"benchmarkId": benchmark_id},
        )
        assert evaluation.status_code == 202
        task_id = evaluation.json()["data"]["taskId"]

        result = _wait_for_evaluation(client, kb_id, task_id)
        assert result["status"] == "completed"
        assert result["details"]


def test_web_api_legacy_knowledge_routes_match_yuxi_shape(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    monkeypatch.setattr("nanobot.web.app.create_rag_engine_from_config", lambda config, instance_dir: FakeRAGEngine())
    monkeypatch.setattr(
        "nanobot.web.runtime_services.config.create_rag_engine_from_config",
        lambda config, instance_dir: FakeRAGEngine(),
    )

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)
        client.app.state.knowledge._generate_with_llm = lambda **kwargs: None  # type: ignore[method-assign]

        created = client.post(
            "/api/knowledge/databases",
            json={
                "name": "Legacy Ops KB",
                "description": "Legacy route smoke test",
                "kbType": "milvus",
            },
        )
        assert created.status_code == 201
        kb_id = created.json()["data"]["kbId"]

        uploaded = client.post(
            f"/api/knowledge/files/upload?db_id={kb_id}",
            files={
                "file": (
                    "legacy-runbook.md",
                    b"# Legacy Runbook\n\nRestart the worker after draining the queue.\n\nClear the token cache.\n",
                    "text/markdown",
                )
            },
        )
        assert uploaded.status_code == 201
        upload_payload = uploaded.json()["data"]
        assert upload_payload["file_path"]
        assert upload_payload["content_hash"]

        ingest = client.post(
            f"/api/knowledge/databases/{kb_id}/documents",
            json={
                "items": [upload_payload["file_path"]],
                "params": {
                    "auto_index": True,
                    "chunk_preset_id": "general",
                },
            },
        )
        assert ingest.status_code == 202
        task_id = ingest.json()["data"]["task_id"]
        assert _wait_for_job(client, kb_id, task_id)["status"] == "succeeded"

        listed = client.get(f"/api/v1/knowledge-bases/{kb_id}/files")
        assert listed.status_code == 200
        file_id = listed.json()["data"]["items"][0]["fileId"]

        detail = client.get(f"/api/knowledge/databases/{kb_id}/documents/{file_id}")
        assert detail.status_code == 200
        assert "Restart the worker" in detail.json()["data"]["content"]

        basic = client.get(f"/api/knowledge/databases/{kb_id}/documents/{file_id}/basic")
        assert basic.status_code == 200
        assert basic.json()["data"]["fileId"] == file_id

        content = client.get(f"/api/knowledge/databases/{kb_id}/documents/{file_id}/content")
        assert content.status_code == 200
        assert content.json()["data"]["chunks"]

        updated_query_params = client.put(
            f"/api/knowledge/databases/{kb_id}/query-params",
            json={
                "chunkTopK": 21,
                "enableRerank": True,
            },
        )
        assert updated_query_params.status_code == 200

        query_params = client.get(f"/api/knowledge/databases/{kb_id}/query-params")
        assert query_params.status_code == 200
        params_payload = query_params.json()["data"]["params"]
        chunk_top_k_option = next(item for item in params_payload["options"] if item["key"] == "chunkTopK")
        rerank_option = next(item for item in params_payload["options"] if item["key"] == "enableRerank")
        assert chunk_top_k_option["default"] == 21
        assert rerank_option["default"] is True

        query_test = client.post(
            f"/api/knowledge/databases/{kb_id}/query-test",
            json={
                "query": "How do we restart the worker?",
                "meta": {
                    "mode": "mix",
                    "top_k": 2,
                },
            },
        )
        assert query_test.status_code == 200
        query_payload = query_test.json()["data"]
        assert query_payload["metadata"]["kbType"] == "lightrag"
        assert any("restart the worker" in str(item.get("content") or "").lower() for item in query_payload["data"]["chunks"])


def test_web_api_legacy_graph_routes_match_yuxi_shape(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    monkeypatch.setattr("nanobot.web.app.create_rag_engine_from_config", lambda config, instance_dir: FakeRAGEngine())
    monkeypatch.setattr(
        "nanobot.web.runtime_services.config.create_rag_engine_from_config",
        lambda config, instance_dir: FakeRAGEngine(),
    )

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        created = client.post(
            "/api/v1/knowledge-bases",
            json={
                "name": "Legacy Graph KB",
                "kbType": "lightrag",
                "description": "Graph alias smoke test",
            },
        )
        assert created.status_code == 201
        kb_id = created.json()["data"]["kbId"]

        uploaded = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/files",
            files={
                "file": (
                    "graph.md",
                    b"# Graph Runbook\n\nNanobot worker links to cache reset procedures.\n",
                    "text/markdown",
                )
            },
        )
        assert uploaded.status_code == 201
        file_id = uploaded.json()["data"]["items"][0]["fileId"]

        parsed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/parse", json={"fileIds": [file_id]})
        assert parsed.status_code == 202
        assert _wait_for_job(client, kb_id, parsed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        indexed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/index", json={"fileIds": [file_id]})
        assert indexed.status_code == 202
        assert _wait_for_job(client, kb_id, indexed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        listed = client.get("/api/graph/list")
        assert listed.status_code == 200
        graphs = listed.json()["data"]
        assert any(item["id"] == kb_id and item["type"] == "lightrag" for item in graphs)

        labels = client.get(f"/api/graph/labels?db_id={kb_id}")
        assert labels.status_code == 200
        assert labels.json()["data"]["labels"] == ["Document"]

        subgraph = client.get(f"/api/graph/subgraph?db_id={kb_id}&node_label=*&max_depth=2&max_nodes=50")
        assert subgraph.status_code == 200
        subgraph_payload = subgraph.json()["data"]
        assert subgraph_payload["nodes"]
        assert subgraph_payload["labels"] == ["Document"]

        stats = client.get(f"/api/graph/stats?db_id={kb_id}")
        assert stats.status_code == 200
        stats_payload = stats.json()["data"]
        assert stats_payload["nodeCount"] >= 1
        assert stats_payload["labels"] == ["Document"]


def test_web_api_legacy_graph_routes_and_auth(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    monkeypatch.setattr("nanobot.web.app.create_rag_engine_from_config", lambda config, instance_dir: FakeRAGEngine())
    monkeypatch.setattr(
        "nanobot.web.runtime_services.config.create_rag_engine_from_config",
        lambda config, instance_dir: FakeRAGEngine(),
    )

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as anonymous_client:
        unauthenticated = anonymous_client.get("/api/graph/list")
        assert unauthenticated.status_code == 401

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        created = client.post(
            "/api/v1/knowledge-bases",
            json={
                "name": "Legacy Graph KB",
                "kbType": "lightrag",
                "description": "Graph route smoke test",
            },
        )
        assert created.status_code == 201
        kb_id = created.json()["data"]["kbId"]

        source = client.post(
            f"/api/v1/knowledge-bases/{kb_id}/sources",
            json={
                "sourceType": "faq_table",
                "title": "Graph FAQ",
                "items": [
                    {
                        "question": "How do we restart nanobot?",
                        "answer": "Use supervisorctl restart nanobot after checking service health.",
                    }
                ],
            },
        )
        assert source.status_code == 201
        file_id = source.json()["data"]["fileId"]

        parsed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/parse", json={"fileIds": [file_id]})
        assert parsed.status_code == 202
        assert _wait_for_job(client, kb_id, parsed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        indexed = client.post(f"/api/v1/knowledge-bases/{kb_id}/files/index", json={"fileIds": [file_id]})
        assert indexed.status_code == 202
        assert _wait_for_job(client, kb_id, indexed.json()["data"]["job"]["jobId"])["status"] == "succeeded"

        graphs = client.get("/api/graph/list")
        assert graphs.status_code == 200
        graph_entries = graphs.json()["data"]
        assert any(item["id"] == kb_id and item["type"] == "lightrag" for item in graph_entries)

        labels = client.get(f"/api/graph/labels?db_id={kb_id}")
        assert labels.status_code == 200
        assert labels.json()["data"]["labels"] == ["Document"]

        subgraph = client.get(f"/api/graph/subgraph?db_id={kb_id}&node_label=*&max_depth=2&max_nodes=20")
        assert subgraph.status_code == 200
        assert subgraph.json()["data"]["nodes"]

        stats = client.get(f"/api/graph/stats?db_id={kb_id}")
        assert stats.status_code == 200
        assert stats.json()["data"]["nodeCount"] >= 1
