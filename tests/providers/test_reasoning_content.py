"""Tests for reasoning_content extraction in OpenAICompatProvider.

Covers non-streaming (_parse) and streaming (_parse_chunks) paths for
providers that return a reasoning_content field (e.g. MiMo, DeepSeek-R1),
as well as the fallback path where reasoning is embedded inside content
via <think>...</think> tags (e.g. DashScope qwen3-max).
"""

from types import SimpleNamespace
from unittest.mock import patch

from nanobot.providers.openai_compat_provider import OpenAICompatProvider

# ── _parse: non-streaming ─────────────────────────────────────────────────


def test_parse_dict_extracts_reasoning_content() -> None:
    """reasoning_content at message level is surfaced in LLMResponse."""
    with patch("nanobot.providers.openai_compat_provider.AsyncOpenAI"):
        provider = OpenAICompatProvider()

    response = {
        "choices": [{
            "message": {
                "content": "42",
                "reasoning_content": "Let me think step by step…",
            },
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 5, "completion_tokens": 10, "total_tokens": 15},
    }

    result = provider._parse(response)

    assert result.content == "42"
    assert result.reasoning_content == "Let me think step by step…"


def test_parse_dict_reasoning_content_none_when_absent() -> None:
    """reasoning_content is None when the response doesn't include it."""
    with patch("nanobot.providers.openai_compat_provider.AsyncOpenAI"):
        provider = OpenAICompatProvider()

    response = {
        "choices": [{
            "message": {"content": "hello"},
            "finish_reason": "stop",
        }],
    }

    result = provider._parse(response)

    assert result.reasoning_content is None


# ── _parse_chunks: streaming dict branch ─────────────────────────────────


def test_parse_chunks_dict_accumulates_reasoning_content() -> None:
    """reasoning_content deltas in dict chunks are joined into one string."""
    chunks = [
        {
            "choices": [{
                "finish_reason": None,
                "delta": {"content": None, "reasoning_content": "Step 1. "},
            }],
        },
        {
            "choices": [{
                "finish_reason": None,
                "delta": {"content": None, "reasoning_content": "Step 2."},
            }],
        },
        {
            "choices": [{
                "finish_reason": "stop",
                "delta": {"content": "answer"},
            }],
        },
    ]

    result = OpenAICompatProvider._parse_chunks(chunks)

    assert result.content == "answer"
    assert result.reasoning_content == "Step 1. Step 2."


def test_parse_chunks_dict_reasoning_content_none_when_absent() -> None:
    """reasoning_content is None when no chunk contains it."""
    chunks = [
        {"choices": [{"finish_reason": "stop", "delta": {"content": "hi"}}]},
    ]

    result = OpenAICompatProvider._parse_chunks(chunks)

    assert result.content == "hi"
    assert result.reasoning_content is None


# ── _parse_chunks: streaming SDK-object branch ────────────────────────────


def _make_reasoning_chunk(reasoning: str | None, content: str | None, finish: str | None):
    delta = SimpleNamespace(content=content, reasoning_content=reasoning, tool_calls=None)
    choice = SimpleNamespace(finish_reason=finish, delta=delta)
    return SimpleNamespace(choices=[choice], usage=None)


def test_parse_chunks_sdk_accumulates_reasoning_content() -> None:
    """reasoning_content on SDK delta objects is joined across chunks."""
    chunks = [
        _make_reasoning_chunk("Think… ", None, None),
        _make_reasoning_chunk("Done.", None, None),
        _make_reasoning_chunk(None, "result", "stop"),
    ]

    result = OpenAICompatProvider._parse_chunks(chunks)

    assert result.content == "result"
    assert result.reasoning_content == "Think… Done."


def test_parse_chunks_sdk_reasoning_content_none_when_absent() -> None:
    """reasoning_content is None when SDK deltas carry no reasoning_content."""
    chunks = [_make_reasoning_chunk(None, "hello", "stop")]

    result = OpenAICompatProvider._parse_chunks(chunks)

    assert result.reasoning_content is None


# ── Fallback: reasoning embedded in content via <think>...</think> ───────

# Some providers (e.g. DashScope qwen3-max) embed thinking inside the
# ``content`` field using <think>...</think> tags instead of the standard
# ``reasoning_content`` field.  The tags below use the same format as
# nanobot.utils.helpers (strip_think / extract_think).

_T = "<think>"       # opening think tag
_TC = "</think>"     # closing think tag


def test_parse_dict_fallback_extracts_thinking_from_content() -> None:
    """When reasoning_content is absent but content has <think> tags, extract them."""
    with patch("nanobot.providers.openai_compat_provider.AsyncOpenAI"):
        provider = OpenAICompatProvider()

    response = {
        "choices": [{
            "message": {
                "content": f"{_T}Let me reason{_TC}\nThe answer is 42",
                "reasoning_content": None,
            },
            "finish_reason": "stop",
        }],
    }

    result = provider._parse(response)

    assert result.content == "The answer is 42"
    assert result.reasoning_content == "Let me reason"


def test_parse_dict_skips_fallback_when_reasoning_content_present() -> None:
    """When reasoning_content field is already populated, don't double-extract."""
    with patch("nanobot.providers.openai_compat_provider.AsyncOpenAI"):
        provider = OpenAICompatProvider()

    response = {
        "choices": [{
            "message": {
                "content": f"{_T}Let me reason{_TC}\nThe answer is 42",
                "reasoning_content": "Already extracted",
            },
            "finish_reason": "stop",
        }],
    }

    result = provider._parse(response)

    # Content keeps the <think> tags because extraction was skipped
    assert "Let me reason" in result.content
    # reasoning_content uses the standard field value
    assert result.reasoning_content == "Already extracted"


def test_parse_chunks_dict_fallback_extracts_thinking_from_content() -> None:
    """Streaming: when reasoning_content is empty but content has <think> tags."""
    chunks = [
        {
            "choices": [{
                "finish_reason": None,
                "delta": {"content": f"{_T}Step 1. ", "reasoning_content": None},
            }],
        },
        {
            "choices": [{
                "finish_reason": "stop",
                "delta": {"content": f"Step 2.{_TC}The answer", "reasoning_content": None},
            }],
        },
    ]

    result = OpenAICompatProvider._parse_chunks(chunks)

    assert result.content == "The answer"
    assert result.reasoning_content == "Step 1. Step 2."


def test_parse_chunks_sdk_fallback_extracts_thinking_from_content() -> None:
    """Streaming SDK path: thinking embedded in content via <think> tags."""
    chunks = [
        SimpleNamespace(
            choices=[SimpleNamespace(
                finish_reason=None,
                delta=SimpleNamespace(content=f"{_T}Thinking...", reasoning_content=None, tool_calls=None),
            )],
            usage=None,
        ),
        SimpleNamespace(
            choices=[SimpleNamespace(
                finish_reason="stop",
                delta=SimpleNamespace(content=f"Done reasoning{_TC}The result", reasoning_content=None, tool_calls=None),
            )],
            usage=None,
        ),
    ]

    result = OpenAICompatProvider._parse_chunks(chunks)

    assert result.content == "The result"
    assert "Thinking..." in result.reasoning_content
    assert "Done reasoning" in result.reasoning_content


def test_parse_chunks_skips_fallback_when_reasoning_content_present() -> None:
    """Streaming: don't double-extract when reasoning_content field is populated."""
    chunks = [
        {
            "choices": [{
                "finish_reason": None,
                "delta": {"content": None, "reasoning_content": "Standard reasoning"},
            }],
        },
        {
            "choices": [{
                "finish_reason": "stop",
                "delta": {"content": "The answer", "reasoning_content": None},
            }],
        },
    ]

    result = OpenAICompatProvider._parse_chunks(chunks)

    assert result.content == "The answer"
    assert result.reasoning_content == "Standard reasoning"


# ── separate_reasoning_from_content unit tests ─────────────────────────────


from nanobot.utils.helpers import separate_reasoning_from_content


def test_separate_reasoning_from_content_extracts_tags() -> None:
    """Extract <think>...</think> blocks from content when no existing reasoning."""
    clean, reasoning = separate_reasoning_from_content(f"{_T}Let me think{_TC}The answer")
    assert clean == "The answer"
    assert reasoning == "Let me think"


def test_separate_reasoning_from_content_skips_when_existing() -> None:
    """Skip extraction when existing_reasoning is already provided."""
    clean, reasoning = separate_reasoning_from_content(
        f"{_T}Let me think{_TC}The answer",
        existing_reasoning="Already here",
    )
    assert "Let me think" in clean  # Content not cleaned
    assert reasoning == "Already here"


def test_separate_reasoning_from_content_no_tags() -> None:
    """Return content as-is when no <think> tags found."""
    clean, reasoning = separate_reasoning_from_content("Plain content")
    assert clean == "Plain content"
    assert reasoning is None


def test_separate_reasoning_from_content_empty() -> None:
    """Handle empty/None content gracefully."""
    assert separate_reasoning_from_content(None) == (None, None)
    assert separate_reasoning_from_content("") == (None, None)
