"""Persistence helpers for knowledge chunk manifests and evaluation artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any, Callable

from loguru import logger

from nanobot.platform.knowledge.models import KnowledgeFile, now_iso
from nanobot.utils.helpers import ensure_dir


class KnowledgeArtifactStore:
    """File-backed persistence for chunk manifests, benchmarks, and evaluation results."""

    def __init__(
        self,
        *,
        vector_dir_factory: Callable[[str], Path],
        evaluation_dir_factory: Callable[[str], Path],
    ) -> None:
        self._vector_dir_factory = vector_dir_factory
        self._evaluation_dir_factory = evaluation_dir_factory
        self._chunk_lock = Lock()
        self._evaluation_lock = Lock()

    @staticmethod
    def _atomic_write_json(path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(f"{path.suffix}.tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(path)

    @staticmethod
    def _read_json(path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("Failed to decode JSON file {}, falling back to default", path)
            return default

    def _chunk_manifest_path(self, kb_id: str) -> Path:
        return ensure_dir(self._vector_dir_factory(kb_id)) / "chunk-manifest.json"

    def _benchmarks_dir(self, kb_id: str) -> Path:
        return ensure_dir(self._evaluation_dir_factory(kb_id) / "benchmarks")

    def _results_dir(self, kb_id: str) -> Path:
        return ensure_dir(self._evaluation_dir_factory(kb_id) / "results")

    def load_chunk_entries(self, kb_id: str) -> list[dict[str, Any]]:
        payload = self._read_json(self._chunk_manifest_path(kb_id), [])
        if not isinstance(payload, list):
            return []
        return [dict(item) for item in payload if isinstance(item, dict)]

    def replace_chunk_entries_for_file(self, kb_id: str, file_id: str, entries: list[dict[str, Any]]) -> None:
        with self._chunk_lock:
            current = self.load_chunk_entries(kb_id)
            remaining = [
                dict(item)
                for item in current
                if str(item.get("fileId") or "") != file_id
            ]
            self._atomic_write_json(self._chunk_manifest_path(kb_id), [*remaining, *entries])

    def remove_chunk_entries_for_file(self, kb_id: str, file_id: str) -> None:
        with self._chunk_lock:
            current = self.load_chunk_entries(kb_id)
            remaining = [
                dict(item)
                for item in current
                if str(item.get("fileId") or "") != file_id
            ]
            self._atomic_write_json(self._chunk_manifest_path(kb_id), remaining)

    @staticmethod
    def build_chunk_manifest_entries(file: KnowledgeFile, chunk_texts: list[str]) -> list[dict[str, Any]]:
        created_at = now_iso()
        return [
            {
                "chunkId": f"{file.file_id}::chunk::{index:04d}",
                "fileId": file.file_id,
                "filename": file.filename,
                "path": file.path,
                "filePath": file.raw_path or file.filename,
                "chunkIndex": index,
                "content": chunk_text,
                "createdAt": created_at,
            }
            for index, chunk_text in enumerate(chunk_texts, start=1)
        ]

    def benchmark_data_path(self, kb_id: str, benchmark_id: str) -> Path:
        return self._benchmarks_dir(kb_id) / f"{benchmark_id}.jsonl"

    def benchmark_meta_path(self, kb_id: str, benchmark_id: str) -> Path:
        return self._benchmarks_dir(kb_id) / f"{benchmark_id}.meta.json"

    def evaluation_result_path(self, kb_id: str, task_id: str) -> Path:
        return self._results_dir(kb_id) / f"{task_id}.json"

    def save_benchmark(
        self,
        kb_id: str,
        benchmark_id: str,
        *,
        name: str,
        description: str,
        questions: list[dict[str, Any]],
        created_by: str | None = None,
    ) -> dict[str, Any]:
        now = now_iso()
        data_path = self.benchmark_data_path(kb_id, benchmark_id)
        data_path.parent.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps(item, ensure_ascii=False) for item in questions]
        data_path.write_text("\n".join(lines), encoding="utf-8")
        meta = {
            "id": benchmark_id,
            "benchmarkId": benchmark_id,
            "benchmark_id": benchmark_id,
            "dbId": kb_id,
            "db_id": kb_id,
            "name": name,
            "description": description,
            "questionCount": len(questions),
            "question_count": len(questions),
            "hasGoldChunks": any(bool(item.get("gold_chunk_ids")) for item in questions),
            "has_gold_chunks": any(bool(item.get("gold_chunk_ids")) for item in questions),
            "hasGoldAnswers": any(bool(item.get("gold_answer")) for item in questions),
            "has_gold_answers": any(bool(item.get("gold_answer")) for item in questions),
            "benchmarkFile": str(data_path),
            "benchmark_file": str(data_path),
            "createdBy": created_by,
            "created_by": created_by,
            "createdAt": now,
            "created_at": now,
            "updatedAt": now,
            "updated_at": now,
        }
        with self._evaluation_lock:
            self._atomic_write_json(self.benchmark_meta_path(kb_id, benchmark_id), meta)
        return meta

    def load_benchmark_meta(self, kb_id: str, benchmark_id: str) -> dict[str, Any]:
        meta = self._read_json(self.benchmark_meta_path(kb_id, benchmark_id), {})
        if not isinstance(meta, dict) or not meta:
            raise ValueError("Benchmark not found.")
        return meta

    def load_benchmark_questions(self, kb_id: str, benchmark_id: str) -> list[dict[str, Any]]:
        path = self.benchmark_data_path(kb_id, benchmark_id)
        if not path.exists():
            raise ValueError("Benchmark file is missing.")
        questions: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            item = json.loads(stripped)
            if isinstance(item, dict):
                questions.append(item)
        return questions

    def list_benchmark_metas(self, kb_id: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for path in sorted(self._benchmarks_dir(kb_id).glob("*.meta.json"), reverse=True):
            meta = self._read_json(path, {})
            if isinstance(meta, dict) and meta:
                result.append(meta)
        result.sort(key=lambda item: str(item.get("updatedAt") or item.get("updated_at") or ""), reverse=True)
        return result

    def delete_benchmark(self, kb_id: str, benchmark_id: str) -> None:
        for path in (
            self.benchmark_data_path(kb_id, benchmark_id),
            self.benchmark_meta_path(kb_id, benchmark_id),
        ):
            if path.exists():
                path.unlink()

    def load_evaluation_result(self, kb_id: str, task_id: str) -> dict[str, Any]:
        payload = self._read_json(self.evaluation_result_path(kb_id, task_id), {})
        if not isinstance(payload, dict) or not payload:
            raise ValueError("Evaluation result not found.")
        return payload

    def save_evaluation_result(self, kb_id: str, task_id: str, payload: dict[str, Any]) -> None:
        with self._evaluation_lock:
            self._atomic_write_json(self.evaluation_result_path(kb_id, task_id), payload)

    def list_evaluation_summaries(self, kb_id: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for path in sorted(self._results_dir(kb_id).glob("*.json"), reverse=True):
            payload = self._read_json(path, {})
            if isinstance(payload, dict) and payload:
                result.append({key: value for key, value in payload.items() if key != "details"})
        result.sort(key=lambda item: str(item.get("updatedAt") or item.get("updated_at") or ""), reverse=True)
        return result

    def delete_evaluation_result(self, kb_id: str, task_id: str) -> bool:
        path = self.evaluation_result_path(kb_id, task_id)
        if not path.exists():
            return False
        path.unlink()
        return True
