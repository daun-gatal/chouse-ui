# Statement Executor

## Overview
The only code that talks to ClickHouse (ADR 0033 §2). Every other module gets a handle bound to one stored login and one actor, and the handle sets what identifies a request: the query id, `log_comment` and the quota key. Typed text is sent only as a checked statement, for which the handle also decides `readonly`.

## Interface
- Handles: `[executor.ts:executorForConnection]` (a saved connection by id, optionally on its remediation login), `[executor.ts:executorForConfig]` (a login a caller already resolved), `[executor.ts:ephemeralExecutor]` (a one-use client outside the pool, for testing a login), `[executor.ts:connectionConfig]`.
- Actors: `[types.ts:personActor]`, `[types.ts:serviceActor]`, `[types.ts:SERVICE_PURPOSES]`; types `Actor`, `ChExecutor`, `Credential`, `QueryArgs`, `CommandArgs`, `ExecArgs`, `InsertArgs` in `[types.ts]`.
- Query ids: `[queryId.ts:makeQueryId]`, `[queryId.ts:parseQueryId]`, `[queryId.ts:accountOfQueryId]`, `[queryId.ts:isNonce]`, `[queryId.ts:accountQueryIdLike]`, `[queryId.ts:purposeQueryIdLike]`.
- Checked statements: `[checked.ts:CheckedStatement]`, sent with `queryChecked` / `commandChecked` on `ChExecutor` (`[types.ts]`); `[settings.ts:readonlyFor]`. `[checked.ts:mintCheckedStatement]` is for `middleware/dataAccess.ts` only.
- Whose statement a logged row is: `[queryId.ts:ownerAccount]`, `[queryId.ts:ownerAccountSql]`; CHouse's own traffic: `[queryId.ts:internalTrafficSql]`, `[queryId.ts:INTERNAL_NONCE_PREFIX]`.
- Errors: `[errors.ts:classifyClickHouseError]`, `[errors.ts:classifiedAppError]`, `[errors.ts:isGrantError]`, `[errors.ts:isReadOnlyError]`, `[errors.ts:clickhouseErrorCode]`, `[errors.ts:clickhouseErrorType]`, `[errors.ts:requiredGrantFromError]`, `[errors.ts:deniedSystemTables]`.
- Sessions: `[session.ts:plainSession]`, `[session.ts:pinnedSession]`, `[session.ts:buildSession]`.
- `[executor.ts:logCommentFor]`, `[executor.ts:quotaKeyFor]`, `[lifecycle.ts:closeAllClients]`.
- Tests only: `[executor.ts:executorOverClient]`, `[executor.ts:setExecutorClientForTests]`, `[checked.test-util.ts:checkedForTests]`.

## Invariants
- No file outside this directory imports `@clickhouse/client`, the pool (`[clientPool.ts:ClientManager]`) or reads the remediation login; `bun run check:clickhouse-access` fails otherwise (`[../../../../../scripts/check-clickhouse-access.ts:violationsIn]`).
- A handle needs an actor: a person or a purpose from `[types.ts:SERVICE_PURPOSES]`. `[queryId.ts:makeQueryId]` throws for anything else, so no request is sent without one.
- Every request carries a query id `chouse:p:<account id>:<random>` or `chouse:s:<purpose>:<random>`. A caller's `query_id` is only ever the random part, and one that could change the id's shape is replaced (`[queryId.ts:isNonce]`).
- `log_comment` is built from the handle's context and the actor; the actor's keys win, and a `log_comment` passed in a call's settings is overwritten (`[executor.ts:logCommentFor]`). A statement can still overwrite it with its own `SETTINGS` clause, so it is context, not proof of identity.
- The quota key is sent only where the server takes it next to Basic auth. ClickHouse 23.8 refuses the pair at authentication; the first request on a pooled client finds out, is sent again without the key, and the answer is remembered for that client (`[executor.ts:sendWithQuotaKey]`). A streamed insert is never sent twice, so it carries the key only once the answer is known.
- A call cannot set `session_id`, `role`, `auth` or `http_headers`: the argument types omit them and the handle drops them at run time.
- A `[checked.ts:CheckedStatement]` has a private constructor and is frozen; only `middleware/dataAccess.ts` may name `[checked.ts:mintCheckedStatement]`, and only test files may import `checked.test-util.ts` (`bun run check:clickhouse-access`).
- `queryChecked` / `commandChecked` send the statement's own text and parameters and drop any `query`, `query_params` or `readonly` a call passes. They throw, before anything is sent, unless the value is a real `CheckedStatement` (`[checked.ts:CheckedStatement]` has a private member and `isReal`; an object with the same fields is refused), the handle's actor is the person it was checked for, and, when the handle knows its connection, the connection matches.
- `readonly` for a checked statement is `[settings.ts:readonlyFor]`: a read-only feature's own level, else `2` when ClickHouse's parse says the statement is a read or the person holds no write permission, else none. It never comes from the statement's text.
- A person's account is read from a logged row only when the row's ClickHouse `user` is the connection's login, from the query id first; `log_comment` is read only for an id that is not one of ours (`[queryId.ts:ownerAccount]`).
- Only the executor can put `[queryId.ts:INTERNAL_NONCE_PREFIX]` on a query id (`ExecutorOptions.internal`); a caller's nonce that starts with it is replaced.
- A classified error (`[errors.ts:classifyClickHouseError]`) is a 403 with code `READ_ONLY` or `CLICKHOUSE_ACCESS_DENIED`, never a 401, and never changes a connection's health.
- A session id is sent only through `[session.ts:buildSession]`, for CHouse-built text; after the first statement it sends `session_check = 1` (ADR 0015 §4).
- `[executor.ts:setExecutorClientForTests]` throws unless `NODE_ENV` is `test`.

## Side Effects
- Opens pooled HTTP clients to ClickHouse, one per login and lane, closed after 10 idle minutes by an unref'd `setInterval` (`[clientPool.ts:ClientManager]`). The `service` lane keeps parse and stop requests from waiting behind long statements.
- Reads `rbac_clickhouse_connections` and `remediation_credentials` to resolve a login (`[executor.ts:connectionConfig]`).

## Verification
- Run (from repo root): `cd packages/server && bun test src/services/chExecutor`
- Run (from repo root): `bun run check:clickhouse-access`
- Real servers (23.8 and 26.5), with the observability e2e gate: `./scripts/e2e-observe.sh` runs `shared.e2e.test.ts`
