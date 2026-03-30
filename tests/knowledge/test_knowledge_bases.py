from __future__ import annotations

import asyncio
import sqlite3
import time
from pathlib import Path

import pytest

from nanobot.config.schema import Config
from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import (
    KnowledgeBaseService,
    KnowledgeBaseStore,
    KnowledgeBaseValidationError,
)
from tests.knowledge_test_utils import FakeRAGEngine


def _make_instance(tmp_path: Path) -> PlatformInstance:
    return PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "instance" / "config.json",
    )


def _wait_for_job(service: KnowledgeBaseService, kb_id: str, job_id: str) -> dict[str, object]:
    deadline = time.time() + 5.0
    while time.time() < deadline:
        job = next((item for item in service.list_jobs(kb_id) if item["jobId"] == job_id), None)
        if job and job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for job {job_id}")


class _RuntimeAwareFakeRAGEngine(FakeRAGEngine):
    def __init__(self) -> None:
        super().__init__()
        self.runtime_resolver = None
        self.reset_calls: list[str] = []

    def set_kb_runtime_resolver(self, resolver) -> None:
        self.runtime_resolver = resolver

    async def reset_kb(self, kb_id: str) -> None:
        self.reset_calls.append(kb_id)


class _SlowQueryFakeRAGEngine(FakeRAGEngine):
    async def query_structured(
        self,
        kb_id: str,
        query_text: str,
        *,
        mode: str = "hybrid",
        top_k: int = 8,
        chunk_top_k: int = 12,
        response_type: str = "Multiple Paragraphs",
        only_need_context: bool = False,
        only_need_prompt: bool = False,
        enable_rerank: bool = False,
    ) -> dict:
        del kb_id, query_text, mode, top_k, chunk_top_k, response_type, only_need_context, only_need_prompt, enable_rerank
        await asyncio.sleep(0.2)
        return {
            "status": "success",
            "message": "",
            "data": {"chunks": [], "entities": [], "relationships": [], "references": []},
            "metadata": {"mode": "naive", "kbType": "lightrag"},
        }


def test_knowledge_base_service_file_and_source_flow(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=FakeRAGEngine(),
    )

    created = service.create_knowledge_base(
        {
            "name": "Ops Handbook",
            "description": "Runbooks and operating notes",
            "kbType": "lightrag",
        }
    )
    kb_id = created["kbId"]

    uploaded = service.upload_files(
        kb_id,
        [
            {
                "file_name": "handover.md",
                "mime_type": "text/markdown",
                "content": b"# Handover\n\nEscalation path: page the on-call engineer before restarting shared services.\n",
            }
        ],
    )
    file_id = uploaded["items"][0]["fileId"]

    faq_source = service.add_source_file(
        kb_id,
        {
            "sourceType": "faq_table",
            "title": "Ops FAQ",
            "items": [
                {
                    "question": "How do we restart nanobot?",
                    "answer": "Use supervisorctl restart nanobot after checking the current process state.",
                }
            ],
        },
    )

    parse_job = service.parse_files(kb_id, {"fileIds": [file_id, faq_source["fileId"]]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(kb_id, {"fileIds": [file_id, faq_source["fileId"]]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    listed_files = service.list_files(kb_id)
    assert len(listed_files["items"]) == 2
    assert all(item["status"] == "indexed" for item in listed_files["items"])

    retrieved = service.retrieve(
        kb_ids=[kb_id],
        query="restart nanobot service",
        limit=4,
    )
    assert len(retrieved["hits"]) >= 1
    assert any("supervisorctl restart nanobot" in hit["content"] for hit in retrieved["hits"])


def test_knowledge_base_service_delete_files(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=FakeRAGEngine(),
    )

    created = service.create_knowledge_base({"name": "Support KB"})
    kb_id = created["kbId"]

    first = service.upload_files(
        kb_id,
        [
            {
                "file_name": "runbook.md",
                "mime_type": "text/markdown",
                "content": b"# Runbook\n\nRestart the worker.\n",
            }
        ],
    )
    second = service.upload_files(
        kb_id,
        [
            {
                "file_name": "faq.md",
                "mime_type": "text/markdown",
                "content": b"# FAQ\n\nReset the token cache.\n",
            }
        ],
    )

    file_ids = [first["items"][0]["fileId"], second["items"][0]["fileId"]]
    deleted = service.delete_files(kb_id, file_ids)
    assert deleted == {"deletedCount": 2, "fileIds": file_ids}
    assert service.list_files(kb_id)["items"] == []
    assert service.list_jobs(kb_id) == []


def test_query_kb_for_agent_uses_fast_context_only_mode(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=FakeRAGEngine(),
    )

    created = service.create_knowledge_base({"name": "Agent KB"})
    kb_id = created["kbId"]

    uploaded = service.upload_files(
        kb_id,
        [
            {
                "file_name": "faq.md",
                "mime_type": "text/markdown",
                "content": b"Restart nanobot with supervisorctl restart nanobot.\n",
            }
        ],
    )
    file_id = uploaded["items"][0]["fileId"]
    parse_job = service.parse_files(kb_id, {"fileIds": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"
    index_job = service.index_files(kb_id, {"fileIds": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    result = service.query_kb_for_agent(kb_id, "How do we restart nanobot?", limit=4)

    assert result["metadata"]["mode"] == "naive"
    assert result["queryParams"]["onlyNeedContext"] is True
    assert result["queryParams"]["topK"] == 4


def test_query_database_honors_internal_best_effort_timeout(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=_SlowQueryFakeRAGEngine(),
    )

    created = service.create_knowledge_base({"name": "Slow KB"})
    kb_id = created["kbId"]

    with pytest.raises(TimeoutError, match="Knowledge async task timed out"):
        service.query_database(
            kb_id,
            {
                "query": "hello",
                "__best_effort_timeout_seconds__": 0.01,
            },
        )


def test_knowledge_base_service_resolves_kb_model_bindings_for_rag_runtime(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    rag_engine = _RuntimeAwareFakeRAGEngine()
    config = Config.model_validate(
        {
            "providers": {
                "deepseek": {
                    "apiKey": "sk-llm",
                    "apiBase": "https://api.deepseek.com",
                },
                "dashscope": {
                    "apiKey": "sk-embed",
                    "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                },
            },
            "modelBindings": {
                "deepseek": {
                    "provider": "deepseek",
                    "label": "DeepSeek Chat",
                    "model": "deepseek-chat",
                    "apiKey": "sk-llm",
                    "apiBase": "https://api.deepseek.com",
                    "capabilityType": "text_chat",
                },
                "text-embedding-v4-2": {
                    "provider": "dashscope",
                    "label": "text-embedding-v4",
                    "model": "text-embedding-v4",
                    "apiKey": "sk-embed",
                    "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "capabilityType": "embedding",
                },
            },
            "rag": {
                "llmBinding": "deepseek",
                "embeddingBinding": "text-embedding-v4-2",
            },
        }
    )
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=rag_engine,
        config=config,
    )

    created = service.create_knowledge_base(
        {
            "name": "Binding KB",
            "embedInfo": {
                "bindingName": "text-embedding-v4-2",
                "modelName": "text-embedding-v4",
            },
            "llmInfo": {
                "bindingName": "deepseek",
                "modelName": "deepseek-chat",
            },
        }
    )

    assert rag_engine.runtime_resolver is not None
    runtime = rag_engine.runtime_resolver(str(created["kbId"]))
    assert runtime["llm_model"] == "deepseek-chat"
    assert runtime["llm_provider_name"] == "deepseek"
    assert runtime["embedding_model"] == "text-embedding-v4"
    assert runtime["embedding_provider_name"] == "dashscope"
    assert runtime["embedding_dim"] == 1024


def test_knowledge_base_service_blocks_embedding_change_when_indexed(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    rag_engine = _RuntimeAwareFakeRAGEngine()
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=rag_engine,
    )

    created = service.create_knowledge_base({"name": "Immutable Embed KB"})
    kb_id = str(created["kbId"])

    uploaded = service.upload_files(
        kb_id,
        [
            {
                "file_name": "faq.md",
                "mime_type": "text/markdown",
                "content": b"Restart nanobot with supervisorctl restart nanobot.\n",
            }
        ],
    )
    file_id = uploaded["items"][0]["fileId"]
    parse_job = service.parse_files(kb_id, {"fileIds": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"
    index_job = service.index_files(kb_id, {"fileIds": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    with pytest.raises(KnowledgeBaseValidationError):
        service.update_knowledge_base(
            kb_id,
            {
                "embedInfo": {
                    "bindingName": "text-embedding-v4-2",
                    "modelName": "text-embedding-v4",
                },
            },
        )


def test_knowledge_base_store_initializes_current_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "knowledge.db"
    KnowledgeBaseStore(db_path)

    conn = sqlite3.connect(str(db_path))
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    indexes = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
    conn.close()

    assert "knowledge_bases" in tables
    assert "knowledge_files" in tables
    assert "knowledge_jobs" in tables
    assert "idx_knowledge_files_kb" in indexes
    assert "idx_knowledge_jobs_kb" in indexes


def test_knowledge_base_service_uses_smaller_default_chunks(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        rag_engine=FakeRAGEngine(),
    )

    kb_payload = service.create_knowledge_base({"name": "Chunk Defaults"})
    kb = service.store.get_kb(str(kb_payload["kbId"]))
    assert kb is not None

    uploaded = service.upload_files(
        str(kb_payload["kbId"]),
        [
            {
                "file_name": "long.md",
                "mime_type": "text/markdown",
                "content": b"placeholder",
            }
        ],
    )
    file_record = service.store.get_file(str(uploaded["items"][0]["fileId"]))
    assert file_record is not None

    chunk_texts = service._build_chunk_texts(kb, file_record, "A" * 900)

    assert len(chunk_texts) > 1
    assert max(len(item) for item in chunk_texts) <= 500
