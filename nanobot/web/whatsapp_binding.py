"""WhatsApp bridge binding workflow for the nanobot Web UI."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from loguru import logger

from nanobot.config.schema import Config
from nanobot.platform.instances import PlatformInstance, coerce_instance


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _channel_payload(config: Config, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if not payload:
        channels_payload = config.channels.model_dump(mode="json", by_alias=True)
        raw = channels_payload.get("whatsapp")
        return dict(raw) if isinstance(raw, dict) else {}

    config_payload = config.model_dump(mode="json", by_alias=True)
    channels_payload = config_payload.setdefault("channels", {})
    current = channels_payload.get("whatsapp")
    merged = dict(current) if isinstance(current, dict) else {}
    merged.update(payload)
    channels_payload["whatsapp"] = merged
    checked = Config.model_validate(config_payload)
    checked_payload = checked.channels.model_dump(mode="json", by_alias=True).get("whatsapp")
    return dict(checked_payload) if isinstance(checked_payload, dict) else {}


class WebWhatsAppBindingService:
    """Manages the local WhatsApp bridge process and QR/bind status."""

    def __init__(self, instance: PlatformInstance | Path | None = None):
        self._instance = coerce_instance(instance)
        self._lock = threading.RLock()
        self._process: subprocess.Popen[str] | None = None
        self._listener_thread: threading.Thread | None = None
        self._listener_stop = threading.Event()
        self._log_thread: threading.Thread | None = None
        self._last_status: str | None = None
        self._last_qr: str | None = None
        self._qr_updated_at: str | None = None
        self._last_error: str | None = None
        self._bridge_url: str | None = None
        self._bridge_token: str | None = None
        self._auth_dir: Path | None = None
        self._started_at: str | None = None
        self._listener_connected = False
        self._recent_logs: list[str] = []

    def status(self, config: Config) -> dict[str, Any]:
        with self._lock:
            payload = _channel_payload(config)
            bridge_url = self._bridge_url or str(payload.get("bridgeUrl") or "").strip()
            auth_dir = self._auth_dir or self._instance.runtime_dir("whatsapp-auth")
            bridge_dir = self._instance.bridge_install_dir()
            process_running = self._process_running_locked()
            auth_present = auth_dir.exists() and any(auth_dir.iterdir())

            binding_required = not auth_present or self._last_status != "connected"
            return {
                "channelName": "whatsapp",
                "bridgeUrl": bridge_url or None,
                "bridgeInstalled": (bridge_dir / "dist" / "index.js").exists(),
                "bridgeDir": str(bridge_dir),
                "running": process_running,
                "pid": self._process.pid if process_running and self._process else None,
                "authDir": str(auth_dir),
                "authPresent": auth_present,
                "bindingRequired": binding_required,
                "listenerConnected": self._listener_connected,
                "lastStatus": self._last_status,
                "lastError": self._last_error,
                "qrCode": self._last_qr,
                "qrUpdatedAt": self._qr_updated_at,
                "startedAt": self._started_at,
                "checkedAt": _now_iso(),
                "recentLogs": list(self._recent_logs[-20:]),
            }

    def start(self, config: Config, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            checked_payload = _channel_payload(config, payload)
            bridge_url = str(checked_payload.get("bridgeUrl") or "").strip()
            if not bridge_url:
                raise ValueError("WhatsApp bridgeUrl is required.")

            parsed = urlparse(bridge_url)
            host = (parsed.hostname or "").strip().lower()
            if host not in {"127.0.0.1", "localhost"}:
                raise ValueError("当前内置绑定流程只支持本机桥接地址（127.0.0.1 / localhost）。")

            port = parsed.port or 3001
            bridge_token = str(checked_payload.get("bridgeToken") or "").strip() or None
            auth_dir = self._instance.runtime_dir("whatsapp-auth")
            bridge_dir = self._ensure_bridge_ready()

            if self._process_running_locked():
                self._bridge_url = bridge_url
                self._bridge_token = bridge_token
                self._auth_dir = auth_dir
                return self.status(config)

            env = os.environ.copy()
            env["AUTH_DIR"] = str(auth_dir)
            env["BRIDGE_PORT"] = str(port)
            if bridge_token:
                env["BRIDGE_TOKEN"] = bridge_token
            elif "BRIDGE_TOKEN" in env:
                env.pop("BRIDGE_TOKEN")

            logger.info("Starting WhatsApp bridge bind workflow on {}", bridge_url)
            process = subprocess.Popen(
                ["npm", "start"],
                cwd=bridge_dir,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            self._process = process
            self._bridge_url = bridge_url
            self._bridge_token = bridge_token
            self._auth_dir = auth_dir
            self._started_at = _now_iso()
            self._last_error = None
            self._last_status = "starting"
            self._last_qr = None
            self._qr_updated_at = None
            self._listener_connected = False
            self._recent_logs = []
            self._start_log_thread_locked()
            self._start_listener_locked()

        deadline = time.time() + 8
        while time.time() < deadline:
            with self._lock:
                if self._listener_connected or self._last_qr or self._last_status in {"connected", "disconnected"}:
                    break
                if self._process and self._process.poll() is not None:
                    code = self._process.returncode
                    raise RuntimeError(f"WhatsApp bridge 启动失败，退出码 {code}。")
            time.sleep(0.1)
        return self.status(config)

    def stop(self, config: Config) -> dict[str, Any]:
        with self._lock:
            self._stop_locked()
            self._last_status = "stopped"
            self._listener_connected = False
        return self.status(config)

    def shutdown(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        self._listener_stop.set()
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
        self._process = None

        if self._listener_thread and self._listener_thread.is_alive():
            self._listener_thread.join(timeout=2)
        self._listener_thread = None

        if self._log_thread and self._log_thread.is_alive():
            self._log_thread.join(timeout=2)
        self._log_thread = None
        self._listener_stop.clear()

    def _process_running_locked(self) -> bool:
        if self._process is None:
            return False
        if self._process.poll() is not None:
            if self._last_error is None and self._process.returncode not in (0, None):
                self._last_error = f"bridge exited with code {self._process.returncode}"
            return False
        return True

    def _ensure_bridge_ready(self) -> Path:
        bridge_dir = self._instance.bridge_install_dir()
        if (bridge_dir / "dist" / "index.js").exists():
            return bridge_dir

        if not shutil.which("npm"):
            raise RuntimeError("npm 未安装，无法准备 WhatsApp bridge。请先安装 Node.js >= 18。")

        source = self._bridge_source_dir()
        bridge_dir.parent.mkdir(parents=True, exist_ok=True)
        if bridge_dir.exists():
            shutil.rmtree(bridge_dir)
        shutil.copytree(source, bridge_dir, ignore=shutil.ignore_patterns("node_modules", "dist"))

        try:
            install = subprocess.run(
                ["npm", "install"],
                cwd=bridge_dir,
                check=True,
                capture_output=True,
                text=True,
            )
            self._append_log(f"$ npm install\n{install.stdout.strip()}")
            build = subprocess.run(
                ["npm", "run", "build"],
                cwd=bridge_dir,
                check=True,
                capture_output=True,
                text=True,
            )
            self._append_log(f"$ npm run build\n{build.stdout.strip()}")
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            self._last_error = stderr[-500:] if stderr else str(exc)
            raise RuntimeError(f"WhatsApp bridge 准备失败：{self._last_error}") from exc
        return bridge_dir

    def _bridge_source_dir(self) -> Path:
        pkg_bridge = Path(__file__).resolve().parent.parent / "bridge"
        src_bridge = Path(__file__).resolve().parent.parent.parent / "bridge"
        if (pkg_bridge / "package.json").exists():
            return pkg_bridge
        if (src_bridge / "package.json").exists():
            return src_bridge
        raise RuntimeError("未找到 WhatsApp bridge 源码目录。")

    def _start_log_thread_locked(self) -> None:
        if self._process is None or self._process.stdout is None:
            return

        def reader() -> None:
            assert self._process is not None
            assert self._process.stdout is not None
            for line in self._process.stdout:
                text = line.rstrip()
                if not text:
                    continue
                self._append_log(text)
                if "Failed to start bridge" in text or "Bridge failed" in text:
                    with self._lock:
                        self._last_error = text

        self._log_thread = threading.Thread(
            target=reader,
            name="nanobot-web-whatsapp-bind-logs",
            daemon=True,
        )
        self._log_thread.start()

    def _start_listener_locked(self) -> None:
        if not self._bridge_url:
            return
        self._listener_stop.clear()

        def runner() -> None:
            asyncio.run(self._listen_loop(self._bridge_url or "", self._bridge_token, self._listener_stop))

        self._listener_thread = threading.Thread(
            target=runner,
            name="nanobot-web-whatsapp-bind-listener",
            daemon=True,
        )
        self._listener_thread.start()

    async def _listen_loop(self, bridge_url: str, bridge_token: str | None, stop_event: threading.Event) -> None:
        import websockets

        while not stop_event.is_set():
            try:
                async with websockets.connect(bridge_url, open_timeout=5, close_timeout=3) as ws:
                    if bridge_token:
                        await ws.send(json.dumps({"type": "auth", "token": bridge_token}))
                    with self._lock:
                        self._listener_connected = True
                        self._last_error = None
                    async for raw in ws:
                        if stop_event.is_set():
                            break
                        self._handle_bridge_message(raw)
            except Exception as exc:  # noqa: BLE001
                with self._lock:
                    self._listener_connected = False
                    if self._process_running_locked():
                        self._last_error = str(exc)
                await asyncio.sleep(1)
                continue

            with self._lock:
                self._listener_connected = False
            await asyncio.sleep(0.2)

    def _handle_bridge_message(self, raw: str) -> None:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._append_log(f"[bridge] invalid json: {raw[:120]}")
            return

        msg_type = str(payload.get("type") or "").strip()
        with self._lock:
            if msg_type == "qr":
                self._last_qr = str(payload.get("qr") or "")
                self._qr_updated_at = _now_iso()
                self._last_status = "qr"
            elif msg_type == "status":
                self._last_status = str(payload.get("status") or "")
                if self._last_status == "connected":
                    self._last_qr = None
            elif msg_type == "error":
                self._last_error = str(payload.get("error") or "bridge error")

    def _append_log(self, line: str) -> None:
        clean = str(line or "").strip()
        if not clean:
            return
        with self._lock:
            self._recent_logs.append(clean)
            if len(self._recent_logs) > 200:
                self._recent_logs = self._recent_logs[-200:]
