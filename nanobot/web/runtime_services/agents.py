"""Agent-definition runtime helpers for test runs and recent run inspection."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from nanobot.agent.loop import AgentLoop
from nanobot.agent.skills import SkillsLoader
from nanobot.platform.agents import AgentDefinitionNotFoundError
from nanobot.platform.runs import RunControlScope, RunKind, RunResultSummary

if TYPE_CHECKING:
    from nanobot.config.schema import Config
    from nanobot.web.runtime import WebAppState


class WebAgentRuntimeService:
    """Runtime helpers for agent definitions inside the collaboration domain."""

    def __init__(self, state: WebAppState):
        self.state = state

    @staticmethod
    def _agent_test_session_key(agent_id: str, run_id: str) -> str:
        return f"agent-test:{agent_id}:{run_id}"

    @staticmethod
    def _agent_test_session_id(agent_id: str, run_id: str) -> str:
        return f"agent-test:{agent_id}:{run_id}"

    def _format_session_summary(self, session_key: str, session_id: str) -> dict[str, Any]:
        session = self.state.sessions.get_or_create(session_key)
        return self.state.chat_runtime.format_session_summary_from_session(session, session_id)

    def _format_messages(self, session_key: str, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
        session = self.state.sessions.get_or_create(session_key)
        messages = session.messages[-limit:]
        start_sequence = len(session.messages) - len(messages) + 1
        return [
            self.state.chat_runtime.format_message(start_sequence + index, session_id, message)
            for index, message in enumerate(messages)
        ]

    def _get_last_assistant_message(self, session_key: str, session_id: str) -> dict[str, Any] | None:
        session = self.state.sessions.get_or_create(session_key)
        for index in range(len(session.messages) - 1, -1, -1):
            message = session.messages[index]
            if message.get("role") == "assistant":
                return self.state.chat_runtime.format_message(index + 1, session_id, message)
        return None

    @staticmethod
    def _build_knowledge_prompt_block(hits: list[dict[str, Any]]) -> str:
        if not hits:
            return ""
        sections = [
            "# Retrieved Knowledge",
            "Use the following evidence only when it is relevant to the user's request.",
            "Prefer citing the source title or URL in plain language when you rely on it.",
        ]
        for index, hit in enumerate(hits, start=1):
            citation = hit.get("citation") or {}
            label = citation.get("title") or hit.get("title") or f"Chunk {index}"
            source_uri = citation.get("sourceUri")
            source_type = citation.get("sourceType") or "knowledge"
            header = f"## Evidence {index}: {label}"
            meta = f"Source Type: {source_type}"
            if source_uri:
                meta += f"\nSource URI: {source_uri}"
            sections.append(f"{header}\n{meta}\n\n{hit.get('content', '').strip()}")
        return "\n\n".join(sections)

    def _retrieve_bound_knowledge(self, agent: dict[str, Any], task: str) -> dict[str, Any]:
        if not self.state.app_knowledge:
            return {"hits": [], "requestedMode": "keyword", "effectiveMode": "keyword"}
        kb_ids = list(agent.get("knowledgeBindingIds") or [])
        if not kb_ids:
            return {"hits": [], "requestedMode": "keyword", "effectiveMode": "keyword"}
        return self.state.app_knowledge.retrieve(kb_ids=kb_ids, query=task, limit=6)

    def _validate_agent_bindings(
        self,
        agent: dict[str, Any],
        config: Config,
    ) -> tuple[list[str], list[str], list[str]]:
        valid_tool_names = {
            item["name"]
            for item in self.state.workspace_runtime.get_valid_template_tools()
        }
        invalid_tools = [name for name in agent.get("toolAllowlist", []) if name not in valid_tool_names]
        if invalid_tools:
            raise ValueError(f"Agent has invalid tools: {', '.join(invalid_tools)}")

        configured_mcp = config.tools.mcp_servers
        missing_mcp = [name for name in agent.get("mcpServerIds", []) if name not in configured_mcp]
        if missing_mcp:
            raise ValueError(f"Agent references unknown MCP servers: {', '.join(missing_mcp)}")
        disabled_mcp = [
            name
            for name in agent.get("mcpServerIds", [])
            if name in configured_mcp and not configured_mcp[name].enabled
        ]
        if disabled_mcp:
            raise ValueError(f"Agent references disabled MCP servers: {', '.join(disabled_mcp)}")

        loader = SkillsLoader(config.workspace_path)
        known_skills = {item["name"] for item in loader.list_skills(filter_unavailable=False)}
        missing_skills = [name for name in agent.get("skillIds", []) if name not in known_skills]
        if missing_skills:
            raise ValueError(f"Agent references unknown skills: {', '.join(missing_skills)}")

        if self.state.app_knowledge and agent.get("knowledgeBindingIds"):
            self.state.app_knowledge.resolve_bound_kbs(list(agent.get("knowledgeBindingIds") or []))

        return invalid_tools, disabled_mcp, missing_skills

    @staticmethod
    def _format_bindings_markdown(agent: dict[str, Any]) -> str:
        lines = [
            f"- Tools: {', '.join(agent.get('toolAllowlist') or []) or 'none'}",
            f"- MCP: {', '.join(agent.get('mcpServerIds') or []) or 'none'}",
            f"- Skills: {', '.join(agent.get('skillIds') or []) or 'none'}",
            f"- Knowledge Bindings: {', '.join(agent.get('knowledgeBindingIds') or []) or 'none'}",
        ]
        return "\n".join(lines)

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

    def _build_agent_config(self, agent: dict[str, Any]) -> Config:
        config = self.state.config.model_copy(deep=True)
        model = (agent.get("model") or "").strip()
        if model:
            config.agents.defaults.model = model
        selected_mcp = {
            name: entry
            for name, entry in config.tools.mcp_servers.items()
            if name in set(agent.get("mcpServerIds", []) or [])
        }
        config.tools.mcp_servers = selected_mcp
        return config

    async def run_agent_definition(
        self,
        agent: dict[str, Any],
        *,
        task: str,
        label: str | None = None,
        session_key: str,
        session_id: str,
        session_title: str,
        origin_chat_id: str,
        control_scope: RunControlScope = RunControlScope.TOP_LEVEL,
        team_id: str | None = None,
        parent_run_id: str | None = None,
        root_run_id: str | None = None,
        thread_id: str | None = None,
        spawn_depth: int = 0,
        additional_prompt_sections: list[str] | None = None,
        include_workspace_memory: bool | None = None,
        memory_sections: list[tuple[str, str]] | None = None,
    ) -> dict[str, Any]:
        if not self.state.agent or not self.state.sessions or not self.state.runs:
            raise RuntimeError("Web agent runtime is not available.")

        task = str(task or "").strip()
        if not task:
            raise ValueError("content is required.")

        config = self._build_agent_config(agent)
        self._validate_agent_bindings(agent, config)
        effective_include_workspace_memory = (
            include_workspace_memory
            if include_workspace_memory is not None
            else (str(agent.get("memoryScope") or "agent_profile") == "workspace_shared")
        )
        knowledge_result = self._retrieve_bound_knowledge(agent, task)
        knowledge_hits = list(knowledge_result.get("hits") or [])
        prompt_sections = [str(agent.get("systemPrompt") or "").strip()]
        prompt_sections.extend(section for section in (additional_prompt_sections or []) if str(section or "").strip())
        if knowledge_hits:
            prompt_sections.append(self._build_knowledge_prompt_block(knowledge_hits))
        system_prompt_override = "\n\n".join(section for section in prompt_sections if section)

        record = self.state.runs.create_run(
            kind=RunKind.AGENT,
            label=label or agent["name"],
            task_preview=" ".join(task.split())[:280],
            agent_id=agent["agentId"],
            team_id=team_id,
            thread_id=thread_id,
            parent_run_id=parent_run_id,
            root_run_id=root_run_id,
            session_key=session_key,
            origin_channel="web",
            origin_chat_id=origin_chat_id,
            spawn_depth=spawn_depth,
            control_scope=control_scope,
            workspace_path=str(config.workspace_path),
            memory_scope=agent.get("memoryScope") or "agent_profile",
            knowledge_scope="bindings" if agent.get("knowledgeBindingIds") else ("team_shared" if team_id else "workspace"),
        )

        session = self.state.sessions.get_or_create(session_key)
        if not session.metadata.get("title"):
            session.metadata["title"] = session_title
        self.state.sessions.save(session)

        self.state.runs.append_event(
            record.run_id,
            "bindings_resolved",
            {
                "toolAllowlist": agent.get("toolAllowlist", []),
                "mcpServerIds": agent.get("mcpServerIds", []),
                "skillIds": agent.get("skillIds", []),
                "knowledgeBindingIds": agent.get("knowledgeBindingIds", []),
            },
        )
        self.state.runs.append_event(
            record.run_id,
            "knowledge_retrieved",
            {
                "knowledgeBindingIds": agent.get("knowledgeBindingIds", []),
                "requestedMode": knowledge_result.get("requestedMode"),
                "effectiveMode": knowledge_result.get("effectiveMode"),
                "hitCount": len(knowledge_hits),
            },
        )

        isolated_agent = AgentLoop(
            bus=self.state.bus,
            provider=self.state.config_runtime.make_provider(config),
            workspace=config.workspace_path,
            model=config.agents.defaults.model,
            max_iterations=config.agents.defaults.max_tool_iterations,
            context_window_tokens=config.agents.defaults.context_window_tokens,
            brave_api_key=config.tools.web.search.api_key or None,
            web_proxy=config.tools.web.proxy or None,
            exec_config=config.tools.exec,
            cron_service=self.state.cron,
            restrict_to_workspace=config.tools.restrict_to_workspace,
            session_manager=self.state.sessions,
            mcp_servers=config.tools.mcp_servers,
            channels_config=config.channels,
            run_registry=self.state.runs,
            tool_allowlist=list(agent.get("toolAllowlist", [])),
            skill_names=list(agent.get("skillIds", [])),
            system_prompt_override=system_prompt_override,
            include_workspace_memory=effective_include_workspace_memory,
            memory_sections=memory_sections,
        )

        progress_events: list[str] = []

        async def _on_progress(progress: str, *, tool_hint: bool = False) -> None:
            if not progress:
                return
            progress_events.append(progress)
            self.state.runs.append_event(
                record.run_id,
                "progress",
                {
                    "content": progress,
                    "toolHint": tool_hint,
                },
            )

        try:
            self.state.runs.start_run(record.run_id)
            response = await isolated_agent.process_direct(
                content=task,
                session_key=session_key,
                channel="web",
                chat_id=session_id,
                on_progress=_on_progress,
                run_context={
                    "run_id": record.run_id,
                    "root_run_id": root_run_id or record.run_id,
                    "agent_id": agent["agentId"],
                    "team_id": team_id,
                    "thread_id": thread_id,
                    "spawn_depth": spawn_depth,
                },
            )
            artifact_path = self.state.runs.write_markdown_artifact(
                record.run_id,
                title=f"Run Artifact · {label or agent['name']}",
                metadata={
                    "run_id": record.run_id,
                    "kind": "agent",
                    "agent_id": agent["agentId"],
                    "team_id": team_id,
                    "model": config.agents.defaults.model,
                    "memory_scope": agent.get("memoryScope") or "agent_profile",
                    "workspace_memory_included": effective_include_workspace_memory,
                    "memory_section_count": len(memory_sections or []),
                    "knowledge_hits": len(knowledge_hits),
                },
                sections=[
                    ("Task", task),
                    ("Result", response),
                    ("Bindings", self._format_bindings_markdown(agent)),
                    ("Retrieved Knowledge", self._format_knowledge_hits_markdown(knowledge_hits)),
                ],
            )
            self.state.runs.complete_run(
                record.run_id,
                RunResultSummary(
                    content=response,
                    metadata={
                        "sessionKey": session_key,
                        "sessionId": session_id,
                        "progressEventCount": len(progress_events),
                        "knowledgeHitCount": len(knowledge_hits),
                    },
                ),
                artifact_path=artifact_path,
            )
        except asyncio.CancelledError:
            try:
                self.state.runs.cancel_run(record.run_id)
            except Exception:
                pass
            raise
        except Exception as exc:
            self.state.runs.fail_run(record.run_id, "AGENT_TEST_RUN_FAILED", str(exc))
            raise
        finally:
            await isolated_agent.close_mcp()

        messages = self._format_messages(session_key, session_id)
        return {
            "run": self.state.runs.get_run(record.run_id),
            "session": self._format_session_summary(session_key, session_id),
            "assistantMessage": self._get_last_assistant_message(session_key, session_id),
            "messages": messages,
            "pendingKnowledgeBindings": list(agent.get("knowledgeBindingIds") or []),
            "knowledgeHits": knowledge_hits,
            "appliedBindings": {
                "toolAllowlist": list(agent.get("toolAllowlist") or []),
                "mcpServerIds": list(agent.get("mcpServerIds") or []),
                "skillIds": list(agent.get("skillIds") or []),
                "knowledgeBindingIds": list(agent.get("knowledgeBindingIds") or []),
            },
        }

    async def test_run_agent(self, agent_id: str, content: str) -> dict[str, Any]:
        if not self.state.agent or not self.state.sessions or not self.state.runs:
            raise RuntimeError("Web agent runtime is not available.")

        task = str(content or "").strip()
        if not task:
            raise ValueError("content is required.")

        try:
            agent = self.state.app_agents.get_agent(agent_id)
        except AgentDefinitionNotFoundError as exc:
            raise KeyError(agent_id) from exc

        pending_session_key = self._agent_test_session_key(agent["agentId"], "pending")
        result = await self.run_agent_definition(
            agent,
            task=task,
            label=agent["name"],
            session_key=pending_session_key.replace("pending", "pending"),
            session_id=self._agent_test_session_id(agent["agentId"], "pending"),
            session_title=f"Agent Test · {agent['name']}",
            origin_chat_id=agent["agentId"],
        )
        run_id = result["run"]["runId"]
        actual_session_key = self._agent_test_session_key(agent["agentId"], run_id)
        actual_session_id = self._agent_test_session_id(agent["agentId"], run_id)
        if result["session"]["id"] != actual_session_id:
            session = self.state.sessions.get_or_create(pending_session_key)
            self.state.sessions.delete(pending_session_key)
            actual = self.state.sessions.get_or_create(actual_session_key)
            actual.messages = list(session.messages)
            actual.metadata.update(session.metadata)
            self.state.sessions.save(actual)
            self.state.runs.store.update_run(run_id, session_key=actual_session_key)
            result["run"] = self.state.runs.get_run(run_id)
            result["session"] = self._format_session_summary(actual_session_key, actual_session_id)
            result["messages"] = self._format_messages(actual_session_key, actual_session_id)
            result["assistantMessage"] = self._get_last_assistant_message(actual_session_key, actual_session_id)
        return result
