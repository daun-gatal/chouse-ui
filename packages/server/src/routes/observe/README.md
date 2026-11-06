# Observe Routes (`/api/observe`)

## Overview
The Data Observability Platform read and control API (ADR 0016). A Hono
sub-app mounted at `/api/observe` by [`../index.ts`](../index.ts) that exposes
status, lineage, pipelines, datasets, coverage, incidents and RCA, performance
fingerprints and EXPLAIN diffs, capacity and cost rates, codec trials, schema
preflight, connection privilege reports, and collector schedules. Business logic
lives in `packages/server/src/services/observe` and related services; this
directory only authorizes, validates, filters, and audits.

## Interface
- `[index.ts:observe]` (default export) - Hono app. Routes include `GET /status`, `GET /privileges`, `POST /privileges/check`, `GET|PUT /collectors/schedule[/:connectionId]`, `GET /overview`, `GET /lineage`, `GET /lineage/impact`, `GET /pipelines`, `GET /pipelines/:id/samples`, `GET /datasets`, `GET /datasets/:database/:table`, `PUT /datasets/:database/:table/criticality`, `GET /coverage`, `POST /suggestions/dismiss`, `GET /incidents`, `GET /incidents/:source/:id`, `POST /incidents/:source/:id/rca`, `POST /incidents/observe/:id/acknowledge`, `GET /performance`, `GET /performance/fingerprints/:fingerprint`, `POST /performance/explain`, `GET /capacity`, `PUT /cost-rates`, `POST /codec-trials`, `POST /preflight`.
- `access.ts` (shared authorization helpers):
  - `[access.ts:actor]` - `{ id, roles, permissions }` for the remediation executor.
  - `[access.ts:isAdmin]`, `[access.ts:hasPermission]` - super admin always passes `hasPermission`.
  - `[access.ts:requireConnectionParam]` - `connectionId` query param or `X-Connection-Id` header, else 400.
  - `[access.ts:assertConnectionAccess]` - 403 unless super admin or the connection is in `getUserConnections`.
  - `[access.ts:tableAccess]` / `[access.ts:TablePredicate]` - synchronous per-table predicate from data access rules.
  - `[access.ts:scopedConnection]` - the three checks combined; `[access.ts:canSeeAllQueryText]`.

## Invariants
- Every route runs `rbacAuthMiddleware` (`observe.use("*", ...)`) plus a `requirePermission`/`requireAnyPermission` gate; the permission map is the header comment of `[index.ts]` (for example `observe:view`, `observe:edit`, `performance:view`, `capacity:view`, `upgrades:run`).
- Evidence about a table (names, lineage, profiles, query text) is shown only if the caller may read that table; `system`, `information_schema`, `INFORMATION_SCHEMA` are always hidden from non-admins `[access.ts:tableAccess]`.
- Other users' query text requires admin or `query:history:view:all` `[access.ts:canSeeAllQueryText]`.

## Side Effects
- Writes audit logs via `createAuditLogWithContext` for collector schedule updates (`AUDIT_ACTIONS.OBSERVE_COLLECTORS_UPDATE`), criticality pins (`OBSERVE_CRITICALITY_PIN`), suggestion dismissals (`OBSERVE_SUGGESTION_DISMISS`), incident acknowledgements (`OBSERVE_INCIDENT_ACKNOWLEDGE`), cost-rate updates (`OBSERVE_COST_RATES_UPDATE`), and codec trials (`OBSERVE_CODEC_TRIAL`) `[index.ts:observe]`.
- Mutating routes delegate to services that persist to the RBAC DB or run ClickHouse work: `saveSchedules`, `pinCriticality`, `dismissSuggestion`, `acknowledgeObserveIncident`, `computeAndStoreRca`, `setCostRates`, `startCodecTrial`, `checkConnectionPrivileges` `[index.ts]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/routes/observe`
