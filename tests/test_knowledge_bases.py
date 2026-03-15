from __future__ import annotations

import time
import sqlite3
from pathlib import Path

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import KnowledgeBaseService, KnowledgeBaseStore


def _make_instance(tmp_path: Path) -> PlatformInstance:
    return PlatformInstance(
        id="instance-test",
        label="Test Instance",
        config_path=tmp_path / "instance" / "config.json",
    )


def test_knowledge_base_service_crud_ingest_and_retrieve(tmp_path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
    )

    created = service.create_knowledge_base(
        {
            "name": "Ops Handbook",
            "description": "Runbooks and operating notes",
            "retrievalProfile": {"mode": "hybrid", "chunkSize": 400, "chunkOverlap": 40},
        }
    )
    assert created["kbId"] == "ops-handbook"
    assert created["retrievalProfile"]["mode"] == "hybrid"

    faq_ingest = service.ingest_faq_table(
        created["kbId"],
        {
            "title": "Ops FAQ",
            "items": [
                {
                    "question": "How do we restart nanobot?",
                    "answer": "Use supervisorctl restart nanobot after checking the current process state.",
                }
            ],
        },
    )
    assert faq_ingest["documents"][0]["docStatus"] == "indexed"
    assert faq_ingest["jobs"][0]["status"] == "succeeded"

    file_ingest = service.ingest_uploaded_files(
        created["kbId"],
        [
            {
                "file_name": "handover.md",
                "mime_type": "text/markdown",
                "content": b"# Handover\n\nEscalation path: page the on-call engineer before restarting shared services.\n",
            }
        ],
    )
    assert file_ingest["documents"][0]["docStatus"] == "indexed"
    assert file_ingest["documents"][0]["chunkCount"] >= 1

    retrieved = service.retrieve(
        kb_ids=[created["kbId"]],
        query="restart nanobot service",
        limit=4,
    )
    assert retrieved["effectiveMode"] == "hybrid"
    assert len(retrieved["hits"]) >= 1
    assert any("supervisorctl restart nanobot" in hit["content"] for hit in retrieved["hits"])

    semantic = service.retrieve(
        kb_ids=[created["kbId"]],
        query="restarting workers",
        limit=4,
        requested_mode="semantic",
    )
    assert semantic["effectiveMode"] == "semantic"
    assert len(semantic["hits"]) >= 1

    listed_docs = service.list_documents(created["kbId"])
    assert len(listed_docs) == 2

    listed_jobs = service.list_jobs(created["kbId"])
    assert len(listed_jobs) == 2


def test_knowledge_base_service_delete_documents(tmp_path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
    )

    created = service.create_knowledge_base({"name": "Support KB"})
    kb_id = created["kbId"]

    first = service.ingest_uploaded_files(
        kb_id,
        [
            {
                "file_name": "runbook.md",
                "mime_type": "text/markdown",
                "content": b"# Runbook\n\nRestart the worker.\n",
            }
        ],
    )
    second = service.ingest_uploaded_files(
        kb_id,
        [
            {
                "file_name": "faq.md",
                "mime_type": "text/markdown",
                "content": b"# FAQ\n\nReset the token cache.\n",
            }
        ],
    )

    doc_ids = [first["documents"][0]["docId"], second["documents"][0]["docId"]]
    deleted = service.delete_documents(kb_id, doc_ids)
    assert deleted == {"deletedCount": 2, "docIds": doc_ids}
    assert service.list_documents(kb_id) == []
    assert service.list_jobs(kb_id) == []


def test_knowledge_base_service_sources_backfill_and_sync(tmp_path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
    )

    created = service.create_knowledge_base({"name": "Support KB"})
    kb_id = created["kbId"]

    faq_ingest = service.ingest_faq_table(
        kb_id,
        {
            "title": "Support FAQ",
            "items": [
                {
                    "question": "How do we restart the worker?",
                    "answer": "Restart the worker after draining the queue.",
                }
            ],
        },
    )
    assert faq_ingest["documents"][0]["docStatus"] == "indexed"

    sources = service.list_sources(kb_id)
    assert len(sources) == 1
    source = sources[0]
    assert source["sourceType"] == "faq_table"
    assert source["syncSupported"] is True
    assert source["docCount"] == 1

    updated_source = service.update_source(
        kb_id,
        source["sourceId"],
        {
            "title": "Support FAQ v2",
            "enabled": False,
            "items": [
                {
                    "question": "How do we restart the worker?",
                    "answer": "Pause intake, then restart the worker safely.",
                }
            ],
        },
    )
    assert updated_source["title"] == "Support FAQ v2"
    assert updated_source["enabled"] is False
    assert updated_source["config"]["items"][0]["answer"] == "Pause intake, then restart the worker safely."

    reenabled = service.update_source(kb_id, source["sourceId"], {"enabled": True})
    assert reenabled["enabled"] is True

    sync_result = service.sync_source(kb_id, source["sourceId"])
    assert sync_result["document"]["docStatus"] == "uploaded"
    assert sync_result["job"]["status"] == "queued"
    assert sync_result["source"]["syncCount"] == 2

    deadline = time.time() + 3.0
    latest_doc_id = sync_result["document"]["docId"]
    latest_job_id = sync_result["job"]["jobId"]
    latest_document = sync_result["document"]
    latest_job = sync_result["job"]
    while time.time() < deadline:
        latest_document = next(item for item in service.list_documents(kb_id) if item["docId"] == latest_doc_id)
        latest_job = next(item for item in service.list_jobs(kb_id) if item["jobId"] == latest_job_id)
        if latest_document["docStatus"] == "indexed" and latest_job["status"] == "succeeded":
            break
        time.sleep(0.05)

    assert latest_document["docStatus"] == "indexed"
    assert latest_job["status"] == "succeeded"


def test_knowledge_base_store_migrates_legacy_db_without_source_columns(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy-web-knowledge.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE knowledge_bases (
            kb_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE knowledge_documents (
            doc_id TEXT PRIMARY KEY,
            kb_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            title TEXT NOT NULL,
            mime_type TEXT,
            file_name TEXT,
            source_uri TEXT,
            file_path TEXT,
            parsed_path TEXT,
            checksum TEXT,
            parser_name TEXT,
            doc_status TEXT NOT NULL,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            error_summary TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE knowledge_ingest_jobs (
            job_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            kb_id TEXT NOT NULL,
            doc_id TEXT NOT NULL,
            status TEXT NOT NULL,
            track_id TEXT NOT NULL,
            error_summary TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE knowledge_chunks (
            chunk_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            instance_id TEXT NOT NULL,
            kb_id TEXT NOT NULL,
            doc_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()
    conn.close()

    store = KnowledgeBaseStore(db_path)

    conn = sqlite3.connect(str(db_path))
    document_columns = [row[1] for row in conn.execute("PRAGMA table_info(knowledge_documents)").fetchall()]
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    indexes = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
    conn.close()

    assert "source_id" in document_columns
    assert "knowledge_sources" in tables
    assert "idx_knowledge_documents_source" in indexes
    assert isinstance(store.fts_enabled, bool)
