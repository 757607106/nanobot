"""Compatibility entrypoints for the nanobot Web API.

The main FastAPI implementation now lives in `nanobot.web.app`.
This module intentionally stays thin so existing imports from
`nanobot.web.api` continue to work while the codebase is being split.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from nanobot.config.schema import Config
from nanobot.web.app import WebAppState, create_app
from nanobot.web.frontend import (
    _frontend_dev_is_ready,
    _resolve_frontend_source_dir,
    _resolve_npm_command,
    _run_frontend_dev_server as _frontend_run_frontend_dev_server,
    _run_static_server as _frontend_run_static_server,
)


def run_server(
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
        _run_frontend_dev_server(config, host, port, frontend_dir, npm_command)
        return

    if frontend_mode == "auto" and dev_ready:
        _run_frontend_dev_server(config, host, port, frontend_dir, npm_command)
        return

    if frontend_mode == "auto" and dev_reason:
        from loguru import logger

        logger.info("Frontend dev mode unavailable ({}); falling back to static bundle.", dev_reason)

    _run_static_server(config, host, port)


def _run_static_server(config: Config, host: str, port: int) -> None:
    _frontend_run_static_server(create_app, config, host, port)


def _run_frontend_dev_server(
    config: Config,
    host: str,
    port: int,
    frontend_dir: Path,
    npm_command: str,
) -> None:
    _frontend_run_frontend_dev_server(create_app, config, host, port, frontend_dir, npm_command)


__all__ = [
    "WebAppState",
    "create_app",
    "run_server",
    "_frontend_dev_is_ready",
    "_resolve_frontend_source_dir",
    "_resolve_npm_command",
    "_run_static_server",
    "_run_frontend_dev_server",
]
