"""Tests for dashboard analytics queries in RunStore.

Focuses on:
- get_overview_metrics returns accurate runsByStatus and includes default agent
- get_all_agents_metrics includes agent_id='default' runs
- get_time_series_metrics includes all agents
- get_tool_usage_ranking aggregates correctly across agents
"""

from __future__ import annotations

from pathlib import Path

import pytest

from nanobot.platform.runs import (
    RunKind,
    RunResultSummary,
    RunService,
    RunStore,
)


def _build_service(tmp_path: Path, name: str = "analytics.db") -> RunService:
    return RunService(RunStore(tmp_path / name), instance_id="inst-analytics")


def _seed_runs(service: RunService) -> dict[str, str]:
    """Create a set of runs with mixed agents and statuses.

    Returns dict mapping descriptive keys to run_ids.
    """
    ids: dict[str, str] = {}

    # Succeeded custom agent run with full metrics
    r = service.create_run(
        kind=RunKind.AGENT,
        label="Custom Agent Run 1",
        task_preview="task 1",
        agent_id="my-agent",
    )
    service.start_run(r.run_id)
    service.complete_run(
        r.run_id,
        RunResultSummary(
            content="done",
            tools_used=["read_file", "web_search"],
            tools_call_counts={"read_file": 3, "web_search": 1},
        ),
        provider="openai",
        model="gpt-4",
        prompt_tokens=500,
        completion_tokens=100,
        total_tokens=600,
    )
    ids["custom_ok"] = r.run_id

    # Succeeded default agent run (fallback path) with minimal metrics
    r = service.create_run(
        kind=RunKind.AGENT,
        label="Default Agent Run",
        task_preview="fallback task",
        agent_id="default",
    )
    service.start_run(r.run_id)
    service.complete_run(
        r.run_id,
        RunResultSummary(content="fallback done"),
        provider="openai",
        model="gpt-4",
        prompt_tokens=200,
        completion_tokens=50,
        total_tokens=250,
    )
    ids["default_ok"] = r.run_id

    # Failed custom agent run
    r = service.create_run(
        kind=RunKind.AGENT,
        label="Custom Agent Run 2",
        task_preview="failing task",
        agent_id="my-agent",
    )
    service.start_run(r.run_id)
    service.fail_run(r.run_id, "MODEL_ERROR", "rate limited")
    ids["custom_fail"] = r.run_id

    # Timed-out run (no agent_id — NULL)
    r = service.create_run(
        kind=RunKind.AGENT,
        label="Orphan Run",
        task_preview="orphan",
    )
    service.start_run(r.run_id)
    service.timeout_run(r.run_id, "timed out")
    ids["orphan_timeout"] = r.run_id

    return ids


# -- get_overview_metrics --


class TestOverviewMetrics:
    def test_total_runs_includes_all_agents(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        overview = service.store.get_overview_metrics()

        assert overview["totalRuns"] == 4

    def test_active_agents_includes_default(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        overview = service.store.get_overview_metrics()

        # Should count 'my-agent' and 'default'; NULL agent_id is not counted by COUNT(DISTINCT)
        assert overview["activeAgents"] >= 2

    def test_runs_by_status_accurate(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        overview = service.store.get_overview_metrics()

        by_status = overview["runsByStatus"]
        assert by_status.get("succeeded", 0) == 2
        assert by_status.get("failed", 0) == 1
        assert by_status.get("timed_out", 0) == 1

    def test_token_sums_correct(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        overview = service.store.get_overview_metrics()

        # Only the two succeeded runs contribute tokens (500+200=700 prompt, 100+50=150 completion, 600+250=850 total)
        assert overview["promptTokens"] == 700
        assert overview["completionTokens"] == 150
        assert overview["totalTokens"] == 850

    def test_empty_store_returns_zeros(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        overview = service.store.get_overview_metrics()

        assert overview["totalRuns"] == 0
        assert overview["activeAgents"] == 0
        assert overview["runsByStatus"] == {}


# -- get_all_agents_metrics --


class TestAgentMetrics:
    def test_includes_default_agent(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        metrics = service.store.get_all_agents_metrics()

        assert "default" in metrics
        assert "my-agent" in metrics

    def test_custom_agent_tools_aggregated(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        metrics = service.store.get_all_agents_metrics()

        # my-agent had one succeeded run with tools, one failed (no tools_call_counts)
        agent = metrics["my-agent"]
        assert agent["tools"].get("read_file", 0) == 3
        assert agent["tools"].get("web_search", 0) == 1

    def test_default_agent_tokens_tracked(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        metrics = service.store.get_all_agents_metrics()

        default = metrics["default"]
        assert len(default["tokens"]) == 1
        assert default["tokens"][0]["totalTokens"] == 250

    def test_excludes_null_agent_id(self, tmp_path: Path) -> None:
        """Runs without an agent_id (NULL) are excluded from per-agent breakdown."""
        service = _build_service(tmp_path)
        _seed_runs(service)
        metrics = service.store.get_all_agents_metrics()

        # The orphan run has NULL agent_id
        for key in metrics:
            assert key != ""


# -- get_time_series_metrics --


class TestTimeSeriesMetrics:
    def test_includes_all_runs(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        series = service.store.get_time_series_metrics(bucket="day")

        total_run_count = sum(pt["runCount"] for pt in series)
        assert total_run_count == 4

    def test_groups_by_agent_and_model(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        series = service.store.get_time_series_metrics(bucket="day")

        agent_ids = {pt["agentId"] for pt in series}
        # Should include 'my-agent', 'default', and None
        assert "my-agent" in agent_ids
        assert "default" in agent_ids


# -- get_tool_usage_ranking --


class TestToolUsageRanking:
    def test_ranks_by_count(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        _seed_runs(service)
        ranking = service.store.get_tool_usage_ranking(limit=10)

        names = [r["tool"] for r in ranking]
        assert "read_file" in names
        assert "web_search" in names

        read_file_entry = next(r for r in ranking if r["tool"] == "read_file")
        assert read_file_entry["count"] == 3

    def test_empty_store_returns_empty(self, tmp_path: Path) -> None:
        service = _build_service(tmp_path)
        ranking = service.store.get_tool_usage_ranking()
        assert ranking == []
