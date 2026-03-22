from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nanobot.config.loader import save_config, set_config_path
from nanobot.config.schema import Config
from nanobot.providers.base import LLMProvider, LLMResponse
from nanobot.web.api import create_app


def _runtime_dir() -> Path:
    raw = os.getenv("NANOBOT_E2E_RUNTIME_DIR", "")
    if raw:
        return Path(raw).expanduser().resolve()
    return (ROOT / "tmp" / "web-e2e-agent-knowledge-runtime").resolve()


def _prepare_runtime() -> Config:
    runtime_dir = _runtime_dir()
    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    config_path = runtime_dir / "config.json"
    workspace = runtime_dir / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)

    config = Config()
    config.agents.defaults.workspace = str(workspace)
    save_config(config, config_path)
    set_config_path(config_path)
    return config


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


def _fake_embed(texts: list[str], kb=None) -> list[list[float]]:
    del kb
    vocabulary = ("restart", "nanobot", "service", "health", "queue", "cache")
    return [[float(str(text or "").lower().count(token)) for token in vocabulary] for text in texts]


class DeterministicKnowledgeProvider(LLMProvider):
    async def chat(
        self,
        messages,
        tools=None,
        model=None,
        max_tokens=4096,
        temperature=0.7,
        reasoning_effort=None,
        tool_choice=None,
    ) -> LLMResponse:
        del tools, model, max_tokens, temperature, reasoning_effort, tool_choice
        full_prompt = "\n\n".join(str(item.get("content") or "") for item in messages if item.get("content") is not None)
        if "Use supervisorctl restart nanobot after checking service health." in full_prompt:
            return LLMResponse(
                content="根据绑定知识库，应先检查 service health，再执行 supervisorctl restart nanobot。",
            )
        return LLMResponse(content="NO_KNOWLEDGE")

    def get_default_model(self) -> str:
        return "deepseek/deepseek-chat"


def _patch_runtime(app) -> None:
    provider = DeterministicKnowledgeProvider()
    app.state.knowledge._embed_texts = _fake_embed  # type: ignore[method-assign]
    app.state.web.app_knowledge._embed_texts = _fake_embed  # type: ignore[attr-defined]
    app.state.web.config_runtime.make_provider = lambda config: provider


def build_app():
    config = _prepare_runtime()
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
    port = int(os.getenv("NANOBOT_E2E_API_PORT", "4175"))
    uvicorn.run(app, host=host, port=port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
