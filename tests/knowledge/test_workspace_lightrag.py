from __future__ import annotations

import time
from pathlib import Path

from nanobot.config.schema import Config
from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import KnowledgeBaseService, create_knowledge_store
from nanobot.platform.knowledge.rag_engine import IndexResult
from tests.knowledge_test_utils import FakeRAGEngine


def _make_instance(tmp_path: Path) -> PlatformInstance:
    unique_id = f"instance-{tmp_path.parent.name}-{tmp_path.name}"
    return PlatformInstance(
        id=unique_id,
        label="Test Instance",
        config_path=tmp_path / "instance" / "config.json",
    )


def _make_store(instance: PlatformInstance):
    return create_knowledge_store(Config(), instance)


def _wait_for_job(service: KnowledgeBaseService, kb_id: str, job_id: str) -> dict[str, object]:
    deadline = time.time() + 5.0
    while time.time() < deadline:
        job = next((item for item in service.list_jobs(kb_id) if item["jobId"] == job_id), None)
        if job and job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for job {job_id}")


def test_lightrag_index_respects_chunk_params_and_file_id_aliases(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        _make_store(instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=FakeRAGEngine(),
        config=None,
    )

    created = service.create_knowledge_base(
        {
            "name": "Ops LightRAG KB",
            "kbType": "lightrag",
        }
    )
    kb_id = created["kbId"]
    assert created["query_params"]["mode"] == "mix"
    assert created["query_params"]["top_k"] == 10
    assert created["query_params"]["only_need_context"] is True

    uploaded = service.upload_files(
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
    file_id = uploaded["items"][0]["fileId"]

    parse_job = service.parse_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(
        kb_id,
        {
            "file_ids": [file_id],
            "params": {
                "chunk_preset_id": "qa",
            },
        },
    )["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    file_payload = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == file_id)
    assert file_payload["processingParams"]["chunk_preset_id"] == "qa"
    assert file_payload["chunkCount"] == 2
    assert file_payload["processingParams"]["indexBackend"] == "lightrag"

    query_result = service.query_database(
        kb_id,
        {
            "query": "How do we clear the cache?",
            "mode": "mix",
        },
    )
    assert query_result["metadata"]["mode"] == "mix"
    assert query_result["metadata"]["backend"] == "lightrag"

    retrieved = service.retrieve([kb_id], "How do we clear the cache?", limit=2)
    assert retrieved["hits"]
    assert retrieved["effectiveMode"] == "mix"


def test_lightrag_index_uses_kb_default_chunk_params_when_file_has_none(tmp_path: Path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        _make_store(instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=FakeRAGEngine(),
        config=None,
    )

    created = service.create_knowledge_base(
        {
            "name": "Ops Default Chunk KB",
            "kbType": "lightrag",
            "additionalParams": {
                "chunk_size": 400,
                "chunk_overlap": 80,
            },
        }
    )
    kb_id = created["kbId"]

    uploaded = service.upload_files(
        kb_id,
        [
            {
                "file_name": "playbook.md",
                "mime_type": "text/markdown",
                "content": ("A" * 750).encode("utf-8"),
            }
        ],
    )
    file_id = uploaded["items"][0]["fileId"]

    parse_job = service.parse_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    file_payload = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == file_id)
    assert file_payload["chunkCount"] == 3
    assert file_payload["processingParams"]["indexBackend"] == "lightrag"


def test_lightrag_index_prefers_local_chunk_count_over_lightrag_status_metadata(tmp_path: Path) -> None:
    class MisreportingInsertRAGEngine(FakeRAGEngine):
        async def insert_text(
            self,
            kb_id: str,
            text: str,
            *,
            doc_id: str | None = None,
            file_path: str | None = None,
        ) -> IndexResult:
            result = await super().insert_text(kb_id, text, doc_id=doc_id, file_path=file_path)
            return IndexResult(
                success=result.success,
                doc_id=result.doc_id,
                chunks_count=1,  # intentionally misreport
            )

    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        _make_store(instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=MisreportingInsertRAGEngine(),
        config=None,
    )

    created = service.create_knowledge_base(
        {
            "name": "Ops Chunk Count Truth KB",
            "kbType": "lightrag",
            "additionalParams": {
                "chunk_size": 400,
                "chunk_overlap": 80,
            },
        }
    )
    kb_id = created["kbId"]

    uploaded = service.upload_files(
        kb_id,
        [
            {
                "file_name": "playbook.md",
                "mime_type": "text/markdown",
                "content": ("A" * 750).encode("utf-8"),
            }
        ],
    )
    file_id = uploaded["items"][0]["fileId"]

    parse_job = service.parse_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    file_payload = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == file_id)
    assert file_payload["chunkCount"] == 3
    assert file_payload["processingParams"]["chunksCount"] == 3
