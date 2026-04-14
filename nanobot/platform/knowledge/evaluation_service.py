"""Knowledge evaluation, benchmark, mindmap, and sample-question services.

Extracted from KnowledgeBaseService (Phase 5) to encapsulate:
- Mindmap generation and retrieval
- Sample question generation
- Benchmark CRUD and auto-generation
- Evaluation execution, metrics, and result management
- Graph label / stats queries
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from loguru import logger

from nanobot.platform.knowledge.models import (
    KnowledgeBaseDefinition,
    KnowledgeFile,
    now_iso,
)
from nanobot.platform.knowledge.store import KnowledgeBaseStore
from nanobot.platform.knowledge.service import (
    KnowledgeBaseNotFoundError,
    KnowledgeBaseValidationError,
)
from nanobot.platform.knowledge.utils import (
    short_id,
    normalize_text,
    normalize_string_list,
    normalize_eval_text,
    split_large_block,
    DEFAULT_KNOWLEDGE_CHUNK_SIZE,
    DEFAULT_KNOWLEDGE_CHUNK_OVERLAP,
)
from nanobot.platform.knowledge.llm_helpers import KnowledgeLLMHelper

if TYPE_CHECKING:
    from nanobot.platform.knowledge.artifacts import KnowledgeArtifactStore
    from nanobot.platform.knowledge.rag_engine import RAGEngine


class KnowledgeEvaluationService:
    """Handles mindmap, sample questions, benchmarks, evaluation, and graph queries."""

    def __init__(
        self,
        *,
        store: KnowledgeBaseStore,
        artifacts: KnowledgeArtifactStore,
        rag_engine: RAGEngine | None,
        run_async_fn: Any,
        require_kb_fn: Any,
        submit_job_fn: Any,
        generate_with_llm_fn: Any,
        extract_json_fn: Any,
        query_database_fn: Any,
        normalize_text_fn: Any,
        normalize_string_list_fn: Any,
    ) -> None:
        self.store = store
        self.artifacts = artifacts
        self.rag_engine = rag_engine
        self._run_async = run_async_fn
        self.require_kb = require_kb_fn
        self._submit_background_job = submit_job_fn
        self._generate_with_llm = generate_with_llm_fn
        self._extract_json_text = extract_json_fn
        self._query_database = query_database_fn
        self._normalize_text = normalize_text_fn
        self._normalize_string_list = normalize_string_list_fn

    # ── Internal helpers ───────────────────────────────────────────────────

    def _ensure_evaluation_supported(self, kb: KnowledgeBaseDefinition) -> None:
        if self.rag_engine is None:
            raise KnowledgeBaseValidationError("Evaluation requires an active RAG engine.")

    @staticmethod
    def _extract_headings(text: str, *, limit: int = 6) -> list[str]:
        headings: list[str] = []
        for line in text.splitlines():
            stripped = line.strip().lstrip("#").strip()
            if not stripped:
                continue
            if len(stripped) > 100:
                stripped = stripped[:100].rstrip()
            if stripped not in headings:
                headings.append(stripped)
            if len(headings) >= limit:
                break
        return headings

    def _load_outline(self, file: KnowledgeFile) -> dict[str, Any]:
        text = ""
        if file.markdown_file and Path(file.markdown_file).exists():
            try:
                text = Path(file.markdown_file).read_text(encoding="utf-8")
            except OSError:
                text = ""
        headings = self._extract_headings(text, limit=5)
        return {
            "fileId": file.file_id,
            "filename": file.filename,
            "path": file.path,
            "headings": headings,
            "excerpt": text[:1200].strip(),
        }

    # ── Chunking helpers (legacy compatibility) ────────────────────────────

    @staticmethod
    def _split_large_block(text: str, *, chunk_size: int, chunk_overlap: int) -> list[str]:
        return split_large_block(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    def _chunk_plain_text(self, text: str, *, chunk_size: int, chunk_overlap: int) -> list[str]:
        paragraphs = [item.strip() for item in re.split(r"\n{2,}", text) if item.strip()]
        if not paragraphs:
            paragraphs = [text.strip()]
        chunks: list[str] = []
        current = ""
        for paragraph in paragraphs:
            if len(paragraph) > chunk_size:
                if current.strip():
                    chunks.append(current.strip())
                    current = ""
                chunks.extend(self._split_large_block(paragraph, chunk_size=chunk_size, chunk_overlap=chunk_overlap))
                continue
            candidate = paragraph if not current else f"{current}\n\n{paragraph}"
            if len(candidate) <= chunk_size:
                current = candidate
                continue
            if current.strip():
                chunks.append(current.strip())
            if chunk_overlap > 0 and chunks:
                overlap = chunks[-1][-chunk_overlap:].strip()
                current = f"{overlap}\n\n{paragraph}".strip() if overlap else paragraph
            else:
                current = paragraph
        if current.strip():
            chunks.append(current.strip())
        return chunks

    @staticmethod
    def _chunk_by_headings(text: str) -> list[str]:
        sections: list[str] = []
        current: list[str] = []
        for line in text.splitlines():
            stripped = line.strip()
            if re.match(r"^(#{1,6}\s+|chapter\s+\d+|section\s+\d+|第.+[章节篇])", stripped, re.IGNORECASE):
                if current:
                    sections.append("\n".join(current).strip())
                    current = []
            if stripped:
                current.append(line)
        if current:
            sections.append("\n".join(current).strip())
        return [item for item in sections if item]

    @staticmethod
    def _chunk_qa_text(text: str) -> list[str]:
        normalized = text.replace("\r\n", "\n")
        pattern = re.compile(
            r"(?:^|\n)(?:Q[:：]\s*(?P<q>.+?)\nA[:：]\s*(?P<a>.+?))(?=\nQ[:：]|\Z)",
            re.DOTALL | re.IGNORECASE,
        )
        result = []
        for match in pattern.finditer(normalized):
            question = str(match.group("q") or "").strip()
            answer = str(match.group("a") or "").strip()
            if question and answer:
                result.append(f"Q: {question}\nA: {answer}")
        return result

    @staticmethod
    def _chunk_law_text(text: str) -> list[str]:
        parts = re.split(r"(?=第[\d一二三四五六七八九十百千]+条)", text)
        return [item.strip() for item in parts if item.strip()]

    def _build_chunk_texts(
        self,
        kb: KnowledgeBaseDefinition,
        file: KnowledgeFile,
        text: str,
    ) -> list[str]:
        params = {**(kb.additional_params or {}), **(file.processing_params or {})}
        chunk_size = max(200, int(params.get("chunk_size") or DEFAULT_KNOWLEDGE_CHUNK_SIZE))
        chunk_overlap = max(0, int(params.get("chunk_overlap") or DEFAULT_KNOWLEDGE_CHUNK_OVERLAP))
        qa_separator = str(params.get("qa_separator") or "").strip()
        chunk_preset_id = str(params.get("chunk_preset_id") or "general").strip().lower()
        faq_items = file.processing_params.get("faqItems")

        chunk_texts: list[str] = []
        if isinstance(faq_items, list) and faq_items:
            for item in faq_items:
                if not isinstance(item, dict):
                    continue
                question = str(item.get("question") or "").strip()
                answer = str(item.get("answer") or "").strip()
                if question and answer:
                    chunk_texts.append(f"Q: {question}\nA: {answer}")
        elif chunk_preset_id == "qa":
            chunk_texts = self._chunk_qa_text(text)
        elif qa_separator and qa_separator in text:
            chunk_texts = [item.strip() for item in text.split(qa_separator) if item.strip()]
        elif chunk_preset_id == "book":
            chunk_texts = self._chunk_by_headings(text)
        elif chunk_preset_id == "laws":
            chunk_texts = self._chunk_law_text(text)
        else:
            chunk_texts = self._chunk_plain_text(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap)

        if not chunk_texts:
            raise KnowledgeBaseValidationError("No chunks were produced for the selected knowledge file.")
        return chunk_texts

    # ── Mindmap ────────────────────────────────────────────────────────────

    def _build_mindmap_fallback(self, kb: KnowledgeBaseDefinition, files: list[KnowledgeFile]) -> dict[str, Any]:
        by_parent: dict[str | None, list[KnowledgeFile]] = {}
        for item in files:
            by_parent.setdefault(item.parent_id, []).append(item)

        def _node_for(file: KnowledgeFile) -> dict[str, Any]:
            if file.is_folder:
                return {
                    "content": file.filename,
                    "children": [_node_for(child) for child in by_parent.get(file.file_id, [])],
                }
            outline = self._load_outline(file)
            children = [{"content": heading, "children": []} for heading in outline["headings"][:4]]
            return {"content": file.filename, "children": children}

        root_children = [_node_for(item) for item in by_parent.get(None, [])]
        return {"content": kb.name, "children": root_children}

    def generate_mindmap(self, kb_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        payload = payload or {}
        file_ids = (
            self._normalize_string_list(payload.get("file_ids"), field_name="file_ids")
            if isinstance(payload.get("file_ids"), list)
            else []
        )
        files = [item for item in self.store.list_files(kb_id) if not file_ids or item.file_id in set(file_ids)]
        fallback = self._build_mindmap_fallback(kb, files)
        outlines = [self._load_outline(item) for item in files if not item.is_folder][:12]
        llm_raw = self._generate_with_llm(
            system_prompt="你是知识架构整理助手。只返回 JSON，结构必须是 {\"content\": string, \"children\": []}。",
            user_prompt=json.dumps(
                {
                    "knowledgeBase": kb.name,
                    "description": kb.description,
                    "files": outlines,
                },
                ensure_ascii=False,
            ),
        )
        generated = fallback
        if llm_raw:
            json_text = self._extract_json_text(llm_raw)
            if json_text:
                try:
                    candidate = json.loads(json_text)
                    if isinstance(candidate, dict) and candidate.get("content"):
                        generated = candidate
                except json.JSONDecodeError:
                    logger.warning("Mindmap JSON decode failed, using fallback")

        updated = self.store.update_kb(replace(kb, mindmap=generated, updated_at=now_iso()))
        if updated is None:
            raise KnowledgeBaseNotFoundError(kb_id)
        return {"mindmap": generated}

    def get_mindmap(self, kb_id: str) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        return {"mindmap": kb.mindmap}

    def get_mindmap_text(self, kb_id: str) -> str:
        kb = self.require_kb(kb_id)
        if kb.mindmap is None:
            kb_map = self.generate_mindmap(kb_id)["mindmap"]
        else:
            kb_map = kb.mindmap

        lines: list[str] = []

        def _walk(node: dict[str, Any], level: int) -> None:
            content = str(node.get("content") or "").strip()
            if content:
                lines.append(f"{'  ' * level}- {content}")
            for child in node.get("children") or []:
                if isinstance(child, dict):
                    _walk(child, level + 1)

        if isinstance(kb_map, dict):
            _walk(kb_map, 0)
        return "\n".join(lines).strip()

    # ── Sample Questions ───────────────────────────────────────────────────

    def _build_sample_question_fallback(self, kb: KnowledgeBaseDefinition, files: list[KnowledgeFile], count: int) -> list[str]:
        questions: list[str] = []
        for file in files:
            if file.is_folder:
                continue
            outline = self._load_outline(file)
            title = outline["filename"]
            if title:
                questions.append(f"知识库里《{title}》的核心内容是什么？")
                questions.append(f"如果我需要用到《{title}》，最关键的步骤有哪些？")
            for heading in outline["headings"][:3]:
                questions.append(f'请解释一下\u201c{heading}\u201d在当前知识库中的含义和作用。')
        deduped: list[str] = []
        seen: set[str] = set()
        for item in questions:
            if item not in seen:
                seen.add(item)
                deduped.append(item)
            if len(deduped) >= count:
                break
        if not deduped:
            deduped = [
                f"{kb.name} 主要覆盖了哪些主题？",
                f"使用 {kb.name} 中的信息时，应该先关注哪些内容？",
            ]
        return deduped[:count]

    def generate_sample_questions(self, kb_id: str, count: int = 10) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        files = [item for item in self.store.list_files(kb_id) if not item.is_folder]
        fallback = self._build_sample_question_fallback(kb, files, max(1, count))
        outlines = [self._load_outline(item) for item in files[:12]]
        llm_raw = self._generate_with_llm(
            system_prompt="你是知识库测试问题生成助手。只返回 JSON，格式必须是 {\"questions\": [string]}。",
            user_prompt=json.dumps(
                {
                    "knowledgeBase": kb.name,
                    "description": kb.description,
                    "count": count,
                    "files": outlines,
                },
                ensure_ascii=False,
            ),
        )
        questions = fallback
        if llm_raw:
            json_text = self._extract_json_text(llm_raw)
            if json_text:
                try:
                    candidate = json.loads(json_text)
                    values = candidate.get("questions") if isinstance(candidate, dict) else None
                    if isinstance(values, list):
                        normalized = [str(item).strip() for item in values if str(item).strip()]
                        if normalized:
                            questions = normalized[:count]
                except json.JSONDecodeError:
                    logger.warning("Sample question JSON decode failed, using fallback")

        updated = self.store.update_kb(replace(kb, sample_questions=questions, updated_at=now_iso()))
        if updated is None:
            raise KnowledgeBaseNotFoundError(kb_id)
        return {"questions": questions}

    def get_sample_questions(self, kb_id: str) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        return {"questions": list(kb.sample_questions)}

    # ── Graph ──────────────────────────────────────────────────────────────

    def get_graph_labels(self, kb_id: str) -> dict[str, Any]:
        self.require_kb(kb_id)
        if self.rag_engine is None:
            return {"labels": []}
        try:
            labels = self._run_async(self.rag_engine.get_graph_labels(kb_id))
        except Exception:
            logger.debug("Failed to fetch graph labels for kb_id={}", kb_id)
            return {"labels": []}
        return {"labels": labels}

    _EMPTY_GRAPH: dict[str, Any] = {"nodes": [], "edges": [], "labels": [], "is_truncated": False}

    def get_graph(self, kb_id: str, *, node_label: str = "*", max_depth: int = 2, max_nodes: int = 50) -> dict[str, Any]:
        self.require_kb(kb_id)
        if self.rag_engine is None:
            return dict(self._EMPTY_GRAPH)
        try:
            graph = self._run_async(
                self.rag_engine.get_knowledge_graph(
                    kb_id,
                    label=node_label or "*",
                    max_depth=max(1, int(max_depth)),
                    max_nodes=max(10, int(max_nodes)),
                )
            )
        except Exception:
            logger.debug("Failed to fetch knowledge graph for kb_id={}", kb_id)
            return dict(self._EMPTY_GRAPH)
        return graph

    def get_graph_stats(self, kb_id: str) -> dict[str, Any]:
        graph = self.get_graph(kb_id, node_label="*", max_depth=2, max_nodes=200)
        return {
            "node_count": len(graph.get("nodes") or []),
            "edge_count": len(graph.get("edges") or []),
            "labels": list(graph.get("labels") or []),
            "is_truncated": bool(graph.get("is_truncated")),
        }

    # ── Benchmarks ─────────────────────────────────────────────────────────

    def _load_benchmark_meta(self, kb_id: str, benchmark_id: str) -> dict[str, Any]:
        try:
            return self.artifacts.load_benchmark_meta(kb_id, benchmark_id)
        except ValueError as exc:
            raise KnowledgeBaseValidationError(str(exc)) from exc

    def _load_benchmark_questions(self, kb_id: str, benchmark_id: str) -> list[dict[str, Any]]:
        try:
            return self.artifacts.load_benchmark_questions(kb_id, benchmark_id)
        except ValueError as exc:
            raise KnowledgeBaseValidationError(str(exc)) from exc

    def list_benchmarks(self, kb_id: str) -> list[dict[str, Any]]:
        kb = self.require_kb(kb_id)
        self._ensure_evaluation_supported(kb)
        return self.artifacts.list_benchmark_metas(kb_id)

    def upload_benchmark(
        self,
        kb_id: str,
        *,
        file_content: bytes,
        filename: str,
        name: str,
        description: str,
        created_by: str | None = None,
    ) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        self._ensure_evaluation_supported(kb)
        if not filename.lower().endswith(".jsonl"):
            raise KnowledgeBaseValidationError("Benchmark upload only supports JSONL files.")
        try:
            content = file_content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise KnowledgeBaseValidationError("Benchmark file must be UTF-8 encoded JSONL.") from exc

        questions: list[dict[str, Any]] = []
        for line_no, line in enumerate(content.splitlines(), start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise KnowledgeBaseValidationError(f"Benchmark JSONL line {line_no} is invalid: {exc}") from exc
            if not isinstance(payload, dict) or not str(payload.get("query") or "").strip():
                raise KnowledgeBaseValidationError(f"Benchmark JSONL line {line_no} is missing the 'query' field.")
            questions.append(payload)
        if not questions:
            raise KnowledgeBaseValidationError("Benchmark file does not contain any valid questions.")

        benchmark_id = short_id("benchmark")
        return self.artifacts.save_benchmark(
            kb_id,
            benchmark_id,
            name=name.strip() or Path(filename).stem or benchmark_id,
            description=description.strip(),
            questions=questions,
            created_by=created_by,
        )

    def get_benchmark_detail(
        self,
        kb_id: str,
        benchmark_id: str,
        *,
        page: int = 1,
        page_size: int = 10,
    ) -> dict[str, Any]:
        meta = self._load_benchmark_meta(kb_id, benchmark_id)
        questions = self._load_benchmark_questions(kb_id, benchmark_id)
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 100))
        start = (page - 1) * page_size
        end = start + page_size
        total = len(questions)
        total_pages = max(1, math.ceil(total / page_size))
        return {
            **meta,
            "questions": questions[start:end],
            "pagination": {
                "currentPage": page,
                "current_page": page,
                "pageSize": page_size,
                "page_size": page_size,
                "totalQuestions": total,
                "total_questions": total,
                "totalPages": total_pages,
                "total_pages": total_pages,
                "hasNext": page < total_pages,
                "hasPrev": page > 1,
            },
        }

    def delete_benchmark(self, kb_id: str, benchmark_id: str) -> bool:
        self._load_benchmark_meta(kb_id, benchmark_id)
        self.artifacts.delete_benchmark(kb_id, benchmark_id)
        return True

    def get_benchmark_download_path(self, kb_id: str, benchmark_id: str) -> Path:
        self._load_benchmark_meta(kb_id, benchmark_id)
        path = self.artifacts.benchmark_data_path(kb_id, benchmark_id)
        if not path.exists():
            raise KnowledgeBaseValidationError("Benchmark file is missing from disk.")
        return path

    def generate_benchmark(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        self._ensure_evaluation_supported(kb)
        count = max(1, min(int(payload.get("count") or 10), 50))
        name = self._normalize_text(payload.get("name"), field_name="name") or "自动生成评估基准"
        description = self._normalize_text(payload.get("description"), field_name="description")
        entries = self.artifacts.load_chunk_entries(kb_id)
        if not entries:
            raise KnowledgeBaseValidationError("Generate benchmark requires indexed knowledge chunks.")

        selected_entries = entries[:min(len(entries), count)]
        questions: list[dict[str, Any]] = []
        for item in selected_entries:
            chunk_id = str(item.get("chunkId") or "")
            content = str(item.get("content") or "").strip()
            prompt = self._generate_with_llm(
                system_prompt=(
                    "你是 RAG 评测基准生成助手。请基于给定片段生成一个可由片段直接回答的问题。"
                    "只返回 JSON，格式为 {\"query\": string, \"gold_answer\": string}。"
                ),
                user_prompt=json.dumps(
                    {
                        "knowledgeBase": kb.name,
                        "chunk": {
                            "chunkId": chunk_id,
                            "file": item.get("filename"),
                            "content": content[:2000],
                        },
                    },
                    ensure_ascii=False,
                ),
            )
            query_text = ""
            gold_answer = ""
            json_text = self._extract_json_text(prompt or "")
            if json_text:
                try:
                    candidate = json.loads(json_text)
                    if isinstance(candidate, dict):
                        query_text = str(candidate.get("query") or "").strip()
                        gold_answer = str(candidate.get("gold_answer") or "").strip()
                except json.JSONDecodeError:
                    logger.warning("Benchmark generation JSON decode failed for {}", chunk_id)
            if not query_text:
                first_line = next((line.strip() for line in content.splitlines() if line.strip()), kb.name)
                query_text = f"请根据知识库内容解释：{first_line[:40]}"
            if not gold_answer:
                gold_answer = content[:400]
            questions.append(
                {
                    "query": query_text,
                    "gold_answer": gold_answer,
                    "gold_chunk_ids": [chunk_id] if chunk_id else [],
                }
            )
            if len(questions) >= count:
                break

        benchmark_id = short_id("benchmark")
        return self.artifacts.save_benchmark(
            kb_id,
            benchmark_id,
            name=name,
            description=description,
            questions=questions,
        )

    # ── Evaluation ─────────────────────────────────────────────────────────

    @staticmethod
    def _retrieval_metrics(retrieved_chunks: list[dict[str, Any]], gold_chunk_ids: list[str]) -> dict[str, float]:
        if not retrieved_chunks or not gold_chunk_ids:
            return {}
        retrieved_ids = [str(item.get("chunk_id") or item.get("chunkId") or "") for item in retrieved_chunks]
        relevant = {str(item) for item in gold_chunk_ids if str(item).strip()}
        if not relevant:
            return {}
        metrics: dict[str, float] = {}
        for k in (1, 3, 5, 10):
            top_k = retrieved_ids[:k]
            if not top_k:
                metrics[f"precision@{k}"] = 0.0
                metrics[f"recall@{k}"] = 0.0
                metrics[f"f1@{k}"] = 0.0
                continue
            hit_count = len(set(top_k) & relevant)
            precision = hit_count / k
            recall = hit_count / len(relevant)
            f1 = 0.0 if precision + recall == 0 else (2 * precision * recall / (precision + recall))
            metrics[f"precision@{k}"] = precision
            metrics[f"recall@{k}"] = recall
            metrics[f"f1@{k}"] = f1
        return metrics

    def _answer_metrics(self, query: str, generated_answer: str, gold_answer: str) -> dict[str, Any]:
        if not gold_answer.strip():
            return {}
        if not generated_answer.strip():
            return {"score": 0.0, "reasoning": "未生成答案"}

        llm_raw = self._generate_with_llm(
            system_prompt=(
                "你是 RAG 评测裁判。只返回 JSON，格式为 "
                "{\"score\": 0 或 1, \"reasoning\": string}。"
            ),
            user_prompt=json.dumps(
                {
                    "query": query,
                    "goldAnswer": gold_answer,
                    "generatedAnswer": generated_answer,
                },
                ensure_ascii=False,
            ),
        )
        json_text = self._extract_json_text(llm_raw or "")
        if json_text:
            try:
                payload = json.loads(json_text)
                if isinstance(payload, dict):
                    return {
                        "score": float(payload.get("score") or 0.0),
                        "reasoning": str(payload.get("reasoning") or "").strip(),
                    }
            except json.JSONDecodeError:
                logger.warning("Answer metric JSON decode failed, falling back to heuristic scoring")

        normalized_generated = normalize_eval_text(generated_answer)
        normalized_gold = normalize_eval_text(gold_answer)
        score = 1.0 if normalized_gold and normalized_gold in normalized_generated else 0.0
        return {
            "score": score,
            "reasoning": "使用启发式匹配完成评分",
        }

    def _load_evaluation_result(self, kb_id: str, task_id: str) -> dict[str, Any]:
        try:
            return self.artifacts.load_evaluation_result(kb_id, task_id)
        except ValueError as exc:
            raise KnowledgeBaseValidationError(str(exc)) from exc

    def _save_evaluation_result(self, kb_id: str, task_id: str, payload: dict[str, Any]) -> None:
        self.artifacts.save_evaluation_result(kb_id, task_id, payload)

    def run_evaluation(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        kb = self.require_kb(kb_id)
        self._ensure_evaluation_supported(kb)
        benchmark_id = self._normalize_text(
            payload.get("benchmarkId") or payload.get("benchmark_id"),
            required=True,
            field_name="benchmarkId",
        )
        self._load_benchmark_meta(kb_id, benchmark_id)
        task_id = short_id("eval")
        retrieval_config = {
            **kb.query_params.to_dict(),
            "only_need_context": False,
            "only_need_prompt": False,
        }
        result = {
            "taskId": task_id,
            "task_id": task_id,
            "kbId": kb_id,
            "dbId": kb_id,
            "benchmarkId": benchmark_id,
            "benchmark_id": benchmark_id,
            "status": "queued",
            "overallScore": None,
            "overall_score": None,
            "totalQuestions": 0,
            "total_questions": 0,
            "completedQuestions": 0,
            "completed_questions": 0,
            "retrievalConfig": retrieval_config,
            "retrieval_config": retrieval_config,
            "modelConfig": dict(payload.get("modelConfig") or payload.get("model_config") or {}),
            "model_config": dict(payload.get("modelConfig") or payload.get("model_config") or {}),
            "details": [],
            "metrics": {},
            "createdAt": now_iso(),
            "created_at": now_iso(),
            "updatedAt": now_iso(),
            "updated_at": now_iso(),
        }
        self._save_evaluation_result(kb_id, task_id, result)
        self._submit_background_job(self._run_evaluation_task, kb_id, task_id)
        return {"taskId": task_id, "task_id": task_id}

    def _run_evaluation_task(self, kb_id: str, task_id: str) -> None:
        result = self._load_evaluation_result(kb_id, task_id)
        benchmark_id = str(result.get("benchmarkId") or result.get("benchmark_id") or "")
        questions = self._load_benchmark_questions(kb_id, benchmark_id)
        result["status"] = "running"
        result["startedAt"] = now_iso()
        result["started_at"] = result["startedAt"]
        result["totalQuestions"] = len(questions)
        result["total_questions"] = len(questions)
        self._save_evaluation_result(kb_id, task_id, result)

        retrieval_metric_list: list[dict[str, float]] = []
        answer_metric_list: list[dict[str, Any]] = []
        detail_items: list[dict[str, Any]] = []

        try:
            retrieval_config = dict(result.get("retrievalConfig") or result.get("retrieval_config") or {})
            for index, question in enumerate(questions, start=1):
                query_text = str(question.get("query") or "").strip()
                gold_answer = str(question.get("gold_answer") or "").strip()
                gold_chunk_ids = [str(item) for item in question.get("gold_chunk_ids") or [] if str(item).strip()]

                query_result = self._query_database(
                    kb_id,
                    {
                        **retrieval_config,
                        "query": query_text,
                    },
                )
                chunks = list((query_result.get("data") or {}).get("chunks") or [])
                generated_answer = str(query_result.get("message") or "").strip()
                retrieval_metrics = self._retrieval_metrics(chunks, gold_chunk_ids)
                answer_metrics = self._answer_metrics(query_text, generated_answer, gold_answer) if gold_answer else {}

                retrieval_metric_list.append(retrieval_metrics)
                if answer_metrics:
                    answer_metric_list.append(answer_metrics)

                detail_items.append(
                    {
                        "rowId": f"{task_id}-{index}",
                        "row_id": f"{task_id}-{index}",
                        "query": query_text,
                        "goldAnswer": gold_answer,
                        "gold_answer": gold_answer,
                        "goldChunkIds": gold_chunk_ids,
                        "gold_chunk_ids": gold_chunk_ids,
                        "generatedAnswer": generated_answer,
                        "generated_answer": generated_answer,
                        "retrievedChunks": chunks,
                        "retrieved_chunks": chunks,
                        "metrics": {**retrieval_metrics, **answer_metrics},
                        "errorMessage": None,
                        "error_message": None,
                    }
                )
                result["details"] = detail_items
                result["completedQuestions"] = index
                result["completed_questions"] = index
                result["updatedAt"] = now_iso()
                result["updated_at"] = result["updatedAt"]
                self._save_evaluation_result(kb_id, task_id, result)

            aggregate_metrics: dict[str, float] = {}
            metric_keys = sorted({key for item in retrieval_metric_list for key in item.keys()})
            for key in metric_keys:
                values = [item[key] for item in retrieval_metric_list if key in item]
                if values:
                    aggregate_metrics[key] = sum(values) / len(values)
            if answer_metric_list:
                aggregate_metrics["answer_accuracy"] = sum(
                    float(item.get("score") or 0.0) for item in answer_metric_list
                ) / len(answer_metric_list)

            overall_components: list[float] = []
            for item in retrieval_metric_list:
                if item:
                    overall_components.append(sum(item.values()) / len(item))
            overall_components.extend(float(item.get("score") or 0.0) for item in answer_metric_list)
            overall_score = sum(overall_components) / len(overall_components) if overall_components else 0.0

            result["status"] = "completed"
            result["overallScore"] = overall_score
            result["overall_score"] = overall_score
            result["metrics"] = aggregate_metrics
            result["finishedAt"] = now_iso()
            result["finished_at"] = result["finishedAt"]
            result["updatedAt"] = result["finishedAt"]
            result["updated_at"] = result["finished_at"]
            self._save_evaluation_result(kb_id, task_id, result)
        except Exception as exc:
            logger.exception("Evaluation task {} failed", task_id)
            result["status"] = "failed"
            result["errorSummary"] = str(exc)
            result["error_summary"] = str(exc)
            result["finishedAt"] = now_iso()
            result["finished_at"] = result["finishedAt"]
            result["updatedAt"] = result["finishedAt"]
            result["updated_at"] = result["finished_at"]
            self._save_evaluation_result(kb_id, task_id, result)

    def get_evaluation_history(self, kb_id: str) -> list[dict[str, Any]]:
        kb = self.require_kb(kb_id)
        self._ensure_evaluation_supported(kb)
        return self.artifacts.list_evaluation_summaries(kb_id)

    def get_evaluation_result(
        self,
        kb_id: str,
        task_id: str,
        *,
        page: int = 1,
        page_size: int = 20,
        error_only: bool = False,
    ) -> dict[str, Any]:
        result = self._load_evaluation_result(kb_id, task_id)
        details = list(result.get("details") or [])
        if error_only:
            details = [
                item
                for item in details
                if str(item.get("errorMessage") or item.get("error_message") or "").strip()
                or float((item.get("metrics") or {}).get("score") or 1.0) < 1.0
                or float((item.get("metrics") or {}).get("recall@1") or 1.0) < 1.0
            ]
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 100))
        start = (page - 1) * page_size
        end = start + page_size
        total = len(details)
        total_pages = max(1, math.ceil(total / page_size))
        return {
            **{key: value for key, value in result.items() if key != "details"},
            "details": details[start:end],
            "pagination": {
                "currentPage": page,
                "current_page": page,
                "pageSize": page_size,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
                "hasNext": page < total_pages,
                "hasPrev": page > 1,
            },
        }

    def delete_evaluation_result(self, kb_id: str, task_id: str) -> bool:
        if not self.artifacts.delete_evaluation_result(kb_id, task_id):
            raise KnowledgeBaseValidationError("Evaluation result not found.")
        return True
