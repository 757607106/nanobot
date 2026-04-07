"""Chunking dispatcher — splits text into chunks based on preset and params.

Extracted from KnowledgeBaseService to be a standalone, stateless module.
"""

from __future__ import annotations

import re
from typing import Any

from nanobot.platform.knowledge.chunking.presets import resolve_chunk_params


class ChunkingError(Exception):
    """Raised when chunking produces no results."""


# ---------------------------------------------------------------------------
# Low-level splitters
# ---------------------------------------------------------------------------

def _split_large_block(text: str, *, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Split a single oversized block into fixed-window chunks."""
    if len(text) <= chunk_size:
        return [text]
    result: list[str] = []
    start = 0
    step = max(1, chunk_size - max(0, chunk_overlap))
    while start < len(text):
        result.append(text[start : start + chunk_size].strip())
        start += step
    return [item for item in result if item]


def chunk_plain_text(text: str, *, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Split text by double-newline paragraphs, respecting size limits."""
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
            chunks.extend(
                _split_large_block(paragraph, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
            )
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


def chunk_by_headings(text: str) -> list[str]:
    """Split text by heading lines (markdown headings or Chinese chapter markers)."""
    sections: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(
            r"^(#{1,6}\s+|chapter\s+\d+|section\s+\d+|第.+[章节篇])",
            stripped,
            re.IGNORECASE,
        ):
            if current:
                sections.append("\n".join(current).strip())
                current = []
        if stripped:
            current.append(line)
    if current:
        sections.append("\n".join(current).strip())
    return [item for item in sections if item]


def chunk_qa_text(text: str) -> list[str]:
    """Split text into Q&A pairs."""
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


def chunk_law_text(text: str) -> list[str]:
    """Split text by legal article numbers (第X条)."""
    parts = re.split(r"(?=第[\d一二三四五六七八九十百千]+条)", text)
    return [item.strip() for item in parts if item.strip()]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_chunks(
    text: str,
    *,
    kb_params: dict[str, Any] | None = None,
    file_params: dict[str, Any] | None = None,
    faq_items: list[dict[str, str]] | None = None,
) -> list[str]:
    """Split text into chunks using the appropriate strategy.

    This is the main entry point for chunking. It resolves parameters
    from KB-level and file-level settings, then dispatches to the
    correct splitter.

    Args:
        text: The parsed markdown/text content to chunk.
        kb_params: Knowledge base ``additional_params``.
        file_params: File-level ``processing_params``.
        faq_items: Optional structured FAQ items from file params.

    Returns:
        A list of chunk strings.

    Raises:
        ChunkingError: If no chunks are produced.
    """
    preset_id, chunk_size, chunk_overlap, qa_separator = resolve_chunk_params(
        kb_params, file_params,
    )

    chunks: list[str] = []

    # Priority 1: structured FAQ items
    if isinstance(faq_items, list) and faq_items:
        for item in faq_items:
            if not isinstance(item, dict):
                continue
            question = str(item.get("question") or "").strip()
            answer = str(item.get("answer") or "").strip()
            if question and answer:
                chunks.append(f"Q: {question}\nA: {answer}")

    # Priority 2: QA preset
    elif preset_id == "qa":
        chunks = chunk_qa_text(text)

    # Priority 3: explicit QA separator
    elif qa_separator and qa_separator in text:
        chunks = [item.strip() for item in text.split(qa_separator) if item.strip()]

    # Priority 4: book preset (heading-based)
    elif preset_id == "book":
        chunks = chunk_by_headings(text)

    # Priority 5: law preset (article-based)
    elif preset_id == "laws":
        chunks = chunk_law_text(text)

    # Default: plain text chunking
    else:
        chunks = chunk_plain_text(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    if not chunks:
        raise ChunkingError("No chunks were produced for the given content.")

    return chunks
