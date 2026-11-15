/**
 * The statement executor (ADR 0033 §2): the only code that sends anything to
 * ClickHouse. A handle is bound to one login and one actor; on every request it
 * sets the query id, `log_comment` and the quota key from that actor, and it
 * accepts no session, role, credentials or headers from the call.
 */

import { createClient, type ClickHouseClient, type ClickHouseSettings, type DataFormat, type ResultSet } from "@clickhouse/client";

import type { ConnectionConfig } from "../../types";
import type { CheckedStatement } from "./checked";
import { ClientManager, type ClientLane } from "./clientPool";
import { makeQueryId } from "./queryId";
import { buildSession, type ChSession } from "./session";
import { readonlyFor, type ReadOnlyLevel } from "./settings";
import type {
  Actor,
  ChExecutor,
  CheckedCommandArgs,
  CheckedQueryArgs,
  CommandArgs,
  Credential,
  ExecArgs,
  ExecutorOptions,
  InsertArgs,
  QueryArgs,
} from "./types";

/** The part of a ClickHouse client the executor uses. Tests pass a stand-in. */
export type ClientLike = Pick<ClickHouseClient, "query" | "command" | "exec" | "insert" | "ping">;

/** The `log_comment` a request carries: the call's context, then who it is for. Identity keys always win. */
export function logCommentFor(actor: Actor, context: Record<string, string> = {}): string {
  if (actor.kind === "person") {
    return JSON.stringify({ ...context, rbac_user_id: actor.accountId, ...(actor.tokenId ? { token_id: actor.tokenId } : {}) });
  }
  return JSON.stringify({ ...context, purpose: actor.purpose, ...(actor.triggeredBy ? { triggered_by: actor.triggeredBy } : {}) });
}

/** The quota key: ClickHouse counts a keyed quota per account or per service purpose. */
export function quotaKeyFor(actor: Actor): string {
  return actor.kind === "person" ? actor.accountId : `chouse-${actor.purpose}`;
}

function settingsFor(actor: Actor, options: ExecutorOptions, given: ClickHouseSettings | undefined): ClickHouseSettings {
  return { ...options.defaults, ...given, log_comment: logCommentFor(actor, options.context) };
}

/** Fields a call might still carry at run time (untyped callers, spreads) that only the executor may set. */
function withoutOwned<T extends object>(args: T): T {
  const { session_id: _s, role: _r, auth: _a, http_headers: _h, ...rest } = args as T & Record<string, unknown>;
  return rest as T;
}

/** A checked call's text and parameters come from the statement; anything an untyped caller passed is dropped. */
function withoutText<T extends object>(args: T): T {
  const { query: _q, query_params: _p, ...rest } = args as T & Record<string, unknown>;
  return rest as T;
}

/**
 * The settings a checked statement runs with. The statement must have been
 * checked for the person this handle sends for; the `readonly` level is the
 * executor's, whatever the call passed.
 */
function checkedSettings(actor: Actor, statement: CheckedStatement, given: ClickHouseSettings | undefined, feature: ReadOnlyLevel | undefined): ClickHouseSettings {
  if (actor.kind !== "person" || actor.accountId !== statement.accountId) {
    throw new Error("A checked statement can only be sent for the person it was checked for");
  }
  const { readonly: _ignored, ...rest } = given ?? {};
  const level = readonlyFor(statement, feature);
  return level ? { ...rest, readonly: level } : rest;
}

/**
 * Whether a server takes the quota key next to the client's Basic auth.
 * ClickHouse 23.8 refuses the two together (code 516, observed); 24.8 and 26.5
 * accept them. It is a fact about the server behind a client, so it is learned
 * once per pooled client and rebuilt after a restart.
 */
const quotaKeyAccepted = new WeakMap<object, boolean>();

function refusesQuotaKey(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Authorization HTTP header/i.test(message) && /simultaneously/i.test(message);
}

/**
 * Send with the quota key where the server takes it. The first request on a
 * client finds out: when the server refuses the key at authentication, nothing
 * ran, so the request is sent once more without it. A request whose body is a
 * stream cannot be sent twice, so it carries the key only once the answer is known.
 */
async function sendWithQuotaKey<T>(client: object, send: (withKey: boolean) => Promise<T>, canResend: boolean): Promise<T> {
  const known = quotaKeyAccepted.get(client);
  if (known === false || (known === undefined && !canResend)) return send(false);
  try {
    const result = await send(true);
    quotaKeyAccepted.set(client, true);
    return result;
  } catch (error) {
    if (known === undefined && refusesQuotaKey(error)) {
      quotaKeyAccepted.set(client, false);
      return send(false);
    }
    throw error;
  }
}

/**
 * Build a handle over a client. Exported for the pool-backed factories below
 * and for tests that supply a stand-in client; nothing else may call it.
 */
export function executorOverClient(
  clientFor: (lane: ClientLane) => ClientLike,
  actor: Actor,
  options: ExecutorOptions = {},
  lane: ClientLane = "statements",
): ChExecutor {
  const idFor = (nonce: string | undefined): string => makeQueryId(actor, nonce, options.internal === true);
  const identity = (queryId: string, settings: ClickHouseSettings | undefined, withKey: boolean) => ({
    query_id: queryId,
    clickhouse_settings: settingsFor(actor, options, settings),
    ...(withKey ? { http_headers: { "X-ClickHouse-Quota": quotaKeyFor(actor) } } : {}),
  });
  return {
    actor,
    query<Format extends DataFormat = "JSON">(args: QueryArgs<Format>): Promise<ResultSet<Format>> {
      const clean = withoutOwned(args);
      const client = clientFor(lane) as { query(params: QueryArgs<Format>): Promise<ResultSet<Format>> };
      const queryId = idFor(clean.query_id);
      return sendWithQuotaKey(client, (withKey) => client.query({ ...clean, ...identity(queryId, clean.clickhouse_settings, withKey) }), true);
    },
    command(args: CommandArgs) {
      const clean = withoutOwned(args);
      const client = clientFor(lane);
      const queryId = idFor(clean.query_id);
      return sendWithQuotaKey(client, (withKey) => client.command({ ...clean, ...identity(queryId, clean.clickhouse_settings, withKey) }), true);
    },
    exec(args: ExecArgs) {
      const clean = withoutOwned(args);
      const client = clientFor(lane);
      const queryId = idFor(clean.query_id);
      return sendWithQuotaKey(client, (withKey) => client.exec({ ...clean, ...identity(queryId, clean.clickhouse_settings, withKey) }), true);
    },
    insert<T>(args: InsertArgs<T>) {
      const clean = withoutOwned(args);
      const client = clientFor(lane);
      const queryId = idFor(clean.query_id);
      return sendWithQuotaKey(client, (withKey) => client.insert({ ...clean, ...identity(queryId, clean.clickhouse_settings, withKey) }), false);
    },
    queryChecked<Format extends DataFormat = "JSON">(statement: CheckedStatement, args: CheckedQueryArgs<Format> = {}): Promise<ResultSet<Format>> {
      const { readOnlyFeature, ...rest } = withoutText(withoutOwned(args));
      const settings = checkedSettings(actor, statement, rest.clickhouse_settings, readOnlyFeature);
      const client = clientFor(lane) as { query(params: QueryArgs<Format>): Promise<ResultSet<Format>> };
      const queryId = idFor(rest.query_id);
      const call = { ...rest, query: statement.sql, ...(statement.params ? { query_params: statement.params } : {}) } as QueryArgs<Format>;
      return sendWithQuotaKey(client, (withKey) => client.query({ ...call, ...identity(queryId, settings, withKey) }), true);
    },
    commandChecked(statement: CheckedStatement, args: CheckedCommandArgs = {}) {
      const { readOnlyFeature, ...rest } = withoutText(withoutOwned(args));
      const settings = checkedSettings(actor, statement, rest.clickhouse_settings, readOnlyFeature);
      const client = clientFor(lane);
      const queryId = idFor(rest.query_id);
      const call: CommandArgs = { ...rest, query: statement.sql, ...(statement.params ? { query_params: statement.params } : {}) };
      return sendWithQuotaKey(client, (withKey) => client.command({ ...call, ...identity(queryId, settings, withKey) }), true);
    },
    async ping(): Promise<boolean> {
      return (await clientFor(lane).ping()).success;
    },
    session(signal?: AbortSignal, sessionId?: string): ChSession {
      const client = clientFor(lane);
      return buildSession(
        {
          query: (args) => {
            const queryId = idFor(args.query_id);
            return sendWithQuotaKey(client, (withKey) => client.query({ ...args, ...identity(queryId, args.clickhouse_settings, withKey) }), true);
          },
          command: (args) => {
            const queryId = idFor(args.query_id);
            return sendWithQuotaKey(client, (withKey) => client.command({ ...args, ...identity(queryId, args.clickhouse_settings, withKey) }), true);
          },
        },
        signal,
        sessionId,
      );
    },
    queryIdFor(nonce: string): string {
      return idFor(nonce);
    },
    withContext(context: Record<string, string>): ChExecutor {
      return executorOverClient(clientFor, actor, { ...options, context: { ...options.context, ...context } }, lane);
    },
    onServiceLane(): ChExecutor {
      return executorOverClient(clientFor, actor, options, "service");
    },
  };
}

/** Test seam: when set, every handle sends through this stand-in instead of a pooled client. */
let testClient: ((connectionId: string | undefined, config: ConnectionConfig | undefined) => unknown) | null = null;

/**
 * Replace the ClickHouse client for tests. Throws outside `bun test`, so no
 * running server can be pointed at a stand-in.
 */
export function setExecutorClientForTests(factory: ((connectionId: string | undefined, config: ConnectionConfig | undefined) => unknown) | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setExecutorClientForTests is only available under test");
  testClient = factory;
}

/** A handle for a login given directly: a login under test, or one a caller already resolved. */
export function executorForConfig(config: ConnectionConfig, actor: Actor, options: ExecutorOptions = {}): ChExecutor {
  if (testClient) {
    const stand = testClient;
    return executorOverClient(() => stand(undefined, config) as ClientLike, actor, options);
  }
  return executorOverClient((lane) => ClientManager.getInstance().getClient(config, lane), actor, options);
}

/** The stored login of a connection, as a client config. */
export async function connectionConfig(connectionId: string, credential: Credential = "connection"): Promise<ConnectionConfig> {
  const { getConnectionWithPassword } = await import("../../rbac/services/connections");
  const connection = await getConnectionWithPassword(connectionId);
  if (!connection) throw new Error(`Connection ${connectionId} not found`);
  const url = `${connection.sslEnabled ? "https" : "http"}://${connection.host}:${connection.port}`;
  if (credential === "remediation") {
    const { getCredential } = await import("../remediation/store");
    const stored = await getCredential(connectionId);
    if (!stored) throw new Error(`Connection ${connectionId} has no remediation login`);
    return { url, username: stored.username, password: stored.password, database: connection.database || undefined };
  }
  return { url, username: connection.username, password: connection.password || "", database: connection.database || undefined };
}

/** A handle for a saved connection, by id. */
export async function executorForConnection(
  connectionId: string,
  actor: Actor,
  options: ExecutorOptions & { credential?: Credential } = {},
): Promise<ChExecutor> {
  const { credential, ...rest } = options;
  if (testClient) {
    const stand = testClient;
    return executorOverClient(() => stand(connectionId, undefined) as ClientLike, actor, rest);
  }
  return executorForConfig(await connectionConfig(connectionId, credential), actor, rest);
}

/**
 * A handle over a client made for one use, outside the pool: testing a login
 * before it is saved, and admin lookups that must not be answered by a cached
 * client in a bad state. The caller must call `close`.
 */
export function ephemeralExecutor(
  config: ConnectionConfig,
  actor: Actor,
  options: ExecutorOptions & { requestTimeoutMs: number },
): { executor: ChExecutor; close: () => Promise<void> } {
  const { requestTimeoutMs, ...rest } = options;
  const client = createClient({
    url: config.url,
    username: config.username,
    password: config.password || "",
    database: config.database || "default",
    request_timeout: requestTimeoutMs,
  });
  return { executor: executorOverClient(() => client, actor, rest), close: () => client.close() };
}
