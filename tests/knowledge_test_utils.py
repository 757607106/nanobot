from __future__ import annotations

import re
from pathlib import Path

from nanobot.platform.knowledge.rag_engine import ParseResult, RetrievalHit


def _token_variants(token: str) -> set[str]:
    value = str(token or "").strip().lower()
    if not value:
        return set()
    variants = {value}
    for suffix in ("ing", "ers", "er", "ed", "es", "s"):
        if len(value) > len(suffix) + 2 and value.endswith(suffix):
            variants.add(value[: -len(suffix)])
    return variants


def _tokenize(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", str(text or "").lower())
    result: set[str] = set()
    for token in tokens:
        result.update(_token_variants(token))
    return result


class FakeRAGEngine:
    """Small in-memory test double that mimics the RAGEngine contract."""

    def __init__(self) -> None:
        self._docs: dict[str, dict[str, dict[str, str]]] = {}

    async def parse_and_index(
        self,
        kb_id: str,
        file_path: str,
        *,
        doc_id: str | None = None,
        output_dir: str | None = None,
        **kwargs,
    ) -> ParseResult:
        text = Path(file_path).read_text(encoding="utf-8", errors="ignore")
        result = await self.insert_text(kb_id, text, doc_id=doc_id, file_path=file_path)
        return ParseResult(
            success=result.success,
            parser_name="fake_rag_parser",
            error=result.error,
            metadata={
                **dict(result.metadata or {}),
                "output_dir": output_dir or "",
                "file_path": file_path,
            },
        )

    async def insert_text(
        self,
        kb_id: str,
        text: str,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> ParseResult:
        content = str(text or "").strip()
        if not content:
            return ParseResult(success=False, parser_name="text_insert", error="text is required.")

        stored_doc_id = str(doc_id or f"doc-{len(self._docs.get(kb_id, {})) + 1}")
        self._docs.setdefault(kb_id, {})[stored_doc_id] = {
            "content": content,
            "file_path": str(file_path or f"{kb_id}.txt"),
            "doc_id": stored_doc_id,
        }
        return ParseResult(
            success=True,
            parser_name="text_insert",
            metadata={
                "doc_id": stored_doc_id,
                "file_path": str(file_path or f"{kb_id}.txt"),
                "chunks_count": 1,
            },
        )

    async def query(
        self,
        kb_ids: list[str],
        query_text: str,
        *,
        mode: str = "hybrid",
        top_k: int = 8,
        vlm_enhanced: bool = False,
    ) -> list[RetrievalHit]:
        query_tokens = _tokenize(query_text)
        results: list[RetrievalHit] = []

        for kb_id in kb_ids:
            for document in self._docs.get(kb_id, {}).values():
                content = document["content"]
                content_tokens = _tokenize(content)
                overlap = len(query_tokens & content_tokens)
                if overlap == 0 and query_text.strip().lower() not in content.lower():
                    continue
                score = float(overlap or 1)
                results.append(
                    RetrievalHit(
                        content=content,
                        score=score,
                        source=kb_id,
                        metadata={
                            "mode": mode,
                            "kb_id": kb_id,
                            "file_path": document["file_path"],
                            "doc_id": document["doc_id"],
                            "vlm_enhanced": bool(vlm_enhanced),
                        },
                    )
                )

        results.sort(key=lambda item: item.score, reverse=True)
        return results[: max(1, int(top_k))]

    async def delete_document(self, kb_id: str, doc_id: str) -> bool:
        return self._docs.get(kb_id, {}).pop(doc_id, None) is not None

    async def delete_kb(self, kb_id: str) -> bool:
        self._docs.pop(kb_id, None)
        return True

    async def shutdown_async(self) -> None:
        return None
