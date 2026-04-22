"""Final-response validation for tool-based agent turns."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from loguru import logger

from nanobot.utils.helpers import stringify_text_blocks, truncate_text
from nanobot.utils.prompt_templates import render_template

if TYPE_CHECKING:
    from nanobot.providers.base import LLMProvider

_MAX_TRANSCRIPT_CHARS = 16_000
_MAX_RESULT_CHARS = 4_000
_FALLBACK_RETRY_MESSAGE = (
    "Use the exact tool results already in the conversation. Correct any mismatched values, "
    "and call more tools only if the current evidence is insufficient."
)
_VALIDATE_FINAL_RESPONSE_TOOL = [
    {
        "type": "function",
        "function": {
            "name": "validate_final_response",
            "description": (
                "Decide whether the candidate final answer is fully supported by the tool transcript "
                "and satisfies the task."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "accepted": {
                        "type": "boolean",
                        "description": "true only when the candidate answer is grounded in the tool transcript and satisfies the task.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Short explanation of the decision.",
                    },
                    "retry_message": {
                        "type": "string",
                        "description": (
                            "When accepted is false, give one short corrective instruction for the agent. "
                            "Reference exact tool evidence when possible."
                        ),
                    },
                },
                "required": ["accepted"],
            },
        },
    }
]


@dataclass(slots=True, frozen=True)
class FinalResponseValidationResult:
    """Decision returned by the final-response validator."""

    accepted: bool
    reason: str = ""
    retry_message: str | None = None


def _stringify_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        blocks = stringify_text_blocks(content)
        return blocks if blocks is not None else json.dumps(content, ensure_ascii=False)
    if content is None:
        return ""
    return str(content)


def _render_tool_transcript(tool_messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in tool_messages:
        role = str(message.get("role") or "")
        if role == "assistant":
            tool_calls = message.get("tool_calls") or []
            if not isinstance(tool_calls, list):
                continue
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                function = call.get("function") or {}
                name = str(function.get("name") or call.get("name") or "tool").strip() or "tool"
                arguments = function.get("arguments")
                if not isinstance(arguments, str):
                    arguments = json.dumps(arguments or {}, ensure_ascii=False)
                parts.append(f"Assistant called {name}({arguments})")
            continue
        if role != "tool":
            continue
        name = str(message.get("name") or "tool").strip() or "tool"
        content = truncate_text(_stringify_content(message.get("content")), _MAX_RESULT_CHARS)
        parts.append(f"Tool {name} returned:\n{content}")
    transcript = "\n\n".join(parts).strip()
    if len(transcript) > _MAX_TRANSCRIPT_CHARS:
        transcript = truncate_text(transcript, _MAX_TRANSCRIPT_CHARS)
    return transcript


class FinalResponseValidator:
    """Validate that a tool-based final answer matches the tool transcript."""

    def __init__(self, provider: LLMProvider, model: str):
        self.provider = provider
        self.model = model

    async def validate(
        self,
        *,
        task: str,
        candidate: str,
        tool_messages: list[dict[str, Any]],
        tools_used: list[str],
    ) -> FinalResponseValidationResult:
        transcript = _render_tool_transcript(tool_messages)
        if not transcript:
            return FinalResponseValidationResult(accepted=True)

        try:
            response = await self.provider.chat_with_retry(
                messages=[
                    {
                        "role": "system",
                        "content": render_template("agent/final_response_validator.md", part="system"),
                    },
                    {
                        "role": "user",
                        "content": render_template(
                            "agent/final_response_validator.md",
                            part="user",
                            task=task,
                            candidate=candidate,
                            transcript=transcript,
                            tools_used=", ".join(dict.fromkeys(tools_used)) or "(none)",
                        ),
                    },
                ],
                tools=_VALIDATE_FINAL_RESPONSE_TOOL,
                model=self.model,
                max_tokens=256,
                temperature=0.0,
            )
        except Exception:
            logger.exception("final_response_validation failed; accepting candidate")
            return FinalResponseValidationResult(accepted=True)

        if not response.has_tool_calls:
            logger.warning("final_response_validation returned no tool call; accepting candidate")
            return FinalResponseValidationResult(accepted=True)

        arguments = response.tool_calls[0].arguments
        accepted = bool(arguments.get("accepted", True))
        reason = str(arguments.get("reason") or "").strip()
        retry_message = str(arguments.get("retry_message") or "").strip() or None
        if not accepted and retry_message is None:
            retry_message = _FALLBACK_RETRY_MESSAGE
        return FinalResponseValidationResult(
            accepted=accepted,
            reason=reason,
            retry_message=retry_message,
        )
