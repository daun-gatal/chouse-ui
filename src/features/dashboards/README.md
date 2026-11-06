# dashboards

## Overview

Pure helpers and query keys for the dashboards feature (list filtering/paging, URL view state, drill-down links, chart overlays, version diff, Ask AI review reducer, connection scope) plus one hook that reveals newly added panels; `index.ts` re-exports the main components and `dashboardKeys`.

## Interface

- `[index.ts]` - re-exports `DashboardList`, `DashboardView`, `PinToDashboardDialog`, `SnapshotView` from `./components` and `dashboardKeys`
- `[hooks.ts:dashboardKeys]` - TanStack keys: all, list, detail(id), alerts(id), templates
- `[listView.ts:parseListParams]`, `writeListParams`, `listPage`, `tabCounts`, `PAGE_SIZE` - URL list state (PAGE_SIZE=25)
- `[urlState.ts:parseView]`, `writeView`, `COMPARE_OPTIONS`, `ViewState` - time range, `var-*`, `cmp`, `ann-off` URL state
- `[links.ts:linkAction]`, `rangeParams`, `bucketQueriesSql` - drill-down link resolution
- `[askAi.ts:reviewReducer]`, `initialReview`, `revisionOf`, `roomProblem`, `canInclude`, `MAX_HISTORY` - Ask AI review state machine
- `[versionDiff.ts:diffVersions]`, `isEmptyDiff` - what restoring a version would change
- `[overlays.ts:markersFor]`, `mergeCompare`, `mergeBand` - chart annotation/compare/band data
- `[scope.ts:isAssignedTo]`, `scopeLabel`, `scopeForNew` - connection scoping
- `[revealPanels.ts:useRevealAddedPanels]`, `REVEAL_CLASS` - scroll to and outline added panels

### Subdirectories

- components: [components](./components/README.md) - React UI for the Dashboards feature: list and single-dashboard view with a local edit session, the grid canvas, panel cards and editors, and dialogs for settings, connections, sharing, alerts, reports, snapshots, version history, panel cost, Grafana import, Explain-spike and the full-screen Ask AI draft review. Server I/O goes through `@/api/dashboards` (plus `@/api/alerting` and `rbacConnectionsApi`) via TanStack Query.

## Invariants

- URL range: integer unix seconds, from > 0, to > from, at most 400 days apart; invalid params are reported and the dashboard default used `[urlState.ts:parseView]`
- A drill-down link needing a missing datum returns an error rather than dropping the part; identifier variables must match `IDENTIFIER_RE` `[links.ts:linkAction]`
- Saved drafts must fit `MAX_CHART_PANELS`, `MAX_PANELS`, `MAX_VARIABLES`; blocked panels cannot be included; history capped at `MAX_HISTORY`=5 `[askAi.ts:roomProblem]` `[askAi.ts:canInclude]`
- A new dashboard needs an active connection and is scoped 'only' to it `[scope.ts:scopeForNew]`
- List `q` capped at 200 chars, page clamped, pinned first `[listView.ts:parseListParams]` `[listView.ts:listPage]`

## Side Effects

- Clears `location.state` via `navigate(..., {replace: true})`; DOM query on `[data-panel-key]` with 100ms retries, `scrollIntoView` and a 2.5s `REVEAL_CLASS` timer `[revealPanels.ts:useRevealAddedPanels]`
- All other files are pure (no API, storage or toasts) `[listView.ts:listPage]` `[urlState.ts:parseView]`

## Verification

- Run: `bunx vitest run src/features/dashboards` (from repo root; full suite: `bunx vitest run`)
