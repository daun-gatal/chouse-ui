# AI Action Toolkits

## Overview
Write-tool definitions grouped by toolkit (ADR 0025 §2). Each toolkit exports an `ActionDefinition[]` that the parent [actions](../README.md) package collects into `ACTION_DEFINITIONS`. Tools call CHouse routes in-process as the caller; they never reimplement route logic.

## Interface
- `[access.ts:ACCESS_ACTIONS]` - users, roles, data access policies and ClickHouse roles.
- `[dashboards.ts:DASHBOARD_ACTIONS]`, `[dashboards.ts:chartPanel]` - dashboards, panels, versions, notes, sharing, table context and metrics.
- `[data.ts:DATA_ACTIONS]`, `[data.ts:classifySqlChange]` - saved queries, live queries, data/schema changes.
- `[health.ts:HEALTH_ACTIONS]` - Data Health promises, checks and incidents.
- `[observe.ts:OBSERVE_ACTIONS]` - alerting, observability incidents, fixes, notebooks, Doctor, fleet, collectors, cost, upgrades.
- `[platform.ts:PLATFORM_ACTIONS]` - drafting/evaluating/publishing custom agents and the caller's preferences.
- `[scheduling.ts:SCHEDULING_ACTIONS]` - scheduled report queries.
- `[shared.ts:dashboardDocument]`, `[shared.ts:scheduleBody]`, `[shared.ts:panelSchema]`, `[shared.ts:needConnection]` - helpers shared by the toolkits.

## Invariants
- Every access tool is tier T3, so a second person holding the permission must approve it (`[access.ts:ACCESS_ACTIONS]` header).
- AI never changes its own controls (guardrails, budgets, MCP and agent settings) (`[platform.ts:PLATFORM_ACTIONS]` header).
- Edits to whole-object routes (promises, scheduled jobs, dashboards) read the current object, change only the given fields and send it back (`[health.ts:HEALTH_ACTIONS]`, `[scheduling.ts:SCHEDULING_ACTIONS]`, `[dashboards.ts:DASHBOARD_ACTIONS]` headers).

## Side Effects
- Each tool issues HTTP subrequests against the app's own routes as the caller, so route permission checks, validation and audit apply (`[../definitions.ts:ACTION_DEFINITIONS]` header).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
