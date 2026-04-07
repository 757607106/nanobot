"""Chunk presets — default configurations for different document types."""

from __future__ import annotations

DEFAULT_CHUNK_SIZE = 500
DEFAULT_CHUNK_OVERLAP = 80

# Preset registry: preset_id -> (label, defaults)
CHUNK_PRESETS: dict[str, dict] = {
    "general": {
        "label": "通用",
        "chunk_size": DEFAULT_CHUNK_SIZE,
        "chunk_overlap": DEFAULT_CHUNK_OVERLAP,
    },
    "book": {
        "label": "书籍",
        "chunk_size": 1000,
        "chunk_overlap": 100,
    },
    "qa": {
        "label": "问答对",
        "chunk_size": 0,  # Not used — split by Q/A pattern
        "chunk_overlap": 0,
    },
    "laws": {
        "label": "法律法规",
        "chunk_size": 0,  # Not used — split by article number
        "chunk_overlap": 0,
    },
}


def resolve_chunk_params(
    kb_params: dict | None = None,
    file_params: dict | None = None,
) -> tuple[str, int, int, str]:
    """Resolve effective chunking parameters from KB + file-level overrides.

    Returns:
        (preset_id, chunk_size, chunk_overlap, qa_separator)
    """
    params = {**(kb_params or {}), **(file_params or {})}
    preset_id = str(
        params.get("chunk_preset_id")
        or params.get("chunkPresetId")
        or "general"
    ).strip().lower()
    chunk_size = max(
        200,
        int(
            params.get("chunk_size")
            or params.get("chunkSize")
            or DEFAULT_CHUNK_SIZE
        ),
    )
    chunk_overlap = max(
        0,
        int(
            params.get("chunk_overlap")
            or params.get("chunkOverlap")
            or DEFAULT_CHUNK_OVERLAP
        ),
    )
    qa_separator = str(
        params.get("qa_separator") or params.get("qaSeparator") or ""
    ).strip()
    return preset_id, chunk_size, chunk_overlap, qa_separator
