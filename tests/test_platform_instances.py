from pathlib import Path

from nanobot.config.loader import save_config
from nanobot.config.schema import Config
from nanobot.platform.instances import PlatformInstanceService


def test_platform_instance_scopes_runtime_paths_to_config_directory(tmp_path: Path) -> None:
    config_path = tmp_path / "tenant-a" / "config.json"
    config = Config()
    config.agents.defaults.workspace = str(tmp_path / "tenant-a-workspace")
    save_config(config, config_path)

    instance = PlatformInstanceService().get_default_instance(config_path)

    assert instance.id == "tenant-a"
    assert instance.config_path == config_path.resolve()
    assert instance.data_dir == config_path.parent.resolve()
    assert instance.logs_dir() == config_path.parent.resolve() / "logs"
    assert instance.cron_dir() == config_path.parent.resolve() / "cron"
    assert instance.agent_definitions_db_path() == config_path.parent.resolve() / "web-agents.db"
    assert instance.team_definitions_db_path() == config_path.parent.resolve() / "web-teams.db"
    assert instance.agent_runs_db_path() == config_path.parent.resolve() / "web-agent-runs.db"
    assert instance.knowledge_db_path() == config_path.parent.resolve() / "web-knowledge.db"
    assert instance.agent_artifacts_dir() == config_path.parent.resolve() / "agent-artifacts"
    assert instance.agent_run_exports_dir() == config_path.parent.resolve() / "agent-run-exports"
    assert instance.mcp_installs_dir() == config_path.parent.resolve() / "mcp-installs"
    assert instance.bridge_install_dir() == config_path.parent.resolve() / "bridge"
    assert instance.workspace_path() == (tmp_path / "tenant-a-workspace")


def test_platform_instance_uses_default_identity_for_default_config() -> None:
    instance = PlatformInstanceService().get_default_instance(Path.home() / ".nanobot" / "config.json")
    assert instance.id == "default"
    assert instance.label == "默认实例"
