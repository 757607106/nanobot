# Web GUI Gap Closure Tracker

Baseline date: 2026-03-13

Compared targets:
- Current repository: `HKUDS/nanobot` workspace checkout
- Reference repository: `lucmuss/nanobot-webgui` main branch snapshot on 2026-03-13

Purpose:
- Turn the feature gap analysis into an execution tracker.
- Keep one place for scope, status, dependencies, acceptance, and validation evidence.
- Make later feature verification predictable instead of ad hoc.

## Status Legend

- `DONE`: Implemented, validated, and regression-checked.
- `PARTIAL`: Existing capability covers part of the target, but user-facing flow is incomplete.
- `NOT_STARTED`: No implementation work has begun.
- `IN_PROGRESS`: Active implementation is underway.
- `BLOCKED`: Cannot continue without a prior dependency or product decision.

## Update Rules

- A task may move to `DONE` only when all acceptance criteria and validation items are complete.
- Each task should keep an `Evidence` line updated with PR, commit, screenshots, or test artifacts.
- If scope changes, update the task instead of creating hidden side work.
- If a task introduces a user-visible flow, it must add automated coverage before closing.

## Baseline Snapshot

Existing strengths in the current repository:
- `DONE`: Multi-session chat UI and streaming chat API
- `DONE`: Config editor UI and config metadata API
- `DONE`: Cron UI and cron API
- `DONE`: Skills upload/list/delete UI and API
- `DONE`: Main prompt (`AGENTS.md`) editor UI and API
- `DONE`: Basic system status page
- `DONE`: Backend APIs for calendar and agent templates

Current gap areas:
- `PARTIAL`: MCP support exists in backend/config, but UI is raw JSON only
- `PARTIAL`: System operations exist at a basic level, but no auth/onboarding/ops center
- `PARTIAL`: Chat has progress streaming, but no upload/runtime/usage/tool activity workspace
- `PARTIAL`: Markdown document editing exists only for `AGENTS.md`
- `NOT_STARTED`: Admin auth and setup wizard
- `NOT_STARTED`: MCP lifecycle management
- `NOT_STARTED`: Community marketplace and publish flows
- `NOT_STARTED`: Playwright E2E and GUI regression pipeline

## Milestones

- `M0`: Regression lock for existing features
- `M1`: Access control and guided onboarding
- `M2`: MCP lifecycle management
- `M3`: Operations, validation, and observability
- `M4`: Chat/runtime enhancement and existing backend feature exposure
- `M5`: Community integration
- `M6`: E2E, CI, and release hardening

## Task List

### M0. Regression Lock

#### NB-WEB-000
- Title: Protect current working Web UI features before expansion
- Priority: P0
- Status: NOT_STARTED
- Depends on: none
- Scope:
  - Add a baseline smoke suite for current pages: chat, cron, skills, prompt, config, system
  - Add API smoke checks for existing Web API endpoints
  - Freeze current expected behaviors before large UI restructuring
- Acceptance:
  - Existing pages render without runtime errors
  - Existing API tests pass after refactors
  - A failing change in current chat/config/cron flows is caught automatically
- Validation:
  - `pytest tests/test_web_api.py -q`
  - Add frontend smoke test command and ensure it fails on broken routes
- Evidence: TBD

### M1. Access Control and Guided Onboarding

#### NB-WEB-001
- Title: Admin bootstrap, login, logout, and session guard
- Priority: P0
- Status: NOT_STARTED
- Depends on: NB-WEB-000
- Scope:
  - Add admin account bootstrap flow
  - Add login/logout backend and session storage
  - Add route guards for the SPA
  - Redirect unauthenticated users away from protected pages
- Acceptance:
  - First visit without admin account lands on bootstrap flow
  - After bootstrap, the same instance requires login after logout or restart
  - Direct access to protected routes without session is blocked
- Validation:
  - Backend auth tests for bootstrap, login failure, login success, logout
  - Playwright flow for bootstrap -> login -> logout -> relogin
- Evidence: TBD

#### NB-WEB-002
- Title: First-run setup wizard for provider, channel, and agent defaults
- Priority: P0
- Status: NOT_STARTED
- Depends on: NB-WEB-001
- Scope:
  - Replace the current "open the config page and edit everything" first-run experience
  - Provide a step-based wizard for provider, optional channel, and default agent setup
  - Persist wizard progress and resume correctly
- Acceptance:
  - New admin can complete setup without touching raw JSON
  - Wizard writes valid config values into the active config file
  - Incomplete setup resumes from the next missing step
- Validation:
  - Backend persistence tests against config updates
  - Playwright wizard completion and restart-resume checks
- Evidence: TBD

#### NB-WEB-003
- Title: Safe mode, progressive disclosure, and setup completion state
- Priority: P1
- Status: NOT_STARTED
- Depends on: NB-WEB-002
- Scope:
  - Add beginner-safe defaults and hide risky controls until needed
  - Track setup completion separately from authentication
  - Show clear next-step guidance after onboarding
- Acceptance:
  - New users see only essential controls by default
  - Advanced controls are available but intentionally separated
  - Setup completion state drives landing page and dashboard behavior
- Validation:
  - UI regression test for safe mode and advanced section visibility
  - Manual verification of redirect rules after partial setup
- Evidence: TBD

### M2. MCP Lifecycle Management

#### NB-WEB-101
- Title: MCP registry model and user-facing MCP index
- Priority: P0
- Status: PARTIAL
- Depends on: NB-WEB-000
- Scope:
  - Promote MCP from raw config JSON into a first-class UI domain
  - Add MCP list/index page with status, transport, tool count, and enabled state
  - Preserve compatibility with existing `config.tools.mcpServers`
- Acceptance:
  - MCP entries can be viewed without editing raw JSON
  - Enabled/disabled state is visible in one place
  - Existing config-backed MCP data remains readable and migrates safely
- Validation:
  - Backend tests for MCP metadata loading and compatibility
  - Manual verification with pre-existing config entries
- Evidence: TBD

#### NB-WEB-102
- Title: MCP inspect and install from repository URL
- Priority: P0
- Status: NOT_STARTED
- Depends on: NB-WEB-101, NB-WEB-002
- Scope:
  - Analyze a GitHub repository URL
  - Generate install plan and user-readable preview
  - Install and register MCP into the current workspace/config
- Acceptance:
  - User can inspect a repository before installing it
  - Installation writes config plus MCP metadata cleanly
  - Duplicate installs are rejected with a useful message
- Validation:
  - Fixture-based MCP install tests
  - Playwright install flow from repo URL
- Evidence: TBD

#### NB-WEB-103
- Title: MCP probe, enable/disable, remove, and detail editing
- Priority: P0
- Status: NOT_STARTED
- Depends on: NB-WEB-101
- Scope:
  - Add server test/probe action
  - Add enable/disable toggle for chat participation
  - Add remove flow
  - Add detail page for env/config editing
- Acceptance:
  - Each installed MCP can be tested without raw JSON edits
  - Enabled state affects runtime loading
  - Removal cleans UI state and config consistently
- Validation:
  - Backend tests for test/toggle/remove
  - Playwright flow using local fixture MCP servers
- Evidence: TBD

#### NB-WEB-104
- Title: MCP failure diagnosis and bounded repair workflow
- Priority: P1
- Status: NOT_STARTED
- Depends on: NB-WEB-103
- Scope:
  - Explain common MCP failures in the UI
  - Add bounded repair-plan generation
  - Support external repair worker command integration
  - Keep dangerous unrestricted mode opt-in only
- Acceptance:
  - Failed MCP tests surface understandable next actions
  - Repair flow does not silently grant unsafe runtime access
  - Repair status and retest workflow are visible
- Validation:
  - Backend tests for repair-plan generation and worker invocation contracts
  - Manual verification for safe and dangerous modes
- Evidence: TBD

#### NB-WEB-105
- Title: MCP isolated test chat and runtime drill-down
- Priority: P1
- Status: NOT_STARTED
- Depends on: NB-WEB-103
- Scope:
  - Add per-MCP test chat that loads only the selected MCP
  - Show recent tool activity and tool list per MCP
  - Link main chat failures back to specific MCP detail views
- Acceptance:
  - User can validate one MCP in isolation
  - Test chat history is retained independently from the main chat
  - Failure drill-down shortens diagnosis path
- Validation:
  - Backend tests for isolated MCP chat runtime
  - Playwright flow for MCP test chat send/clear
- Evidence: TBD

### M3. Operations, Validation, and Observability

#### NB-WEB-201
- Title: Dashboard with readiness, setup progress, and next-step guidance
- Priority: P0
- Status: NOT_STARTED
- Depends on: NB-WEB-001, NB-WEB-002
- Scope:
  - Add a real dashboard landing page
  - Show setup progress, current readiness, key metrics, and suggested next step
  - Separate operational summary from raw system data
- Acceptance:
  - Authenticated landing page is a dashboard, not just a nav shell
  - User can understand what is missing in under one screen
  - Dashboard exposes quick actions for the next important tasks
- Validation:
  - Playwright dashboard smoke test
  - Manual review of setup states: empty, partial, complete
- Evidence: TBD

#### NB-WEB-202
- Title: Settings validation center
- Priority: P0
- Status: NOT_STARTED
- Depends on: NB-WEB-201
- Scope:
  - Add a validation run for provider, runtime, gateway, paths, and MCP readiness
  - Return direct recovery actions
  - Keep dangerous settings isolated from core settings
- Acceptance:
  - Settings page can validate the setup on demand
  - Validation items point to actionable next pages or fixes
  - Dangerous options are clearly separated and labeled
- Validation:
  - Backend tests for validation result generation
  - Playwright validation action flow
- Evidence: TBD

#### NB-WEB-203
- Title: Profile management
- Priority: P1
- Status: NOT_STARTED
- Depends on: NB-WEB-001
- Scope:
  - Add profile page for username, display name, email, password rotation, avatar upload
  - Persist profile data in GUI auth store
- Acceptance:
  - Profile updates persist across restart
  - Avatar upload is stored safely and displayed correctly
  - Password change invalidates old credentials when appropriate
- Validation:
  - Backend auth/profile persistence tests
  - Playwright avatar and profile update flow
- Evidence: TBD

#### NB-WEB-204
- Title: History, raw session access, logs, usage, status, restart, and update controls
- Priority: P1
- Status: NOT_STARTED
- Depends on: NB-WEB-201
- Scope:
  - Add dedicated history page and raw session inspection
  - Add logs page
  - Add usage summary page
  - Add richer status page
  - Add optional restart/update control hooks
- Acceptance:
  - Operator can inspect saved sessions, logs, status, and usage from the GUI
  - Restart/update actions are explicit and deployment-safe
  - Sensitive actions remain opt-in and configurable
- Validation:
  - Backend route tests for ops pages
  - Manual verification with configured and unconfigured restart/update hooks
- Evidence: TBD

### M4. Chat and Existing Backend Feature Exposure

#### NB-WEB-301
- Title: Chat workspace enhancement
- Priority: P1
- Status: NOT_STARTED
- Depends on: NB-WEB-201, NB-WEB-103
- Scope:
  - Add file upload in chat
  - Add runtime status panel
  - Add recent tool activity and active MCP/tool lists
  - Add quick prompts and clearer busy/error states
- Acceptance:
  - User can upload a file and get a response based on the stored workspace path
  - Runtime context is visible without leaving chat
  - Recent tool activity helps explain what happened
- Validation:
  - Playwright chat file upload flow
  - Backend tests for upload persistence and chat dispatch
- Evidence: TBD

#### NB-WEB-302
- Title: Unified markdown document center
- Priority: P1
- Status: PARTIAL
- Depends on: NB-WEB-001
- Scope:
  - Generalize current `AGENTS.md` editor into a document center
  - Support `MEMORY.md`, `HISTORY.md`, `AGENTS.md`, `SOUL.md`, `USER.md`, `HEARTBEAT.md`, `TOOLS.md`
  - Add preview and reset-to-template where appropriate
- Acceptance:
  - User can switch documents without leaving the editor workspace
  - Reset uses bundled templates safely
  - Current `AGENTS.md` behavior does not regress
- Validation:
  - Backend document persistence tests
  - Playwright document edit and reset flow
- Evidence: TBD

#### NB-WEB-303
- Title: Calendar UI for existing calendar API
- Priority: P1
- Status: PARTIAL
- Depends on: NB-WEB-000
- Scope:
  - Build a calendar/events page on top of the existing calendar API
  - Expose event CRUD, reminder settings, and calendar-generated jobs
- Acceptance:
  - User can manage events without calling the API manually
  - Reminder jobs are visible and traceable from the UI
  - Calendar operations remain consistent with cron state
- Validation:
  - Extend API tests with UI flow coverage
  - Manual end-to-end reminder verification
- Evidence: TBD

#### NB-WEB-304
- Title: Agent templates UI for existing template API
- Priority: P1
- Status: PARTIAL
- Depends on: NB-WEB-000
- Scope:
  - Build pages for list/create/edit/delete/import/export/reload of agent templates
  - Expose valid tools and template-level enablement
- Acceptance:
  - User can manage templates without raw API calls
  - Built-in vs workspace template behavior is clear
  - Import/export conflict behavior is visible and testable
- Validation:
  - Extend template API tests with UI flow coverage
  - Manual validation of import/export round trip
- Evidence: TBD

### M5. Community Integration

#### NB-WEB-401
- Title: Community hub client and browse-only marketplace integration
- Priority: P2
- Status: NOT_STARTED
- Depends on: NB-WEB-103, NB-WEB-201
- Scope:
  - Add optional community service client
  - Add discover/stacks/showcase pages
  - Surface read-only community metadata and recommendations
- Acceptance:
  - Community pages degrade safely when hub is not configured
  - Recommendations never block local-only usage
  - External data is clearly labeled as community-provided
- Validation:
  - Mocked backend tests for community client behavior
  - Manual verification in configured and unconfigured states
- Evidence: TBD

#### NB-WEB-402
- Title: Community install/import/publish flows
- Priority: P2
- Status: NOT_STARTED
- Depends on: NB-WEB-401, NB-WEB-102
- Scope:
  - Install MCP from community entries
  - Import stacks/showcase presets
  - Publish local MCP metadata to the community hub when write auth is enabled
  - Add telemetry preference toggles with strict data boundaries
- Acceptance:
  - Community-driven install/import flows write into local state safely
  - Publish actions are permission-gated and explicit
  - Telemetry never includes prompts, secrets, or private workspace paths
- Validation:
  - Contract tests for payload shape and auth behavior
  - Manual validation against a test community environment
- Evidence: TBD

### M6. Test and Release Hardening

#### NB-WEB-501
- Title: Stable GUI test selectors and Playwright E2E suite
- Priority: P0
- Status: NOT_STARTED
- Depends on: NB-WEB-001, NB-WEB-002, NB-WEB-103, NB-WEB-301
- Scope:
  - Add stable `data-testid` coverage for critical UI actions
  - Add Playwright suite for auth, setup, chat, MCP, profile, and persistence
  - Use isolated GUI runtime for tests
- Acceptance:
  - Critical GUI workflows are covered by browser automation
  - Tests are resilient to text and layout changes
  - Test runtime does not touch the user's normal `~/.nanobot`
- Validation:
  - `npm run test:e2e:critical`
  - Artifact capture for screenshots and failure traces
- Evidence: TBD

#### NB-WEB-502
- Title: Backend integration tests for GUI services
- Priority: P0
- Status: NOT_STARTED
- Depends on: NB-WEB-103, NB-WEB-202, NB-WEB-302
- Scope:
  - Add service-level tests for auth, setup persistence, MCP service, validation, and markdown docs
  - Add fixture-based MCP backend tests
- Acceptance:
  - Core GUI business logic is testable without a browser
  - MCP lifecycle regressions are caught with local fixtures
- Validation:
  - `pytest` target for GUI service and route tests
- Evidence: TBD

#### NB-WEB-503
- Title: Accessibility smoke, CI split, and release verification
- Priority: P1
- Status: NOT_STARTED
- Depends on: NB-WEB-501, NB-WEB-502
- Scope:
  - Add a11y smoke checks
  - Add PR vs main branch CI split for critical/full GUI tests
  - Add release verification checklist for GUI packaging
- Acceptance:
  - PRs run a bounded critical suite
  - Main/nightly runs full suite
  - Release process validates both Python backend and frontend bundle
- Validation:
  - CI workflows complete successfully on a test branch
  - Release checklist document exists and is exercised once
- Evidence: TBD

## Recommended Build Order

1. `NB-WEB-000`
2. `NB-WEB-001`
3. `NB-WEB-002`
4. `NB-WEB-101`
5. `NB-WEB-103`
6. `NB-WEB-201`
7. `NB-WEB-202`
8. `NB-WEB-301`
9. `NB-WEB-302`
10. `NB-WEB-303`
11. `NB-WEB-304`
12. `NB-WEB-102`
13. `NB-WEB-104`
14. `NB-WEB-105`
15. `NB-WEB-203`
16. `NB-WEB-204`
17. `NB-WEB-501`
18. `NB-WEB-502`
19. `NB-WEB-503`
20. `NB-WEB-401`
21. `NB-WEB-402`

## Release Gate for "Web GUI Parity"

Do not claim parity with the reference WebGUI until these tasks are `DONE`:
- `NB-WEB-001`
- `NB-WEB-002`
- `NB-WEB-101`
- `NB-WEB-102`
- `NB-WEB-103`
- `NB-WEB-201`
- `NB-WEB-202`
- `NB-WEB-204`
- `NB-WEB-301`
- `NB-WEB-501`
- `NB-WEB-502`

## Suggested Status Summary Template

Use this block in future progress updates:

```md
Progress Summary
- Done:
- In progress:
- Blocked:
- Next:

Validation Summary
- Automated:
- Manual:
- Risks:
```
