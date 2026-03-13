from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nanobot.config.loader import save_config, set_config_path
from nanobot.config.schema import Config, MCPServerConfig
from nanobot.web.api import create_app


def _runtime_dir() -> Path:
    raw = os.getenv("NANOBOT_E2E_RUNTIME_DIR", "")
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path(__file__).resolve().parent.parent / "tmp" / "web-e2e-runtime").resolve()


def _prepare_runtime() -> tuple[Config, Path]:
    runtime_dir = _runtime_dir()
    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    config_path = runtime_dir / "config.json"
    workspace = runtime_dir / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)

    config = Config()
    config.agents.defaults.workspace = str(workspace)
    config.tools.mcp_servers["fixture-mcp"] = MCPServerConfig(
        enabled=False,
        command="node",
        args=["server.js"],
        env={},
        tool_timeout=30,
    )
    save_config(config, config_path)
    set_config_path(config_path)

    registry_payload = {
        "version": 1,
        "entries": {
            "fixture-mcp": {
                "display_name": "Fixture MCP",
                "source_kind": "manual",
                "source_label": "E2E Fixture",
                "repo_url": "https://github.com/acme/fixture-mcp",
                "required_env": ["FIXTURE_TOKEN"],
                "tool_names": ["fixture_search", "fixture_read"],
                "tool_count": 2,
                "last_tool_sync_at": "2026-03-13T12:30:00Z",
                "updated_at": "2026-03-13T12:30:00Z",
            }
        },
    }
    (runtime_dir / "web-mcp-registry.json").write_text(
        json.dumps(registry_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return config, runtime_dir


def _resolve_static_dir() -> Path:
    if os.getenv("NANOBOT_E2E_BUILD_FRONTEND", "").strip() != "1":
        return _runtime_dir() / "missing-static"

    web_ui_dir = ROOT / "web-ui"
    env = os.environ.copy()
    env.pop("NANOBOT_API_ORIGIN", None)
    subprocess.run(
        ["npm", "run", "build"],
        cwd=web_ui_dir,
        env=env,
        check=True,
    )
    return web_ui_dir / "dist"


def _patch_runtime(app) -> None:
    state = app.state.web

    async def fake_chat(session_id: str, content: str, on_progress) -> dict[str, Any]:
        session = state.sessions.get_or_create(state._session_key(session_id))
        if not session.metadata.get("title"):
            session.metadata["title"] = state._default_title(content)
        session.add_message("user", content)
        await on_progress("正在读取 E2E 固定回复")
        reply = f"E2E mock 已收到：{content}"
        session.add_message("assistant", reply)
        state.sessions.save(session)
        return {
            "content": reply,
            "assistantMessage": state.get_last_assistant_message(session_id),
        }

    async def fake_mcp_test(server_name: str, content: str, on_progress) -> dict[str, Any]:
        session = state.sessions.get_or_create(state._mcp_test_session_key(server_name))
        if not session.metadata.get("title"):
            session.metadata["title"] = f"MCP Test · {server_name}"
        session.add_message("user", content)
        await on_progress("正在执行 MCP fixture 测试")
        reply = f"{server_name} fixture 回应：{content}"
        session.add_message("assistant", reply)
        state.sessions.save(session)
        payload = state.get_mcp_test_chat(server_name)
        assistant_message = next(
            (message for message in reversed(payload["messages"]) if message["role"] == "assistant"),
            None,
        )
        return {
            "content": reply,
            "assistantMessage": assistant_message,
            "session": payload["session"],
            "messages": payload["messages"],
            "toolNames": payload["toolNames"],
            "recentToolActivity": payload["recentToolActivity"],
        }

    state.chat = fake_chat
    state.chat_with_mcp_test = fake_mcp_test


def build_app():
    config, _runtime = _prepare_runtime()
    app = create_app(config, static_dir=_resolve_static_dir())
    original_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def patched_lifespan(inner_app):
        async with original_lifespan(inner_app):
            _patch_runtime(inner_app)
            yield

    app.router.lifespan_context = patched_lifespan
    return app


app = build_app()


def main() -> None:
    host = os.getenv("NANOBOT_E2E_API_HOST", "127.0.0.1")
    port = int(os.getenv("NANOBOT_E2E_API_PORT", "8015"))
    uvicorn.run(app, host=host, port=port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
