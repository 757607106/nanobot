from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from nanobot.config.schema import Config
from nanobot.platform.knowledge.rag_engine import RAGEngine, create_rag_engine_from_config


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
    ) -> None:
        self.doc_status = doc_status
        self._query_error = query_error

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
        self.init_calls = 0
        self.lightrag = None
        if ready:
            self.lightrag = self._make_lightrag()

    def _make_lightrag(self) -> _FakeLightRAG:
        return _FakeLightRAG(
            doc_status=_FakeDocStatusStore(
                by_id=self._status_by_id,
                by_file_path=self._status_by_file_path,
            ),
            query_error=self._query_error,
        )

    async def _ensure_lightrag_initialized(self):
        self.init_calls += 1
        self.lightrag = self._make_lightrag()
        return {"success": True}

    async def insert_content_list(self, *args, **kwargs):
        return None

    async def process_document_complete(self, *args, **kwargs):
        return self._process_result

    async def finalize_storages(self):
        return None

    def _get_file_reference(self, file_path: str) -> str:
        return Path(file_path).name


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
async def test_rag_engine_query_raises_when_all_kbs_fail(monkeypatch) -> None:
    engine = RAGEngine(storage_root=Path("/tmp/test-rag-engine-query"), default_model="openai/gpt-4o-mini")
    fake_rag = _FakeRag(query_error=RuntimeError("boom"), ready=True)

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))

    with pytest.raises(RuntimeError, match="kb-a: boom"):
        await engine.query(["kb-a"], "restart worker", mode="hybrid")


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
                    "apiKey": "sk-rag-embed",
                    "apiBase": "https://api.openai.com/v1",
                },
            },
            "rag": {
                "llmBinding": "rag-llm",
                "llmModel": "moonshot/kimi-k2.5",
                "embeddingBinding": "rag-embedding",
                "embeddingModel": "text-embedding-3-large",
                "mineruApiBase": "http://127.0.0.1:30000",
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
    assert engine._mineru_api_base == "http://127.0.0.1:30000"
