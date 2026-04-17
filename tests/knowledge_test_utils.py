from __future__ import annotations

import re
from pathlib import Path

from nanobot.platform.knowledge.rag_engine import IndexResult


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
    """In-memory test double that mimics the RAGEngine contract.

    All indexing, querying, graph, and delete operations are handled in memory.
    """

    def __init__(self) -> None:
        # kb_id -> doc_id -> { content, file_path, doc_id, chunks }
        self._docs: dict[str, dict[str, dict[str, str | list[str]]]] = {}
        self.prepare_calls: list[tuple[str, str]] = []
        self.multimodal_queries: list[dict[str, object]] = []

    async def shutdown_async(self) -> None:
        return None

    async def health_check(self) -> bool:
        return True

    def set_kb_runtime_resolver(self, _resolver) -> None:
        return None

    # -- indexing (matches new RAGEngine.insert_text) -------------------------

    async def insert_text(
        self,
        kb_id: str,
        text: str,
        *,
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> IndexResult:
        content = str(text or "").strip()
        if not content:
            return IndexResult(success=False, doc_id=doc_id, error="text is required.")

        stored_doc_id = str(doc_id or f"doc-{len(self._docs.get(kb_id, {})) + 1}")
        self._docs.setdefault(kb_id, {})[stored_doc_id] = {
            "content": content,
            "file_path": str(file_path or f"{kb_id}.txt"),
            "doc_id": stored_doc_id,
            "chunks": [content],
        }
        return IndexResult(
            success=True,
            doc_id=stored_doc_id,
            track_id=f"track-{stored_doc_id}",
            chunks_count=1,
        )

    # -- querying (matches new RAGEngine.query_structured) --------------------

    async def query_structured(
        self,
        kb_id: str,
        query_text: str,
        *,
        mode: str = "mix",
        top_k: int = 8,
        chunk_top_k: int = 12,
        response_type: str = "Multiple Paragraphs",
        only_need_context: bool = False,
        only_need_prompt: bool = False,
        max_entity_tokens: int = 6000,
        max_relation_tokens: int = 8000,
        max_total_tokens: int = 30000,
        history_turns: int = 0,
        enable_rerank: bool = False,
        rerank_model: str | None = None,
        extra_query_params: dict | None = None,
    ) -> dict:
        del (
            chunk_top_k,
            response_type,
            only_need_context,
            only_need_prompt,
            max_entity_tokens,
            max_relation_tokens,
            max_total_tokens,
            history_turns,
            enable_rerank,
            rerank_model,
            extra_query_params,
        )
        query_tokens = _tokenize(query_text)
        results: list[dict] = []

        for document in self._docs.get(kb_id, {}).values():
            for index, content in enumerate(document.get("chunks") or [document["content"]], start=1):
                content_str = str(content)
                content_tokens = _tokenize(content_str)
                overlap = len(query_tokens & content_tokens)
                if overlap == 0 and query_text.strip().lower() not in content_str.lower():
                    continue
                reference_id = str(document["doc_id"])
                file_path_val = str(document["file_path"])
                results.append({
                    "chunk_id": f"{reference_id}::chunk::{index:04d}",
                    "content": content_str,
                    "score": float(overlap or 1),
                    "reference_id": reference_id,
                    "file_path": file_path_val,
                    "chunk_index": index,
                    "metadata": {},
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:max(1, int(top_k))]

        references = []
        seen_refs: set[str] = set()
        for chunk in results:
            ref_id = chunk["reference_id"]
            if ref_id not in seen_refs:
                seen_refs.add(ref_id)
                references.append({
                    "reference_id": ref_id,
                    "file_path": chunk["file_path"],
                })

        return {
            "data": {
                "chunks": results,
                "references": references,
            },
            "message": results[0]["content"] if results else "",
        }

    async def query_multimodal(
        self,
        kb_id: str,
        query_text: str,
        *,
        multimodal_content: list[dict],
        mode: str = "mix",
        top_k: int = 8,
        chunk_top_k: int = 12,
        response_type: str = "Multiple Paragraphs",
        only_need_context: bool = False,
        only_need_prompt: bool = False,
        max_entity_tokens: int = 6000,
        max_relation_tokens: int = 8000,
        max_total_tokens: int = 30000,
        history_turns: int = 0,
        enable_rerank: bool = False,
        rerank_model: str | None = None,
        extra_query_params: dict | None = None,
    ) -> str:
        del (
            top_k,
            chunk_top_k,
            response_type,
            only_need_context,
            only_need_prompt,
            max_entity_tokens,
            max_relation_tokens,
            max_total_tokens,
            history_turns,
            enable_rerank,
            rerank_model,
            extra_query_params,
        )
        self.multimodal_queries.append(
            {
                "kb_id": kb_id,
                "query_text": query_text,
                "mode": mode,
                "multimodal_content": list(multimodal_content or []),
            }
        )
        content_types = ", ".join(
            str(item.get("type") or "unknown")
            for item in (multimodal_content or [])
            if isinstance(item, dict)
        ) or "unknown"
        return f"multimodal[{content_types}] {query_text}"

    # -- knowledge graph (matches new RAGEngine) ------------------------------

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
            nodes.append({
                "id": node_id,
                "label": "Document",
                "description": Path(str(item["file_path"])).name,
                "properties": {},
            })
            if index > 1:
                edges.append({
                    "source": str(documents[index - 2]["doc_id"]),
                    "target": node_id,
                    "label": "RELATED",
                    "weight": 1.0,
                    "properties": {},
                })
        return {
            "nodes": nodes,
            "edges": edges,
            "labels": ["Document"] if nodes else [],
            "is_truncated": False,
        }

    # -- document management --------------------------------------------------

    async def delete_document(self, kb_id: str, doc_id: str) -> bool:
        return self._docs.get(kb_id, {}).pop(doc_id, None) is not None

    async def delete_kb(self, kb_id: str) -> bool:
        self._docs.pop(kb_id, None)
        return True

    async def reset_kb(self, kb_id: str) -> bool:
        self._docs.pop(kb_id, None)
        return True
