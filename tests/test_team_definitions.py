from __future__ import annotations

import pytest

from nanobot.platform.agents import AgentDefinitionService, AgentDefinitionStore
from nanobot.platform.teams import (
    TeamDefinitionConflictError,
    TeamDefinitionNotFoundError,
    TeamDefinitionService,
    TeamDefinitionStore,
    TeamDefinitionValidationError,
)


def _create_agent(service: AgentDefinitionService, name: str) -> dict:
    return service.create_agent(
        {
            "name": name,
            "systemPrompt": f"You are {name}.",
        },
        tenant_id="default",
        default_model="deepseek/deepseek-chat",
        default_tools=["read_file", "write_file"],
        template_snapshot=None,
    )


def test_team_definition_service_crud_and_copy(tmp_path) -> None:
    agent_service = AgentDefinitionService(
        AgentDefinitionStore(tmp_path / "agents.db"),
        instance_id="instance-test",
    )
    leader = _create_agent(agent_service, "Lead Agent")
    researcher = _create_agent(agent_service, "Research Agent")
    reviewer = _create_agent(agent_service, "Review Agent")

    service = TeamDefinitionService(
        TeamDefinitionStore(tmp_path / "teams.db"),
        instance_id="instance-test",
        agent_lookup=agent_service.require_agent,
    )

    created = service.create_team(
        {
            "name": "Research Team",
            "description": "Handle research and review.",
            "supervisorAgentId": leader["agentId"],
            "memberAgentIds": [researcher["agentId"], reviewer["agentId"]],
            "sharedKnowledgeBindingIds": ["kb-shared"],
            "tags": ["research"],
        },
        tenant_id="default",
    )
    assert created["teamId"] == "research-team"
    assert created["memberCount"] == 3
    assert created["supervisorAgentId"] == leader["agentId"]

    fetched = service.get_team(created["teamId"])
    assert fetched["name"] == "Research Team"

    updated = service.update_team(
        created["teamId"],
        {
            "description": "Updated description",
            "enabled": False,
        },
    )
    assert updated["enabled"] is False

    copied = service.copy_team(created["teamId"])
    assert copied["name"] == "Research Team Copy"
    assert copied["teamId"] != created["teamId"]

    enabled = service.set_enabled(created["teamId"], True)
    assert enabled["enabled"] is True

    listed = service.list_teams(tenant_id="default")
    assert len(listed) == 2

    assert service.delete_team(created["teamId"]) is True
    with pytest.raises(TeamDefinitionNotFoundError):
        service.get_team(created["teamId"])


def test_team_definition_service_validates_agent_membership_and_conflicts(tmp_path) -> None:
    agent_service = AgentDefinitionService(
        AgentDefinitionStore(tmp_path / "agents.db"),
        instance_id="instance-test",
    )
    leader = _create_agent(agent_service, "Lead Agent")
    member = _create_agent(agent_service, "Member Agent")

    service = TeamDefinitionService(
        TeamDefinitionStore(tmp_path / "teams.db"),
        instance_id="instance-test",
        agent_lookup=agent_service.require_agent,
    )

    created = service.create_team(
        {
            "name": "Delivery Team",
            "supervisorAgentId": leader["agentId"],
            "memberAgentIds": [member["agentId"]],
        },
        tenant_id="default",
    )
    assert created["teamId"] == "delivery-team"

    with pytest.raises(TeamDefinitionConflictError):
        service.create_team(
            {
                "name": "Delivery Team",
                "supervisorAgentId": leader["agentId"],
            },
            tenant_id="default",
        )

    with pytest.raises(TeamDefinitionValidationError):
        service.create_team(
            {
                "name": "Invalid Team",
                "supervisorAgentId": "missing-agent",
            },
            tenant_id="default",
        )

    with pytest.raises(TeamDefinitionValidationError):
        service.create_team(
            {
                "name": "Self Referencing Team",
                "supervisorAgentId": leader["agentId"],
                "memberAgentIds": [leader["agentId"]],
            },
            tenant_id="default",
        )
