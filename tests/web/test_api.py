from __future__ import annotations

import asyncio
import json
import shutil
import time
import zipfile
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from nanobot.config import loader as config_loader
from nanobot.config.loader import save_config
from nanobot.config.schema import Config, MCPServerConfig
from nanobot.platform.agents import AgentDefinitionStore
from nanobot.platform.runs import RunControlScope, RunKind, RunResultSummary
from nanobot.providers.base import LLMResponse, ToolCallRequest
from nanobot.session.manager import SessionManager
from tests.knowledge_test_utils import FakeRAGEngine
from nanobot.web.api import create_app, run_server
from nanobot.web.services import operations as web_operations

AUTH_USERNAME = "admin"
AUTH_PASSWORD = "bootstrap-pass-123"


def _make_test_config(tmp_path, monkeypatch) -> Config:
    config_path = tmp_path / "config.json"
    workspace = tmp_path / "workspace"
    config = Config()
    config.agents.defaults.workspace = str(workspace)
    save_config(config, config_path)
    monkeypatch.setattr(config_loader, "_current_config_path", config_path)
    return config


def _bootstrap_admin(client: TestClient, username: str = AUTH_USERNAME, password: str = AUTH_PASSWORD) -> None:
    response = client.post(
        "/api/v1/auth/bootstrap",
        json={"username": username, "password": password},
    )
    assert response.status_code == 201
    assert response.json()["data"]["authenticated"] is True


def _create_tenant_api_headers(
    client: TestClient,
    *,
    tenant_id: str,
    name: str,
) -> dict[str, str]:
    created = client.post(
        "/api/v1/tenants",
        headers={"x-tenant-id": tenant_id},
        json={"tenantId": tenant_id, "name": name},
    )
    assert created.status_code == 201
    api_key = client.post(
        f"/api/v1/tenants/{tenant_id}/api-keys",
        headers={"x-tenant-id": tenant_id},
        json={"name": f"{name} key"},
    )
    assert api_key.status_code == 201
    raw_key = api_key.json()["data"]["key"]
    return {
        "x-api-key": raw_key,
        "x-tenant-id": tenant_id,
    }


def _write_fixture_mcp_repo(repo_dir, *, package_name: str = "@acme/filesystem-mcp") -> None:
    (repo_dir / "bin").mkdir(parents=True, exist_ok=True)
    (repo_dir / "bin" / "server.js").write_text(
        "#!/usr/bin/env node\nconsole.log('mcp server fixture')\n",
        encoding="utf-8",
    )
    (repo_dir / "package.json").write_text(
        json.dumps(
            {
                "name": package_name,
                "version": "0.1.0",
                "bin": {"filesystem-mcp": "bin/server.js"},
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    (repo_dir / "package-lock.json").write_text(
        json.dumps({"name": package_name, "lockfileVersion": 3}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (repo_dir / ".env.example").write_text("MCP_API_KEY=\nOPTIONAL_TOKEN=\n", encoding="utf-8")


def _wait_for_knowledge_ingest(
    web_client: TestClient,
    *,
    kb_id: str,
    doc_id: str,
    job_id: str,
    timeout: float = 5.0,
) -> tuple[dict, dict]:
    deadline = time.monotonic() + timeout
    last_document = None
    last_job = None
    while time.monotonic() < deadline:
        documents = web_client.get(f"/api/v1/knowledge-bases/{kb_id}/documents")
        jobs = web_client.get(f"/api/v1/knowledge-bases/{kb_id}/jobs")
        assert documents.status_code == 200
        assert jobs.status_code == 200
        last_document = next((item for item in documents.json()["data"] if item["docId"] == doc_id), None)
        last_job = next((item for item in jobs.json()["data"] if item["jobId"] == job_id), None)
        if (
            last_document
            and last_job
            and last_document["docStatus"] in {"indexed", "error_parsing", "error_indexing", "error_kg"}
            and last_job["status"] in {"succeeded", "failed"}
        ):
            return last_document, last_job
        time.sleep(0.05)
    raise AssertionError(
        f"Knowledge ingest did not finish within {timeout}s. "
        f"Last document={last_document!r}, last job={last_job!r}"
    )


@pytest.fixture
def anonymous_web_client(tmp_path, monkeypatch):
    config = _make_test_config(tmp_path, monkeypatch)
    monkeypatch.setattr("nanobot.web.app.create_rag_engine_from_config", lambda config, instance_dir: FakeRAGEngine())
    monkeypatch.setattr(
        "nanobot.web.runtime_services.config.create_rag_engine_from_config",
        lambda config, instance_dir: FakeRAGEngine(),
    )

    app = create_app(config, static_dir=tmp_path / "missing-static")
    with TestClient(app) as client:
        yield client


@pytest.fixture
def web_client(anonymous_web_client: TestClient):
    _bootstrap_admin(anonymous_web_client)
    yield anonymous_web_client


def test_web_api_auth_bootstrap_login_logout_and_guard(anonymous_web_client: TestClient) -> None:
    status = anonymous_web_client.get("/api/v1/auth/status")
    assert status.status_code == 200
    assert status.json()["data"] == {
        "initialized": False,
        "authenticated": False,
        "username": None,
    }

    guarded = anonymous_web_client.get("/api/v1/system/status")
    assert guarded.status_code == 401
    assert guarded.json()["error"]["code"] == "AUTH_REQUIRED"

    bootstrap = anonymous_web_client.post(
        "/api/v1/auth/bootstrap",
        json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD},
    )
    assert bootstrap.status_code == 201
    assert bootstrap.json()["data"] == {
        "initialized": True,
        "authenticated": True,
        "username": AUTH_USERNAME,
    }

    duplicate_bootstrap = anonymous_web_client.post(
        "/api/v1/auth/bootstrap",
        json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD},
    )
    assert duplicate_bootstrap.status_code == 409
    assert duplicate_bootstrap.json()["error"]["code"] == "AUTH_ALREADY_INITIALIZED"

    logout = anonymous_web_client.post("/api/v1/auth/logout")
    assert logout.status_code == 200
    assert logout.json()["data"] == {
        "initialized": True,
        "authenticated": False,
        "username": None,
    }

    guarded_after_logout = anonymous_web_client.get("/api/v1/system/status")
    assert guarded_after_logout.status_code == 401

    failed_login = anonymous_web_client.post(
        "/api/v1/auth/login",
        json={"username": AUTH_USERNAME, "password": "wrong-pass-123"},
    )
    assert failed_login.status_code == 401
    assert failed_login.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"

    login = anonymous_web_client.post(
        "/api/v1/auth/login",
        json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD},
    )
    assert login.status_code == 200
    assert login.json()["data"] == {
        "initialized": True,
        "authenticated": True,
        "username": AUTH_USERNAME,
    }

    status_after_login = anonymous_web_client.get("/api/v1/auth/status")
    assert status_after_login.status_code == 200
    assert status_after_login.json()["data"]["authenticated"] is True


def test_web_api_auth_session_does_not_survive_restart(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as first_client:
        _bootstrap_admin(first_client)
        session_cookie = first_client.cookies.get("nanobot_web_session")
        assert session_cookie
        guarded = first_client.get("/api/v1/system/status")
        assert guarded.status_code == 200

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as restarted_client:
        restarted_client.cookies.set("nanobot_web_session", session_cookie)

        status = restarted_client.get("/api/v1/auth/status")
        assert status.status_code == 200
        assert status.json()["data"] == {
            "initialized": True,
            "authenticated": False,
            "username": None,
        }

        guarded = restarted_client.get("/api/v1/system/status")
        assert guarded.status_code == 401
        assert guarded.json()["error"]["code"] == "AUTH_REQUIRED"


def test_web_api_setup_wizard_progress_and_resume(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    static_dir = tmp_path / "missing-static"

    with TestClient(create_app(config, static_dir=static_dir)) as client:
        _bootstrap_admin(client)

        initial_status = client.get("/api/v1/setup/status")
        assert initial_status.status_code == 200
        assert initial_status.json()["data"]["completed"] is False
        assert initial_status.json()["data"]["currentStep"] == "provider"

        provider_step = client.put(
            "/api/v1/setup/provider",
            json={
                "provider": "deepseek",
                "model": "deepseek/deepseek-chat",
                "apiKey": "sk-setup-test",
                "apiBase": "https://api.deepseek.com",
            },
        )
        assert provider_step.status_code == 200
        assert provider_step.json()["data"]["setup"]["currentStep"] == "channel"
        assert provider_step.json()["data"]["config"]["agents"]["defaults"]["provider"] == "deepseek"

    with TestClient(create_app(config, static_dir=static_dir)) as restarted_client:
        login = restarted_client.post(
            "/api/v1/auth/login",
            json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD},
        )
        assert login.status_code == 200

        resumed_status = restarted_client.get("/api/v1/setup/status")
        assert resumed_status.status_code == 200
        assert resumed_status.json()["data"]["currentStep"] == "channel"

        channel_step = restarted_client.put(
            "/api/v1/setup/channel",
            json={"mode": "skip"},
        )
        assert channel_step.status_code == 200
        assert channel_step.json()["data"]["setup"]["currentStep"] == "agent"

        agent_step = restarted_client.put(
            "/api/v1/setup/agent-defaults",
            json={
                "workspace": str(tmp_path / "wizard-workspace"),
                "maxTokens": 4096,
                "contextWindowTokens": 128000,
                "temperature": 0.4,
                "maxToolIterations": 18,
                "reasoningEffort": "medium",
            },
        )
        assert agent_step.status_code == 200
        assert agent_step.json()["data"]["setup"]["completed"] is True

        config_after_setup = restarted_client.get("/api/v1/config")
        assert config_after_setup.status_code == 200
        defaults = config_after_setup.json()["data"]["agents"]["defaults"]
        assert defaults["workspace"] == str(tmp_path / "wizard-workspace")
        assert defaults["maxTokens"] == 4096
        assert defaults["contextWindowTokens"] == 128000
        assert defaults["temperature"] == 0.4
        assert defaults["maxToolIterations"] == 18


def test_web_api_channels_list_detail_and_update(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    config.channels.send_progress = True
    config.channels.send_tool_hints = False
    config.channels.telegram.enabled = True
    config.channels.telegram.token = "tg-token"
    config.channels.telegram.allow_from = ["alice"]
    save_config(config, config_loader._current_config_path)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        listed = client.get("/api/v1/channels")
        assert listed.status_code == 200
        listed_payload = listed.json()["data"]
        assert listed_payload["delivery"] == {
            "sendProgress": True,
            "sendToolHints": False,
            "sendMaxRetries": 3,
        }
        items = {item["name"]: item for item in listed_payload["items"]}
        assert items["telegram"]["status"] == "enabled"
        assert items["telegram"]["configured"] is True
        assert items["discord"]["status"] == "unconfigured"
        assert items["weixin"]["status"] == "unconfigured"

        detail = client.get("/api/v1/channels/telegram")
        assert detail.status_code == 200
        detail_payload = detail.json()["data"]
        assert detail_payload["channel"]["name"] == "telegram"
        assert detail_payload["config"]["token"] == "tg-token"
        assert detail_payload["config"]["allowFrom"] == ["alice"]

        weixin_detail = client.get("/api/v1/channels/weixin")
        assert weixin_detail.status_code == 200
        weixin_payload = weixin_detail.json()["data"]
        assert weixin_payload["channel"]["name"] == "weixin"
        assert weixin_payload["config"]["enabled"] is False
        assert weixin_payload["config"]["allowFrom"] == []

        update_channel = client.put(
            "/api/v1/channels/telegram",
            json={
                "enabled": False,
                "token": "tg-token",
                "allowFrom": ["alice", "bob"],
                "groupPolicy": "mention",
                "replyToMessage": True,
            },
        )
        assert update_channel.status_code == 200
        updated_channel = update_channel.json()["data"]
        assert updated_channel["channel"]["status"] == "configured"
        assert updated_channel["config"]["allowFrom"] == ["alice", "bob"]
        assert updated_channel["config"]["replyToMessage"] is True

        update_delivery = client.put(
            "/api/v1/channels/delivery",
            json={"sendProgress": False, "sendToolHints": True},
        )
        assert update_delivery.status_code == 200
        assert update_delivery.json()["data"]["delivery"] == {
            "sendProgress": False,
            "sendToolHints": True,
            "sendMaxRetries": 3,
        }

        missing_channel = client.get("/api/v1/channels/not-real")
        assert missing_channel.status_code == 404
        assert missing_channel.json()["error"]["code"] == "CHANNEL_NOT_FOUND"


def test_web_api_channels_mark_allow_from_as_required_when_runtime_needs_it(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    config.channels.qq.enabled = True
    config.channels.qq.app_id = "qq-app"
    config.channels.qq.secret = "qq-secret"
    config.channels.qq.allow_from = []
    config.channels.feishu.enabled = True
    config.channels.feishu.app_id = "cli_aabbcc"
    config.channels.feishu.app_secret = "feishu-secret"
    config.channels.feishu.allow_from = []
    save_config(config, config_loader._current_config_path)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        listed = client.get("/api/v1/channels")
        assert listed.status_code == 200
        items = {item["name"]: item for item in listed.json()["data"]["items"]}

        assert items["qq"]["status"] == "incomplete"
        assert items["qq"]["missingRequiredFields"] == ["allowFrom"]
        assert items["feishu"]["status"] == "incomplete"
        assert items["feishu"]["missingRequiredFields"] == ["allowFrom"]


def test_web_api_channel_test_endpoint_accepts_draft_payload(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        client.app.state.channel_tests.probe_channel = AsyncMock(
            return_value={
                "channelName": "telegram",
                "status": "passed",
                "statusLabel": "测试通过",
                "summary": "Telegram Token 校验通过。",
                "detail": "Draft payload is valid.",
                "bindingRequired": False,
                "checkedAt": "2026-03-13T12:00:00Z",
                "checks": [
                    {
                        "key": "token",
                        "label": "Token 校验",
                        "status": "pass",
                        "detail": "当前 Token 可用。",
                    },
                ],
            }
        )

        tested = client.post(
            "/api/v1/channels/telegram/test",
            json={
                "enabled": True,
                "token": "draft-token",
                "allowFrom": ["alice"],
            },
        )
        assert tested.status_code == 200
        assert tested.json()["data"]["status"] == "passed"
        kwargs = client.app.state.channel_tests.probe_channel.await_args.kwargs
        assert kwargs["channel_name"] == "telegram"
        assert kwargs["payload"]["token"] == "draft-token"


def test_web_app_exposes_default_instance_context(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        assert client.app.state.instance.config_path == config_loader._current_config_path.resolve()
        assert client.app.state.instance.mcp_installs_dir() == config_loader._current_config_path.parent / "mcp-installs"


def test_web_api_whatsapp_bind_endpoints_accept_status_start_and_stop(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        client.app.state.whatsapp_binding.status = lambda _config: {
            "channelName": "whatsapp",
            "bridgeUrl": "ws://127.0.0.1:3001",
            "bridgeInstalled": True,
            "bridgeDir": "/tmp/bridge",
            "running": False,
            "pid": None,
            "authDir": "/tmp/auth",
            "authPresent": False,
            "bindingRequired": True,
            "listenerConnected": False,
            "lastStatus": "stopped",
            "lastError": None,
            "qrCode": None,
            "qrUpdatedAt": None,
            "startedAt": None,
            "checkedAt": "2026-03-13T12:00:00Z",
            "recentLogs": [],
        }
        start_calls: list[dict[str, object]] = []
        stop_calls: list[bool] = []

        def fake_start(_config, payload):
            start_calls.append(payload)
            return {
                "channelName": "whatsapp",
                "bridgeUrl": "ws://127.0.0.1:3001",
                "bridgeInstalled": True,
                "bridgeDir": "/tmp/bridge",
                "running": True,
                "pid": 1234,
                "authDir": "/tmp/auth",
                "authPresent": False,
                "bindingRequired": True,
                "listenerConnected": True,
                "lastStatus": "qr",
                "lastError": None,
                "qrCode": "whatsapp://qr/test",
                "qrUpdatedAt": "2026-03-13T12:01:00Z",
                "startedAt": "2026-03-13T12:00:30Z",
                "checkedAt": "2026-03-13T12:01:00Z",
                "recentLogs": ["QR code refreshed"],
            }

        def fake_stop(_config):
            stop_calls.append(True)
            return {
                "channelName": "whatsapp",
                "bridgeUrl": "ws://127.0.0.1:3001",
                "bridgeInstalled": True,
                "bridgeDir": "/tmp/bridge",
                "running": False,
                "pid": None,
                "authDir": "/tmp/auth",
                "authPresent": False,
                "bindingRequired": True,
                "listenerConnected": False,
                "lastStatus": "stopped",
                "lastError": None,
                "qrCode": None,
                "qrUpdatedAt": None,
                "startedAt": "2026-03-13T12:00:30Z",
                "checkedAt": "2026-03-13T12:02:00Z",
                "recentLogs": ["Bridge stopped"],
            }

        client.app.state.whatsapp_binding.start = fake_start
        client.app.state.whatsapp_binding.stop = fake_stop

        status = client.get("/api/v1/channels/whatsapp/bind/status")
        assert status.status_code == 200
        assert status.json()["data"]["running"] is False

        started = client.post(
            "/api/v1/channels/whatsapp/bind/start",
            json={"bridgeUrl": "ws://127.0.0.1:3001", "bridgeToken": "bind-token"},
        )
        assert started.status_code == 200
        assert started.json()["data"]["running"] is True
        assert start_calls == [{"bridgeUrl": "ws://127.0.0.1:3001", "bridgeToken": "bind-token"}]

        stopped = client.post("/api/v1/channels/whatsapp/bind/stop")
        assert stopped.status_code == 200
        assert stopped.json()["data"]["lastStatus"] == "stopped"
        assert stop_calls == [True]


def test_web_api_profile_update_avatar_and_password_rotation_persist(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    static_dir = tmp_path / "missing-static"

    with TestClient(create_app(config, static_dir=static_dir)) as client:
        _bootstrap_admin(client)

        initial_session = client.cookies.get("nanobot_web_session")
        assert initial_session

        update_profile = client.put(
            "/api/v1/profile",
            json={
                "username": "owner",
                "displayName": "Console Owner",
                "email": "owner@example.com",
            },
        )
        assert update_profile.status_code == 200
        update_payload = update_profile.json()["data"]
        assert update_payload["profile"]["username"] == "owner"
        assert update_payload["profile"]["displayName"] == "Console Owner"
        assert update_payload["profile"]["email"] == "owner@example.com"
        assert update_payload["auth"]["username"] == "owner"

        renamed_session = client.cookies.get("nanobot_web_session")
        assert renamed_session
        assert renamed_session != initial_session

        avatar_upload = client.post(
            "/api/v1/profile/avatar",
            files={"file": ("avatar.png", b"\x89PNG\r\n\x1a\nprofile-avatar", "image/png")},
        )
        assert avatar_upload.status_code == 200
        avatar_profile = avatar_upload.json()["data"]["profile"]
        assert avatar_profile["hasAvatar"] is True
        assert avatar_profile["avatarUrl"].startswith("/api/v1/profile/avatar?v=")

        avatar_response = client.get("/api/v1/profile/avatar")
        assert avatar_response.status_code == 200
        assert avatar_response.headers["content-type"].startswith("image/png")
        assert avatar_response.content.startswith(b"\x89PNG")

        rotate_password = client.post(
            "/api/v1/profile/password",
            json={
                "currentPassword": AUTH_PASSWORD,
                "newPassword": "bootstrap-pass-456",
            },
        )
        assert rotate_password.status_code == 200
        assert rotate_password.json()["data"]["auth"]["username"] == "owner"

    with TestClient(create_app(config, static_dir=static_dir)) as restarted_client:
        old_login = restarted_client.post(
            "/api/v1/auth/login",
            json={"username": "owner", "password": AUTH_PASSWORD},
        )
        assert old_login.status_code == 401
        assert old_login.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"

        new_login = restarted_client.post(
            "/api/v1/auth/login",
            json={"username": "owner", "password": "bootstrap-pass-456"},
        )
        assert new_login.status_code == 200

        profile_response = restarted_client.get("/api/v1/profile")
        assert profile_response.status_code == 200
        profile_payload = profile_response.json()["data"]
        assert profile_payload["displayName"] == "Console Owner"
        assert profile_payload["email"] == "owner@example.com"
        assert profile_payload["hasAvatar"] is True

        avatar_response = restarted_client.get("/api/v1/profile/avatar")
        assert avatar_response.status_code == 200
        assert avatar_response.content.startswith(b"\x89PNG")

        delete_avatar = restarted_client.delete("/api/v1/profile/avatar")
        assert delete_avatar.status_code == 200
        assert delete_avatar.json()["data"]["profile"]["hasAvatar"] is False

        missing_avatar = restarted_client.get("/api/v1/profile/avatar")
        assert missing_avatar.status_code == 404
        assert missing_avatar.json()["error"]["code"] == "PROFILE_AVATAR_NOT_FOUND"


def test_web_api_mcp_registry_index_uses_existing_config_and_cached_metadata(
    tmp_path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "config.json"
    payload = {
        "agents": {
            "defaults": {
                "workspace": str(tmp_path / "workspace"),
            }
        },
        "tools": {
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": [
                        "-y",
                        "@modelcontextprotocol/server-filesystem",
                        str(tmp_path / "workspace"),
                    ],
                },
                "team-docs": {
                    "type": "streamableHttp",
                    "url": "https://mcp.example.com/tools",
                    "enabled": False,
                },
                "broken-local": {
                    "type": "stdio",
                    "args": ["missing-command"],
                    "toolTimeout": 15,
                },
            }
        },
    }
    config_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    monkeypatch.setattr(config_loader, "_current_config_path", config_path)

    registry_payload = {
        "version": 1,
        "entries": {
            "filesystem": {
                "display_name": "Workspace Files",
                "source_kind": "repository",
                "source_label": "仓库安装",
                "repo_url": "https://github.com/modelcontextprotocol/servers",
                "tool_count": 7,
                "last_tool_sync_at": "2026-03-13T12:30:00Z",
                "updated_at": "2026-03-13T12:29:00Z",
            }
        },
    }
    (tmp_path / "web-mcp-registry.json").write_text(
        json.dumps(registry_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    config = Config.model_validate(payload)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        response = client.get("/api/v1/mcp/servers")
        assert response.status_code == 200

    data = response.json()["data"]
    assert data["summary"] == {
        "total": 3,
        "enabled": 2,
        "disabled": 1,
        "ready": 1,
        "incomplete": 1,
        "knownToolCount": 7,
        "verifiedServers": 1,
    }

    items = {item["name"]: item for item in data["items"]}
    assert items["filesystem"]["displayName"] == "Workspace Files"
    assert items["filesystem"]["enabled"] is True
    assert items["filesystem"]["transport"] == "stdio"
    assert items["filesystem"]["status"] == "ready"
    assert items["filesystem"]["toolCount"] == 7
    assert items["filesystem"]["toolCountKnown"] is True
    assert items["filesystem"]["sourceKind"] == "repository"
    assert items["filesystem"]["repoUrl"] == "https://github.com/modelcontextprotocol/servers"

    assert items["team-docs"]["enabled"] is False
    assert items["team-docs"]["transport"] == "streamableHttp"
    assert items["team-docs"]["status"] == "disabled"

    assert items["broken-local"]["enabled"] is True
    assert items["broken-local"]["transport"] == "stdio"
    assert items["broken-local"]["status"] == "incomplete"
    assert items["broken-local"]["toolTimeout"] == 15
    assert items["broken-local"]["toolCount"] is None
    assert items["broken-local"]["toolCountKnown"] is False


def test_web_api_mcp_repository_inspect_and_install_with_fixture_repo(
    tmp_path,
    monkeypatch,
) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    fixture_repo = tmp_path / "fixture-repo"
    fixture_repo.mkdir()
    _write_fixture_mcp_repo(fixture_repo)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        def fake_clone(_clone_url: str, target_dir):
            shutil.copytree(fixture_repo, target_dir)

        def fake_install_step(command, *, cwd, timeout):
            assert cwd.exists()
            assert command in (["npm", "ci"], ["npm", "install"])
            assert timeout == 900

        monkeypatch.setattr(client.app.state.mcp_repository, "_clone_repository", fake_clone)
        monkeypatch.setattr(client.app.state.mcp_repository, "_run_install_step", fake_install_step)

        inspect_response = client.post(
            "/api/v1/mcp/repositories/inspect",
            json={"source": "https://github.com/acme/filesystem-mcp"},
        )
        assert inspect_response.status_code == 200
        analysis = inspect_response.json()["data"]
        assert analysis["serverName"] == "filesystem-mcp"
        assert analysis["installMode"] == "source"
        assert analysis["transport"] == "stdio"
        assert analysis["commandPreview"] == "node bin/server.js"
        assert analysis["installSteps"] == ["npm ci"]
        assert analysis["requiredEnv"] == ["MCP_API_KEY", "OPTIONAL_TOKEN"]
        assert analysis["canInstall"] is True

        install_response = client.post(
            "/api/v1/mcp/repositories/install",
            json={"source": "https://github.com/acme/filesystem-mcp"},
        )
        assert install_response.status_code == 201
        payload = install_response.json()["data"]
        assert payload["serverName"] == "filesystem-mcp"
        assert payload["enabled"] is False
        assert payload["installDir"].endswith("mcp-installs/acme__filesystem-mcp")
        assert payload["analysis"]["repoUrl"] == "https://github.com/acme/filesystem-mcp"
        assert payload["entry"]["sourceKind"] == "repository"
        assert payload["entry"]["repoUrl"] == "https://github.com/acme/filesystem-mcp"
        assert payload["entry"]["installMode"] == "source"
        assert payload["entry"]["installSteps"] == ["npm ci"]
        assert payload["entry"]["requiredEnv"] == ["MCP_API_KEY", "OPTIONAL_TOKEN"]
        assert payload["entry"]["enabled"] is False
        assert payload["config"]["tools"]["mcpServers"]["filesystem-mcp"]["enabled"] is False
        assert payload["config"]["tools"]["mcpServers"]["filesystem-mcp"]["command"] == "node"
        assert payload["config"]["tools"]["mcpServers"]["filesystem-mcp"]["args"][0].endswith(
            "mcp-installs/acme__filesystem-mcp/bin/server.js"
        )

        listed = client.get("/api/v1/mcp/servers")
        assert listed.status_code == 200
        items = {item["name"]: item for item in listed.json()["data"]["items"]}
        assert items["filesystem-mcp"]["sourceKind"] == "repository"
        assert items["filesystem-mcp"]["enabled"] is False


def test_web_api_mcp_repository_install_rejects_duplicate_repo(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    fixture_repo = tmp_path / "fixture-repo"
    fixture_repo.mkdir()
    _write_fixture_mcp_repo(fixture_repo)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        def fake_clone(_clone_url: str, target_dir):
            shutil.copytree(fixture_repo, target_dir)

        monkeypatch.setattr(client.app.state.mcp_repository, "_clone_repository", fake_clone)
        monkeypatch.setattr(
            client.app.state.mcp_repository,
            "_run_install_step",
            lambda command, *, cwd, timeout: None,
        )

        first = client.post(
            "/api/v1/mcp/repositories/install",
            json={"source": "https://github.com/acme/filesystem-mcp"},
        )
        assert first.status_code == 201

        duplicate = client.post(
            "/api/v1/mcp/repositories/install",
            json={"source": "https://github.com/acme/filesystem-mcp"},
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["error"]["code"] == "MCP_REPOSITORY_DUPLICATE"


def test_web_api_mcp_server_probe_update_toggle_and_delete(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    fixture_repo = tmp_path / "fixture-repo"
    fixture_repo.mkdir()
    _write_fixture_mcp_repo(fixture_repo)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        def fake_clone(_clone_url: str, target_dir):
            shutil.copytree(fixture_repo, target_dir)

        monkeypatch.setattr(client.app.state.mcp_repository, "_clone_repository", fake_clone)
        monkeypatch.setattr(
            client.app.state.mcp_repository,
            "_run_install_step",
            lambda command, *, cwd, timeout: None,
        )

        install_response = client.post(
            "/api/v1/mcp/repositories/install",
            json={"source": "https://github.com/acme/filesystem-mcp"},
        )
        assert install_response.status_code == 201

        blocked_probe = client.post("/api/v1/mcp/servers/filesystem-mcp/probe")
        assert blocked_probe.status_code == 200
        assert blocked_probe.json()["data"]["status"] == "blocked"
        assert blocked_probe.json()["data"]["missingEnv"] == ["MCP_API_KEY", "OPTIONAL_TOKEN"]

        install_dir = install_response.json()["data"]["installDir"]
        update_response = client.put(
            "/api/v1/mcp/servers/filesystem-mcp",
            json={
                "displayName": "Workspace Files",
                "enabled": False,
                "type": "stdio",
                "command": "node",
                "args": [f"{install_dir}/bin/server.js"],
                "env": {
                    "MCP_API_KEY": "secret-key",
                    "OPTIONAL_TOKEN": "optional-secret",
                },
                "url": None,
                "headers": {},
                "toolTimeout": 45,
            },
        )
        assert update_response.status_code == 200
        assert update_response.json()["data"]["entry"]["displayName"] == "Workspace Files"
        assert update_response.json()["data"]["entry"]["toolTimeout"] == 45
        assert update_response.json()["data"]["entry"]["env"]["MCP_API_KEY"] == "secret-key"

        async def fake_list_tools(_cfg):
            return ["read_file", "list_dir"]

        monkeypatch.setattr(client.app.state.mcp_servers, "_list_server_tools", fake_list_tools)

        success_probe = client.post("/api/v1/mcp/servers/filesystem-mcp/probe")
        assert success_probe.status_code == 200
        probe_data = success_probe.json()["data"]
        assert probe_data["ok"] is True
        assert probe_data["status"] == "passed"
        assert probe_data["toolNames"] == ["read_file", "list_dir"]
        assert probe_data["entry"]["toolCount"] == 2
        assert probe_data["entry"]["lastProbeStatus"] == "passed"

        toggle_response = client.post(
            "/api/v1/mcp/servers/filesystem-mcp/enabled",
            json={"enabled": True},
        )
        assert toggle_response.status_code == 200
        assert toggle_response.json()["data"]["enabled"] is True
        assert toggle_response.json()["data"]["entry"]["enabled"] is True

        detail_response = client.get("/api/v1/mcp/servers/filesystem-mcp")
        assert detail_response.status_code == 200
        detail_data = detail_response.json()["data"]
        assert detail_data["displayName"] == "Workspace Files"
        assert detail_data["toolNames"] == ["read_file", "list_dir"]
        assert detail_data["env"]["OPTIONAL_TOKEN"] == "optional-secret"

        delete_response = client.delete("/api/v1/mcp/servers/filesystem-mcp")
        assert delete_response.status_code == 200
        assert delete_response.json()["data"]["deleted"] is True
        assert delete_response.json()["data"]["checkoutRemoved"] is True

        list_response = client.get("/api/v1/mcp/servers")
        assert list_response.status_code == 200
        assert list_response.json()["data"]["items"] == []


def test_web_api_mcp_repair_plan_explains_missing_env_and_blocks_dangerous_mode(
    tmp_path,
    monkeypatch,
) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    fixture_repo = tmp_path / "fixture-repo"
    fixture_repo.mkdir()
    _write_fixture_mcp_repo(fixture_repo)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        monkeypatch.setattr(
            client.app.state.mcp_repository,
            "_clone_repository",
            lambda _clone_url, target_dir: shutil.copytree(fixture_repo, target_dir),
        )
        monkeypatch.setattr(
            client.app.state.mcp_repository,
            "_run_install_step",
            lambda command, *, cwd, timeout: None,
        )

        installed = client.post(
            "/api/v1/mcp/repositories/install",
            json={"source": "https://github.com/acme/filesystem-mcp"},
        )
        assert installed.status_code == 201

        plan = client.get("/api/v1/mcp/servers/filesystem-mcp/repair-plan")
        assert plan.status_code == 200
        payload = plan.json()["data"]
        assert payload["status"] == "blocked"
        assert payload["diagnosisCode"] == "missing_env"
        assert payload["missingEnv"] == ["MCP_API_KEY", "OPTIONAL_TOKEN"]
        assert any(step["key"] == "fill-env" for step in payload["steps"])
        assert payload["worker"]["configured"] is False

        monkeypatch.setenv("NANOBOT_WEB_MCP_REPAIR_COMMAND", "python repair_worker.py --server filesystem-mcp")
        dangerous = client.post(
            "/api/v1/mcp/servers/filesystem-mcp/repair-run",
            json={"dangerousMode": True},
        )
        assert dangerous.status_code == 409
        assert dangerous.json()["error"]["code"] == "MCP_REPAIR_DANGEROUS_DISABLED"


def test_web_api_mcp_repair_run_invokes_worker_with_bounded_context(
    tmp_path,
    monkeypatch,
) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    fixture_repo = tmp_path / "fixture-repo"
    fixture_repo.mkdir()
    _write_fixture_mcp_repo(fixture_repo)

    class FakeProcess:
        pid = 4242

        @staticmethod
        def poll():
            return None

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        monkeypatch.setattr(
            client.app.state.mcp_repository,
            "_clone_repository",
            lambda _clone_url, target_dir: shutil.copytree(fixture_repo, target_dir),
        )
        monkeypatch.setattr(
            client.app.state.mcp_repository,
            "_run_install_step",
            lambda command, *, cwd, timeout: None,
        )

        installed = client.post(
            "/api/v1/mcp/repositories/install",
            json={"source": "https://github.com/acme/filesystem-mcp"},
        )
        assert installed.status_code == 201
        install_dir = Path(installed.json()["data"]["installDir"])

        captured: dict[str, object] = {}

        def fake_spawn(command: str, *, cwd: Path, extra_env: dict[str, str]):
            captured["command"] = command
            captured["cwd"] = cwd
            captured["extra_env"] = extra_env
            return FakeProcess()

        monkeypatch.setenv("NANOBOT_WEB_MCP_REPAIR_COMMAND", "python repair_worker.py --bounded")
        monkeypatch.setattr(client.app.state.mcp_servers, "_spawn_repair_process", fake_spawn)

        started = client.post(
            "/api/v1/mcp/servers/filesystem-mcp/repair-run",
            json={"dangerousMode": False},
        )
        assert started.status_code == 200
        payload = started.json()["data"]
        assert payload["worker"]["configured"] is True
        assert payload["run"]["status"] == "running"
        assert payload["run"]["dangerousMode"] is False
        assert payload["run"]["pid"] == 4242

        assert captured["command"] == "python repair_worker.py --bounded"
        assert captured["cwd"] == install_dir
        extra_env = captured["extra_env"]
        assert extra_env["NANOBOT_MCP_REPAIR_SERVER"] == "filesystem-mcp"
        assert extra_env["NANOBOT_MCP_REPAIR_DANGEROUS"] == "0"
        context = json.loads(extra_env["NANOBOT_MCP_REPAIR_CONTEXT"])
        assert context["serverName"] == "filesystem-mcp"
        assert context["dangerousMode"] is False
        assert context["installDir"] == str(install_dir)


def test_web_api_mcp_isolated_test_chat_is_independent_from_main_sessions(
    tmp_path,
    monkeypatch,
) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    fixture_repo = tmp_path / "fixture-repo"
    fixture_repo.mkdir()
    _write_fixture_mcp_repo(fixture_repo)

    async def fake_process_direct(
        self,
        content: str,
        session_key: str = "cli:direct",
        channel: str = "cli",
        chat_id: str = "direct",
        on_progress=None,
    ) -> str:
        session = self.sessions.get_or_create(session_key)
        if not session.metadata.get("title"):
            session.metadata["title"] = "MCP Test · filesystem-mcp"
        session.add_message("user", content)
        session.add_message(
            "assistant",
            "当前只加载 filesystem-mcp",
            tool_calls=[{"function": {"name": "read_file"}}],
        )
        session.add_message("tool", "workspace/index.md", name="read_file")
        self.sessions.save(session)
        return "当前只加载 filesystem-mcp"

    async def fake_close_mcp(self) -> None:
        return None

    monkeypatch.setattr("nanobot.agent.loop.AgentLoop.process_direct", fake_process_direct)
    monkeypatch.setattr("nanobot.agent.loop.AgentLoop.close_mcp", fake_close_mcp)

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        monkeypatch.setattr(
            client.app.state.mcp_repository,
            "_clone_repository",
            lambda _clone_url, target_dir: shutil.copytree(fixture_repo, target_dir),
        )
        monkeypatch.setattr(
            client.app.state.mcp_repository,
            "_run_install_step",
            lambda command, *, cwd, timeout: None,
        )

        installed = client.post(
            "/api/v1/mcp/repositories/install",
            json={"source": "https://github.com/acme/filesystem-mcp"},
        )
        assert installed.status_code == 201

        initial = client.get("/api/v1/mcp/servers/filesystem-mcp/test-chat")
        assert initial.status_code == 200
        assert initial.json()["data"]["messages"] == []

        sent = client.post(
            "/api/v1/mcp/servers/filesystem-mcp/test-chat/messages",
            json={"content": "请只用这个 MCP 回答"},
        )
        assert sent.status_code == 200
        sent_payload = sent.json()["data"]
        assert sent_payload["session"]["sessionId"] == "mcp-test:filesystem-mcp"
        assert sent_payload["assistantMessage"]["content"] == "当前只加载 filesystem-mcp"
        assert sent_payload["recentToolActivity"][0]["toolName"] == "read_file"

        fetched = client.get("/api/v1/mcp/servers/filesystem-mcp/test-chat")
        assert fetched.status_code == 200
        assert len(fetched.json()["data"]["messages"]) == 3

        main_sessions = client.get("/api/v1/chat/sessions")
        assert main_sessions.status_code == 200
        assert all(item["sessionId"] != "mcp-test:filesystem-mcp" for item in main_sessions.json()["data"]["items"])

        cleared = client.delete("/api/v1/mcp/servers/filesystem-mcp/test-chat")
        assert cleared.status_code == 200
        assert cleared.json()["data"] == {"deleted": True}

        after_clear = client.get("/api/v1/mcp/servers/filesystem-mcp/test-chat")
        assert after_clear.status_code == 200
        assert after_clear.json()["data"]["messages"] == []

def test_web_api_validation_separates_dangerous_options_and_recovery_actions(tmp_path, monkeypatch) -> None:
    config = _make_test_config(tmp_path, monkeypatch)
    config.workspace_path.mkdir(parents=True, exist_ok=True)
    config.agents.defaults.provider = "deepseek"
    config.agents.defaults.model = "deepseek/deepseek-chat"
    config.providers.deepseek.api_key = "sk-validation-test"
    config.gateway.host = "0.0.0.0"
    config.tools.restrict_to_workspace = False
    config.tools.mcp_servers["broken-local"] = MCPServerConfig()

    (tmp_path / "web-mcp-registry.json").write_text(
        json.dumps(
            {
                "version": 1,
                "entries": {
                    "broken-local": {
                        "display_name": "Broken Local",
                        "install_mode": "source",
                        "install_steps": ["npm ci"],
                    }
                },
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()

    monkeypatch.setattr(web_operations, "get_logs_dir", lambda: logs_dir)
    monkeypatch.setattr(
        web_operations.shutil,
        "which",
        lambda command: None if command in {"node", "npm"} else f"/usr/bin/{command}",
    )

    with TestClient(create_app(config, static_dir=tmp_path / "missing-static")) as client:
        _bootstrap_admin(client)

        response = client.post("/api/v1/validation/run")
        assert response.status_code == 200

    data = response.json()["data"]
    assert data["summary"] == {
        "status": "attention",
        "passed": 3,
        "warnings": 2,
        "failures": 0,
    }

    checks = {item["key"]: item for item in data["checks"]}
    assert checks["provider"]["status"] == "pass"
    assert checks["runtime"]["status"] == "warn"
    assert "node" in checks["runtime"]["detail"]
    assert checks["gateway"]["status"] == "pass"
    assert checks["paths"]["status"] == "pass"
    assert checks["mcp"]["status"] == "warn"
    assert checks["mcp"]["href"] == "/mcp"
    assert all(item["actionLabel"] for item in data["checks"])

    dangerous = {item["key"]: item for item in data["dangerousOptions"]}
    assert set(dangerous) == {"workspace-scope", "public-bind"}
    assert dangerous["workspace-scope"]["href"] == "/system/validation"
    assert dangerous["public-bind"]["href"] == "/system/validation"


def test_web_api_ops_logs_and_actions(web_client: TestClient, monkeypatch) -> None:
    created = web_client.post("/api/v1/chat/sessions", json={"title": "Ops Session"})
    assert created.status_code == 201
    session_id = created.json()["data"]["id"]

    session = web_client.app.state.web.sessions.get_or_create(f"web:{session_id}")
    session.add_message("user", "hello ops")
    session.add_message("assistant", "ops reply")
    web_client.app.state.web.sessions.save(session)

    logs_dir = web_client.app.state.auth.state_path.parent / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    (logs_dir / "nanobot.log").write_text("line one\nline two\nline three\n", encoding="utf-8")

    logs = web_client.get("/api/v1/ops/logs")
    assert logs.status_code == 200
    assert logs.json()["data"]["items"][0]["name"] == "nanobot.log"
    assert logs.json()["data"]["items"][0]["tail"][-1] == "line three"

    actions_before = web_client.get("/api/v1/ops/actions")
    assert actions_before.status_code == 200
    assert actions_before.json()["data"]["items"][0]["configured"] is False

    class FakeProcess:
        pid = 43210

        @staticmethod
        def poll():
            return None

    monkeypatch.setenv("NANOBOT_WEB_RESTART_COMMAND", "supervisorctl restart nanobot")
    monkeypatch.setattr(web_client.app.state.operations, "_spawn_action", lambda command, workspace_path: FakeProcess())

    restart = web_client.post("/api/v1/ops/actions/restart")
    assert restart.status_code == 200
    restart_item = restart.json()["data"]["item"]
    assert restart_item["configured"] is True
    assert restart_item["running"] is True
    assert restart_item["commandPreview"] == "supervisorctl restart nanobot"

    update = web_client.post("/api/v1/ops/actions/update")
    assert update.status_code == 400
    assert update.json()["error"]["code"] == "OPS_ACTION_INVALID"


def test_web_api_chat_upload_and_dispatch(web_client: TestClient, monkeypatch) -> None:
    created = web_client.post("/api/v1/chat/sessions", json={"title": "Upload Session"})
    assert created.status_code == 201
    session_id = created.json()["data"]["id"]

    upload = web_client.post(
        "/api/v1/chat/uploads",
        files={"file": ("brief.txt", b"workspace upload content", "text/plain")},
    )
    assert upload.status_code == 201
    upload_data = upload.json()["data"]
    assert upload_data["relativePath"].startswith("uploads/")
    assert Path(upload_data["path"]).exists()

    async def fake_chat(
        session_id_arg: str,
        content: str,
        on_progress,
        *,
        display_content: str | None = None,
        attachments: list[dict[str, object]] | None = None,
    ):
        assert session_id_arg == session_id
        assert content == "[附加文件]\n- uploads/brief.txt\n\n[用户问题]\nreview the uploaded file"
        assert display_content == "review the uploaded file"
        assert attachments == [
            {
                "name": upload_data["name"],
                "path": upload_data["path"],
                "relativePath": upload_data["relativePath"],
                "sizeBytes": upload_data["sizeBytes"],
                "uploadedAt": upload_data["uploadedAt"],
            }
        ]
        await on_progress("checking uploads")
        return {
            "content": "Saw the uploaded file.",
            "assistantMessage": None,
        }

    monkeypatch.setattr(web_client.app.state.web, "chat", fake_chat)

    dispatched = web_client.post(
        f"/api/v1/chat/sessions/{session_id}/messages",
        json={
            "content": "[附加文件]\n- uploads/brief.txt\n\n[用户问题]\nreview the uploaded file",
            "displayContent": "review the uploaded file",
            "attachments": [
                {
                    "name": upload_data["name"],
                    "path": upload_data["path"],
                    "relativePath": upload_data["relativePath"],
                    "sizeBytes": upload_data["sizeBytes"],
                    "uploadedAt": upload_data["uploadedAt"],
                }
            ],
        },
    )
    assert dispatched.status_code == 200
    assert dispatched.json()["data"]["content"] == "Saw the uploaded file."


def test_web_api_session_files_are_scoped_to_session(web_client: TestClient) -> None:
    created = web_client.post("/api/v1/chat/sessions", json={"title": "Scoped Files"})
    assert created.status_code == 201
    session_id = created.json()["data"]["id"]

    uploaded = web_client.post(
        f"/api/v1/chat/sessions/{session_id}/uploads",
        files={"file": ("brief.txt", b"conversation file", "text/plain")},
    )
    assert uploaded.status_code == 201
    uploaded_data = uploaded.json()["data"]
    assert uploaded_data["uploadedFile"]["relativePath"].startswith("uploads/")
    assert len(uploaded_data["sessionFiles"]) == 1

    listed = web_client.get(f"/api/v1/chat/sessions/{session_id}/files")
    assert listed.status_code == 200
    assert listed.json()["data"][0]["relativePath"] == uploaded_data["uploadedFile"]["relativePath"]

    library_upload = web_client.post(
        "/api/v1/chat/uploads",
        files={"file": ("logs.txt", b"older library file", "text/plain")},
    )
    assert library_upload.status_code == 201
    library_item = library_upload.json()["data"]

    imported = web_client.post(
        f"/api/v1/chat/sessions/{session_id}/files/import",
        json={"attachments": [library_item]},
    )
    assert imported.status_code == 200
    assert len(imported.json()["data"]["sessionFiles"]) == 2

    removed = web_client.request(
        "DELETE",
        f"/api/v1/chat/sessions/{session_id}/files",
        json={"relativePath": uploaded_data["uploadedFile"]["relativePath"]},
    )
    assert removed.status_code == 200
    remaining_files = removed.json()["data"]["sessionFiles"]
    assert len(remaining_files) == 1
    assert remaining_files[0]["relativePath"] == library_item["relativePath"]

    sessions = web_client.get("/api/v1/chat/sessions")
    assert sessions.status_code == 200
    assert sessions.json()["data"]["items"][0]["fileCount"] == 1


def test_web_api_chat_workspace_snapshot(web_client: TestClient) -> None:
    web_client.app.state.web.config.tools.mcp_servers["filesystem"] = MCPServerConfig(
        enabled=True,
        command="npx",
        args=["-y", "@acme/filesystem-mcp"],
    )

    created = web_client.post("/api/v1/chat/sessions", json={"title": "Workspace Session"})
    assert created.status_code == 201
    session_id = created.json()["data"]["id"]

    upload = web_client.post(
        "/api/v1/chat/uploads",
        files={"file": ("brief.txt", b"workspace upload content", "text/plain")},
    )
    assert upload.status_code == 201

    session = web_client.app.state.web.sessions.get_or_create(web_client.app.state.web._session_key(session_id))
    session.metadata["title"] = "Workspace Session"
    session.add_message(
        "assistant",
        "",
        tool_calls=[
            {
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": '{"path":"uploads/brief.txt"}',
                },
            }
        ],
    )
    session.add_message("tool", "workspace upload content", name="read_file", tool_call_id="call_1")
    web_client.app.state.web.sessions.save(session)

    snapshot = web_client.get("/api/v1/chat/workspace")
    assert snapshot.status_code == 200
    data = snapshot.json()["data"]
    assert data["runtime"]["workspace"].endswith("workspace")
    assert data["runtime"]["provider"] == web_client.app.state.web.config.agents.defaults.provider
    assert data["runtime"]["resolvedProvider"] == (
        web_client.app.state.web.config.get_provider_name(web_client.app.state.web.config.agents.defaults.model)
        or web_client.app.state.web.config.agents.defaults.provider
    )
    assert data["runtime"]["activeMcpCount"] == 1
    assert data["recentUploads"][0]["relativePath"].startswith("uploads/")
    assert data["recentToolActivity"][0]["toolName"] == "read_file"
    assert data["activeMcp"][0]["name"] == "filesystem"
    assert len(data["quickPrompts"]) >= 1


def test_session_history_rebuilds_attachment_prompt_from_structured_fields(tmp_path) -> None:
    manager = SessionManager(tmp_path)
    session = manager.get_or_create("web:test")
    session.add_message(
        "user",
        "请检查附件里的报错",
        attachments=[
            {
                "name": "brief.txt",
                "relativePath": "uploads/brief.txt",
                "path": str(tmp_path / "uploads" / "brief.txt"),
            }
        ],
    )

    history = session.get_history(max_messages=20)

    assert history[0]["role"] == "user"
    assert history[0]["content"] == "[附加文件]\n- uploads/brief.txt\n\n[用户问题]\n请检查附件里的报错"


def test_web_api_health_and_session_crud(web_client: TestClient) -> None:
    health = web_client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["data"] == {"status": "ok"}

    created = web_client.post("/api/v1/chat/sessions", json={"title": "Inbox"})
    assert created.status_code == 201
    session = created.json()["data"]
    assert session["title"] == "Inbox"

    listed = web_client.get("/api/v1/chat/sessions", params={"page": 1, "pageSize": 20})
    assert listed.status_code == 200
    assert listed.json()["data"]["items"][0]["id"] == session["id"]

    renamed = web_client.patch(f"/api/v1/chat/sessions/{session['id']}", json={"title": "Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["data"]["title"] == "Renamed"

    messages = web_client.get(f"/api/v1/chat/sessions/{session['id']}/messages")
    assert messages.status_code == 200
    assert messages.json()["data"] == []

    deleted = web_client.delete(f"/api/v1/chat/sessions/{session['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}


def test_web_api_runs_list_detail_children_and_cancel(web_client: TestClient) -> None:
    parent = web_client.app.state.runs.create_run(
        kind=RunKind.AGENT,
        label="Main agent run",
        task_preview="Coordinate work",
        agent_id="main-agent",
        session_key="web:session-1",
        origin_channel="web",
        origin_chat_id="session-1",
    )
    child = web_client.app.state.runs.create_run(
        kind=RunKind.AGENT,
        label="Research follow-up",
        task_preview="Collect references",
        agent_id="main-agent",
        session_key="web:session-1",
        origin_channel="web",
        origin_chat_id="session-1",
        parent_run_id=parent.run_id,
        root_run_id=parent.run_id,
        control_scope=RunControlScope.CHILD,
    )

    listed = web_client.get(
        "/api/v1/runs",
        params={
            "sessionKey": "web:session-1",
            "kind": "agent",
            "agentId": "main-agent",
            "parentRunId": parent.run_id,
        },
    )
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] == 1
    assert listed.json()["data"]["items"][0]["runId"] == child.run_id

    detail = web_client.get(f"/api/v1/runs/{child.run_id}")
    assert detail.status_code == 200
    assert detail.json()["data"]["runId"] == child.run_id
    assert detail.json()["data"]["status"] == "queued"

    children = web_client.get(f"/api/v1/runs/{parent.run_id}/children")
    assert children.status_code == 200
    assert children.json()["data"]["total"] == 1
    assert children.json()["data"]["items"][0]["runId"] == child.run_id

    tree = web_client.get(f"/api/v1/runs/{child.run_id}/tree")
    assert tree.status_code == 200
    assert tree.json()["data"]["runId"] == parent.run_id
    assert tree.json()["data"]["children"][0]["runId"] == child.run_id

    cancelled = web_client.post(f"/api/v1/runs/{child.run_id}/cancel")
    assert cancelled.status_code == 202
    assert cancelled.json()["data"]["runId"] == child.run_id
    assert cancelled.json()["data"]["status"] == "cancel_requested"
    assert cancelled.json()["data"]["taskCancellationSent"] is False


def test_web_api_agent_test_run_executes_and_persists_recent_run(web_client: TestClient, monkeypatch) -> None:
    workspace = web_client.app.state.web.config.workspace_path
    skill_dir = workspace / "skills" / "briefing-skill"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: briefing-skill\ndescription: Briefing helper\n---\nAlways summarize findings clearly.\n",
        encoding="utf-8",
    )
    web_client.app.state.web.workspace_runtime.reload_agent_templates()

    created = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Ops Briefing Agent",
            "description": "Summarize and coordinate.",
            "systemPrompt": "You are an operations briefing agent.",
            "toolAllowlist": ["read_file", "list_dir"],
            "skillIds": ["briefing-skill"],
            "knowledgeBindingIds": ["kb-ops"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert created.status_code == 201
    agent = created.json()["data"]

    kb_created = web_client.post(
        "/api/v1/knowledge-bases",
        json={
            "name": "Ops KB",
            "retrievalProfile": {"mode": "hybrid", "chunkSize": 400, "chunkOverlap": 40},
        },
    )
    assert kb_created.status_code == 201
    kb_id = kb_created.json()["data"]["kbId"]

    faq_ingest = web_client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        json={
            "sourceType": "faq_table",
            "title": "Ops FAQ",
            "items": [
                {
                    "question": "How do we restart nanobot?",
                    "answer": "Use supervisorctl restart nanobot after checking service health.",
                }
            ],
        },
    )
    assert faq_ingest.status_code == 202
    faq_payload = faq_ingest.json()["data"]
    faq_document, faq_job = _wait_for_knowledge_ingest(
        web_client,
        kb_id=kb_id,
        doc_id=faq_payload["documents"][0]["docId"],
        job_id=faq_payload["jobs"][0]["jobId"],
    )
    assert faq_document["docStatus"] == "indexed"
    assert faq_job["status"] == "succeeded"

    patched = web_client.put(
        f"/api/v1/agents/{agent['agentId']}",
        json={"knowledgeBindingIds": [kb_id]},
    )
    assert patched.status_code == 200

    provider = web_client.app.state.web.agent.provider

    async def fake_chat_with_retry(*, messages, tools, model, **kwargs):
        assert model == "openai/gpt-4o-mini"
        assert {tool["function"]["name"] for tool in tools} == {
            "read_file",
            "list_dir",
            "list_kbs",
            "get_mindmap",
            "query_kb",
        }
        assert "You are an operations briefing agent." in messages[0]["content"]
        assert "Always summarize findings clearly." in messages[0]["content"]
        assert "supervisorctl restart nanobot" in messages[0]["content"]
        return LLMResponse(content="Agent test reply", tool_calls=[])

    provider.chat_with_retry = fake_chat_with_retry
    monkeypatch.setattr(
        web_client.app.state.web.config_runtime,
        "make_provider",
        lambda config: provider,
    )

    tested = web_client.post(
        f"/api/v1/agents/{agent['agentId']}/test-run",
        json={"content": "Summarize how to restart nanobot for the operator."},
    )
    assert tested.status_code == 200
    payload = tested.json()["data"]
    assert payload["run"]["kind"] == "agent"
    assert payload["run"]["status"] == "succeeded"
    assert payload["run"]["artifactPath"] == f"{payload['run']['runId']}.md"
    assert payload["assistantMessage"]["content"] == "Agent test reply"
    assert payload["pendingKnowledgeBindings"] == [kb_id]
    assert len(payload["knowledgeHits"]) >= 1
    assert payload["appliedBindings"]["skillIds"] == ["briefing-skill"]
    assert any(event["eventType"] == "execution_context_materialized" for event in payload["run"]["events"])
    assert any(event["eventType"] == "bindings_resolved" for event in payload["run"]["events"])
    assert any(event["eventType"] == "knowledge_retrieved" for event in payload["run"]["events"])
    artifact = web_client.get(f"/api/v1/runs/{payload['run']['runId']}/artifact")
    assert artifact.status_code == 200
    artifact_data = artifact.json()["data"]
    assert artifact_data["artifactPath"] == payload["run"]["artifactPath"]
    assert "Agent test reply" in artifact_data["content"]
    assert "supervisorctl restart nanobot" in artifact_data["content"]

    listed = web_client.get(
        "/api/v1/runs",
        params={"agentId": agent["agentId"], "kind": "agent"},
    )
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] == 1
    assert listed.json()["data"]["items"][0]["runId"] == payload["run"]["runId"]


def test_web_api_agent_test_run_accepts_legacy_runtime_tools(
    web_client: TestClient,
    monkeypatch,
) -> None:
    created = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Legacy Runtime Agent",
            "systemPrompt": "Use runtime tools when appropriate.",
            "toolAllowlist": ["read_file", "message", "cron"],
        },
    )
    assert created.status_code == 201
    agent = created.json()["data"]

    provider = web_client.app.state.web.agent.provider

    async def fake_chat_with_retry(*, messages, tools, model, **kwargs):
        assert "Use runtime tools when appropriate." in messages[0]["content"]
        assert {tool["function"]["name"] for tool in tools} == {"read_file", "message", "cron"}
        return LLMResponse(content="Legacy runtime tools ok", tool_calls=[])

    provider.chat_with_retry = fake_chat_with_retry
    monkeypatch.setattr(
        web_client.app.state.web.config_runtime,
        "make_provider",
        lambda config: provider,
    )

    tested = web_client.post(
        f"/api/v1/agents/{agent['agentId']}/test-run",
        json={"content": "Do a quick compatibility check."},
    )
    assert tested.status_code == 200
    payload = tested.json()["data"]
    assert payload["run"]["status"] == "succeeded"
    assert payload["assistantMessage"]["content"] == "Legacy runtime tools ok"
    assert payload["appliedBindings"]["toolAllowlist"] == ["read_file", "message", "cron"]




def test_web_api_agent_profile_memory_routes_and_runtime(web_client: TestClient, monkeypatch) -> None:
    workspace = web_client.app.state.web.config.workspace_path
    memory_dir = workspace / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    (memory_dir / "MEMORY.md").write_text("# Workspace Shared Memory\n\nWORKSPACE SECRET\n", encoding="utf-8")

    created = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Profile Agent",
            "systemPrompt": "You are a profile-aware agent.",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
            "memoryScope": "agent_profile",
        },
    )
    assert created.status_code == 201
    agent_id = created.json()["data"]["agentId"]

    updated_memory = web_client.put(
        f"/api/v1/agents/{agent_id}/memory",
        json={"content": "Agent profile fact: prefer numbered incident checklists."},
    )
    assert updated_memory.status_code == 200
    assert "numbered incident checklists" in updated_memory.json()["data"]["content"]

    fetched_memory = web_client.get(f"/api/v1/agents/{agent_id}/memory")
    assert fetched_memory.status_code == 200
    assert "numbered incident checklists" in fetched_memory.json()["data"]["content"]
    assert fetched_memory.json()["data"]["candidateCount"] == 0

    provider = web_client.app.state.web.agent.provider

    async def fake_chat_with_retry(*, messages, tools, model, **kwargs):
        _ = tools, kwargs
        assert model == "openai/gpt-4o-mini"
        system = messages[0]["content"]
        assert "Agent Profile Memory" in system
        assert "prefer numbered incident checklists" in system
        assert "WORKSPACE SECRET" not in system
        return LLMResponse(content="Agent profile memory acknowledged.", tool_calls=[])

    provider.chat_with_retry = fake_chat_with_retry
    monkeypatch.setattr(
        web_client.app.state.web.config_runtime,
        "make_provider",
        lambda config: provider,
    )

    test_run = web_client.post(
        f"/api/v1/agents/{agent_id}/test-run",
        json={"content": "Summarize your operating style."},
    )
    assert test_run.status_code == 200
    assert test_run.json()["data"]["assistantMessage"]["content"] == "Agent profile memory acknowledged."

    search = web_client.post(
        "/api/v1/memory-search",
        json={"query": "incident checklists", "agentId": agent_id, "limit": 5, "mode": "keyword"},
    )
    assert search.status_code == 200
    search_payload = search.json()["data"]
    assert search_payload["effectiveMode"] == "keyword"
    assert any(item["sourceType"] == "agent_profile" for item in search_payload["items"])

    source = web_client.post(
        "/api/v1/memory-get",
        json={"sourceType": "agent_profile", "sourceId": agent_id, "agentId": agent_id},
    )
    assert source.status_code == 200
    source_payload = source.json()["data"]
    assert source_payload["sourceType"] == "agent_profile"
    assert source_payload["sourceId"] == agent_id
    assert "numbered incident checklists" in source_payload["content"]


def test_web_api_agent_profile_memory_candidates_governance(web_client: TestClient) -> None:
    created = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Candidate Agent",
            "systemPrompt": "You keep stable operating preferences.",
            "memoryScope": "agent_profile",
        },
    )
    assert created.status_code == 201
    agent_id = created.json()["data"]["agentId"]

    proposed = web_client.post(
        f"/api/v1/agents/{agent_id}/memory-candidates",
        json={
            "title": "Incident style preference",
            "content": "Prefer terse numbered remediation steps.",
            "sourceKind": "manual_note",
        },
    )
    assert proposed.status_code == 201
    candidate = proposed.json()["data"]
    assert candidate["scope"] == "agent_profile"
    assert candidate["agentId"] == agent_id
    assert candidate["status"] == "proposed"

    listed = web_client.get(
        "/api/v1/memory-candidates",
        params={"agentId": agent_id, "scope": "agent_profile", "status": "proposed"},
    )
    assert listed.status_code == 200
    listed_payload = listed.json()["data"]
    assert listed_payload["total"] == 1
    assert listed_payload["items"][0]["candidateId"] == candidate["candidateId"]

    candidate_source = web_client.post(
        "/api/v1/memory-get",
        json={"sourceType": "memory_candidate", "sourceId": candidate["candidateId"], "agentId": agent_id},
    )
    assert candidate_source.status_code == 200
    assert candidate_source.json()["data"]["metadata"]["agentId"] == agent_id

    search = web_client.post(
        "/api/v1/memory-search",
        json={"query": "numbered remediation steps", "agentId": agent_id, "limit": 10, "mode": "hybrid"},
    )
    assert search.status_code == 200
    assert any(item["sourceType"] == "memory_candidate" for item in search.json()["data"]["items"])

    applied = web_client.post(f"/api/v1/memory-candidates/{candidate['candidateId']}/apply")
    assert applied.status_code == 200
    assert applied.json()["data"]["status"] == "applied"

    memory = web_client.get(f"/api/v1/agents/{agent_id}/memory")
    assert memory.status_code == 200
    memory_payload = memory.json()["data"]
    assert memory_payload["candidateCount"] == 0
    assert "Prefer terse numbered remediation steps." in memory_payload["content"]


def test_web_api_tenant_scoped_knowledge_and_agent_memory(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-a",
        name="Tenant A",
    )

    created_kb = web_client.post(
        "/api/v1/knowledge-bases",
        headers=tenant_headers,
        json={
            "name": "Tenant Support KB",
            "description": "Tenant-scoped support docs",
        },
    )
    assert created_kb.status_code == 201
    kb_payload = created_kb.json()["data"]
    assert kb_payload["tenantId"] == "tenant-a"

    tenant_kbs = web_client.get("/api/v1/knowledge-bases", headers=tenant_headers)
    assert tenant_kbs.status_code == 200
    assert tenant_kbs.json()["data"][0]["kbId"] == kb_payload["kbId"]

    default_kbs = web_client.get("/api/v1/knowledge-bases")
    assert default_kbs.status_code == 200
    assert default_kbs.json()["data"] == []

    created_agent = web_client.post(
        "/api/v1/agents",
        headers=tenant_headers,
        json={
            "name": "Tenant Profile Agent",
            "systemPrompt": "You are tenant scoped.",
            "memoryScope": "agent_profile",
        },
    )
    assert created_agent.status_code == 201
    agent_id = created_agent.json()["data"]["agentId"]
    assert created_agent.json()["data"]["tenantId"] == "tenant-a"

    updated_memory = web_client.put(
        f"/api/v1/agents/{agent_id}/memory",
        headers=tenant_headers,
        json={"content": "Tenant-only memory fact."},
    )
    assert updated_memory.status_code == 200

    fetched_memory = web_client.get(
        f"/api/v1/agents/{agent_id}/memory",
        headers=tenant_headers,
    )
    assert fetched_memory.status_code == 200
    assert "Tenant-only memory fact." in fetched_memory.json()["data"]["content"]

    missing_default = web_client.get(f"/api/v1/agents/{agent_id}/memory")
    assert missing_default.status_code == 404
    assert missing_default.json()["error"]["code"] == "AGENT_NOT_FOUND"


def test_web_api_tenant_scoped_channel_bindings(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-routing",
        name="Tenant Routing",
    )

    created_agent = web_client.post(
        "/api/v1/agents",
        headers=tenant_headers,
        json={
            "name": "Tenant Routed Agent",
            "systemPrompt": "You route tenant messages.",
        },
    )
    assert created_agent.status_code == 201
    agent_id = created_agent.json()["data"]["agentId"]

    created_binding = web_client.post(
        "/api/v1/channel-bindings",
        headers=tenant_headers,
        json={
            "channelName": "telegram",
            "channelChatId": "chat-tenant-a",
            "targetType": "agent",
            "targetId": agent_id,
        },
    )
    assert created_binding.status_code == 201
    binding_payload = created_binding.json()["data"]
    assert binding_payload["tenantId"] == "tenant-routing"

    resolved_tenant = web_client.post(
        "/api/v1/channel-bindings/resolve",
        headers=tenant_headers,
        json={"channelName": "telegram", "chatId": "chat-tenant-a"},
    )
    assert resolved_tenant.status_code == 200
    resolved_payload = resolved_tenant.json()["data"]
    assert resolved_payload["resolved"] is True
    assert resolved_payload["binding"]["targetId"] == agent_id

    resolved_default = web_client.post(
        "/api/v1/channel-bindings/resolve",
        json={"channelName": "telegram", "chatId": "chat-tenant-a"},
    )
    assert resolved_default.status_code == 200
    assert resolved_default.json()["data"] == {"binding": None, "resolved": False}

    default_list = web_client.get("/api/v1/channel-bindings")
    assert default_list.status_code == 200
    assert default_list.json()["data"] == []


def test_web_api_tenant_scoped_channel_audit(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-channel-audit",
        name="Tenant Channel Audit",
    )

    created = web_client.app.state.channel_audit_service.record_inbound(
        tenant_id="tenant-channel-audit",
        channel_name="telegram",
        chat_id="chat-audit",
        session_key="telegram:chat-audit",
        sender_id="user-audit",
        message_preview="Need help",
        resolved=True,
        resolution_kind="exact",
        binding_id="cb-audit",
        target_type="agent",
        target_id="agent-audit",
    )
    web_client.app.state.channel_audit_service.record_inbound(
        tenant_id="default",
        channel_name="telegram",
        chat_id="chat-default",
        session_key="telegram:chat-default",
        sender_id="user-default",
        message_preview="Default tenant message",
        resolved=False,
    )

    listing = web_client.get("/api/v1/channel-audit", headers=tenant_headers)
    assert listing.status_code == 200
    payload = listing.json()["data"]
    assert len(payload["items"]) == 1
    assert payload["items"][0]["auditId"] == created["auditId"]

    detail = web_client.get(f"/api/v1/channel-audit/{created['auditId']}", headers=tenant_headers)
    assert detail.status_code == 200
    assert detail.json()["data"]["tenantId"] == "tenant-channel-audit"

    missing_default = web_client.get(f"/api/v1/channel-audit/{created['auditId']}")
    assert missing_default.status_code == 404
    assert missing_default.json()["error"]["code"] == "CHANNEL_AUDIT_NOT_FOUND"


def test_web_api_tenant_control_plane_rejects_api_keys(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-control-plane",
        name="Tenant Control Plane",
    )

    forbidden_list = web_client.get("/api/v1/tenants", headers=tenant_headers)
    assert forbidden_list.status_code == 403
    assert forbidden_list.json()["error"]["code"] == "TENANT_CONTROL_PLANE_FORBIDDEN"

    forbidden_detail = web_client.get("/api/v1/tenants/tenant-control-plane", headers=tenant_headers)
    assert forbidden_detail.status_code == 403
    assert forbidden_detail.json()["error"]["code"] == "TENANT_CONTROL_PLANE_FORBIDDEN"


def test_web_api_tenant_control_plane_requires_explicit_cookie_selection(web_client: TestClient) -> None:
    missing_selection = web_client.get("/api/v1/tenants")
    assert missing_selection.status_code == 403
    assert missing_selection.json()["error"]["code"] == "TENANT_CONTEXT_REQUIRED"

    selected = web_client.get("/api/v1/tenants", headers={"x-tenant-id": "tenant-console"})
    assert selected.status_code == 200
    assert selected.json()["data"] == []

    mismatch = web_client.get(
        "/api/v1/tenants/tenant-console-target",
        headers={"x-tenant-id": "tenant-console"},
    )
    assert mismatch.status_code == 403
    assert mismatch.json()["error"]["code"] == "TENANT_CONTEXT_MISMATCH"


def test_web_api_tenant_control_plane_audit_and_suspended_api_keys_are_blocked(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-audit",
        name="Tenant Audit",
    )

    audit_before = web_client.get(
        "/api/v1/tenants/tenant-audit/audit",
        headers={"x-tenant-id": "tenant-audit"},
    )
    assert audit_before.status_code == 200
    audit_payload = audit_before.json()["data"]
    assert audit_payload["tenantId"] == "tenant-audit"
    assert audit_payload["isActive"] is True
    assert audit_payload["isSuspended"] is False
    assert audit_payload["apiKeyCount"] == 1
    assert audit_payload["artifactRetentionPolicy"]["tenantId"] == "tenant-audit"

    suspended = web_client.put(
        "/api/v1/tenants/tenant-audit",
        headers={"x-tenant-id": "tenant-audit"},
        json={"status": "suspended"},
    )
    assert suspended.status_code == 200
    assert suspended.json()["data"]["status"] == "suspended"
    assert suspended.json()["data"]["isSuspended"] is True

    blocked = web_client.get("/api/v1/agents", headers=tenant_headers)
    assert blocked.status_code == 401
    assert blocked.json()["error"] == "Invalid or expired API key."

    audit_after = web_client.get(
        "/api/v1/tenants/tenant-audit/audit",
        headers={"x-tenant-id": "tenant-audit"},
    )
    assert audit_after.status_code == 200
    assert audit_after.json()["data"]["status"] == "suspended"
    assert audit_after.json()["data"]["isActive"] is False
    assert audit_after.json()["data"]["isSuspended"] is True


def test_web_api_tenant_scoped_runs_artifacts_and_boundary_audit(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-runs",
        name="Tenant Runs",
    )

    run = web_client.app.state.runs.create_run(
        kind=RunKind.AGENT,
        label="Tenant audited run",
        task_preview="Inspect tenant-aware run access",
        tenant_id="tenant-runs",
        agent_id="agent-tenant-audit",
        session_key="agent:audit:telegram:chat-42",
        origin_channel="telegram",
        origin_chat_id="chat-42",
        workspace_path="/tmp/tenant-runs/workspace",
        memory_scope="agent_profile",
        knowledge_scope="bindings",
    )
    web_client.app.state.runs.append_event(
        run.run_id,
        "execution_context_materialized",
        {
            "principalKind": "agent",
            "principalId": "agent-tenant-audit",
            "label": "Tenant Audit Agent",
            "workspacePath": "/tmp/tenant-runs/workspace",
            "workspaceScope": "agent",
            "sandboxKind": "local",
            "execWorkingDir": "/tmp/tenant-runs/workspace",
            "restrictToWorkspace": True,
            "execTimeoutSeconds": 30,
        },
    )
    web_client.app.state.runs.append_event(
        run.run_id,
        "bindings_resolved",
        {
            "toolAllowlist": ["read_file"],
            "knowledgeBindingIds": ["kb-tenant-audit"],
            "knowledgeNames": ["Tenant Audit KB"],
            "mcpServerIds": [],
            "skillIds": [],
        },
    )
    web_client.app.state.runs.append_event(
        run.run_id,
        "channel_dispatch_resolved",
        {
            "tenantId": "tenant-runs",
            "bindingId": "cb-tenant-runs",
            "targetType": "agent",
            "targetId": "agent-tenant-audit",
            "channelName": "telegram",
            "chatId": "chat-42",
            "sessionKey": "agent:audit:telegram:chat-42",
        },
    )
    web_client.app.state.runs.start_run(run.run_id)
    artifact_path = web_client.app.state.runs.write_markdown_artifact(
        run.run_id,
        title="Tenant audited run",
        sections=[("Summary", "Tenant audit artifact body.")],
    )
    web_client.app.state.runs.complete_run(
        run.run_id,
        RunResultSummary(content="Tenant audit artifact body."),
        artifact_path=artifact_path,
    )

    tenant_list = web_client.get("/api/v1/runs", headers=tenant_headers)
    assert tenant_list.status_code == 200
    assert tenant_list.json()["data"]["items"][0]["runId"] == run.run_id

    default_list = web_client.get("/api/v1/runs")
    assert default_list.status_code == 200
    assert default_list.json()["data"]["items"] == []

    detail = web_client.get(f"/api/v1/runs/{run.run_id}", headers=tenant_headers)
    assert detail.status_code == 200
    assert detail.json()["data"]["tenantId"] == "tenant-runs"

    detail_default = web_client.get(f"/api/v1/runs/{run.run_id}")
    assert detail_default.status_code == 404
    assert detail_default.json()["error"]["code"] == "RUN_NOT_FOUND"

    artifact = web_client.get(f"/api/v1/runs/{run.run_id}/artifact", headers=tenant_headers)
    assert artifact.status_code == 200
    artifact_payload = artifact.json()["data"]
    assert artifact_payload["tenantId"] == "tenant-runs"
    assert artifact_payload["audit"]["storageScope"] == "tenant_instance_scoped"
    assert "Tenant audit artifact body." in artifact_payload["content"]

    artifact_default = web_client.get(f"/api/v1/runs/{run.run_id}/artifact")
    assert artifact_default.status_code == 404
    assert artifact_default.json()["error"]["code"] == "RUN_NOT_FOUND"

    boundary = web_client.get(f"/api/v1/runs/{run.run_id}/boundary-audit", headers=tenant_headers)
    assert boundary.status_code == 200
    boundary_payload = boundary.json()["data"]
    assert boundary_payload["channel"]["routing"]["bindingId"] == "cb-tenant-runs"
    assert boundary_payload["environment"]["workspaceScope"] == "agent"
    assert boundary_payload["artifact"]["storageScope"] == "tenant_instance_scoped"

    boundary_default = web_client.get(f"/api/v1/runs/{run.run_id}/boundary-audit")
    assert boundary_default.status_code == 404
    assert boundary_default.json()["error"]["code"] == "RUN_NOT_FOUND"


def test_web_api_tenant_scoped_artifact_lifecycle_governance(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-artifact-gov",
        name="Tenant Artifact Governance",
    )

    run = web_client.app.state.runs.create_run(
        kind=RunKind.AGENT,
        label="Tenant governed artifact",
        task_preview="Govern artifact lifecycle",
        tenant_id="tenant-artifact-gov",
        agent_id="agent-artifact",
        session_key="agent:artifact:telegram:chat-7",
    )
    web_client.app.state.runs.start_run(run.run_id)
    artifact_path = web_client.app.state.runs.write_markdown_artifact(
        run.run_id,
        title="Tenant governed artifact",
        sections=[("Summary", "Governed content.")],
    )
    web_client.app.state.runs.complete_run(
        run.run_id,
        RunResultSummary(content="Governed content."),
        artifact_path=artifact_path,
    )

    quarantined = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/quarantine",
        headers=tenant_headers,
        json={"reason": "manual review"},
    )
    assert quarantined.status_code == 200
    assert quarantined.json()["data"]["lifecycleStatus"] == "quarantined"

    audit = web_client.get(f"/api/v1/runs/{run.run_id}/artifact/audit", headers=tenant_headers)
    assert audit.status_code == 200
    assert audit.json()["data"]["lifecycleStatus"] == "quarantined"

    archived = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/archive",
        headers=tenant_headers,
        json={"reason": "archive before delete"},
    )
    assert archived.status_code == 409

    restored_from_quarantine = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/restore",
        headers=tenant_headers,
        json={"reason": "resume review"},
    )
    assert restored_from_quarantine.status_code == 200
    assert restored_from_quarantine.json()["data"]["lifecycleStatus"] == "active"

    archived = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/archive",
        headers=tenant_headers,
        json={"reason": "archive before delete"},
    )
    assert archived.status_code == 200
    assert archived.json()["data"]["lifecycleStatus"] == "archived"

    policy = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/policy",
        headers=tenant_headers,
        json={"archiveAfterDays": None, "deleteAfterDays": 0, "reason": "auto cleanup"},
    )
    assert policy.status_code == 200
    assert policy.json()["data"]["nextAction"] == "delete"

    applied = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/retention/apply",
        headers=tenant_headers,
        json={},
    )
    assert applied.status_code == 200
    assert applied.json()["data"]["applied"] is True
    assert applied.json()["data"]["action"] == "delete"

    deleted = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/delete",
        headers=tenant_headers,
        json={"reason": "cleanup"},
    )
    assert deleted.status_code == 409

    missing_artifact = web_client.get(f"/api/v1/runs/{run.run_id}/artifact", headers=tenant_headers)
    assert missing_artifact.status_code == 404
    assert missing_artifact.json()["error"]["code"] == "RUN_ARTIFACT_NOT_FOUND"

    restored = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/restore",
        headers=tenant_headers,
        json={"reason": "restore"},
    )
    assert restored.status_code == 200
    assert restored.json()["data"]["lifecycleStatus"] == "active"

    cleared_policy = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/policy",
        headers=tenant_headers,
        json={"archiveAfterDays": None, "deleteAfterDays": None, "reason": "clear policy"},
    )
    assert cleared_policy.status_code == 200
    assert cleared_policy.json()["data"]["enabled"] is False

    restored_artifact = web_client.get(f"/api/v1/runs/{run.run_id}/artifact", headers=tenant_headers)
    assert restored_artifact.status_code == 200
    assert restored_artifact.json()["data"]["audit"]["lifecycleStatus"] == "active"
    assert restored_artifact.json()["data"]["audit"]["retentionPolicy"]["enabled"] is False

    missing_default = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/delete",
        json={"reason": "wrong tenant"},
    )
    assert missing_default.status_code == 404
    assert missing_default.json()["error"]["code"] == "RUN_NOT_FOUND"


def test_web_api_tenant_scoped_artifact_retention_sweep(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-artifact-sweep",
        name="Tenant Artifact Sweep",
    )

    run = web_client.app.state.runs.create_run(
        kind=RunKind.AGENT,
        label="Tenant retention sweep artifact",
        task_preview="Sweep artifact retention",
        tenant_id="tenant-artifact-sweep",
        agent_id="agent-artifact-sweep",
        session_key="agent:artifact:telegram:chat-8",
    )
    web_client.app.state.runs.start_run(run.run_id)
    artifact_path = web_client.app.state.runs.write_markdown_artifact(
        run.run_id,
        title="Tenant retention sweep artifact",
        sections=[("Summary", "Sweep me.")],
    )
    web_client.app.state.runs.complete_run(
        run.run_id,
        RunResultSummary(content="Sweep me."),
        artifact_path=artifact_path,
    )
    web_client.app.state.runs.set_artifact_retention_policy(
        run.run_id,
        archive_after_days=0,
        delete_after_days=14,
        reason="scheduled archive",
    )

    swept = web_client.post(
        "/api/v1/runs/artifacts/retention/sweep",
        headers=tenant_headers,
        json={"limit": 20},
    )
    assert swept.status_code == 200
    payload = swept.json()["data"]
    assert payload["evaluated"] == 1
    assert payload["applied"] == 1
    assert payload["archived"] == 1
    assert payload["deleted"] == 0
    assert payload["items"][0]["runId"] == run.run_id
    assert payload["items"][0]["action"] == "archive"


def test_web_api_tenant_default_artifact_retention_policy(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-default-retention",
        name="Tenant Default Retention",
    )
    cookie_tenant_headers = {"x-tenant-id": "tenant-default-retention"}

    updated_policy = web_client.put(
        "/api/v1/tenants/tenant-default-retention/artifact-retention-policy",
        headers=cookie_tenant_headers,
        json={
            "archiveAfterDays": 0,
            "deleteAfterDays": 21,
            "reason": "tenant baseline",
        },
    )
    assert updated_policy.status_code == 200
    assert updated_policy.json()["data"]["enabled"] is True
    assert updated_policy.json()["data"]["archiveAfterDays"] == 0

    policy = web_client.get(
        "/api/v1/tenants/tenant-default-retention/artifact-retention-policy",
        headers=cookie_tenant_headers,
    )
    assert policy.status_code == 200
    assert policy.json()["data"]["deleteAfterDays"] == 21

    run = web_client.app.state.runs.create_run(
        kind=RunKind.AGENT,
        label="Tenant default retention artifact",
        task_preview="Inherit tenant default retention",
        tenant_id="tenant-default-retention",
        agent_id="agent-tenant-default-retention",
        session_key="agent:artifact:telegram:chat-9",
    )
    web_client.app.state.runs.start_run(run.run_id)
    artifact_path = web_client.app.state.runs.write_markdown_artifact(
        run.run_id,
        title="Tenant default retention artifact",
        sections=[("Summary", "Tenant default governed content.")],
    )
    web_client.app.state.runs.complete_run(
        run.run_id,
        RunResultSummary(content="Tenant default governed content."),
        artifact_path=artifact_path,
    )

    audit = web_client.get(f"/api/v1/runs/{run.run_id}/artifact/audit", headers=tenant_headers)
    assert audit.status_code == 200
    assert audit.json()["data"]["retentionPolicy"]["enabled"] is True
    assert audit.json()["data"]["retentionPolicy"]["source"] == "tenant_default"
    assert audit.json()["data"]["retentionPolicy"]["nextAction"] == "archive"

    applied = web_client.post(
        f"/api/v1/runs/{run.run_id}/artifact/retention/apply",
        headers=tenant_headers,
        json={},
    )
    assert applied.status_code == 200
    assert applied.json()["data"]["applied"] is True
    assert applied.json()["data"]["action"] == "archive"

    archived_audit = web_client.get(f"/api/v1/runs/{run.run_id}/artifact/audit", headers=tenant_headers)
    assert archived_audit.status_code == 200
    assert archived_audit.json()["data"]["lifecycleStatus"] == "archived"


def test_web_api_agent_template_artifact_retention_policy_inherited_by_run_audit(web_client: TestClient) -> None:
    tenant_headers = _create_tenant_api_headers(
        web_client,
        tenant_id="tenant-agent-template-retention",
        name="Agent Template Retention",
    )

    created = web_client.post(
        "/api/v1/agents",
        headers=tenant_headers,
        json={
            "name": "Retention Agent",
            "systemPrompt": "Keep retention tidy.",
            "artifactRetentionPolicy": {
                "archiveAfterDays": 2,
                "deleteAfterDays": 9,
            },
        },
    )
    assert created.status_code == 201
    agent = created.json()["data"]
    assert agent["artifactRetentionPolicy"]["archiveAfterDays"] == 2
    assert agent["artifactRetentionPolicy"]["deleteAfterDays"] == 9

    run = web_client.app.state.runs.create_run(
        kind=RunKind.AGENT,
        label="Agent template retention artifact",
        task_preview="Inherit agent template retention",
        tenant_id="tenant-agent-template-retention",
        agent_id=agent["agentId"],
        session_key="agent:artifact:telegram:chat-agent-template",
    )
    web_client.app.state.runs.start_run(run.run_id)
    artifact_path = web_client.app.state.runs.write_markdown_artifact(
        run.run_id,
        title="Agent template retention artifact",
        sections=[("Summary", "Agent template governed content.")],
    )
    web_client.app.state.runs.complete_run(
        run.run_id,
        RunResultSummary(content="Agent template governed content."),
        artifact_path=artifact_path,
    )

    audit = web_client.get(f"/api/v1/runs/{run.run_id}/artifact/audit", headers=tenant_headers)
    assert audit.status_code == 200
    retention = audit.json()["data"]["retentionPolicy"]
    assert retention["enabled"] is True
    assert retention["source"] == "agent_template"
    assert retention["archiveAfterDays"] == 2
    assert retention["deleteAfterDays"] == 9


def test_web_api_knowledge_base_crud_upload_and_retrieve(web_client: TestClient) -> None:
    created = web_client.post(
        "/api/v1/knowledge-bases",
        json={
            "name": "Support KB",
            "description": "Customer support knowledge base",
            "retrievalProfile": {"mode": "hybrid", "chunkSize": 400, "chunkOverlap": 40},
        },
    )
    assert created.status_code == 201
    kb = created.json()["data"]
    assert kb["kbId"] == "support-kb"

    uploaded = web_client.post(
        f"/api/v1/knowledge-bases/{kb['kbId']}/documents",
        files={"file": ("runbook.md", b"# Runbook\n\nReset the token cache before restarting the worker.\n", "text/markdown")},
    )
    assert uploaded.status_code == 202
    upload_payload = uploaded.json()["data"]
    assert upload_payload["documents"][0]["docStatus"] == "uploaded"
    assert upload_payload["jobs"][0]["status"] == "queued"

    uploaded_document, uploaded_job = _wait_for_knowledge_ingest(
        web_client,
        kb_id=kb["kbId"],
        doc_id=upload_payload["documents"][0]["docId"],
        job_id=upload_payload["jobs"][0]["jobId"],
    )
    assert uploaded_document["title"] == "runbook.md"
    assert uploaded_document["docStatus"] == "indexed"
    assert uploaded_job["status"] == "succeeded"

    retrieved = web_client.post(
        f"/api/v1/knowledge-bases/{kb['kbId']}/retrieve-test",
        json={"query": "restart the worker", "mode": "hybrid"},
    )
    assert retrieved.status_code == 200
    data = retrieved.json()["data"]
    assert data["effectiveMode"] == "hybrid"
    assert len(data["hits"]) >= 1
    assert "runbook.md" == data["hits"][0]["citation"]["title"]

    semantic = web_client.post(
        f"/api/v1/knowledge-bases/{kb['kbId']}/retrieve-test",
        json={"query": "restarting workers", "mode": "semantic"},
    )
    assert semantic.status_code == 200
    semantic_payload = semantic.json()["data"]
    assert semantic_payload["effectiveMode"] == "semantic"
    assert len(semantic_payload["hits"]) >= 1

    reindexed = web_client.post(
        f"/api/v1/knowledge-bases/{kb['kbId']}/reindex",
        json={"docIds": [upload_payload["documents"][0]["docId"]]},
    )
    assert reindexed.status_code == 202
    reindex_payload = reindexed.json()["data"]
    assert reindex_payload["documents"][0]["docStatus"] == "uploaded"
    assert reindex_payload["jobs"][0]["status"] == "queued"

    reindexed_document, reindex_job = _wait_for_knowledge_ingest(
        web_client,
        kb_id=kb["kbId"],
        doc_id=reindex_payload["documents"][0]["docId"],
        job_id=reindex_payload["jobs"][0]["jobId"],
    )
    assert reindexed_document["docStatus"] == "indexed"
    assert reindex_job["status"] == "succeeded"

    deleted_doc = web_client.delete(
        f"/api/v1/knowledge-bases/{kb['kbId']}/documents/{upload_payload['documents'][0]['docId']}"
    )
    assert deleted_doc.status_code == 200
    assert deleted_doc.json()["data"] == {"deleted": True}


def test_web_api_knowledge_base_batch_delete_documents(web_client: TestClient) -> None:
    created = web_client.post(
        "/api/v1/knowledge-bases",
        json={
            "name": "Operations KB",
            "description": "Runbooks and FAQ",
        },
    )
    assert created.status_code == 201
    kb = created.json()["data"]

    upload = web_client.post(
        f"/api/v1/knowledge-bases/{kb['kbId']}/documents",
        files=[
            ("file", ("runbook.md", b"# Runbook\n\nRestart the worker after draining the queue.\n", "text/markdown")),
            ("file", ("faq.md", b"# FAQ\n\nReset the token cache before retrying login.\n", "text/markdown")),
        ],
    )
    assert upload.status_code == 202
    upload_payload = upload.json()["data"]
    doc_ids = [item["docId"] for item in upload_payload["documents"]]
    job_ids = [item["jobId"] for item in upload_payload["jobs"]]

    for doc_id, job_id in zip(doc_ids, job_ids, strict=True):
        document, job = _wait_for_knowledge_ingest(
            web_client,
            kb_id=kb["kbId"],
            doc_id=doc_id,
            job_id=job_id,
        )
        assert document["docStatus"] == "indexed"
        assert job["status"] == "succeeded"

    deleted = web_client.post(
        f"/api/v1/knowledge-bases/{kb['kbId']}/documents/delete",
        json={"docIds": doc_ids},
    )
    assert deleted.status_code == 200
    deleted_payload = deleted.json()["data"]
    assert deleted_payload["deletedCount"] == 2
    assert deleted_payload["docIds"] == doc_ids

    listed_docs = web_client.get(f"/api/v1/knowledge-bases/{kb['kbId']}/documents")
    assert listed_docs.status_code == 200
    assert listed_docs.json()["data"] == []


def test_web_api_knowledge_sources_list_and_sync(web_client: TestClient) -> None:
    created = web_client.post(
        "/api/v1/knowledge-bases",
        json={
            "name": "Support Sources",
            "description": "Source governance test",
        },
    )
    assert created.status_code == 201
    kb = created.json()["data"]

    faq_created = web_client.post(
        f"/api/v1/knowledge-bases/{kb['kbId']}/documents",
        json={
            "sourceType": "faq_table",
            "title": "Support FAQ",
            "items": [
                {
                    "question": "How do we restart the worker?",
                    "answer": "Drain the queue and restart the worker.",
                }
            ],
        },
    )
    assert faq_created.status_code == 202
    faq_payload = faq_created.json()["data"]
    document, job = _wait_for_knowledge_ingest(
        web_client,
        kb_id=kb["kbId"],
        doc_id=faq_payload["documents"][0]["docId"],
        job_id=faq_payload["jobs"][0]["jobId"],
    )
    assert document["docStatus"] == "indexed"
    assert job["status"] == "succeeded"

    sources = web_client.get(f"/api/v1/knowledge-bases/{kb['kbId']}/sources")
    assert sources.status_code == 200
    source_payload = sources.json()["data"]
    assert len(source_payload) == 1
    source = source_payload[0]
    assert source["sourceType"] == "faq_table"
    assert source["syncSupported"] is True
    assert source["docCount"] == 1
    assert source["latestDocument"]["docId"] == faq_payload["documents"][0]["docId"]

    updated = web_client.put(
        f"/api/v1/knowledge-bases/{kb['kbId']}/sources/{source['sourceId']}",
        json={
            "title": "Support FAQ v2",
            "enabled": False,
            "items": [
                {
                    "question": "How do we restart the worker?",
                    "answer": "Pause intake, then restart the worker safely.",
                }
            ],
        },
    )
    assert updated.status_code == 200
    updated_payload = updated.json()["data"]
    assert updated_payload["title"] == "Support FAQ v2"
    assert updated_payload["enabled"] is False
    assert updated_payload["config"]["items"][0]["answer"] == "Pause intake, then restart the worker safely."

    reenabled = web_client.put(
        f"/api/v1/knowledge-bases/{kb['kbId']}/sources/{source['sourceId']}",
        json={"enabled": True},
    )
    assert reenabled.status_code == 200
    assert reenabled.json()["data"]["enabled"] is True

    synced = web_client.post(f"/api/v1/knowledge-bases/{kb['kbId']}/sources/{source['sourceId']}/sync")
    assert synced.status_code == 202
    synced_payload = synced.json()["data"]
    assert synced_payload["source"]["syncCount"] == 2
    assert synced_payload["document"]["docStatus"] == "uploaded"
    assert synced_payload["job"]["status"] == "queued"

    synced_document, synced_job = _wait_for_knowledge_ingest(
        web_client,
        kb_id=kb["kbId"],
        doc_id=synced_payload["document"]["docId"],
        job_id=synced_payload["job"]["jobId"],
    )
    assert synced_document["docStatus"] == "indexed"
    assert synced_job["status"] == "succeeded"


def test_web_api_cron_crud_and_run(web_client: TestClient) -> None:
    calls: list[str] = []

    async def fake_on_job(job) -> str:
        calls.append(job.id)
        return "ok"

    web_client.app.state.web.cron.on_job = fake_on_job

    created = web_client.post(
        "/api/v1/cron/jobs",
        json={
            "name": "workspace recap",
            "triggerType": "every",
            "triggerIntervalSeconds": 3600,
            "payloadMessage": "summarize the latest workspace changes",
        },
    )
    assert created.status_code == 201
    job = created.json()["data"]

    listed = web_client.get("/api/v1/cron/jobs", params={"includeDisabled": "true"})
    assert listed.status_code == 200
    assert listed.json()["data"]["jobs"][0]["id"] == job["id"]

    ran = web_client.post(f"/api/v1/cron/jobs/{job['id']}/run")
    assert ran.status_code == 200
    assert ran.json()["data"] == {"ran": True}
    assert calls == [job["id"]]

    updated = web_client.patch(
        f"/api/v1/cron/jobs/{job['id']}",
        json={
            "enabled": False,
            "name": "paused recap",
            "triggerType": "every",
            "triggerIntervalSeconds": 7200,
            "payloadMessage": "summarize the latest workspace changes",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["enabled"] is False
    assert updated.json()["data"]["name"] == "paused recap"

    deleted = web_client.delete(f"/api/v1/cron/jobs/{job['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}


def test_web_api_config_meta_uses_provider_registry(web_client: TestClient) -> None:
    config_meta = web_client.get("/api/v1/config/meta")
    assert config_meta.status_code == 200
    payload = config_meta.json()["data"]

    providers = payload["providers"]
    assert any(item["name"] == "openrouter" and item["category"] == "gateway" for item in providers)
    assert any(item["name"] == "ollama" and item["category"] == "local" for item in providers)
    assert any(item["name"] == "openai_codex" and item["category"] == "oauth" for item in providers)
    assert payload["resolvedProvider"] == "auto"


def test_web_api_config_update_rebuilds_knowledge_rag_engine(
    web_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _HotSwapEngine:
        def __init__(self, label: str) -> None:
            self.label = label

        async def shutdown_async(self) -> None:
            return None

    created: list[_HotSwapEngine] = []

    def _build_engine(config: Config, instance_dir: Path) -> _HotSwapEngine:
        engine = _HotSwapEngine(f"engine-{len(created) + 1}")
        created.append(engine)
        assert config.rag.llm_binding == "rag-llm"
        assert config.rag.embedding_binding == "rag-embedding"
        return engine

    monkeypatch.setattr(
        "nanobot.web.runtime_services.config.create_rag_engine_from_config",
        _build_engine,
    )

    old_engine = web_client.app.state.web.app_knowledge.rag_engine
    payload = web_client.get("/api/v1/config").json()["data"]
    payload["modelBindings"] = {
        "rag-llm": {
            "provider": "moonshot",
            "label": "Kimi",
            "model": "moonshot/kimi-k2.5",
            "apiKey": "sk-rag-llm",
            "apiBase": "https://api.moonshot.cn/v1",
            "extraHeaders": {},
        },
        "rag-embedding": {
            "provider": "openai",
            "label": "OpenAI Embedding",
            "model": "text-embedding-3-large",
            "capabilityType": "embedding",
            "apiKey": "sk-rag-embed",
            "apiBase": "https://api.openai.com/v1",
            "extraHeaders": {},
        },
    }
    payload["rag"] = {
        "llmBinding": "rag-llm",
        "embeddingBinding": "rag-embedding",
    }

    response = web_client.put("/api/v1/config", json=payload)

    assert response.status_code == 200
    assert len(created) == 1
    assert web_client.app.state.web.app_knowledge.rag_engine is created[0]
    assert old_engine in web_client.app.state.web.app_knowledge._retired_rag_engines
    assert response.json()["data"]["rag"]["llmBinding"] == "rag-llm"
    assert response.json()["data"]["rag"]["embeddingBinding"] == "rag-embedding"


def test_web_api_model_binding_test_endpoint_uses_current_payload(web_client: TestClient) -> None:
    captured: dict[str, str | None] = {}
    fake_provider = SimpleNamespace(
        chat_with_retry=AsyncMock(
            return_value=LLMResponse(content="OK", finish_reason="stop", usage={"total_tokens": 12})
        )
    )

    def _make_provider(config):
        captured["api_base"] = config.get_api_base(config.agents.defaults.model)
        return fake_provider

    web_client.app.state.web.config_runtime.make_provider = _make_provider

    response = web_client.post(
        "/api/v1/config/model-bindings/test",
        json={
            "bindingName": "kimi-cn",
            "label": "Kimi 国内",
            "provider": "moonshot",
            "model": "kimi-k2.5",
            "apiKey": "sk-kimi-cn",
            "apiBase": "https://api.moonshot.cn/v1",
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["ok"] is True
    assert payload["bindingName"] == "kimi-cn"
    assert payload["provider"] == "moonshot"
    assert payload["model"] == "kimi-k2.5"
    assert payload["responsePreview"] == "OK"
    assert captured["api_base"] == "https://api.moonshot.cn/v1"
    kwargs = fake_provider.chat_with_retry.await_args.kwargs
    assert kwargs["model"] == "kimi-k2.5"
    assert kwargs["max_tokens"] == 16


def test_web_api_model_binding_test_endpoint_normalizes_full_chat_endpoint(
    web_client: TestClient,
) -> None:
    captured: dict[str, str | None] = {}
    fake_provider = SimpleNamespace(
        chat_with_retry=AsyncMock(
            return_value=LLMResponse(content="OK", finish_reason="stop", usage={"total_tokens": 9})
        )
    )

    def _make_provider(config):
        captured["api_base"] = config.get_api_base(config.agents.defaults.model)
        return fake_provider

    web_client.app.state.web.config_runtime.make_provider = _make_provider

    response = web_client.post(
        "/api/v1/config/model-bindings/test",
        json={
            "bindingName": "deepseek",
            "label": "DeepSeek",
            "provider": "deepseek",
            "model": "deepseek-chat",
            "apiKey": "sk-deepseek",
            "apiBase": "https://api.deepseek.com/chat/completions",
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["ok"] is True
    assert captured["api_base"] == "https://api.deepseek.com"


def test_web_api_model_binding_models_endpoint_uses_current_payload(
    web_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remote_models = AsyncMock(return_value=["kimi-k2.5", "kimi-k2-0905-preview"])
    monkeypatch.setattr(web_client.app.state.web.config_runtime, "_request_remote_models", remote_models)

    response = web_client.post(
        "/api/v1/config/model-bindings/models",
        json={
            "bindingName": "kimi-cn",
            "label": "Kimi 国内",
            "provider": "moonshot",
            "apiKey": "sk-kimi-cn",
            "apiBase": "https://api.moonshot.cn/v1",
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["bindingName"] == "kimi-cn"
    assert payload["provider"] == "moonshot"
    assert payload["models"] == ["kimi-k2.5", "kimi-k2-0905-preview"]
    assert payload["count"] == 2
    assert payload["source"] == "remote"
    assert payload["message"] == "已获取 2 个模型"
    assert remote_models.await_count == 1
    assert remote_models.await_args.kwargs == {
        "provider_name": "moonshot",
        "api_key": "sk-kimi-cn",
        "api_base": "https://api.moonshot.cn/v1",
    }


def test_web_api_model_binding_models_endpoint_normalizes_full_chat_endpoint(
    web_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remote_models = AsyncMock(return_value=["deepseek-chat", "deepseek-reasoner"])
    monkeypatch.setattr(web_client.app.state.web.config_runtime, "_request_remote_models", remote_models)

    response = web_client.post(
        "/api/v1/config/model-bindings/models",
        json={
            "bindingName": "deepseek",
            "label": "DeepSeek",
            "provider": "deepseek",
            "apiKey": "sk-deepseek",
            "apiBase": "https://api.deepseek.com/chat/completions",
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["models"] == ["deepseek-chat", "deepseek-reasoner"]
    assert remote_models.await_args.kwargs == {
        "provider_name": "deepseek",
        "api_key": "sk-deepseek",
        "api_base": "https://api.deepseek.com",
    }


def test_web_api_unknown_route_uses_envelope(web_client: TestClient) -> None:
    response = web_client.post("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_web_api_calendar_crud_and_settings(web_client: TestClient) -> None:
    start_time = datetime.now().replace(second=0, microsecond=0) + timedelta(days=2, hours=1)
    end_time = start_time + timedelta(hours=1)
    updated_start_time = start_time + timedelta(hours=1)
    updated_end_time = updated_start_time + timedelta(hours=1)

    created = web_client.post(
        "/api/v1/calendar/events",
        json={
            "title": "Design review",
            "description": "Walk through the web migration",
            "start": start_time.isoformat(),
            "end": end_time.isoformat(),
            "isAllDay": False,
            "priority": "high",
            "reminders": [{"time": 15, "channel": "web", "target": "calendar-reminders"}],
        },
    )
    assert created.status_code == 201
    event = created.json()["data"]
    assert event["title"] == "Design review"
    assert event["priority"] == "high"
    assert event["reminders"][0]["time"] == 15

    listed = web_client.get(
        "/api/v1/calendar/events",
        params={
            "start": (start_time - timedelta(days=1)).isoformat(),
            "end": (updated_end_time + timedelta(days=1)).isoformat(),
        },
    )
    assert listed.status_code == 200
    assert listed.json()["data"][0]["id"] == event["id"]

    updated = web_client.patch(
        f"/api/v1/calendar/events/{event['id']}",
        json={
            "title": "Updated review",
            "start": updated_start_time.isoformat(),
            "end": updated_end_time.isoformat(),
            "reminders": [{"time": 30, "channel": "web", "target": "calendar-reminders"}],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["title"] == "Updated review"
    assert updated.json()["data"]["reminders"][0]["time"] == 30

    settings = web_client.get("/api/v1/calendar/settings")
    assert settings.status_code == 200
    assert settings.json()["data"]["defaultView"] == "dayGridMonth"

    updated_settings = web_client.patch(
        "/api/v1/calendar/settings",
        json={
            "defaultView": "timeGridWeek",
            "defaultPriority": "low",
            "soundEnabled": False,
            "notificationEnabled": True,
        },
    )
    assert updated_settings.status_code == 200
    assert updated_settings.json()["data"]["defaultView"] == "timeGridWeek"
    assert updated_settings.json()["data"]["soundEnabled"] is False

    jobs = web_client.get("/api/v1/calendar/jobs")
    assert jobs.status_code == 200
    assert len(jobs.json()["data"]) == 1
    job = jobs.json()["data"][0]
    assert job["source"] == "calendar"

    ran = web_client.post(f"/api/v1/cron/jobs/{job['id']}/run")
    assert ran.status_code == 200
    assert ran.json()["data"] == {"ran": True}

    sessions = web_client.get("/api/v1/chat/sessions")
    assert sessions.status_code == 200
    reminder_session = next(
        item for item in sessions.json()["data"]["items"] if item["title"] == "Calendar Reminders"
    )
    messages = web_client.get(f"/api/v1/chat/sessions/{reminder_session['id']}/messages")
    assert messages.status_code == 200
    assert "Updated review" in messages.json()["data"][-1]["content"]

    deleted = web_client.delete(f"/api/v1/calendar/events/{event['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}

    jobs_after_delete = web_client.get("/api/v1/calendar/jobs")
    assert jobs_after_delete.status_code == 200
    assert jobs_after_delete.json()["data"] == []


def test_web_api_calendar_page_data_keeps_events_and_jobs_traceable(web_client: TestClient) -> None:
    first_start = datetime.now().replace(second=0, microsecond=0) + timedelta(days=1, hours=2)
    second_start = first_start + timedelta(hours=3)

    for title, start_time in (
        ("Design review", first_start),
        ("Launch checklist", second_start),
    ):
        created = web_client.post(
            "/api/v1/calendar/events",
            json={
                "title": title,
                "description": f"{title} notes",
                "start": start_time.isoformat(),
                "end": (start_time + timedelta(hours=1)).isoformat(),
                "priority": "medium",
                "reminders": [{"time": 20, "channel": "web", "target": "calendar-reminders"}],
            },
        )
        assert created.status_code == 201

    events = web_client.get("/api/v1/calendar/events")
    assert events.status_code == 200
    event_payload = events.json()["data"]
    assert [item["title"] for item in event_payload] == ["Design review", "Launch checklist"]
    assert all(item["reminders"][0]["target"] == "calendar-reminders" for item in event_payload)

    jobs = web_client.get("/api/v1/calendar/jobs")
    assert jobs.status_code == 200
    job_payload = jobs.json()["data"]
    assert len(job_payload) == 2
    assert all(item["source"] == "calendar" for item in job_payload)
    assert all(item["payload"]["kind"] == "calendar_reminder" for item in job_payload)

    traced_titles = {item["title"] for item in event_payload}
    for job in job_payload:
        assert any(title in job["name"] or title in job["payload"]["message"] for title in traced_titles)


def test_web_api_agent_templates_crud_import_export_and_skills(web_client: TestClient) -> None:
    listed = web_client.get("/api/v1/agent-templates")
    assert listed.status_code == 200
    templates = listed.json()["data"]
    assert any(item["name"] == "coder" for item in templates)
    assert any(item["is_builtin"] for item in templates)

    valid_tools = web_client.get("/api/v1/agent-templates/tools/valid")
    assert valid_tools.status_code == 200
    assert any(item["name"] == "read_file" for item in valid_tools.json()["data"])

    skills = web_client.get("/api/v1/skills/installed")
    assert skills.status_code == 200
    assert len(skills.json()["data"]) > 0

    created = web_client.post(
        "/api/v1/agent-templates",
        json={
            "name": "repo-reviewer",
            "description": "Review-oriented template",
            "tools": ["read_file", "list_dir", "web_search"],
            "rules": ["Check key files first", "Summarize findings clearly"],
            "system_prompt": "Review this repository for the assigned task: {task}",
            "skills": ["skill-creator"],
            "enabled": True,
        },
    )
    assert created.status_code == 201
    assert created.json()["data"] == {"name": "repo-reviewer", "success": True}

    fetched = web_client.get("/api/v1/agent-templates/repo-reviewer")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["name"] == "repo-reviewer"
    assert fetched.json()["data"]["skills"] == ["skill-creator"]

    updated = web_client.patch(
        "/api/v1/agent-templates/repo-reviewer",
        json={
            "description": "Updated review template",
            "tools": ["read_file", "write_file", "list_dir"],
            "rules": ["Read before editing", "Keep notes concise"],
            "system_prompt": "Updated prompt for {task}",
            "skills": [],
            "model": "deepseek/deepseek-chat",
            "enabled": False,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"] == {"name": "repo-reviewer", "success": True}

    fetched_after_update = web_client.get("/api/v1/agent-templates/repo-reviewer")
    assert fetched_after_update.status_code == 200
    assert fetched_after_update.json()["data"]["enabled"] is False
    assert fetched_after_update.json()["data"]["model"] == "deepseek/deepseek-chat"

    exported = web_client.post(
        "/api/v1/agent-templates/export",
        json={"names": ["repo-reviewer"]},
    )
    assert exported.status_code == 200
    export_content = exported.json()["data"]["content"]
    assert "repo-reviewer" in export_content
    assert "agents:" in export_content

    imported = web_client.post(
        "/api/v1/agent-templates/import",
        json={"content": export_content, "on_conflict": "rename"},
    )
    assert imported.status_code == 200
    imported_data = imported.json()["data"]
    assert imported_data["errors"] == []
    assert imported_data["imported"][0]["name"].startswith("repo-reviewer-")

    delete_builtin = web_client.delete("/api/v1/agent-templates/coder")
    assert delete_builtin.status_code == 400
    assert delete_builtin.json()["error"]["code"] == "AGENT_TEMPLATE_DELETE_FAILED"

    deleted = web_client.delete("/api/v1/agent-templates/repo-reviewer")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"name": "repo-reviewer", "success": True}

    reload = web_client.post("/api/v1/agent-templates/reload")
    assert reload.status_code == 200
    assert reload.json()["data"] == {"success": True}


def test_web_api_agent_templates_page_data_exposes_builtin_and_workspace_semantics(
    web_client: TestClient,
) -> None:
    listed = web_client.get("/api/v1/agent-templates")
    assert listed.status_code == 200
    items = {item["name"]: item for item in listed.json()["data"]}

    coder = items["coder"]
    assert coder["is_builtin"] is True
    assert coder["is_editable"] is False
    assert coder["is_deletable"] is False
    assert coder["source"] == "builtin"
    assert coder["enabled"] is True

    created = web_client.post(
        "/api/v1/agent-templates",
        json={
            "name": "ops-helper",
            "description": "Operator-focused template",
            "tools": ["read_file", "list_dir"],
            "rules": ["Inspect state first", "Explain trade-offs clearly"],
            "system_prompt": "Operate on the assigned task: {task}",
            "skills": ["skill-creator"],
            "enabled": True,
        },
    )
    assert created.status_code == 201

    detail = web_client.get("/api/v1/agent-templates/ops-helper")
    assert detail.status_code == 200
    detail_payload = detail.json()["data"]
    assert detail_payload["is_builtin"] is False
    assert detail_payload["is_editable"] is True
    assert detail_payload["is_deletable"] is True
    assert detail_payload["skills"] == ["skill-creator"]
    assert detail_payload["tools"] == ["read_file", "list_dir"]


def test_web_api_valid_template_tools_include_runtime_message_and_cron(web_client: TestClient) -> None:
    response = web_client.get("/api/v1/agent-templates/tools/valid")
    assert response.status_code == 200
    names = {item["name"] for item in response.json()["data"]}
    assert {"read_file", "message", "cron"} <= names


def test_web_api_agents_crud_copy_and_toggle(web_client: TestClient) -> None:
    listed_initial = web_client.get("/api/v1/agents")
    assert listed_initial.status_code == 200
    assert listed_initial.json()["data"] == []

    created = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Repo Analyst",
            "templateName": "analyst",
            "description": "Investigate repository-level issues",
            "mcpServerIds": ["filesystem"],
            "knowledgeBindingIds": ["kb-product"],
        },
    )
    assert created.status_code == 201
    agent = created.json()["data"]
    assert agent["agentId"] == "repo-analyst"
    assert agent["sourceTemplateName"] == "analyst"
    assert agent["mcpServerIds"] == ["filesystem"]
    assert agent["knowledgeBindingIds"] == ["kb-product"]
    assert agent["toolAllowlist"] != []

    fetched = web_client.get(f"/api/v1/agents/{agent['agentId']}")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["name"] == "Repo Analyst"

    updated = web_client.put(
        f"/api/v1/agents/{agent['agentId']}",
        json={
            "description": "Updated analyst description",
            "toolAllowlist": ["read_file", "web_search"],
            "skillIds": ["skill-creator"],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["description"] == "Updated analyst description"
    assert updated.json()["data"]["toolAllowlist"] == ["read_file", "web_search"]
    assert updated.json()["data"]["skillIds"] == ["skill-creator"]

    copied = web_client.post(f"/api/v1/agents/{agent['agentId']}/copy")
    assert copied.status_code == 201
    assert copied.json()["data"]["name"] == "Repo Analyst Copy"

    disabled = web_client.post(f"/api/v1/agents/{agent['agentId']}/disable")
    assert disabled.status_code == 200
    assert disabled.json()["data"]["enabled"] is False

    enabled_list = web_client.get("/api/v1/agents", params={"enabled": "true"})
    assert enabled_list.status_code == 200
    assert len(enabled_list.json()["data"]) == 1
    assert enabled_list.json()["data"][0]["name"] == "Repo Analyst Copy"

    enabled_again = web_client.post(f"/api/v1/agents/{agent['agentId']}/enable")
    assert enabled_again.status_code == 200
    assert enabled_again.json()["data"]["enabled"] is True

    deleted = web_client.delete(f"/api/v1/agents/{agent['agentId']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}


def test_web_api_agents_creation_persists_in_instance_scoped_store(web_client: TestClient) -> None:
    created = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Workspace Agent",
            "systemPrompt": "Help with workspace tasks.",
        },
    )
    assert created.status_code == 201
    agent_id = created.json()["data"]["agentId"]

    db_path = web_client.app.state.instance.agent_definitions_db_path()
    store = AgentDefinitionStore(db_path)
    persisted = store.get(agent_id)
    assert persisted is not None
    assert persisted.instance_id == web_client.app.state.instance.id


def test_web_api_skill_upload_list_and_delete(web_client: TestClient) -> None:
    skill_md = b"""---
name: demo-skill
description: Demo uploaded skill
author: Test Suite
version: 0.1.0
tags: demo, test
---

# Demo Skill

Use this skill for demo testing.
"""
    helper_md = b"# Helper Notes\n\nSupport file for the uploaded skill.\n"

    uploaded = web_client.post(
        "/api/v1/skills/upload",
        data={
            "path": [
                "demo-skill/SKILL.md",
                "demo-skill/references/helper.md",
            ]
        },
        files=[
            ("file", ("SKILL.md", skill_md, "text/markdown")),
            ("file", ("helper.md", helper_md, "text/markdown")),
        ],
    )
    assert uploaded.status_code == 201
    uploaded_skill = uploaded.json()["data"]
    assert uploaded_skill["id"] == "demo-skill"
    assert uploaded_skill["source"] == "workspace"
    assert uploaded_skill["isDeletable"] is True
    assert uploaded_skill["version"] == "0.1.0"

    listed = web_client.get("/api/v1/skills/installed")
    assert listed.status_code == 200
    skills = listed.json()["data"]
    demo_skill = next(item for item in skills if item["id"] == "demo-skill")
    assert "demo" in demo_skill["tags"]
    assert demo_skill["author"] == "Test Suite"

    delete_builtin = web_client.delete("/api/v1/skills/skill-creator")
    assert delete_builtin.status_code == 400
    assert delete_builtin.json()["error"]["code"] == "SKILL_DELETE_FAILED"

    deleted = web_client.delete("/api/v1/skills/demo-skill")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}

    listed_after_delete = web_client.get("/api/v1/skills/installed")
    assert listed_after_delete.status_code == 200
    assert all(item["id"] != "demo-skill" for item in listed_after_delete.json()["data"])


def test_web_api_skillhub_marketplace_list_install_and_delete(
    web_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = web_client.app.state.web.workspace_runtime

    def fake_list_skills(query: str = "", limit: int = 24, offset: int = 0) -> dict[str, object]:
        assert query == "protocol"
        assert limit == 5
        return {
            "skills": [
                {
                    "id": "0.protocol",
                    "slug": "0.protocol",
                    "name": "0.protocol",
                    "description": "Remote SkillHub entry",
                    "version": "1.0.0",
                    "tags": ["security"],
                    "source": "skillhub",
                    "homepage": "https://skillhub.tencent.com/",
                    "updatedAt": 1_770_000_000_000,
                    "downloads": 42,
                    "compatibility": "native",
                    "compatibilityLabel": "原生可用",
                    "compatibilitySummary": "包含标准 `SKILL.md`，可以被 nanobot 技能加载器识别。",
                    "compatibilityReasons": [
                        "包含标准 `SKILL.md`，可以被 nanobot 技能加载器识别。",
                        "未发现 OpenClaw、Claude 或 Codex 专属 hooks、目录约定或 `sessions_*` 依赖。",
                    ],
                }
            ],
            "total": 1,
        }

    def fake_install_skill(workspace_root: Path, slug: str, *, force: bool = False) -> dict[str, str]:
        assert slug == "0.protocol"
        assert force is False
        skill_root = workspace_root / "skills" / slug
        skill_root.mkdir(parents=True, exist_ok=True)
        (skill_root / "SKILL.md").write_text(
            """---
name: 0.protocol
description: Installed from SkillHub
version: 1.0.0
author: SkillHub
tags: security, protocol
---

# 0.protocol
""",
            encoding="utf-8",
        )
        return {"id": slug, "path": str(skill_root)}

    monkeypatch.setattr(runtime.skillhub, "list_skills", fake_list_skills)
    monkeypatch.setattr(runtime.skillhub, "install_skill", fake_install_skill)

    market = web_client.get("/api/v1/skills/marketplace", params={"q": "protocol", "limit": 5})
    assert market.status_code == 200
    market_payload = market.json()["data"]
    assert market_payload["skills"][0]["slug"] == "0.protocol"
    assert market_payload["skills"][0]["source"] == "skillhub"
    assert market_payload["skills"][0]["compatibility"] == "native"
    assert market_payload["skills"][0]["compatibilityReasons"]
    assert market_payload["total"] == 1

    installed = web_client.post("/api/v1/skills/install", json={"slug": "0.protocol"})
    assert installed.status_code == 201
    installed_payload = installed.json()["data"]
    assert installed_payload["id"] == "0.protocol"
    assert installed_payload["source"] == "workspace"
    assert installed_payload["version"] == "1.0.0"

    listed = web_client.get("/api/v1/skills/installed")
    assert listed.status_code == 200
    assert any(item["id"] == "0.protocol" for item in listed.json()["data"])

    deleted = web_client.delete("/api/v1/skills/0.protocol")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}


def test_web_api_skill_zip_upload_list_and_delete(web_client: TestClient) -> None:
    archive_buffer = BytesIO()
    with zipfile.ZipFile(archive_buffer, "w") as archive:
        archive.writestr(
            "zip-skill/SKILL.md",
            """---
name: zip-skill
description: ZIP uploaded skill
author: Test Suite
version: 0.2.0
tags: zip, upload
---

# Zip Skill
""",
        )
        archive.writestr("zip-skill/references/notes.md", "# Notes\n")

    uploaded = web_client.post(
        "/api/v1/skills/upload-zip",
        files=[
            ("file", ("zip-skill.zip", archive_buffer.getvalue(), "application/zip")),
        ],
    )
    assert uploaded.status_code == 201
    uploaded_skill = uploaded.json()["data"]
    assert uploaded_skill["id"] == "zip-skill"
    assert uploaded_skill["source"] == "workspace"
    assert uploaded_skill["version"] == "0.2.0"

    listed = web_client.get("/api/v1/skills/installed")
    assert listed.status_code == 200
    zip_skill = next(item for item in listed.json()["data"] if item["id"] == "zip-skill")
    assert "zip" in zip_skill["tags"]

    deleted = web_client.delete("/api/v1/skills/zip-skill")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}


def test_web_api_document_center_switch_update_and_reset(web_client: TestClient) -> None:
    listed = web_client.get("/api/v1/documents")
    assert listed.status_code == 200
    document_ids = [item["id"] for item in listed.json()["data"]]
    assert "AGENTS.md" in document_ids
    assert "SOUL.md" in document_ids
    assert "memory/MEMORY.md" in document_ids
    assert "memory/HISTORY.md" in document_ids

    soul = web_client.get("/api/v1/documents/SOUL.md")
    assert soul.status_code == 200
    soul_data = soul.json()["data"]
    assert soul_data["label"] == "SOUL.md"
    assert soul_data["sourcePath"].endswith("SOUL.md")

    updated = web_client.put(
        "/api/v1/documents/SOUL.md",
        json={"content": "# Soul\n\nStay practical."},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["content"] == "# Soul\n\nStay practical."

    fetched_after_update = web_client.get("/api/v1/documents/SOUL.md")
    assert fetched_after_update.status_code == 200
    assert fetched_after_update.json()["data"]["content"] == "# Soul\n\nStay practical."

    reset = web_client.post("/api/v1/documents/SOUL.md/reset")
    assert reset.status_code == 200
    assert reset.json()["data"]["content"] != "# Soul\n\nStay practical."

    history_updated = web_client.put(
        "/api/v1/documents/memory/HISTORY.md",
        json={"content": "temporary history line"},
    )
    assert history_updated.status_code == 200
    assert history_updated.json()["data"]["content"] == "temporary history line"

    history_reset = web_client.post("/api/v1/documents/memory/HISTORY.md/reset")
    assert history_reset.status_code == 200
    assert history_reset.json()["data"]["content"] == ""


def test_run_server_prefers_frontend_dev_mode_when_ready(tmp_path) -> None:
    config = Config()
    frontend_dir = tmp_path / "web-ui"
    frontend_dir.mkdir()
    (frontend_dir / "node_modules").mkdir()

    with patch("nanobot.web.api._resolve_frontend_source_dir", return_value=frontend_dir), \
         patch("nanobot.web.api._resolve_npm_command", return_value="npm"), \
         patch("nanobot.web.api._run_frontend_dev_server") as mock_dev, \
         patch("nanobot.web.api._run_static_server") as mock_static:
        run_server(config, frontend_mode="auto")

    mock_dev.assert_called_once_with(config, "127.0.0.1", 6788, frontend_dir, "npm")
    mock_static.assert_not_called()


def test_run_server_falls_back_to_static_when_frontend_dev_is_unavailable(tmp_path) -> None:
    config = Config()
    frontend_dir = tmp_path / "web-ui"
    frontend_dir.mkdir()

    with patch("nanobot.web.api._resolve_frontend_source_dir", return_value=frontend_dir), \
         patch("nanobot.web.api._resolve_npm_command", return_value="npm"), \
         patch("nanobot.web.api._run_frontend_dev_server") as mock_dev, \
         patch("nanobot.web.api._run_static_server") as mock_static:
        run_server(config, frontend_mode="auto")

    mock_dev.assert_not_called()
    mock_static.assert_called_once_with(config, "127.0.0.1", 6788)


def test_run_server_dev_mode_requires_frontend_dependencies(tmp_path) -> None:
    config = Config()
    frontend_dir = tmp_path / "web-ui"
    frontend_dir.mkdir()

    with patch("nanobot.web.api._resolve_frontend_source_dir", return_value=frontend_dir), \
         patch("nanobot.web.api._resolve_npm_command", return_value="npm"):
        with pytest.raises(RuntimeError, match="npm install"):
            run_server(config, frontend_mode="dev")
