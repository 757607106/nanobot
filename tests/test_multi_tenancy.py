"""Integration tests for multi-tenancy isolation and full CRUD lifecycle."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from nanobot.platform.agents.models import AgentDefinition, now_iso
from nanobot.platform.agents.store import AgentDefinitionStore
from nanobot.platform.agents.service import AgentDefinitionService
from nanobot.platform.teams.models import TeamDefinition
from nanobot.platform.teams.store import TeamDefinitionStore
from nanobot.platform.teams.service import TeamDefinitionService
from nanobot.platform.channel_bindings.models import ChannelBinding
from nanobot.platform.channel_bindings.store import ChannelBindingStore
from nanobot.platform.channel_bindings.service import ChannelBindingService


@pytest.fixture
def tmp_db(tmp_path):
    return tmp_path


class TestAgentMultiTenancy:
    """Test that agent operations respect tenant isolation."""

    def test_get_with_tenant_id_isolates(self, tmp_db):
        store = AgentDefinitionStore(tmp_db / "agents.db")
        now = now_iso()
        a1 = AgentDefinition(
            agent_id="agent-1", tenant_id="tenant-a", instance_id="inst-1",
            name="Agent A1", enabled=True, source_template_name=None,
            system_prompt="hi", model="gpt-4", tool_allowlist=[], knowledge_binding_ids=[],
            tags=[], created_at=now, updated_at=now,
        )
        a2 = AgentDefinition(
            agent_id="agent-2", tenant_id="tenant-b", instance_id="inst-1",
            name="Agent B1", enabled=True, source_template_name=None,
            system_prompt="hi", model="gpt-4", tool_allowlist=[], knowledge_binding_ids=[],
            tags=[], created_at=now, updated_at=now,
        )
        store.create(a1)
        store.create(a2)

        # Without tenant_id - both visible
        assert store.get("agent-1") is not None
        assert store.get("agent-2") is not None

        # With tenant_id - only own tenant's agent visible
        assert store.get("agent-1", tenant_id="tenant-a") is not None
        assert store.get("agent-1", tenant_id="tenant-b") is None
        assert store.get("agent-2", tenant_id="tenant-b") is not None
        assert store.get("agent-2", tenant_id="tenant-a") is None

    def test_update_with_tenant_id_isolates(self, tmp_db):
        store = AgentDefinitionStore(tmp_db / "agents.db")
        now = now_iso()
        a1 = AgentDefinition(
            agent_id="agent-1", tenant_id="tenant-a", instance_id="inst-1",
            name="Agent A1", enabled=True, source_template_name=None,
            system_prompt="hi", model="gpt-4", tool_allowlist=[], knowledge_binding_ids=[],
            tags=[], created_at=now, updated_at=now,
        )
        store.create(a1)

        from dataclasses import replace
        updated = replace(a1, name="Updated Name", updated_at=now_iso())

        # Wrong tenant - no update
        result = store.update(updated, tenant_id="tenant-b")
        assert result is None

        # Correct tenant - update succeeds
        result = store.update(updated, tenant_id="tenant-a")
        assert result is not None
        assert result.name == "Updated Name"

    def test_delete_with_tenant_id_isolates(self, tmp_db):
        store = AgentDefinitionStore(tmp_db / "agents.db")
        now = now_iso()
        a1 = AgentDefinition(
            agent_id="agent-1", tenant_id="tenant-a", instance_id="inst-1",
            name="Agent A1", enabled=True, source_template_name=None,
            system_prompt="hi", model="gpt-4", tool_allowlist=[], knowledge_binding_ids=[],
            tags=[], created_at=now, updated_at=now,
        )
        store.create(a1)

        # Wrong tenant - no delete
        assert store.delete("agent-1", tenant_id="tenant-b") is False

        # Agent still exists
        assert store.get("agent-1") is not None

        # Correct tenant - delete succeeds
        assert store.delete("agent-1", tenant_id="tenant-a") is True
        assert store.get("agent-1") is None


class TestTeamMultiTenancy:
    """Test that team operations respect tenant isolation."""

    def test_get_with_tenant_id_isolates(self, tmp_db):
        store = TeamDefinitionStore(tmp_db / "teams.db")
        now = now_iso()
        t1 = TeamDefinition(
            team_id="team-1", tenant_id="tenant-a", instance_id="inst-1",
            name="Team A1", description="", supervisor_agent_id="agent-1",
            member_agent_ids=[], shared_knowledge_binding_ids=[],
            member_access_policy={}, tags=[], enabled=True,
            created_at=now, updated_at=now,
        )
        t2 = TeamDefinition(
            team_id="team-2", tenant_id="tenant-b", instance_id="inst-1",
            name="Team B1", description="", supervisor_agent_id="agent-2",
            member_agent_ids=[], shared_knowledge_binding_ids=[],
            member_access_policy={}, tags=[], enabled=True,
            created_at=now, updated_at=now,
        )
        store.create(t1)
        store.create(t2)

        assert store.get("team-1", tenant_id="tenant-a") is not None
        assert store.get("team-1", tenant_id="tenant-b") is None
        assert store.get("team-2", tenant_id="tenant-b") is not None
        assert store.get("team-2", tenant_id="tenant-a") is None

    def test_update_with_tenant_id_isolates(self, tmp_db):
        store = TeamDefinitionStore(tmp_db / "teams.db")
        now = now_iso()
        t1 = TeamDefinition(
            team_id="team-1", tenant_id="tenant-a", instance_id="inst-1",
            name="Team A1", description="", supervisor_agent_id="agent-1",
            member_agent_ids=[], shared_knowledge_binding_ids=[],
            member_access_policy={}, tags=[], enabled=True,
            created_at=now, updated_at=now,
        )
        store.create(t1)

        from dataclasses import replace
        updated = replace(t1, name="Updated Team", updated_at=now_iso())

        assert store.update(updated, tenant_id="tenant-b") is None
        result = store.update(updated, tenant_id="tenant-a")
        assert result is not None
        assert result.name == "Updated Team"

    def test_delete_with_tenant_id_isolates(self, tmp_db):
        store = TeamDefinitionStore(tmp_db / "teams.db")
        now = now_iso()
        t1 = TeamDefinition(
            team_id="team-1", tenant_id="tenant-a", instance_id="inst-1",
            name="Team A1", description="", supervisor_agent_id="agent-1",
            member_agent_ids=[], shared_knowledge_binding_ids=[],
            member_access_policy={}, tags=[], enabled=True,
            created_at=now, updated_at=now,
        )
        store.create(t1)
        assert store.delete("team-1", tenant_id="tenant-b") is False
        assert store.get("team-1") is not None
        assert store.delete("team-1", tenant_id="tenant-a") is True
        assert store.get("team-1") is None


class TestChannelBindingMultiTenancy:
    """Test that channel binding operations respect tenant isolation."""

    def test_get_with_tenant_id_isolates(self, tmp_db):
        store = ChannelBindingStore(tmp_db / "cb.db")
        now = now_iso()
        b1 = ChannelBinding(
            binding_id="cb-1", tenant_id="tenant-a", instance_id="inst-1",
            channel_name="telegram", channel_chat_id="*",
            target_type="agent", target_id="agent-1",
            priority=0, enabled=True, metadata={},
            created_at=now, updated_at=now,
        )
        store.create(b1)

        assert store.get("cb-1", tenant_id="tenant-a") is not None
        assert store.get("cb-1", tenant_id="tenant-b") is None

    def test_update_with_tenant_id_isolates(self, tmp_db):
        store = ChannelBindingStore(tmp_db / "cb.db")
        now = now_iso()
        b1 = ChannelBinding(
            binding_id="cb-1", tenant_id="tenant-a", instance_id="inst-1",
            channel_name="telegram", channel_chat_id="*",
            target_type="agent", target_id="agent-1",
            priority=0, enabled=True, metadata={},
            created_at=now, updated_at=now,
        )
        store.create(b1)

        from dataclasses import replace
        updated = replace(b1, target_id="agent-2", updated_at=now_iso())

        assert store.update(updated, tenant_id="tenant-b") is None
        result = store.update(updated, tenant_id="tenant-a")
        assert result is not None
        assert result.target_id == "agent-2"

    def test_delete_with_tenant_id_isolates(self, tmp_db):
        store = ChannelBindingStore(tmp_db / "cb.db")
        now = now_iso()
        b1 = ChannelBinding(
            binding_id="cb-1", tenant_id="tenant-a", instance_id="inst-1",
            channel_name="telegram", channel_chat_id="*",
            target_type="agent", target_id="agent-1",
            priority=0, enabled=True, metadata={},
            created_at=now, updated_at=now,
        )
        store.create(b1)
        assert store.delete("cb-1", tenant_id="tenant-b") is False
        assert store.get("cb-1") is not None
        assert store.delete("cb-1", tenant_id="tenant-a") is True
        assert store.get("cb-1") is None

    def test_resolve_binding_respects_tenant(self, tmp_db):
        store = ChannelBindingStore(tmp_db / "cb.db")
        now = now_iso()
        b1 = ChannelBinding(
            binding_id="cb-1", tenant_id="tenant-a", instance_id="inst-1",
            channel_name="telegram", channel_chat_id="*",
            target_type="agent", target_id="agent-a",
            priority=0, enabled=True, metadata={},
            created_at=now, updated_at=now,
        )
        store.create(b1)

        # Resolve for correct tenant
        result = store.resolve(
            channel_name="telegram", channel_chat_id="123",
            tenant_id="tenant-a", instance_id="inst-1",
        )
        assert result is not None
        assert result.target_id == "agent-a"

        # Resolve for wrong tenant
        result = store.resolve(
            channel_name="telegram", channel_chat_id="123",
            tenant_id="tenant-b", instance_id="inst-1",
        )
        assert result is None


class TestServiceTenantPassthrough:
    """Test that service layer passes tenant_id to store correctly."""

    def test_agent_service_get_with_tenant(self, tmp_db):
        store = AgentDefinitionStore(tmp_db / "agents.db")
        service = AgentDefinitionService(store, instance_id="inst-1")
        now = now_iso()
        a1 = AgentDefinition(
            agent_id="agent-1", tenant_id="tenant-a", instance_id="inst-1",
            name="Agent A1", enabled=True, source_template_name=None,
            system_prompt="hi", model="gpt-4", tool_allowlist=[], knowledge_binding_ids=[],
            tags=[], created_at=now, updated_at=now,
        )
        store.create(a1)

        # With correct tenant
        data = service.get_agent("agent-1", tenant_id="tenant-a")
        assert data["name"] == "Agent A1"

        # With wrong tenant
        from nanobot.platform.agents import AgentDefinitionNotFoundError
        with pytest.raises(AgentDefinitionNotFoundError):
            service.get_agent("agent-1", tenant_id="tenant-b")

    def test_team_service_get_with_tenant(self, tmp_db):
        store = TeamDefinitionStore(tmp_db / "teams.db")
        service = TeamDefinitionService(store, instance_id="inst-1")
        now = now_iso()
        t1 = TeamDefinition(
            team_id="team-1", tenant_id="tenant-a", instance_id="inst-1",
            name="Team A1", description="", supervisor_agent_id="agent-1",
            member_agent_ids=[], shared_knowledge_binding_ids=[],
            member_access_policy={}, tags=[], enabled=True,
            created_at=now, updated_at=now,
        )
        store.create(t1)

        data = service.get_team("team-1", tenant_id="tenant-a")
        assert data["name"] == "Team A1"

        from nanobot.platform.teams import TeamDefinitionNotFoundError
        with pytest.raises(TeamDefinitionNotFoundError):
            service.get_team("team-1", tenant_id="tenant-b")

    def test_channel_binding_service_get_with_tenant(self, tmp_db):
        store = ChannelBindingStore(tmp_db / "cb.db")
        service = ChannelBindingService(store, instance_id="inst-1")
        now = now_iso()
        b1 = ChannelBinding(
            binding_id="cb-1", tenant_id="tenant-a", instance_id="inst-1",
            channel_name="telegram", channel_chat_id="*",
            target_type="agent", target_id="agent-1",
            priority=0, enabled=True, metadata={},
            created_at=now, updated_at=now,
        )
        store.create(b1)

        data = service.get_binding("cb-1", tenant_id="tenant-a")
        assert data["bindingId"] == "cb-1"

        from nanobot.platform.channel_bindings import ChannelBindingNotFoundError
        with pytest.raises(ChannelBindingNotFoundError):
            service.get_binding("cb-1", tenant_id="tenant-b")
