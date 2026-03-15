from __future__ import annotations

import pytest

from nanobot.platform.agents import (
    AgentDefinitionConflictError,
    AgentDefinitionNotFoundError,
    AgentDefinitionService,
    AgentDefinitionStore,
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
    assert created["toolAllowlist"] == ["read_file", "web_search"]

    fetched = service.get_agent(created["agentId"])
    assert fetched["name"] == "Research Agent"

    updated = service.update_agent(
        created["agentId"],
        {
            "description": "Updated description",
            "enabled": False,
            "mcpServerIds": ["filesystem"],
        },
    )
    assert updated["enabled"] is False
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
