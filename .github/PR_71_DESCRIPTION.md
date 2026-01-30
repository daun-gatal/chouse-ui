## Description

Adds a **Live Queries** dashboard so admins can view and stop running ClickHouse queries from the UI. This addresses [Issue #71](https://github.com/daun-gatal/chouse-ui/issues/71): admins currently cannot see or stop running queries from the UI; stopping a resource-intensive or runaway query required using the CLI.

**Issue summary (from #71):**
- **Problem:** Admins cannot see or stop running queries from the UI. If a user runs a resource-intensive query (e.g., infinite loop), the only way to stop it is via CLI.
- **Proposed solution:** Live Queries dashboard for admins with (1) **View** – list executing queries from `system.processes`, (2) **Control** – kill queries via UI, (3) **Security** – restricted via RBAC (e.g. `live_queries:view`, `live_queries:kill`).
- **Priority:** Critical

This PR implements the Live Queries feature end-to-end: server routes, RBAC permissions, frontend API, hooks, and Live Queries / Monitoring pages.

## Type of Change

- [x] New feature (non-breaking change which adds functionality)
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring
- [ ] Other (please describe):

## Related Issue

Closes https://github.com/daun-gatal/chouse-ui/issues/71

## Changes Made

### Backend (packages/server)
- **Routes:** New `live-queries` route module with:
  - `GET /api/live-queries` – list running queries from `system.processes` (filtered to exclude internal queries).
  - `POST /api/live-queries/kill` – kill a query by `query_id` (with permission check and audit log).
- **Auth:** Hybrid auth (session or RBAC); requires `live_queries:view` for list and `live_queries:kill` for kill.
- **RBAC:** New permissions `LIVE_QUERIES_VIEW` and `LIVE_QUERIES_KILL` in schema, migrations, and seed (admin roles).
- **Tests:** `packages/server/src/routes/live-queries.test.ts` for GET list and POST kill (success and validation).

### Frontend (src)
- **API:** `src/api/live-queries.ts` – `getLiveQueries()`, `killQuery()`, types for live query and kill response.
- **Hooks:** `src/hooks/useLiveQueries.ts` – `useLiveQueries()` (with refetch interval), `useKillQuery()` (mutation + optimistic update), `useLiveQueriesStats()` (aggregate stats).
- **Pages:** `LiveQueries.tsx` (list + kill UI), `Monitoring.tsx` (parent/landing if used).
- **App/Sidebar:** Route and nav entry for Live Queries (and Monitoring where applicable), gated by `live_queries:view`.
- **Tests:** `src/api/live-queries.test.ts`, `src/hooks/useLiveQueries.test.ts`; MSW handlers for `GET /api/live-queries` and `POST /api/live-queries/kill`.

### Other changes in this branch
- **Largest Tables (overview):** `getTopTablesBySize` now uses `system.tables` (non-system DBs only) so the overview “Largest Tables” section is populated.
- **Identifier “default”:** Allowed `default` as a valid database name in SQL identifier validation (frontend and server) so uploads to the `default` database work.
- **Tests:** Additional tests for top-tables API, `useTopTables`, `escapeQualifiedIdentifier(['default', …])`, and metrics route GET /metrics/top-tables.

## Testing

- [x] I have tested this locally
- [x] I have added/updated tests
- [x] All existing tests pass

### Test Steps
1. **Live Queries:** Log in as a user with `live_queries:view` (and `live_queries:kill` for kill). Open Live Queries page; confirm running queries from `system.processes` appear. Run a long query in another tab, then kill it from the Live Queries UI and confirm it stops.
2. **Permissions:** With a role that has only `live_queries:view`, confirm kill button is disabled or forbidden; with `live_queries:kill`, confirm kill succeeds.
3. **Unit tests:**  
   - Server: `bun test packages/server/src/routes/live-queries.test.ts`  
   - Frontend API/hooks: `bun run test -- src/api/live-queries.test.ts src/hooks/useLiveQueries.test.ts --run`

## Screenshots

<!-- If applicable, add screenshots of the Live Queries page (list view and kill confirmation). -->

## Checklist

- [x] My code follows the project's code style guidelines
- [x] I have performed a self-review of my code
- [x] I have commented my code, particularly in hard-to-understand areas
- [ ] I have updated the documentation accordingly (if applicable)
- [x] My changes generate no new warnings or errors
- [x] I have checked for breaking changes and documented them (if applicable)
- [x] I have tested the changes in the relevant environment (development/production)

## Additional Notes

- Live Queries uses the active ClickHouse connection (session or RBAC default/first connection).
- Kill is audited via `createAuditLog` with action `LIVE_QUERY_KILL`.
- The branch also includes overview (Largest Tables) and “default” identifier fixes plus their tests; those can be split into separate PRs if preferred.
