from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import KnowledgeBaseService, KnowledgeBaseStore
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
