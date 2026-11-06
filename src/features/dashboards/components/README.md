# dashboards/components

## Overview

React UI for the Dashboards feature: list and single-dashboard view with a local edit session, the grid canvas, panel cards and editors, and dialogs for settings, connections, sharing, alerts, reports, snapshots, version history, panel cost, Grafana import, Explain-spike and the full-screen Ask AI draft review. Server I/O goes through `@/api/dashboards` (plus `@/api/alerting` and `rbacConnectionsApi`) via TanStack Query.

## Interface

- `[DashboardList.tsx:DashboardList]` - dashboards assigned to the active connection with URL-driven tabs, search, sort and paging; `[DashboardList.tsx:readImport]` parses a CHouse export (`EXPORT_FORMATS` v1/v2) or Grafana JSON
- `[DashboardView.tsx:DashboardView]` - one dashboard: view bar, canvas and a local draft edit session saved whole at the loaded version
- `[DashboardCanvas.tsx:DashboardCanvas]` - 24-column react-grid-layout canvas, draggable only while editing; stacks in `readingOrder` below `STACK_BELOW_PX` (768)
- `[PanelCard.tsx:PanelCard]` - runs `runPanel` (+ compare run and `getBaseline`) and draws overlays; also `StaticChartCard`, `TextPanelCard`, `HeadingPanelCard`, `DRAG_HANDLE_CLASS`
- `[PanelEditor.tsx:PanelEditor]` / `fleetProblem` - chart panel editor with Monaco SQL, viz spec and `previewPanel` preview; `[PanelExtrasEditor.tsx:PanelExtrasEditor]` - expected-range band and drill-down links
- `[PanelAlerts.tsx:PanelAlertsButton]` / `useDashboardAlerts` - per-panel threshold/outside_band alert bell and dialog
- `[AskAiDialog.tsx:AskAiDialog]` - full-screen AI draft review creating a dashboard or adding panels; parts in `AskAiHeader.tsx`, `AskAiPanelList.tsx`, `AskAiPanelDetail.tsx`, `AskAiPreview.tsx` (`askAiKeys`), `AskAiPrompt.tsx` (`MIN_GOAL_LENGTH`=8, `MAX_GOAL_LENGTH`=4000), `askAiLayer.ts` (`REVIEW_LAYER`, `PICKER_LAYER`)
- `[DashboardSettingsDialog.tsx:DashboardSettingsDialog]` / `variableProblems` - draft settings and variables; `[ConnectionsField.tsx:ConnectionsField]` / `scopeProblem`; `[ConnectionsDialog.tsx:ConnectionsDialog]` - scope change outside an edit session
- `[ChartActions.tsx:ChartActionsDialog]`, `AnnotationDialog`, `NoteDialog` - chart click/range actions (Explain spike, zoom, links, bucket queries, notes)
- `[ShareDialog.tsx:ShareDialog]`, `[SnapshotsDialog.tsx:SnapshotsDialog]`, `[SnapshotView.tsx:SnapshotView]`, `[VersionHistoryDialog.tsx:VersionHistoryDialog]`, `[ReportsDialog.tsx:ReportsDialog]`, `[PanelCostDialog.tsx:PanelCostDialog]`, `[ExplainSpikeDialog.tsx:ExplainSpikeDialog]`, `[GrafanaImportDialog.tsx:GrafanaImportDialog]`, `[TextPanelDialog.tsx:TextPanelDialog]` - per-feature dialogs
- `[PinToDashboardDialog.tsx:PinToDashboardDialog]`, `[PinnedDashboards.tsx:PinnedDashboards]`, `[OpenAsDashboardButton.tsx:OpenAsDashboardButton]`, `[NotAssignedNotice.tsx:NotAssignedNotice]`, `[ViewControls.tsx:ViewControls]`, `[PanelSqlEditor.tsx:default]` - entry points used by other pages, view bar and lazy Monaco editor

## Invariants

- Permission gating via `RBAC_PERMISSIONS`: DASHBOARDS_EDIT gates create/import/duplicate/`OpenAsDashboardButton`; AI_OPTIMIZE gates Ask AI and Explain spike; ALERTING_VIEW/EDIT/DELETE gate alerts and reports; QUERY_EXECUTE gates Ask AI preview and snapshots; DASHBOARDS_VIEW gates `PinnedDashboards`; panel-cost rollup proposals need REMEDIATION_PROPOSE plus `access.edit`, and existing rollup fixes are listed for any of REMEDIATION_PROPOSE/APPROVE/APPROVE_HIGH `[PanelCostDialog.tsx:PanelCostDialog]` `[DashboardList.tsx:DashboardList]` `[DashboardView.tsx:DashboardView]` `[PanelAlerts.tsx:PanelAlertsButton]` `[PinnedDashboards.tsx:PinnedDashboards]`
- Per-dashboard server access flags: edit/Ask AI/`?edit=1` need `access.edit`, Share needs `access.share`, Delete needs `access.delete` `[DashboardView.tsx:DashboardView]`
- Optimistic concurrency: saves pass the loaded `dashboard.version` to `updateDashboard`; a 409 sets `conflict` and offers reload without merging; Ask AI and Pin re-read with `getDashboard` before saving `[DashboardView.tsx:DashboardView]` `[ConnectionsDialog.tsx:ConnectionsDialog]` `[PinToDashboardDialog.tsx:PinToDashboardDialog]`
- Connection scoping: panels do not run on a scope-'only' dashboard not assigned to the active connection (`NotAssignedNotice` shown); Ask AI saves throw if the active connection changed `[DashboardView.tsx:DashboardView]` `[AskAiDialog.tsx:AskAiDialog]`
- Validation blocks save: `scopeProblem`, `variableProblems`, `fleetProblem`, alert forms clamp everyMinutes 1-1440 and forEvaluations 1-60 `[DashboardSettingsDialog.tsx:variableProblems]` `[PanelEditor.tsx:fleetProblem]` `[PanelAlerts.tsx:AlertForm]`
- At most 10 variables: the Add variable button is disabled at `variables.length >= 10` (matching `MAX_VARIABLES` in `@/lib/viz/spec`) `[DashboardSettingsDialog.tsx:DashboardSettingsDialog]`
- Panels changed in the edit session are not run by stored id (`runnableId` returns null); text Markdown never renders raw HTML `[DashboardView.tsx:DashboardView]` `[PanelCard.tsx:TextPanelCard]`

## Side Effects

- `@/api/dashboards` queries/mutations (list/get/create/update/delete/duplicate/export/import, `runPanel`, `previewPanel`, `draftDashboard`, `getAnnotations`, `addNote`, `explainSpike`, `setShares`, `getPanelCost`, `proposeRollup`, alerts, reports, snapshots, versions) `[DashboardView.tsx:DashboardView]` `[PanelAlerts.tsx:useDashboardAlerts]` `[SnapshotsDialog.tsx:SnapshotsDialog]`
- Query invalidation of `dashboardKeys.*` and `setQueryData(dashboardKeys.detail(id))` after save/restore; Ask AI previews use a separate `['ask-ai-draft', ...]` key prefix `[AskAiPreview.tsx:askAiKeys]`
- Timers: alerts refetch every 60s, panels on the dashboard refresh interval, baseline at most every 300s, Ask AI previews limited via `createLimiter(3)` `[PanelAlerts.tsx:useDashboardAlerts]` `[PanelCard.tsx:PanelCard]` `[AskAiPreview.tsx:askAiKeys]`
- Navigation/URL: `navigate('/dashboards/:id')`, `setSearchParams(replace)`; `NotAssignedNotice` calls `activateConnection` then `window.location.assign` `[NotAssignedNotice.tsx:NotAssignedNotice]`
- sonner toasts and `log.error` on save/pin/switch failures; Blob export download; `useWorkspaceStore.addTab` for bucket queries; `beforeunload` listener while an Ask AI draft is open `[DashboardView.tsx:DashboardView]` `[AskAiDialog.tsx:AskAiDialog]`

## Verification

- Run: `bunx vitest run src/features/dashboards/components` (from repo root; full suite: `bunx vitest run`)
