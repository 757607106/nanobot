"""Authentication helpers for the nanobot Web UI."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from nanobot.platform.instances import PlatformInstance, coerce_instance

PBKDF2_ITERATIONS = 480_000
SESSION_COOKIE_NAME = "nanobot_web_session"
SESSION_MAX_AGE_SECONDS = 12 * 60 * 60
MAX_AVATAR_BYTES = 2 * 1024 * 1024
ALLOWED_AVATAR_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class AuthAlreadyInitializedError(RuntimeError):
    """Raised when bootstrap is attempted after the admin account exists."""


class AuthInvalidCredentialsError(RuntimeError):
    """Raised when the provided username or password is invalid."""


class AuthNotInitializedError(RuntimeError):
    """Raised when login is attempted before bootstrap finishes."""


class AuthAvatarNotFoundError(RuntimeError):
    """Raised when avatar operations require a file that does not exist."""


@dataclass(slots=True)
class AuthState:
    """Persisted admin account state."""

    username: str | None = None
    display_name: str | None = None
    email: str | None = None
    password_hash: str | None = None
    password_salt: str | None = None
    avatar_filename: str | None = None
    avatar_content_type: str | None = None
    avatar_updated_at: str | None = None
    iterations: int = PBKDF2_ITERATIONS
    created_at: str | None = None
    updated_at: str | None = None
    version: int = 1

    @property
    def initialized(self) -> bool:
        return bool(self.username and self.password_hash and self.password_salt)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "username": self.username,
            "display_name": self.display_name,
            "email": self.email,
            "password_hash": self.password_hash,
            "password_salt": self.password_salt,
            "avatar_filename": self.avatar_filename,
            "avatar_content_type": self.avatar_content_type,
            "avatar_updated_at": self.avatar_updated_at,
            "iterations": self.iterations,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "AuthState":
        return cls(
            username=payload.get("username"),
            display_name=payload.get("display_name"),
            email=payload.get("email"),
            password_hash=payload.get("password_hash"),
            password_salt=payload.get("password_salt"),
            avatar_filename=payload.get("avatar_filename"),
            avatar_content_type=payload.get("avatar_content_type"),
            avatar_updated_at=payload.get("avatar_updated_at"),
            iterations=int(payload.get("iterations") or PBKDF2_ITERATIONS),
            created_at=payload.get("created_at"),
            updated_at=payload.get("updated_at"),
            version=int(payload.get("version") or 1),
        )


@dataclass(slots=True)
class SessionRecord:
    """In-memory web session."""

    token: str
    username: str
    created_at: datetime
    expires_at: datetime

    @property
    def expired(self) -> bool:
        return datetime.now(UTC) >= self.expires_at


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _hash_password(password: str, salt_hex: str, iterations: int) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt_hex),
        iterations,
    )
    return digest.hex()


class WebAuthManager:
    """Handles admin bootstrap, password verification, and volatile sessions."""

    def __init__(self, config_path: Path | PlatformInstance):
        self._instance = coerce_instance(config_path)
        self._state_path = self._instance.auth_state_path()
        self._avatar_dir = self._instance.profile_dir()
        self._lock = threading.RLock()
        self._sessions: dict[str, SessionRecord] = {}
        self._state = self._load_state()

    @property
    def state_path(self) -> Path:
        return self._state_path

    def status(self, session_token: str | None) -> dict[str, Any]:
        username = self.get_authenticated_user(session_token)
        with self._lock:
            initialized = self._state.initialized
        return {
            "initialized": initialized,
            "authenticated": bool(username),
            "username": username,
        }

    def bootstrap(self, username: str, password: str) -> str:
        clean_username = self._validate_username(username)
        clean_password = self._validate_password(password)

        with self._lock:
            if self._state.initialized:
                raise AuthAlreadyInitializedError("Admin account already exists.")

            salt = secrets.token_hex(16)
            created_at = _now_iso()
            self._state = AuthState(
                username=clean_username,
                password_hash=_hash_password(clean_password, salt, PBKDF2_ITERATIONS),
                password_salt=salt,
                iterations=PBKDF2_ITERATIONS,
                created_at=created_at,
                updated_at=created_at,
            )
            self._persist_state(self._state)
            self._sessions.clear()
            return self._create_session_locked(clean_username)

    def login(self, username: str, password: str) -> str:
        clean_username = self._validate_username(username)
        clean_password = self._validate_password(password)

        with self._lock:
            if not self._state.initialized:
                raise AuthNotInitializedError("Admin account has not been initialized.")
            if clean_username != self._state.username:
                raise AuthInvalidCredentialsError("Invalid username or password.")

            expected = _hash_password(
                clean_password,
                self._state.password_salt or "",
                self._state.iterations,
            )
            if not hmac.compare_digest(expected, self._state.password_hash or ""):
                raise AuthInvalidCredentialsError("Invalid username or password.")
            return self._create_session_locked(clean_username)

    def get_profile(self) -> dict[str, Any]:
        with self._lock:
            return self._build_profile_locked()

    def update_profile(
        self,
        *,
        username: str,
        display_name: str | None,
        email: str | None,
    ) -> tuple[dict[str, Any], str | None]:
        clean_username = self._validate_username(username)
        clean_display_name = self._validate_display_name(display_name)
        clean_email = self._validate_email(email)

        with self._lock:
            if not self._state.initialized:
                raise AuthNotInitializedError("Admin account has not been initialized.")

            username_changed = clean_username != self._state.username
            self._state.username = clean_username
            self._state.display_name = clean_display_name
            self._state.email = clean_email
            self._state.updated_at = _now_iso()
            self._persist_state(self._state)

            next_token: str | None = None
            if username_changed:
                self._sessions.clear()
                next_token = self._create_session_locked(clean_username)

            return self._build_profile_locked(), next_token

    def rotate_password(self, current_password: str, new_password: str) -> tuple[dict[str, Any], str]:
        clean_current = self._validate_password(current_password)
        clean_new = self._validate_password(new_password)
        if clean_current == clean_new:
            raise ValueError("New password must be different from the current password.")

        with self._lock:
            if not self._state.initialized:
                raise AuthNotInitializedError("Admin account has not been initialized.")

            expected = _hash_password(
                clean_current,
                self._state.password_salt or "",
                self._state.iterations,
            )
            if not hmac.compare_digest(expected, self._state.password_hash or ""):
                raise AuthInvalidCredentialsError("Invalid username or password.")

            salt = secrets.token_hex(16)
            self._state.password_salt = salt
            self._state.password_hash = _hash_password(clean_new, salt, PBKDF2_ITERATIONS)
            self._state.iterations = PBKDF2_ITERATIONS
            self._state.updated_at = _now_iso()
            self._persist_state(self._state)

            self._sessions.clear()
            next_token = self._create_session_locked(self._state.username or "")
            return self._build_profile_locked(), next_token

    def store_avatar(self, data: bytes, content_type: str | None) -> dict[str, Any]:
        payload = bytes(data or b"")
        if not payload:
            raise ValueError("Avatar file is empty.")
        if len(payload) > MAX_AVATAR_BYTES:
            raise ValueError("Avatar file must be 2 MB or smaller.")

        media_type = str(content_type or "").strip().lower()
        suffix = ALLOWED_AVATAR_CONTENT_TYPES.get(media_type)
        if suffix is None:
            raise ValueError("Avatar must be PNG, JPEG, WEBP, or GIF.")

        with self._lock:
            if not self._state.initialized:
                raise AuthNotInitializedError("Admin account has not been initialized.")

            self._avatar_dir.mkdir(parents=True, exist_ok=True)
            next_filename = f"avatar{suffix}"
            target = self._avatar_dir / next_filename
            temp_path = target.with_suffix(f"{target.suffix}.tmp")
            temp_path.write_bytes(payload)
            temp_path.replace(target)

            for stale in self._avatar_dir.glob("avatar.*"):
                if stale.name != next_filename:
                    stale.unlink(missing_ok=True)

            self._state.avatar_filename = next_filename
            self._state.avatar_content_type = media_type
            self._state.avatar_updated_at = _now_iso()
            self._state.updated_at = self._state.avatar_updated_at
            self._persist_state(self._state)
            return self._build_profile_locked()

    def clear_avatar(self) -> dict[str, Any]:
        with self._lock:
            if self._state.avatar_filename:
                avatar_path = self._avatar_dir / Path(self._state.avatar_filename).name
                avatar_path.unlink(missing_ok=True)
            self._state.avatar_filename = None
            self._state.avatar_content_type = None
            self._state.avatar_updated_at = None
            self._state.updated_at = _now_iso()
            self._persist_state(self._state)
            return self._build_profile_locked()

    def get_avatar_file(self) -> tuple[Path, str]:
        with self._lock:
            filename = self._state.avatar_filename
            media_type = self._state.avatar_content_type

        if not filename or not media_type:
            raise AuthAvatarNotFoundError("Profile avatar is not configured.")

        target = (self._avatar_dir / Path(filename).name).resolve()
        root = self._avatar_dir.resolve()
        if not target.exists() or not target.is_file() or not target.is_relative_to(root):
            raise AuthAvatarNotFoundError("Profile avatar is not available.")
        return target, media_type

    def get_authenticated_user(self, session_token: str | None) -> str | None:
        if not session_token:
            return None

        with self._lock:
            record = self._sessions.get(session_token)
            if record is None:
                return None
            if record.expired:
                self._sessions.pop(session_token, None)
                return None
            return record.username

    def invalidate_session(self, session_token: str | None) -> None:
        if not session_token:
            return
        with self._lock:
            self._sessions.pop(session_token, None)

    def _create_session_locked(self, username: str) -> str:
        created_at = datetime.now(UTC)
        expires_at = created_at + timedelta(seconds=SESSION_MAX_AGE_SECONDS)
        token = secrets.token_urlsafe(32)
        self._sessions[token] = SessionRecord(
            token=token,
            username=username,
            created_at=created_at,
            expires_at=expires_at,
        )
        return token

    def _load_state(self) -> AuthState:
        if not self._state_path.exists():
            return AuthState()

        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Failed to parse auth state from {self._state_path}.") from exc

        return AuthState.from_dict(payload)

    def _persist_state(self, state: AuthState) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self._state_path.with_suffix(f"{self._state_path.suffix}.tmp")
        temp_path.write_text(
            json.dumps(state.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        temp_path.replace(self._state_path)

    def _validate_username(self, username: str) -> str:
        value = str(username or "").strip()
        if len(value) < 3:
            raise ValueError("Username must be at least 3 characters.")
        if len(value) > 64:
            raise ValueError("Username must be at most 64 characters.")
        if any(char.isspace() for char in value):
            raise ValueError("Username cannot contain whitespace.")
        return value

    def _validate_password(self, password: str) -> str:
        value = str(password or "")
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if len(value) > 256:
            raise ValueError("Password must be at most 256 characters.")
        return value

    def _validate_display_name(self, display_name: str | None) -> str | None:
        value = str(display_name or "").strip()
        if not value:
            return None
        if len(value) > 120:
            raise ValueError("Display name must be at most 120 characters.")
        return value

    def _validate_email(self, email: str | None) -> str | None:
        value = str(email or "").strip()
        if not value:
            return None
        if len(value) > 254:
            raise ValueError("Email must be at most 254 characters.")
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Email format is invalid.")
        return value

    def _build_profile_locked(self) -> dict[str, Any]:
        return {
            "username": self._state.username,
            "displayName": self._state.display_name,
            "email": self._state.email,
            "hasAvatar": bool(self._state.avatar_filename and self._state.avatar_content_type),
            "avatarUpdatedAt": self._state.avatar_updated_at,
            "createdAt": self._state.created_at,
            "updatedAt": self._state.updated_at,
        }
