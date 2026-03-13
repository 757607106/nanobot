"""Chat routes for sessions, uploads, and streaming responses."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger
from pydantic import BaseModel

from nanobot.web.http import APIError, _encode_sse, _json_response, _ok

router = APIRouter()


class SessionCreateRequest(BaseModel):
    title: str | None = None


class SessionRenameRequest(BaseModel):
    title: str | None = None


class ChatMessageRequest(BaseModel):
    content: str | None = None


@router.post("/api/v1/chat/uploads")
async def upload_chat_file(request: Request) -> JSONResponse:
    form = await request.form()
    raw_file = form.get("file")
    if raw_file is None:
        raise APIError(400, "CHAT_UPLOAD_INVALID", "Chat upload requires a file field.")
    file_bytes = await raw_file.read()
    try:
        data = request.app.state.web.upload_chat_file(getattr(raw_file, "filename", ""), file_bytes)
    except ValueError as exc:
        raise APIError(400, "CHAT_UPLOAD_INVALID", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.get("/api/v1/chat/workspace")
def get_chat_workspace(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_chat_workspace()))


@router.get("/api/v1/chat/sessions")
def get_sessions(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, alias="pageSize", ge=1, le=100),
) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.list_sessions(page, page_size)))


@router.post("/api/v1/chat/sessions")
def create_session(
    request: Request,
    payload: SessionCreateRequest | None = Body(default=None),
) -> JSONResponse:
    title = payload.title if payload else None
    return _json_response(201, _ok(request.app.state.web.create_session(title)))


@router.patch("/api/v1/chat/sessions/{session_id}")
def rename_session(
    request: Request,
    session_id: str,
    payload: SessionRenameRequest,
) -> JSONResponse:
    title = (payload.title or "").strip()
    if not title:
        raise APIError(400, "VALIDATION_ERROR", "title is required.")
    try:
        data = request.app.state.web.rename_session(session_id, title)
    except KeyError as exc:
        raise APIError(404, "CHAT_SESSION_NOT_FOUND", "Session not found.") from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/chat/sessions/{session_id}")
def delete_session(request: Request, session_id: str) -> JSONResponse:
    deleted = request.app.state.web.delete_session(session_id)
    if not deleted:
        raise APIError(404, "CHAT_SESSION_NOT_FOUND", "Session not found.")
    return _json_response(200, _ok({"deleted": True}))


@router.get("/api/v1/chat/sessions/{session_id}/messages")
def get_messages(
    request: Request,
    session_id: str,
    limit: int = Query(200, ge=1, le=500),
) -> JSONResponse:
    try:
        data = request.app.state.web.get_messages(session_id, limit=limit)
    except KeyError as exc:
        raise APIError(404, "CHAT_SESSION_NOT_FOUND", "Session not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/chat/sessions/{session_id}/messages")
async def create_chat_message(
    request: Request,
    session_id: str,
    payload: ChatMessageRequest,
    stream: bool = Query(False),
):
    content = (payload.content or "").strip()
    if not content:
        raise APIError(400, "VALIDATION_ERROR", "content is required.")

    state = request.app.state.web

    if stream:

        async def event_stream():
            queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

            async def on_progress(progress: str, *, tool_hint: bool = False) -> None:
                await queue.put(
                    {
                        "type": "progress",
                        "content": progress,
                        "toolHint": tool_hint,
                    }
                )

            async def run_chat() -> None:
                try:
                    await queue.put({"type": "start", "sessionId": session_id})
                    data = await state.chat(session_id, content, on_progress)
                    await queue.put({"type": "done", **data})
                except KeyError:
                    await queue.put({"type": "error", "message": "Session not found."})
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Chat stream failed")
                    await queue.put({"type": "error", "message": str(exc)})
                finally:
                    await queue.put(None)

            task = asyncio.create_task(run_chat())
            try:
                while True:
                    event = await queue.get()
                    if event is None:
                        break
                    yield _encode_sse(event)
            except asyncio.CancelledError:
                task.cancel()
                raise
            finally:
                if not task.done():
                    task.cancel()
                with suppress(Exception):
                    await task

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    async def on_progress(_progress: str, *, tool_hint: bool = False) -> None:
        _ = tool_hint

    try:
        data = await state.chat(session_id, content, on_progress)
    except KeyError as exc:
        raise APIError(404, "CHAT_SESSION_NOT_FOUND", "Session not found.") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Chat request failed")
        raise APIError(
            500,
            "CHAT_FAILED",
            "Failed to process chat request.",
            str(exc),
        ) from exc
    return _json_response(200, _ok(data))
