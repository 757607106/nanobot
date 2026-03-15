"""Local, dependency-light retrieval scoring helpers.

These helpers intentionally avoid external vector dependencies. They provide
deterministic keyword / semantic-like / hybrid scoring so the first platform
version can expose multiple retrieval modes with predictable behavior.
"""

from __future__ import annotations

import re
from typing import Iterable

_TERM_PATTERN = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)
_SUPPORTED_MODES = {"keyword", "semantic", "hybrid"}


def normalize_mode(value: str | None, *, default: str = "keyword") -> str:
    normalized = str(value or "").strip().lower()
    if normalized in _SUPPORTED_MODES:
        return normalized
    return default


def normalize_query_tokens(value: str) -> list[str]:
    terms = _TERM_PATTERN.findall(str(value or "").lower())
    unique_terms: list[str] = []
    seen: set[str] = set()
    for term in terms:
        if term in seen:
            continue
        seen.add(term)
        unique_terms.append(term)
    return unique_terms


def build_preview(content: str, query_tokens: Iterable[str], *, width: int = 220) -> str:
    text = " ".join(str(content or "").split())
    if not text:
        return ""
    lowered = text.lower()
    tokens = list(query_tokens)
    first_hit = min((lowered.find(token) for token in tokens if token and token in lowered), default=-1)
    if first_hit < 0:
        return text[:width]
    start = max(0, first_hit - width // 3)
    end = min(len(text), start + width)
    return text[start:end]


def keyword_score(content: str, query_tokens: Iterable[str]) -> float:
    lowered = str(content or "").lower()
    tokens = [token for token in query_tokens if token]
    if not lowered.strip() or not tokens:
        return 0.0
    exact_hits = sum(lowered.count(token) for token in tokens)
    if exact_hits <= 0:
        return 0.0
    matched = sum(1 for token in tokens if token in lowered)
    coverage = matched / max(len(tokens), 1)
    density = min(1.0, exact_hits / max(len(tokens) * 2, 1))
    return round((coverage * 0.7) + (density * 0.3), 6)


def semantic_score(query: str, content: str, *, query_tokens: Iterable[str] | None = None) -> float:
    normalized_query = " ".join(str(query or "").lower().split())
    lowered = " ".join(str(content or "").lower().split())
    tokens = list(query_tokens or normalize_query_tokens(normalized_query))
    if not normalized_query or not lowered or not tokens:
        return 0.0

    text_tokens = normalize_query_tokens(lowered[:6000])
    text_token_set = set(text_tokens)
    token_match_scores: list[float] = []
    for token in tokens:
        if token in text_token_set or token in lowered:
            token_match_scores.append(1.0)
            continue
        best = 0.0
        for candidate in text_tokens:
            if not candidate:
                continue
            if candidate.startswith(token) or token.startswith(candidate):
                best = max(best, 0.86)
            elif len(token) >= 5 and len(candidate) >= 5:
                shorter, longer = sorted((token, candidate), key=len)
                if shorter in longer:
                    best = max(best, 0.72)
                elif _common_prefix_length(token, candidate) >= 4:
                    best = max(best, 0.62)
            if best >= 0.86:
                break
        token_match_scores.append(best)

    coverage_score = sum(token_match_scores) / max(len(token_match_scores), 1)
    char_score = _jaccard(_char_ngrams(normalized_query), _char_ngrams(lowered[:2400]))
    phrase_bonus = 1.0 if normalized_query in lowered else 0.0
    return round(min(1.0, coverage_score * 0.72 + char_score * 0.22 + phrase_bonus * 0.06), 6)


def retrieval_score(mode: str, query: str, content: str, *, query_tokens: Iterable[str] | None = None) -> float:
    normalized_mode = normalize_mode(mode, default="keyword")
    tokens = list(query_tokens or normalize_query_tokens(query))
    lexical = keyword_score(content, tokens)
    if normalized_mode == "keyword":
        return lexical
    semantic = semantic_score(query, content, query_tokens=tokens)
    if normalized_mode == "semantic":
        return semantic
    return round((lexical * 0.55) + (semantic * 0.45), 6)


def score_threshold(mode: str) -> float:
    normalized_mode = normalize_mode(mode, default="keyword")
    if normalized_mode == "semantic":
        return 0.12
    if normalized_mode == "hybrid":
        return 0.08
    return 0.0


def _common_prefix_length(left: str, right: str) -> int:
    limit = min(len(left), len(right))
    count = 0
    while count < limit and left[count] == right[count]:
        count += 1
    return count


def _char_ngrams(value: str, *, n: int = 3) -> set[str]:
    normalized = "".join(str(value or "").lower().split())
    if len(normalized) < n:
        return {normalized} if normalized else set()
    return {normalized[index : index + n] for index in range(len(normalized) - n + 1)}


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    union = left | right
    if not union:
        return 0.0
    return len(left & right) / len(union)
