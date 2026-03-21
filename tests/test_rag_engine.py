from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import numpy as np
import pytest

from nanobot.config.schema import Config
from nanobot.platform.knowledge.rag_engine import (
    RAGEngine,
    _infer_embedding_dim,
    create_rag_engine_from_config,
)


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
        self.insert_calls: list[tuple[tuple, dict]] = []
        self.process_calls: list[tuple[tuple, dict]] = []
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
        self.insert_calls.append((args, kwargs))
        return None

    async def process_document_complete(self, *args, **kwargs):
        self.process_calls.append((args, kwargs))
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
                    "capabilityType": "embedding",
                    "apiKey": "sk-rag-embed",
                    "apiBase": "https://api.openai.com/v1",
                },
            },
            "rag": {
                "llmBinding": "rag-llm",
                "embeddingBinding": "rag-embedding",
                "mineruApiBase": "https://mineru.net",
                "mineruApiToken": "mineru-token",
                "mineruModelVersion": "vlm",
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
    assert engine._mineru_api_base == "https://mineru.net"
    assert engine._mineru_api_token == "mineru-token"
    assert engine._mineru_model_version == "vlm"


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
    assert _infer_embedding_dim("text-embedding-v4", "dashscope") == 1024


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


def test_require_mineru_success_accepts_zero_code() -> None:
    payload = {
        "code": 0,
        "msg": "ok",
        "data": {"batch_id": "batch-1"},
    }

    result = RAGEngine._require_mineru_success(payload, operation="file upload URL request")

    assert result == {"batch_id": "batch-1"}


@pytest.mark.asyncio
async def test_rag_engine_parse_and_index_prefers_official_mineru_api(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(
        storage_root=tmp_path / "storage",
        default_model="openai/gpt-4o-mini",
        mineru_api_token="mineru-token",
        mineru_api_base="https://mineru.net",
        mineru_model_version="vlm",
    )
    fake_rag = _FakeRag(
        status_by_id={
            "doc-1": {
                "status": "processed",
                "error_msg": "",
                "chunks_count": 3,
                "multimodal_processed": True,
            }
        },
        ready=True,
    )

    async def _fake_mineru(file_path: str, *, output_dir: Path, doc_id: str | None = None):
        from nanobot.platform.knowledge.rag_engine import MineruParseArtifacts

        return MineruParseArtifacts(
            content_list=[{"type": "text", "text": "hello", "page_idx": 0}],
            output_dir=output_dir,
            markdown="hello",
            batch_id="batch-1",
            model_version="vlm",
            full_zip_url="https://cdn.example.com/result.zip",
        )

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))
    monkeypatch.setattr(engine, "_parse_file_with_mineru_api", _fake_mineru)

    result = await engine.parse_and_index("kb-a", str(tmp_path / "demo.pdf"), doc_id="doc-1")

    assert result.success is True
    assert result.parser_name == "mineru_api"
    assert result.metadata["mineru_batch_id"] == "batch-1"
    assert fake_rag.process_calls == []
    assert len(fake_rag.insert_calls) == 1


@pytest.mark.asyncio
async def test_rag_engine_parse_and_index_rejects_office_without_mineru_api_token(monkeypatch, tmp_path) -> None:
    engine = RAGEngine(
        storage_root=tmp_path / "storage",
        default_model="openai/gpt-4o-mini",
    )
    fake_rag = _FakeRag(ready=True)

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=fake_rag))

    result = await engine.parse_and_index("kb-a", str(tmp_path / "demo.docx"), doc_id="doc-1")

    assert result.success is False
    assert "official MinerU API path" in str(result.error)
    assert fake_rag.process_calls == []
