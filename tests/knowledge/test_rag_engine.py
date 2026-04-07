"""Tests for the RAGEngine (LightRAG Core embedded adapter)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from nanobot.platform.knowledge.rag_engine import (
    RAGEngine,
    IndexResult,
    RetrievalHit,
    create_rag_engine_from_config,
    _infer_embedding_dim,
    _has_structured_evidence,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_engine(tmp_path: Path, **overrides: Any) -> RAGEngine:
    defaults = {
        "storage_root": tmp_path / "lightrag",
        "default_model": "gpt-4o-mini",
        "provider_name": "openai",
        "api_key": "test-key",
        "api_base": "https://api.openai.com/v1",
        "embedding_model": "text-embedding-3-large",
        "embedding_dim": 3072,
    }
    defaults.update(overrides)
    return RAGEngine(**defaults)


# ---------------------------------------------------------------------------
# Tests: Workspace naming
# ---------------------------------------------------------------------------


def test_sanitize_workspace_id_basic() -> None:
    assert RAGEngine._sanitize_workspace_id("abc-123") == "abc_123"


def test_sanitize_workspace_id_special_chars() -> None:
    assert RAGEngine._sanitize_workspace_id("my kb!@#") == "my_kb"


def test_sanitize_workspace_id_empty() -> None:
    assert RAGEngine._sanitize_workspace_id("") == "knowledge"


def test_kb_storage_workspace(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    assert engine._kb_storage_workspace("test-kb") == "kb_test_kb"


# ---------------------------------------------------------------------------
# Tests: Query mode normalization
# ---------------------------------------------------------------------------


def test_normalize_query_mode_aliases() -> None:
    assert RAGEngine._normalize_query_mode("keyword") == "naive"
    assert RAGEngine._normalize_query_mode("semantic") == "local"
    assert RAGEngine._normalize_query_mode("hybrid") == "hybrid"
    assert RAGEngine._normalize_query_mode("mix") == "mix"
    assert RAGEngine._normalize_query_mode("GLOBAL") == "global"
    assert RAGEngine._normalize_query_mode("") == "hybrid"
    assert RAGEngine._normalize_query_mode(None) == "hybrid"
    assert RAGEngine._normalize_query_mode("unknown") == "hybrid"


# ---------------------------------------------------------------------------
# Tests: Timeout detection
# ---------------------------------------------------------------------------


def test_is_timeout_like_error() -> None:
    assert RAGEngine._is_timeout_like_error(TimeoutError("timed out"))
    assert RAGEngine._is_timeout_like_error(asyncio.TimeoutError())
    assert RAGEngine._is_timeout_like_error(Exception("connection timeout occurred"))
    assert not RAGEngine._is_timeout_like_error(ValueError("bad value"))


# ---------------------------------------------------------------------------
# Tests: Embedding dimension inference
# ---------------------------------------------------------------------------


def test_infer_embedding_dim_defaults() -> None:
    assert _infer_embedding_dim("text-embedding-3-large") == 3072
    assert _infer_embedding_dim("text-embedding-3-small") == 1536
    assert _infer_embedding_dim("text-embedding-ada-002") == 1536


def test_infer_embedding_dim_dashscope() -> None:
    assert _infer_embedding_dim("text-embedding-v4", "dashscope") == 1024


def test_infer_embedding_dim_unknown() -> None:
    assert _infer_embedding_dim("some-unknown-model") == 3072


# ---------------------------------------------------------------------------
# Tests: has_structured_evidence
# ---------------------------------------------------------------------------


def test_has_structured_evidence_with_chunks() -> None:
    assert _has_structured_evidence({"data": {"chunks": [{"content": "x"}]}})


def test_has_structured_evidence_with_references() -> None:
    assert _has_structured_evidence({"data": {"references": [{"ref_id": "1"}]}})


def test_has_structured_evidence_empty() -> None:
    assert not _has_structured_evidence({"data": {}})
    assert not _has_structured_evidence({})
    assert not _has_structured_evidence({"data": {"chunks": [], "references": []}})


# ---------------------------------------------------------------------------
# Tests: IndexResult
# ---------------------------------------------------------------------------


def test_index_result_success() -> None:
    r = IndexResult(success=True, doc_id="d1", chunks_count=5)
    assert r.success is True
    assert r.doc_id == "d1"
    assert r.chunks_count == 5
    assert r.error is None


def test_index_result_failure() -> None:
    r = IndexResult(success=False, error="boom")
    assert r.success is False
    assert r.error == "boom"


# ---------------------------------------------------------------------------
# Tests: Instance lifecycle
# ---------------------------------------------------------------------------


def test_get_lock_creates_lock(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    lock1 = engine._get_lock("kb1")
    lock2 = engine._get_lock("kb1")
    assert lock1 is lock2


def test_kb_working_dir(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    wd = engine._kb_working_dir("my-kb")
    assert wd == tmp_path / "lightrag" / "my-kb"


# ---------------------------------------------------------------------------
# Tests: Storage env scope
# ---------------------------------------------------------------------------


def test_storage_env_scope_sets_and_restores(tmp_path: Path) -> None:
    import os
    engine = _make_engine(tmp_path, storage_env={"TEST_RAG_VAR": "hello"})
    assert os.environ.get("TEST_RAG_VAR") is None
    with engine._storage_env_scope():
        assert os.environ.get("TEST_RAG_VAR") == "hello"
    assert os.environ.get("TEST_RAG_VAR") is None


def test_storage_env_scope_empty(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path, storage_env={})
    # Should not raise
    with engine._storage_env_scope():
        pass


# ---------------------------------------------------------------------------
# Tests: KB runtime resolver
# ---------------------------------------------------------------------------


def test_set_kb_runtime_resolver(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    assert engine._resolve_kb_runtime("kb1") is None

    engine.set_kb_runtime_resolver(lambda kb_id: {"llm_model": "custom-model"})
    result = engine._resolve_kb_runtime("kb1")
    assert result == {"llm_model": "custom-model"}


def test_kb_runtime_resolver_error_returns_none(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    engine.set_kb_runtime_resolver(lambda kb_id: 1 / 0)  # ZeroDivisionError
    result = engine._resolve_kb_runtime("kb1")
    assert result is None


# ---------------------------------------------------------------------------
# Tests: shutdown_async
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_shutdown_async_finalizes_instances(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    mock_rag = MagicMock()
    mock_rag.finalize_storages = AsyncMock()
    engine._instances["kb1"] = mock_rag
    engine._instances["kb2"] = mock_rag

    await engine.shutdown_async()

    assert mock_rag.finalize_storages.call_count == 2
    assert len(engine._instances) == 0
    assert len(engine._locks) == 0


# ---------------------------------------------------------------------------
# Tests: reset_kb
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reset_kb_finalizes_and_evicts(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    mock_rag = MagicMock()
    mock_rag.finalize_storages = AsyncMock()
    engine._instances["kb1"] = mock_rag

    await engine.reset_kb("kb1")

    mock_rag.finalize_storages.assert_called_once()
    assert "kb1" not in engine._instances


@pytest.mark.asyncio
async def test_reset_kb_missing_instance(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    # Should not raise
    await engine.reset_kb("nonexistent")


# ---------------------------------------------------------------------------
# Tests: normalize_graph
# ---------------------------------------------------------------------------


def test_normalize_graph_empty() -> None:
    result = RAGEngine._normalize_graph(MagicMock(nodes=[], edges=[], is_truncated=False), labels=[])
    assert result == {"nodes": [], "edges": [], "labels": [], "isTruncated": False}


def test_normalize_graph_with_data() -> None:
    node1 = MagicMock(id="n1", labels=["Person"], properties={"entity_name": "Alice"})
    node2 = MagicMock(id="n2", labels=["Org"], properties={"name": "Acme"})
    edge = MagicMock(id="e1", type="works_at", source="n1", target="n2", properties={})
    graph = MagicMock(nodes=[node1, node2], edges=[edge], is_truncated=True)

    result = RAGEngine._normalize_graph(graph, labels=["Person", "Org"])

    assert len(result["nodes"]) == 2
    assert result["nodes"][0]["id"] == "n1"
    assert result["nodes"][0]["title"] == "Alice"
    assert result["nodes"][1]["title"] == "Acme"
    assert len(result["edges"]) == 1
    assert result["edges"][0]["source"] == "n1"
    assert result["edges"][0]["target"] == "n2"
    assert result["edges"][0]["type"] == "works_at"
    assert result["isTruncated"] is True
    assert result["labels"] == ["Person", "Org"]


# ---------------------------------------------------------------------------
# Tests: Factory (create_rag_engine_from_config)
# ---------------------------------------------------------------------------


def test_config_rag_defaults() -> None:
    from nanobot.config.schema import Config

    config = Config()
    assert config.rag.llm_binding is None
    assert config.rag.embedding_binding is None
    assert config.rag.llm_timeout == 180
    assert config.rag.embedding_timeout == 60
    assert config.rag.max_async == 16
    assert config.rag.max_parallel_insert == 4
    assert config.rag.chunk_token_size == 2400
    assert config.rag.embedding_batch_num == 32
    assert config.rag.milvus.uri == "http://127.0.0.1:19530"
    assert config.rag.graph_store.provider == "neo4j"
    assert config.rag.graph_store.enabled is True


@patch("nanobot.platform.knowledge.rag_engine._check_lightrag", return_value=False)
def test_create_rag_engine_returns_none_without_lightrag(mock_check: Any, tmp_path: Path) -> None:
    from nanobot.config.schema import Config

    config = Config()
    result = create_rag_engine_from_config(config, tmp_path)
    assert result is None


@patch("nanobot.platform.knowledge.rag_engine._check_lightrag", return_value=True)
def test_create_rag_engine_from_config_creates_engine(mock_check: Any, tmp_path: Path) -> None:
    from nanobot.config.schema import Config

    config = Config.model_validate({
        "rag": {
            "llmTimeout": 200,
            "embeddingTimeout": 45,
            "maxAsync": 8,
        },
    })

    engine = create_rag_engine_from_config(config, tmp_path)

    assert engine is not None
    assert isinstance(engine, RAGEngine)
    assert engine._llm_timeout == 200.0
    assert engine._embedding_timeout == 45.0


@patch("nanobot.platform.knowledge.rag_engine._check_lightrag", return_value=True)
def test_create_rag_engine_from_config_with_bindings(mock_check: Any, tmp_path: Path) -> None:
    from nanobot.config.schema import Config

    config = Config.model_validate({
        "modelBindings": {
            "rag-llm": {
                "model": "deepseek-chat",
                "provider": "deepseek",
                "apiKey": "sk-test",
            },
            "rag-embed": {
                "model": "text-embedding-v4",
                "provider": "dashscope",
                "apiKey": "dk-test",
                "capabilityType": "embedding",
            },
        },
        "rag": {
            "llmBinding": "rag-llm",
            "embeddingBinding": "rag-embed",
        },
    })

    engine = create_rag_engine_from_config(config, tmp_path)

    assert engine is not None
    assert engine._default_model == "deepseek-chat"
    assert engine._embedding_model == "text-embedding-v4"
    assert engine._embedding_dim == 1024  # dashscope text-embedding-v4
