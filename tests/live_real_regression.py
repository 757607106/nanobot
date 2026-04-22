#!/usr/bin/env python3
"""Run isolated real-data regression against a live nanobot instance."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) in sys.path:
    sys.path.remove(str(SCRIPT_DIR))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nanobot.config.loader import (  # noqa: E402
    load_config,
    resolve_config_env_vars,
    save_config,
)
from nanobot.providers.factory import make_provider_from_config  # noqa: E402


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def _runtime_root(requested: str | None) -> Path:
    if requested:
        return Path(requested).expanduser().resolve()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return (ROOT / "tmp" / f"real-regression-{stamp}").resolve()


def _disable_channels(config: Any) -> None:
    for name in type(config.channels).model_fields:
        section = getattr(config.channels, name, None)
        if hasattr(section, "enabled"):
            section.enabled = False


def _disable_mcp(config: Any) -> None:
    for server in getattr(config.tools, "mcp_servers", {}).values():
        server.enabled = False


def _prepare_config(runtime_dir: Path) -> tuple[Any, Path, Path]:
    source = resolve_config_env_vars(load_config())
    config = source.model_copy(deep=True)

    workspace = runtime_dir / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    config.agents.defaults.workspace = str(workspace)
    _disable_channels(config)
    _disable_mcp(config)

    config_path = runtime_dir / "config.json"
    save_config(config, config_path)
    return config, config_path, workspace


async def _provider_preflight(config: Any) -> dict[str, Any]:
    provider = make_provider_from_config(config)
    model = str(config.agents.defaults.model or "").strip()
    started = time.time()
    response = await provider.chat(
        messages=[
            {
                "role": "user",
                "content": "Reply with only REAL_OK. "
                "Do not add any other words.",
            }
        ],
        model=model,
        max_tokens=32,
        temperature=0.0,
    )
    duration = round(time.time() - started, 3)
    content = str(response.content or "").strip()
    return {
        "name": "provider_preflight",
        "passed": response.finish_reason != "error" and "REAL_OK" in content,
        "duration_seconds": duration,
        "model": model,
        "provider_name": config.get_provider_name(model),
        "finish_reason": response.finish_reason,
        "content_preview": content[:200],
        "usage": response.usage or {},
    }


def _wait_for_health(base_url: str, timeout_s: int = 90) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    last_error = "unknown"
    while time.time() < deadline:
        try:
            req = Request(f"{base_url}/api/v1/health", method="GET")
            with urlopen(req, timeout=5) as response:
                body = response.read().decode("utf-8", errors="replace")
                return {
                    "passed": response.status == 200,
                    "status_code": response.status,
                    "body_preview": body[:200],
                }
        except URLError as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {exc}"
        time.sleep(1)
    return {"passed": False, "status_code": None, "body_preview": "", "error": last_error}


def _run_live_api_suite(base_url: str, runtime_dir: Path) -> dict[str, Any]:
    report_path = runtime_dir / "knowledge-live-report.json"
    started = time.time()
    completed = subprocess.run(
        [sys.executable, str(ROOT / "tests" / "test_knowledge_api_live.py"), "admin", "admin123"],
        cwd=ROOT,
        env={
            **os.environ,
            "NANOBOT_BASE_URL": base_url,
            "NANOBOT_STRICT_LLM": "1",
            "NANOBOT_REPORT_PATH": str(report_path),
            "NANOBOT_REAL_DATA_ROOT": str(ROOT),
            "NANOBOT_LIVE_TIMEOUT": "60",
        },
        capture_output=True,
        text=True,
    )
    duration = round(time.time() - started, 3)
    report = {}
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    return {
        "name": "knowledge_live_api",
        "passed": completed.returncode == 0,
        "duration_seconds": duration,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "report_path": str(report_path),
        "report": report,
    }


def _render_markdown_report(payload: dict[str, Any]) -> str:
    lines = [
        "# Real Regression Report",
        "",
        f"- Started: {payload['started_at']}",
        f"- Duration: {payload['duration_seconds']}s",
        f"- Runtime dir: `{payload['runtime_dir']}`",
        f"- Config: `{payload['config_path']}`",
        f"- Workspace: `{payload['workspace']}`",
        f"- Base URL: `{payload['base_url']}`",
        f"- Overall: `{'PASS' if payload['passed'] else 'FAIL'}`",
        "",
        "## Checks",
    ]

    for check in payload["checks"]:
        status = "PASS" if check["passed"] else "FAIL"
        lines.append(
            f"- {check['name']}: {status} "
            f"({check['duration_seconds']}s)"
        )
        if check["name"] == "provider_preflight":
            lines.append(f"  model: `{check['model']}`")
            lines.append(f"  provider: `{check['provider_name']}`")
            lines.append(f"  finish_reason: `{check['finish_reason']}`")
            lines.append(f"  response: `{check['content_preview']}`")
        elif check["name"] == "knowledge_live_api":
            summary = (check.get("report") or {}).get("summary") or {}
            lines.append(
                "  suite summary: "
                f"passed={summary.get('passed', 0)}, "
                f"failed={summary.get('failed', 0)}, "
                f"skipped={summary.get('skipped', 0)}"
            )
            lines.append(f"  JSON report: `{check['report_path']}`")

    lines.extend(
        [
            "",
            "## Artifacts",
            f"- Server log: `{payload['server_log_path']}`",
            f"- JSON report: `{payload['json_report_path']}`",
            "",
        ]
    )

    if payload.get("fatal_error"):
        lines.append("## Fatal Error")
        lines.append(f"- {payload['fatal_error']}")
        lines.append("")

    failing_checks = [check for check in payload["checks"] if not check["passed"]]
    if failing_checks:
        lines.append("## Failing Checks")
        for check in failing_checks:
            lines.append(f"- {check['name']}")
            if check["name"] == "knowledge_live_api":
                for err in (check.get("report") or {}).get("errors") or []:
                    lines.append(f"- {err}")
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run isolated real-data nanobot regression.")
    parser.add_argument("--runtime-dir", default="", help="Optional runtime directory.")
    parser.add_argument("--port", type=int, default=0, help="Optional fixed port.")
    args = parser.parse_args()

    runtime_dir = _runtime_root(args.runtime_dir or None)
    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    config, config_path, workspace = _prepare_config(runtime_dir)
    base_url = f"http://127.0.0.1:{args.port or _find_free_port()}"
    server_log_path = runtime_dir / "web-ui.log"
    json_report_path = runtime_dir / "real-regression-report.json"
    markdown_report_path = runtime_dir / "real-regression-report.md"

    checks: list[dict[str, Any]] = []
    started = time.time()
    server_proc: subprocess.Popen[str] | None = None

    try:
        checks.append(asyncio.run(_provider_preflight(config)))
        if not checks[-1]["passed"]:
            raise RuntimeError("Provider preflight failed.")

        with server_log_path.open("w", encoding="utf-8") as log_file:
            server_proc = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "nanobot",
                    "web-ui",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    base_url.rsplit(":", 1)[1],
                    "--config",
                    str(config_path),
                    "--workspace",
                    str(workspace),
                    "--frontend",
                    "static",
                ],
                cwd=ROOT,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                text=True,
            )

            health = _wait_for_health(base_url)
            if not health["passed"]:
                raise RuntimeError(f"Web UI health check failed: {health}")

            checks.append(_run_live_api_suite(base_url, runtime_dir))
            if not checks[-1]["passed"]:
                raise RuntimeError("Live API suite failed.")

        payload = {
            "started_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "duration_seconds": round(time.time() - started, 3),
            "runtime_dir": str(runtime_dir),
            "config_path": str(config_path),
            "workspace": str(workspace),
            "base_url": base_url,
            "server_log_path": str(server_log_path),
            "json_report_path": str(json_report_path),
            "passed": all(check["passed"] for check in checks),
            "checks": checks,
        }
    except Exception as exc:  # noqa: BLE001
        payload = {
            "started_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "duration_seconds": round(time.time() - started, 3),
            "runtime_dir": str(runtime_dir),
            "config_path": str(config_path),
            "workspace": str(workspace),
            "base_url": base_url,
            "server_log_path": str(server_log_path),
            "json_report_path": str(json_report_path),
            "passed": False,
            "checks": checks,
            "fatal_error": f"{type(exc).__name__}: {exc}",
        }
    finally:
        if server_proc is not None and server_proc.poll() is None:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server_proc.kill()
                server_proc.wait(timeout=5)

    json_report_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    markdown_report_path.write_text(_render_markdown_report(payload), encoding="utf-8")

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    raise SystemExit(0 if payload["passed"] else 1)


if __name__ == "__main__":
    main()
