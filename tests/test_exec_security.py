"""Tests for exec tool internal URL blocking."""

from __future__ import annotations

import socket
from unittest.mock import AsyncMock, patch

import pytest

from nanobot.agent.tools.shell import DockerShellSandboxExecutor, ExecTool, UnsupportedSandboxExecutor


def _fake_resolve_private(hostname, port, family=0, type_=0):
    return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("169.254.169.254", 0))]


def _fake_resolve_localhost(hostname, port, family=0, type_=0):
    return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 0))]


def _fake_resolve_public(hostname, port, family=0, type_=0):
    return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))]


@pytest.mark.asyncio
async def test_exec_blocks_curl_metadata():
    tool = ExecTool()
    with patch("nanobot.security.network.socket.getaddrinfo", _fake_resolve_private):
        result = await tool.execute(
            command='curl -s -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/'
        )
    assert "Error" in result
    assert "internal" in result.lower() or "private" in result.lower()


@pytest.mark.asyncio
async def test_exec_blocks_wget_localhost():
    tool = ExecTool()
    with patch("nanobot.security.network.socket.getaddrinfo", _fake_resolve_localhost):
        result = await tool.execute(command="wget http://localhost:8080/secret -O /tmp/out")
    assert "Error" in result


@pytest.mark.asyncio
async def test_exec_allows_normal_commands():
    tool = ExecTool(timeout=5)
    result = await tool.execute(command="echo hello")
    assert "hello" in result
    assert "Error" not in result.split("\n")[0]


@pytest.mark.asyncio
async def test_exec_allows_curl_to_public_url():
    """Commands with public URLs should not be blocked by the internal URL check."""
    tool = ExecTool()
    with patch("nanobot.security.network.socket.getaddrinfo", _fake_resolve_public):
        guard_result = tool._guard_command("curl https://example.com/api", "/tmp")
    assert guard_result is None


@pytest.mark.asyncio
async def test_exec_blocks_chained_internal_url():
    """Internal URLs buried in chained commands should still be caught."""
    tool = ExecTool()
    with patch("nanobot.security.network.socket.getaddrinfo", _fake_resolve_private):
        result = await tool.execute(
            command="echo start && curl http://169.254.169.254/latest/meta-data/ && echo done"
        )
    assert "Error" in result


@pytest.mark.asyncio
async def test_exec_uses_sandbox_executor_with_host_runtime_split():
    executor = type("Executor", (), {"run": AsyncMock(return_value="ok")})()
    tool = ExecTool(
        host_working_dir="/host/workspace",
        runtime_workdir="/runtime/workspace",
        sandbox_executor=executor,
        restrict_to_workspace=True,
    )

    result = await tool.execute(command="pwd", working_dir="/host/workspace/subdir")

    assert result == "ok"
    executor.run.assert_awaited_once_with(
        "pwd",
        tool=tool,
        host_cwd="/host/workspace/subdir",
        runtime_cwd="/runtime/workspace/subdir",
        timeout=60,
        path_append="",
    )


@pytest.mark.asyncio
async def test_unsupported_sandbox_executor_returns_reason():
    tool = ExecTool(sandbox_executor=UnsupportedSandboxExecutor(reason="Remote sandbox is not configured"))

    result = await tool.execute(command="echo hello")

    assert result == "Error: Remote sandbox is not configured"


@pytest.mark.asyncio
async def test_docker_sandbox_executor_builds_bind_mount_command():
    executor = DockerShellSandboxExecutor(
        image="python:3.12-slim",
        network_mode="none",
        host_workspace_path="/host/workspace",
        runtime_workdir="/runtime/workspace",
        env={"APP_ENV": "test"},
        mounts=(
            ("/host/cache", "/cache", True),
        ),
        env_allowlist=("APP_ENV", "BOT_MODE"),
    )
    tool = ExecTool(env={"BOT_MODE": "sandbox"})

    with patch(
        "nanobot.agent.tools.shell._run_shell_subprocess",
        new=AsyncMock(return_value="ok"),
    ) as run_shell:
        result = await executor.run(
            "ls -la",
            tool=tool,
            host_cwd="/host/workspace",
            runtime_cwd="/runtime/workspace/subdir",
            timeout=30,
            path_append="/opt/bin",
        )

    assert result == "ok"
    run_shell.assert_awaited_once()
    docker_command = run_shell.await_args.args[0]
    assert "docker" in docker_command
    assert "--network none" in docker_command
    assert "/host/workspace:/runtime/workspace" in docker_command
    assert "-w /runtime/workspace/subdir" in docker_command
    assert "python:3.12-slim" in docker_command
    assert "APP_ENV=test" in docker_command
    assert "BOT_MODE=sandbox" in docker_command
    assert "/host/cache:/cache:ro" in docker_command
