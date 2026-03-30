"""WeChat (Weixin) QR-code binding workflow for the nanobot Web UI."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path
from typing import Any

from loguru import logger

from nanobot.config.paths import get_runtime_subdir
from nanobot.config.schema import Config


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class WebWeixinBindingService:
    """Manages the WeChat QR login lifecycle for the Web UI.

    Mirrors the ``WebWhatsAppBindingService`` pattern: the frontend calls
    ``start`` to initiate an async login flow in a background thread, then
    polls ``status`` to retrieve the latest QR code URL and scan state.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._login_thread: threading.Thread | None = None
        self._cancel_event = threading.Event()
        self._last_status: str = "idle"
        self._last_qr: str | None = None
        self._qr_updated_at: str | None = None
        self._last_error: str | None = None
        self._started_at: str | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def status(self, config: Config) -> dict[str, Any]:
        with self._lock:
            running = self._login_thread is not None and self._login_thread.is_alive()
            # Check if already authenticated
            has_token = self._check_has_token(config)
            last_status = "connected" if has_token and not running and self._last_status == "idle" else self._last_status
            return {
                "channelName": "weixin",
                "running": running,
                "authenticated": has_token,
                "lastStatus": last_status,
                "lastError": self._last_error,
                "qrCode": self._last_qr,
                "qrUpdatedAt": self._qr_updated_at,
                "startedAt": self._started_at,
                "checkedAt": _now_iso(),
            }

    def start(self, config: Config, force: bool = False) -> dict[str, Any]:
        with self._lock:
            if self._login_thread is not None and self._login_thread.is_alive():
                # Already running — just return current status
                return self.status(config)

            self._cancel_event.clear()
            self._last_error = None
            self._last_status = "starting"
            self._last_qr = None
            self._qr_updated_at = None
            self._started_at = _now_iso()

            channel_cfg = self._get_channel_config(config)

            self._login_thread = threading.Thread(
                target=self._run_login,
                args=(channel_cfg, force),
                name="nanobot-web-weixin-bind",
                daemon=True,
            )
            self._login_thread.start()

        # Wait a short time for the QR code to arrive
        deadline = time.time() + 8
        while time.time() < deadline:
            with self._lock:
                if self._last_qr or self._last_status in {"connected", "error", "idle"}:
                    break
            time.sleep(0.2)

        return self.status(config)

    def stop(self, config: Config) -> dict[str, Any]:
        with self._lock:
            self._cancel_event.set()
            if self._login_thread and self._login_thread.is_alive():
                self._login_thread.join(timeout=5)
            self._login_thread = None
            self._last_status = "stopped"
            self._last_qr = None
        return self.status(config)

    def shutdown(self) -> None:
        with self._lock:
            self._cancel_event.set()
            if self._login_thread and self._login_thread.is_alive():
                self._login_thread.join(timeout=3)
            self._login_thread = None

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _get_channel_config(config: Config) -> dict[str, Any]:
        raw = getattr(config.channels, "weixin", None)
        if raw is None:
            return {}
        if hasattr(raw, "model_dump"):
            return raw.model_dump()
        if isinstance(raw, dict):
            return dict(raw)
        return {}

    @staticmethod
    def _check_has_token(config: Config) -> bool:
        channel_cfg = WebWeixinBindingService._get_channel_config(config)
        if str(channel_cfg.get("token", "")).strip():
            return True

        state_file = WebWeixinBindingService._state_file(channel_cfg)
        if not state_file.exists():
            return False

        try:
            data = json.loads(state_file.read_text())
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to read WeChat state from {}: {}", state_file, exc)
            return False
        return bool(str(data.get("token", "")).strip())

    @staticmethod
    def _state_file(channel_cfg: dict[str, Any]) -> Path:
        raw_state_dir = str(
            channel_cfg.get("state_dir")
            or channel_cfg.get("stateDir")
            or "",
        ).strip()
        state_dir = Path(raw_state_dir).expanduser() if raw_state_dir else get_runtime_subdir("weixin")
        return state_dir / "account.json"

    def _run_login(self, channel_cfg: dict[str, Any], force: bool) -> None:
        """Run the async login flow inside a new event loop on its own thread."""
        try:
            asyncio.run(self._async_login(channel_cfg, force))
        except Exception as exc:
            logger.exception("WeChat web-bind login error")
            with self._lock:
                self._last_status = "error"
                self._last_error = str(exc)

    async def _async_login(self, channel_cfg: dict[str, Any], force: bool) -> None:
        from nanobot.channels.weixin import WeixinChannel

        channel = WeixinChannel(channel_cfg, bus=None)

        def _on_qr(url: str) -> None:
            with self._lock:
                self._last_qr = url
                self._qr_updated_at = _now_iso()

        def _on_status(status: str) -> None:
            with self._lock:
                self._last_status = status
                if status == "confirmed":
                    self._last_qr = None  # Clear QR after successful login

        success = await channel.login(force=force, on_qr=_on_qr, on_status=_on_status)

        with self._lock:
            if success:
                self._last_status = "connected"
                self._last_qr = None
                self._last_error = None
            elif self._last_status not in {"error"}:
                self._last_status = "failed"
                self._last_error = "Login flow completed without success."
