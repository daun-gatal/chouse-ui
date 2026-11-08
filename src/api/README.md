# api

## Overview
Typed HTTP client modules for the CHouse UI backend (`packages/server`). `client.ts` owns transport concerns (base URL, auth tokens, connection identity headers, 401 refresh, 429 backoff, error mapping); every other file is a thin domain module over `api.get/post/...`. The browser never talks to ClickHouse directly: queries go to the server's `/api/query/*` routes. Barrel: `index.ts` (namespaced re-exports such as `queryApi`, `explorerApi`, `fleetApi`, plus the RBAC API objects).

## Interface
- `client.ts` - `apiUrl(path)` (`VITE_API_URL` or `/api`, plus `path`) [client.ts:apiUrl]; `api` (singleton `ApiClient`), `ApiClient` (`setOnSessionExpired`), `ApiError`, `ApiResponse`, `RequestOptions`; session/connection identity `getSessionId`, `setSessionId`, `clearSession`, `getConnectionId`, `setConnectionId`, `clearConnectionId`, `connectionIdentityHeaders`; tokens `setRbacTokens`, `getRbacAccessToken`, `getRbacRefreshToken`, `clearRbacTokens`, `refreshTokens`, `RBAC_ACCESS_TOKEN_KEY`, `RBAC_REFRESH_TOKEN_KEY` [client.ts:api], [client.ts:refreshTokens]
- `rbac.ts` - `rbacAuthApi`, `rbacPatApi`, `rbacUsersApi`, `rbacRolesApi`, `rbacAuditApi`, `rbacConnectionsApi`, `rbacClickHouseUsersApi`, `rbacClickHouseRolesApi`, `rbacUserPreferencesApi`, `rbacDataAccessApi`, `rbacDataAccessPoliciesApi`, `rbacAiProvidersApi`, `rbacAiBaseModelsApi`, `rbacAiConfigsApi`, `rbacSsoAdminApi`, `ssoApi`, `authConfigApi` [rbac.ts:rbacAuthApi]
- Query and schema: `query.ts` (`executeQuery`, `executeSelect`, `executeInsert`, `executeUpdate`, `executeDelete`, `executeQueryStream`, `explainQuery`, `detectQueryType`), `explorer.ts` (`getDatabases`, `getTableDetails`, `getTableSample`, `createDatabase`, `dropDatabase`, `createTable`), `saved-queries.ts`, `queryHistory.ts`, `live-queries.ts` (`getLiveQueries`, `killQuery`, `liveQueriesApi`), `metrics.ts` (`getSystemStats`, `getRecentQueries`, `getProductionMetrics`, `getDiskMetrics`, `simulateDdl`, ...), `config.ts` (`getConfig`) [query.ts:executeQuery], [query.ts:executeQueryStream]
- Fleet and upgrades: `fleet.ts` (`fleetQuery`, `fetchFleetSnapshots`, `fetchFleetHistory`, `fetchFleetHistoryBulk`, `fetchDoctorEnabled`, `fetchDoctorModels`), `upgrades.ts` (`getUpgradeStatus`, `getReferences`, `getFleetUpgrades`, `listAssessments`, `getAssessment`, `startCheck`) [fleet.ts:fleetQuery], [upgrades.ts:startCheck]
- Data observability (ADR 0016): `observe.ts` (collectors, overview, datasets, incidents, performance), `dataHealth.ts`, `remediation.ts` (`getCatalog`, `listActions`, `previewAction`, `proposeAction`, `approveAction`), `notebooks.ts`, `context.ts`, `scheduledQueries.ts`, `alerting.ts`, `dataOpsAi.ts` [observe.ts:getOverview], [remediation.ts:proposeAction]
- Dashboards: `dashboards.ts` (`listDashboards`, `getDashboard`, `createDashboard`, `updateDashboard`, `deleteDashboard`, `duplicateDashboard`, ...) [dashboards.ts:updateDashboard]
- AI: `ai.ts` (`invokeAI`, `fetchAiModels`, `fetchAiCapabilities`), `ai-chat.ts` (`getChatStatus`, `listThreads`, `createThread`, `getThread`, streaming runs), `aiActions.ts` (`listAiActions`, `getAiActivity`, `approveAiAction`, `rejectAiAction`, `undoAiAction`), `aiAgents.ts` (registry, revisions, agents), `aiEvals.ts`, `aiGuardrails.ts`, `aiMemories.ts`, `aiTriage.ts`, `aiUsage.ts`, `chobi.ts` (`getBriefing`, `getChobiSettings`, `updateChobiSettings`), `agents.ts` (MCP/PAT agent sessions and policies), `oauth.ts` (MCP OAuth sign-in requests and connected apps), `chatIdentities.ts` [ai.ts:invokeAI], [ai-chat.ts:createThread]

## Invariants
- Calls through `ApiClient.request` send `X-Requested-With: XMLHttpRequest`, `X-Connection-Id` / `X-Session-ID`, and `Authorization: Bearer <access token>`, with `credentials: 'include'` [client.ts:ApiClient], [client.ts:connectionIdentityHeaders].
- `rbac.ts` does not use `ApiClient`, but every URL it builds goes through `apiUrl` (so it honours `VITE_API_URL`) and every request sends `credentials: 'include'`, like `ApiClient`. `rbacFetch` adds the bearer token and connection identity headers; the direct `fetch` calls (login, favorites, recent items, preferences, health, SSO, auth config) send no connection identity headers [client.ts:apiUrl], [rbac.ts:rbacFetch], [rbac.ts:rbacUserPreferencesApi].
- The connection id is what the server resolves on (ADR 0010); the session id is only a correlation handle, and the server fails closed (409) on a request that names a session but no connection [client.ts:connectionIdentityHeaders].
- Base URL is `import.meta.env.VITE_API_URL` or `/api` for `ApiClient` [client.ts:API_BASE_URL].
- On `409 CONNECTION_CONTEXT_STALE` the client drops the session id and retries once when a connection id is stored, otherwise calls the session-expired handler and throws; a `NO_SESSION` error also calls the session-expired handler [client.ts:ApiClient], [client.ts:setOnSessionExpired].
- Token refresh is single-flight: concurrent 401s share one `refreshTokens()` call, and retries within one request are bounded by `maxRetries` (3) [client.ts:refreshTokens], [client.ts:ApiClient].
- 429 responses are retried with backoff (honouring `Retry-After`) up to 3 times, except `AI_BUDGET_EXHAUSTED` [client.ts:ApiClient].
- Non-success responses throw `ApiError` with `code`, `category`, `details`, `statusCode` [client.ts:ApiError].

## Side Effects
- Network requests to the backend for every exported function.
- sessionStorage holds the session id; localStorage holds the connection id and `rbac_access_token` / `rbac_refresh_token` [client.ts:setSessionId], [client.ts:setConnectionId], [client.ts:setRbacTokens].
- When a 401 refresh fails the client calls `clearSession()` and `clearRbacTokens()`, then dispatches the `auth:unauthorized` window event [client.ts:ApiClient].
- Streaming endpoints (`executeQueryStream`, AI chat runs) read response bodies incrementally; chat uses `readSse` from `src/lib/sse.ts` [query.ts:executeQueryStream], [ai-chat.ts:readSse].

## Verification
- Run: `bunx vitest run src/api`
