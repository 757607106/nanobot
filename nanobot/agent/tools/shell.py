"""Shell execution tool."""

import asyncio
import os
import re
import shlex
import sys
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from loguru import logger

from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.schema import IntegerSchema, StringSchema, tool_parameters_schema
from nanobot.config.paths import get_media_dir

_IS_WINDOWS = sys.platform == "win32"



async def _run_shell_subprocess(
    command: str,
    *,
    cwd: str,
    timeout: int,
    env: dict[str, str],
) -> str:
    process = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
        env=env,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        process.kill()
        try:
            await asyncio.wait_for(process.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            pass
        finally:
            if sys.platform != "win32":
                try:
                    os.waitpid(process.pid, os.WNOHANG)
                except (ProcessLookupError, ChildProcessError) as e:
                    logger.debug("Process already reaped or not found: {}", e)
        return f"Error: Command timed out after {timeout} seconds"

    output_parts = []

    if stdout:
        output_parts.append(stdout.decode("utf-8", errors="replace"))

    if stderr:
        stderr_text = stderr.decode("utf-8", errors="replace")
        if stderr_text.strip():
            output_parts.append(f"STDERR:\n{stderr_text}")

    output_parts.append(f"\nExit code: {process.returncode}")

    result = "\n".join(output_parts) if output_parts else "(no output)"
    max_len = ExecTool._MAX_OUTPUT
    if len(result) > max_len:
        half = max_len // 2
        result = (
            result[:half]
            + f"\n\n... ({len(result) - max_len:,} chars truncated) ...\n\n"
            + result[-half:]
        )
    return result


@dataclass(slots=True)
class LocalShellSandboxExecutor:
    """Default shell executor that preserves today's local subprocess behavior."""

    async def run(
        self,
        command: str,
        *,
        tool: Any,
        host_cwd: str,
        runtime_cwd: str,
        timeout: int,
        path_append: str,
    ) -> str:
        _ = runtime_cwd
        env = tool._build_env(path_append=path_append, include_host_env=False)
        return await _run_shell_subprocess(command, cwd=host_cwd, timeout=timeout, env=env)


@dataclass(slots=True)
class DockerShellSandboxExecutor:
    """Bind-mount Docker executor with explicit host/runtime workspace split."""

    image: str
    network_mode: str
    host_workspace_path: str
    runtime_workdir: str
    env: dict[str, str] = field(default_factory=dict)
    mounts: tuple[tuple[str, str, bool], ...] = ()
    env_allowlist: tuple[str, ...] = ()
    docker_binary: str = "docker"

    async def run(
        self,
        command: str,
        *,
        tool: Any,
        host_cwd: str,
        runtime_cwd: str,
        timeout: int,
        path_append: str,
    ) -> str:
        if not self.host_workspace_path:
            return "Error: Docker sandbox is missing a host workspace path"
        runtime_command = command
        if path_append:
            runtime_command = f"export PATH=\"$PATH:{path_append}\" && {runtime_command}"
        allowed_env_keys = {str(key).strip() for key in self.env_allowlist if str(key).strip()}
        container_env = {
            key: value
            for key, value in {**tool.env, **self.env}.items()
            if str(key or "").strip() and (not allowed_env_keys or key in allowed_env_keys)
        }
        env_parts = [
            f"-e {shlex.quote(f'{key}={value}')}"
            for key, value in sorted(container_env.items())
        ]
        mount_specs = [
            f"{source}:{target}:{'ro' if read_only else 'rw'}"
            for source, target, read_only in (self.mounts or ())
            if source and target
        ]
        mount_parts = [
            f"-v {shlex.quote(spec)}"
            for spec in mount_specs
        ]
        docker_command = " ".join(
            part
            for part in [
                shlex.quote(self.docker_binary),
                "run --rm",
                f"--network {shlex.quote(self.network_mode or 'bridge')}",
                f"-v {shlex.quote(f'{self.host_workspace_path}:{self.runtime_workdir}')}",
                *mount_parts,
                f"-w {shlex.quote(runtime_cwd or self.runtime_workdir)}",
                " ".join(env_parts).strip(),
                shlex.quote(self.image or "python:3.12-slim"),
                "sh -lc",
                shlex.quote(runtime_command),
            ]
            if part
        )
        env = {"PATH": os.environ.get("PATH", "")}
        return await _run_shell_subprocess(docker_command, cwd=host_cwd, timeout=timeout, env=env)


@dataclass(slots=True)
class UnsupportedSandboxExecutor:
    """Executor stub for declared-but-not-configured sandbox backends."""

    reason: str

    async def run(
        self,
        command: str,
        *,
        tool: Any,
        host_cwd: str,
        runtime_cwd: str,
        timeout: int,
        path_append: str,
    ) -> str:
        _ = (command, tool, host_cwd, runtime_cwd, timeout, path_append)
        return f"Error: {self.reason}"



@tool_parameters(
    tool_parameters_schema(
        command=StringSchema("The shell command to execute"),
        working_dir=StringSchema("Optional working directory for the command"),
        timeout=IntegerSchema(
            60,
            description=(
                "Timeout in seconds. Increase for long-running commands "
                "like compilation or installation (default 60, max 600)."
            ),
            minimum=1,
            maximum=600,
        ),
        required=["command"],
    )
)
class ExecTool(Tool):
    """Tool to execute shell commands."""

    def __init__(
        self,
        timeout: int = 60,
        working_dir: str | None = None,
        deny_patterns: list[str] | None = None,
        allow_patterns: list[str] | None = None,
        restrict_to_workspace: bool = False,
        path_append: str = "",
        host_working_dir: str | None = None,
        runtime_workdir: str | None = None,
        sandbox_executor: Any | None = None,
        env: dict[str, str] | None = None,
        allowed_env_keys: list[str] | None = None,
    ):
        self.timeout = timeout
        self.working_dir = working_dir
        self.host_working_dir = host_working_dir or working_dir
        self.runtime_workdir = runtime_workdir or self.host_working_dir or working_dir
        self.sandbox_executor = sandbox_executor or LocalShellSandboxExecutor()
        self.deny_patterns = deny_patterns or [
            r"\brm\s+-[rf]{1,2}\b",          # rm -r, rm -rf, rm -fr
            r"\bdel\s+/[fq]\b",              # del /f, del /q
            r"\brmdir\s+/s\b",               # rmdir /s
            r"(?:^|[;&|]\s*)format\b",       # format (as standalone command only)
            r"\b(mkfs|diskpart)\b",          # disk operations
            r"\bdd\s+if=",                   # dd
            r">\s*/dev/sd",                  # write to disk
            r"\b(shutdown|reboot|poweroff)\b",  # system power
            r":\(\)\s*\{.*\};\s*:",          # fork bomb
            # Block writes to nanobot internal state files (#2989).
            # history.jsonl / .dream_cursor are managed by append_history();
            # direct writes corrupt the cursor format and crash /dream.
            r">>?\s*\S*(?:history\.jsonl|\.dream_cursor)",            # > / >> redirect
            r"\btee\b[^|;&<>]*(?:history\.jsonl|\.dream_cursor)",     # tee / tee -a
            r"\b(?:cp|mv)\b(?:\s+[^\s|;&<>]+)+\s+\S*(?:history\.jsonl|\.dream_cursor)",  # cp/mv target
            r"\bdd\b[^|;&<>]*\bof=\S*(?:history\.jsonl|\.dream_cursor)",  # dd of=
            r"\bsed\s+-i[^|;&<>]*(?:history\.jsonl|\.dream_cursor)",  # sed -i
        ]
        self.allow_patterns = allow_patterns or []
        self.restrict_to_workspace = restrict_to_workspace
        self.path_append = path_append
        self.env = dict(env or {})
        self.allowed_env_keys = allowed_env_keys or []

    @property
    def name(self) -> str:
        return "exec"

    _MAX_TIMEOUT = 600
    _MAX_OUTPUT = 10_000

    @property
    def description(self) -> str:
        return (
            "Execute a shell command and return its output. "
            "Prefer read_file/write_file/edit_file over cat/echo/sed, "
            "and grep/glob over shell find/grep. "
            "Use -y or --yes flags to avoid interactive prompts. "
            "Output is truncated at 10 000 chars; timeout defaults to 60s."
        )

    @property
    def exclusive(self) -> bool:
        return True

    async def execute(
        self, command: str, working_dir: str | None = None,
        timeout: int | None = None, **kwargs: Any,
    ) -> str:
        host_cwd, runtime_cwd = self._resolve_cwds(working_dir)

        # Prevent an LLM-supplied working_dir from escaping the configured
        # workspace when restrict_to_workspace is enabled (#2826).
        if self.restrict_to_workspace and self.working_dir:
            try:
                requested = Path(str(host_cwd)).expanduser().resolve()
                workspace_root = Path(self.working_dir).expanduser().resolve()
            except Exception:
                return "Error: working_dir could not be resolved"
            if requested != workspace_root and workspace_root not in requested.parents:
                return "Error: working_dir is outside the configured workspace"

        guard_error = self._guard_command(command, str(host_cwd))
        if guard_error:
            return guard_error



        effective_timeout = min(timeout or self.timeout, self._MAX_TIMEOUT)

        try:
            return await self.sandbox_executor.run(
                command,
                tool=self,
                host_cwd=str(host_cwd),
                runtime_cwd=runtime_cwd,
                timeout=effective_timeout,
                path_append=self.path_append,
            )

        except Exception as e:
            return f"Error executing command: {str(e)}"

    def _build_env(self, *, path_append: str, include_host_env: bool) -> dict[str, str]:
        env = os.environ.copy() if include_host_env else {"PATH": os.environ.get("PATH", "")}
        env.update({key: value for key, value in self.env.items() if str(key or "").strip()})
        # Pass through explicitly allowed env vars
        for key in self.allowed_env_keys:
            val = os.environ.get(key)
            if val is not None:
                env[key] = val
        if path_append:
            env["PATH"] = env.get("PATH", "") + os.pathsep + path_append
        return env

    def _resolve_cwds(self, requested_working_dir: str | None) -> tuple[Path, str]:
        host_base = Path(self.host_working_dir or self.working_dir or os.getcwd()).expanduser()
        if requested_working_dir:
            requested = Path(requested_working_dir).expanduser()
            host_cwd = requested if requested.is_absolute() else host_base / requested
        else:
            host_cwd = host_base
        runtime_base = str(self.runtime_workdir or self.host_working_dir or self.working_dir or host_cwd)
        runtime_cwd = runtime_base
        try:
            relative = host_cwd.resolve().relative_to(host_base.resolve())
            runtime_cwd = str(PurePosixPath(runtime_base) / relative.as_posix()) if str(relative) != "." else runtime_base
        except Exception:
            if requested_working_dir:
                runtime_cwd = str(requested_working_dir)
        return host_cwd, runtime_cwd

    def _guard_command(self, command: str, cwd: str) -> str | None:
        """Best-effort safety guard for potentially destructive commands."""
        cmd = command.strip()
        lower = cmd.lower()

        for pattern in self.deny_patterns:
            if re.search(pattern, lower):
                return "Error: Command blocked by safety guard (dangerous pattern detected)"

        if self.allow_patterns:
            if not any(re.search(p, lower) for p in self.allow_patterns):
                return "Error: Command blocked by safety guard (not in allowlist)"

        from nanobot.security.network import contains_internal_url
        if contains_internal_url(cmd):
            return "Error: Command blocked by safety guard (internal/private URL detected)"

        if self.restrict_to_workspace:
            if "..\\" in cmd or "../" in cmd:
                return "Error: Command blocked by safety guard (path traversal detected)"

            cwd_path = Path(cwd).resolve()

            for raw in self._extract_absolute_paths(cmd):
                try:
                    expanded = os.path.expandvars(raw.strip())
                    p = Path(expanded).expanduser().resolve()
                except Exception:
                    continue

                media_path = get_media_dir().resolve()
                if (p.is_absolute()
                    and cwd_path not in p.parents
                    and p != cwd_path
                    and media_path not in p.parents
                    and p != media_path
                ):
                    return "Error: Command blocked by safety guard (path outside working dir)"

        return None

    @staticmethod
    def _extract_absolute_paths(command: str) -> list[str]:
        # Windows: match drive-root paths like `C:\` as well as `C:\path\to\file`
        # NOTE: `*` is required so `C:\` (nothing after the slash) is still extracted.
        win_paths = re.findall(r"[A-Za-z]:\\[^\s\"'|><;]*", command)
        posix_paths = re.findall(r"(?:^|[\s|>'\"])(/[^\s\"'>;|<]+)", command) # POSIX: /absolute only
        home_paths = re.findall(r"(?:^|[\s|>'\"])(~[^\s\"'>;|<]*)", command) # POSIX/Windows home shortcut: ~
        return win_paths + posix_paths + home_paths
