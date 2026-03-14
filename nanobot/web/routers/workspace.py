"""Workspace-facing routes for templates, skills, prompts, and documents."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nanobot.services.skillhub_marketplace import SkillHubMarketplaceError
from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


class AgentTemplateMutationRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    tools: list[str] | None = None
    rules: list[str] | None = None
    system_prompt: str | None = None
    skills: list[str] | None = None
    model: str | None = None
    backend: str | None = None
    enabled: bool | None = None


class AgentTemplateImportRequest(BaseModel):
    content: str
    on_conflict: Literal["skip", "replace", "rename"] = "skip"


class AgentTemplateExportRequest(BaseModel):
    names: list[str] | None = None


class DocumentUpdateRequest(BaseModel):
    content: str


class SkillInstallRequest(BaseModel):
    slug: str
    force: bool = False


@router.get("/api/v1/agent-templates")
def get_agent_templates(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.list_agent_templates()))


@router.get("/api/v1/agent-templates/tools/valid")
def get_valid_template_tools(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_valid_template_tools()))


@router.post("/api/v1/agent-templates")
def create_agent_template(
    request: Request,
    payload: AgentTemplateMutationRequest,
) -> JSONResponse:
    try:
        data = request.app.state.web.create_agent_template(payload.model_dump())
    except ValueError as exc:
        raise APIError(400, "AGENT_TEMPLATE_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.post("/api/v1/agent-templates/import")
def import_agent_templates(
    request: Request,
    payload: AgentTemplateImportRequest,
) -> JSONResponse:
    return _json_response(
        200,
        _ok(
            request.app.state.web.import_agent_templates(
                payload.content,
                payload.on_conflict,
            )
        ),
    )


@router.post("/api/v1/agent-templates/export")
def export_agent_templates(
    request: Request,
    payload: AgentTemplateExportRequest,
) -> JSONResponse:
    return _json_response(
        200,
        _ok(request.app.state.web.export_agent_templates(payload.names)),
    )


@router.post("/api/v1/agent-templates/reload")
def reload_agent_templates(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.reload_agent_templates()))


@router.get("/api/v1/agent-templates/{template_name:path}")
def get_agent_template(request: Request, template_name: str) -> JSONResponse:
    try:
        data = request.app.state.web.get_agent_template(template_name)
    except KeyError as exc:
        raise APIError(404, "AGENT_TEMPLATE_NOT_FOUND", "Agent template not found.") from exc
    return _json_response(200, _ok(data))


@router.patch("/api/v1/agent-templates/{template_name:path}")
def update_agent_template(
    request: Request,
    template_name: str,
    payload: AgentTemplateMutationRequest,
) -> JSONResponse:
    try:
        data = request.app.state.web.update_agent_template(
            template_name,
            payload.model_dump(),
        )
    except KeyError as exc:
        raise APIError(404, "AGENT_TEMPLATE_NOT_FOUND", "Agent template not found.") from exc
    except ValueError as exc:
        raise APIError(400, "AGENT_TEMPLATE_VALIDATION_ERROR", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.delete("/api/v1/agent-templates/{template_name:path}")
def delete_agent_template(request: Request, template_name: str) -> JSONResponse:
    try:
        data = request.app.state.web.delete_agent_template(template_name)
    except KeyError as exc:
        raise APIError(404, "AGENT_TEMPLATE_NOT_FOUND", "Agent template not found.") from exc
    except ValueError as exc:
        raise APIError(400, "AGENT_TEMPLATE_DELETE_FAILED", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.get("/api/v1/skills/installed")
def get_installed_skills(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.get_installed_skills()))


@router.get("/api/v1/skills/marketplace")
def get_marketplace_skills(request: Request, q: str = "", limit: int = 24) -> JSONResponse:
    try:
        data = request.app.state.web.list_marketplace_skills(q, limit)
    except SkillHubMarketplaceError as exc:
        raise APIError(400, "SKILL_MARKETPLACE_FETCH_FAILED", str(exc)) from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/skills/install")
def install_marketplace_skill(request: Request, payload: SkillInstallRequest) -> JSONResponse:
    try:
        data = request.app.state.web.install_marketplace_skill(payload.slug, payload.force)
    except SkillHubMarketplaceError as exc:
        raise APIError(400, "SKILL_INSTALL_FAILED", str(exc)) from exc
    except ValueError as exc:
        raise APIError(400, "SKILL_INSTALL_FAILED", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.post("/api/v1/skills/upload")
async def upload_skill(request: Request) -> JSONResponse:
    form = await request.form()
    raw_paths = form.getlist("path")
    raw_files = form.getlist("file")
    if not raw_paths or not raw_files or len(raw_paths) != len(raw_files):
        raise APIError(400, "SKILL_UPLOAD_INVALID", "Upload requires matching path and file fields.")

    files: list[tuple[str, bytes]] = []
    for path_value, file_value in zip(raw_paths, raw_files):
        rel_path = str(path_value or "").strip()
        if not rel_path:
            continue
        file_bytes = await file_value.read()
        files.append((rel_path, file_bytes))

    try:
        data = request.app.state.web.upload_skill(files)
    except ValueError as exc:
        raise APIError(400, "SKILL_UPLOAD_INVALID", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.post("/api/v1/skills/upload-zip")
async def upload_skill_zip(request: Request) -> JSONResponse:
    form = await request.form()
    file_value = form.get("file")
    if file_value is None:
        raise APIError(400, "SKILL_UPLOAD_INVALID", "Upload requires a ZIP file.")

    file_bytes = await file_value.read()
    filename = str(getattr(file_value, "filename", "") or "")

    try:
        data = request.app.state.web.upload_skill_zip(filename, file_bytes)
    except ValueError as exc:
        raise APIError(400, "SKILL_UPLOAD_INVALID", str(exc)) from exc
    return _json_response(201, _ok(data))


@router.delete("/api/v1/skills/{skill_id:path}")
def delete_skill(request: Request, skill_id: str) -> JSONResponse:
    try:
        deleted = request.app.state.web.delete_skill(skill_id)
    except KeyError as exc:
        raise APIError(404, "SKILL_NOT_FOUND", "Skill not found.") from exc
    except ValueError as exc:
        raise APIError(400, "SKILL_DELETE_FAILED", str(exc)) from exc
    return _json_response(200, _ok({"deleted": deleted}))


@router.get("/api/v1/documents")
def get_documents(request: Request) -> JSONResponse:
    return _json_response(200, _ok(request.app.state.web.list_documents()))


@router.get("/api/v1/documents/{document_id:path}")
def get_document(request: Request, document_id: str) -> JSONResponse:
    try:
        data = request.app.state.web.get_document(document_id)
    except KeyError as exc:
        raise APIError(404, "DOCUMENT_NOT_FOUND", "Document not found.") from exc
    return _json_response(200, _ok(data))


@router.put("/api/v1/documents/{document_id:path}")
def update_document(request: Request, document_id: str, payload: DocumentUpdateRequest) -> JSONResponse:
    try:
        data = request.app.state.web.update_document(document_id, payload.content)
    except KeyError as exc:
        raise APIError(404, "DOCUMENT_NOT_FOUND", "Document not found.") from exc
    return _json_response(200, _ok(data))


@router.post("/api/v1/documents/{document_id:path}/reset")
def reset_document(request: Request, document_id: str) -> JSONResponse:
    try:
        data = request.app.state.web.reset_document(document_id)
    except KeyError as exc:
        raise APIError(404, "DOCUMENT_NOT_FOUND", "Document not found.") from exc
    return _json_response(200, _ok(data))
