from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import uvicorn

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

def _ensure_stdlib_platform_module() -> None:
    import importlib
    import platform as loaded

    if hasattr(loaded, "python_implementation"):
        return

    sys.modules.pop("platform", None)
    for entry in list(sys.path):
        try:
            candidate = Path(entry) / "platform"
        except Exception:
            continue
        if candidate.is_dir() and (candidate / "__init__.py").exists():
            sys.path.remove(entry)
    importlib.invalidate_caches()
    reloaded = importlib.import_module("platform")
    if not hasattr(reloaded, "python_implementation"):
        raise RuntimeError("Failed to restore stdlib platform module; sys.path shadows platform.")


_ensure_stdlib_platform_module()

from nanobot.config.loader import save_config, set_config_path
from nanobot.config.schema import Config, MCPServerConfig
from nanobot.providers.base import LLMProvider, LLMResponse
from nanobot.web.api import create_app
from tests.knowledge_test_utils import FakeRAGEngine


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


def _fake_embed(texts: list[str], kb=None) -> list[list[float]]:
    del kb
    vocabulary = ("restart", "nanobot", "service", "health", "queue", "cache", "warmup", "reset")
    vectors: list[list[float]] = []
    for text in texts:
        normalized = str(text or "").lower()
        vector = [0.0] * 3072
        for index, token in enumerate(vocabulary):
            vector[index] = float(normalized.count(token))
        vectors.append(vector)
    return vectors


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
            return LLMResponse(content="根据绑定知识库，应先检查 service health，再执行 supervisorctl restart nanobot。")
        if "Run cache warmup first, then trigger the cache reset task." in full_prompt:
            return LLMResponse(content="先运行 cache warmup，再触发 cache reset 任务。")
        return LLMResponse(content="NO_KNOWLEDGE")

    def get_default_model(self) -> str:
        return "deepseek/deepseek-chat"


def _patch_rag_engine(service, provider: DeterministicKnowledgeProvider) -> None:
    rag_engine = getattr(service, "rag_engine", None)
    if rag_engine is None:
        return

    def _build_embedding_func():
        import numpy as np
        from lightrag.utils import EmbeddingFunc

        async def _embed(texts: list[str]) -> list[list[float]]:
            return np.asarray(_fake_embed(texts), dtype=float)

        return EmbeddingFunc(
            embedding_dim=len(_fake_embed([""])[0]),
            max_token_size=getattr(rag_engine, "_embedding_max_tokens", 8192),
            func=_embed,
        )

    def _build_llm_func():
        async def _llm(prompt: str, system_prompt: str | None = None, history_messages: list | None = None, **kwargs):
            del kwargs
            messages: list[dict[str, str]] = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            if history_messages:
                messages.extend(history_messages)
            messages.append({"role": "user", "content": prompt})
            response = await provider.chat(messages)
            return response.content or ""

        return _llm

    rag_engine._build_embedding_func = _build_embedding_func  # type: ignore[method-assign]
    rag_engine._build_llm_func = _build_llm_func  # type: ignore[method-assign]


def _patch_runtime(app) -> None:
    import litellm

    state = app.state.web
    provider = DeterministicKnowledgeProvider()
    fake_rag = FakeRAGEngine()

    async def fake_aembedding(**kwargs):
        texts = list(kwargs.get("input") or [])
        return SimpleNamespace(
            data=[{"embedding": vector} for vector in _fake_embed(texts)],
        )

    async def fake_acompletion(**kwargs):
        messages = list(kwargs.get("messages") or [])
        response = await provider.chat(messages)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=response.content or ""),
                )
            ],
        )

    litellm.aembedding = fake_aembedding  # type: ignore[assignment]
    litellm.acompletion = fake_acompletion  # type: ignore[assignment]

    app.state.knowledge._embed_texts = _fake_embed  # type: ignore[method-assign]
    app.state.knowledge.rag_engine = fake_rag  # type: ignore[assignment]
    state.app_knowledge._embed_texts = _fake_embed  # type: ignore[attr-defined]
    state.app_knowledge.rag_engine = fake_rag  # type: ignore[assignment]
    state.config_runtime.make_provider = lambda config: provider

    async def fake_chat(
        session_id: str,
        content: str,
        on_progress,
        *,
        display_content: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        on_stream=None,
        reasoning_effort: str | None = None,
    ) -> dict[str, Any]:
        del reasoning_effort
        session = state.sessions.get_or_create(state._session_key(session_id))
        if not session.metadata.get("title"):
            session.metadata["title"] = state._default_title(display_content or content)
        session.add_message("user", display_content or content, attachments=attachments or [])
        await on_progress("正在读取 E2E 固定回复")
        reply = f"E2E mock 已收到：{content}"
        if on_stream is not None:
            await on_stream(reply)
        session.add_message("assistant", reply)
        state.sessions.save(session)
        return {
            "content": reply,
            "message": state.get_last_assistant_message(session_id),
        }

    async def fake_agent_chat(
        agent_id: str,
        session_id: str,
        content: str,
        on_progress,
        *,
        tenant_id: str | None = None,
        display_content: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        on_stream=None,
        reasoning_effort: str | None = None,
    ) -> dict[str, Any]:
        del reasoning_effort
        session_key = state.agent_chat_runtime.session_key(agent_id, session_id)
        session = state.sessions.get_or_create(session_key)
        if not session.metadata.get("title"):
            session.metadata["title"] = state._default_title(display_content or content)
            session.metadata["agentId"] = agent_id
        session.add_message("user", display_content or content, attachments=attachments or [])
        await on_progress("正在读取 E2E 固定回复")
        reply = f"E2E mock 已收到：{content}"
        if on_stream is not None:
            await on_stream(reply)
        session.add_message("assistant", reply)
        state.sessions.save(session)
        assistant_message = state.get_last_agent_assistant_message(agent_id, session_id, tenant_id=tenant_id)
        return {
            "content": reply,
            "message": assistant_message,
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
    state.chat_with_agent = fake_agent_chat
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
