#!/usr/bin/env python3
"""Live API regression tests for the knowledge-base and agent stack.

This suite is intentionally real-path only:
- hits a live nanobot web-ui backend over HTTP
- uses real repository files as uploaded knowledge data
- uses real parse/index/query/evaluation/agent chat flows
- writes a JSON report when ``NANOBOT_REPORT_PATH`` is provided

Usage:
    python3 tests/test_knowledge_api_live.py [username] [password]
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
import traceback
import uuid
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) in sys.path:
    sys.path.remove(str(SCRIPT_DIR))

BASE_URL = os.environ.get("NANOBOT_BASE_URL", "http://127.0.0.1:6788").rstrip("/")
TIMEOUT = int(os.environ.get("NANOBOT_LIVE_TIMEOUT", "60"))
STRICT_LLM = os.environ.get("NANOBOT_STRICT_LLM", "").strip().lower() in {"1", "true", "yes", "on"}
REPORT_PATH = (
    Path(os.environ["NANOBOT_REPORT_PATH"]).expanduser().resolve()
    if os.environ.get("NANOBOT_REPORT_PATH")
    else None
)
REPO_ROOT = Path(
    os.environ.get("NANOBOT_REAL_DATA_ROOT")
    or Path(__file__).resolve().parents[1]
).resolve()

_cookie_jar = CookieJar()
_opener = build_opener(HTTPCookieProcessor(_cookie_jar))

_passed = 0
_failed = 0
_skipped = 0
_errors: list[str] = []
_results: list[dict[str, Any]] = []
_started_at = time.time()


def _log(msg: str) -> None:
    print(msg, flush=True)


def _record(name: str, status: str, reason: str | None = None) -> None:
    item: dict[str, Any] = {"name": name, "status": status}
    if reason:
        item["reason"] = reason
    _results.append(item)


def _pass(test: str) -> None:
    global _passed
    _passed += 1
    _record(test, "passed")
    _log(f"  PASS: {test}")


def _fail(test: str, reason: str) -> None:
    global _failed
    _failed += 1
    _errors.append(f"{test}: {reason}")
    _record(test, "failed", reason)
    _log(f"  FAIL: {test} - {reason}")


def _skip(test: str, reason: str) -> None:
    global _skipped
    _skipped += 1
    _record(test, "skipped", reason)
    _log(f"  SKIP: {test} - {reason}")


def _llm_optional(test: str, reason: str) -> None:
    if STRICT_LLM:
        _fail(test, reason)
    else:
        _skip(test, reason)


class HTTPResponse:
    def __init__(self, status_code: int, body: bytes, headers: dict[str, Any]):
        self.status_code = status_code
        self.body = body
        self.headers = headers
        self.text = body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.body)


def _request(
    method: str,
    path: str,
    *,
    json_body: Any = None,
    files: dict[str, tuple[str, io.BytesIO | bytes, str]] | None = None,
    form_data: dict[str, Any] | None = None,
    timeout: int = TIMEOUT,
) -> HTTPResponse:
    url = f"{BASE_URL}{path}"
    headers: dict[str, str] = {}
    data: bytes | None = None

    if files:
        boundary = f"----FormBoundary{uuid.uuid4().hex[:16]}"
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        body_parts: list[bytes] = []

        if form_data:
            for key, value in form_data.items():
                body_parts.append(f"--{boundary}\r\n".encode())
                body_parts.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
                body_parts.append(f"{value}\r\n".encode())

        for field_name, file_tuple in files.items():
            filename, file_obj, content_type = file_tuple
            file_bytes = file_obj.read() if isinstance(file_obj, io.BytesIO) else file_obj
            body_parts.append(f"--{boundary}\r\n".encode())
            body_parts.append(
                (
                    "Content-Disposition: form-data; "
                    f'name="{field_name}"; filename="{filename}"\r\n'
                ).encode()
            )
            body_parts.append(f"Content-Type: {content_type}\r\n\r\n".encode())
            body_parts.append(file_bytes)
            body_parts.append(b"\r\n")

        body_parts.append(f"--{boundary}--\r\n".encode())
        data = b"".join(body_parts)
    elif json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
    elif method in {"POST", "PUT", "PATCH", "DELETE"}:
        headers["Content-Type"] = "application/json"
        data = b"{}"

    req = Request(url, data=data, headers=headers, method=method)

    try:
        with _opener.open(req, timeout=timeout) as response:
            body = response.read()
            return HTTPResponse(response.status, body, dict(response.headers))
    except HTTPError as exc:
        body = exc.read() if exc.fp else b""
        return HTTPResponse(exc.code, body, dict(exc.headers) if exc.headers else {})


def GET(path: str, **kwargs: Any) -> HTTPResponse:
    return _request("GET", path, **kwargs)


def POST(path: str, **kwargs: Any) -> HTTPResponse:
    return _request("POST", path, **kwargs)


def PUT(path: str, **kwargs: Any) -> HTTPResponse:
    return _request("PUT", path, **kwargs)


def DELETE(path: str, **kwargs: Any) -> HTTPResponse:
    return _request("DELETE", path, **kwargs)


def ok_data(resp: HTTPResponse) -> Any:
    body = resp.json()
    assert body.get("success") is True, (
        "Expected success=True, "
        f"got {json.dumps(body, indent=2)[:500]}"
    )
    return body.get("data")


def _repo_file(*parts: str) -> Path:
    path = REPO_ROOT.joinpath(*parts)
    if not path.exists():
        raise FileNotFoundError(f"Real regression data file not found: {path}")
    return path


def _real_upload_files() -> list[tuple[str, bytes, str]]:
    files = [
        _repo_file("README.md"),
        _repo_file("tests", "README.md"),
    ]
    return [(path.name, path.read_bytes(), "text/markdown") for path in files]


def _wait_for_job(
    kb_id: str,
    job_id: str,
    timeout_s: int = 240,
    interval_s: float = 2.0,
) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    last_job: dict[str, Any] | None = None
    while time.time() < deadline:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}/jobs", timeout=max(TIMEOUT, 60))
        assert response.status_code == 200, (
            f"jobs status={response.status_code}, "
            f"body={response.text[:300]}"
        )
        jobs = ok_data(response)
        assert isinstance(jobs, list), f"Expected list jobs, got {type(jobs).__name__}"
        last_job = next((job for job in jobs if job.get("jobId") == job_id), None)
        if last_job and last_job.get("status") in {"succeeded", "failed"}:
            return last_job
        time.sleep(interval_s)
    raise AssertionError(f"Timed out waiting for job {job_id}; last_job={last_job}")


def _wait_for_evaluation(
    kb_id: str,
    task_id: str,
    timeout_s: int = 300,
    interval_s: float = 2.0,
) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    last_payload: dict[str, Any] | None = None
    while time.time() < deadline:
        response = GET(
            f"/api/v1/knowledge-bases/{kb_id}/evaluation/results/{task_id}",
            timeout=max(TIMEOUT, 60),
        )
        assert response.status_code == 200, (
            f"evaluation status={response.status_code}, body={response.text[:300]}"
        )
        last_payload = ok_data(response)
        if isinstance(last_payload, dict) and last_payload.get("status") in {"completed", "failed"}:
            return last_payload
        time.sleep(interval_s)
    raise AssertionError(f"Timed out waiting for evaluation {task_id}; last={last_payload}")


def do_login(username: str, password: str) -> bool:
    response = POST("/api/v1/auth/login", json_body={"username": username, "password": password})
    if response.status_code != 200:
        return False
    payload = response.json()
    return bool(payload.get("success") and payload.get("data", {}).get("authenticated"))


def _auth_status() -> dict[str, Any]:
    response = GET("/api/v1/auth/status")
    assert response.status_code == 200, f"status={response.status_code}"
    data = ok_data(response)
    assert isinstance(data, dict), f"Expected auth status dict, got {type(data).__name__}"
    return data


def ensure_auth_session(username: str, password: str) -> str:
    status = _auth_status()
    if status.get("initialized"):
        assert do_login(username, password), f"Failed to login as '{username}'"
        return "login"

    response = POST(
        "/api/v1/auth/bootstrap",
        json_body={"username": username, "password": password},
    )
    assert response.status_code == 201, (
        f"bootstrap status={response.status_code}, body={response.text[:300]}"
    )
    payload = response.json()
    assert payload.get("success") is True, f"bootstrap failed: {response.text[:300]}"
    data = payload.get("data") or {}
    assert data.get("authenticated") is True, "bootstrap did not create an authenticated session"
    return "bootstrap"


def _build_report() -> dict[str, Any]:
    return {
        "base_url": BASE_URL,
        "strict_llm": STRICT_LLM,
        "started_at_epoch": _started_at,
        "finished_at_epoch": time.time(),
        "duration_seconds": round(time.time() - _started_at, 3),
        "summary": {"passed": _passed, "failed": _failed, "skipped": _skipped},
        "errors": list(_errors),
        "results": list(_results),
    }


def _write_report() -> None:
    if REPORT_PATH is None:
        return
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(
        json.dumps(_build_report(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def run_all(username: str = "admin", password: str = "admin123") -> None:
    state: dict[str, Any] = {}

    _log("")
    _log("==============================================")
    _log("  Nanobot Live Knowledge/API Regression")
    _log("==============================================")
    _log("")

    _log("Phase 0: Health & Auth")
    try:
        response = GET("/api/v1/health")
        assert response.status_code == 200, f"status={response.status_code}"
        _pass("Server health")
    except Exception as exc:  # noqa: BLE001
        _fail("Server health", str(exc))
        return

    try:
        auth_mode = ensure_auth_session(username, password)
        if auth_mode == "bootstrap":
            _pass(f"Bootstrap admin as {username}")
        else:
            _pass(f"Login as {username}")
    except Exception as exc:  # noqa: BLE001
        _fail("Auth session setup", str(exc))
        return

    _log("")
    _log("Phase 1: Models & Knowledge Base CRUD")
    try:
        response = GET("/api/v1/knowledge-bases/available-models")
        assert response.status_code == 200
        data = ok_data(response)
        assert isinstance(data, dict)
        _pass("List available models")
    except Exception as exc:  # noqa: BLE001
        _fail("List available models", str(exc))

    try:
        response = GET("/api/v1/knowledge-bases")
        assert response.status_code == 200
        baseline = ok_data(response)
        assert isinstance(baseline, list)
        state["baseline_count"] = len(baseline)
        _pass("List KB baseline")
    except Exception as exc:  # noqa: BLE001
        _fail("List KB baseline", str(exc))
        return

    kb_id = None
    try:
        response = POST(
            "/api/v1/knowledge-bases",
            json_body={
                "name": f"Real API Test KB {uuid.uuid4().hex[:8]}",
                "description": "Live regression knowledge base.",
                "tags": ["live", "real-regression"],
            },
        )
        assert response.status_code == 201, (
            f"status={response.status_code}, body={response.text[:300]}"
        )
        kb = ok_data(response)
        kb_id = kb["kbId"]
        state["kb_id"] = kb_id
        _pass("Create KB")
    except Exception as exc:  # noqa: BLE001
        _fail("Create KB", str(exc))
        return

    try:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}")
        assert response.status_code == 200
        kb = ok_data(response)
        assert kb["kbId"] == kb_id
        _pass("Get KB")
    except Exception as exc:  # noqa: BLE001
        _fail("Get KB", str(exc))

    try:
        response = PUT(
            f"/api/v1/knowledge-bases/{kb_id}",
            json_body={"description": "Live regression knowledge base (updated)."},
        )
        assert response.status_code == 200
        _pass("Update KB")
    except Exception as exc:  # noqa: BLE001
        _fail("Update KB", str(exc))

    try:
        response = GET("/api/v1/knowledge-bases/accessible")
        assert response.status_code == 200
        data = ok_data(response)
        assert any(item["kbId"] == kb_id for item in data)
        _pass("List accessible KBs")
    except Exception as exc:  # noqa: BLE001
        _fail("List accessible KBs", str(exc))

    try:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}/query-params")
        assert response.status_code == 200
        _pass("Get query params")
    except Exception as exc:  # noqa: BLE001
        _fail("Get query params", str(exc))

    try:
        response = PUT(
            f"/api/v1/knowledge-bases/{kb_id}/query-params",
            json_body={"mode": "mix", "top_k": 4},
        )
        assert response.status_code == 200
        _pass("Update query params")
    except Exception as exc:  # noqa: BLE001
        _fail("Update query params", str(exc))

    _log("")
    _log("Phase 2: Folders, Real File Upload, Preview & Download")
    folder_id = None
    try:
        response = POST(
            f"/api/v1/knowledge-bases/{kb_id}/folders",
            json_body={"name": "repo-files"},
        )
        assert response.status_code == 201
        folder = ok_data(response)
        folder_id = folder.get("fileId") or folder.get("folderId")
        state["folder_id"] = folder_id
        _pass("Create folder")
    except Exception as exc:  # noqa: BLE001
        _fail("Create folder", str(exc))

    uploaded_file_ids: list[str] = []
    try:
        for index, (file_name, content, content_type) in enumerate(_real_upload_files(), start=1):
            response = POST(
                f"/api/v1/knowledge-bases/{kb_id}/files",
                files={"file": (file_name, io.BytesIO(content), content_type)},
            )
            assert response.status_code == 201, (
                f"status={response.status_code}, body={response.text[:300]}"
            )
            data = ok_data(response)
            file_id = data["items"][0]["fileId"]
            uploaded_file_ids.append(file_id)
            state[f"file_{index}_id"] = file_id
            state[f"file_{index}_name"] = file_name
        _pass("Upload real repository files")
    except Exception as exc:  # noqa: BLE001
        _fail("Upload real repository files", str(exc))

    if uploaded_file_ids:
        file_id = uploaded_file_ids[0]
        try:
            response = GET(f"/api/v1/knowledge-bases/{kb_id}/files")
            assert response.status_code == 200
            listing = ok_data(response)
            items = listing.get("items", []) if isinstance(listing, dict) else listing
            assert len(items) >= len(uploaded_file_ids)
            _pass("List knowledge files")
        except Exception as exc:  # noqa: BLE001
            _fail("List knowledge files", str(exc))

        try:
            response = GET(f"/api/v1/knowledge-bases/{kb_id}/files/{file_id}/detail")
            assert response.status_code == 200
            detail = ok_data(response)
            assert detail["file"]["fileId"] == file_id
            _pass("Get file detail")
        except Exception as exc:  # noqa: BLE001
            _fail("Get file detail", str(exc))

        try:
            response = GET(f"/api/v1/knowledge-bases/{kb_id}/files/{file_id}/preview")
            assert response.status_code == 200
            _pass("Preview markdown file")
        except Exception as exc:  # noqa: BLE001
            _fail("Preview markdown file", str(exc))

        try:
            response = GET(f"/api/v1/knowledge-bases/{kb_id}/files/{file_id}/download")
            assert response.status_code == 200
            assert len(response.body) > 0
            _pass("Download file")
        except Exception as exc:  # noqa: BLE001
            _fail("Download file", str(exc))

        try:
            response = GET(
                f"/api/v1/knowledge-bases/{kb_id}/files/"
                f"{file_id}/download?disposition=inline"
            )
            assert response.status_code == 200
            _pass("Inline download")
        except Exception as exc:  # noqa: BLE001
            _fail("Inline download", str(exc))

    _log("")
    _log("Phase 3: Source Management")
    source_id = None
    try:
        response = POST(
            f"/api/v1/knowledge-bases/{kb_id}/sources",
            json_body={
                "sourceType": "faq_table",
                "title": "README FAQ",
                "items": [
                    {
                        "question": "What is the default login account?",
                        "answer": "Use admin / admin123 after startup.",
                    },
                    {
                        "question": "What is the front-end stack?",
                        "answer": "React 18 + Vite + Ant Design X + Framer Motion.",
                    },
                ],
            },
        )
        assert response.status_code == 201
        source = ok_data(response)
        source_id = source["fileId"]
        state["source_id"] = source_id
        _pass("Add FAQ source")
    except Exception as exc:  # noqa: BLE001
        _fail("Add FAQ source", str(exc))

    try:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}/sources")
        assert response.status_code == 200
        _pass("List sources")
    except Exception as exc:  # noqa: BLE001
        _fail("List sources", str(exc))

    if source_id:
        try:
            response = PUT(
                f"/api/v1/knowledge-bases/{kb_id}/sources/{source_id}",
                json_body={"fileName": "readme-faq-updated.txt"},
            )
            assert response.status_code == 200
            _pass("Update source")
        except Exception as exc:  # noqa: BLE001
            _fail("Update source", str(exc))

    _log("")
    _log("Phase 4: Parse, Index & Query")
    try:
        parse_ids = list(uploaded_file_ids)
        if source_id:
            parse_ids.append(source_id)

        response = POST(
            f"/api/v1/knowledge-bases/{kb_id}/files/parse",
            json_body={"file_ids": parse_ids},
            timeout=max(TIMEOUT, 120),
        )
        assert response.status_code == 202, (
            f"status={response.status_code}, body={response.text[:300]}"
        )
        parse_job_id = ok_data(response)["job"]["jobId"]
        parse_job = _wait_for_job(kb_id, parse_job_id)
        assert parse_job["status"] == "succeeded", parse_job
        _pass("Parse files")
    except Exception as exc:  # noqa: BLE001
        _fail("Parse files", str(exc))

    try:
        index_ids = list(uploaded_file_ids)
        if source_id:
            index_ids.append(source_id)

        response = POST(
            f"/api/v1/knowledge-bases/{kb_id}/files/index",
            json_body={"file_ids": index_ids},
            timeout=max(TIMEOUT, 120),
        )
        assert response.status_code == 202, (
            f"status={response.status_code}, body={response.text[:300]}"
        )
        index_job_id = ok_data(response)["job"]["jobId"]
        index_job = _wait_for_job(kb_id, index_job_id)
        assert index_job["status"] == "succeeded", index_job
        _pass("Index files")
    except Exception as exc:  # noqa: BLE001
        _fail("Index files", str(exc))

    try:
        response = POST(
            f"/api/v1/knowledge-bases/{kb_id}/query",
            json_body={"query": "What is the front-end tech stack of this project?", "mode": "mix"},
            timeout=max(TIMEOUT, 120),
        )
        assert response.status_code == 200, (
            f"status={response.status_code}, body={response.text[:300]}"
        )
        _pass("Query KB")
    except Exception as exc:  # noqa: BLE001
        _fail("Query KB", str(exc))

    try:
        response = POST(
            f"/api/v1/knowledge-bases/{kb_id}/query",
            json_body={
                "query": "What is the default login account?",
                "mode": "mix",
                "only_need_context": True,
                "top_k": 3,
            },
            timeout=max(TIMEOUT, 120),
        )
        assert response.status_code == 200, (
            f"status={response.status_code}, body={response.text[:300]}"
        )
        _pass("Query KB context mode")
    except Exception as exc:  # noqa: BLE001
        _fail("Query KB context mode", str(exc))

    try:
        response = POST(f"/api/v1/knowledge-bases/{kb_id}/query", json_body={"query": ""})
        assert response.status_code == 400
        _pass("Query empty query returns 400")
    except Exception as exc:  # noqa: BLE001
        _fail("Query empty query returns 400", str(exc))

    _log("")
    _log("Phase 5: Sample Questions, Mindmap & Graph")
    try:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}/sample-questions")
        assert response.status_code == 200
        _pass("Get sample questions")
    except Exception as exc:  # noqa: BLE001
        _fail("Get sample questions", str(exc))

    try:
        response = POST(f"/api/v1/knowledge-bases/{kb_id}/sample-questions", json_body={"count": 3})
        if response.status_code == 200:
            _pass("Generate sample questions")
        else:
            _llm_optional(
                "Generate sample questions",
                f"status={response.status_code}, body={response.text[:300]}",
            )
    except Exception as exc:  # noqa: BLE001
        _llm_optional("Generate sample questions", str(exc))

    try:
        response = POST(f"/api/v1/knowledge-bases/{kb_id}/mindmap", json_body={})
        if response.status_code == 200:
            _pass("Generate mindmap")
        else:
            _llm_optional(
                "Generate mindmap",
                f"status={response.status_code}, body={response.text[:300]}",
            )
    except Exception as exc:  # noqa: BLE001
        _llm_optional("Generate mindmap", str(exc))

    try:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}/mindmap")
        assert response.status_code == 200, (
            f"status={response.status_code}, body={response.text[:300]}"
        )
        _pass("Get mindmap")
    except Exception as exc:  # noqa: BLE001
        _llm_optional("Get mindmap", str(exc))

    try:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}/graph/labels")
        assert response.status_code == 200
        _pass("Get graph labels")
    except Exception as exc:  # noqa: BLE001
        _fail("Get graph labels", str(exc))

    try:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}/graph/stats")
        assert response.status_code == 200
        _pass("Get graph stats")
    except Exception as exc:  # noqa: BLE001
        _fail("Get graph stats", str(exc))

    _log("")
    _log("Phase 6: Benchmarks & Evaluation")
    benchmark_id = None
    try:
        benchmark_body = "\n".join(
            [
                (
                    '{"query": "What is the front-end stack?", '
                    '"expected": "React 18 + Vite + Ant Design X + '
                    'Framer Motion"}'
                ),
                (
                    '{"query": "What is the default login account?", '
                    '"expected": "admin / admin123"}'
                ),
            ]
        ) + "\n"
        response = POST(
            f"/api/v1/knowledge-bases/{kb_id}/benchmarks/upload",
            files={
                "file": (
                    "real-benchmark.jsonl",
                    io.BytesIO(benchmark_body.encode("utf-8")),
                    "application/jsonl",
                )
            },
            form_data={
                "name": "Real Regression Benchmark",
                "description": "Benchmark generated from repo README.",
            },
        )
        assert response.status_code == 201, (
            f"status={response.status_code}, body={response.text[:300]}"
        )
        benchmark = ok_data(response)
        benchmark_id = benchmark["benchmarkId"]
        state["benchmark_id"] = benchmark_id
        _pass("Upload benchmark")
    except Exception as exc:  # noqa: BLE001
        _fail("Upload benchmark", str(exc))

    if benchmark_id:
        try:
            response = GET(f"/api/v1/knowledge-bases/{kb_id}/benchmarks")
            assert response.status_code == 200
            _pass("List benchmarks")
        except Exception as exc:  # noqa: BLE001
            _fail("List benchmarks", str(exc))

        try:
            response = GET(f"/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}/download")
            assert response.status_code == 200
            _pass("Download benchmark")
        except Exception as exc:  # noqa: BLE001
            _fail("Download benchmark", str(exc))

    evaluation_task_id = None
    try:
        response = GET(f"/api/v1/knowledge-bases/{kb_id}/evaluation/history")
        assert response.status_code == 200
        _pass("Get evaluation history")
    except Exception as exc:  # noqa: BLE001
        _fail("Get evaluation history", str(exc))

    if benchmark_id:
        try:
            response = POST(
                f"/api/v1/knowledge-bases/{kb_id}/evaluation/run",
                json_body={"benchmarkId": benchmark_id},
                timeout=max(TIMEOUT, 120),
            )
            assert response.status_code == 202, (
                f"status={response.status_code}, body={response.text[:300]}"
            )
            evaluation_task_id = ok_data(response)["taskId"]
            state["evaluation_task_id"] = evaluation_task_id
            result = _wait_for_evaluation(kb_id, evaluation_task_id)
            assert result["status"] == "completed", result
            _pass("Run evaluation")
        except Exception as exc:  # noqa: BLE001
            _llm_optional("Run evaluation", str(exc))

    _log("")
    _log("Phase 7: URL Fetching & Error Handling")
    try:
        response = POST(
            f"/api/v1/knowledge-bases/{kb_id}/files/fetch-url",
            json_body={"url": "https://example.com"},
            timeout=max(TIMEOUT, 60),
        )
        if response.status_code == 201:
            _pass("Fetch URL file")
        else:
            _skip("Fetch URL file", f"status={response.status_code}, body={response.text[:300]}")
    except Exception as exc:  # noqa: BLE001
        _skip("Fetch URL file", str(exc))

    try:
        response = GET("/api/v1/knowledge-bases/non-existent-kb-xxxxx")
        assert response.status_code == 404
        _pass("Get non-existent KB returns 404")
    except Exception as exc:  # noqa: BLE001
        _fail("Get non-existent KB returns 404", str(exc))

    _log("")
    _log("Phase 8: Agent with Knowledge Binding")
    agent_id = None
    session_id = None
    try:
        response = POST(
            "/api/v1/agents",
            json_body={
                "name": f"Real KB Agent {uuid.uuid4().hex[:8]}",
                "description": "Real regression agent bound to the KB.",
                "systemPrompt": (
                    "You are a helpful assistant. Use the knowledge base to answer. "
                    "Answer concisely and cite relevant facts from the KB."
                ),
                "knowledgeBindingIds": [kb_id],
            },
        )
        assert response.status_code == 201, (
            f"status={response.status_code}, body={response.text[:300]}"
        )
        agent = ok_data(response)
        agent_id = agent["agentId"]
        state["agent_id"] = agent_id
        _pass("Create agent with KB binding")
    except Exception as exc:  # noqa: BLE001
        _fail("Create agent with KB binding", str(exc))

    if agent_id:
        try:
            response = POST(
                f"/api/v1/agents/{agent_id}/sessions",
                json_body={"title": "Real KB Session"},
            )
            assert response.status_code == 201, (
                f"status={response.status_code}, body={response.text[:300]}"
            )
            session = ok_data(response)
            session_id = session["sessionId"]
            state["session_id"] = session_id
            _pass("Create agent session")
        except Exception as exc:  # noqa: BLE001
            _fail("Create agent session", str(exc))

    if agent_id and session_id:
        try:
            response = POST(
                f"/api/v1/agents/{agent_id}/sessions/{session_id}/messages",
                json_body={"content": "What is the front-end tech stack of this project?"},
                timeout=max(TIMEOUT, 120),
            )
            assert response.status_code == 200, (
                f"status={response.status_code}, body={response.text[:300]}"
            )
            payload = ok_data(response)
            assert payload is not None
            _pass("Agent chat non-stream")
        except Exception as exc:  # noqa: BLE001
            _fail("Agent chat non-stream", str(exc))

        try:
            response = POST(
                f"/api/v1/agents/{agent_id}/sessions/{session_id}/messages?stream=true",
                json_body={"content": "What is the default login account?"},
                timeout=max(TIMEOUT, 120),
            )
            assert response.status_code == 200, (
                f"status={response.status_code}, body={response.text[:300]}"
            )
            events = [line for line in response.text.splitlines() if line.startswith("data: ")]
            assert events, "Expected streamed SSE events."
            _pass("Agent chat stream")
        except Exception as exc:  # noqa: BLE001
            _fail("Agent chat stream", str(exc))

        try:
            response = GET(f"/api/v1/agents/{agent_id}/sessions/{session_id}/messages")
            assert response.status_code == 200
            _pass("Get agent messages")
        except Exception as exc:  # noqa: BLE001
            _fail("Get agent messages", str(exc))

    _log("")
    _log("Phase 9: Cleanup")
    if evaluation_task_id:
        try:
            response = DELETE(
                f"/api/v1/knowledge-bases/{kb_id}/evaluation/results/"
                f"{evaluation_task_id}"
            )
            assert response.status_code == 200
            _pass("Delete evaluation result")
        except Exception as exc:  # noqa: BLE001
            _llm_optional("Delete evaluation result", str(exc))

    if benchmark_id:
        try:
            response = DELETE(f"/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}")
            assert response.status_code == 200
            _pass("Delete benchmark")
        except Exception as exc:  # noqa: BLE001
            _fail("Delete benchmark", str(exc))

    if agent_id and session_id:
        try:
            response = DELETE(f"/api/v1/agents/{agent_id}/sessions/{session_id}")
            assert response.status_code == 200
            _pass("Delete agent session")
        except Exception as exc:  # noqa: BLE001
            _fail("Delete agent session", str(exc))

    if agent_id:
        try:
            response = DELETE(f"/api/v1/agents/{agent_id}")
            assert response.status_code == 200
            _pass("Delete agent")
        except Exception as exc:  # noqa: BLE001
            _fail("Delete agent", str(exc))

    if uploaded_file_ids or source_id:
        try:
            delete_ids = list(uploaded_file_ids)
            if source_id:
                delete_ids.append(source_id)
            response = POST(
                f"/api/v1/knowledge-bases/{kb_id}/files/delete",
                json_body={"file_ids": delete_ids},
            )
            assert response.status_code == 200
            _pass("Batch delete files")
        except Exception as exc:  # noqa: BLE001
            _fail("Batch delete files", str(exc))

    try:
        response = DELETE(f"/api/v1/knowledge-bases/{kb_id}")
        assert response.status_code == 200
        _pass("Delete KB")
    except Exception as exc:  # noqa: BLE001
        _fail("Delete KB", str(exc))

    try:
        response = GET("/api/v1/knowledge-bases")
        assert response.status_code == 200
        final = ok_data(response)
        assert isinstance(final, list)
        assert len(final) == state["baseline_count"], (
            f"Expected baseline {state['baseline_count']}, got {len(final)}"
        )
        _pass("KB count restored to baseline")
    except Exception as exc:  # noqa: BLE001
        _fail("KB count restored to baseline", str(exc))


def main() -> None:
    username = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("NANOBOT_USER", "admin")
    password = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("NANOBOT_PASS", "admin123")

    try:
        run_all(username, password)
    except Exception:  # noqa: BLE001
        _fail("UNEXPECTED", traceback.format_exc())
    finally:
        _write_report()

    _log("")
    _log("==============================================")
    _log(f"Results: {_passed} passed, {_failed} failed, {_skipped} skipped")
    _log("==============================================")
    _log("")

    if _errors:
        _log("Failed tests:")
        for err in _errors:
            _log(f"  - {err}")
        _log("")

    raise SystemExit(1 if _failed > 0 else 0)


if __name__ == "__main__":
    main()
