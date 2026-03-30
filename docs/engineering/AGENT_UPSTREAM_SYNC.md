# Agent Upstream Sync

This repository should keep the nanobot upstream agent kernel as stable as possible,
while layering product-specific execution and Web UI features around it.

## Ownership Boundary

Treat these paths as `upstream core` and keep them close to the official repository:

- `nanobot/agent`
- `nanobot/providers`
- `nanobot/channels`
- `nanobot/command`
- `nanobot/session`

Treat these paths as `product/runtime adapters` and keep custom behavior here:

- `nanobot/harness`
- `nanobot/platform`
- `nanobot/web`
- `web-ui`

## Rules

- Do not add Web UI or platform orchestration logic directly into `nanobot/agent/loop.py`.
- Keep `AgentLoop.process_direct()` on the upstream-style contract: return `OutboundMessage | None`.
- For explicit agent runs, resolve workspace and sandbox bindings in the runtime layer, not implicitly in core.
- If a feature needs display-only metadata or run lineage, pass it through runtime services and middleware, not the core loop API.

## Sync Workflow

1. Fetch upstream: `git fetch official`.
2. Review upstream diffs in `nanobot/agent`, `nanobot/providers`, `nanobot/channels`, and `nanobot/session` first.
3. Merge or cherry-pick core-compatible changes before touching `nanobot/web` or `nanobot/platform`.
4. Re-run the fixed smoke suite: `./agent_upstream_smoke.sh`.
5. Only if the smoke suite passes, review whether product-layer adapters need follow-up changes.

## Fixed Smoke Baseline

Run this from the repository root:

```bash
./agent_upstream_smoke.sh
```

The suite is intentionally biased toward:

- agent loop and runner behavior
- explicit agent execution wiring
- isolated workspace / memory scoping
- RAG and knowledge binding
- Web API and channel routing regressions
- CLI compatibility for direct runs, cron, and routed agent execution
