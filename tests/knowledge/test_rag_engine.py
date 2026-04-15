from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, call

import numpy as np
import pytest

from nanobot.config.schema import Config
from nanobot.platform.knowledge.rag_engine import (
    RAGEngine,
    create_rag_engine_from_config,
)
from nanobot.platform.knowledge.utils import infer_embedding_dim


class _FakeDocStatusStore:
    def __init__(
        self,
        *,
        by_id: dict[str, dict] | None = None,
        by_file_path: dict[str, dict] | None = None,
    ) -> None:
        self.by_id = dict(by_id or {})
        self.by_file_path = dict(by_file_path or {})

    async def get_by_id(self, doc_id: str):
        return self.by_id.get(doc_id)

    async def get_doc_by_file_path(self, file_path: str):
        return self.by_file_path.get(file_path)


class _FakeLightRAG:
    def __init__(
        self,
        *,
        doc_status: _FakeDocStatusStore,
        query_error: Exception | None = None,
        ready: bool = True,
    ) -> None:
        self.doc_status = doc_status
        self._query_error = query_error
        self._storages_status = SimpleNamespace(name="INITIALIZED" if ready else "CREATED")
        self.chunk_entity_relation_graph = SimpleNamespace(
            _storage_lock=(object() if ready else None),
            storage_updated=(object() if ready else None),
        )

    async def aquery_data(self, query_text: str, query_param):
        if self._query_error is not None:
            raise self._query_error
        return {"data": {"references": [], "chunks": []}}


class _FakeRag:
    def __init__(
        self,
        *,
        status_by_id: dict[str, dict] | None = None,
        status_by_file_path: dict[str, dict] | None = None,
        query_error: Exception | None = None,
        process_result: bool = True,
        ready: bool = False,
    ) -> None:
        self._status_by_id = dict(status_by_id or {})
        self._status_by_file_path = dict(status_by_file_path or {})
        self._query_error = query_error
        self._process_result = process_result
        self.insert_calls: list[tuple[tuple, dict]] = []
        self.process_calls: list[tuple[tuple, dict]] = []
        self.init_calls = 0
        self.parse_cache = None
        self.lightrag = None
        if ready:
            self.lightrag = self._make_lightrag()
            self.parse_cache = object()

    def _make_lightrag(self, *, ready: bool = True) -> _FakeLightRAG:
        return _FakeLightRAG(
            doc_status=_FakeDocStatusStore(
                by_id=self._status_by_id,
                by_file_path=self._status_by_file_path,
            ),
            query_error=self._query_error,
            ready=ready,
        )

    async def _ensure_lightrag_initialized(self):
        self.init_calls += 1
        self.lightrag = self._make_lightrag()
        self.parse_cache = object()
        return {"success": True}

    async def insert_content_list(self, *args, **kwargs):
        self.insert_calls.append((args, kwargs))
        return None

    async def process_document_complete(self, *args, **kwargs):
        self.process_calls.append((args, kwargs))
        return self._process_result

    async def finalize_storages(self):
        return None

    def _get_file_reference(self, file_path: str) -> str:
        return Path(file_path).name


class _FailingInitRag:
    def __init__(self, error: str) -> None:
        self.error = error
        self.init_calls = 0
        self.lightrag = None
        self.parse_cache = None

    async def _ensure_lightrag_initialized(self):
        self.init_calls += 1
        return {"success": False, "error": self.error}

    async def finalize_storages(self):
        return None


class _FakeDropStorage:
    def __init__(self) -> None:
        self.drop_calls = 0

    async def drop(self):
        self.drop_calls += 1
        return {"status": "success", "message": "data dropped"}


class _FakeMilvusClient:
    def __init__(self, collections: set[str] | None = None) -> None:
        self.collections = set(collections or set())
        self.drop_calls: list[str] = []

    def has_collection(self, name: str) -> bool:
        return name in self.collections

    def drop_collection(self, name: str) -> None:
        self.drop_calls.append(name)
        self.collections.discard(name)


class _FakeVectorStorage(_FakeDropStorage):
    def __init__(self, namespace: str) -> None:
        super().__init__()
        self.final_namespace = namespace
        self._client = _FakeMilvusClient({namespace})


class _FakeDropLightRAG:
    def __init__(self) -> None:
        self.full_docs = _FakeDropStorage()
        self.text_chunks = _FakeDropStorage()
        self.full_entities = _FakeDropStorage()
        self.full_relations = _FakeDropStorage()
        self.entity_chunks = _FakeDropStorage()
        self.relation_chunks = _FakeDropStorage()
        self.chunk_entity_relation_graph = _FakeDropStorage()
        self.llm_response_cache = _FakeDropStorage()
        self.doc_status = _FakeDropStorage()
        self.entities_vdb = _FakeVectorStorage("kb_drop_entities")
        self.relationships_vdb = _FakeVectorStorage("kb_drop_relationships")
        self.chunks_vdb = _FakeVectorStorage("kb_drop_chunks")


class _FakeDropRag:
    def __init__(self) -> None:
        self.lightrag = _FakeDropLightRAG()
        self.finalize_calls = 0

    async def finalize_storages(self):
        self.finalize_calls += 1


class _RecordingUpsertStore:
    def __init__(self) -> None:
        self.payloads: list[dict] = []

    async def upsert(self, payload: dict) -> None:
        self.payloads.append(payload)


class _RecordingDocStatusStore(_RecordingUpsertStore):
    async def get_by_id(self, doc_id: str):
        for payload in reversed(self.payloads):
            if doc_id in payload:
                return payload[doc_id]
        return None


class _FallbackTokenizer:
    @staticmethod
    def encode(text: str) -> list[int]:
        return list(range(len(text)))


class _FallbackLightRAG:
    def __init__(self) -> None:
        self.chunks_vdb = _RecordingUpsertStore()
        self.full_docs = _RecordingUpsertStore()
        self.text_chunks = _RecordingUpsertStore()
        self.doc_status = _RecordingDocStatusStore()
        self.tokenizer = _FallbackTokenizer()
        self.deleted_doc_ids: list[str] = []
        self.insert_done_calls = 0

    async def adelete_by_doc_id(self, doc_id: str) -> None:
        self.deleted_doc_ids.append(doc_id)

    async def _insert_done(self) -> None:
        self.insert_done_calls += 1


class _FallbackInsertRag:
    def __init__(self) -> None:
        self.lightrag = _FallbackLightRAG()

    async def insert_content_list(self, *args, **kwargs):
        raise TimeoutError("LLM func: Worker execution timeout after 120s")


class _QueryFallbackLightRAG:
    def __init__(self) -> None:
        self.modes: list[str] = []

    async def aquery_data(self, query_text: str, query_param):
        self.modes.append(str(query_param.mode))
        if str(query_param.mode) != "naive":
            raise TimeoutError("LLM func: Worker execution timeout after 120s")
        return {
            "data": {
                "chunks": [
                    {
                        "content": "fallback hit",
                        "chunk_id": "chunk-1",
                        "reference_id": "ref-1",
                        "file_path": "ops-faq.md",
                    }
                ],
                "references": [
                    {
                        "reference_id": "ref-1",
                        "file_path": "ops-faq.md",
                    }
                ],
            }
        }


class _QueryFallbackRag:
    def __init__(self) -> None:
        self.lightrag = _QueryFallbackLightRAG()


class _RecordingMultimodalRag:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def aquery_with_multimodal(self, query_text: str, *, multimodal_content, **kwargs):
        self.calls.append(
            {
                "query_text": query_text,
                "multimodal_content": list(multimodal_content or []),
                "kwargs": dict(kwargs),
            }
        )
        return "multimodal answer"


class _PrepareDocStatusStore:
    def __init__(self, docs: dict[str, dict]) -> None:
        self.docs = dict(docs)

    async def get_docs_by_status(self, status) -> dict[str, dict]:
        wanted = str(getattr(status, "value", status))
        return {
            doc_id: payload
            for doc_id, payload in self.docs.items()
            if str(payload.get("status")) == wanted
        }


class _PrepareLightRAG:
    def __init__(self, docs: dict[str, dict]) -> None:
        self.doc_status = _PrepareDocStatusStore(docs)


class _PrepareRag:
    def __init__(self, docs: dict[str, dict]) -> None:
        self.lightrag = _PrepareLightRAG(docs)


class _HardFailInsertRag:
    def __init__(self) -> None:
        self.lightrag = _FallbackLightRAG()

    async def insert_content_list(self, *args, **kwargs):
        raise RuntimeError("boom")


class _SlowInitRag(_FakeRag):
    async def _ensure_lightrag_initialized(self):
        self.init_calls += 1
        await asyncio.sleep(0.01)
        self.lightrag = self._make_lightrag()
        self.parse_cache = object()
        return {"success": True}


class _BrokenReadyRag(_FakeRag):
    def __init__(self) -> None:
        super().__init__(ready=False)
        self.lightrag = self._make_lightrag(ready=False)

    async def _ensure_lightrag_initialized(self):
        self.init_calls += 1
        return {"success": True}


@pytest.mark.asyncio
async def test_rag_engine_ensure_instance_initializes_lightrag(monkeypatch) -> None:
    engine = RAGEngine(storage_root=Path("/tmp/test-rag-engine-ready"), default_model="openai/gpt-4o-mini")
    fake_rag = _FakeRag()

    monkeypatch.setattr(engine, "_get_or_create_instance", AsyncMock(return_value=fake_rag))

    rag = await engine.ensure_instance("kb-ready")

    assert rag is fake_rag
    assert rag.lightrag is not None
    assert fake_rag.init_calls == 1


@pytest.mark.asyncio
async def test_rag_engine_ensure_instance_serializes_concurrent_initialization(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    fake_rag = _SlowInitRag()

    monkeypatch.setattr(engine, "_get_or_create_instance", AsyncMock(return_value=fake_rag))

    first, second = await asyncio.gather(
        engine.ensure_instance("kb-concurrent"),
        engine.ensure_instance("kb-concurrent"),
    )

    assert first is fake_rag
    assert second is fake_rag
    assert fake_rag.init_calls == 1


@pytest.mark.asyncio
async def test_rag_engine_ensure_instance_recreates_incomplete_lightrag(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    broken_rag = _BrokenReadyRag()
    fresh_rag = _FakeRag(ready=True)

    monkeypatch.setattr(
        engine,
        "_get_or_create_instance",
        AsyncMock(side_effect=[broken_rag, fresh_rag]),
    )
    reset_mock = AsyncMock()
    monkeypatch.setattr(engine, "reset_kb", reset_mock)

    rag = await engine.ensure_instance("kb-recover")

    assert rag is fresh_rag
    assert broken_rag.init_calls == 1
    reset_mock.assert_awaited_once_with("kb-recover")


@pytest.mark.asyncio
async def test_rag_engine_insert_text_returns_failure_when_doc_status_failed(monkeypatch) -> None:
    engine = RAGEngine(storage_root=Path("/tmp/test-rag-engine-insert"), default_model="openai/gpt-4o-mini")
    fake_rag = _FakeRag(
        status_by_id={
            "doc-1": {
                "status": "failed",
                "error_msg": "embedding auth missing",
                "chunks_count": 0,
                "multimodal_processed": True,
            }
        },
        ready=True,
    )

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))

    result = await engine.insert_text("kb-insert", "hello world", doc_id="doc-1", file_path="faq.json")

    assert result.success is False
    assert result.parser_name == "text_insert"
    assert "embedding auth missing" in str(result.error)


@pytest.mark.asyncio
async def test_insert_chunks_falls_back_to_chunk_only_on_timeout(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    fake_rag = _FallbackInsertRag()

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))

    result = await engine.insert_chunks(
        "kb-fallback",
        ["First chunk", "Second chunk"],
        doc_id="doc-fallback",
        file_path="ops-faq.md",
    )

    assert result.success is True
    assert result.parser_name == "chunk_insert_fallback"
    assert result.metadata["fallback_mode"] == "chunk_only"
    assert result.metadata["chunks_count"] == 2
    assert fake_rag.lightrag.deleted_doc_ids == ["doc-fallback"]
    assert fake_rag.lightrag.insert_done_calls == 1
    stored_status = await fake_rag.lightrag.doc_status.get_by_id("doc-fallback")
    assert stored_status["status"] == "processed"
    assert stored_status["multimodal_processed"] is False


@pytest.mark.asyncio
async def test_insert_document_file_uses_raganything_complete_processing(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    file_path = tmp_path / "ops.docx"
    file_path.write_bytes(b"doc-bytes")
    fake_rag = _FakeRag(
        status_by_id={
            "doc-raw": {
                "status": "processed",
                "chunks_count": 4,
                "multimodal_processed": True,
            }
        },
        ready=True,
    )

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))
    prepare_mock = AsyncMock(return_value={"deletedDocIds": [], "prunedDocIds": []})
    monkeypatch.setattr(engine, "prepare_document_ingest", prepare_mock)

    result = await engine.insert_document_file(
        "kb-raw",
        str(file_path),
        doc_id="doc-raw",
        file_name="ops.docx",
    )

    assert result.success is True
    assert result.parser_name == "raganything_file"
    assert result.doc_id == "doc-raw"
    assert result.chunks_count == 4
    prepare_mock.assert_awaited_once_with("kb-raw", "doc-raw")
    assert fake_rag.process_calls == [
        (
            (),
            {
                "file_path": str(file_path),
                "parse_method": "auto",
                "doc_id": "doc-raw",
                "file_name": "ops.docx",
            },
        )
    ]


@pytest.mark.asyncio
async def test_insert_document_file_passes_mineru_parser_runtime_kwargs(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(
        storage_root=tmp_path / "storage",
        default_model="openai/gpt-4o-mini",
        parser_kwargs={
            "backend": "vlm-http-client",
            "vlm_url": "https://mineru.example.com",
            "source": "huggingface",
        },
    )
    file_path = tmp_path / "ops.docx"
    file_path.write_bytes(b"doc-bytes")
    fake_rag = _FakeRag(
        status_by_id={
            "doc-raw": {
                "status": "processed",
                "chunks_count": 4,
                "multimodal_processed": True,
            }
        },
        ready=True,
    )

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))
    prepare_mock = AsyncMock(return_value={"deletedDocIds": [], "prunedDocIds": []})
    monkeypatch.setattr(engine, "prepare_document_ingest", prepare_mock)

    result = await engine.insert_document_file(
        "kb-raw",
        str(file_path),
        doc_id="doc-raw",
        file_name="ops.docx",
    )

    assert result.success is True
    assert fake_rag.process_calls == [
        (
            (),
            {
                "file_path": str(file_path),
                "parse_method": "auto",
                "doc_id": "doc-raw",
                "file_name": "ops.docx",
                "backend": "vlm-http-client",
                "vlm_url": "https://mineru.example.com",
                "source": "huggingface",
            },
        )
    ]


@pytest.mark.asyncio
async def test_insert_chunks_cleans_partial_doc_on_hard_failure(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    fake_rag = _HardFailInsertRag()

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))
    delete_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(engine, "delete_document", delete_mock)

    result = await engine.insert_chunks(
        "kb-hard-fail",
        ["Only chunk"],
        doc_id="doc-hard-fail",
        file_path="ops-faq.md",
    )

    assert result.success is False
    assert "boom" in str(result.error)
    delete_mock.assert_awaited_once_with("kb-hard-fail", "doc-hard-fail")


@pytest.mark.asyncio
async def test_prepare_document_ingest_prunes_retryable_docs(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    fake_rag = _PrepareRag(
        {
            "doc-keep": {"status": "processed"},
            "doc-failed": {"status": "failed"},
            "doc-pending": {"status": "pending"},
            "doc-processing": {"status": "processing"},
        }
    )

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))
    delete_mock = AsyncMock(side_effect=lambda kb_id, doc_id: doc_id != "doc-pending")
    monkeypatch.setattr(engine, "delete_document", delete_mock)

    result = await engine.prepare_document_ingest("kb-prepare", "doc-keep")

    assert result["prunedDocIds"] == ["doc-failed", "doc-pending", "doc-processing"]
    assert result["deletedDocIds"] == ["doc-keep", "doc-failed", "doc-processing"]
    assert delete_mock.await_args_list == [
        call("kb-prepare", "doc-keep"),
        call("kb-prepare", "doc-failed"),
        call("kb-prepare", "doc-pending"),
        call("kb-prepare", "doc-processing"),
    ]


@pytest.mark.asyncio
async def test_query_structured_falls_back_to_naive_on_timeout(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    fake_rag = _QueryFallbackRag()

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))

    result = await engine.query_structured(
        "kb-query-fallback",
        "How do we clear the cache?",
        mode="mix",
        top_k=4,
        chunk_top_k=6,
        only_need_context=True,
    )

    assert fake_rag.lightrag.modes == ["mix", "naive"]
    assert result["data"]["chunks"][0]["content"] == "fallback hit"


@pytest.mark.asyncio
async def test_query_falls_back_to_naive_on_timeout(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    fake_rag = _QueryFallbackRag()

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))

    hits = await engine.query(
        ["kb-query-fallback"],
        "How do we restart nanobot?",
        mode="mix",
        top_k=4,
    )

    assert fake_rag.lightrag.modes == ["mix", "naive"]
    assert hits[0].content == "fallback hit"


@pytest.mark.asyncio
async def test_query_multimodal_reuses_shared_query_param_filtering(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    fake_rag = _RecordingMultimodalRag()

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))

    result = await engine.query_multimodal(
        "kb-query-mm",
        "Analyze this chart",
        multimodal_content=[{"type": "image", "img_path": "/tmp/chart.png"}],
        mode="mix",
        top_k=3,
        chunk_top_k=5,
        only_need_context=False,
        extra_query_params={
            "conversation_history": [{"role": "user", "content": "Earlier question"}],
            "bogus": "ignored",
        },
    )

    assert result == "multimodal answer"
    assert len(fake_rag.calls) == 1
    call_payload = fake_rag.calls[0]
    assert call_payload["query_text"] == "Analyze this chart"
    assert call_payload["multimodal_content"] == [{"type": "image", "img_path": "/tmp/chart.png"}]
    assert call_payload["kwargs"]["mode"] == "mix"
    assert call_payload["kwargs"]["top_k"] == 3
    assert call_payload["kwargs"]["chunk_top_k"] == 5
    assert "conversation_history" in call_payload["kwargs"]
    assert "bogus" not in call_payload["kwargs"]


@pytest.mark.asyncio
async def test_rag_engine_query_raises_when_all_kbs_fail(monkeypatch) -> None:
    engine = RAGEngine(storage_root=Path("/tmp/test-rag-engine-query"), default_model="openai/gpt-4o-mini")
    fake_rag = _FakeRag(query_error=RuntimeError("boom"), ready=True)

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))

    with pytest.raises(RuntimeError, match="kb-a: boom"):
        await engine.query(["kb-a"], "restart worker", mode="hybrid")


@pytest.mark.asyncio
async def test_rag_engine_delete_kb_drops_remote_milvus_collections_and_workspace(tmp_path: Path) -> None:
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    fake_rag = _FakeDropRag()
    engine._instances["kb-drop"] = fake_rag
    engine._locks["kb-drop"] = AsyncMock()

    working_dir = engine._kb_working_dir("kb-drop")
    working_dir.mkdir(parents=True, exist_ok=True)
    (working_dir / "marker.txt").write_text("hello", encoding="utf-8")

    deleted = await engine.delete_kb("kb-drop")

    assert deleted is True
    assert not working_dir.exists()
    assert "kb-drop" not in engine._instances
    assert "kb-drop" not in engine._locks
    assert fake_rag.finalize_calls == 1
    assert fake_rag.lightrag.full_docs.drop_calls == 1
    assert fake_rag.lightrag.text_chunks.drop_calls == 1
    assert fake_rag.lightrag.chunk_entity_relation_graph.drop_calls == 1
    assert fake_rag.lightrag.entities_vdb.drop_calls == 0
    assert fake_rag.lightrag.relationships_vdb.drop_calls == 0
    assert fake_rag.lightrag.chunks_vdb.drop_calls == 0
    assert fake_rag.lightrag.entities_vdb._client.drop_calls == ["kb_drop_entities"]
    assert fake_rag.lightrag.relationships_vdb._client.drop_calls == ["kb_drop_relationships"]
    assert fake_rag.lightrag.chunks_vdb._client.drop_calls == ["kb_drop_chunks"]


def test_create_rag_engine_from_config_uses_rag_specific_bindings(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "nanobot.platform.knowledge.rag_engine._check_rag_anything",
        lambda: True,
    )
    config = Config.model_validate(
        {
            "agents": {
                "defaults": {
                    "model": "deepseek/deepseek-chat",
                    "binding": "chat-default",
                    "provider": "deepseek",
                }
            },
            "modelBindings": {
                "chat-default": {
                    "provider": "deepseek",
                    "label": "DeepSeek",
                    "model": "deepseek/deepseek-chat",
                    "apiKey": "sk-chat",
                    "apiBase": "https://api.deepseek.com",
                },
                "rag-llm": {
                    "provider": "moonshot",
                    "label": "Kimi",
                    "model": "moonshot/kimi-k2.5",
                    "apiKey": "sk-rag-llm",
                    "apiBase": "https://api.moonshot.cn/v1",
                },
                "rag-embedding": {
                    "provider": "openai",
                    "label": "OpenAI Embedding",
                    "model": "text-embedding-3-large",
                    "capabilityType": "embedding",
                    "apiKey": "sk-rag-embed",
                    "apiBase": "https://api.openai.com/v1",
                },
                "rag-vision": {
                    "provider": "openai",
                    "label": "OpenAI Vision",
                    "model": "gpt-4o",
                    "capabilityType": "multimodal",
                    "apiKey": "sk-rag-vision",
                    "apiBase": "https://api.openai.com/v1",
                },
            },
            "rag": {
                "llmBinding": "rag-llm",
                "embeddingBinding": "rag-embedding",
                "visionBinding": "rag-vision",
                "llmTimeout": 42,
                "embeddingTimeout": 21,
                "maxAsync": 3,
                "maxParallelInsert": 1,
                "embeddingFuncMaxAsync": 5,
            },
        }
    )

    engine = create_rag_engine_from_config(config, tmp_path)

    assert engine is not None
    assert engine._default_model == "moonshot/kimi-k2.5"
    assert engine._api_key == "sk-rag-llm"
    assert engine._api_base == "https://api.moonshot.cn/v1"
    assert engine._embedding_api_key == "sk-rag-embed"
    assert engine._embedding_api_base == "https://api.openai.com/v1"
    assert engine._embedding_model == "text-embedding-3-large"
    assert engine._vision_api_key == "sk-rag-vision"
    assert engine._vision_api_base == "https://api.openai.com/v1"
    assert engine._vision_model == "gpt-4o"
    assert engine._llm_timeout == 42
    assert engine._embedding_timeout == 21
    assert engine._lightrag_base_kwargs["vector_storage"] == "MilvusVectorDBStorage"
    assert engine._lightrag_base_kwargs["graph_storage"] == "Neo4JStorage"
    assert engine._lightrag_base_kwargs["kv_storage"] == "PGKVStorage"
    assert engine._lightrag_base_kwargs["doc_status_storage"] == "PGDocStatusStorage"
    assert engine._lightrag_base_kwargs["default_llm_timeout"] == 42
    assert engine._lightrag_base_kwargs["default_embedding_timeout"] == 21
    assert engine._lightrag_base_kwargs["llm_model_max_async"] == 3
    assert engine._lightrag_base_kwargs["max_parallel_insert"] == 1
    assert engine._lightrag_base_kwargs["embedding_func_max_async"] == 5
    assert engine._storage_env["MILVUS_URI"] == "http://127.0.0.1:19530"
    assert engine._storage_env["MILVUS_DB_NAME"] == "nanobot"
    assert engine._storage_env["MILVUS_TOKEN"] == "root:Milvus"
    assert engine._storage_env["POSTGRES_HOST"] == "127.0.0.1"
    assert engine._storage_env["POSTGRES_PORT"] == "5432"
    assert engine._storage_env["POSTGRES_USER"] == "postgres"
    assert engine._storage_env["POSTGRES_DATABASE"] == "nanobot"


def test_create_rag_engine_from_config_maps_mineru_remote_runtime_options(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "nanobot.platform.knowledge.rag_engine._check_rag_anything",
        lambda: True,
    )
    config = Config.model_validate(
        {
            "rag": {
                "parser": "mineru",
                "verifyParserInstallation": False,
                "mineru": {
                    "backend": "vlm-http-client",
                    "vlmUrl": "https://mineru.example.com",
                    "source": "huggingface",
                },
            }
        }
    )

    engine = create_rag_engine_from_config(config, tmp_path)

    assert engine is not None
    assert engine._document_parser == "mineru"
    assert engine._verify_parser_installation is False
    assert engine._parser_kwargs == {
        "backend": "vlm-http-client",
        "vlm_url": "https://mineru.example.com",
        "source": "huggingface",
    }


def test_create_rag_engine_from_config_requires_vlm_url_for_http_backend(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "nanobot.platform.knowledge.rag_engine._check_rag_anything",
        lambda: True,
    )
    config = Config.model_validate(
        {
            "rag": {
                "parser": "mineru",
                "mineru": {
                    "backend": "vlm-http-client",
                },
            }
        }
    )

    with pytest.raises(ValueError, match="rag.mineru.vlm_url is required"):
        create_rag_engine_from_config(config, tmp_path)


def test_config_rag_timeouts_default_to_graph_safe_values() -> None:
    config = Config()

    assert config.rag.llm_timeout == 180
    assert config.rag.embedding_timeout == 60
    assert config.rag.max_async == 16
    assert config.rag.max_parallel_insert == 4
    assert config.rag.embedding_func_max_async == 4


def test_create_rag_engine_from_config_falls_back_to_provider_env_api_key(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "nanobot.platform.knowledge.rag_engine._check_rag_anything",
        lambda: True,
    )
    monkeypatch.setenv("DASHSCOPE_API_KEY", "env-dashscope-key")
    config = Config.model_validate(
        {
            "modelBindings": {
                "rag-llm": {
                    "provider": "dashscope",
                    "label": "Qwen",
                    "model": "qwen3.5-plus",
                },
                "rag-embedding": {
                    "provider": "dashscope",
                    "label": "Embedding",
                    "model": "text-embedding-v4",
                    "capabilityType": "embedding",
                },
            },
            "rag": {
                "llmBinding": "rag-llm",
                "embeddingBinding": "rag-embedding",
            },
        }
    )

    engine = create_rag_engine_from_config(config, tmp_path)

    assert engine is not None
    assert engine._api_key == "env-dashscope-key"
    assert engine._embedding_api_key == "env-dashscope-key"
    assert engine._embedding_dim == 1024


def test_create_rag_engine_from_config_uses_agent_default_binding_when_rag_llm_binding_missing(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "nanobot.platform.knowledge.rag_engine._check_rag_anything",
        lambda: True,
    )
    config = Config.model_validate(
        {
            "agents": {
                "defaults": {
                    "model": "deepseek/deepseek-chat",
                    "binding": "chat-default",
                    "provider": "deepseek",
                }
            },
            "modelBindings": {
                "chat-default": {
                    "provider": "deepseek",
                    "label": "DeepSeek",
                    "model": "deepseek/deepseek-chat",
                    "apiKey": "sk-chat",
                    "apiBase": "https://api.deepseek.com",
                },
                "vision-main": {
                    "provider": "openai",
                    "label": "Vision Main",
                    "model": "gpt-4o",
                    "capabilityType": "multimodal",
                    "apiKey": "sk-vision",
                    "apiBase": "https://api.openai.com/v1",
                },
            },
            "rag": {
                "visionBinding": "vision-main",
            },
        }
    )

    engine = create_rag_engine_from_config(config, tmp_path)

    assert engine is not None
    assert engine._default_model == "deepseek/deepseek-chat"
    assert engine._api_key == "sk-chat"
    assert engine._api_base == "https://api.deepseek.com"
    assert engine._vision_model == "gpt-4o"


def test_create_rag_engine_from_config_uses_neo4j_graph_storage_when_enabled(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "nanobot.platform.knowledge.rag_engine._check_rag_anything",
        lambda: True,
    )
    config = Config.model_validate(
        {
            "rag": {
                "milvus": {
                    "uri": "http://127.0.0.1:19530",
                    "dbName": "nanobot_knowledge",
                    "token": "root:Milvus",
                    "indexType": "HNSW",
                    "metricType": "COSINE",
                },
                "graphStore": {
                    "enabled": True,
                    "provider": "neo4j",
                    "uri": "bolt://127.0.0.1:7687",
                    "username": "neo4j",
                    "password": "secret",
                    "database": "neo4j",
                },
            }
        }
    )

    engine = create_rag_engine_from_config(config, tmp_path)

    assert engine is not None
    assert engine._lightrag_base_kwargs["vector_storage"] == "MilvusVectorDBStorage"
    assert engine._lightrag_base_kwargs["graph_storage"] == "Neo4JStorage"
    assert engine._lightrag_base_kwargs["kv_storage"] == "PGKVStorage"
    assert engine._lightrag_base_kwargs["doc_status_storage"] == "PGDocStatusStorage"
    assert engine._lightrag_base_kwargs["vector_db_storage_cls_kwargs"]["index_type"] == "HNSW"
    assert engine._storage_env["NEO4J_URI"] == "bolt://127.0.0.1:7687"
    assert engine._storage_env["NEO4J_USERNAME"] == "neo4j"
    assert engine._storage_env["NEO4J_PASSWORD"] == "secret"
    assert engine._storage_env["NEO4J_DATABASE"] == "neo4j"


def test_resolve_litellm_runtime_prefixes_dashscope_and_moonshot_models() -> None:
    qwen_model, qwen_provider, qwen_api_base = RAGEngine._resolve_litellm_runtime(
        model="qwen3.5-plus",
        provider_name="dashscope",
        api_key="",
        api_base="",
    )
    kimi_model, kimi_provider, kimi_api_base = RAGEngine._resolve_litellm_runtime(
        model="kimi-k2.5",
        provider_name="moonshot",
        api_key="",
        api_base="https://api.moonshot.cn/v1",
    )

    assert qwen_model == "dashscope/qwen3.5-plus"
    assert qwen_provider is None
    assert qwen_api_base is None
    assert kimi_model == "moonshot/kimi-k2.5"
    assert kimi_provider is None
    assert kimi_api_base == "https://api.moonshot.cn/v1"


def test_resolve_litellm_runtime_routes_dashscope_embedding_via_openai_compatible_api() -> None:
    embedding_model, custom_provider, embedding_api_base = RAGEngine._resolve_litellm_runtime(
        model="text-embedding-v4",
        provider_name="dashscope",
        api_key="",
        api_base="",
        request_type="embedding",
    )

    assert embedding_model == "text-embedding-v4"
    assert custom_provider == "openai"
    assert embedding_api_base == "https://dashscope.aliyuncs.com/compatible-mode/v1"


def test_infer_embedding_dim_for_dashscope_v4() -> None:
    assert infer_embedding_dim("text-embedding-v4", "dashscope") == 1024


@pytest.mark.asyncio
async def test_build_embedding_func_returns_numpy_array(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(
        storage_root=tmp_path / "storage",
        default_model="qwen3.5-plus",
        provider_name="dashscope",
        embedding_provider_name="dashscope",
        embedding_model="text-embedding-v4",
        embedding_dim=1024,
    )

    class _Response:
        data = [{"embedding": [0.1, 0.2, 0.3]}]

    async def _fake_aembedding(**kwargs):
        return _Response()

    monkeypatch.setattr("litellm.aembedding", _fake_aembedding)

    embedding_func = engine._build_embedding_func()
    result = await embedding_func.func(["hello"])

    assert isinstance(result, np.ndarray)
    assert result.shape == (1, 3)


@pytest.mark.asyncio
async def test_build_llm_func_times_out_slow_provider(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(
        storage_root=tmp_path / "storage",
        default_model="openai/gpt-4o-mini",
        llm_timeout=0.01,
    )

    async def _fake_acompletion(**kwargs):
        await asyncio.sleep(0.05)
        raise AssertionError("timeout wrapper did not cancel slow request")

    monkeypatch.setattr("litellm.acompletion", _fake_acompletion)

    llm_func = engine._build_llm_func()

    with pytest.raises(TimeoutError, match="LightRAG LLM request timed out"):
        await llm_func("hello")


@pytest.mark.asyncio
async def test_build_embedding_func_times_out_slow_provider(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(
        storage_root=tmp_path / "storage",
        default_model="openai/gpt-4o-mini",
        embedding_timeout=0.01,
    )

    async def _fake_aembedding(**kwargs):
        await asyncio.sleep(0.05)
        raise AssertionError("timeout wrapper did not cancel slow request")

    monkeypatch.setattr("litellm.aembedding", _fake_aembedding)

    embedding_func = engine._build_embedding_func()

    with pytest.raises(TimeoutError, match="LightRAG embedding request timed out"):
        await embedding_func.func(["hello"])


def test_config_preserves_embedding_capability_type() -> None:
    config = Config.model_validate(
        {
            "modelBindings": {
                "embed-a": {
                    "provider": "openai",
                    "label": "Embedding A",
                    "model": "text-embedding-3-large",
                    "capabilityType": "embedding",
                    "apiKey": "sk-embed",
                    "apiBase": "https://api.openai.com/v1",
                }
            }
        }
    )

    assert config.model_bindings["embed-a"].capability_type == "embedding"


def test_config_infers_embedding_capability_type_for_legacy_binding() -> None:
    config = Config.model_validate(
        {
            "modelBindings": {
                "legacy-embed": {
                    "provider": "openai",
                    "label": "Legacy Embedding",
                    "model": "text-embedding-3-large",
                    "apiKey": "sk-embed",
                    "apiBase": "https://api.openai.com/v1",
                }
            }
        }
    )

    assert config.model_bindings["legacy-embed"].capability_type == "embedding"


def test_rag_engine_runtime_config_applies_per_kb_overrides(tmp_path: Path) -> None:
    engine = RAGEngine(
        storage_root=tmp_path / "rag",
        default_model="deepseek-chat",
        provider_name="deepseek",
        api_key="sk-default",
        api_base="https://api.deepseek.com",
        embedding_provider_name="dashscope",
        embedding_api_key="sk-embed",
        embedding_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
        embedding_model="text-embedding-v4",
        embedding_dim=1024,
    )
    engine.set_kb_runtime_resolver(
        lambda kb_id: {
            "llm_model": "qwen-max",
            "llm_provider_name": "dashscope",
            "embedding_model": "bge-m3",
            "embedding_provider_name": "custom",
            "embedding_dim": 2048,
        } if kb_id == "kb-1" else {}
    )

    runtime = engine._kb_runtime_config("kb-1")

    assert runtime["llm_model"] == "qwen-max"
    assert runtime["llm_provider_name"] == "dashscope"
    assert runtime["embedding_model"] == "bge-m3"
    assert runtime["embedding_provider_name"] == "custom"
    assert runtime["embedding_dim"] == 2048


@pytest.mark.asyncio
async def test_ensure_ready_skips_immediate_retry_and_enters_cooldown_for_backend_unavailable(tmp_path: Path) -> None:
    engine = RAGEngine(
        storage_root=tmp_path / "storage",
        default_model="deepseek-chat",
    )
    failing_rag = _FailingInitRag(
        "<MilvusException: (code=2, message=Fail connecting to server on 127.0.0.1:19530, illegal connection params or server unavailable)>"
    )
    engine._get_or_create_instance = AsyncMock(return_value=failing_rag)  # type: ignore[method-assign]
    engine.reset_kb = AsyncMock()  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="RAGAnything initialization failed"):
        await engine._ensure_ready("kb-ops")

    assert failing_rag.init_calls == 1
    assert engine.reset_kb.await_count == 1

    with pytest.raises(RuntimeError, match="temporarily paused"):
        await engine._ensure_ready("kb-ops")

    assert engine._get_or_create_instance.await_count == 1
