from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from nanobot.config import loader as config_loader
from nanobot.config.loader import save_config
from nanobot.config.schema import Config, MCPServerConfig
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

    exported = web_client.post("/api/v1/agent-templates/export", json={"names": ["ops-helper"]})
    assert exported.status_code == 200
    assert "ops-helper" in exported.json()["data"]["content"]


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
