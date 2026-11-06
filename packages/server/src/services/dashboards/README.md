# Custom Dashboards

## Overview
Custom dashboards (ADR 0021, ADR 0023): the strict document spec, storage with versions/shares/pins, panel execution with macros and a shared result cache, layout, lint, panel threshold alerts, scheduled reports, snapshots, annotations, baselines, rollups, templates, Grafana import and AI draft/explain support.

## Interface
- Spec and validation: `[spec.ts:vizSpecSchema]`, `[spec.ts:CHART_TYPES]`, `[validate.ts:dashboardProblems]`, `[validate.ts:panelProblems]`, `[legacy.ts:parseDashboardDocument]`, `[legacy.ts:parseDashboardExport]`, `[legacy.ts:convertDashboardV1]`.
- Store: `[store.ts:createDashboard]`, `[store.ts:updateDashboard]`, `[store.ts:deleteDashboard]`, `[store.ts:getDashboard]`, `[store.ts:listDashboards]`, `[store.ts:listVersions]`, `[store.ts:setShares]`, `[store.ts:pin]`, `[store.ts:SaveConflictError]`.
- Access: `[access.ts:dashboardAccess]`, `[access.ts:viewerConnections]`.
- Execution: `[runner.ts:runPanel]`, `[runner.ts:runPanelWindow]`, `[runner.ts:runFleet]`, `[runner.ts:runOptions]`, `[runner.ts:compilePanel]`, `[macros.ts:compileSql]`, `[macros.ts:resolveWindow]`, `[cache.ts:ResultCache]`, `[cache.ts:KeyedSemaphore]`, `[time.ts:toUtcMs]`.
- Layout and lint: `[layout.ts:arrange]`, `[layout.ts:tidy]`, `[layout.ts:appendBelow]`, `[lint.ts:lintPanel]`, `[lint.ts:chartFit]`.
- Alerts: `[alertStore.ts:createAlert]`, `[alertStore.ts:updateAlert]`, `[alertStore.ts:listAlerts]`, `[alerts.ts:DashboardAlertEvaluator]`, `[alerts.ts:evaluate]`.
- Reports: `[reports.ts:createReport]`, `[reports.ts:runReport]`, `[reports.ts:DashboardReportScheduler]`, `[reportDigest.ts:nextRunAt]`, `[reportDigest.ts:buildDigest]`.
- Snapshots, annotations, baselines: `[snapshots.ts:createSnapshot]`, `[snapshots.ts:openSnapshot]`, `[snapshots.ts:deleteExpiredSnapshots]`, `[annotations.ts:loadAnnotations]`, `[annotations.ts:addNote]`, `[baseline.ts:runBaseline]`.
- Rollups: `[rollup.ts:analyzeRollup]`, `[rollup.ts:rollupTarget]`, `[rollupAction.ts:switchPanelToRollup]`, `[rollupAction.ts:RollupPrecondition]`.
- Templates and import: `[templates.ts:TEMPLATES]`, `[templates.ts:findTemplate]`, `[grafana.ts:convertGrafana]`.
- AI: `[draft.ts:finalizeDraft]`, `[draftEvidence.ts:draftEvidence]`, `[draftSchemas.ts:DashboardDraftSchema]`, `[explain.ts:gatherEvidence]`, `[explainSchemas.ts:SpikeExplanationSchema]`.

## Invariants
- Every panel run checks, in order: connection access, macro compile, single read-only SELECT, the viewer's data-access rules, and agent governance for token callers; only then is the cache consulted. Results run read-only with hard caps and are never truncated, retried or replaced by empty results (`[runner.ts:runPanel]` header, `[runner.ts:MAX_RESULT_ROWS]`).
- Macros compile to native ClickHouse query parameters, never concatenated SQL (`[macros.ts:compileSql]`).
- A share reveals a dashboard but never widens data access; panels run under the viewer's own connection and table access (`[access.ts:dashboardAccess]`).
- The spec rejects any unknown field, chart type, unit or variable kind (`[spec.ts:vizSpecSchema]`).
- Alerts and reports run on exactly one pod per item via a row lease, re-reading the due time after the claim (`[alerts.ts:DashboardAlertEvaluator]`, `[reports.ts:DashboardReportScheduler]`).
- Snapshots are stored whole or not at all under a 10 MiB cap (`[snapshots.ts:MAX_SNAPSHOT_BYTES]`).
- Annotations read only the RBAC database, never ClickHouse (`[annotations.ts:loadAnnotations]`).
- Lint findings never block a save and are never auto-applied (`[lint.ts:lintPanel]`).
- Grafana import is a preview that saves nothing (`[grafana.ts:convertGrafana]`).

## Side Effects
- Writes `dashboards`, `dashboard_panels`, `dashboard_versions`, `dashboard_shares`, `dashboard_pins` (`[store.ts:createDashboard]`, `[store.ts:setShares]`, `[store.ts:pin]`); `dashboard_alerts`, `dashboard_alert_state`, `dashboard_alert_channels` (`[alertStore.ts:createAlert]`, `[alertStore.ts:saveStatus]`); `dashboard_reports`, `dashboard_report_channels` (`[reports.ts:createReport]`); `dashboard_snapshots` (`[snapshots.ts:createSnapshot]`); `dashboard_notes` (`[annotations.ts:addNote]`).
- `deleteDashboard` deletes, in one atomic batch, the dashboard's panels, shares, pins, notes, versions, snapshots, report channels, reports and panel alerts (`[store.ts:deleteDashboard]`).
- Each report scheduler tick (every 60 s) first deletes expired rows from `dashboard_snapshots` (`[reports.ts:DashboardReportScheduler]`, `[snapshots.ts:deleteExpiredSnapshots]`).
- Read-only ClickHouse queries (`[runner.ts:execute]`).
- `setInterval` ticks with `obs_leases` claims; notifications via the shared notify layer and `alert_events` (`[alerts.ts:DashboardAlertEvaluator]`, `[reports.ts:DashboardReportScheduler]`).
- Per-pod in-memory caches (`[cache.ts:ResultCache]`, `[baseline.ts:clearBaselineCache]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
