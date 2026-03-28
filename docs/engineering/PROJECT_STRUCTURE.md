# Project Structure

This repository follows a layered structure so readers can quickly identify what belongs to upstream-aligned agent core, what belongs to local platform extensions, and what belongs to delivery surfaces such as Web UI and channels.

## Repository Map

```text
.
├── nanobot/                     # Python application package
│   ├── agent/                   # Upstream-aligned agent core and built-in tools
│   ├── harness/                 # Local runtime assembly, execution context, sandbox, knowledge binding
│   ├── platform/                # Persistent domain services: agents, runs, knowledge, tenants, memory
│   ├── web/                     # FastAPI app, routers, web services, runtime services
│   ├── channels/                # Channel adapters and message dispatch
│   ├── providers/               # LLM/provider backends and provider factory
│   ├── cli/                     # CLI entrypoints and interactive runtime helpers
│   ├── config/                  # Config schema, loading, migration helpers
│   ├── cron/                    # Scheduled task engine
│   ├── heartbeat/               # Periodic proactive task runner
│   ├── bus/                     # Inbound/outbound event bus
│   ├── session/                 # Session and chat history persistence
│   ├── services/                # Cross-domain reusable services
│   ├── storage/                 # Storage adapters and repositories
│   ├── templates/               # Workspace bootstrap templates
│   └── utils/                   # Small shared helpers with no domain ownership
├── web-ui/                      # React control plane
├── tests/                       # Domain-organized pytest suite
├── docs/                        # Human-facing design and usage docs
├── whatsapp_bridge/             # Node-based WhatsApp bridge source
└── docs/assets/showcase/        # Demo assets used in README
```

## Layer Boundaries

- `nanobot/agent/`
  Keep this package as close as possible to official nanobot core runtime. Platform-specific orchestration should not accumulate here.
- `nanobot/harness/`
  Put local runtime composition here: workspace binding, sandbox binding, execution assembly, knowledge injection, runtime tool registry, and event shaping.
- `nanobot/platform/`
  Use this layer for business/domain state with clear `models.py`, `store.py`, and `service.py` separation.
- `nanobot/web/routers/`
  HTTP boundary only. Parse request, call services, shape response.
- `nanobot/web/services/`
  Put Web-only service objects here: auth, setup, MCP registry/repository helpers, channel probes, template management, and WhatsApp binding orchestration.
- `nanobot/web/runtime_services/`
  Web runtime orchestration only. Build isolated loops, prepare execution context, and coordinate stateful runtime helpers.
- `nanobot/services/`
  Shared cross-cutting services that are not owned by the Web surface or a persistent platform domain.
- `nanobot/utils/`
  Keep this intentionally small. If a helper starts to know too much about one domain, move it into that domain package.

## Naming Conventions

- Package names use lowercase snake_case.
- Modules should express role clearly.
  Preferred examples: `service.py`, `store.py`, `models.py`, `factory.py`, `runtime_tools.py`, `channel_runtime.py`.
- Avoid vague filenames like `helpers.py` inside domain packages when the file has a stable responsibility.
  Prefer role-based names such as `workspace.py`, `knowledge.py`, `environment.py`.
- Keep transport-specific code named after the transport.
  Examples: `telegram.py`, `weixin.py`, `discord.py`.
- Keep runtime orchestrators suffixed by responsibility.
  Examples: `channel_runtime.py`, `platform_runtime.py`, `schedule.py`.
- Test filenames should mirror the domain and subject being tested.
  Examples: `tests/web/test_api.py`, `tests/platform/test_run_registry.py`, `tests/channels/test_dispatch.py`.

## Test Layout

The `tests/` directory mirrors product surfaces rather than implementation age.

- `tests/agent/`: core runtime behavior.
- `tests/channels/`: adapters, plugin compatibility, dispatch, routing.
- `tests/cli/`: CLI behavior.
- `tests/cron/`: scheduler and cron tool lifecycle.
- `tests/harness/`: execution materialization and local runtime extension points.
- `tests/knowledge/`: KB, RAG, retrieval-bound agent behavior.
- `tests/platform/`: multi-tenant domain services and stores.
- `tests/providers/`: provider and model backend compatibility.
- `tests/services/`: reusable service modules.
- `tests/web/`: HTTP routes and Web runtime services.

Root-level files under `tests/` are reserved for shared helpers and standalone integration scripts.

## Ongoing Guardrails

- When extending agent behavior, prefer adding a hook or harness-layer adapter before modifying `nanobot/agent`.
- When adding a new platform domain, follow the `models.py` + `store.py` + `service.py` pattern.
- When adding Web capabilities, first decide whether the code belongs to:
  `routers/` for HTTP wiring,
  `services/` for Web-only service objects and admin/control-plane helpers,
  `runtime_services/` for runtime orchestration,
  or `platform/` for persistent domain logic.
- When adding tests, place them in the narrowest existing domain directory and avoid new root-level `tests/test_*.py` files unless the file is a shared helper or external/manual integration runner.
