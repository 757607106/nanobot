"""Regression tests for segment-based indexing and chunking improvements.

Covers:
- chunk_by_headings regex: Chinese chapter markers (回, 卷, 章, 节, 篇)
- chunk_by_headings sub-chunking: oversized sections split to chunk_size
- DocumentPipeline segment splitting: large files auto-split into segments
- DocumentPipeline paragraph fallback: unstructured large files
- insert_text_segments: fault-isolated concurrent segment ingestion
- Progress tracking during segment indexing
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from nanobot.config.schema import Config
from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge import KnowledgeBaseService, create_knowledge_store
from nanobot.platform.knowledge.chunking.dispatcher import (
    chunk_by_headings,
    chunk_plain_text,
    build_chunks,
)
from nanobot.platform.knowledge.rag_engine import (
    IndexResult,
    ParseResult,
    RAGEngine,
)
from tests.knowledge_test_utils import FakeRAGEngine


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

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
    deadline = time.time() + 10.0
    while time.time() < deadline:
        job = next((item for item in service.list_jobs(kb_id) if item["jobId"] == job_id), None)
        if job and job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for job {job_id}")


# ===========================================================================
# Part 1: chunk_by_headings regex tests
# ===========================================================================

class TestChunkByHeadingsRegex:
    """Ensure heading regex covers all Chinese structural markers."""

    def test_splits_on_hui(self) -> None:
        """Classical novels use 第X回 (e.g., 水浒传, 三国演义)."""
        text = (
            "引首\n话说大宋仁宗天子在位。\n"
            "\n第一回 张天师祈禳瘟疫洪太尉误走妖魔\n话说嘉祐三年三月初三。\n"
            "\n第二回 王教头私走延安府九纹龙大闹史家村\n且说那少华山上三个头领。\n"
        )
        sections = chunk_by_headings(text)
        assert len(sections) == 3
        assert sections[0].startswith("引首")
        assert "第一回" in sections[1]
        assert "第二回" in sections[2]

    def test_splits_on_juan(self) -> None:
        """Historical texts use 第X卷 (e.g., 史记)."""
        text = "第一卷 本纪\n黄帝者少典之子。\n\n第二卷 世家\n齐太公世家。\n"
        sections = chunk_by_headings(text)
        assert len(sections) == 2
        assert "第一卷" in sections[0]
        assert "第二卷" in sections[1]

    def test_splits_on_zhang(self) -> None:
        """Modern books use 第X章."""
        text = "第一章 概述\n本文介绍系统架构。\n\n第二章 方法论\n我们采用敏捷开发流程。\n"
        sections = chunk_by_headings(text)
        assert len(sections) == 2

    def test_splits_on_jie(self) -> None:
        """Textbooks use 第X节."""
        text = "第一节 背景介绍\n互联网技术的发展历程。\n\n第二节 核心概念\n微服务架构的基本原理。\n"
        sections = chunk_by_headings(text)
        assert len(sections) == 2

    def test_splits_on_pian(self) -> None:
        """Legal/philosophical texts use 第X篇."""
        text = "第一篇 总则\n本法适用于中华人民共和国境内。\n\n第二篇 分则\n关于合同的订立与履行。\n"
        sections = chunk_by_headings(text)
        assert len(sections) == 2

    def test_splits_on_markdown_headings(self) -> None:
        """Markdown documents use # headings."""
        text = "# Introduction\nThis is the intro.\n\n## Methods\nWe use pytest.\n\n### Details\nMore info here.\n"
        sections = chunk_by_headings(text)
        assert len(sections) == 3

    def test_splits_on_mixed_markers(self) -> None:
        """A document mixing markdown and Chinese markers."""
        text = "# 前言\n本书讲述系统设计。\n\n第一章 核心架构\n微服务拆分策略。\n\n第二章 部署方案\n容器编排方案。\n"
        sections = chunk_by_headings(text)
        assert len(sections) == 3

    def test_no_markers_returns_single_section(self) -> None:
        """Plain text without markers returns the entire text as one section."""
        text = "这是一段没有任何章节标记的纯文本内容。\n\n后续段落的补充说明。\n"
        sections = chunk_by_headings(text)
        assert len(sections) == 1

    def test_complex_numbering(self) -> None:
        """Chinese numerals (一百二十) should be matched."""
        text = (
            "第一百一十八回 卢俊义大战昱岭关\n话说卢俊义引兵来到昱岭关下。\n"
            "\n第一百一十九回 鲁智深浙江坐化\n话说鲁智深自与武松在寺中。\n"
            "\n第一百二十回 宋公明神聚蓼儿\n话说宋公明自离了方腊。\n"
        )
        sections = chunk_by_headings(text)
        assert len(sections) == 3


# ===========================================================================
# Part 2: chunk_by_headings sub-chunking tests
# ===========================================================================

class TestChunkByHeadingsSubChunking:
    """Oversized sections are split when chunk_size is specified."""

    def test_oversized_sections_are_sub_chunked(self) -> None:
        """Sections exceeding chunk_size are split by paragraphs."""
        chapter_1 = "第一章 简介\n\n" + "A" * 3000
        chapter_2 = "第二章 详情\n\n" + "B" * 500
        text = f"{chapter_1}\n\n{chapter_2}"

        chunks = chunk_by_headings(text, chunk_size=1000, chunk_overlap=100)
        # Chapter 1 (3000+ chars) should be split into ~3-4 chunks; chapter 2 stays intact
        assert len(chunks) >= 4
        assert all(len(c) <= 1000 for c in chunks)

    def test_small_sections_untouched(self) -> None:
        """Sections within chunk_size are not altered."""
        text = "第一章 简介\n\n短内容一\n\n第二章 详情\n\n短内容二\n"
        chunks_with_limit = chunk_by_headings(text, chunk_size=5000, chunk_overlap=100)
        chunks_no_limit = chunk_by_headings(text)
        assert chunks_with_limit == chunks_no_limit

    def test_zero_chunk_size_skips_sub_chunking(self) -> None:
        """chunk_size=0 means no sub-chunking (backward compatible)."""
        big_chapter = "第一章 大章\n\n" + "X" * 10_000
        chunks = chunk_by_headings(big_chapter, chunk_size=0)
        assert len(chunks) == 1

    def test_book_preset_wires_chunk_size(self) -> None:
        """build_chunks with book preset passes chunk_size to chunk_by_headings."""
        chapter_1 = "第一章 简介\n\n" + ("段落一。" * 500) + "\n\n"
        chapter_2 = "第二章 结论\n\n短内容\n"
        text = chapter_1 + chapter_2
        chunks = build_chunks(
            text,
            kb_params={"chunk_preset_id": "book", "chunk_size": 500},
        )
        assert len(chunks) >= 3  # Chapter 1 sub-chunked + chapter 2
        assert all(len(c) <= 500 for c in chunks)


# ===========================================================================
# Part 3: insert_text_segments (RAGEngine) tests
# ===========================================================================

class _SegmentTrackingRAGEngine(FakeRAGEngine):
    """Tracks individual segment insert_text calls for verification."""

    def __init__(self) -> None:
        super().__init__()
        self.segment_calls: list[dict[str, str | None]] = []

    async def insert_text(
        self,
        kb_id: str,
        text: str,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> IndexResult:
        self.segment_calls.append({
            "kb_id": kb_id,
            "doc_id": doc_id,
            "file_path": file_path,
            "text_len": len(text),
        })
        return await super().insert_text(kb_id, text, doc_id=doc_id, file_path=file_path)


class _PartialFailureRAGEngine(FakeRAGEngine):
    """Simulates failure on specific segments to test fault isolation."""

    def __init__(self, fail_doc_ids: set[str]) -> None:
        super().__init__()
        self.fail_doc_ids = fail_doc_ids

    async def insert_text(
        self,
        kb_id: str,
        text: str,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> IndexResult:
        if doc_id in self.fail_doc_ids:
            return IndexResult(
                success=False,
                doc_id=doc_id,
                error=f"Simulated failure for {doc_id}",
            )
        return await super().insert_text(kb_id, text, doc_id=doc_id, file_path=file_path)


class _TotalFailureRAGEngine(FakeRAGEngine):
    """All insert_text calls fail."""

    async def insert_text(
        self,
        kb_id: str,
        text: str,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> IndexResult:
        return IndexResult(success=False, doc_id=doc_id, error="Total failure")


@pytest.mark.asyncio
async def test_insert_text_segments_distributes_to_individual_inserts(monkeypatch, tmp_path) -> None:
    """Each segment results in an independent insert_text call."""
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    tracker = _SegmentTrackingRAGEngine()

    # Patch insert_text to use tracker
    original_insert = engine.insert_text
    engine.insert_text = tracker.insert_text

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=object()))
    monkeypatch.setattr(engine, "_build_lightrag_kwargs", lambda kb_id: {"max_parallel_insert": 2})

    segments = [
        ("Segment 0 content", "doc_seg_0000"),
        ("Segment 1 content", "doc_seg_0001"),
        ("Segment 2 content", "doc_seg_0002"),
    ]

    result = await engine.insert_text_segments(
        "kb-test",
        segments,
        file_path="large_doc.txt",
    )

    assert result.success is True
    assert result.parser_name == "text_segments"
    assert result.metadata["total_segments"] == 3
    assert result.metadata["succeeded_segments"] == 3
    assert result.metadata["failed_segments"] == 0
    assert len(tracker.segment_calls) == 3
    doc_ids = {call["doc_id"] for call in tracker.segment_calls}
    assert doc_ids == {"doc_seg_0000", "doc_seg_0001", "doc_seg_0002"}


@pytest.mark.asyncio
async def test_insert_text_segments_fault_isolation(monkeypatch, tmp_path) -> None:
    """Failed segments don't poison successful segments."""
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    partial_fail = _PartialFailureRAGEngine(fail_doc_ids={"seg_0001", "seg_0003"})

    engine.insert_text = partial_fail.insert_text
    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=object()))
    monkeypatch.setattr(engine, "_build_lightrag_kwargs", lambda kb_id: {"max_parallel_insert": 4})

    segments = [
        ("Content 0", "seg_0000"),
        ("Content 1", "seg_0001"),  # Will fail
        ("Content 2", "seg_0002"),
        ("Content 3", "seg_0003"),  # Will fail
        ("Content 4", "seg_0004"),
    ]

    result = await engine.insert_text_segments("kb-partial", segments, file_path="doc.txt")

    assert result.success is True  # Partial success is still success
    assert result.metadata["total_segments"] == 5
    assert result.metadata["succeeded_segments"] == 3
    assert result.metadata["failed_segments"] == 2
    assert len(result.metadata["failed_details"]) == 2
    failed_ids = {d["doc_id"] for d in result.metadata["failed_details"]}
    assert failed_ids == {"seg_0001", "seg_0003"}
    # Successful docs exist in the fake engine's storage
    assert "seg_0000" in partial_fail._docs.get("kb-partial", {})
    assert "seg_0002" in partial_fail._docs.get("kb-partial", {})
    assert "seg_0004" in partial_fail._docs.get("kb-partial", {})
    # Failed docs should NOT be in storage
    assert "seg_0001" not in partial_fail._docs.get("kb-partial", {})
    assert "seg_0003" not in partial_fail._docs.get("kb-partial", {})


@pytest.mark.asyncio
async def test_insert_text_segments_total_failure(monkeypatch, tmp_path) -> None:
    """When all segments fail, result.success is False."""
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    total_fail = _TotalFailureRAGEngine()

    engine.insert_text = total_fail.insert_text
    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=object()))
    monkeypatch.setattr(engine, "_build_lightrag_kwargs", lambda kb_id: {"max_parallel_insert": 2})

    segments = [("Content 0", "seg_0"), ("Content 1", "seg_1")]

    result = await engine.insert_text_segments("kb-fail", segments, file_path="doc.txt")

    assert result.success is False
    assert result.metadata["succeeded_segments"] == 0
    assert result.metadata["failed_segments"] == 2
    assert "2/2 segments failed" in result.error


@pytest.mark.asyncio
async def test_insert_text_segments_progress_callback(monkeypatch, tmp_path) -> None:
    """on_segment_done callback fires for each segment."""
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    tracker = _SegmentTrackingRAGEngine()
    engine.insert_text = tracker.insert_text

    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=object()))
    monkeypatch.setattr(engine, "_build_lightrag_kwargs", lambda kb_id: {"max_parallel_insert": 1})

    progress_log: list[tuple] = []

    def on_done(index, total, seg_doc_id, success, error):
        progress_log.append((index, total, seg_doc_id, success, error))

    segments = [("Content A", "seg_a"), ("Content B", "seg_b")]

    await engine.insert_text_segments(
        "kb-progress",
        segments,
        file_path="doc.txt",
        on_segment_done=on_done,
    )

    assert len(progress_log) == 2
    totals = {p[1] for p in progress_log}
    assert totals == {2}
    doc_ids = {p[2] for p in progress_log}
    assert doc_ids == {"seg_a", "seg_b"}
    assert all(p[3] is True for p in progress_log)  # all succeeded


@pytest.mark.asyncio
async def test_insert_text_segments_empty_raises(monkeypatch, tmp_path) -> None:
    """Calling with empty segments list raises ValueError."""
    engine = RAGEngine(storage_root=tmp_path / "storage", default_model="openai/gpt-4o-mini")
    monkeypatch.setattr(engine, "_ensure_ready", AsyncMock(return_value=object()))

    with pytest.raises(ValueError, match="segments are required"):
        await engine.insert_text_segments("kb-empty", [], file_path="doc.txt")


# ===========================================================================
# Part 4: End-to-end pipeline segment indexing tests
# ===========================================================================

def _build_large_structured_doc(num_chapters: int = 10, chars_per_chapter: int = 8000) -> bytes:
    """Build a large document with Chinese chapter markers."""
    parts = ["前言\n\n这是一份大型企业文档的前言部分。\n\n"]
    unit = "本系统采用分布式微服务架构进行设计和部署。"  # ~20 chars
    for i in range(1, num_chapters + 1):
        chapter_body = (unit * (chars_per_chapter // len(unit) + 1))[:chars_per_chapter]
        parts.append(f"第{_cn_num(i)}章 主题{i}\n\n{chapter_body}\n\n")
    return "".join(parts).encode("utf-8")


def _build_large_unstructured_doc(total_chars: int = 100_000) -> bytes:
    """Build a large document WITHOUT any heading markers."""
    paragraph = "这是一段不包含任何章节标记的企业级文档内容，例如合同、会议纪要、日志等。" * 10 + "\n\n"
    repeat = total_chars // len(paragraph) + 1
    return (paragraph * repeat)[:total_chars].encode("utf-8")


def _cn_num(n: int) -> str:
    """Simple Chinese numeral for 1-20."""
    cn = "零一二三四五六七八九十"
    if n <= 10:
        return cn[n]
    if n < 20:
        return f"十{cn[n - 10]}"
    return f"二十{cn[n - 20] if n > 20 else ''}"


class _SegmentAwareFakeRAGEngine(FakeRAGEngine):
    """FakeRAGEngine that also supports insert_text_segments by delegation."""

    def __init__(self) -> None:
        super().__init__()
        self.segment_insert_calls: int = 0

    async def insert_text(
        self,
        kb_id: str,
        text: str,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> IndexResult:
        self.segment_insert_calls += 1
        return await super().insert_text(kb_id, text, doc_id=doc_id, file_path=file_path)

    async def insert_text_segments(
        self,
        kb_id: str,
        segments: list[tuple[str, str]],
        *,
        file_path: str | None = None,
        max_concurrency: int = 0,
        on_segment_done=None,
    ) -> ParseResult:
        """Process segments by delegating to insert_text individually."""
        results = []
        for i, (text, seg_doc_id) in enumerate(segments):
            result = await self.insert_text(kb_id, text, doc_id=seg_doc_id, file_path=file_path)
            results.append((seg_doc_id, result.success, result.chunks_count, result.error))
            if callable(on_segment_done):
                try:
                    on_segment_done(i, len(segments), seg_doc_id, result.success, result.error)
                except Exception:
                    pass

        succeeded = [(d, c) for d, ok, c, _ in results if ok]
        failed = [(d, e) for d, ok, _, e in results if not ok]
        total_chunks = sum(c for _, c in succeeded)

        return ParseResult(
            success=len(succeeded) > 0,
            parser_name="text_segments",
            chunks_count=total_chunks,
            metadata={
                "file_path": file_path,
                "total_segments": len(segments),
                "succeeded_segments": len(succeeded),
                "failed_segments": len(failed),
                "chunks_count": total_chunks,
                "failed_details": [{"doc_id": d, "error": e} for d, e in failed] if failed else [],
            },
        )


def test_large_structured_doc_uses_segment_indexing(tmp_path: Path) -> None:
    """Large document with chapter markers triggers segment-based indexing."""
    instance = _make_instance(tmp_path)
    rag_engine = _SegmentAwareFakeRAGEngine()
    service = KnowledgeBaseService(
        _make_store(instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=rag_engine,
        config=None,
    )

    created = service.create_knowledge_base({"name": "Segment KB", "kbType": "lightrag"})
    kb_id = created["kbId"]

    # Upload a large structured document (~80K chars = 10 chapters × 8K)
    content = _build_large_structured_doc(num_chapters=10, chars_per_chapter=8000)
    uploaded = service.upload_files(
        kb_id,
        [{"file_name": "enterprise_doc.md", "mime_type": "text/markdown", "content": content}],
    )
    file_id = uploaded["items"][0]["fileId"]

    parse_job = service.parse_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    file_payload = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == file_id)
    assert file_payload["processingParams"]["indexMode"] == "text_segments"
    assert file_payload["processingParams"]["indexBackend"] == "lightrag"
    # Multiple segments should have been created (前言 + 10 chapters = 11)
    assert file_payload["processingParams"]["total_segments"] == 11
    assert file_payload["processingParams"]["succeeded_segments"] == 11
    assert rag_engine.segment_insert_calls == 11


def test_large_unstructured_doc_uses_paragraph_fallback(tmp_path: Path) -> None:
    """Large document WITHOUT heading markers uses paragraph-based segment splitting."""
    instance = _make_instance(tmp_path)
    rag_engine = _SegmentAwareFakeRAGEngine()
    service = KnowledgeBaseService(
        _make_store(instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=rag_engine,
        config=None,
    )

    created = service.create_knowledge_base({"name": "Unstructured KB", "kbType": "lightrag"})
    kb_id = created["kbId"]

    # Upload a 100K unstructured document
    content = _build_large_unstructured_doc(total_chars=100_000)
    uploaded = service.upload_files(
        kb_id,
        [{"file_name": "contract.txt", "mime_type": "text/plain", "content": content}],
    )
    file_id = uploaded["items"][0]["fileId"]

    parse_job = service.parse_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    file_payload = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == file_id)
    assert file_payload["processingParams"]["indexMode"] == "text_segments"
    assert file_payload["processingParams"]["total_segments"] >= 2
    assert file_payload["processingParams"]["succeeded_segments"] >= 2
    # Each segment should result in at least one insert_text call
    assert rag_engine.segment_insert_calls >= 2


def test_small_doc_uses_single_insert(tmp_path: Path) -> None:
    """Documents below the segment threshold use the standard single insert path."""
    instance = _make_instance(tmp_path)
    rag_engine = _SegmentAwareFakeRAGEngine()
    service = KnowledgeBaseService(
        _make_store(instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=rag_engine,
        config=None,
    )

    created = service.create_knowledge_base({"name": "Small Doc KB", "kbType": "lightrag"})
    kb_id = created["kbId"]

    # Upload a small document (well below 50K threshold)
    content = b"# Quick Guide\n\nRestart the service with systemctl.\n"
    uploaded = service.upload_files(
        kb_id,
        [{"file_name": "quick_guide.md", "mime_type": "text/markdown", "content": content}],
    )
    file_id = uploaded["items"][0]["fileId"]

    parse_job = service.parse_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    file_payload = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == file_id)
    # Should NOT use segment mode for small files
    assert file_payload["processingParams"]["indexMode"] == "text_insert"
    assert rag_engine.segment_insert_calls == 1  # Single insert_text call


def test_segment_indexing_preserves_query_results(tmp_path: Path) -> None:
    """Data indexed via segments is queryable through normal retrieve path."""
    instance = _make_instance(tmp_path)
    rag_engine = _SegmentAwareFakeRAGEngine()
    service = KnowledgeBaseService(
        _make_store(instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=rag_engine,
        config=None,
    )

    created = service.create_knowledge_base({"name": "Query KB", "kbType": "lightrag"})
    kb_id = created["kbId"]

    # Build a doc with a known searchable keyword in one of the chapters
    chapters = []
    for i in range(1, 8):
        body = f"第{_cn_num(i)}章 主题{i}\n\n{'普通内容。' * 2000}\n\n"
        chapters.append(body)
    # Embed a unique keyword in chapter 5
    chapters[4] = chapters[4].replace("普通内容。普通内容。", "supervisorctl restart nanobot 是标准操作。")
    content = "".join(chapters).encode("utf-8")

    uploaded = service.upload_files(
        kb_id,
        [{"file_name": "ops_handbook.md", "mime_type": "text/markdown", "content": content}],
    )
    file_id = uploaded["items"][0]["fileId"]

    parse_job = service.parse_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    # Query should find the unique content
    retrieved = service.retrieve(kb_ids=[kb_id], query="restart nanobot", limit=5)
    assert len(retrieved["hits"]) >= 1
    assert any("supervisorctl restart nanobot" in hit["content"] for hit in retrieved["hits"])


def test_segment_indexing_progress_tracking(tmp_path: Path) -> None:
    """Progress metadata is recorded in file processing_params during segment indexing."""
    instance = _make_instance(tmp_path)
    rag_engine = _SegmentAwareFakeRAGEngine()
    service = KnowledgeBaseService(
        _make_store(instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=rag_engine,
        config=None,
    )

    created = service.create_knowledge_base({"name": "Progress KB", "kbType": "lightrag"})
    kb_id = created["kbId"]

    content = _build_large_structured_doc(num_chapters=5, chars_per_chapter=12000)
    uploaded = service.upload_files(
        kb_id,
        [{"file_name": "progress_doc.md", "mime_type": "text/markdown", "content": content}],
    )
    file_id = uploaded["items"][0]["fileId"]

    parse_job = service.parse_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, parse_job)["status"] == "succeeded"

    index_job = service.index_files(kb_id, {"file_ids": [file_id]})["job"]["jobId"]
    assert _wait_for_job(service, kb_id, index_job)["status"] == "succeeded"

    file_payload = next(item for item in service.list_files(kb_id)["items"] if item["fileId"] == file_id)
    params = file_payload["processingParams"]
    assert params["indexMode"] == "text_segments"
    assert params["total_segments"] >= 2
    assert params["succeeded_segments"] == params["total_segments"]
    assert params["failed_segments"] == 0
