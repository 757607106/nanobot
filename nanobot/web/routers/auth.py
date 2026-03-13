"""Authentication and profile routes for the nanobot Web UI."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from nanobot.web.auth import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    AuthAlreadyInitializedError,
    AuthAvatarNotFoundError,
    AuthInvalidCredentialsError,
    AuthNotInitializedError,
)
from nanobot.web.http import APIError, _json_response, _ok

router = APIRouter()


class AuthBootstrapRequest(BaseModel):
    username: str
    password: str


class AuthLoginRequest(BaseModel):
    username: str
    password: str


class ProfileUpdateRequest(BaseModel):
    username: str
    displayName: str | None = None
    email: str | None = None


class ProfilePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


def _auth_response(status_code: int, data: Any) -> JSONResponse:
    response = _json_response(status_code, _ok(data))
    response.headers["Cache-Control"] = "no-store"
    return response


def _session_token(request: Request) -> str | None:
    return request.cookies.get(SESSION_COOKIE_NAME)


def _write_session_cookie(response: JSONResponse, request: Request, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


def _clear_session_cookie(response: JSONResponse) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _profile_payload(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    data = dict(payload)
    avatar_updated_at = str(data.get("avatarUpdatedAt") or "").strip()
    data["avatarUrl"] = (
        f"/api/v1/profile/avatar?v={avatar_updated_at}"
        if data.get("hasAvatar")
        else None
    )
    return data


@router.get("/api/v1/auth/status")
def get_auth_status(request: Request) -> JSONResponse:
    return _auth_response(200, request.app.state.auth.status(_session_token(request)))


@router.post("/api/v1/auth/bootstrap")
def bootstrap_auth(request: Request, payload: AuthBootstrapRequest) -> JSONResponse:
    try:
        session_token = request.app.state.auth.bootstrap(payload.username, payload.password)
    except AuthAlreadyInitializedError as exc:
        raise APIError(409, "AUTH_ALREADY_INITIALIZED", str(exc)) from exc
    except ValueError as exc:
        raise APIError(400, "AUTH_VALIDATION_ERROR", str(exc)) from exc

    response = _auth_response(201, request.app.state.auth.status(session_token))
    _write_session_cookie(response, request, session_token)
    return response


@router.post("/api/v1/auth/login")
def login_auth(request: Request, payload: AuthLoginRequest) -> JSONResponse:
    try:
        session_token = request.app.state.auth.login(payload.username, payload.password)
    except AuthNotInitializedError as exc:
        raise APIError(409, "AUTH_NOT_INITIALIZED", str(exc)) from exc
    except AuthInvalidCredentialsError as exc:
        raise APIError(401, "AUTH_INVALID_CREDENTIALS", str(exc)) from exc
    except ValueError as exc:
        raise APIError(400, "AUTH_VALIDATION_ERROR", str(exc)) from exc

    response = _auth_response(200, request.app.state.auth.status(session_token))
    _write_session_cookie(response, request, session_token)
    return response


@router.post("/api/v1/auth/logout")
def logout_auth(request: Request) -> JSONResponse:
    request.app.state.auth.invalidate_session(_session_token(request))
    response = _auth_response(200, request.app.state.auth.status(None))
    _clear_session_cookie(response)
    return response


@router.get("/api/v1/profile")
def get_profile(request: Request) -> JSONResponse:
    return _json_response(200, _ok(_profile_payload(request, request.app.state.auth.get_profile())))


@router.put("/api/v1/profile")
def update_profile(request: Request, payload: ProfileUpdateRequest) -> JSONResponse:
    try:
        profile, session_token = request.app.state.auth.update_profile(
            username=payload.username,
            display_name=payload.displayName,
            email=payload.email,
        )
    except AuthNotInitializedError as exc:
        raise APIError(409, "AUTH_NOT_INITIALIZED", str(exc)) from exc
    except ValueError as exc:
        raise APIError(400, "PROFILE_VALIDATION_ERROR", str(exc)) from exc

    active_token = session_token or _session_token(request)
    response = _json_response(
        200,
        _ok(
            {
                "profile": _profile_payload(request, profile),
                "auth": request.app.state.auth.status(active_token),
            }
        ),
    )
    if session_token:
        _write_session_cookie(response, request, session_token)
    return response


@router.post("/api/v1/profile/password")
def rotate_profile_password(request: Request, payload: ProfilePasswordRequest) -> JSONResponse:
    try:
        profile, session_token = request.app.state.auth.rotate_password(
            payload.currentPassword,
            payload.newPassword,
        )
    except AuthNotInitializedError as exc:
        raise APIError(409, "AUTH_NOT_INITIALIZED", str(exc)) from exc
    except AuthInvalidCredentialsError as exc:
        raise APIError(401, "PROFILE_PASSWORD_INVALID", str(exc)) from exc
    except ValueError as exc:
        raise APIError(400, "PROFILE_PASSWORD_INVALID", str(exc)) from exc

    response = _json_response(
        200,
        _ok(
            {
                "profile": _profile_payload(request, profile),
                "auth": request.app.state.auth.status(session_token),
            }
        ),
    )
    _write_session_cookie(response, request, session_token)
    return response


@router.get("/api/v1/profile/avatar")
def get_profile_avatar(request: Request) -> FileResponse:
    try:
        path, media_type = request.app.state.auth.get_avatar_file()
    except AuthAvatarNotFoundError as exc:
        raise APIError(404, "PROFILE_AVATAR_NOT_FOUND", str(exc)) from exc
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "no-store"})


@router.post("/api/v1/profile/avatar")
async def upload_profile_avatar(request: Request) -> JSONResponse:
    form = await request.form()
    raw_file = form.get("file")
    if raw_file is None:
        raise APIError(400, "PROFILE_AVATAR_INVALID", "Avatar upload requires a file field.")

    file_bytes = await raw_file.read()
    try:
        profile = request.app.state.auth.store_avatar(file_bytes, getattr(raw_file, "content_type", None))
    except AuthNotInitializedError as exc:
        raise APIError(409, "AUTH_NOT_INITIALIZED", str(exc)) from exc
    except ValueError as exc:
        raise APIError(400, "PROFILE_AVATAR_INVALID", str(exc)) from exc
    return _json_response(200, _ok({"profile": _profile_payload(request, profile)}))


@router.delete("/api/v1/profile/avatar")
def delete_profile_avatar(request: Request) -> JSONResponse:
    profile = request.app.state.auth.clear_avatar()
    return _json_response(200, _ok({"profile": _profile_payload(request, profile)}))
