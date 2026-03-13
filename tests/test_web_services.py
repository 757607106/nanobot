from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest

from nanobot.config import loader as config_loader
from nanobot.config.loader import save_config
from nanobot.config.schema import Config, MCPServerConfig
from nanobot.web.api import WebAppState
from nanobot.web.auth import WebAuthManager
from nanobot.web.channel_testing import WebChannelTestService
from nanobot.web.mcp_registry import WebMCPRegistryManager
from nanobot.web.mcp_repository import MCPRepositoryService
from nanobot.web.mcp_servers import MCPServerService
from nanobot.web.operations import WebOperationsService
from nanobot.web.setup import WebSetupManager


def _make_service_config(tmp_path, monkeypatch) -> tuple[Config, Path]:
  config_path = tmp_path / "config.json"
  workspace = tmp_path / "workspace"
  config = Config()
  config.agents.defaults.workspace = str(workspace)
  save_config(config, config_path)
  monkeypatch.setattr(config_loader, "_current_config_path", config_path)
  return config, config_path


def _write_fixture_mcp_repo(repo_dir: Path, *, package_name: str = "@acme/filesystem-mcp") -> None:
  (repo_dir / "bin").mkdir(parents=True, exist_ok=True)
  (repo_dir / "bin" / "server.js").write_text(
    "#!/usr/bin/env node\nconsole.log('fixture mcp')\n",
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
    ) + "\n",
    encoding="utf-8",
  )
  (repo_dir / "package-lock.json").write_text(
    json.dumps({"name": package_name, "lockfileVersion": 3}, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
  )
  (repo_dir / ".env.example").write_text("MCP_API_KEY=\n", encoding="utf-8")


def test_web_auth_manager_persists_profile_and_invalidates_old_session(tmp_path, monkeypatch) -> None:
  _config, config_path = _make_service_config(tmp_path, monkeypatch)
  auth = WebAuthManager(config_path)

  initial_token = auth.bootstrap("owner", "bootstrap-pass-123")
  assert auth.get_authenticated_user(initial_token) == "owner"

  profile, next_token = auth.update_profile(
    username="console-owner",
    display_name="Console Owner",
    email="owner@example.com",
  )
  assert profile["username"] == "console-owner"
  assert profile["displayName"] == "Console Owner"
  assert profile["email"] == "owner@example.com"
  assert next_token
  assert auth.get_authenticated_user(initial_token) is None
  assert auth.get_authenticated_user(next_token) == "console-owner"

  restarted = WebAuthManager(config_path)
  assert restarted.get_profile()["displayName"] == "Console Owner"
  login_token = restarted.login("console-owner", "bootstrap-pass-123")
  assert restarted.get_authenticated_user(login_token) == "console-owner"


def test_web_setup_manager_tracks_progress_without_route_wrapper(tmp_path, monkeypatch) -> None:
  config, config_path = _make_service_config(tmp_path, monkeypatch)
  setup = WebSetupManager(config_path)

  initial = setup.get_status(config)
  assert initial["currentStep"] == "provider"
  assert initial["completed"] is False

  config.agents.defaults.provider = "deepseek"
  config.agents.defaults.model = "deepseek/deepseek-chat"
  config.providers.deepseek.api_key = "sk-setup-test"
  after_provider = setup.mark_provider_configured(config)
  assert after_provider["currentStep"] == "channel"

  after_channel = setup.mark_channel_skipped(config)
  assert after_channel["currentStep"] == "agent"
  assert after_channel["steps"][1]["skipped"] is True

  config.agents.defaults.max_tokens = 8192
  after_agent = setup.mark_agent_configured(config)
  assert after_agent["completed"] is True
  assert WebSetupManager(config_path).get_status(config)["completed"] is True


def test_web_mcp_repository_service_analyzes_and_installs_local_fixture(tmp_path, monkeypatch) -> None:
  config, config_path = _make_service_config(tmp_path, monkeypatch)
  registry = WebMCPRegistryManager(config_path)
  service = MCPRepositoryService(config_path, registry)
  fixture_repo = tmp_path / "fixture-repo"
  _write_fixture_mcp_repo(fixture_repo)

  monkeypatch.setattr(
    service,
    "_clone_repository",
    lambda _clone_url, target_dir: shutil.copytree(fixture_repo, target_dir),
  )
  monkeypatch.setattr(service, "_run_install_step", lambda _command, cwd, timeout: None)

  analysis = service.analyze_repository("https://github.com/acme/filesystem-mcp")
  assert analysis["serverName"] == "filesystem-mcp"
  assert analysis["requiredEnv"] == ["MCP_API_KEY"]
  assert analysis["canInstall"] is True

  config_payload = config.model_dump(mode="json", by_alias=True)
  result = service.install_repository(
    "https://github.com/acme/filesystem-mcp",
    current_config=config_payload,
    update_config=lambda payload: payload,
  )
  assert result["serverName"] == "filesystem-mcp"
  assert result["installDir"]
  assert Path(result["installDir"]).exists()
  assert result["entry"]["repoUrl"] == "https://github.com/acme/filesystem-mcp"


def test_web_mcp_server_service_handles_blocked_probe_and_enable_toggle(tmp_path, monkeypatch) -> None:
  config, config_path = _make_service_config(tmp_path, monkeypatch)
  config.tools.mcp_servers["fixture-mcp"] = MCPServerConfig(
    enabled=False,
    command="node",
    args=["server.js"],
    env={},
  )
  save_config(config, config_path)

  registry = WebMCPRegistryManager(config_path)
  registry.upsert_repository_install(
    server_name="fixture-mcp",
    display_name="Fixture MCP",
    repo_url="https://github.com/acme/fixture-mcp",
    clone_url="https://github.com/acme/fixture-mcp.git",
    install_dir=None,
    install_mode="source",
    install_steps=["npm ci"],
    required_env=["FIXTURE_TOKEN"],
    optional_env=[],
  )
  service = MCPServerService(config_path, registry)

  blocked = service.probe_server(config, "fixture-mcp")
  assert blocked["status"] == "blocked"
  assert blocked["missingEnv"] == ["FIXTURE_TOKEN"]

  config_payload = config.model_dump(mode="json", by_alias=True)
  toggled = service.set_enabled(
    "fixture-mcp",
    enabled=True,
    current_config=config_payload,
    update_config=lambda payload: payload,
  )
  assert toggled["enabled"] is True
  assert toggled["entry"]["enabled"] is True


def test_web_operations_service_reports_validation_failures_directly(tmp_path, monkeypatch) -> None:
  config, config_path = _make_service_config(tmp_path, monkeypatch)
  setup = WebSetupManager(config_path)
  registry = WebMCPRegistryManager(config_path)
  operations = WebOperationsService(setup, registry)

  validation = operations.run_validation(config=config)
  assert validation["summary"]["status"] == "blocked"
  assert validation["summary"]["failures"] >= 1
  assert any(item["category"] == "provider" and item["status"] == "fail" for item in validation["checks"])


def test_web_channel_test_service_probes_telegram_without_http_route(tmp_path, monkeypatch) -> None:
  config, _config_path = _make_service_config(tmp_path, monkeypatch)
  config.channels.telegram.enabled = True
  config.channels.telegram.token = "tg-token"

  class FakeResponse:
    is_success = True
    status_code = 200
    content = b'{"ok": true}'

    @staticmethod
    def json():
      return {
        "ok": True,
        "result": {
          "username": "nanobot_test_bot",
        },
      }

  class FakeAsyncClient:
    def __init__(self, *args, **kwargs):
      _ = args, kwargs

    async def __aenter__(self):
      return self

    async def __aexit__(self, exc_type, exc, tb):
      _ = exc_type, exc, tb
      return False

    async def get(self, url: str):
      assert url.endswith("/getMe")
      return FakeResponse()

  monkeypatch.setattr("nanobot.web.channel_testing.httpx.AsyncClient", FakeAsyncClient)

  service = WebChannelTestService()
  result = asyncio.run(service.probe_channel(config=config, channel_name="telegram"))
  assert result["status"] == "passed"
  assert "nanobot_test_bot" in result["summary"]


def test_web_channel_test_service_probes_qq_without_http_route(tmp_path, monkeypatch) -> None:
  config, _config_path = _make_service_config(tmp_path, monkeypatch)
  config.channels.qq.enabled = True
  config.channels.qq.app_id = "app-123"
  config.channels.qq.secret = "qq-secret"

  class FakeResponse:
    is_success = True
    status_code = 200
    content = b'{"access_token": "token", "expires_in": 7200}'

    @staticmethod
    def json():
      return {
        "access_token": "token",
        "expires_in": 7200,
      }

  class FakeAsyncClient:
    def __init__(self, *args, **kwargs):
      _ = args, kwargs

    async def __aenter__(self):
      return self

    async def __aexit__(self, exc_type, exc, tb):
      _ = exc_type, exc, tb
      return False

    async def post(self, url: str, json: dict[str, str]):
      assert url == "https://bots.qq.com/app/getAppAccessToken"
      assert json == {
        "appId": "app-123",
        "clientSecret": "qq-secret",
      }
      return FakeResponse()

  monkeypatch.setattr(
    "nanobot.web.channel_testing.importlib.util.find_spec",
    lambda name: object() if name == "botpy" else None,
  )
  monkeypatch.setattr("nanobot.web.channel_testing.httpx.AsyncClient", FakeAsyncClient)

  service = WebChannelTestService()
  result = asyncio.run(service.probe_channel(config=config, channel_name="qq"))
  assert result["status"] == "passed"
  assert result["checks"][0]["status"] == "pass"
  assert "access token" in result["detail"].lower()


def test_web_channel_test_service_reports_wecom_preflight_without_http_route(tmp_path, monkeypatch) -> None:
  config, _config_path = _make_service_config(tmp_path, monkeypatch)
  config.channels.wecom.enabled = True
  config.channels.wecom.bot_id = "bot-123"
  config.channels.wecom.secret = "wecom-secret"

  monkeypatch.setattr(
    "nanobot.web.channel_testing.importlib.util.find_spec",
    lambda name: object() if name == "wecom_aibot_sdk" else None,
  )

  service = WebChannelTestService()
  result = asyncio.run(service.probe_channel(config=config, channel_name="wecom"))
  assert result["status"] == "warning"
  assert result["checks"][0]["status"] == "pass"
  assert result["checks"][1]["status"] == "pass"
  assert "最小启动条件" in result["summary"]


def test_web_app_state_document_center_updates_and_resets_without_http(tmp_path, monkeypatch) -> None:
  config, _config_path = _make_service_config(tmp_path, monkeypatch)
  state = WebAppState(config)
  try:
    before = state.get_document("AGENTS.md")
    assert before["sourcePath"].endswith("AGENTS.md")

    updated = state.update_document("AGENTS.md", "# Workspace Agent\n\nDirect service test.\n")
    assert updated["content"].startswith("# Workspace Agent")

    reset = state.reset_document("AGENTS.md")
    assert reset["content"] != "# Workspace Agent\n\nDirect service test.\n"
  finally:
    asyncio.run(state.shutdown_async())
