# API Routes (`/api`)

## Overview
Hono sub-apps that make up the `/api` surface. `index.ts` builds the `api` app,
applies the API-protection and AI-caller middleware, and mounts each route
module (plus the RBAC routes from `../rbac`). Each module owns authentication,
permission gating, request validation (Zod), data-access filtering, and audit
logging for its feature; business logic lives in `packages/server/src/services`
and `packages/server/src/rbac/services`.

## Interface
- `[index.ts:api]` (default export) - mounts, in order: `/config`, `/query`, `/explorer`, `/metrics`, `/saved-queries`, `/live-queries`, `/upload`, `/ai-chat`, `/ai`, `/fleet`, `/alerting`, `/scheduled-queries`, `/data-health`, `/query-history`, `/observe`, `/remediation`, `/notebooks`, `/context`, `/upgrades`, `/agents`, `/ai-agents`, `/ai-guardrails`, `/ai-usage`, `/ai-actions`, `/chobi`, `/ai-memories`, `/ai-triage`, `/ai-evals`, `/integrations`, `/chat-identities`, `/oauth`, `/dashboards`, `/rbac`, and `GET /health`.
- ClickHouse work on the active connection (use `connectionContextMiddleware`):
  - `[query.ts:query]` - `POST /execute`, `/execute-stream`, `/explain`, `/show`, `/system`, `GET /intellisense`; also exports `[query.ts:queryAuthMiddleware]` (alias of the connection context middleware, reused by `ai.ts`) and type `Variables`.
  - `[explorer.ts:explorer]` - database/table browse, create, and drop.
  - `[metrics.ts:metrics]` - monitoring metrics.
  - `[live-queries.ts:liveQueries]` - list and kill running queries.
  - `[upload.ts:upload]` - `POST /preview` and streamed file import (CSV, TSV, JSON, JSONEachRow).
- RBAC-authenticated feature APIs (default exports): `agents.ts` (agent governance), `ai-actions.ts` (approval queue and inbox), `ai-agents.ts` (agent registry), `ai-chat.ts` (chat threads and invoke), `ai-evals.ts`, `ai-guardrails.ts`, `ai-memories.ts`, `ai-triage.ts`, `ai-usage.ts`, `ai.ts` (`POST /ai/invoke` structured capabilities), `alerting.ts`, `chat-identities.ts`, `chobi.ts`, `context.ts`, `dashboards.ts`, `data-health.ts`, `fleet.ts`, `notebooks.ts`, `oauth.ts` (MCP OAuth consent and grants), `query-history.ts`, `remediation.ts`, `saved-queries.ts`, `scheduled-queries.ts`, `upgrades.ts`.
- Public routes: `[config.ts:config]` (`GET /config` frontend config and feature flags), `[integrations.ts:integrations]` (Slack, Google Chat, Telegram callbacks).
- Notable named exports used elsewhere or in tests: `[ai-chat.ts:InvokeMessageSchema]`, `MAX_MESSAGE_LENGTH`, `MAX_MESSAGES_PAYLOAD`, `MAX_ATTACHMENTS`; `[alerting.ts:cleanChannelConfig]`; `[ai-usage.ts:windowDays]`, `[ai-usage.ts:originParam]`; `[oauth.ts:clampPolicy]`, `[oauth.ts:grantDayChoices]`; `[upgrades.ts:visibleAssessment]`; `[data-health.ts:WATCH_LIMIT]`; cache resets `[ai-memories.ts:resetSuggestCache]`, `[chobi.ts:resetBriefingCache]`.
- Subdirectory: [observe/](./observe/README.md) - `/api/observe` Data Observability Platform API and its shared `access.ts` helpers.

## Invariants
- Every `/api` request must send `X-Requested-With: XMLHttpRequest` unless it is on the public list (`/api/health`, `/api/config`, `/api/rbac/auth/login|refresh|sso`, `/api/rbac/health`, the three integration callbacks) or carries a `Bearer` PAT (`PAT_PREFIX`) or an MCP OAuth token that `isMcpSubrequestFor` vouches for; otherwise 403 `DIRECT_ACCESS_DENIED` `[index.ts:apiProtectionMiddleware]`.
- The protection layer only checks token prefixes (no DB I/O); validity is enforced by the per-route auth middleware `[index.ts:apiProtectionMiddleware]`.
- User SQL passes `validateQueryAccess` and then `enforceSchemaPreflight` before it runs `[query.ts]`; explorer drops also go through `enforceSchemaPreflight` `[explorer.ts]`.
- Uploads require write access to the target table via `checkTableAccess(..., "write")` and a format in `UPLOAD_FORMATS` `[upload.ts]`.
- `GET /metrics/recent-queries` scopes on the server: RBAC admins and `query:history:view:all` get `system.query_log` (last 7 days); other holders of `query:history:view` get only their own CHouse query history on the current connection; anyone else gets `[]`. `username` only narrows `[metrics.ts:canSeeAllQueryText]`, `[metrics.ts:metrics]`.
- `GET /metrics/custom` runs a SELECT only after `validateQueryAccess` allows that exact text, like the SQL editor `[metrics.ts:metrics]`.
- Metrics routes that name tables (`/top-tables`, `/replication`, `/parts-pressure`, and those lists inside `/production`) return only the tables the caller's data access rules allow; admins get every row `[metrics.ts:visibleTableRows]`, `[metrics.ts:visibleTopTables]`.
- `POST /metrics/ddl/simulate` checks the exact count statement it will run with `validateQueryAccess` before counting, so the target table and anything its predicate reads must be allowed `[metrics.ts:mutationCountStatement]`.
- Sample error text on `/metrics/errors` and `/metrics/production` goes only to callers who may read everyone's query text `[metrics.ts:visibleErrors]`.
- A notebook's query cell keeps its saved rows only for readers whose own data access rules allow the cell's statement; for others the route returns `snapshot: null` and `snapshotWithheld: true`, on every read path including the Markdown export `[notebooks.ts:cellsFor]`.
- Fleet metrics take a fixed metric enum, not raw SQL; metric SQL lives in `services/fleetMetrics.ts` `[fleet.ts]`.
- Live queries from other users are filtered by ownership, and killing them is refused, unless the caller holds `live_queries:kill_all` (from the token or a DB re-check); a query that cannot be looked up, or has no recorded owner, is refused for a caller without it; there is no admin-role bypass, despite the file header `[live-queries.ts:liveQueries]`.
- Integration callbacks are public but authenticate each request with its platform's signature or secret before parsing the body, then act as the mapped CHouse user `[integrations.ts]`.
- `GET /config` returns only non-secret values (default URL/user, preset URLs, version, `aiOptimizer`/`mcpEnabled` flags that degrade to `false` on error) `[config.ts]`.
- Each feature module documents its permission map in its header comment (for example `[dashboards.ts]`, `[agents.ts]`, `[remediation.ts]`); keep those comments in sync with the `requirePermission` calls.

## Side Effects
- ClickHouse queries, DDL, inserts, and `KILL QUERY` on the resolved connection (`query.ts`, `explorer.ts`, `upload.ts`, `live-queries.ts`).
- Audit log writes via `createAuditLogWithContext` / `createAuditLog` (for example `AUDIT_ACTIONS.CH_QUERY_EXECUTE`, `CH_DATABASE_DROP`, `CH_TABLE_CREATE` in `query.ts` and `explorer.ts`).
- RBAC-database writes through services (dashboards, saved/scheduled queries, alert channels, AI agents/guardrails/memories, OAuth grants, notebooks).
- Outbound calls to AI providers (`ai.ts`, `ai-chat.ts`) and chat platforms (`integrations.ts`).
- `requestCallerMiddleware` records who started each request for AI usage tracking `[index.ts]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/routes`
