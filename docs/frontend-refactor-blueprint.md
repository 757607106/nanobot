# Nanobot Web UI Frontend Refactor Blueprint

## 1. Goal

This refactor is not about adding more pages. It is about making the existing product understandable, stable, and scalable.

North-star goals:

- One navigation system, not several stacked on top of each other.
- One route contract that supports direct deep links, sidebar navigation, and tests consistently.
- Core entities must use route-level detail pages instead of oversized drawers.
- Structured field editors should replace raw JSON and free-text list editing wherever possible.
- Visual language should be unified so pages feel like one product instead of several mini consoles.

## 2. Current Problems

| Problem | Current symptom | Impact |
| --- | --- | --- |
| Route contract drift | App routes center on `/chat`, `/studio/*`, `/system/admin`, but critical E2E still expects `/dashboard` and `/profile` | Deep links, tests, and mental model have already diverged |
| Too many nav layers | Global left nav plus `StudioLayoutPage`, `ChannelsLayoutPage`, `SystemLayoutPage`, `AutomationPage`, and even Drawer tabs in `TeamsPage` | Users lose orientation and page titles stop matching the real location |
| Giant single pages | `KnowledgePage` 1516 lines, `TeamsPage` 1375, `ChatPage` 1112, `AgentsPage` 886 | Any change becomes risky and slows every future requirement |
| Raw field design | MCP env/header, template tools/rules/skills, knowledge FAQ source content, and other structured values rely on `TextArea` or hand-typed JSON | High user error rate and poor editability |
| Page ownership is duplicated | `TemplatesPage` appears under both Studio and System; team memory exists both inside `TeamsPage` and as `MemoryAuditPage` | Entry duplication, inconsistent workflows, and unclear IA |
| Visual language is inconsistent | Most pages use `PageHero`, while Agents and Teams use their own stat-card language; English and Chinese labels mix randomly | Product tone feels unfinished and less trustworthy |
| Performance budget is already stressed | Build passes but shared Ant Design chunk is very large | First load and large-page interaction risk getting worse after each feature |

## 3. New Information Architecture

### 3.1 First-level navigation

Reduce the global navigation to five stable product areas:

| First-level area | Purpose | Routes |
| --- | --- | --- |
| Workbench | Main conversation and task entry | `/chat` |
| Studio | Agent, team, run, knowledge, template authoring | `/studio/*` |
| Integrations | Model, channel, routing, skill, MCP configuration | `/integrations/*` |
| Workspace | Workspace-wide behavior and operating rules | `/workspace/prompt` |
| System | Health, automation, validation, operations, account | `/system/*` |

### 3.2 Route tree

Use route-based detail pages instead of drawers and query-param tabs.

```text
/
  chat
  studio
    agents
    agents/new
    agents/:agentId
    agents/:agentId/capabilities
    agents/:agentId/testing
    teams
    teams/new
    teams/:teamId
    teams/:teamId/runs
    teams/:teamId/memory
    runs
    runs/:runId
    knowledge
    knowledge/new
    knowledge/:kbId
    knowledge/:kbId/ingestion
    knowledge/:kbId/sources
    knowledge/:kbId/documents
    knowledge/:kbId/testing
    templates
  integrations
    models
    channels
    channels/:channelName
    bindings
    skills
    mcp
    mcp/:serverName
    mcp/:serverName/probe
    mcp/:serverName/testing
  workspace
    prompt
  system
    overview
    validation
    automation/calendar
    automation/cron
    operations
    account
```

### 3.3 Migration rule

Do not break all old links at once. Add aliases and soft redirects first:

- `/models` -> `/integrations/models`
- `/channels/*` -> `/integrations/channels/*` or `/integrations/bindings`
- `/mcp/*` -> `/integrations/mcp/*`
- `/skills` -> `/integrations/skills`
- `/prompt` -> `/workspace/prompt`
- `/system/admin` remains valid but becomes canonical `/system/account`
- Remove `/studio/memory` as a standalone page and redirect to `/studio/teams/:teamId/memory`

## 4. Unified Interaction Model

### 4.1 Page types

Every page should follow one of three page archetypes.

| Page type | Use cases | Interaction rule |
| --- | --- | --- |
| Master-detail | Agents, Teams, Knowledge, Channels, Bindings | Desktop uses list + detail. Mobile uses list route and detail route. No Drawer for core editing. |
| Console | Chat, Runs, Validation, Operations, MCP isolated test | Left side keeps context, main panel shows execution or conversation, right side shows evidence or diagnostics. |
| Settings form | Models, Prompt, Profile, Setup | Group fields by intent, keep advanced options collapsed, keep save/test actions pinned. |

### 4.2 Navigation rules

- The global sidebar only switches first-level areas.
- Each first-level area may have exactly one local navigation style.
- Local navigation should be route-driven, not state-driven.
- The top header must show the real page title and breadcrumb, not only the first-level label.
- If a page opens more than one major mode, use child routes instead of Tabs inside a Drawer.

### 4.3 Layout rules

- Standard page structure: `PageHeader`, `PageToolbar`, `PageBody`.
- `PageHeader` contains title, summary, entity badges, and primary CTA.
- `PageToolbar` contains filters, search, secondary actions, and segment controls.
- `PageBody` uses one of three grids: `detail-grid`, `console-grid`, or `settings-grid`.
- Drawer usage should be reserved for lightweight preview actions, not entity creation or primary editing.

## 5. Visual System

### 5.1 Keep

- Keep the general `PageHero` direction. It already gives pages identity and structure.
- Keep the chat-focused shell treatment for `/chat`; it feels more task-oriented than the generic card pages.
- Keep the badge-driven summary pattern for entity state, counts, and mode indicators.

### 5.2 Remove or merge

- Remove the separate Agents and Teams visual language and fold them into the shared page system.
- Remove random English eyebrow labels such as `Templates`, `Calendar`, `Operations Center`, `MCP Detail`, and `FIRST-RUN SETUP`.
- Remove "stats first, form second" layouts where the stats are not actionable.
- Remove repeated tab shells that visually look the same but behave differently.

### 5.3 New design direction

- Tone: calm operations console, not generic AI dashboard.
- Typography: keep one display family and one body family across the product instead of per-page drift.
- Color: let Workbench stay slightly immersive, but keep all admin and configuration surfaces on one shared token system.
- Motion: only use transitions to explain navigation, section changes, and state completion; do not add decorative motion everywhere.

## 6. Field System Refactor

Turn repeated raw inputs into reusable field components.

| New field component | Replace current raw fields | Pages |
| --- | --- | --- |
| `TagListField` | Comma-separated tags, free-text tag areas | Agents, Teams, Knowledge |
| `RuleListEditor` | Rules entered as one line per rule in plain textarea | Agents, Templates |
| `CapabilityPicker` | Tool, skill, MCP, knowledge bindings spread across ad-hoc card grids | Agents, Templates |
| `EntityMultiPicker` | Member, supervisor, shared KB multi-selects with duplicated patterns | Teams, Bindings |
| `KeyValueEditor` | MCP env vars and headers pasted as JSON | MCP detail |
| `CredentialFieldGroup` | Provider key, base URL, proxy, token inputs spread with inconsistent hints | Setup, Models, Channels |
| `SourceComposer` | URL, FAQ, and file ingest flows split into ad-hoc local state | Knowledge |
| `FaqTableEditor` | FAQ JSON textarea | Knowledge source editor |
| `ScheduleBuilder` | Free-form cron and date settings mixed in one form | Cron, Calendar |
| `TestConsole` | Test message boxes embedded differently across pages | Agent testing, Team testing, MCP testing, Retrieval testing |
| `SearchModeField` | Repeated keyword/hybrid/semantic segmented controls | Knowledge, Team memory |

### 6.1 Field simplification rules

- Onboarding should only ask for the smallest successful configuration.
- Advanced controls must be behind a single, visible "Advanced settings" collapse.
- Structured data must be edited as rows, chips, or key-value entries, not raw JSON by default.
- Testing inputs should always live next to the configuration they validate.
- Every destructive bulk action must show the affected count before confirmation.

## 7. Page-by-page Audit

### 7.1 Auth and workspace

| Page | Current function and key fields | Keep | Remove or merge | New interaction |
| --- | --- | --- | --- | --- |
| `LoginPage` | Username, password, auth entry | Keep | None | Preserve the brand entry page, but redirect after login using the same canonical route contract as the app shell |
| `SetupPage` | Provider, model, API key, API base, channel token, allowlist, proxy, workspace, token limits, context window, temperature, reasoning | Keep provider, model, API key, workspace, optional channel skip | Move API base, token limits, context window, temperature, and most channel advanced settings out of onboarding | Rebuild as a 3-step setup with "Connect model", "Optional channel", "Finish workspace" |
| `ChatPage` | Session search, new session, file upload, recent uploads, composer, rename session | Keep all core chat functions | Remove oversized empty state and duplicate context surfaces | Use a three-column console: sessions, active conversation, workspace context; make context collapsible |
| `MainPromptPage` | Workspace prompt document, mode selector, reset default | Keep full file editing and reset | Remove raw single-pane editing as the only view | Add split view with document tree, prompt editor, diff/history, and publish action |

### 7.2 Integrations

| Page | Current function and key fields | Keep | Remove or merge | New interaction |
| --- | --- | --- | --- | --- |
| `ChannelsLayoutPage` | Tabs between channel list and message routing | Keep the concept of local navigation | Remove Tabs as a second app shell if the same styling is used elsewhere | Convert to a small local nav or breadcrumb with two stable subroutes |
| `ChannelsPage` | Channel cards and delivery settings | Keep channel overview | Move global delivery policy out of the same visual block as channel cards if it is workspace-wide | Use directory cards with clear state, error, and last test result badges |
| `ChannelDetailPage` | Dynamic channel config fields, enabled switch, testing, WhatsApp binding flow | Keep connection fields, enable toggle, test action, channel-specific connection state | Remove monolithic dynamic form feel and mix of connection and operations in one long page | Use sections: Connection, Delivery, Access, Validation; model channel-specific flows as step cards |
| `ChannelBindingsPage` | `channelName`, `channelChatId`, `targetType`, `targetId`, `priority`, `enabled` | Keep all existing binding fields | Remove agent-style reused presentation and list/edit blending | Use master-detail with conflict preview, resolution hints, and effective route summary |
| `ModelsPage` | Provider, model, API key, API base, max tokens, temperature, context window, reasoning effort, tool iterations | Keep provider, model, credentials, reasoning controls | Stop hiding important but non-dangerous controls only in dev mode | Split into Basics and Advanced; add connection test and capability summary |
| `SkillsPage` | Skill market, installed skills, upload, install, delete | Keep market and installed split | Remove wide, airy cards that limit scan speed | Use denser marketplace cards and a right-side installed drawer only for preview, not primary management |
| `McpPage` | Registry and install surface | Keep | None | Improve scanability with filters by status, transport, and availability |
| `McpServerDetailPage` | Display name, enabled, transport, timeout, command, args, URL, env, headers, isolated test chat | Keep all config and isolated testing | Remove raw JSON editing as default | Split into Config, Probe, Repair, and Test subviews; use key-value editors for env and headers |

### 7.3 Studio

| Page | Current function and key fields | Keep | Remove or merge | New interaction |
| --- | --- | --- | --- | --- |
| `StudioLayoutPage` | Tabs for Agents, Teams, Runs, Knowledge | Keep the grouping | Stop overloading hidden routes like memory and templates under unrelated tabs | Use a real Studio local nav that includes Templates and lets team memory live under Team detail |
| `AgentsPage` | Name, model, tags, enabled, description, system prompt, rules, tool/skill/MCP/KB bindings, memory scope, backend, test run | Keep all core agent fields and test run | Remove Drawer as the main editing surface and avoid tabbing inside the drawer | Split into entity route with Overview, Capabilities, and Testing subroutes |
| `TeamsPage` | Name, enabled, description, supervisor, members, shared KB, tags, knowledge policy, memory policy, team thread, test run, memory draft, candidate review, search | Keep config, runs, memory, and review workflow | Remove one Drawer containing three entire products | Convert to full route detail with child routes: Overview, Runs, Memory |
| `MemoryAuditPage` | Team memory audit, candidate review, search, source preview | Keep the capability | Remove the standalone page | Merge into `TeamsPage` memory route |
| `RunsPage` | Filters, run list, run detail, task tree, thread/run evidence | Keep | Remove list/detail ambiguity when selected run changes without route clarity | Use a stable left run list and right detail route; detail uses Overview, Task tree, Conversation, Artifacts |
| `KnowledgePage` | KB settings, ingest, source management, document list, bulk actions, jobs, retrieval testing | Keep everything except the raw source editing style | Remove giant one-page tabbed editor and FAQ JSON textarea | Split into Overview, Ingestion, Sources, Documents, Jobs, Testing child routes |
| `TemplatesPage` | Name, enabled, summary, model, executor, tools, rules, skills, system prompt, import/export | Keep template authoring and import/export | Remove duplicate route under System and replace raw list textareas | Keep only under Studio; use structured capability and rule editors |
| `CollaborationPlaceholderPage` | Placeholder shell | None | Delete | Remove from codebase |

### 7.4 System

| Page | Current function and key fields | Keep | Remove or merge | New interaction |
| --- | --- | --- | --- | --- |
| `SystemLayoutPage` | Tabs for system status, validation, automation, templates, operations, account | Keep system grouping | Remove Templates from System and stop mixing dev-only entries invisibly into IA | Use Overview, Validation, Automation, Operations, Account |
| `SystemPage` | Backend health and environment summary | Keep | None | Make it the system home page with clear links into diagnostics and repair pages |
| `AutomationPage` | Query-param tab switch between Calendar and Cron | Keep the grouping | Remove query-param tab navigation as the primary route model | Use child routes `/system/automation/calendar` and `/system/automation/cron` |
| `CalendarPage` | Title, description, start, end, timezone, all-day, reminder, reminder target, notification settings | Keep | Remove isolated scheduling patterns that differ from cron page | Rebuild on top of shared `ScheduleBuilder` and `NotificationTargetField` |
| `CronPage` | Name, deleteAfterRun, payloadMessage, trigger type, interval/date/cron, timezone, delivery target | Keep | Remove overly raw cron-first experience for common users | Lead with simple schedule presets, keep raw cron in advanced mode |
| `ValidationPage` | Core checks and dangerous config isolation | Keep | None | Present failures as actionable repair cards, not only status tiles |
| `OperationsPage` | Logs and ops center | Keep | None | Treat as an execution console with filter, stream, and detail panes |
| `ProfilePage` | Username, display name, email, avatar upload, password rotation | Keep | None | Keep as a clean settings form with profile and security sections |

## 8. Explicit Delete, Merge, and Preserve List

### 8.1 Delete

- `CollaborationPlaceholderPage`
- Standalone `MemoryAuditPage` route
- Duplicate `TemplatesPage` route under System
- Drawer-first editing for Agents and Teams
- Raw FAQ JSON editing as the primary source editing mode

### 8.2 Merge

- Team memory review into Team detail
- Calendar and Cron under one Automation route family
- Workspace behavior editing under one Workspace area
- Channel binding conflict review into the binding detail editor

### 8.3 Preserve

- Main chat workflow and file upload
- Knowledge retrieval testing
- MCP isolated test chat
- Run trace and execution evidence
- Setup wizard as a concept, but with fewer fields

## 9. First Implementation Batch

This is the highest-return first batch. Do not start with cosmetic polish.

| Order | Target | Why first |
| --- | --- | --- |
| 1 | `App.tsx`, `AppShell.tsx`, layout pages, route aliases | Fixes navigation, deep links, breadcrumbs, and test contract in one move |
| 2 | `AgentsPage` | Establishes the new master-detail and subroute editing pattern |
| 3 | `TeamsPage` plus memory merge | Removes the worst Drawer overload and deletes duplicate memory entry points |
| 4 | `KnowledgePage` | Breaks the largest page into stable child routes and reusable source editors |
| 5 | `SetupPage` | Reduces onboarding friction and stops setup fields drifting from model and channel configuration |

## 10. Implementation Sequence

### Phase 1: Contract and shell

- Canonicalize routes and repair direct deep-link behavior.
- Update test IDs and E2E flows to the real route names.
- Replace header title logic so it reflects the real leaf page.
- Add breadcrumbs driven by route metadata.

### Phase 2: Entity detail refactor

- Move Agents and Teams from Drawer editing to route editing.
- Introduce shared master-detail layout.
- Introduce shared action bar, section header, and test console.

### Phase 3: Field system extraction

- Build `TagListField`, `RuleListEditor`, `KeyValueEditor`, `SourceComposer`, `ScheduleBuilder`.
- Replace raw JSON and comma-split parsing page by page.
- Standardize advanced settings collapse.

### Phase 4: Knowledge and run surfaces

- Split Knowledge into route modules.
- Rework Runs into a stable list/detail console.
- Unify test and evidence patterns across knowledge, agent, team, and MCP pages.

### Phase 5: Visual and performance cleanup

- Move page-specific styling out of the monolithic `index.css` into domain-level style files.
- Virtualize large lists where message, document, or run volume can grow.
- Lazy-load heavy detail panels and testing consoles only when entered.

## 11. Non-goals

- Do not redesign the product brand from scratch.
- Do not replace Ant Design in this refactor.
- Do not rebuild every page at once.
- Do not add new top-level features before route, field, and page contracts are stable.

## 12. Success Criteria

The refactor is successful only if all of the following become true:

- A direct URL load lands on the same page that sidebar navigation reaches.
- Every core entity can be created, edited, tested, and deleted without opening a primary Drawer.
- Setup, Models, Channels, MCP, Agents, Teams, and Knowledge no longer rely on raw JSON or ad-hoc text parsing for common configuration flows.
- Templates and team memory each have exactly one canonical place in the product.
- A user can always answer: where am I, what object am I editing, what will happen if I save, and where do I go next.
