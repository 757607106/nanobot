from __future__ import annotations

import asyncio
import json
import shutil
import time
import zipfile
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from nanobot.config import loader as config_loader
from nanobot.config.loader import save_config
from nanobot.config.schema import Config, MCPServerConfig
from nanobot.platform.agents import AgentDefinitionStore
from nanobot.platform.runs import RunControlScope, RunKind
from nanobot.providers.base import LLMResponse
from nanobot.web.api import create_app, run_server
from nanobot.web import operations as web_operations

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
            and last_document["docStatus"] in {"indexed", "error_parsing", "error_indexing"}
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
        }
        items = {item["name"]: item for item in listed_payload["items"]}
        assert items["telegram"]["status"] == "enabled"
        assert items["telegram"]["configured"] is True
        assert items["discord"]["status"] == "unconfigured"

        detail = client.get("/api/v1/channels/telegram")
        assert detail.status_code == 200
        detail_payload = detail.json()["data"]
        assert detail_payload["channel"]["name"] == "telegram"
        assert detail_payload["config"]["token"] == "tg-token"
        assert detail_payload["config"]["allowFrom"] == ["alice"]

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

    async def fake_chat(session_id_arg: str, content: str, on_progress):
        assert session_id_arg == session_id
        assert content == "review the uploaded file"
        await on_progress("checking uploads")
        return {
            "content": "Saw the uploaded file.",
            "assistantMessage": None,
        }

    monkeypatch.setattr(web_client.app.state.web, "chat", fake_chat)

    dispatched = web_client.post(
        f"/api/v1/chat/sessions/{session_id}/messages",
        json={"content": "review the uploaded file"},
    )
    assert dispatched.status_code == 200
    assert dispatched.json()["data"]["content"] == "Saw the uploaded file."


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
    assert data["runtime"]["activeMcpCount"] == 1
    assert data["recentUploads"][0]["relativePath"].startswith("uploads/")
    assert data["recentToolActivity"][0]["toolName"] == "read_file"
    assert data["activeMcp"][0]["name"] == "filesystem"
    assert len(data["quickPrompts"]) >= 1


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
        kind=RunKind.SUBAGENT,
        label="Research subagent",
        task_preview="Collect references",
        agent_id="main-agent",
        session_key="web:session-1",
        origin_channel="web",
        origin_chat_id="session-1",
        parent_run_id=parent.run_id,
        root_run_id=parent.run_id,
        spawn_depth=1,
        control_scope=RunControlScope.CHILD,
    )

    listed = web_client.get(
        "/api/v1/runs",
        params={"sessionKey": "web:session-1", "kind": "subagent", "agentId": "main-agent"},
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
        assert {tool["function"]["name"] for tool in tools} == {"read_file", "list_dir"}
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
            "toolAllowlist": ["read_file", "message", "spawn"],
        },
    )
    assert created.status_code == 201
    agent = created.json()["data"]

    provider = web_client.app.state.web.agent.provider

    async def fake_chat_with_retry(*, messages, tools, model, **kwargs):
        assert "Use runtime tools when appropriate." in messages[0]["content"]
        assert {tool["function"]["name"] for tool in tools} == {"read_file", "message", "spawn"}
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
    assert payload["appliedBindings"]["toolAllowlist"] == ["read_file", "message", "spawn"]


def test_web_api_team_crud_copy_and_toggle(web_client: TestClient) -> None:
    leader = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Team Lead",
            "systemPrompt": "Coordinate the team.",
        },
    )
    assert leader.status_code == 201
    member = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Team Member",
            "systemPrompt": "Do the assigned work.",
        },
    )
    assert member.status_code == 201

    created = web_client.post(
        "/api/v1/teams",
        json={
            "name": "Support Team",
            "description": "Handle support workflows",
            "leaderAgentId": leader.json()["data"]["agentId"],
            "memberAgentIds": [member.json()["data"]["agentId"]],
            "workflowMode": "parallel_fanout",
            "sharedKnowledgeBindingIds": ["kb-support"],
        },
    )
    assert created.status_code == 201
    team = created.json()["data"]
    assert team["teamId"] == "support-team"
    assert team["memberCount"] == 2

    listed = web_client.get("/api/v1/teams")
    assert listed.status_code == 200
    assert listed.json()["data"][0]["teamId"] == team["teamId"]

    fetched = web_client.get(f"/api/v1/teams/{team['teamId']}")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["leaderAgentId"] == leader.json()["data"]["agentId"]

    updated = web_client.put(
        f"/api/v1/teams/{team['teamId']}",
        json={
            "workflowMode": "sequential_handoff",
            "memberAccessPolicy": {"teamSharedKnowledge": "members_read"},
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["workflowMode"] == "sequential_handoff"

    copied = web_client.post(f"/api/v1/teams/{team['teamId']}/copy")
    assert copied.status_code == 201
    assert copied.json()["data"]["name"] == "Support Team Copy"

    disabled = web_client.post(f"/api/v1/teams/{team['teamId']}/disable")
    assert disabled.status_code == 200
    assert disabled.json()["data"]["enabled"] is False

    enabled = web_client.post(f"/api/v1/teams/{team['teamId']}/enable")
    assert enabled.status_code == 200
    assert enabled.json()["data"]["enabled"] is True

    deleted = web_client.delete(f"/api/v1/teams/{team['teamId']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"]["deleted"] is True


def test_web_api_team_creation_validates_agent_references(web_client: TestClient) -> None:
    created = web_client.post(
        "/api/v1/teams",
        json={
            "name": "Broken Team",
            "leaderAgentId": "missing-agent",
        },
    )
    assert created.status_code == 400
    assert created.json()["error"]["code"] == "TEAM_VALIDATION_ERROR"


def test_web_api_team_run_executes_member_and_leader_runs(web_client: TestClient, monkeypatch) -> None:
    leader = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Support Lead",
            "systemPrompt": "Leader system prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert leader.status_code == 201

    researcher = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Support Researcher",
            "systemPrompt": "Research member prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert researcher.status_code == 201

    reviewer = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Support Reviewer",
            "systemPrompt": "QA member prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert reviewer.status_code == 201

    kb_created = web_client.post(
        "/api/v1/knowledge-bases",
        json={
            "name": "Support Team KB",
            "retrievalProfile": {"mode": "hybrid", "chunkSize": 400, "chunkOverlap": 40},
        },
    )
    assert kb_created.status_code == 201
    kb_id = kb_created.json()["data"]["kbId"]

    faq_ingest = web_client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        json={
            "sourceType": "faq_table",
            "title": "Support FAQ",
            "items": [
                {
                    "question": "What should we do during a customer outage?",
                    "answer": "Escalate to tier 2 after confirming the impacted service and region.",
                }
            ],
        },
    )
    assert faq_ingest.status_code == 202
    faq_payload = faq_ingest.json()["data"]
    uploaded_document, uploaded_job = _wait_for_knowledge_ingest(
        web_client,
        kb_id=kb_id,
        doc_id=faq_payload["documents"][0]["docId"],
        job_id=faq_payload["jobs"][0]["jobId"],
    )
    assert uploaded_document["docStatus"] == "indexed"
    assert uploaded_job["status"] == "succeeded"

    team_created = web_client.post(
        "/api/v1/teams",
        json={
            "name": "Support Team",
            "leaderAgentId": leader.json()["data"]["agentId"],
            "memberAgentIds": [
                researcher.json()["data"]["agentId"],
                reviewer.json()["data"]["agentId"],
            ],
            "workflowMode": "parallel_fanout",
            "sharedKnowledgeBindingIds": [kb_id],
            "memberAccessPolicy": {
                "teamSharedKnowledge": "members_read",
                "teamSharedMemory": "leader_write_member_read",
            },
        },
    )
    assert team_created.status_code == 201
    team_id = team_created.json()["data"]["teamId"]

    provider = web_client.app.state.web.agent.provider

    async def fake_chat_with_retry(*, messages, tools, model, **kwargs):
        _ = tools, kwargs
        assert model == "openai/gpt-4o-mini"
        system = messages[0]["content"]
        user = messages[1]["content"]
        if "Leader system prompt" in system:
            assert "Member Contributions" in user
            assert "Escalate to tier 2" in user
            return LLMResponse(content="Leader final summary", tool_calls=[])
        if "Research member prompt" in system:
            assert "Team Assignment" in user
            assert "Escalate to tier 2" in user
            return LLMResponse(content="Research member result", tool_calls=[])
        if "QA member prompt" in system:
            assert "Team Assignment" in user
            return LLMResponse(content="QA member result", tool_calls=[])
        raise AssertionError(f"Unexpected prompt: {system}")

    provider.chat_with_retry = fake_chat_with_retry
    monkeypatch.setattr(
        web_client.app.state.web.config_runtime,
        "make_provider",
        lambda config: provider,
    )

    tested = web_client.post(
        f"/api/v1/teams/{team_id}/runs",
        json={"content": "Prepare a support response plan for an outage report."},
    )
    assert tested.status_code == 200
    payload = tested.json()["data"]
    assert payload["run"]["kind"] == "team"
    assert payload["run"]["status"] in {"queued", "running"}
    assert payload["leaderRun"] is None
    assert payload["memberRuns"] == []
    assert payload["finalAssistantMessage"] is None

    deadline = time.time() + 3.0
    final_run = payload["run"]
    while time.time() < deadline:
        detail = web_client.get(f"/api/v1/runs/{payload['run']['runId']}")
        assert detail.status_code == 200
        final_run = detail.json()["data"]
        if final_run["status"] == "succeeded":
            break
        time.sleep(0.05)

    assert final_run["status"] == "succeeded"
    assert final_run["resultSummary"]["content"] == "Leader final summary"
    assert final_run["artifactPath"] == f"{payload['run']['runId']}.md"
    assert final_run["threadId"] == f"team-thread:{team_id}"

    listed = web_client.get(
        "/api/v1/runs",
        params={"teamId": team_id, "kind": "team"},
    )
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] == 1
    assert listed.json()["data"]["items"][0]["runId"] == payload["run"]["runId"]

    children = web_client.get(f"/api/v1/runs/{payload['run']['runId']}/children")
    assert children.status_code == 200
    assert children.json()["data"]["total"] == 3
    leader_runs = [item for item in children.json()["data"]["items"] if item["controlScope"] == "leader"]
    member_runs = [item for item in children.json()["data"]["items"] if item["controlScope"] == "member"]
    assert len(leader_runs) == 1
    assert len(member_runs) == 2
    assert all(item["threadId"] == f"team-thread:{team_id}" for item in children.json()["data"]["items"])

    tree = web_client.get(f"/api/v1/runs/{payload['run']['runId']}/tree")
    assert tree.status_code == 200
    assert tree.json()["data"]["runId"] == payload["run"]["runId"]
    assert len(tree.json()["data"]["children"]) == 3

    artifact = web_client.get(f"/api/v1/runs/{payload['run']['runId']}/artifact")
    assert artifact.status_code == 200
    artifact_data = artifact.json()["data"]
    assert artifact_data["artifactPath"] == final_run["artifactPath"]
    assert "Leader final summary" in artifact_data["content"]
    assert "Research member result" in artifact_data["content"]

    thread = web_client.get(f"/api/v1/teams/{team_id}/thread")
    assert thread.status_code == 200
    assert thread.json()["data"]["threadId"] == f"team-thread:{team_id}"

    thread_messages = web_client.get(f"/api/v1/teams/{team_id}/thread/messages")
    assert thread_messages.status_code == 200
    assert thread_messages.json()["data"]["total"] >= 2
    assert thread_messages.json()["data"]["messages"][0]["role"] == "user"
    assert thread_messages.json()["data"]["messages"][-1]["content"] == "Leader final summary"


def test_web_api_team_run_cancel_requests_background_task(web_client: TestClient, monkeypatch) -> None:
    leader = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Cancel Lead",
            "systemPrompt": "Leader system prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert leader.status_code == 201

    member = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Cancel Member",
            "systemPrompt": "Member system prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert member.status_code == 201

    team_created = web_client.post(
        "/api/v1/teams",
        json={
            "name": "Cancelable Team",
            "leaderAgentId": leader.json()["data"]["agentId"],
            "memberAgentIds": [member.json()["data"]["agentId"]],
            "workflowMode": "parallel_fanout",
        },
    )
    assert team_created.status_code == 201
    team_id = team_created.json()["data"]["teamId"]

    provider = web_client.app.state.web.agent.provider

    async def slow_chat_with_retry(*, messages, tools, model, **kwargs):
        _ = messages, tools, model, kwargs
        await asyncio.sleep(1.0)
        return LLMResponse(content="Should not complete", tool_calls=[])

    provider.chat_with_retry = slow_chat_with_retry
    monkeypatch.setattr(
        web_client.app.state.web.config_runtime,
        "make_provider",
        lambda config: provider,
    )

    started = web_client.post(
        f"/api/v1/teams/{team_id}/runs",
        json={"content": "Start a long-running cancellation check."},
    )
    assert started.status_code == 200
    run_id = started.json()["data"]["run"]["runId"]

    cancelled = web_client.post(f"/api/v1/runs/{run_id}/cancel")
    assert cancelled.status_code == 202
    assert cancelled.json()["data"]["taskCancellationSent"] is True

    deadline = time.time() + 3.0
    final_run = cancelled.json()["data"]
    while time.time() < deadline:
        detail = web_client.get(f"/api/v1/runs/{run_id}")
        assert detail.status_code == 200
        final_run = detail.json()["data"]
        if final_run["status"] == "cancelled":
            break
        time.sleep(0.05)

    assert final_run["status"] == "cancelled"


def test_web_api_team_run_retry_with_append_context(web_client: TestClient, monkeypatch) -> None:
    leader = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Retry Lead",
            "systemPrompt": "Leader system prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert leader.status_code == 201

    member = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Retry Member",
            "systemPrompt": "Member system prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert member.status_code == 201

    team_created = web_client.post(
        "/api/v1/teams",
        json={
            "name": "Retry Team",
            "leaderAgentId": leader.json()["data"]["agentId"],
            "memberAgentIds": [member.json()["data"]["agentId"]],
            "workflowMode": "parallel_fanout",
        },
    )
    assert team_created.status_code == 201
    team_id = team_created.json()["data"]["teamId"]

    provider = web_client.app.state.web.agent.provider
    seen_user_messages: list[str] = []

    async def fake_chat_with_retry(*, messages, tools, model, **kwargs):
        _ = tools, model, kwargs
        system = messages[0]["content"]
        user = messages[1]["content"]
        seen_user_messages.append(user)
        if "Leader system prompt" in system:
            if "Use a warmer tone." in user:
                return LLMResponse(content="Leader summary with appended context", tool_calls=[])
            return LLMResponse(content="Leader summary", tool_calls=[])
        return LLMResponse(content="Member summary", tool_calls=[])

    provider.chat_with_retry = fake_chat_with_retry
    monkeypatch.setattr(
        web_client.app.state.web.config_runtime,
        "make_provider",
        lambda config: provider,
    )

    started = web_client.post(
        f"/api/v1/teams/{team_id}/runs",
        json={"content": "Draft a support-ready response."},
    )
    assert started.status_code == 200
    first_run_id = started.json()["data"]["run"]["runId"]

    deadline = time.time() + 3.0
    while time.time() < deadline:
        detail = web_client.get(f"/api/v1/runs/{first_run_id}")
        assert detail.status_code == 200
        if detail.json()["data"]["status"] == "succeeded":
            break
        time.sleep(0.05)

    retried = web_client.post(
        f"/api/v1/teams/{team_id}/runs/{first_run_id}/retry",
        json={"appendContext": "Use a warmer tone."},
    )
    assert retried.status_code == 200
    retry_run_id = retried.json()["data"]["run"]["runId"]

    deadline = time.time() + 3.0
    retry_run = retried.json()["data"]["run"]
    while time.time() < deadline:
        detail = web_client.get(f"/api/v1/runs/{retry_run_id}")
        assert detail.status_code == 200
        retry_run = detail.json()["data"]
        if retry_run["status"] == "succeeded":
            break
        time.sleep(0.05)

    assert retry_run["status"] == "succeeded"
    assert retry_run["resultSummary"]["content"] == "Leader summary with appended context"
    assert any("Additional Context" in message for message in seen_user_messages)
    assert any("Use a warmer tone." in message for message in seen_user_messages)


def test_web_api_team_thread_reuses_prior_turns(web_client: TestClient, monkeypatch) -> None:
    leader = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Thread Lead",
            "systemPrompt": "Leader system prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert leader.status_code == 201

    member = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Thread Member",
            "systemPrompt": "Member system prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
        },
    )
    assert member.status_code == 201

    team_created = web_client.post(
        "/api/v1/teams",
        json={
            "name": "Thread Team",
            "leaderAgentId": leader.json()["data"]["agentId"],
            "memberAgentIds": [member.json()["data"]["agentId"]],
            "workflowMode": "parallel_fanout",
        },
    )
    assert team_created.status_code == 201
    team_id = team_created.json()["data"]["teamId"]

    provider = web_client.app.state.web.agent.provider

    async def fake_chat_with_retry(*, messages, tools, model, **kwargs):
        _ = tools, model, kwargs
        system = messages[0]["content"]
        user = messages[1]["content"]
        if "Member system prompt" in system:
            if "Follow-up request" in user:
                assert "Previous Team Thread Turns" in user
                assert "First team summary" in user
                return LLMResponse(content="Follow-up member note", tool_calls=[])
            return LLMResponse(content="First member note", tool_calls=[])
        if "Leader system prompt" in system:
            if "Follow-up request" in user:
                assert "Previous Team Thread Turns" in user
                assert "First team summary" in user
                return LLMResponse(content="Follow-up team summary", tool_calls=[])
            return LLMResponse(content="First team summary", tool_calls=[])
        raise AssertionError(f"Unexpected prompt: {system}")

    provider.chat_with_retry = fake_chat_with_retry
    monkeypatch.setattr(
        web_client.app.state.web.config_runtime,
        "make_provider",
        lambda config: provider,
    )

    started = web_client.post(
        f"/api/v1/teams/{team_id}/runs",
        json={"content": "Initial request"},
    )
    assert started.status_code == 200
    first_run_id = started.json()["data"]["run"]["runId"]

    deadline = time.time() + 3.0
    while time.time() < deadline:
        detail = web_client.get(f"/api/v1/runs/{first_run_id}")
        assert detail.status_code == 200
        if detail.json()["data"]["status"] == "succeeded":
            break
        time.sleep(0.05)

    second = web_client.post(
        f"/api/v1/teams/{team_id}/runs",
        json={"content": "Follow-up request"},
    )
    assert second.status_code == 200
    second_run_id = second.json()["data"]["run"]["runId"]

    deadline = time.time() + 3.0
    final_run = second.json()["data"]["run"]
    while time.time() < deadline:
        detail = web_client.get(f"/api/v1/runs/{second_run_id}")
        assert detail.status_code == 200
        final_run = detail.json()["data"]
        if final_run["status"] == "succeeded":
            break
        time.sleep(0.05)

    assert final_run["status"] == "succeeded"
    assert final_run["resultSummary"]["content"] == "Follow-up team summary"

    thread = web_client.get(f"/api/v1/teams/{team_id}/thread")
    assert thread.status_code == 200
    assert thread.json()["data"]["threadId"] == f"team-thread:{team_id}"
    assert thread.json()["data"]["session"]["messageCount"] == 4

    thread_messages = web_client.get(f"/api/v1/teams/{team_id}/thread/messages")
    assert thread_messages.status_code == 200
    payload = thread_messages.json()["data"]
    assert payload["total"] == 4
    contents = [item["content"] for item in payload["messages"]]
    assert contents == [
        "Initial request",
        "First team summary",
        "Follow-up request",
        "Follow-up team summary",
    ]


def test_web_api_team_memory_scope_and_candidates(web_client: TestClient, monkeypatch) -> None:
    workspace = web_client.app.state.web.config.workspace_path
    memory_dir = workspace / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    (memory_dir / "MEMORY.md").write_text("# Workspace Shared Memory\n\nWORKSPACE SECRET\n", encoding="utf-8")

    leader = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Memory Lead",
            "systemPrompt": "Leader prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
            "memoryScope": "workspace_shared",
        },
    )
    assert leader.status_code == 201

    member = web_client.post(
        "/api/v1/agents",
        json={
            "name": "Memory Member",
            "systemPrompt": "Member prompt",
            "toolAllowlist": ["read_file"],
            "model": "openai/gpt-4o-mini",
            "memoryScope": "workspace_shared",
        },
    )
    assert member.status_code == 201

    team_created = web_client.post(
        "/api/v1/teams",
        json={
            "name": "Memory Team",
            "leaderAgentId": leader.json()["data"]["agentId"],
            "memberAgentIds": [member.json()["data"]["agentId"]],
            "workflowMode": "parallel_fanout",
            "memberAccessPolicy": {
                "teamSharedKnowledge": "explicit_only",
                "teamSharedMemory": "leader_write_member_read",
            },
        },
    )
    assert team_created.status_code == 201
    team_id = team_created.json()["data"]["teamId"]

    updated_memory = web_client.put(
        f"/api/v1/teams/{team_id}/memory",
        json={"content": "Team shared rule: start with triage and state the impact clearly."},
    )
    assert updated_memory.status_code == 200

    provider = web_client.app.state.web.agent.provider

    async def fake_chat_with_retry(*, messages, tools, model, **kwargs):
        _ = tools, kwargs
        assert model == "openai/gpt-4o-mini"
        system = messages[0]["content"]
        user = messages[1]["content"]
        if "Leader prompt" in system:
            assert "WORKSPACE SECRET" in system
            assert "Team shared rule: start with triage" in system
            assert "Member Contributions" in user
            return LLMResponse(content="Leader memory-aware summary", tool_calls=[])
        if "Member prompt" in system:
            assert "Team shared rule: start with triage" in system
            assert "WORKSPACE SECRET" not in system
            assert "Team Assignment" in user
            return LLMResponse(content="Member memory candidate", tool_calls=[])
        raise AssertionError(f"Unexpected prompt: {system}")

    provider.chat_with_retry = fake_chat_with_retry
    monkeypatch.setattr(
        web_client.app.state.web.config_runtime,
        "make_provider",
        lambda config: provider,
    )

    started = web_client.post(
        f"/api/v1/teams/{team_id}/runs",
        json={"content": "Handle a customer escalation update."},
    )
    assert started.status_code == 200
    root_run_id = started.json()["data"]["run"]["runId"]

    deadline = time.time() + 3.0
    final_run = started.json()["data"]["run"]
    while time.time() < deadline:
        detail = web_client.get(f"/api/v1/runs/{root_run_id}")
        assert detail.status_code == 200
        final_run = detail.json()["data"]
        if final_run["status"] == "succeeded":
            break
        time.sleep(0.05)

    assert final_run["status"] == "succeeded"
    assert any(event["eventType"] == "memory_candidate_proposed" for event in final_run["events"])

    candidates = web_client.get("/api/v1/memory-candidates", params={"teamId": team_id, "status": "proposed"})
    assert candidates.status_code == 200
    assert candidates.json()["data"]["total"] == 1
    candidate = candidates.json()["data"]["items"][0]
    assert candidate["agentId"] == member.json()["data"]["agentId"]
    assert candidate["status"] == "proposed"

    applied = web_client.post(f"/api/v1/memory-candidates/{candidate['candidateId']}/apply")
    assert applied.status_code == 200
    assert applied.json()["data"]["status"] == "applied"

    team_memory = web_client.get(f"/api/v1/teams/{team_id}/memory")
    assert team_memory.status_code == 200
    assert "Member memory candidate" in team_memory.json()["data"]["content"]

    search = web_client.post(
        "/api/v1/memory-search",
        json={"query": "WORKSPACE SECRET", "teamId": team_id, "limit": 5, "mode": "keyword"},
    )
    assert search.status_code == 200
    search_payload = search.json()["data"]
    assert search_payload["effectiveMode"] == "keyword"
    assert search_payload["total"] >= 1
    assert any(item["sourceType"] == "workspace_memory" for item in search_payload["items"])

    team_search = web_client.post(
        "/api/v1/memory-search",
        json={"query": "Member memory candidate", "teamId": team_id, "limit": 5, "mode": "hybrid"},
    )
    assert team_search.status_code == 200
    team_search_payload = team_search.json()["data"]
    assert team_search_payload["effectiveMode"] == "hybrid"
    assert any(item["sourceType"] == "team_memory" for item in team_search_payload["items"])

    thread_search = web_client.post(
        "/api/v1/memory-search",
        json={"query": "customer escalation update", "teamId": team_id, "limit": 10, "mode": "semantic"},
    )
    assert thread_search.status_code == 200
    thread_search_payload = thread_search.json()["data"]
    assert thread_search_payload["effectiveMode"] == "semantic"
    assert any(item["sourceType"] == "team_thread" for item in thread_search_payload["items"])

    artifact_search = web_client.post(
        "/api/v1/memory-search",
        json={"query": "Leader memory-aware summary", "teamId": team_id, "limit": 10, "mode": "hybrid"},
    )
    assert artifact_search.status_code == 200
    artifact_search_payload = artifact_search.json()["data"]
    artifact_hit = next(item for item in artifact_search_payload["items"] if item["sourceType"] == "run_artifact")
    assert artifact_hit["metadata"]["teamId"] == team_id
    assert "Leader memory-aware summary" in artifact_hit["content"]

    thread_source = web_client.post(
        "/api/v1/memory-get",
        json={"sourceType": "team_thread", "sourceId": f"team-thread:{team_id}", "teamId": team_id},
    )
    assert thread_source.status_code == 200
    thread_source_payload = thread_source.json()["data"]
    assert thread_source_payload["sourceType"] == "team_thread"
    assert "Handle a customer escalation update." in thread_source_payload["content"]

    artifact_source = web_client.post(
        "/api/v1/memory-get",
        json={"sourceType": "run_artifact", "sourceId": root_run_id, "teamId": team_id},
    )
    assert artifact_source.status_code == 200
    artifact_source_payload = artifact_source.json()["data"]
    assert artifact_source_payload["sourceType"] == "run_artifact"
    assert "Leader memory-aware summary" in artifact_source_payload["content"]

    memory_source = web_client.post(
        "/api/v1/memory-get",
        json={"sourceType": "memory_candidate", "sourceId": candidate["candidateId"], "teamId": team_id},
    )
    assert memory_source.status_code == 200
    memory_source_payload = memory_source.json()["data"]
    assert memory_source_payload["sourceType"] == "memory_candidate"
    assert memory_source_payload["sourceId"] == candidate["candidateId"]
    assert "Member memory candidate" in memory_source_payload["content"]


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


def test_web_api_valid_template_tools_include_runtime_message_and_spawn(web_client: TestClient) -> None:
    response = web_client.get("/api/v1/agent-templates/tools/valid")
    assert response.status_code == 200
    names = {item["name"] for item in response.json()["data"]}
    assert {"read_file", "message", "spawn", "cron"} <= names


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

    def fake_list_skills(query: str = "", limit: int = 24) -> list[dict[str, object]]:
        assert query == "protocol"
        assert limit == 5
        return [
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
        ]

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
    assert market_payload[0]["slug"] == "0.protocol"
    assert market_payload[0]["source"] == "skillhub"
    assert market_payload[0]["compatibility"] == "native"
    assert market_payload[0]["compatibilityReasons"]

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
