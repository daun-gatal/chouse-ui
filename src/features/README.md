# src/features Blueprint

## System Overview

Feature-based frontend modules of the CHouse UI React SPA. Each folder owns the components, TanStack Query hooks and pure helpers for one product area; network access goes through the typed clients in `src/api/` and global state through the Zustand stores in `src/stores/`. This folder has no source files of its own.

## Subdirectories & System Boundaries

- admin: [admin](./admin/README.md) - Admin area: user, role, connection, SSO, AI model, alerting, data access and native ClickHouse user/role management pages, plus the admin route guard.
- agents: [agents](./agents/README.md) - AI Governance panels for the MCP endpoint (server settings, OAuth sign-in, client snippets, write-tool bounds, per-tool toggles) and agent budget policies, plus pure MCP and policy-form helpers; child folders hold the other AI Governance tabs.
- alerting: [alerting](./alerting/README.md) - Alerting dialogs: notification channel wizard (Platform, Connect, Test, Who can act), fleet alert rule editor and the who-can-act allowlist editor, via `@/api/alerting`.
- auth: [auth](./auth/README.md) - Infers an SSO brand from a provider id and display name and renders the matching logo, falling back to a generic OIDC/SAML glyph.
- buddy: [buddy](./buddy/README.md) - Chobi, the floating AI buddy (ADR 0025): a draggable drop-target launcher and a three-size panel (bubble, docked, focus) with Now, Chat and Activity tabs, rendered in a portal above dialogs; briefing and settings come from TanStack Query hooks.
- dashboards: [dashboards](./dashboards/README.md) - Pure helpers and query keys for the dashboards feature (list filtering/paging, URL view state, drill-down links, chart overlays, version diff, Ask AI review reducer, connection scope) plus one hook that reveals newly added panels; `index.ts` re-exports the main components and `dashboardKeys`.
- data-health: [data-health](./data-health/README.md) - Data Health UI scoped to the active connection: KPI overview and coverage gaps, dataset promises with detail view, incidents, and a 3-step `PromiseWizard`; hooks wrap `@/api/dataHealth`, AI features use `@/api/dataOpsAi`.
- dataops-ai: [dataops-ai](./dataops-ai/README.md) - AI DataOps presentation components: an operational brief card for scheduled queries and data-health promises, an insight dialog shell and read-only result views, via `@/api/dataOpsAi`.
- explorer: [explorer](./explorer/README.md) - Data Explorer sidebar, DDL dialogs and file import wizard.
- fleet: [fleet](./fleet/README.md) - Fleet overview and ChouseD doctor report components.
- metrics: [metrics](./metrics/README.md) - uPlot time-series chart component used for metrics.
- observe: [observe](./observe/README.md) - Frontend for the Data Observability Platform (ADR 0016) and the Monitoring > Upgrades page (ADR 0029): Data page tabs (Overview, Incidents, Lineage, Pipelines, Datasets, Coverage, Context), Monitoring Capacity/Performance/Upgrades views, remediation fixes, investigation notebooks, the collector schedule, and shared TanStack hooks, helpers and UI pieces. Every read is scoped to the active connection.
- onboarding: [onboarding](./onboarding/README.md) - Permission-aware in-app onboarding: a chapter/step registry filtered by RBAC and connection state, a zustand store persisting progress server-side, a Getting Started hub (incl. first-install bootstrap and password change) and a portal Coachmark.
- rbac: [rbac](./rbac/README.md) - RBAC roles, audit log, personal access token, connected app and chat identity UI.
- scheduled-queries: [scheduled-queries](./scheduled-queries/README.md) - Scheduled Queries (DataOps): overview and jobs tabs, job detail, create/edit wizard, runs history, lineage graph, Monaco SQL test-run editor, a `{{...}}` macro compiler and hooks over `@/api/scheduledQueries`.
- workspace: [workspace](./workspace/README.md) - SQL workspace: tabbed query UI, EXPLAIN visualizers, info tabs and the Monaco SQL editor.

## Global Invariants

- UI gating is client-side only and mirrors server RBAC: features check `RBAC_PERMISSIONS.*` via `useRbacStore().hasPermission` or `PermissionGuard` (e.g. `[admin/routes/adminRoute.tsx:AdminRoute]`, `[explorer/components/TreeNode.tsx:TreeNode]`); the server remains the authority, e.g. two-approver remediation rules are enforced server-side `[observe/RemediationPanel.tsx:ActionCard]`
- Reads are scoped to the active connection from `useAuthStore` (e.g. `[observe/hooks.ts:useConnection]`, `[data-health/hooks.ts:useDataHealthOverview]`, `[dashboards/scope.ts:scopeForNew]`)
- AI drafts never save on their own: users must review and accept (`[agents/assistant/DraftWithAi.tsx:useSaveGuard]`, `[observe/contextDraft.ts:applyContextDraft]`, `[buddy/chat/MemorySuggestions.tsx:MemorySuggestions]`)
- Every `dangerouslySetInnerHTML` is fed DOMPurify-sanitized HTML: query results (`[workspace/components/SqlTab.tsx:SqlTab]`, `[workspace/components/infoTab/DataSampleSection.tsx:DataSampleSection]`) and highlight.js-highlighted SQL/code (`[explorer/components/ManualCreationForm.tsx:ManualCreationForm]`, `[buddy/chat/ChobiChat.tsx:markdownComponents]`)

## Global Side Effects

- HTTP calls through `src/api/*` clients; the one exception is `ImportWizard`, which uses raw `fetch` for `/api/upload/preview` and `/api/upload/create` `[explorer/components/ImportWizard/ImportWizard.tsx:ImportWizard]`
- TanStack Query caches, polling intervals and invalidation per feature (e.g. `[observe/hooks.ts:observeKeys]`, `[dashboards/hooks.ts:dashboardKeys]`)
- Cross-feature window events: `ai-config-updated` `[admin/components/AiModels/ConfigsTab.tsx:ConfigsTab]`, `ai-agents-updated` `[agents/assistant/hooks.ts:useRefresh]`, `chouse:open-chat-thread` `[agents/usage/lib.ts:openChatThread]`, `onboarding:open` (listened to in `[onboarding/OnboardingProvider.tsx:OnboardingProvider]`) and `shortcuts:open` (listened to in `[workspace/components/SqlTab.tsx:SqlTab]`)
- Workspace store tab creation from many features via `useWorkspaceStore.addTab` (e.g. `[buddy/chat/ChobiChat.tsx:handleUiStep]`)

## System Verification

- Run: `bunx vitest run src/features` (from repo root; full suite: `bunx vitest run`)
