"""Repository inspection and installation for MCP servers."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import tomllib
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from nanobot.platform.instances import PlatformInstance, coerce_instance
from nanobot.web.mcp_registry import WebMCPRegistryManager


class MCPRepositoryService:
    """Analyze GitHub repositories and register MCP servers."""

    def __init__(self, config_path: Path | PlatformInstance, registry: WebMCPRegistryManager):
        self._instance = coerce_instance(config_path)
        self._config_path = self._instance.config_path
        self._registry = registry
        self._installs_dir = self._instance.mcp_installs_dir()

    def analyze_repository(self, source: str) -> dict[str, Any]:
        repo = _parse_repository_source(source)
        with tempfile.TemporaryDirectory(prefix="nanobot-mcp-inspect-") as temp_dir:
            checkout_dir = Path(temp_dir) / "checkout"
            self._clone_repository(repo["cloneUrl"], checkout_dir)
            analysis = self._inspect_checkout(checkout_dir, repo)
        return _serialize_analysis(analysis)

    def install_repository(
        self,
        source: str,
        *,
        current_config: dict[str, Any],
        update_config,
    ) -> dict[str, Any]:
        analysis = self._analyze_internal(source)
        server_name = analysis["server_name"]
        repo_url = analysis["repo_url"]

        existing_servers = current_config.setdefault("tools", {}).setdefault("mcpServers", {})
        if server_name in existing_servers:
            raise ValueError(f"MCP '{server_name}' 已存在，请打开已有条目而不是重复安装。")

        duplicate_server = self._registry.find_duplicate_repo(repo_url)
        if duplicate_server:
            raise ValueError(
                f"仓库 {repo_url} 已作为 MCP '{duplicate_server}' 安装，请直接打开已有条目。"
            )

        install_dir: Path | None = None
        try:
            if analysis["install_mode"] == "source":
                install_dir = self._installs_dir / analysis["install_slug"]
                if install_dir.exists():
                    raise ValueError(f"安装目录已存在：{install_dir}")
                install_dir.parent.mkdir(parents=True, exist_ok=True)
                self._clone_repository(analysis["clone_url"], install_dir)
                for step in analysis["install_steps"]:
                    self._run_install_step(
                        step["command"],
                        cwd=install_dir,
                        timeout=step["timeout"],
                    )

            server_payload = self._build_server_payload(analysis, install_dir)
            existing_servers[server_name] = server_payload
            updated_config = update_config(current_config)

            self._registry.upsert_repository_install(
                server_name=server_name,
                display_name=analysis["display_name"],
                repo_url=repo_url,
                clone_url=analysis["clone_url"],
                install_dir=str(install_dir) if install_dir is not None else None,
                install_mode=analysis["install_mode"],
                install_steps=[step["display"] for step in analysis["install_steps"]],
                required_env=analysis["required_env"],
                optional_env=analysis["optional_env"],
            )
        except Exception:
            if install_dir is not None and install_dir.exists():
                shutil.rmtree(install_dir, ignore_errors=True)
            raise

        installed_entry = self._registry.get_server(
            _config_from_payload(updated_config),
            server_name,
        )
        return {
            "serverName": server_name,
            "installedAt": _utc_now(),
            "enabled": False,
            "installDir": str(install_dir) if install_dir is not None else None,
            "analysis": _serialize_analysis(analysis),
            "entry": installed_entry,
            "config": updated_config,
        }

    def _analyze_internal(self, source: str) -> dict[str, Any]:
        repo = _parse_repository_source(source)
        with tempfile.TemporaryDirectory(prefix="nanobot-mcp-install-") as temp_dir:
            checkout_dir = Path(temp_dir) / "checkout"
            self._clone_repository(repo["cloneUrl"], checkout_dir)
            return self._inspect_checkout(checkout_dir, repo)

    def _clone_repository(self, clone_url: str, target_dir: Path) -> None:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", clone_url, str(target_dir)],
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip() or "git clone failed"
            raise ValueError(f"拉取仓库失败：{message}")

    def _run_install_step(self, command: list[str], *, cwd: Path, timeout: int) -> None:
        result = subprocess.run(
            command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip() or "install step failed"
            raise ValueError(f"安装命令失败：{' '.join(command)}\n{message}")

    def _inspect_checkout(self, checkout_dir: Path, repo: dict[str, str]) -> dict[str, Any]:
        evidence: list[str] = []
        package_json = _load_json(checkout_dir / "package.json")
        pyproject = _load_toml(checkout_dir / "pyproject.toml")
        server_manifest = _load_json(checkout_dir / "server.json")
        required_env = _collect_env_requirements(checkout_dir)
        optional_env: list[str] = []

        analysis: dict[str, Any] | None = None
        if isinstance(server_manifest, dict):
            analysis = _inspect_manifest(server_manifest, repo, evidence)

        if analysis is None and isinstance(package_json, dict):
            analysis = _inspect_node_repository(checkout_dir, repo, package_json, evidence)

        if analysis is None and isinstance(pyproject, dict):
            analysis = _inspect_python_repository(checkout_dir, repo, pyproject, evidence)

        if analysis is None:
            raise ValueError("无法从仓库结构推导 MCP 安装计划。")

        missing_runtimes = _missing_runtimes_for_analysis(analysis)
        analysis["required_env"] = required_env
        analysis["optional_env"] = optional_env
        analysis["evidence"] = evidence
        analysis["missing_runtimes"] = missing_runtimes
        analysis["can_install"] = len(missing_runtimes) == 0
        analysis["next_step"] = _next_step_message(analysis)
        return analysis

    def _build_server_payload(self, analysis: dict[str, Any], install_dir: Path | None) -> dict[str, Any]:
        if analysis["transport"] in {"streamableHttp", "sse"}:
            return {
                "enabled": False,
                "type": analysis["transport"],
                "command": "",
                "args": [],
                "env": {},
                "url": analysis["run_url"],
                "headers": {},
                "toolTimeout": 30,
            }

        command = analysis["run_command"]
        args = list(analysis["run_args"])
        for index in analysis.get("path_arg_indices", []):
            if install_dir is None or index < 0 or index >= len(args):
                continue
            args[index] = _expand_install_path(args[index], install_dir)

        return {
            "enabled": False,
            "type": analysis["transport"],
            "command": command,
            "args": args,
            "env": {},
            "url": "",
            "headers": {},
            "toolTimeout": 30,
        }


def _parse_repository_source(source: str) -> dict[str, str]:
    raw = str(source or "").strip()
    if not raw:
        raise ValueError("请输入 GitHub 仓库地址。")

    if raw.count("/") == 1 and "://" not in raw and not raw.startswith("git@"):
        owner, repo = raw.split("/", 1)
        repo = repo.removesuffix(".git").strip()
        if not owner.strip() or not repo:
            raise ValueError("请输入完整的 GitHub 仓库地址，例如 https://github.com/owner/repo。")
        return {
            "owner": owner.strip(),
            "repo": repo,
            "repoUrl": f"https://github.com/{owner.strip()}/{repo}",
            "cloneUrl": f"https://github.com/{owner.strip()}/{repo}.git",
        }

    parsed = urlparse(raw)
    host = parsed.netloc.lower()
    if host not in {"github.com", "www.github.com"}:
        raise ValueError("当前仅支持 GitHub 仓库地址。")

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise ValueError("请输入完整的 GitHub 仓库地址，例如 https://github.com/owner/repo。")
    owner, repo = parts[0], parts[1].removesuffix(".git")
    return {
        "owner": owner,
        "repo": repo,
        "repoUrl": f"https://github.com/{owner}/{repo}",
        "cloneUrl": f"https://github.com/{owner}/{repo}.git",
    }


def _inspect_manifest(
    server_manifest: dict[str, Any],
    repo: dict[str, str],
    evidence: list[str],
) -> dict[str, Any] | None:
    remotes = server_manifest.get("remotes")
    if isinstance(remotes, list):
        for remote in remotes:
            if not isinstance(remote, dict):
                continue
            remote_type = str(remote.get("type", "")).strip().lower()
            url = str(remote.get("url", "")).strip()
            if remote_type in {"streamable-http", "streamablehttp"} and url:
                evidence.append(f"server.json remote={url}")
                return {
                    "title": f"{repo['owner']}/{repo['repo']}",
                    "display_name": _derive_display_name(repo["repo"], server_manifest),
                    "server_name": _derive_server_name(repo["repo"], server_manifest.get("name")),
                    "repo_url": repo["repoUrl"],
                    "clone_url": repo["cloneUrl"],
                    "install_slug": f"{repo['owner']}__{repo['repo']}".lower(),
                    "install_mode": "remote",
                    "transport": "streamableHttp",
                    "run_command": "",
                    "run_args": [],
                    "path_arg_indices": [],
                    "run_url": url,
                    "install_steps": [],
                }
            if remote_type == "sse" and url:
                evidence.append(f"server.json remote={url}")
                return {
                    "title": f"{repo['owner']}/{repo['repo']}",
                    "display_name": _derive_display_name(repo["repo"], server_manifest),
                    "server_name": _derive_server_name(repo["repo"], server_manifest.get("name")),
                    "repo_url": repo["repoUrl"],
                    "clone_url": repo["cloneUrl"],
                    "install_slug": f"{repo['owner']}__{repo['repo']}".lower(),
                    "install_mode": "remote",
                    "transport": "sse",
                    "run_command": "",
                    "run_args": [],
                    "path_arg_indices": [],
                    "run_url": url,
                    "install_steps": [],
                }
    return None


def _inspect_node_repository(
    checkout_dir: Path,
    repo: dict[str, str],
    package_json: dict[str, Any],
    evidence: list[str],
) -> dict[str, Any]:
    package_name = str(package_json.get("name", "")).strip()
    if package_name:
        evidence.append(f"package.json name={package_name}")

    install_steps = [
        {
            "command": ["npm", "ci"] if (checkout_dir / "package-lock.json").exists() else ["npm", "install"],
            "display": "npm ci" if (checkout_dir / "package-lock.json").exists() else "npm install",
            "timeout": 900,
        }
    ]

    bin_field = package_json.get("bin")
    if isinstance(bin_field, str) and bin_field.strip():
        bin_path = bin_field.strip()
        evidence.append(f"package.json bin={bin_path}")
        return {
            "title": f"{repo['owner']}/{repo['repo']}",
            "display_name": _derive_display_name(repo["repo"], package_json),
            "server_name": _derive_server_name(repo["repo"], package_name),
            "repo_url": repo["repoUrl"],
            "clone_url": repo["cloneUrl"],
            "install_slug": f"{repo['owner']}__{repo['repo']}".lower(),
            "install_mode": "source",
            "transport": "stdio",
            "run_command": "node",
            "run_args": [bin_path],
            "path_arg_indices": [0],
            "run_url": "",
            "install_steps": install_steps,
        }

    if isinstance(bin_field, dict) and len(bin_field) == 1:
        bin_path = str(next(iter(bin_field.values()))).strip()
        evidence.append(f"package.json bin={bin_path}")
        return {
            "title": f"{repo['owner']}/{repo['repo']}",
            "display_name": _derive_display_name(repo["repo"], package_json),
            "server_name": _derive_server_name(repo["repo"], package_name or next(iter(bin_field.keys()))),
            "repo_url": repo["repoUrl"],
            "clone_url": repo["cloneUrl"],
            "install_slug": f"{repo['owner']}__{repo['repo']}".lower(),
            "install_mode": "source",
            "transport": "stdio",
            "run_command": "node",
            "run_args": [bin_path],
            "path_arg_indices": [0],
            "run_url": "",
            "install_steps": install_steps,
        }

    for candidate in ["dist/index.js", "build/index.js", "server.js", "index.js"]:
        if (checkout_dir / candidate).exists():
            evidence.append(f"entry={candidate}")
            return {
                "title": f"{repo['owner']}/{repo['repo']}",
                "display_name": _derive_display_name(repo["repo"], package_json),
                "server_name": _derive_server_name(repo["repo"], package_name),
                "repo_url": repo["repoUrl"],
                "clone_url": repo["cloneUrl"],
                "install_slug": f"{repo['owner']}__{repo['repo']}".lower(),
                "install_mode": "source",
                "transport": "stdio",
                "run_command": "node",
                "run_args": [candidate],
                "path_arg_indices": [0],
                "run_url": "",
                "install_steps": install_steps,
            }

    scripts = package_json.get("scripts")
    if isinstance(scripts, dict) and str(scripts.get("start", "")).strip():
        evidence.append("package.json scripts.start")
        return {
            "title": f"{repo['owner']}/{repo['repo']}",
            "display_name": _derive_display_name(repo["repo"], package_json),
            "server_name": _derive_server_name(repo["repo"], package_name),
            "repo_url": repo["repoUrl"],
            "clone_url": repo["cloneUrl"],
            "install_slug": f"{repo['owner']}__{repo['repo']}".lower(),
            "install_mode": "source",
            "transport": "stdio",
            "run_command": "npm",
            "run_args": ["--prefix", ".", "run", "start"],
            "path_arg_indices": [1],
            "run_url": "",
            "install_steps": install_steps,
        }

    raise ValueError("发现 package.json，但没有推导出可运行的 MCP 入口。")


def _inspect_python_repository(
    checkout_dir: Path,
    repo: dict[str, str],
    pyproject: dict[str, Any],
    evidence: list[str],
) -> dict[str, Any]:
    project = pyproject.get("project")
    project_name = str(project.get("name", "")).strip() if isinstance(project, dict) else ""
    scripts = project.get("scripts") if isinstance(project, dict) else None
    if project_name:
        evidence.append(f"pyproject project.name={project_name}")

    target_file = ""
    if isinstance(scripts, dict) and len(scripts) >= 1:
        script_name, script_target = next(iter(scripts.items()))
        evidence.append(f"pyproject script={script_name}")
        module_name = str(script_target).split(":", 1)[0].strip()
        candidate = module_name.replace(".", "/") + ".py"
        if (checkout_dir / candidate).exists():
            target_file = candidate
        elif (checkout_dir / "src" / candidate).exists():
            target_file = f"src/{candidate}"
        elif module_name.endswith(".__main__"):
            alt_candidate = module_name.replace(".", "/").replace("/__main__", "") + "/__main__.py"
            if (checkout_dir / alt_candidate).exists():
                target_file = alt_candidate
            elif (checkout_dir / "src" / alt_candidate).exists():
                target_file = f"src/{alt_candidate}"

    if not target_file:
        for candidate in ["main.py", "server.py"]:
            if (checkout_dir / candidate).exists():
                target_file = candidate
                evidence.append(f"entry={candidate}")
                break

    if not target_file:
        raise ValueError("发现 pyproject.toml，但没有推导出可运行的 Python MCP 入口。")

    return {
        "title": f"{repo['owner']}/{repo['repo']}",
        "display_name": _derive_display_name(repo["repo"], project or {}),
        "server_name": _derive_server_name(repo["repo"], project_name or target_file),
        "repo_url": repo["repoUrl"],
        "clone_url": repo["cloneUrl"],
        "install_slug": f"{repo['owner']}__{repo['repo']}".lower(),
        "install_mode": "source",
        "transport": "stdio",
        "run_command": "python3",
        "run_args": [target_file],
        "path_arg_indices": [0],
        "run_url": "",
        "install_steps": [
            {
                "command": ["python3", "-m", "pip", "install", "-e", "."],
                "display": "python3 -m pip install -e .",
                "timeout": 900,
            }
        ],
    }


def _collect_env_requirements(checkout_dir: Path) -> list[str]:
    pattern_files = [".env.example", ".env.sample", "example.env", "sample.env"]
    found: list[str] = []
    for candidate in pattern_files:
        path = checkout_dir / candidate
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key = stripped.split("=", 1)[0].strip()
            if _is_valid_env_name(key) and key not in found:
                found.append(key)
    return found


def _missing_runtimes_for_analysis(analysis: dict[str, Any]) -> list[str]:
    required = ["git"]
    install_mode = analysis["install_mode"]
    if install_mode == "source":
        for step in analysis["install_steps"]:
            command = step["command"]
            if command and command[0] not in required:
                required.append(command[0])
        if analysis["run_command"] and analysis["run_command"] not in required:
            required.append(analysis["run_command"])

    missing: list[str] = []
    for command in required:
        if shutil.which(command) is None:
            missing.append(command)
    return missing


def _next_step_message(analysis: dict[str, Any]) -> str:
    if analysis["missing_runtimes"]:
        return "先补齐缺失的本地运行时，再执行安装。"
    if analysis["required_env"]:
        return "先安装并登记 MCP，再补充必需的环境变量，然后执行测试与启用。"
    return "可以安装并登记 MCP，随后在后续任务里执行测试与启用。"


def _serialize_analysis(analysis: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": analysis["title"],
        "displayName": analysis["display_name"],
        "serverName": analysis["server_name"],
        "repoUrl": analysis["repo_url"],
        "cloneUrl": analysis["clone_url"],
        "installSlug": analysis["install_slug"],
        "installMode": analysis["install_mode"],
        "transport": analysis["transport"],
        "commandPreview": _command_preview(analysis),
        "runUrl": analysis["run_url"] or None,
        "installSteps": [step["display"] for step in analysis["install_steps"]],
        "requiredEnv": list(analysis["required_env"]),
        "optionalEnv": list(analysis["optional_env"]),
        "evidence": list(analysis["evidence"]),
        "missingRuntimes": list(analysis["missing_runtimes"]),
        "canInstall": bool(analysis["can_install"]),
        "nextStep": analysis["next_step"],
    }


def _command_preview(analysis: dict[str, Any]) -> str | None:
    if analysis["run_url"]:
        return None
    if not analysis["run_command"]:
        return None
    parts = [analysis["run_command"], *analysis["run_args"]]
    return " ".join(part for part in parts if part)


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _load_toml(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        with path.open("rb") as handle:
            payload = tomllib.load(handle)
    except tomllib.TOMLDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _derive_display_name(repo_name: str, payload: dict[str, Any]) -> str:
    for value in [payload.get("title"), payload.get("name")]:
        text = str(value or "").strip()
        if text:
            return text.split("/")[-1]
    return repo_name


def _derive_server_name(repo_name: str, candidate: Any) -> str:
    raw = str(candidate or "").strip().split("/")[-1]
    if not raw:
        raw = repo_name
    slug = []
    for char in raw.lower():
        if char.isalnum():
            slug.append(char)
        else:
            if not slug or slug[-1] != "-":
                slug.append("-")
    return "".join(slug).strip("-") or "mcp-server"


def _expand_install_path(value: str, install_dir: Path) -> str:
    raw = str(value or "").strip()
    if not raw or raw == ".":
        return str(install_dir)
    if raw.startswith("./"):
        return str(install_dir / raw[2:])
    if raw.startswith("../") or raw.startswith("/"):
        return raw
    return str(install_dir / raw)


def _is_valid_env_name(value: str) -> bool:
    if not value:
        return False
    for char in value:
        if not (char.isupper() or char.isdigit() or char == "_"):
            return False
    return True


def _utc_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _config_from_payload(payload: dict[str, Any]):
    from nanobot.config.schema import Config

    return Config.model_validate(payload)
