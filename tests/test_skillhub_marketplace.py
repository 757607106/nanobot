from __future__ import annotations

import zipfile
from io import BytesIO

from nanobot.services.skillhub_marketplace import SkillHubMarketplaceClient


def _make_skill_zip(entries: dict[str, str]) -> bytes:
    archive_buffer = BytesIO()
    with zipfile.ZipFile(archive_buffer, "w") as archive:
        for path, content in entries.items():
            archive.writestr(path, content)
    return archive_buffer.getvalue()


def test_skillhub_marketplace_native_skill_analysis() -> None:
    client = SkillHubMarketplaceClient()
    archive = _make_skill_zip(
        {
            "demo-skill/SKILL.md": """---
name: demo-skill
description: Native enough for nanobot
---

# Demo Skill
Use the normal skill instructions.
""",
        }
    )

    analysis = client._analyze_skill_archive("demo-skill", archive)

    assert analysis["compatibility"] == "native"
    assert analysis["compatibilityLabel"] == "原生可用"
    assert any("SKILL.md" in reason for reason in analysis["compatibilityReasons"])


def test_skillhub_marketplace_runtime_specific_skill_analysis() -> None:
    client = SkillHubMarketplaceClient()
    archive = _make_skill_zip(
        {
            "self-improving-agent/SKILL.md": """---
name: self-improvement
description: Runtime-specific skill
---

OpenClaw is the primary platform.
Run `openclaw hooks enable self-improvement`.
Requires sessions_list, sessions_history, sessions_send, and sessions_spawn.
""",
            "self-improving-agent/hooks/openclaw/post-run.sh": "#!/bin/sh\nexit 0\n",
        }
    )

    analysis = client._analyze_skill_archive("self-improving-agent", archive)

    assert analysis["compatibility"] == "unsupported"
    assert analysis["compatibilityLabel"] == "不建议安装"
    assert any("sessions_*" in reason for reason in analysis["compatibilityReasons"])
    assert any("hooks" in reason for reason in analysis["compatibilityReasons"])


def test_skillhub_marketplace_list_skills_enriches_results(monkeypatch) -> None:
    client = SkillHubMarketplaceClient()
    archive = _make_skill_zip(
        {
            "demo-skill/SKILL.md": """---
name: demo-skill
description: Native enough for nanobot
---
""",
        }
    )

    monkeypatch.setattr(
        client,
        "_load_index_skills",
        lambda: [
            {
                "id": "demo-skill",
                "slug": "demo-skill",
                "name": "demo-skill",
                "description": "Demo",
                "version": "1.0.0",
                "tags": ["demo"],
                "source": "skillhub",
                "homepage": None,
                "updatedAt": 1_770_000_000_000,
                "downloads": 3,
            }
        ],
    )
    monkeypatch.setattr(client, "_download_skill_archive", lambda slug: archive)

    listed = client.list_skills(limit=1)

    assert listed[0]["slug"] == "demo-skill"
    assert listed[0]["compatibility"] == "native"
    assert listed[0]["compatibilityReasons"]
