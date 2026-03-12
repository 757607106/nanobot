from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from nanobot.config import loader as config_loader
from nanobot.config.loader import save_config
from nanobot.config.schema import Config
from nanobot.web.api import create_app


@pytest.fixture
def web_client(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    workspace = tmp_path / "workspace"
    config = Config()
    config.agents.defaults.workspace = str(workspace)
    save_config(config, config_path)
    monkeypatch.setattr(config_loader, "_current_config_path", config_path)

    app = create_app(config, static_dir=tmp_path / "missing-static")
    with TestClient(app) as client:
        yield client


def test_web_api_health_and_session_crud(web_client: TestClient) -> None:
    health = web_client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["data"] == {"status": "ok"}

    created = web_client.post("/api/v1/chat/sessions", json={"title": "Inbox"})
    assert created.status_code == 201
    session = created.json()["data"]
    assert session["title"] == "Inbox"

    listed = web_client.get("/api/v1/chat/sessions", params={"page": 1, "pageSize": 20})
    assert listed.status_code == 200
    assert listed.json()["data"]["items"][0]["id"] == session["id"]

    renamed = web_client.patch(f"/api/v1/chat/sessions/{session['id']}", json={"title": "Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["data"]["title"] == "Renamed"

    messages = web_client.get(f"/api/v1/chat/sessions/{session['id']}/messages")
    assert messages.status_code == 200
    assert messages.json()["data"] == []

    deleted = web_client.delete(f"/api/v1/chat/sessions/{session['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}


def test_web_api_cron_crud_and_run(web_client: TestClient) -> None:
    calls: list[str] = []

    async def fake_on_job(job) -> str:
        calls.append(job.id)
        return "ok"

    web_client.app.state.web.cron.on_job = fake_on_job

    created = web_client.post(
        "/api/v1/cron/jobs",
        json={
            "name": "workspace recap",
            "triggerType": "every",
            "triggerIntervalSeconds": 3600,
            "payloadMessage": "summarize the latest workspace changes",
        },
    )
    assert created.status_code == 201
    job = created.json()["data"]

    listed = web_client.get("/api/v1/cron/jobs", params={"includeDisabled": "true"})
    assert listed.status_code == 200
    assert listed.json()["data"]["jobs"][0]["id"] == job["id"]

    ran = web_client.post(f"/api/v1/cron/jobs/{job['id']}/run")
    assert ran.status_code == 200
    assert ran.json()["data"] == {"ran": True}
    assert calls == [job["id"]]

    updated = web_client.patch(
        f"/api/v1/cron/jobs/{job['id']}",
        json={
            "enabled": False,
            "name": "paused recap",
            "triggerType": "every",
            "triggerIntervalSeconds": 7200,
            "payloadMessage": "summarize the latest workspace changes",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["enabled"] is False
    assert updated.json()["data"]["name"] == "paused recap"

    deleted = web_client.delete(f"/api/v1/cron/jobs/{job['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}


def test_web_api_config_meta_uses_provider_registry(web_client: TestClient) -> None:
    config_meta = web_client.get("/api/v1/config/meta")
    assert config_meta.status_code == 200
    payload = config_meta.json()["data"]

    providers = payload["providers"]
    assert any(item["name"] == "openrouter" and item["category"] == "gateway" for item in providers)
    assert any(item["name"] == "ollama" and item["category"] == "local" for item in providers)
    assert any(item["name"] == "openai_codex" and item["category"] == "oauth" for item in providers)
    assert payload["resolvedProvider"] == "auto"


def test_web_api_unknown_route_uses_envelope(web_client: TestClient) -> None:
    response = web_client.post("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_web_api_calendar_crud_and_settings(web_client: TestClient) -> None:
    created = web_client.post(
        "/api/v1/calendar/events",
        json={
            "title": "Design review",
            "description": "Walk through the web migration",
            "start": "2026-03-13T09:00:00",
            "end": "2026-03-13T10:00:00",
            "isAllDay": False,
            "priority": "high",
            "reminders": [{"time": 15, "channel": "web", "target": "calendar-reminders"}],
        },
    )
    assert created.status_code == 201
    event = created.json()["data"]
    assert event["title"] == "Design review"
    assert event["priority"] == "high"
    assert event["reminders"][0]["time"] == 15

    listed = web_client.get(
        "/api/v1/calendar/events",
        params={"start": "2026-03-01T00:00:00", "end": "2026-03-31T23:59:59"},
    )
    assert listed.status_code == 200
    assert listed.json()["data"][0]["id"] == event["id"]

    updated = web_client.patch(
        f"/api/v1/calendar/events/{event['id']}",
        json={
            "title": "Updated review",
            "start": "2026-03-13T10:00:00",
            "end": "2026-03-13T11:00:00",
            "reminders": [{"time": 30, "channel": "web", "target": "calendar-reminders"}],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["title"] == "Updated review"
    assert updated.json()["data"]["reminders"][0]["time"] == 30

    settings = web_client.get("/api/v1/calendar/settings")
    assert settings.status_code == 200
    assert settings.json()["data"]["defaultView"] == "dayGridMonth"

    updated_settings = web_client.patch(
        "/api/v1/calendar/settings",
        json={
            "defaultView": "timeGridWeek",
            "defaultPriority": "low",
            "soundEnabled": False,
            "notificationEnabled": True,
        },
    )
    assert updated_settings.status_code == 200
    assert updated_settings.json()["data"]["defaultView"] == "timeGridWeek"
    assert updated_settings.json()["data"]["soundEnabled"] is False

    jobs = web_client.get("/api/v1/calendar/jobs")
    assert jobs.status_code == 200
    assert len(jobs.json()["data"]) == 1
    job = jobs.json()["data"][0]
    assert job["source"] == "calendar"

    ran = web_client.post(f"/api/v1/cron/jobs/{job['id']}/run")
    assert ran.status_code == 200
    assert ran.json()["data"] == {"ran": True}

    sessions = web_client.get("/api/v1/chat/sessions")
    assert sessions.status_code == 200
    reminder_session = next(
        item for item in sessions.json()["data"]["items"] if item["title"] == "Calendar Reminders"
    )
    messages = web_client.get(f"/api/v1/chat/sessions/{reminder_session['id']}/messages")
    assert messages.status_code == 200
    assert "Updated review" in messages.json()["data"][-1]["content"]

    deleted = web_client.delete(f"/api/v1/calendar/events/{event['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}

    jobs_after_delete = web_client.get("/api/v1/calendar/jobs")
    assert jobs_after_delete.status_code == 200
    assert jobs_after_delete.json()["data"] == []


def test_web_api_agent_templates_crud_import_export_and_skills(web_client: TestClient) -> None:
    listed = web_client.get("/api/v1/agent-templates")
    assert listed.status_code == 200
    templates = listed.json()["data"]
    assert any(item["name"] == "coder" for item in templates)
    assert any(item["is_builtin"] for item in templates)

    valid_tools = web_client.get("/api/v1/agent-templates/tools/valid")
    assert valid_tools.status_code == 200
    assert any(item["name"] == "read_file" for item in valid_tools.json()["data"])

    skills = web_client.get("/api/v1/skills/installed")
    assert skills.status_code == 200
    assert len(skills.json()["data"]) > 0

    created = web_client.post(
        "/api/v1/agent-templates",
        json={
            "name": "repo-reviewer",
            "description": "Review-oriented template",
            "tools": ["read_file", "list_dir", "web_search"],
            "rules": ["Check key files first", "Summarize findings clearly"],
            "system_prompt": "Review this repository for the assigned task: {task}",
            "skills": ["skill-creator"],
            "enabled": True,
        },
    )
    assert created.status_code == 201
    assert created.json()["data"] == {"name": "repo-reviewer", "success": True}

    fetched = web_client.get("/api/v1/agent-templates/repo-reviewer")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["name"] == "repo-reviewer"
    assert fetched.json()["data"]["skills"] == ["skill-creator"]

    updated = web_client.patch(
        "/api/v1/agent-templates/repo-reviewer",
        json={
            "description": "Updated review template",
            "tools": ["read_file", "write_file", "list_dir"],
            "rules": ["Read before editing", "Keep notes concise"],
            "system_prompt": "Updated prompt for {task}",
            "skills": [],
            "model": "deepseek/deepseek-chat",
            "enabled": False,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"] == {"name": "repo-reviewer", "success": True}

    fetched_after_update = web_client.get("/api/v1/agent-templates/repo-reviewer")
    assert fetched_after_update.status_code == 200
    assert fetched_after_update.json()["data"]["enabled"] is False
    assert fetched_after_update.json()["data"]["model"] == "deepseek/deepseek-chat"

    exported = web_client.post(
        "/api/v1/agent-templates/export",
        json={"names": ["repo-reviewer"]},
    )
    assert exported.status_code == 200
    export_content = exported.json()["data"]["content"]
    assert "repo-reviewer" in export_content
    assert "agents:" in export_content

    imported = web_client.post(
        "/api/v1/agent-templates/import",
        json={"content": export_content, "on_conflict": "rename"},
    )
    assert imported.status_code == 200
    imported_data = imported.json()["data"]
    assert imported_data["errors"] == []
    assert imported_data["imported"][0]["name"].startswith("repo-reviewer-")

    delete_builtin = web_client.delete("/api/v1/agent-templates/coder")
    assert delete_builtin.status_code == 400
    assert delete_builtin.json()["error"]["code"] == "AGENT_TEMPLATE_DELETE_FAILED"

    deleted = web_client.delete("/api/v1/agent-templates/repo-reviewer")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"name": "repo-reviewer", "success": True}

    reload = web_client.post("/api/v1/agent-templates/reload")
    assert reload.status_code == 200
    assert reload.json()["data"] == {"success": True}


def test_web_api_skill_upload_list_and_delete(web_client: TestClient) -> None:
    skill_md = b"""---
name: demo-skill
description: Demo uploaded skill
author: Test Suite
version: 0.1.0
tags: demo, test
---

# Demo Skill

Use this skill for demo testing.
"""
    helper_md = b"# Helper Notes\n\nSupport file for the uploaded skill.\n"

    uploaded = web_client.post(
        "/api/v1/skills/upload",
        data={
            "path": [
                "demo-skill/SKILL.md",
                "demo-skill/references/helper.md",
            ]
        },
        files=[
            ("file", ("SKILL.md", skill_md, "text/markdown")),
            ("file", ("helper.md", helper_md, "text/markdown")),
        ],
    )
    assert uploaded.status_code == 201
    uploaded_skill = uploaded.json()["data"]
    assert uploaded_skill["id"] == "demo-skill"
    assert uploaded_skill["source"] == "workspace"
    assert uploaded_skill["isDeletable"] is True
    assert uploaded_skill["version"] == "0.1.0"

    listed = web_client.get("/api/v1/skills/installed")
    assert listed.status_code == 200
    skills = listed.json()["data"]
    demo_skill = next(item for item in skills if item["id"] == "demo-skill")
    assert "demo" in demo_skill["tags"]
    assert demo_skill["author"] == "Test Suite"

    delete_builtin = web_client.delete("/api/v1/skills/skill-creator")
    assert delete_builtin.status_code == 400
    assert delete_builtin.json()["error"]["code"] == "SKILL_DELETE_FAILED"

    deleted = web_client.delete("/api/v1/skills/demo-skill")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}

    listed_after_delete = web_client.get("/api/v1/skills/installed")
    assert listed_after_delete.status_code == 200
    assert all(item["id"] != "demo-skill" for item in listed_after_delete.json()["data"])


def test_web_api_main_agent_prompt_management(web_client: TestClient) -> None:
    current = web_client.get("/api/v1/main-agent-prompt")
    assert current.status_code == 200
    assert "Agent Instructions" in current.json()["data"]["identity_content"]
    assert current.json()["data"]["source_path"].endswith("AGENTS.md")

    updated = web_client.put(
        "/api/v1/main-agent-prompt",
        json={"identity_content": "# Custom Prompt\n\nPrefer concise answers."},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["identity_content"].startswith("# Custom Prompt")
    assert updated.json()["data"]["updated_at"]

    after_update = web_client.get("/api/v1/main-agent-prompt")
    assert after_update.status_code == 200
    assert after_update.json()["data"]["identity_content"] == "# Custom Prompt\n\nPrefer concise answers."

    reset = web_client.post("/api/v1/main-agent-prompt/reset")
    assert reset.status_code == 200
    assert reset.json()["data"] == {"success": True}

    after_reset = web_client.get("/api/v1/main-agent-prompt")
    assert after_reset.status_code == 200
    assert "Agent Instructions" in after_reset.json()["data"]["identity_content"]
