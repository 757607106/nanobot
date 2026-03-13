"""Frontend serving and dev-server helpers for the nanobot Web UI."""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Literal

import uvicorn
from fastapi.responses import FileResponse, HTMLResponse
from loguru import logger

from nanobot.config.schema import Config


def _resolve_static_dir() -> Path | None:
    possible_static_dirs = [
        Path(__file__).resolve().parent.parent.parent / "web-ui" / "dist",
        Path(__file__).resolve().parent / "static",
    ]
    return next((path for path in possible_static_dirs if path.exists()), None)


def _resolve_frontend_source_dir() -> Path | None:
    candidate = Path(__file__).resolve().parent.parent.parent / "web-ui"
    if (candidate / "package.json").exists() and (candidate / "src").exists():
        return candidate
    return None


def _resolve_npm_command() -> str | None:
    candidates = ["npm.cmd", "npm"] if os.name == "nt" else ["npm"]
    return next((cmd for cmd in candidates if shutil.which(cmd)), None)


def _frontend_dev_is_ready(frontend_dir: Path | None, npm_command: str | None) -> tuple[bool, str]:
    if frontend_dir is None:
        return False, "frontend source not found"
    if npm_command is None:
        return False, "npm not found"
    if not (frontend_dir / "node_modules").exists():
        return False, "web-ui dependencies missing"
    return True, ""


def _frontend_missing_response() -> HTMLResponse:
    return HTMLResponse(
        (
            "<html><body><h1>nanobot Web UI</h1>"
            "<p>Frontend has not been built yet. "
            "Run <code>cd web-ui && npm install && npm run build</code> for a static bundle, "
            "or start from the source checkout with <code>python -m nanobot web-ui</code> to use "
            "the Vite dev server with hot reload.</p>"
            "</body></html>"
        ),
        status_code=200,
    )


def _static_response(static_dir: Path | None, path: str) -> HTMLResponse | FileResponse:
    if not static_dir or not static_dir.exists():
        return _frontend_missing_response()

    relative = path.lstrip("/") or "index.html"
    root = static_dir.resolve()
    target = (root / relative).resolve()
    if not target.exists() or not target.is_file() or not target.is_relative_to(root):
        target = root / "index.html"

    if not target.exists():
        return _frontend_missing_response()

    return FileResponse(target)


def _find_available_port(host: str, preferred_port: int) -> int:
    def _bind(port: int) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((host, port))
            return int(sock.getsockname()[1])

    try:
        return _bind(preferred_port)
    except OSError:
        return _bind(0)


def _start_background_server(app: Any, host: str, port: int) -> tuple[uvicorn.Server, threading.Thread]:
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=host,
            port=port,
            access_log=False,
        )
    )
    thread = threading.Thread(target=server.run, name="nanobot-web-ui-api", daemon=True)
    thread.start()

    deadline = time.time() + 10
    while time.time() < deadline:
        if getattr(server, "started", False):
            return server, thread
        if not thread.is_alive():
            break
        time.sleep(0.05)

    server.should_exit = True
    thread.join(timeout=1)
    raise RuntimeError(f"Failed to start nanobot Web UI API on http://{host}:{port}.")


def _stop_background_server(server: uvicorn.Server, thread: threading.Thread) -> None:
    server.should_exit = True
    thread.join(timeout=5)
    if thread.is_alive():
        server.force_exit = True
        thread.join(timeout=1)


def _terminate_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return

    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _run_static_server(create_app: Callable[..., Any], config: Config, host: str, port: int) -> None:
    static_dir = _resolve_static_dir()
    logger.info("nanobot Web UI running at http://{}:{}", host, port)
    if static_dir is None:
        logger.info("No built frontend found. API is available at /api/v1/*.")
    else:
        logger.info("Serving static files from {}", static_dir)

    uvicorn.run(
        create_app(config, static_dir=static_dir),
        host=host,
        port=port,
        access_log=False,
    )


def _run_frontend_dev_server(
    create_app: Callable[..., Any],
    config: Config,
    host: str,
    port: int,
    frontend_dir: Path,
    npm_command: str,
) -> None:
    api_host = "127.0.0.1"
    api_port = _find_available_port(api_host, port + 1)
    logger.info("nanobot Web UI dev mode enabled with hot reload")
    logger.info("Starting API backend on http://{}:{}", api_host, api_port)
    server, thread = _start_background_server(create_app(config), host=api_host, port=api_port)

    env = os.environ.copy()
    env["NANOBOT_API_ORIGIN"] = f"http://{api_host}:{api_port}"
    command = [
        npm_command,
        "run",
        "dev",
        "--",
        "--host",
        host,
        "--port",
        str(port),
        "--strictPort",
    ]
    logger.info("Starting Vite dev server on http://{}:{} from {}", host, port, frontend_dir)

    process = subprocess.Popen(command, cwd=frontend_dir, env=env)
    return_code: int | None = None
    try:
        return_code = process.wait()
    except KeyboardInterrupt:
        logger.info("Shutting down nanobot Web UI...")
    finally:
        _terminate_process(process)
        _stop_background_server(server, thread)

    if return_code not in (None, 0):
        raise RuntimeError(f"Vite dev server exited with status {return_code}.")


def run_web_server(
    create_app: Callable[..., Any],
    config: Config,
    host: str = "127.0.0.1",
    port: int = 6788,
    frontend_mode: Literal["auto", "static", "dev"] = "auto",
) -> None:
    """Run the Web UI server in static or hot-reload dev mode."""
    frontend_dir = _resolve_frontend_source_dir()
    npm_command = _resolve_npm_command()
    dev_ready, dev_reason = _frontend_dev_is_ready(frontend_dir, npm_command)

    if frontend_mode == "dev":
        if not dev_ready:
            raise RuntimeError(
                "Frontend dev mode requires the web-ui source checkout, npm, and installed "
                "dependencies. Run `cd web-ui && npm install` first."
            )
        _run_frontend_dev_server(create_app, config, host, port, frontend_dir, npm_command)
        return

    if frontend_mode == "auto" and dev_ready:
        _run_frontend_dev_server(create_app, config, host, port, frontend_dir, npm_command)
        return

    if frontend_mode == "auto" and dev_reason:
        logger.info("Frontend dev mode unavailable ({}); falling back to static bundle.", dev_reason)

    _run_static_server(create_app, config, host, port)
