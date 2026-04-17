"""Tests for WorkspaceContext and multi-agent workspace isolation."""

from pathlib import Path

from nanobot.agent.memory import MemoryStore
from nanobot.harness.workspace import WorkspaceContext


class TestWorkspaceContext:
    """WorkspaceContext data class tests."""

    def test_shared_creates_identical_roots(self, tmp_path: Path) -> None:
        ctx = WorkspaceContext.shared(tmp_path)
        assert ctx.identity_root == tmp_path
        assert ctx.agent_root == tmp_path
        assert ctx.virtual_path is None

    def test_display_path_defaults_to_agent_root(self, tmp_path: Path) -> None:
        ctx = WorkspaceContext(identity_root=tmp_path / "id", agent_root=tmp_path / "agent")
        assert ctx.display_path == tmp_path / "agent"

    def test_display_path_uses_virtual_when_set(self, tmp_path: Path) -> None:
        vp = tmp_path / "virtual"
        ctx = WorkspaceContext(
            identity_root=tmp_path / "id",
            agent_root=tmp_path / "agent",
            virtual_path=vp,
        )
        assert ctx.display_path == vp

    def test_separate_identity_and_agent_roots(self, tmp_path: Path) -> None:
        identity = tmp_path / "global"
        agent = tmp_path / "isolated"
        ctx = WorkspaceContext(identity_root=identity, agent_root=agent)
        assert ctx.identity_root == identity
        assert ctx.agent_root == agent
        assert ctx.identity_root != ctx.agent_root


class TestContextBuilderWithWorkspaceContext:
    """ContextBuilder honors WorkspaceContext for path routing."""

    def test_skills_loaded_from_identity_root(self, tmp_path: Path) -> None:
        """SkillsLoader should use identity_root (shared skills), not agent_root."""
        from nanobot.agent.context import ContextBuilder

        identity = tmp_path / "global"
        agent = tmp_path / "isolated"
        identity.mkdir()
        agent.mkdir()

        ctx = WorkspaceContext(identity_root=identity, agent_root=agent)
        builder = ContextBuilder(identity, workspace_context=ctx)

        # SkillsLoader workspace should point to identity_root (shared skills)
        assert builder.skills.workspace == identity

    def test_bootstrap_files_from_identity_root(self, tmp_path: Path) -> None:
        """Bootstrap files (SOUL.md etc.) should load from identity_root."""
        from nanobot.agent.context import ContextBuilder

        identity = tmp_path / "global"
        agent = tmp_path / "isolated"
        identity.mkdir()
        agent.mkdir()
        (identity / "SOUL.md").write_text("I am the global soul.")

        ctx = WorkspaceContext(identity_root=identity, agent_root=agent)
        builder = ContextBuilder(identity, workspace_context=ctx)

        bootstrap = builder._load_bootstrap_files()
        assert "I am the global soul." in bootstrap

    def test_memory_stored_in_agent_root(self, tmp_path: Path) -> None:
        """MemoryStore should use agent_root for data files."""
        from nanobot.agent.context import ContextBuilder

        identity = tmp_path / "global"
        agent = tmp_path / "isolated"
        identity.mkdir()
        agent.mkdir()

        ctx = WorkspaceContext(identity_root=identity, agent_root=agent)
        builder = ContextBuilder(identity, workspace_context=ctx)

        assert builder.memory.workspace == agent
        assert builder.memory.memory_file.parent == agent / "memory"

    def test_identity_files_redirected_when_isolated(self, tmp_path: Path) -> None:
        """SOUL.md/USER.md lookups should use identity_root when isolated."""
        from nanobot.agent.context import ContextBuilder

        identity = tmp_path / "global"
        agent = tmp_path / "isolated"
        identity.mkdir()
        agent.mkdir()

        ctx = WorkspaceContext(identity_root=identity, agent_root=agent)
        builder = ContextBuilder(identity, workspace_context=ctx)

        assert builder.memory.soul_file == identity / "SOUL.md"
        assert builder.memory.user_file == identity / "USER.md"

    def test_backward_compat_without_workspace_context(self, tmp_path: Path) -> None:
        """Without workspace_context, behavior matches original."""
        from nanobot.agent.context import ContextBuilder

        builder = ContextBuilder(tmp_path)
        assert builder.workspace == tmp_path
        assert builder.memory_workspace == tmp_path
        assert builder.skills.workspace == tmp_path


class TestMemoryStoreIdentityRoot:
    """MemoryStore.set_identity_root tests."""

    def test_set_identity_root_redirects_paths(self, tmp_path: Path) -> None:
        agent_dir = tmp_path / "agent"
        agent_dir.mkdir()
        identity_dir = tmp_path / "identity"
        identity_dir.mkdir()

        store = MemoryStore(agent_dir)
        assert store.soul_file == agent_dir / "SOUL.md"

        store.set_identity_root(identity_dir)
        assert store.soul_file == identity_dir / "SOUL.md"
        assert store.user_file == identity_dir / "USER.md"

    def test_set_identity_root_same_dir_is_noop(self, tmp_path: Path) -> None:
        store = MemoryStore(tmp_path)
        store.set_identity_root(tmp_path)
        assert store.soul_file == tmp_path / "SOUL.md"
        assert store.user_file == tmp_path / "USER.md"
