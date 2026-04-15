"""Agent chat routes for isolated agent workbench sessions."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger

from nanobot.web.http import APIError, _encode_sse, _json_response, _ok
from nanobot.web.routers.chat import (
    ChatMessageRequest,
    ChatSessionFileDeleteRequest,
    ChatSessionFilesRequest,
    SessionCreateRequest,
    SessionRenameRequest,
)
from nanobot.web.tenant_context import get_tenant_id

router = APIRouter()


@router.get("/api/v1/agents/{agent_id}/sessions")
def list_agent_sessions(
    request: Request,
    agent_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, alias="pageSize", ge=1, le=100),
) -> JSONResponse:
    try:
        data = request.app.state.web.list_agent_sessions(
            agent_id,
            tenant_id=get_tenant_id(request),
            page=page,
            page_size=page_size,
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/agents/{agent_id}/sessions")
def create_agent_session(
    request: Request,
    agent_id: str,
    payload: SessionCreateRequest | None = Body(default=None),
) -> JSONResponse:
    try:
        data = request.app.state.web.create_agent_session(
            agent_id,
            tenant_id=get_tenant_id(request),
            title=payload.title if payload else None,
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    return _json_response(201, _ok(data))


@router.patch("/api/v1/agents/{agent_id}/sessions/{session_id}")
def rename_agent_session(
    request: Request,
    agent_id: str,
    session_id: str,
    payload: SessionRenameRequest,
) -> JSONResponse:
    title = (payload.title or "").strip()
    if not title:
        raise APIError(400, "VALIDATION_ERROR", "title is required.")
    try:
        data = request.app.state.web.rename_agent_session(
            agent_id,
            session_id,
            title,
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.") from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/agents/{agent_id}/sessions/{session_id}")
def delete_agent_session(request: Request, agent_id: str, session_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.web.delete_agent_session(
            agent_id,
            session_id,
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_NOT_FOUND", "Agent not found.") from exc
    if not deleted:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.")
    return _json_response(200, _ok({"deleted": True}))


@router.get("/api/v1/agents/{agent_id}/sessions/{session_id}/messages")
def get_agent_messages(
    request: Request,
    agent_id: str,
    session_id: str,
    limit: int = Query(200, ge=1, le=500),
) -> JSONResponse:
    try:
        data = request.app.state.web.get_agent_messages(
            agent_id,
            session_id,
            tenant_id=get_tenant_id(request),
            limit=limit,
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/agents/{agent_id}/sessions/{session_id}/messages")
@router.post("/api/v1/agents/messages")
async def create_agent_chat_message(
    request: Request,
    payload: ChatMessageRequest,
    agent_id: str | None = None,
    session_id: str | None = None,
    stream: bool = Query(False),
):
    agent_id = agent_id or payload.agentId
    session_id = session_id or payload.sessionId
    if not agent_id:
        raise APIError(400, "VALIDATION_ERROR", "agentId is required for agent sessions.")
    if not session_id:
        raise APIError(400, "VALIDATION_ERROR", "sessionId is required.")

    content = (payload.content or "").strip()
    display_content = (payload.displayContent or content).strip()
    if not content:
        raise APIError(400, "VALIDATION_ERROR", "content is required.")

    state = request.app.state.web
    tenant_id = get_tenant_id(request)
    attachments = payload.attachments or []
    reasoning_effort = (payload.reasoningEffort or "").strip() or None

    if stream:

        async def event_stream():
            queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

            async def on_progress(
                progress: str,
                *,
                tool_hint: bool = False,
                tool_complete: bool = False,
                tool_name: str = "",
                tool_status: str = "",
                tool_calls: list[dict[str, Any]] | None = None,
                tool_call_id: str = "",
            ) -> None:
                event: dict[str, Any] = {
                    "type": "progress",
                    "content": progress,
                    "toolHint": tool_hint,
                }
                if tool_calls:
                    event["toolCalls"] = tool_calls
                if tool_complete:
                    event["toolComplete"] = True
                    event["toolName"] = tool_name
                    event["toolStatus"] = tool_status
                    if tool_call_id:
                        event["toolCallId"] = tool_call_id
                await queue.put(event)

            async def on_stream(chunk_content: str, reasoning_content: str | None = None) -> None:
                if chunk_content or reasoning_content:
                    await queue.put(
                        {
                            "type": "chunk",
                            "content": chunk_content or "",
                            "reasoningContent": reasoning_content or "",
                        }
                    )

            async def run_chat() -> None:
                try:
                    await queue.put({"type": "start", "sessionId": session_id})
                    data = await state.chat_with_agent(
                        agent_id,
                        session_id,
                        content,
                        on_progress,
                        tenant_id=tenant_id,
                        display_content=display_content,
                        attachments=attachments,
                        on_stream=on_stream,
                        reasoning_effort=reasoning_effort,
                    )
                    await queue.put({"type": "done", **data})
                except KeyError:
                    await queue.put({"type": "error", "message": "Agent session not found."})
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Agent chat stream failed")
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

    async def on_progress(_progress: str, *, tool_hint: bool = False, **_: Any) -> None:
        _ = tool_hint

    try:
        data = await state.chat_with_agent(
            agent_id,
            session_id,
            content,
            on_progress,
            tenant_id=tenant_id,
            display_content=display_content,
            attachments=attachments,
            reasoning_effort=reasoning_effort,
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/agents/{agent_id}/sessions/{session_id}/files")
def get_agent_session_files(request: Request, agent_id: str, session_id: str) -> JSONResponse:
    try:
        data = request.app.state.web.get_agent_session_files(
            agent_id,
            session_id,
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.") from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/agents/{agent_id}/sessions/{session_id}/workspace")
def get_agent_session_workspace(request: Request, agent_id: str, session_id: str) -> JSONResponse:
    try:
        data = request.app.state.web.get_agent_chat_workspace(
            agent_id,
            session_id,
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/agents/{agent_id}/sessions/{session_id}/uploads")
async def upload_agent_session_file(request: Request, agent_id: str, session_id: str) -> JSONResponse:
    form = await request.form()
    raw_file = form.get("file")
    if raw_file is None:
        raise APIError(400, "CHAT_UPLOAD_INVALID", "Chat upload requires a file field.")
    file_bytes = await raw_file.read()
    try:
        uploaded = request.app.state.web.upload_agent_chat_file_to_session(
            agent_id,
            session_id,
            getattr(raw_file, "filename", ""),
            file_bytes,
            tenant_id=get_tenant_id(request),
        )
        session_files = request.app.state.web.get_agent_session_files(
            agent_id,
            session_id,
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.") from exc
    except ValueError as exc:
        raise APIError(400, "CHAT_UPLOAD_INVALID", str(exc)) from exc
    return _json_response(201, _ok({"uploadedFile": uploaded, "sessionFiles": session_files}))


@router.post("/api/v1/agents/{agent_id}/sessions/{session_id}/files/import")
def import_agent_session_files(
    request: Request,
    agent_id: str,
    session_id: str,
    payload: ChatSessionFilesRequest,
) -> JSONResponse:
    try:
        session_files = request.app.state.web.import_agent_session_files(
            agent_id,
            session_id,
            payload.attachments or [],
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.") from exc
    except ValueError as exc:
        raise APIError(400, "CHAT_FILE_INVALID", str(exc)) from exc
    return _json_response(200, _ok({"sessionFiles": session_files}))


@router.delete("/api/v1/agents/{agent_id}/sessions/{session_id}/files")
def remove_agent_session_file(
    request: Request,
    agent_id: str,
    session_id: str,
    payload: ChatSessionFileDeleteRequest,
) -> JSONResponse:
    try:
        session_files = request.app.state.web.remove_agent_session_file(
            agent_id,
            session_id,
            payload.relativePath or "",
            tenant_id=get_tenant_id(request),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_OR_SESSION_NOT_FOUND", "Agent session not found.") from exc
    except ValueError as exc:
        raise APIError(400, "CHAT_FILE_INVALID", str(exc)) from exc
    return _json_response(200, _ok({"sessionFiles": session_files}))
