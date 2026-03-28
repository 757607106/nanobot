# Test Layout

The test suite is organized by product surface rather than by time of introduction.

- `tests/agent/`: core agent runtime, prompt assembly, memory, and loop behavior.
- `tests/channels/`: channel adapters, dispatch, plugin compatibility, and routing.
- `tests/cli/`: Typer commands and CLI runtime behavior.
- `tests/config/`: config parsing, migrations, and path resolution.
- `tests/cron/`: cron scheduler, lifecycle, and cron tool behavior.
- `tests/harness/`: execution harness and runtime materialization helpers.
- `tests/knowledge/`: knowledge-base, RAG engine, and bound-knowledge behavior.
- `tests/platform/`: tenant-scoped services, stores, and run registry behavior.
- `tests/providers/`: provider selection and model/backend compatibility.
- `tests/security/`: security boundaries and network controls.
- `tests/services/`: reusable service modules that are not tied to a single runtime surface.
- `tests/tools/`: tool contracts and sandbox-facing tool behavior.
- `tests/web/`: FastAPI routes and Web runtime services.

Root-level files are reserved for shared helpers and standalone integration scripts:

- `tests/knowledge_test_utils.py`: fake RAG helpers reused across test domains.
- `tests/live_external_milvus_smoke.py`: manual external smoke test.
- `tests/web_e2e_server.py`, `tests/web_e2e_agent_knowledge_server.py`: Playwright/E2E support servers.
- `tests/test_docker.sh`: Docker-oriented smoke script.
