# Statement Executor

## Overview
The only code that talks to ClickHouse (ADR 0033 §2). Every other module gets a handle bound to one stored login and one actor, and the handle sets what identifies a request: the query id, `log_comment` and the quota key.

## Interface
- Handles: `[executor.ts:executorForConnection]` (a saved connection by id, optionally on its remediation login), `[executor.ts:executorForConfig]` (a login a caller already resolved), `[executor.ts:ephemeralExecutor]` (a one-use client outside the pool, for testing a login), `[executor.ts:connectionConfig]`.
- Actors: `[types.ts:personActor]`, `[types.ts:serviceActor]`, `[types.ts:SERVICE_PURPOSES]`; types `Actor`, `ChExecutor`, `Credential`, `QueryArgs`, `CommandArgs`, `ExecArgs`, `InsertArgs` in `[types.ts]`.
- Query ids: `[queryId.ts:makeQueryId]`, `[queryId.ts:parseQueryId]`, `[queryId.ts:accountOfQueryId]`, `[queryId.ts:isNonce]`, `[queryId.ts:accountQueryIdLike]`, `[queryId.ts:purposeQueryIdLike]`.
- Sessions: `[session.ts:plainSession]`, `[session.ts:pinnedSession]`, `[session.ts:buildSession]`.
- `[executor.ts:logCommentFor]`, `[executor.ts:quotaKeyFor]`, `[lifecycle.ts:closeAllClients]`.
- Tests only: `[executor.ts:executorOverClient]`, `[executor.ts:setExecutorClientForTests]`.

## Invariants
- No file outside this directory imports `@clickhouse/client`, the pool (`[clientPool.ts:ClientManager]`) or reads the remediation login; `bun run check:clickhouse-access` fails otherwise (`[../../../../../scripts/check-clickhouse-access.ts:violationsIn]`).
- A handle needs an actor: a person or a purpose from `[types.ts:SERVICE_PURPOSES]`. `[queryId.ts:makeQueryId]` throws for anything else, so no request is sent without one.
- Every request carries a query id `chouse:p:<account id>:<random>` or `chouse:s:<purpose>:<random>`. A caller's `query_id` is only ever the random part, and one that could change the id's shape is replaced (`[queryId.ts:isNonce]`).
- `log_comment` is built from the handle's context and the actor; the actor's keys win, and a `log_comment` passed in a call's settings is overwritten (`[executor.ts:logCommentFor]`). A statement can still overwrite it with its own `SETTINGS` clause, so it is context, not proof of identity.
- A call cannot set `session_id`, `role`, `auth` or `http_headers`: the argument types omit them and the handle drops them at run time.
- A session id is sent only through `[session.ts:buildSession]`, for CHouse-built text; after the first statement it sends `session_check = 1` (ADR 0015 §4).
- `[executor.ts:setExecutorClientForTests]` throws unless `NODE_ENV` is `test`.

## Side Effects
- Opens pooled HTTP clients to ClickHouse, one per login and lane, closed after 10 idle minutes by an unref'd `setInterval` (`[clientPool.ts:ClientManager]`). The `service` lane keeps parse and stop requests from waiting behind long statements.
- Reads `rbac_clickhouse_connections` and `remediation_credentials` to resolve a login (`[executor.ts:connectionConfig]`).

## Verification
- Run (from repo root): `cd packages/server && bun test src/services/chExecutor`
- Run (from repo root): `bun run check:clickhouse-access`
