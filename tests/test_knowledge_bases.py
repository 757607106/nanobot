from __future__ import annotations

import time
import sqlite3
from pathlib import Path

from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import KnowledgeBaseService, KnowledgeBaseStore
from nanobot.platform.knowledge.vector_store import MilvusVectorStore, VectorSearchHit
from nanobot.platform.model_resources import ModelProviderService, ModelProviderStore


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
    assert retrieved["effectiveMode"] == "keyword"
    assert len(retrieved["hits"]) >= 1
    assert any("supervisorctl restart nanobot" in hit["content"] for hit in retrieved["hits"])

    semantic = service.retrieve(
        kb_ids=[created["kbId"]],
        query="restarting workers",
        limit=4,
        requested_mode="semantic",
    )
    assert semantic["effectiveMode"] == "keyword"
    assert len(semantic["hits"]) >= 1

    listed_docs = service.list_documents(created["kbId"])
    assert len(listed_docs) == 2

    listed_jobs = service.list_jobs(created["kbId"])
    assert len(listed_jobs) == 2


def test_knowledge_base_service_parse_and_index_documents_in_stages(tmp_path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
    )

    created = service.create_knowledge_base(
        {
            "name": "Stage KB",
            "autoIndexAfterParse": False,
            "retrievalProfile": {"mode": "hybrid", "chunkSize": 300, "chunkOverlap": 20},
        }
    )
    kb_id = created["kbId"]

    queued = service.enqueue_faq_table(
        kb_id,
        {
            "title": "Stage FAQ",
            "items": [
                {
                    "question": "How do we reindex this KB?",
                    "answer": "Parse the document first, then run index.",
                }
            ],
        },
    )
    doc_id = queued["documents"][0]["docId"]
    assert queued["documents"][0]["docStatus"] == "uploaded"
    assert queued["jobs"][0]["status"] == "queued"

    parsed = service.parse_documents(kb_id, {"docIds": [doc_id]})
    assert parsed["documents"][0]["docStatus"] == "parsed"

    listed_after_parse = service.list_documents(kb_id)
    assert listed_after_parse[0]["chunkCount"] == 0

    indexed = service.index_documents(kb_id, {"docIds": [doc_id]})
    assert indexed["documents"][0]["docStatus"] == "indexed"
    assert indexed["documents"][0]["chunkCount"] >= 1

    retrieved = service.retrieve(
        kb_ids=[kb_id],
        query="reindex this kb",
        limit=4,
        requested_mode="hybrid",
    )
    assert retrieved["effectiveMode"] == "keyword"
    assert len(retrieved["hits"]) >= 1


def test_knowledge_base_service_marks_legacy_configs_for_migration(tmp_path) -> None:
    instance = _make_instance(tmp_path)
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
    )

    created = service.create_knowledge_base({"name": "Legacy KB"})
    kb_id = created["kbId"]
    service.ingest_faq_table(
        kb_id,
        {
            "title": "Legacy FAQ",
            "items": [
                {
                    "question": "How do we migrate this KB?",
                    "answer": "Bind embedding, switch to Milvus, then rebuild the index.",
                }
            ],
        },
    )

    conn = sqlite3.connect(instance.knowledge_db_path())
    conn.execute(
        "UPDATE knowledge_bases SET config_json = ? WHERE kb_id = ?",
        (
            '{"description":"legacy kb","tags":["legacy"],"retrieval_profile":{"mode":"hybrid","topK":8}}',
            kb_id,
        ),
    )
    conn.commit()
    conn.close()

    payload = service.get_knowledge_base(kb_id)
    assert payload["legacyConfig"] is True
    assert payload["reindexRequired"] is True
    assert payload["reindexReason"] == "legacy_config_migration_required"


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


def test_knowledge_base_service_reranks_hits(tmp_path, monkeypatch) -> None:
    instance = _make_instance(tmp_path)
    model_providers = ModelProviderService(
        ModelProviderStore(instance.model_resources_db_path()),
        instance_id=instance.id,
    )
    reranker = model_providers.create_provider(
        {
            "displayName": "Local Reranker",
            "providerType": "custom-reranker",
            "capabilities": ["reranker"],
            "baseUrl": "http://rerank.local/v1",
            "models": ["bge-reranker-v2-m3"],
            "defaultModel": "bge-reranker-v2-m3",
        },
        tenant_id="default",
    )
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        model_providers=model_providers,
    )

    created = service.create_knowledge_base(
        {
            "name": "Rerank KB",
            "retrievalProfile": {"mode": "hybrid", "rerankEnabled": True},
            "rerankerModelSelection": {
                "providerId": reranker["providerId"],
                "modelName": "bge-reranker-v2-m3",
                "capability": "reranker",
            },
        }
    )
    kb_id = created["kbId"]
    service.ingest_uploaded_files(
        kb_id,
        [
            {
                "file_name": "ops-runbook.md",
                "mime_type": "text/markdown",
                "content": b"# Operations Runbook\n\nRestart the worker after draining the queue.\n",
            },
            {
                "file_name": "escalation-playbook.md",
                "mime_type": "text/markdown",
                "content": b"# Escalation Playbook\n\nRestart the worker only after incident approval.\n",
            },
        ],
    )

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        @staticmethod
        def json() -> dict:
            return {
                "results": [
                    {"index": 1, "relevance_score": 0.99},
                    {"index": 0, "relevance_score": 0.12},
                ]
            }

    def fake_post(url, json, headers=None, timeout=None):  # noqa: ANN001
        assert url == "http://rerank.local/v1/rerank"
        assert json["model"] == "bge-reranker-v2-m3"
        assert json["query"] == "restart worker"
        assert len(json["documents"]) == 2
        return _FakeResponse()

    monkeypatch.setattr("nanobot.platform.knowledge.service.httpx.post", fake_post)

    retrieved = service.retrieve(
        kb_ids=[kb_id],
        query="restart worker",
        limit=4,
        requested_mode="hybrid",
    )
    assert len(retrieved["hits"]) >= 2
    assert retrieved["hits"][0]["title"] == "escalation-playbook.md"
    assert retrieved["resolvedRerankerSelections"][kb_id]["providerId"] == reranker["providerId"]


def test_knowledge_base_service_marks_reindex_required_after_embedding_change(tmp_path, monkeypatch) -> None:
    class _FakeVectorStore:
        def replace_document_chunks(self, *, collection_name, kb_id, doc_id, vectors):  # noqa: ANN001
            return None

        def delete_document(self, *, collection_name, doc_id):  # noqa: ANN001
            return None

        def search(self, *, collection_name, vector, limit):  # noqa: ANN001
            return []

    instance = _make_instance(tmp_path)
    model_providers = ModelProviderService(
        ModelProviderStore(instance.model_resources_db_path()),
        instance_id=instance.id,
    )
    embedding_a = model_providers.create_provider(
        {
            "displayName": "Embedding A",
            "providerType": "custom-embedding",
            "capabilities": ["embedding"],
            "models": ["embed-a"],
            "defaultModel": "embed-a",
        },
        tenant_id="default",
    )
    embedding_b = model_providers.create_provider(
        {
            "displayName": "Embedding B",
            "providerType": "custom-embedding",
            "capabilities": ["embedding"],
            "models": ["embed-b"],
            "defaultModel": "embed-b",
        },
        tenant_id="default",
    )
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        model_providers=model_providers,
        vector_store=_FakeVectorStore(),  # type: ignore[arg-type]
    )

    def fake_embed_texts(*, selection, texts):  # noqa: ANN001
        if selection.model_name == "embed-a":
            return [[1.0, 0.0, 0.0] for _ in texts]
        return [[0.0, 1.0, 0.0] for _ in texts]

    monkeypatch.setattr(service, "_embed_texts", fake_embed_texts)

    created = service.create_knowledge_base(
        {
            "name": "Milvus KB",
            "kbBackend": "milvus",
            "embeddingModelSelection": {
                "providerId": embedding_a["providerId"],
                "modelName": "embed-a",
                "capability": "embedding",
            },
        }
    )
    kb_id = created["kbId"]

    ingested = service.ingest_faq_table(
        kb_id,
        {
            "title": "Ops FAQ",
            "items": [
                {
                    "question": "How do we restart nanobot?",
                    "answer": "Restart nanobot after draining the queue.",
                }
            ],
        },
    )
    assert ingested["documents"][0]["docStatus"] == "indexed"
    assert service.get_knowledge_base(kb_id)["reindexRequired"] is False

    updated = service.update_knowledge_base(
        kb_id,
        {
            "embeddingModelSelection": {
                "providerId": embedding_b["providerId"],
                "modelName": "embed-b",
                "capability": "embedding",
            }
        },
    )
    assert updated["reindexRequired"] is True
    assert updated["reindexReason"] == "embedding_model_changed"

    retrieved = service.retrieve(
        kb_ids=[kb_id],
        query="restart nanobot",
        limit=4,
        requested_mode="semantic",
    )
    assert retrieved["effectiveMode"] == "keyword"
    assert retrieved["staleKnowledgeBaseIds"] == [kb_id]

    reindexed = service.reindex_documents(kb_id)
    doc_id = reindexed["documents"][0]["docId"]
    job_id = reindexed["jobs"][0]["jobId"]
    deadline = time.time() + 3.0
    while time.time() < deadline:
        latest_document = next(item for item in service.list_documents(kb_id) if item["docId"] == doc_id)
        latest_job = next(item for item in service.list_jobs(kb_id) if item["jobId"] == job_id)
        if latest_document["docStatus"] == "indexed" and latest_job["status"] == "succeeded":
            break
        time.sleep(0.05)

    assert service.get_knowledge_base(kb_id)["reindexRequired"] is False


def test_knowledge_base_service_applies_per_kb_retrieval_modes(tmp_path, monkeypatch) -> None:
    class _FakeVectorStore:
        def __init__(self) -> None:
            self.vectors_by_collection: dict[str, list[dict[str, object]]] = {}

        def replace_document_chunks(self, *, collection_name, kb_id, doc_id, vectors):  # noqa: ANN001
            self.vectors_by_collection[collection_name] = list(vectors)

        def delete_document(self, *, collection_name, doc_id):  # noqa: ANN001, ARG002
            self.vectors_by_collection.pop(collection_name, None)

        def search(self, *, collection_name, vector, limit):  # noqa: ANN001, ARG002
            rows = self.vectors_by_collection.get(collection_name) or []
            return [VectorSearchHit(chunk_id=str(rows[0]["chunk_id"]), score=0.96)] if rows else []

    instance = _make_instance(tmp_path)
    model_providers = ModelProviderService(
        ModelProviderStore(instance.model_resources_db_path()),
        instance_id=instance.id,
    )
    embedding = model_providers.create_provider(
        {
            "displayName": "Local Embedding",
            "providerType": "custom-embedding",
            "capabilities": ["embedding"],
            "models": ["embed-main"],
            "defaultModel": "embed-main",
        },
        tenant_id="default",
    )
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        model_providers=model_providers,
        vector_store=_FakeVectorStore(),  # type: ignore[arg-type]
    )

    monkeypatch.setattr(
        service,
        "_embed_texts",
        lambda *, selection, texts: [[0.25, 0.5, 0.75] for _ in texts],  # noqa: ARG005
    )

    keyword_kb = service.create_knowledge_base(
        {
            "name": "Keyword KB",
            "retrievalProfile": {"mode": "keyword", "topK": 2},
        }
    )
    semantic_kb = service.create_knowledge_base(
        {
            "name": "Semantic KB",
            "kbBackend": "milvus",
            "retrievalProfile": {"mode": "semantic", "topK": 4},
            "embeddingModelSelection": {
                "providerId": embedding["providerId"],
                "modelName": "embed-main",
                "capability": "embedding",
            },
        }
    )

    service.ingest_faq_table(
        keyword_kb["kbId"],
        {
            "title": "Keyword FAQ",
            "items": [
                {
                    "question": "How do we rotate API keys?",
                    "answer": "Rotate keys during the maintenance window.",
                }
            ],
        },
    )
    service.ingest_faq_table(
        semantic_kb["kbId"],
        {
            "title": "Semantic FAQ",
            "items": [
                {
                    "question": "How do we reboot the daemon?",
                    "answer": "Reboot the daemon after draining the queue and pausing intake.",
                }
            ],
        },
    )

    retrieved = service.retrieve(
        kb_ids=[keyword_kb["kbId"], semantic_kb["kbId"]],
        query="restart worker",
        limit=4,
    )
    assert retrieved["effectiveMode"] == "mixed"
    assert retrieved["modesByKb"][keyword_kb["kbId"]]["effectiveMode"] == "keyword"
    assert retrieved["modesByKb"][semantic_kb["kbId"]]["effectiveMode"] == "semantic"
    assert any(hit["kbId"] == semantic_kb["kbId"] for hit in retrieved["hits"])


def test_knowledge_base_service_applies_rerank_for_later_kb_bindings(tmp_path, monkeypatch) -> None:
    instance = _make_instance(tmp_path)
    model_providers = ModelProviderService(
        ModelProviderStore(instance.model_resources_db_path()),
        instance_id=instance.id,
    )
    reranker = model_providers.create_provider(
        {
            "displayName": "Later KB Reranker",
            "providerType": "custom-reranker",
            "capabilities": ["reranker"],
            "baseUrl": "http://rerank.local/v1",
            "models": ["bge-reranker-v2-m3"],
            "defaultModel": "bge-reranker-v2-m3",
        },
        tenant_id="default",
    )
    service = KnowledgeBaseService(
        KnowledgeBaseStore(instance.knowledge_db_path()),
        instance=instance,
        instance_id=instance.id,
        model_providers=model_providers,
    )

    first_kb = service.create_knowledge_base(
        {
            "name": "No Rerank KB",
            "retrievalProfile": {"mode": "hybrid", "rerankEnabled": False},
        }
    )
    second_kb = service.create_knowledge_base(
        {
            "name": "Rerank KB 2",
            "retrievalProfile": {"mode": "hybrid", "rerankEnabled": True},
            "rerankerModelSelection": {
                "providerId": reranker["providerId"],
                "modelName": "bge-reranker-v2-m3",
                "capability": "reranker",
            },
        }
    )

    service.ingest_uploaded_files(
        first_kb["kbId"],
        [
            {
                "file_name": "ops.md",
                "mime_type": "text/markdown",
                "content": b"# Ops\n\nRestart the worker after the maintenance window.\n",
            }
        ],
    )
    service.ingest_uploaded_files(
        second_kb["kbId"],
        [
            {
                "file_name": "candidate-a.md",
                "mime_type": "text/markdown",
                "content": b"# Candidate A\n\nRestart the worker after approval.\n",
            },
            {
                "file_name": "candidate-b.md",
                "mime_type": "text/markdown",
                "content": b"# Candidate B\n\nWorker restart requires explicit approval and queue drain.\n",
            },
        ],
    )

    called_urls: list[str] = []

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        @staticmethod
        def json() -> dict:
            return {
                "results": [
                    {"index": 1, "relevance_score": 0.99},
                    {"index": 0, "relevance_score": 0.11},
                ]
            }

    def fake_post(url, json, headers=None, timeout=None):  # noqa: ANN001
        called_urls.append(url)
        return _FakeResponse()

    monkeypatch.setattr("nanobot.platform.knowledge.service.httpx.post", fake_post)

    retrieved = service.retrieve(
        kb_ids=[first_kb["kbId"], second_kb["kbId"]],
        query="restart worker approval",
        limit=6,
        requested_mode="hybrid",
    )
    assert called_urls == ["http://rerank.local/v1/rerank"]
    assert any(hit["kbId"] == second_kb["kbId"] for hit in retrieved["hits"])


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

    deleted = service.delete_source(kb_id, source["sourceId"])
    assert deleted["deleted"] is True
    assert deleted["sourceId"] == source["sourceId"]
    assert len(deleted["docIds"]) >= 1
    assert service.list_sources(kb_id) == []
    assert service.list_documents(kb_id) == []
    assert service.list_jobs(kb_id) == []


def test_milvus_vector_store_flushes_after_mutations() -> None:
    class _FakeClient:
        def __init__(self) -> None:
            self.calls: list[tuple] = []

        @staticmethod
        def has_collection(collection_name=None):  # noqa: ANN001, ARG004
            return True

        def upsert(self, *, collection_name, data):  # noqa: ANN001
            self.calls.append(("upsert", collection_name, data))

        def flush(self, *, collection_name):  # noqa: ANN001
            self.calls.append(("flush", collection_name))

        def delete(self, *, collection_name, filter):  # noqa: A002, ANN001
            self.calls.append(("delete", collection_name, filter))

    client = _FakeClient()
    store = MilvusVectorStore(uri="http://milvus.local:19530")
    store._client = client

    store.replace_document_chunks(
        collection_name="kb_chunks",
        kb_id="kb_demo",
        doc_id="doc_alpha",
        vectors=[{"chunk_id": "chunk_a1", "ordinal": 0, "embedding": [1.0, 0.0, 0.0]}],
    )
    assert client.calls[-2][0] == "upsert"
    assert client.calls[-1] == ("flush", "kb_chunks")

    store.delete_document(collection_name="kb_chunks", doc_id="doc_alpha")
    assert client.calls[-2] == ("delete", "kb_chunks", 'doc_id == "doc_alpha"')
    assert client.calls[-1] == ("flush", "kb_chunks")


def test_milvus_vector_store_search_parses_hit_objects() -> None:
    class _FakeHit:
        id = "chunk_a1"
        distance = 0.91
        score = 0.91

        @staticmethod
        def to_dict() -> dict[str, object]:
            return {
                "chunk_id": "chunk_a1",
                "distance": 0.91,
                "entity": {
                    "chunk_id": "chunk_a1",
                    "doc_id": "doc_alpha",
                    "kb_id": "kb_demo",
                    "ordinal": 0,
                },
            }

    class _FakeClient:
        @staticmethod
        def has_collection(collection_name=None):  # noqa: ANN001, ARG004
            return True

        @staticmethod
        def search(**kwargs):  # noqa: ANN003
            return [[_FakeHit()]]

    store = MilvusVectorStore(uri="http://milvus.local:19530")
    store._client = _FakeClient()

    hits = store.search(collection_name="kb_chunks", vector=[1.0, 0.0, 0.0], limit=5)
    assert len(hits) == 1
    assert hits[0].chunk_id == "chunk_a1"
    assert hits[0].score == 0.91


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
