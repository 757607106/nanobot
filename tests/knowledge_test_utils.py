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
        self.prepare_calls: list[tuple[str, str]] = []

    async def shutdown_async(self) -> None:
        return None

    async def reset_kb(self, kb_id: str) -> None:
        self._docs.pop(kb_id, None)

    async def delete_kb(self, kb_id: str) -> None:
        self._docs.pop(kb_id, None)

    async def delete_document(self, kb_id: str, doc_id: str) -> None:
        if kb_id in self._docs:
            self._docs[kb_id].pop(doc_id, None)

    async def prepare_document_ingest(self, kb_id: str, doc_id: str) -> None:
        self.prepare_calls.append((kb_id, doc_id))

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
            "chunks": [content],
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

    async def insert_chunks(
        self,
        kb_id: str,
        chunks: list[str],
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> ParseResult:
        normalized_chunks = [str(item or "").strip() for item in chunks if str(item or "").strip()]
        if not normalized_chunks:
            return ParseResult(success=False, parser_name="chunk_insert", error="chunks are required.")

        stored_doc_id = str(doc_id or f"doc-{len(self._docs.get(kb_id, {})) + 1}")
        self._docs.setdefault(kb_id, {})[stored_doc_id] = {
            "content": "\n\n".join(normalized_chunks),
            "file_path": str(file_path or f"{kb_id}.txt"),
            "doc_id": stored_doc_id,
            "chunks": list(normalized_chunks),
        }
        return ParseResult(
            success=True,
            parser_name="chunk_insert",
            metadata={
                "doc_id": stored_doc_id,
                "file_path": str(file_path or f"{kb_id}.txt"),
                "chunks_count": len(normalized_chunks),
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
                for index, content in enumerate(document.get("chunks") or [document["content"]], start=1):
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
                                "chunk_id": f"{document['doc_id']}::chunk::{index:04d}",
                                "chunk_index": index,
                                "vlm_enhanced": bool(vlm_enhanced),
                            },
                        )
                    )

        results.sort(key=lambda item: item.score, reverse=True)
        return results[: max(1, int(top_k))]

    async def query_structured(
        self,
        kb_id: str,
        query_text: str,
        *,
        mode: str = "hybrid",
        top_k: int = 8,
        chunk_top_k: int = 12,
        response_type: str = "Multiple Paragraphs",
        only_need_context: bool = False,
        only_need_prompt: bool = False,
        enable_rerank: bool = False,
    ) -> dict:
        del chunk_top_k, response_type, only_need_context, only_need_prompt, enable_rerank
        hits = await self.query([kb_id], query_text, mode=mode, top_k=top_k)
        chunks = []
        references = []
        for index, hit in enumerate(hits, start=1):
            reference_id = str(hit.metadata.get("doc_id") or f"ref-{index}")
            file_path = str(hit.metadata.get("file_path") or "")
            references.append(
                {
                    "reference_id": reference_id,
                    "file_path": file_path,
                }
            )
            chunks.append(
                {
                    "chunk_id": str(hit.metadata.get("chunk_id") or f"{reference_id}::chunk::{index:04d}"),
                    "content": hit.content,
                    "reference_id": reference_id,
                    "file_path": file_path,
                    "chunk_index": hit.metadata.get("chunk_index"),
                }
            )
        return {
            "status": "success",
            "message": hits[0].content if hits else None,
            "data": {
                "entities": [],
                "relationships": [],
                "chunks": chunks,
                "references": references,
            },
            "metadata": {
                "mode": mode,
                "kbType": "lightrag",
            },
        }

    async def get_graph_labels(self, kb_id: str) -> list[str]:
        if not self._docs.get(kb_id):
            return []
        return ["Document"]

    async def get_knowledge_graph(
        self,
        kb_id: str,
        *,
        label: str = "*",
        max_depth: int = 2,
        max_nodes: int = 50,
    ) -> dict:
        del label, max_depth
        documents = list(self._docs.get(kb_id, {}).values())[: max(1, int(max_nodes))]
        nodes = []
        edges = []
        for index, item in enumerate(documents, start=1):
            node_id = str(item["doc_id"])
            nodes.append(
                {
                    "id": node_id,
                    "labels": ["Document"],
                    "properties": {
                        "name": Path(str(item["file_path"])).name,
                    },
                    "title": Path(str(item["file_path"])).name,
                }
            )
            if index > 1:
                edges.append(
                    {
                        "id": f"edge-{index - 1}-{index}",
                        "type": "RELATED",
                        "source": str(documents[index - 2]["doc_id"]),
                        "target": node_id,
                        "properties": {},
                    }
                )
        return {
            "nodes": nodes,
            "edges": edges,
            "labels": ["Document"] if nodes else [],
            "isTruncated": False,
        }

    async def delete_document(self, kb_id: str, doc_id: str) -> bool:
        return self._docs.get(kb_id, {}).pop(doc_id, None) is not None

    async def prepare_document_ingest(self, kb_id: str, doc_id: str) -> dict[str, list[str]]:
        self.prepare_calls.append((kb_id, doc_id))
        await self.delete_document(kb_id, doc_id)
        return {
            "deletedDocIds": [doc_id],
            "prunedDocIds": [],
        }

    async def delete_kb(self, kb_id: str) -> bool:
        self._docs.pop(kb_id, None)
        return True

    async def shutdown_async(self) -> None:
        return None
