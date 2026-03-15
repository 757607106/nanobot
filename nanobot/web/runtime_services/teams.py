"""Team-definition runtime helpers for test runs and LangGraph-based team orchestration."""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

from nanobot.platform.teams import TeamDefinitionNotFoundError
from nanobot.platform.runs import RunControlScope, RunKind, RunResultSummary
from nanobot.web.runtime_services.langgraph_supervisor import LangGraphTeamRunner


class WebTeamRuntimeService:
    """Runtime helpers for team definitions inside the collaboration domain."""

    def __init__(self, state):
        self.state = state
        self._active_tasks: dict[str, asyncio.Task[None]] = {}

    @staticmethod
    def _root_session_key(team_id: str, run_id: str) -> str:
        return f"team-test:{team_id}:{run_id}"

    @staticmethod
    def _child_session_key(team_id: str, root_run_id: str, role: str, agent_id: str) -> str:
        return f"team-test:{team_id}:{root_run_id}:{role}:{agent_id}"

    @staticmethod
    def _child_session_id(team_id: str, root_run_id: str, role: str, agent_id: str) -> str:
        return f"team-test:{team_id}:{root_run_id}:{role}:{agent_id}"

    @staticmethod
    def _team_thread_id(team_id: str) -> str:
        return f"team-thread:{team_id}"

    @classmethod
    def _team_thread_session_key(cls, team_id: str) -> str:
        return cls._team_thread_id(team_id)

    def _ensure_team_thread_session(self, team: dict[str, Any]):
        session_key = self._team_thread_session_key(team["teamId"])
        session = self.state.sessions.get_or_create(session_key)
        if not session.metadata.get("title"):
            session.metadata["title"] = f"Team Thread · {team['name']}"
            self.state.sessions.save(session)
        return session

    def _build_team_thread_context_block(self, team: dict[str, Any], *, max_messages: int = 8) -> str | None:
        session = self._ensure_team_thread_session(team)
        history = [
            message
            for message in session.messages
            if message.get("role") in {"user", "assistant"} and str(message.get("content") or "").strip()
        ]
        if not history:
            return None
        recent = history[-max_messages:]
        lines = [
            "# Previous Team Thread Turns",
            "This is the recent team-level short-term context. Reuse it when it materially affects the current task.",
        ]
        for item in recent:
            role = "User" if item.get("role") == "user" else "Team"
            lines.append(f"## {role}\n{str(item.get('content') or '').strip()}")
        return "\n\n".join(lines)

    def _append_team_thread_message(
        self,
        team: dict[str, Any],
        *,
        role: str,
        content: str,
        run_id: str,
    ) -> None:
        text = str(content or "").strip()
        if not text:
            return
        session = self._ensure_team_thread_session(team)
        session.add_message(role, text, run_id=run_id, team_id=team["teamId"])
        self.state.sessions.save(session)

    def _retrieve_team_knowledge(self, team: dict[str, Any], task: str) -> dict[str, Any]:
        if not self.state.app_knowledge:
            return {"hits": [], "requestedMode": "keyword", "effectiveMode": "keyword"}
        kb_ids = list(team.get("sharedKnowledgeBindingIds") or [])
        if not kb_ids:
            return {"hits": [], "requestedMode": "keyword", "effectiveMode": "keyword"}
        return self.state.app_knowledge.retrieve(kb_ids=kb_ids, query=task, limit=8)

    def _get_team_memory_sections(self, team_id: str) -> list[tuple[str, str]]:
        if not self.state.app_memory:
            return []
        snapshot = self.state.app_memory.get_team_memory(team_id)
        content = str(snapshot.get("content") or "").strip()
        if not content:
            return []
        return [("Team Shared Memory", content)]

    def _propose_memory_candidate(
        self,
        *,
        root_run_id: str,
        team: dict[str, Any],
        agent: dict[str, Any],
        run_result: dict[str, Any],
    ) -> None:
        if not self.state.app_memory:
            return
        content = (
            (run_result.get("assistantMessage") or {}).get("content")
            or (run_result.get("run", {}).get("resultSummary") or {}).get("content")
            or ""
        )
        candidate = self.state.app_memory.create_candidate(
            scope="team_shared",
            team_id=team["teamId"],
            agent_id=agent["agentId"],
            run_id=run_result["run"]["runId"],
            source_kind="member_result",
            title=f"{team['name']} · {agent['name']} candidate",
            content=content,
        )
        if candidate:
            self.state.runs.append_event(
                root_run_id,
                "memory_candidate_proposed",
                {
                    "candidateId": candidate["candidateId"],
                    "teamId": team["teamId"],
                    "agentId": agent["agentId"],
                    "runId": run_result["run"]["runId"],
                },
            )

    def _prepare_team_run(self, team_id: str, content: str) -> tuple[dict[str, Any], str, str, str, str | None]:
        if not self.state.agent or not self.state.sessions or not self.state.runs:
            raise RuntimeError("Web team runtime is not available.")

        task = str(content or "").strip()
        if not task:
            raise ValueError("content is required.")

        try:
            team = self.state.app_teams.get_team(team_id)
        except TeamDefinitionNotFoundError as exc:
            raise KeyError(team_id) from exc

        thread_id = self._team_thread_id(team["teamId"])
        thread_context_block = self._build_team_thread_context_block(team)
        root_run = self.state.runs.create_run(
            kind=RunKind.TEAM,
            label=team["name"],
            task_preview=" ".join(task.split())[:280],
            team_id=team["teamId"],
            thread_id=thread_id,
            session_key=self._root_session_key(team["teamId"], "pending"),
            origin_channel="web",
            origin_chat_id=team["teamId"],
            control_scope=RunControlScope.TOP_LEVEL,
            workspace_path=str(self.state.config.workspace_path),
            memory_scope="team_thread",
            knowledge_scope="team_bindings" if team.get("sharedKnowledgeBindingIds") else "workspace",
        )
        self.state.runs.store.update_run(
            root_run.run_id,
            session_key=self._root_session_key(team["teamId"], root_run.run_id),
        )
        self.state.runs.append_event(
            root_run.run_id,
            "team_run_requested",
            {
                "content": task,
                "contentPreview": " ".join(task.split())[:600],
                "contentLength": len(task),
            },
        )
        self.state.runs.append_event(
            root_run.run_id,
            "team_definition_resolved",
            {
                "leaderAgentId": team["leaderAgentId"],
                "memberAgentIds": team.get("memberAgentIds", []),
                "workflowMode": team.get("workflowMode"),
                "sharedKnowledgeBindingIds": team.get("sharedKnowledgeBindingIds", []),
                "memberAccessPolicy": team.get("memberAccessPolicy") or {},
            },
        )
        self.state.runs.append_event(
            root_run.run_id,
            "team_thread_resolved",
            {
                "threadId": thread_id,
                "hasPriorContext": bool(thread_context_block),
            },
        )
        self._append_team_thread_message(
            team,
            role="user",
            content=task,
            run_id=root_run.run_id,
        )
        return team, task, root_run.run_id, thread_id, thread_context_block

    def _track_task(self, root_run_id: str, task: asyncio.Task[None]) -> None:
        self._active_tasks[root_run_id] = task

        def _cleanup(done: asyncio.Task[None]) -> None:
            self._active_tasks.pop(root_run_id, None)
            try:
                done.result()
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("Team run background task crashed")

        task.add_done_callback(_cleanup)

    def _resolve_source_run(self, team_id: str, run_id: str) -> dict[str, Any]:
        run = self.state.runs.get_run(run_id)
        if run.get("kind") != "team" and run.get("teamId") == team_id and run.get("rootRunId"):
            run = self.state.runs.get_run(str(run["rootRunId"]))
        if run.get("kind") != "team" or run.get("teamId") != team_id:
            raise ValueError("Run does not belong to the target team.")
        return run

    @staticmethod
    def _extract_source_task(run: dict[str, Any]) -> str:
        for event in run.get("events") or []:
            if event.get("eventType") != "team_run_requested":
                continue
            payload = event.get("payload") or {}
            content = str(payload.get("content") or "").strip()
            if content:
                return content
            preview = str(payload.get("contentPreview") or "").strip()
            if preview:
                return preview
        return str(run.get("taskPreview") or "").strip()

    @staticmethod
    def _merge_append_context(task: str, append_context: str | None) -> str:
        extra = str(append_context or "").strip()
        if not extra:
            return task
        return (
            f"{task}\n\n"
            "# Additional Context\n"
            "Use the following extra context when you re-run the team task.\n"
            f"{extra}"
        )

    @staticmethod
    def _format_knowledge_hits_markdown(hits: list[dict[str, Any]]) -> str:
        sections: list[str] = []
        for index, hit in enumerate(hits, start=1):
            citation = hit.get("citation") or {}
            title = citation.get("title") or hit.get("title") or f"Hit {index}"
            source_uri = citation.get("sourceUri") or ""
            body = str(hit.get("content") or "").strip()
            lines = [f"### {index}. {title}"]
            if source_uri:
                lines.append(f"Source: {source_uri}")
            if body:
                lines.append("")
                lines.append(body)
            sections.append("\n".join(lines))
        return "\n\n".join(sections)

    async def _execute_team_run(
        self,
        root_run_id: str,
        team: dict[str, Any],
        task: str,
        *,
        thread_id: str,
        team_thread_context_block: str | None = None,
    ) -> None:
        shared_knowledge_result = self._retrieve_team_knowledge(team, task)
        shared_knowledge_hits = list(shared_knowledge_result.get("hits") or [])
        shared_knowledge_block = None
        if shared_knowledge_hits:
            shared_knowledge_block = self.state.agent_runtime._build_knowledge_prompt_block(shared_knowledge_hits)
        team_memory_sections = self._get_team_memory_sections(team["teamId"])

        try:
            current = self.state.runs.require_run(root_run_id)
            if current.status.value == "cancel_requested":
                self.state.runs.cancel_run(root_run_id)
                return

            self.state.runs.start_run(root_run_id)
            self.state.runs.append_event(
                root_run_id,
                "team_knowledge_retrieved",
                {
                    "sharedKnowledgeBindingIds": team.get("sharedKnowledgeBindingIds", []),
                    "requestedMode": shared_knowledge_result.get("requestedMode"),
                    "effectiveMode": shared_knowledge_result.get("effectiveMode"),
                    "hitCount": len(shared_knowledge_hits),
                },
            )

            member_access_policy = team.get("memberAccessPolicy") or {}

            # --- LangGraph Supervisor Execution ---
            self.state.runs.append_event(
                root_run_id,
                "supervisor_started",
                {
                    "leaderAgentId": team["leaderAgentId"],
                    "memberAgentIds": team.get("memberAgentIds", []),
                },
            )

            runner = LangGraphTeamRunner(
                agent_runtime=self.state.agent_runtime,
                runs=self.state.runs,
                config_runtime=self.state.config_runtime,
            )
            result = await runner.run(
                team,
                task,
                root_run_id,
                thread_id,
                team_thread_context_block=team_thread_context_block,
                shared_knowledge_block=shared_knowledge_block,
                team_memory_sections=team_memory_sections,
                member_access_policy=member_access_policy,
                propose_memory_candidate=self._propose_memory_candidate,
            )

            self.state.runs.append_event(
                root_run_id,
                "supervisor_completed",
                {
                    "leaderAgentId": team["leaderAgentId"],
                    "memberRunIds": result.member_run_ids,
                },
            )

            final_content = result.final_content
            self._append_team_thread_message(
                team,
                role="assistant",
                content=final_content,
                run_id=root_run_id,
            )
            artifact_path = self.state.runs.write_markdown_artifact(
                root_run_id,
                title=f"Team Run Artifact · {team['name']}",
                metadata={
                    "run_id": root_run_id,
                    "kind": "team",
                    "team_id": team["teamId"],
                    "thread_id": thread_id,
                    "workflow_mode": "supervisor",
                    "leader_agent_id": team["leaderAgentId"],
                    "member_run_count": len(result.member_run_ids),
                    "shared_knowledge_hits": len(shared_knowledge_hits),
                },
                sections=[
                    ("Original Task", task),
                    ("Final Answer", final_content),
                    ("Shared Knowledge", self._format_knowledge_hits_markdown(shared_knowledge_hits)),
                ],
            )
            self.state.runs.complete_run(
                root_run_id,
                RunResultSummary(
                    content=final_content,
                    metadata={
                        "memberRunIds": result.member_run_ids,
                        "sharedKnowledgeHitCount": len(shared_knowledge_hits),
                    },
                ),
                artifact_path=artifact_path,
            )
            self.state.runs.append_event(
                root_run_id,
                "team_completed",
                {
                    "memberRunIds": result.member_run_ids,
                    "sharedKnowledgeHitCount": len(shared_knowledge_hits),
                },
            )
        except asyncio.CancelledError:
            try:
                self.state.runs.cancel_run(root_run_id)
            except Exception:
                logger.debug("Team run [{}] cancel state update skipped", root_run_id)
            raise
        except Exception as exc:
            self.state.runs.fail_run(root_run_id, "TEAM_TEST_RUN_FAILED", str(exc))
            raise

    async def start_team_run(
        self,
        team_id: str,
        content: str,
        *,
        source_run_id: str | None = None,
        append_context: str | None = None,
    ) -> dict[str, Any]:
        team, task, root_run_id, thread_id, team_thread_context_block = self._prepare_team_run(team_id, content)
        if source_run_id:
            self.state.runs.append_event(
                root_run_id,
                "retry_requested",
                {
                    "sourceRunId": source_run_id,
                    "appendContextProvided": bool(str(append_context or "").strip()),
                    "appendContextPreview": " ".join(str(append_context or "").split())[:400],
                },
            )
        background = asyncio.create_task(
            self._execute_team_run(
                root_run_id,
                team,
                task,
                thread_id=thread_id,
                team_thread_context_block=team_thread_context_block,
            ),
            name=f"team-run:{root_run_id}",
        )
        self._track_task(root_run_id, background)
        return {
            "team": team,
            "run": self.state.runs.get_run(root_run_id),
            "leaderRun": None,
            "memberRuns": [],
            "finalAssistantMessage": None,
            "teamKnowledgeHits": [],
        }

    def get_team_thread_summary(self, team_id: str) -> dict[str, Any]:
        team = self.state.app_teams.get_team(team_id)
        session = self._ensure_team_thread_session(team)
        thread_id = self._team_thread_id(team["teamId"])
        return {
            "threadId": thread_id,
            "session": self.state.chat_runtime.format_session_summary_from_session(session, thread_id),
        }

    def get_team_thread_messages(self, team_id: str, *, limit: int = 40) -> dict[str, Any]:
        team = self.state.app_teams.get_team(team_id)
        session = self._ensure_team_thread_session(team)
        thread_id = self._team_thread_id(team["teamId"])
        messages = session.messages[-limit:]
        start_sequence = len(session.messages) - len(messages) + 1
        return {
            "threadId": thread_id,
            "messages": [
                self.state.chat_runtime.format_message(start_sequence + index, thread_id, message)
                for index, message in enumerate(messages)
            ],
            "total": len(session.messages),
        }

    def get_team_thread_memory_source(self, team_id: str, *, limit: int = 40) -> dict[str, Any] | None:
        payload = self.get_team_thread_messages(team_id, limit=limit)
        messages = payload.get("messages") or []
        if not messages:
            return None
        lines: list[str] = []
        for message in messages:
            role = str(message.get("role") or "assistant").strip() or "assistant"
            content = str(message.get("content") or "").strip()
            if not content:
                continue
            label = "User" if role == "user" else "Assistant" if role == "assistant" else role.title()
            lines.append(f"{label}: {content}")
        if not lines:
            return None
        return {
            "sourceId": payload["threadId"],
            "title": f"Team Thread · {team_id}",
            "content": "\n\n".join(lines),
            "metadata": {
                "threadId": payload["threadId"],
                "messageCount": payload.get("total", len(messages)),
            },
        }

    async def test_run_team(self, team_id: str, content: str) -> dict[str, Any]:
        return await self.start_team_run(team_id, content)

    async def retry_team_run(
        self,
        team_id: str,
        run_id: str,
        *,
        append_context: str | None = None,
    ) -> dict[str, Any]:
        source_run = self._resolve_source_run(team_id, run_id)
        source_task = self._extract_source_task(source_run)
        if not source_task:
            raise ValueError("Source run has no reusable task content.")
        next_task = self._merge_append_context(source_task, append_context)
        return await self.start_team_run(
            team_id,
            next_task,
            source_run_id=source_run["runId"],
            append_context=append_context,
        )

    async def cancel_run(self, root_run_id: str) -> bool:
        task = self._active_tasks.get(root_run_id)
        if task is None or task.done():
            return False
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        try:
            self.state.runs.cancel_run(root_run_id)
        except Exception:
            logger.debug("Team run [{}] final cancel state update skipped", root_run_id)
        return True

    async def shutdown_async(self) -> None:
        tasks = [task for task in self._active_tasks.values() if not task.done()]
        self._active_tasks.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
