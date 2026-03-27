"""Channel audit routes for tenant-aware inbound routing provenance."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from nanobot.platform.channel_audit import ChannelAuditNotFoundError
from nanobot.web.http import APIError, _json_response, _ok
from nanobot.web.tenant_context import get_tenant_id

router = APIRouter()


@router.get("/api/v1/channel-audit")
def list_channel_audit(
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    channel_name: str | None = Query(default=None, alias="channelName"),
    chat_id: str | None = Query(default=None, alias="chatId"),
    status: str | None = Query(default=None),
    query: str | None = Query(default=None),
) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    data = request.app.state.channel_audit_service.list_entries(
        tenant_id=tenant_id,
        limit=limit,
        channel_name=channel_name,
        chat_id=chat_id,
        status=status,
        query=query,
    )
    return _json_response(200, _ok({"items": data, "limit": limit}))


@router.get("/api/v1/channel-audit/{audit_id}")
def get_channel_audit(request: Request, audit_id: str) -> JSONResponse:
    tenant_id = get_tenant_id(request)
    try:
        data = request.app.state.channel_audit_service.get_entry(audit_id, tenant_id=tenant_id)
    except ChannelAuditNotFoundError as exc:
        raise APIError(404, "CHANNEL_AUDIT_NOT_FOUND", "Channel audit entry not found.") from exc
    return _json_response(200, _ok(data))
