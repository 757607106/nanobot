from __future__ import annotations

import pytest

from nanobot.config.schema import Config
from nanobot.platform.agents import (
    AgentDefinition,
    AgentDefinitionConflictError,
    AgentDefinitionNotFoundError,
    AgentDefinitionService,
    AgentDefinitionStore,
    AgentDefinitionValidationError,
)
from nanobot.platform.agents.models import now_iso


def _config_with_agent_bindings() -> Config:
    return Config.model_validate(
        {
            "agents": {
                "defaults": {
                    "binding": "qwen3-5-plus",
                    "provider": "dashscope",
                    "model": "qwen3.5-plus",
                }
            },
            "modelBindings": {
                "qwen3-5-plus": {
                    "provider": "dashscope",
                    "label": "Qwen 3.5 Plus",
                    "model": "qwen3.5-plus",
                },
                "kimi-cn": {
                    "provider": "moonshot",
                    "label": "Kimi K2.5",
                    "model": "kimi-k2.5",
                },
            },
        }
    )


def test_agent_definition_service_crud_and_copy(tmp_path) -> None:
    service = AgentDefinitionService(
        AgentDefinitionStore(tmp_path / "agents.db"),
        instance_id="instance-test",
    )

    created = service.create_agent(
        {
            "name": "Research Agent",
            "description": "Collect source-backed findings",
            "systemPrompt": "Research the assigned topic carefully.",
            "binding": "deepseek-main",
            "provider": "deepseek",
            "toolAllowlist": ["read_file", "web_search"],
            "skillIds": ["skill-creator"],
            "tags": ["research"],
        },
        tenant_id="default",
        default_model="deepseek/deepseek-chat",
        default_tools=["read_file", "write_file", "web_search"],
        template_snapshot=None,
    )
    assert created["agentId"] == "research-agent"
    assert created["model"] == "deepseek/deepseek-chat"
    assert created["binding"] == "deepseek-main"
    assert created["provider"] == "deepseek"
    assert created["toolAllowlist"] == ["read_file", "web_search"]

    fetched = service.get_agent(created["agentId"])
    assert fetched["name"] == "Research Agent"

    updated = service.update_agent(
        created["agentId"],
        {
            "description": "Updated description",
            "binding": "kimi-cn",
            "provider": "moonshot",
            "enabled": False,
            "mcpServerIds": ["filesystem"],
        },
    )
    assert updated["enabled"] is False
    assert updated["binding"] == "kimi-cn"
    assert updated["provider"] == "moonshot"
    assert updated["mcpServerIds"] == ["filesystem"]

    copied = service.copy_agent(created["agentId"])
    assert copied["name"] == "Research Agent Copy"
    assert copied["agentId"] != created["agentId"]

    enabled = service.set_enabled(created["agentId"], True)
    assert enabled["enabled"] is True

    listed = service.list_agents(tenant_id="default")
    assert len(listed) == 2

    assert service.delete_agent(created["agentId"]) is True
    with pytest.raises(AgentDefinitionNotFoundError):
        service.get_agent(created["agentId"])


def test_agent_definition_service_uses_template_snapshot_and_detects_conflicts(tmp_path) -> None:
    service = AgentDefinitionService(
        AgentDefinitionStore(tmp_path / "agents.db"),
        instance_id="instance-test",
    )

    created = service.create_agent(
        {
            "name": "Coder Agent",
        },
        tenant_id="default",
        default_model="deepseek/deepseek-chat",
        default_tools=["read_file", "write_file", "edit_file"],
        template_snapshot={
            "name": "coder",
            "description": "Template description",
            "tools": ["read_file", "edit_file"],
            "rules": ["Read surrounding code first"],
            "system_prompt": "Implement the assigned change.",
            "skills": ["skill-creator"],
            "model": "claude-3-5-sonnet",
            "backend": "claude_code",
        },
    )
    assert created["sourceTemplateName"] == "coder"
    assert created["toolAllowlist"] == ["read_file", "edit_file"]
    assert created["rules"] == ["Read surrounding code first"]
    assert created["model"] == "claude-3-5-sonnet"

    with pytest.raises(AgentDefinitionConflictError):
        service.create_agent(
            {
                "name": "Coder Agent",
                "systemPrompt": "Another prompt",
            },
            tenant_id="default",
            default_model="deepseek/deepseek-chat",
            default_tools=["read_file"],
            template_snapshot=None,
        )


def test_agent_definition_service_canonicalizes_binding_first_selection(tmp_path) -> None:
    config = _config_with_agent_bindings()
    service = AgentDefinitionService(
        AgentDefinitionStore(tmp_path / "agents.db"),
        instance_id="instance-test",
        config_loader=lambda: config,
    )

    created = service.create_agent(
        {
            "name": "Support Agent",
            "systemPrompt": "Handle support issues.",
            "binding": "qwen3.5-plus",
            "provider": "dashscope",
            "toolAllowlist": ["read_file"],
        },
        tenant_id="default",
        default_model=None,
        default_tools=["read_file"],
        template_snapshot=None,
    )

    assert created["binding"] == "qwen3-5-plus"
    assert created["provider"] == "dashscope"
    assert created["model"] == "qwen3.5-plus"

    updated = service.update_agent(
        created["agentId"],
        {
            "binding": None,
            "provider": "moonshot",
            "model": "kimi-k2.5",
        },
    )
    assert updated["binding"] == "kimi-cn"
    assert updated["provider"] == "moonshot"
    assert updated["model"] == "kimi-k2.5"


def test_agent_definition_service_rejects_unrecoverable_binding(tmp_path) -> None:
    config = _config_with_agent_bindings()
    service = AgentDefinitionService(
        AgentDefinitionStore(tmp_path / "agents.db"),
        instance_id="instance-test",
        config_loader=lambda: config,
    )

    with pytest.raises(AgentDefinitionValidationError, match="unknown model binding"):
        service.create_agent(
            {
                "name": "Broken Agent",
                "systemPrompt": "Broken config.",
                "binding": "missing-binding",
                "model": "totally-unknown-model",
            },
            tenant_id="default",
            default_model=None,
            default_tools=["read_file"],
            template_snapshot=None,
        )


def test_agent_definition_service_repairs_legacy_stored_binding_on_read(tmp_path) -> None:
    config = _config_with_agent_bindings()
    store = AgentDefinitionStore(tmp_path / "agents.db")
    service = AgentDefinitionService(
        store,
        instance_id="instance-test",
        config_loader=lambda: config,
    )
    now = now_iso()
    store.create(
        AgentDefinition(
            agent_id="legacy-agent",
            tenant_id="default",
            instance_id="instance-test",
            name="Legacy Agent",
            system_prompt="Repair me.",
            model="qwen3.5-plus",
            binding="qwen3.5-plus",
            provider="dashscope",
            tool_allowlist=["read_file"],
            knowledge_binding_ids=[],
            tags=[],
            created_at=now,
            updated_at=now,
        )
    )

    fetched = service.get_agent("legacy-agent")
    assert fetched["binding"] == "qwen3-5-plus"
    persisted = store.get("legacy-agent")
    assert persisted is not None
    assert persisted.binding == "qwen3-5-plus"
