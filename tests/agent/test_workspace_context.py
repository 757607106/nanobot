"""Tests for WorkspaceContext and split memory/work roots."""

from pathlib import Path

from nanobot.harness.workspace import WorkspaceContext


class TestWorkspaceContext:
    def test_shared_creates_identical_roots(self, tmp_path: Path) -> None:
        ctx = WorkspaceContext.shared(tmp_path)
        assert ctx.memory_root == tmp_path
        assert ctx.work_root == tmp_path
        assert ctx.virtual_path is None

    def test_display_path_defaults_to_work_root(self, tmp_path: Path) -> None:
        ctx = WorkspaceContext(memory_root=tmp_path / "memory", work_root=tmp_path / "work")
        assert ctx.display_path == tmp_path / "work"

    def test_display_path_uses_virtual_when_set(self, tmp_path: Path) -> None:
        vp = tmp_path / "virtual"
        ctx = WorkspaceContext(
            memory_root=tmp_path / "memory",
            work_root=tmp_path / "work",
            virtual_path=vp,
        )
        assert ctx.display_path == vp

    def test_separate_memory_and_work_roots(self, tmp_path: Path) -> None:
        memory_root = tmp_path / "agent-root"
        work_root = tmp_path / "thread-root"
        ctx = WorkspaceContext(memory_root=memory_root, work_root=work_root)
        assert ctx.memory_root == memory_root
        assert ctx.work_root == work_root
        assert ctx.memory_root != ctx.work_root


class TestContextBuilderWithWorkspaceContext:
    def test_skills_loaded_from_memory_root(self, tmp_path: Path) -> None:
        from nanobot.agent.context import ContextBuilder

        memory_root = tmp_path / "agent-root"
        work_root = tmp_path / "thread-root"
        memory_root.mkdir()
        work_root.mkdir()

        ctx = WorkspaceContext(memory_root=memory_root, work_root=work_root)
        builder = ContextBuilder(memory_root, workspace_context=ctx)

        assert builder.skills.workspace == memory_root

    def test_bootstrap_files_from_memory_root(self, tmp_path: Path) -> None:
        from nanobot.agent.context import ContextBuilder

        memory_root = tmp_path / "agent-root"
        work_root = tmp_path / "thread-root"
        memory_root.mkdir()
        work_root.mkdir()
        (memory_root / "SOUL.md").write_text("I am the agent soul.", encoding="utf-8")

        ctx = WorkspaceContext(memory_root=memory_root, work_root=work_root)
        builder = ContextBuilder(memory_root, workspace_context=ctx)

        bootstrap = builder._load_bootstrap_files()
        assert "I am the agent soul." in bootstrap

    def test_memory_store_uses_memory_root(self, tmp_path: Path) -> None:
        from nanobot.agent.context import ContextBuilder

        memory_root = tmp_path / "agent-root"
        work_root = tmp_path / "thread-root"
        memory_root.mkdir()
        work_root.mkdir()

        ctx = WorkspaceContext(memory_root=memory_root, work_root=work_root)
        builder = ContextBuilder(memory_root, workspace_context=ctx)

        assert builder.memory.workspace == memory_root
        assert builder.memory.memory_file == memory_root / "MEMORY.md"
        assert builder.work_root == work_root

    def test_without_workspace_context_memory_and_work_root_match(self, tmp_path: Path) -> None:
        from nanobot.agent.context import ContextBuilder

        builder = ContextBuilder(tmp_path)
        assert builder.workspace == tmp_path
        assert builder.memory_workspace == tmp_path
        assert builder.work_root == tmp_path
