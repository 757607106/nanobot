"""Dashboard analytics routes for the nanobot Web UI."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from nanobot.web.http import _json_response, _ok

router = APIRouter()


@router.get("/api/v1/dashboard/analytics")
def get_dashboard_analytics(
    request: Request,
    bucket: str = Query(default="day", description="Time bucket: hour, day, week, month"),
    since: str | None = Query(default=None, description="ISO 8601 lower bound for created_at"),
    until: str | None = Query(default=None, description="ISO 8601 upper bound for created_at"),
) -> JSONResponse:
    runs = request.app.state.runs
    data = {
        "timeSeries": runs.get_time_series_metrics(bucket=bucket, since=since, until=until),
        "toolRanking": runs.get_tool_usage_ranking(limit=10, since=since, until=until),
        "overview": runs.get_overview_metrics(since=since, until=until),
        "agentMetrics": runs.get_all_agents_metrics(since=since, until=until),
    }
    return _json_response(200, _ok(data))


@router.get("/api/v1/dashboard/mcp-health")
def get_dashboard_mcp_health(request: Request) -> JSONResponse:
    listing = request.app.state.mcp_registry.list_servers(request.app.state.web.config)
    servers = listing.get("items", [])
    summary = listing.get("summary", {})
    total = summary.get("total", 0)
    ready = summary.get("ready", 0)
    health_score = round((ready / total) * 100, 1) if total > 0 else 0
    data = {
        "servers": servers,
        "summary": summary,
        "healthScore": health_score,
    }
    return _json_response(200, _ok(data))


@router.get("/api/v1/dashboard/kb-activity")
def get_dashboard_kb_activity(request: Request) -> JSONResponse:
    knowledge = request.app.state.knowledge
    try:
        kbs = knowledge.list_knowledge_bases() if hasattr(knowledge, "list_knowledge_bases") else []
    except Exception:
        kbs = []

    items = []
    for kb in kbs:
        kb_dict = kb if isinstance(kb, dict) else (kb.to_dict() if hasattr(kb, "to_dict") else {})
        stats = kb_dict.get("stats") or {}
        items.append({
            "kbId": kb_dict.get("kbId") or kb_dict.get("kb_id", ""),
            "name": kb_dict.get("name", ""),
            "totalCount": stats.get("totalCount", 0),
            "fileCount": stats.get("fileCount", 0),
            "indexedCount": stats.get("indexedCount", 0),
            "updatedAt": kb_dict.get("updatedAt") or kb_dict.get("updated_at"),
        })
    return _json_response(200, _ok(items))
