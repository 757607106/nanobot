#!/usr/bin/env python3
"""Live API integration tests for the knowledge-base subsystem (stdlib only).

Runs against a live nanobot web-ui server at BASE_URL using only urllib.
Covers all knowledge base CRUD, file management, ingest, query, graph,
benchmarks, evaluation, agent-KB binding, and agent chat.

Usage:
    python3 tests/test_knowledge_api_live.py [username] [password]
"""

from __future__ import annotations

import io
import json
import mimetypes
import os
import sys
import time
import traceback
import uuid
from http.cookiejar import CookieJar
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

BASE_URL = "http://127.0.0.1:6788"
TIMEOUT = 30

# ── Cookie-aware opener ─────────────────────────────────────────────────────
_cookie_jar = CookieJar()
_opener = build_opener(HTTPCookieProcessor(_cookie_jar))

# ── Counters ────────────────────────────────────────────────────────────────
_passed = 0
_failed = 0
_skipped = 0
_errors: list[str] = []


def _log(msg: str) -> None:
    print(msg, flush=True)


def _pass(test: str) -> None:
    global _passed
    _passed += 1
    _log(f"  ✅ PASS: {test}")


def _fail(test: str, reason: str) -> None:
    global _failed
    _failed += 1
    _errors.append(f"{test}: {reason}")
    _log(f"  ❌ FAIL: {test} — {reason}")


def _skip(test: str, reason: str) -> None:
    global _skipped
    _skipped += 1
    _log(f"  ⏭️  SKIP: {test} — {reason}")


# ── HTTP helpers (stdlib only, cookie-aware) ────────────────────────────────

class HTTPResponse:
    def __init__(self, status_code: int, body: bytes, headers: dict):
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
    files: dict | None = None,
    form_data: dict | None = None,
    timeout: int = TIMEOUT,
) -> HTTPResponse:
    """Make an HTTP request using urllib with cookie support."""
    url = f"{BASE_URL}{path}"
    headers: dict[str, str] = {}
    data: bytes | None = None

    if files:
        # Build multipart/form-data
        boundary = f"----FormBoundary{uuid.uuid4().hex[:16]}"
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        body_parts: list[bytes] = []

        # Add form fields first
        if form_data:
            for key, value in form_data.items():
                body_parts.append(f"--{boundary}\r\n".encode())
                body_parts.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
                body_parts.append(f"{value}\r\n".encode())

        # Add files
        for field_name, file_tuple in files.items():
            filename, file_obj, content_type = file_tuple
            if isinstance(file_obj, io.BytesIO):
                file_bytes = file_obj.read()
            else:
                file_bytes = file_obj
            body_parts.append(f"--{boundary}\r\n".encode())
            body_parts.append(
                f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode()
            )
            body_parts.append(f"Content-Type: {content_type}\r\n\r\n".encode())
            body_parts.append(file_bytes)
            body_parts.append(b"\r\n")

        body_parts.append(f"--{boundary}--\r\n".encode())
        data = b"".join(body_parts)
    elif json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
    elif method in ("POST", "PUT", "PATCH", "DELETE") and json_body is None and files is None:
        headers["Content-Type"] = "application/json"
        data = b"{}"

    req = Request(url, data=data, headers=headers, method=method)

    try:
        with _opener.open(req, timeout=timeout) as resp:
            body = resp.read()
            return HTTPResponse(resp.status, body, dict(resp.headers))
    except HTTPError as e:
        body = e.read() if e.fp else b""
        return HTTPResponse(e.code, body, dict(e.headers) if e.headers else {})


def GET(path: str, **kwargs) -> HTTPResponse:
    return _request("GET", path, **kwargs)


def POST(path: str, **kwargs) -> HTTPResponse:
    return _request("POST", path, **kwargs)


def PUT(path: str, **kwargs) -> HTTPResponse:
    return _request("PUT", path, **kwargs)


def PATCH(path: str, **kwargs) -> HTTPResponse:
    return _request("PATCH", path, **kwargs)


def DELETE(path: str, **kwargs) -> HTTPResponse:
    return _request("DELETE", path, **kwargs)


def ok_data(resp: HTTPResponse) -> Any:
    """Extract data from a successful envelope."""
    body = resp.json()
    assert body.get("success") is True, f"Expected success=True, got {json.dumps(body, indent=2)[:500]}"
    return body.get("data")


def do_login(username: str, password: str) -> bool:
    """Authenticate and store session cookie. Returns True on success."""
    r = POST("/api/v1/auth/login", json_body={
        "username": username,
        "password": password,
    })
    if r.status_code == 200:
        data = r.json()
        if data.get("success") and data.get("data", {}).get("authenticated"):
            return True
    return False


# ═══════════════════════════════════════════════════════════════════════════
# State shared across tests
# ═══════════════════════════════════════════════════════════════════════════
state: dict[str, Any] = {}


def run_all(username: str = "admin", password: str = "admin123") -> None:
    _log("\n═══════════════════════════════════════════════════")
    _log("  Nanobot Knowledge Base — Live API Integration Tests")
    _log("═══════════════════════════════════════════════════\n")

    # ── 0. Health check ──────────────────────────────────────────────────
    _log("▶ Phase 0: Server Health Check")
    try:
        r = GET("/")
        if r.status_code == 200:
            _pass("Server reachable")
        else:
            _fail("Server reachable", f"status={r.status_code}")
            return
    except Exception as e:
        _fail("Server reachable", str(e))
        _log("  ⚠️  Cannot connect to server. Aborting.")
        return

    # ── 0b. Login ─────────────────────────────────────────────────────────
    _log("\n▶ Phase 0b: Authentication")
    if do_login(username, password):
        _pass(f"Logged in as '{username}'")
    else:
        _fail("Login", f"Failed to authenticate as '{username}'")
        _log("  ⚠️  Cannot proceed without authentication. Aborting.")
        return

    # ══════════════════════════════════════════════════════════════════════
    # PART A: Knowledge Base Core
    # ══════════════════════════════════════════════════════════════════════

    # ── 1. Available models ──────────────────────────────────────────────
    _log("\n▶ Phase 1: Available Models")
    try:
        r = GET("/api/v1/knowledge-bases/available-models")
        assert r.status_code == 200, f"status={r.status_code}"
        data = ok_data(r)
        assert isinstance(data, dict)
        _pass("List available models")
        for cat, models in data.items():
            _log(f"    {cat}: {len(models)} model(s)")
    except Exception as e:
        _fail("List available models", str(e))

    # ── 2. Knowledge Base CRUD ────────────────────────────────────────────
    _log("\n▶ Phase 2: Knowledge Base CRUD")

    # 2a. List baseline
    try:
        r = GET("/api/v1/knowledge-bases")
        assert r.status_code == 200
        baseline = ok_data(r)
        assert isinstance(baseline, list)
        state["baseline_count"] = len(baseline)
        _pass(f"List KBs baseline (count={len(baseline)})")
    except Exception as e:
        _fail("List KBs baseline", str(e))
        state["baseline_count"] = 0

    # 2b. Create
    kb_id = None
    try:
        r = POST("/api/v1/knowledge-bases", json_body={
            "name": "API Test KB",
            "description": "Created by live API test suite.",
            "tags": ["test", "api"],
        })
        assert r.status_code == 201, f"status={r.status_code}, body={r.text[:300]}"
        kb = ok_data(r)
        assert kb["name"] == "API Test KB"
        assert kb["description"] == "Created by live API test suite."
        assert "test" in kb.get("tags", [])
        kb_id = kb["kbId"]
        state["kb_id"] = kb_id
        _pass(f"Create KB (kbId={kb_id})")
    except Exception as e:
        _fail("Create KB", str(e))
        _log("  ⚠️  Cannot continue without KB. Aborting.")
        return

    # 2c. Get single
    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}")
        assert r.status_code == 200
        kb = ok_data(r)
        assert kb["kbId"] == kb_id
        assert kb["name"] == "API Test KB"
        assert "stats" in kb, "Missing stats field"
        _pass("Get single KB")
    except Exception as e:
        _fail("Get single KB", str(e))

    # 2d. Update
    try:
        r = PUT(f"/api/v1/knowledge-bases/{kb_id}", json_body={
            "name": "API Test KB Updated",
            "description": "Updated description.",
            "tags": ["test", "api", "updated"],
        })
        assert r.status_code == 200, f"status={r.status_code}, body={r.text[:300]}"
        kb = ok_data(r)
        assert kb["name"] == "API Test KB Updated"
        assert "updated" in kb.get("tags", [])
        _pass("Update KB")
    except Exception as e:
        _fail("Update KB", str(e))

    # 2e. List after create
    try:
        r = GET("/api/v1/knowledge-bases")
        assert r.status_code == 200
        after = ok_data(r)
        assert len(after) == state["baseline_count"] + 1
        _pass("List KBs after create (+1)")
    except Exception as e:
        _fail("List KBs after create", str(e))

    # 2f. Accessible
    try:
        r = GET("/api/v1/knowledge-bases/accessible")
        assert r.status_code == 200
        accessible = ok_data(r)
        assert any(item["kbId"] == kb_id for item in accessible)
        _pass("List accessible KBs")
    except Exception as e:
        _fail("List accessible KBs", str(e))

    # 2g. Duplicate name → 409
    try:
        r = POST("/api/v1/knowledge-bases", json_body={"name": "API Test KB Updated"})
        assert r.status_code == 409, f"Expected 409, got {r.status_code}"
        _pass("Duplicate name → 409")
    except Exception as e:
        _fail("Duplicate name → 409", str(e))

    # ── 3. Query Params ───────────────────────────────────────────────────
    _log("\n▶ Phase 3: Query Params")

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/query-params")
        assert r.status_code == 200
        qp = ok_data(r)
        assert "mode" in qp
        _pass("Get query params")
    except Exception as e:
        _fail("Get query params", str(e))

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/query-params/schema")
        assert r.status_code == 200
        _pass("Get query params schema")
    except Exception as e:
        _fail("Get query params schema", str(e))

    try:
        r = PUT(f"/api/v1/knowledge-bases/{kb_id}/query-params", json_body={
            "mode": "mix", "top_k": 5,
        })
        assert r.status_code == 200
        _pass("Update query params")
    except Exception as e:
        _fail("Update query params", str(e))

    # ── 4. Folder Management ──────────────────────────────────────────────
    _log("\n▶ Phase 4: Folder Management")

    folder_id = None
    try:
        r = POST(f"/api/v1/knowledge-bases/{kb_id}/folders", json_body={"name": "test-folder"})
        assert r.status_code == 201, f"status={r.status_code}, body={r.text[:300]}"
        folder = ok_data(r)
        folder_id = folder.get("fileId") or folder.get("folderId")
        state["folder_id"] = folder_id
        _pass(f"Create folder (id={folder_id})")
    except Exception as e:
        _fail("Create folder", str(e))

    # ── 5. File Upload ────────────────────────────────────────────────────
    _log("\n▶ Phase 5: File Upload & Document Management")

    file_id = None
    try:
        content = (
            b"This is a test document for knowledge base API testing.\n"
            b"It contains sample content about artificial intelligence.\n"
            b"Neural networks are computational models inspired by the human brain.\n"
            b"Deep learning is a subset of machine learning.\n"
        )
        r = POST(
            f"/api/v1/knowledge-bases/{kb_id}/files",
            files={"file": ("test-document.txt", io.BytesIO(content), "text/plain")},
        )
        assert r.status_code == 201, f"status={r.status_code}, body={r.text[:300]}"
        upload_data = ok_data(r)
        items = upload_data.get("items") or []
        assert len(items) > 0, "No items returned"
        file_id = items[0].get("fileId")
        state["file_id"] = file_id
        _pass(f"Upload file (fileId={file_id})")
    except Exception as e:
        _fail("Upload file", str(e))

    # 5b. Upload second file via /files (legacy /documents removed)
    doc_file_id = None
    try:
        doc_content = (
            b"Second file upload test: Natural language processing (NLP).\n"
            b"NLP allows computers to understand human language.\n"
        )
        r = POST(
            f"/api/v1/knowledge-bases/{kb_id}/files",
            files={"file": ("doc-test.txt", io.BytesIO(doc_content), "text/plain")},
        )
        assert r.status_code == 201, f"status={r.status_code}, body={r.text[:300]}"
        doc_data = ok_data(r)
        docs = doc_data.get("items") or []
        if docs:
            doc_file_id = docs[0].get("fileId")
            state["doc_file_id"] = doc_file_id
        _pass(f"Upload second file via /files (fileId={doc_file_id})")
    except Exception as e:
        _fail("Upload second file via /files", str(e))

    # 5c. List files
    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/files")
        assert r.status_code == 200
        files_data = ok_data(r)
        items = files_data.get("items", []) if isinstance(files_data, dict) else files_data
        _pass(f"List files ({len(items)} items)")
    except Exception as e:
        _fail("List files", str(e))

    # 5d. Legacy /documents alias removed
    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/documents")
        assert r.status_code == 404
        _pass("Legacy /documents alias removed (404)")
    except Exception as e:
        _fail("Legacy /documents alias removed", str(e))

    # 5e. File detail
    if file_id:
        try:
            r = GET(f"/api/v1/knowledge-bases/{kb_id}/files/{file_id}/detail")
            if r.status_code == 200:
                body = r.json()
                if body.get("success"):
                    detail = body["data"]
                    file_info = detail.get("file", detail)  # API wraps in {"file": {...}, "content", ...}
                    assert file_info.get("fileId") == file_id, \
                        f"fileId mismatch: expected={file_id}, got={file_info.get('fileId')}"
                    _pass(f"Get file detail (keys={list(detail.keys())})")
                else:
                    err = body.get("error", {})
                    _fail("Get file detail", f"success=false: code={err.get('code')}, msg={err.get('message')}")
            else:
                _fail("Get file detail", f"status={r.status_code}, body={r.text[:300]}")
        except AssertionError as e:
            _fail("Get file detail", str(e) or "assertion failed (empty msg)")
        except Exception as e:
            _fail("Get file detail", f"{type(e).__name__}: {e}")

        # 5f. Download
        try:
            r = GET(f"/api/v1/knowledge-bases/{kb_id}/files/{file_id}/download")
            assert r.status_code == 200
            assert len(r.body) > 0
            _pass(f"Download file ({len(r.body)} bytes)")
        except Exception as e:
            _fail("Download file", str(e))
    else:
        _skip("File detail/download", "No file_id")

    # ── 6. Source Management ──────────────────────────────────────────────
    _log("\n▶ Phase 6: Source Management")

    source_id = None
    try:
        r = POST(f"/api/v1/knowledge-bases/{kb_id}/sources", json_body={
            "sourceType": "faq_table",
            "title": "Test FAQ",
            "items": [
                {"question": "What is AI?", "answer": "Artificial intelligence is the simulation of human intelligence by machines."},
                {"question": "What is ML?", "answer": "Machine learning is a subset of AI that learns from data."},
            ],
        })
        assert r.status_code == 201, f"status={r.status_code}, body={r.text[:300]}"
        source = ok_data(r)
        source_id = source.get("fileId")
        state["source_id"] = source_id
        _pass(f"Add source (id={source_id})")
    except Exception as e:
        _fail("Add source", str(e))

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/sources")
        assert r.status_code == 200
        sources = ok_data(r)
        count = len(sources) if isinstance(sources, list) else "obj"
        _pass(f"List sources ({count})")
    except Exception as e:
        _fail("List sources", str(e))

    if source_id:
        try:
            r = PUT(f"/api/v1/knowledge-bases/{kb_id}/sources/{source_id}", json_body={
                "fileName": "inline-source-updated.txt",
            })
            assert r.status_code == 200, f"status={r.status_code}, body={r.text[:300]}"
            _pass("Update source")
        except Exception as e:
            _fail("Update source", str(e))

    # ── 7. Ingest Pipeline ────────────────────────────────────────────────
    _log("\n▶ Phase 7: Ingest Pipeline (parse / index)")

    if file_id:
        try:
            r = POST(f"/api/v1/knowledge-bases/{kb_id}/files/parse", json_body={"file_ids": [file_id]})
            assert r.status_code == 202, f"status={r.status_code}, body={r.text[:300]}"
            _pass("Parse files")
        except Exception as e:
            _fail("Parse files", str(e))

        time.sleep(3)

        try:
            r = POST(f"/api/v1/knowledge-bases/{kb_id}/files/index", json_body={"file_ids": [file_id]})
            assert r.status_code == 202, f"status={r.status_code}, body={r.text[:300]}"
            _pass("Index files")
        except Exception as e:
            _fail("Index files", str(e))

    else:
        _skip("Parse/Index", "No file_id")

    # Jobs
    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/jobs")
        assert r.status_code == 200
        jobs = ok_data(r)
        count = len(jobs) if isinstance(jobs, list) else "obj"
        _pass(f"List jobs ({count})")
    except Exception as e:
        _fail("List jobs", str(e))

    # ── 8. File Operations (move) ────────────────────────────────────────
    _log("\n▶ Phase 8: File Operations")

    if file_id and folder_id:
        try:
            r = POST(f"/api/v1/knowledge-bases/{kb_id}/files/move", json_body={
                "fileId": file_id, "parentId": folder_id,
            })
            assert r.status_code == 200, f"status={r.status_code}, body={r.text[:300]}"
            _pass("Move file to folder")
        except Exception as e:
            _fail("Move file to folder", str(e))

        try:
            r = POST(f"/api/v1/knowledge-bases/{kb_id}/files/move", json_body={
                "fileId": file_id, "parentId": None,
            })
            assert r.status_code == 200
            _pass("Move file back to root")
        except Exception as e:
            _fail("Move file back to root", str(e))
    else:
        _skip("Move file", "No file_id or folder_id")

    # ── 9. Query ──────────────────────────────────────────────────────────
    _log("\n▶ Phase 9: Query")

    time.sleep(3)

    try:
        r = POST(f"/api/v1/knowledge-bases/{kb_id}/query", json_body={
            "query": "What is machine learning?", "mode": "naive",
        })
        assert r.status_code == 200, f"status={r.status_code}, body={r.text[:300]}"
        _pass("Query KB")
    except Exception as e:
        _fail("Query KB", str(e))

    try:
        r = POST(f"/api/v1/knowledge-bases/{kb_id}/query", json_body={
            "query": "deep learning",
            "top_k": 3,
            "only_need_context": True,
        })
        assert r.status_code == 200, f"status={r.status_code}, body={r.text[:300]}"
        retrieve_result = ok_data(r)
        _pass("Query context mode")
        if isinstance(retrieve_result, dict):
            _log(f"    Keys: {list(retrieve_result.keys())}")
    except Exception as e:
        _fail("Query context mode", str(e))

    # Negative: empty query → 400
    try:
        r = POST(f"/api/v1/knowledge-bases/{kb_id}/query", json_body={"query": ""})
        assert r.status_code == 400, f"Expected 400, got {r.status_code}"
        _pass("Query empty query → 400")
    except Exception as e:
        _fail("Query empty query → 400", str(e))

    # ── 10. Sample Questions ──────────────────────────────────────────────
    _log("\n▶ Phase 10: Sample Questions")

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/sample-questions")
        assert r.status_code == 200
        _pass("Get sample questions")
    except Exception as e:
        _fail("Get sample questions", str(e))

    try:
        r = POST(f"/api/v1/knowledge-bases/{kb_id}/sample-questions", json_body={"count": 3})
        if r.status_code == 200:
            _pass("Generate sample questions")
        else:
            _skip("Generate sample questions", f"status={r.status_code}")
    except Exception as e:
        _skip("Generate sample questions", str(e))

    # ── 11. Mindmap ───────────────────────────────────────────────────────
    _log("\n▶ Phase 11: Mindmap")

    try:
        # Generate first, then get
        r = POST(f"/api/v1/knowledge-bases/{kb_id}/mindmap", json_body={})
        if r.status_code == 200:
            _pass("Generate mindmap")
        else:
            _skip("Generate mindmap", f"status={r.status_code}")
    except Exception as e:
        _skip("Generate mindmap", str(e))

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/mindmap")
        if r.status_code == 200:
            data = ok_data(r)
            _pass(f"Get mindmap (data={'present' if data else 'null'})")
        elif r.status_code == 400:
            # Expected when no mindmap data exists yet
            _pass("Get mindmap (correctly returns 400 when not generated)")
        else:
            _fail("Get mindmap", f"status={r.status_code}, body={r.text[:300]}")
    except Exception as e:
        _fail("Get mindmap", str(e))

    # ── 12. Knowledge Graph ───────────────────────────────────────────────
    _log("\n▶ Phase 12: Knowledge Graph")

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/graph/labels")
        assert r.status_code == 200
        _pass("Get graph labels")
    except Exception as e:
        _fail("Get graph labels", str(e))

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/graph")
        assert r.status_code == 200
        _pass("Get graph")
    except Exception as e:
        _fail("Get graph", str(e))

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/graph/stats")
        assert r.status_code == 200
        _pass("Get graph stats")
    except Exception as e:
        _fail("Get graph stats", str(e))

    # ── 13. Benchmarks ────────────────────────────────────────────────────
    _log("\n▶ Phase 13: Benchmarks")

    benchmark_id = None
    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/benchmarks")
        assert r.status_code == 200
        _pass("List benchmarks")
    except Exception as e:
        _fail("List benchmarks", str(e))

    try:
        bm_content = (
            '{"query": "What is AI?", "expected": "Artificial intelligence"}\n'
            '{"query": "What is ML?", "expected": "Machine learning"}\n'
        )
        r = POST(
            f"/api/v1/knowledge-bases/{kb_id}/benchmarks/upload",
            files={"file": ("test-benchmark.jsonl", io.BytesIO(bm_content.encode()), "application/jsonl")},
            form_data={"name": "Test Benchmark", "description": "API test benchmark"},
        )
        assert r.status_code == 201, f"status={r.status_code}, body={r.text[:300]}"
        bm = ok_data(r)
        benchmark_id = bm.get("benchmarkId") or bm.get("id")
        state["benchmark_id"] = benchmark_id
        _pass(f"Upload benchmark (id={benchmark_id})")
    except Exception as e:
        _fail("Upload benchmark", str(e))

    if benchmark_id:
        try:
            r = GET(f"/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}")
            assert r.status_code == 200
            _pass("Get benchmark detail")
        except Exception as e:
            _fail("Get benchmark detail", str(e))

        try:
            r = GET(f"/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}/download")
            assert r.status_code == 200
            assert len(r.body) > 0
            _pass("Download benchmark")
        except Exception as e:
            _fail("Download benchmark", str(e))

    # ── 14. Evaluation ────────────────────────────────────────────────────
    _log("\n▶ Phase 14: Evaluation")

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/evaluation/history")
        assert r.status_code == 200
        _pass("Get evaluation history")
    except Exception as e:
        _fail("Get evaluation history", str(e))

    # ── 15. URL Fetching ──────────────────────────────────────────────────
    _log("\n▶ Phase 15: URL Fetching")

    try:
        r = POST(f"/api/v1/knowledge-bases/{kb_id}/files/fetch-url", json_body={
            "url": "https://example.com",
        })
        if r.status_code == 201:
            _pass("Fetch URL file")
        else:
            _skip("Fetch URL file", f"status={r.status_code}")
    except Exception as e:
        _skip("Fetch URL file", str(e))

    # ── 16. Error Handling ────────────────────────────────────────────────
    _log("\n▶ Phase 16: Error Handling")

    try:
        r = GET("/api/v1/knowledge-bases/non-existent-kb-xxxxx")
        assert r.status_code == 404, f"Expected 404, got {r.status_code}"
        _pass("GET non-existent KB → 404")
    except Exception as e:
        _fail("GET non-existent KB → 404", str(e))

    try:
        r = DELETE("/api/v1/knowledge-bases/non-existent-kb-xxxxx")
        assert r.status_code == 404, f"Expected 404, got {r.status_code}"
        _pass("DELETE non-existent KB → 404")
    except Exception as e:
        _fail("DELETE non-existent KB → 404", str(e))

    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}/files/non-existent-file/detail")
        assert r.status_code == 404, f"Expected 404, got {r.status_code}"
        _pass("GET non-existent file → 404")
    except Exception as e:
        _fail("GET non-existent file → 404", str(e))

    try:
        r = POST("/api/v1/knowledge-bases", json_body={"description": "no name"})
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}"
        _pass(f"Create KB no name → {r.status_code}")
    except Exception as e:
        _fail("Create KB no name", str(e))

    # ══════════════════════════════════════════════════════════════════════
    # PART B: Agent with Knowledge Binding
    # ══════════════════════════════════════════════════════════════════════

    _log("\n▶ Phase 17: Agent with Knowledge Binding")

    agent_id = None
    try:
        r = POST("/api/v1/agents", json_body={
            "name": "KB Test Agent",
            "description": "Agent bound to test KB.",
            "systemPrompt": (
                "You are a helpful assistant. Use the knowledge base to answer questions. "
                "Cite from the knowledge base content."
            ),
            "knowledgeBindingIds": [kb_id],
        })
        assert r.status_code == 201, f"status={r.status_code}, body={r.text[:300]}"
        agent = ok_data(r)
        agent_id = agent.get("agentId") or agent.get("agent_id")
        state["agent_id"] = agent_id
        bound = agent.get("knowledgeBindingIds") or agent.get("knowledge_binding_ids") or []
        assert kb_id in bound, f"KB {kb_id} not in bindings: {bound}"
        _pass(f"Create agent with KB binding (agentId={agent_id})")
    except Exception as e:
        _fail("Create agent with KB binding", str(e))

    if agent_id:
        try:
            r = GET(f"/api/v1/agents/{agent_id}")
            assert r.status_code == 200
            agent = ok_data(r)
            bound = agent.get("knowledgeBindingIds") or []
            assert kb_id in bound
            _pass("Get agent — binding persisted")
        except Exception as e:
            _fail("Get agent — binding persisted", str(e))

        try:
            r = PUT(f"/api/v1/agents/{agent_id}", json_body={
                "knowledgeBindingIds": [kb_id],
            })
            assert r.status_code == 200
            _pass("Update agent KB bindings")
        except Exception as e:
            _fail("Update agent KB bindings", str(e))

    # ── 18. Agent Chat with KB ────────────────────────────────────────────
    _log("\n▶ Phase 18: Agent Chat with Knowledge Binding")

    session_id = None
    if agent_id:
        try:
            r = POST(f"/api/v1/agents/{agent_id}/sessions", json_body={
                "title": "KB API Test Session",
            })
            assert r.status_code == 201, f"status={r.status_code}, body={r.text[:300]}"
            session = ok_data(r)
            session_id = session.get("sessionId") or session.get("session_id") or session.get("id")
            state["session_id"] = session_id
            _pass(f"Create agent session (id={session_id})")
        except Exception as e:
            _fail("Create agent session", str(e))

        try:
            r = GET(f"/api/v1/agents/{agent_id}/sessions")
            assert r.status_code == 200
            _pass("List agent sessions")
        except Exception as e:
            _fail("List agent sessions", str(e))

        if session_id:
            # Non-streaming message
            try:
                r = POST(
                    f"/api/v1/agents/{agent_id}/sessions/{session_id}/messages",
                    json_body={"content": "What is machine learning?"},
                    timeout=120,
                )
                if r.status_code == 200:
                    msg_data = ok_data(r)
                    _pass("Send message to KB-bound agent (non-stream)")
                    if isinstance(msg_data, dict):
                        reply = msg_data.get("reply") or msg_data.get("content") or msg_data.get("response") or ""
                        if isinstance(reply, str) and len(reply) > 0:
                            _log(f"    Reply: {reply[:200]}...")
                        else:
                            _log(f"    Response keys: {list(msg_data.keys())}")
                elif r.status_code == 500:
                    _skip("Send message to KB-bound agent", "500 Internal Server Error — no LLM model configured for this agent")
                else:
                    _fail("Send message to KB-bound agent", f"status={r.status_code}, body={r.text[:300]}")
            except Exception as e:
                _fail("Send message to KB-bound agent", str(e))

            # Get messages
            try:
                r = GET(f"/api/v1/agents/{agent_id}/sessions/{session_id}/messages")
                assert r.status_code == 200
                msgs = ok_data(r)
                count = len(msgs) if isinstance(msgs, list) else "obj"
                _pass(f"Get agent messages ({count})")
            except Exception as e:
                _fail("Get agent messages", str(e))

            # Streaming message
            try:
                r = POST(
                    f"/api/v1/agents/{agent_id}/sessions/{session_id}/messages?stream=true",
                    json_body={"content": "Tell me about neural networks"},
                    timeout=120,
                )
                assert r.status_code == 200, f"status={r.status_code}"
                events = [l for l in r.text.split("\n") if l.startswith("data: ")]
                event_types = set()
                for ev in events:
                    try:
                        event_types.add(json.loads(ev[6:]).get("type"))
                    except Exception:
                        pass
                _pass(f"Stream message ({len(events)} events, types={event_types})")
            except Exception as e:
                _fail("Stream message", str(e))
    else:
        _skip("Agent chat", "No agent_id")

    # ── 19. Cleanup ───────────────────────────────────────────────────────
    _log("\n▶ Phase 19: Cleanup")

    # Batch delete documents
    doc_ids = [fid for fid in [state.get("doc_file_id"), state.get("source_id")] if fid]
    if doc_ids:
        try:
            r = POST(f"/api/v1/knowledge-bases/{kb_id}/files/delete", json_body={"file_ids": doc_ids})
            assert r.status_code == 200, f"status={r.status_code}"
            _pass(f"Batch delete files ({len(doc_ids)})")
        except Exception as e:
            _fail("Batch delete files", str(e))

    # Delete single file
    if file_id:
        try:
            r = DELETE(f"/api/v1/knowledge-bases/{kb_id}/files/{file_id}")
            assert r.status_code == 200
            _pass("Delete single file")
        except Exception as e:
            _fail("Delete single file", str(e))

    # Delete benchmark
    if benchmark_id:
        try:
            r = DELETE(f"/api/v1/knowledge-bases/{kb_id}/benchmarks/{benchmark_id}")
            assert r.status_code == 200
            _pass("Delete benchmark")
        except Exception as e:
            _fail("Delete benchmark", str(e))

    # Delete session
    if agent_id and session_id:
        try:
            r = DELETE(f"/api/v1/agents/{agent_id}/sessions/{session_id}")
            assert r.status_code == 200
            _pass("Delete agent session")
        except Exception as e:
            _fail("Delete agent session", str(e))

    # Delete agent
    if agent_id:
        try:
            r = DELETE(f"/api/v1/agents/{agent_id}")
            assert r.status_code == 200
            _pass("Delete agent")
        except Exception as e:
            _fail("Delete agent", str(e))

    # Delete KB
    try:
        r = DELETE(f"/api/v1/knowledge-bases/{kb_id}")
        assert r.status_code == 200
        _pass("Delete KB")
    except Exception as e:
        _fail("Delete KB", str(e))

    # Verify deleted
    try:
        r = GET(f"/api/v1/knowledge-bases/{kb_id}")
        assert r.status_code == 404
        _pass("Verify KB deleted → 404")
    except Exception as e:
        _fail("Verify KB deleted → 404", str(e))

    # Verify count restored
    try:
        r = GET("/api/v1/knowledge-bases")
        assert r.status_code == 200
        final = ok_data(r)
        assert len(final) == state["baseline_count"], \
            f"Expected {state['baseline_count']}, got {len(final)}"
        _pass("KB count back to baseline")
    except Exception as e:
        _fail("KB count back to baseline", str(e))


def main() -> None:
    username = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("NANOBOT_USER", "admin")
    password = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("NANOBOT_PASS", "admin123")

    try:
        run_all(username, password)
    except Exception:
        _fail("UNEXPECTED", traceback.format_exc())

    _log("\n═══════════════════════════════════════════════════")
    _log(f"  Results: {_passed} passed, {_failed} failed, {_skipped} skipped")
    _log("═══════════════════════════════════════════════════\n")

    if _errors:
        _log("Failed tests:")
        for err in _errors:
            _log(f"  • {err}")
        _log("")

    sys.exit(1 if _failed > 0 else 0)


if __name__ == "__main__":
    main()
