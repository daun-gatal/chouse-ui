/**
 * The statement executor (ADR 0033 §2): the only code that sends anything to
 * ClickHouse. A handle is bound to one login and one actor; on every request it
 * sets the query id, `log_comment` and the quota key from that actor, and it
 * accepts no session, role, credentials or headers from the call.
 */

import { createClient, type ClickHouseClient, type ClickHouseSettings, type DataFormat, type ResultSet } from "@clickhouse/client";

import type { ConnectionConfig } from "../../types";
import { ClientManager, type ClientLane } from "./clientPool";
import { makeQueryId } from "./queryId";
import { buildSession, type ChSession } from "./session";
import type {
  Actor,
  ChExecutor,
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
  const identity = (queryId: string | undefined, settings: ClickHouseSettings | undefined) => ({
    query_id: makeQueryId(actor, queryId),
    clickhouse_settings: settingsFor(actor, options, settings),
    http_headers: { "X-ClickHouse-Quota": quotaKeyFor(actor) },
  });
  return {
    actor,
    query<Format extends DataFormat = "JSON">(args: QueryArgs<Format>): Promise<ResultSet<Format>> {
      const clean = withoutOwned(args);
      const client = clientFor(lane) as { query(params: QueryArgs<Format>): Promise<ResultSet<Format>> };
      return client.query({ ...clean, ...identity(clean.query_id, clean.clickhouse_settings) });
    },
    command(args: CommandArgs) {
      const clean = withoutOwned(args);
      return clientFor(lane).command({ ...clean, ...identity(clean.query_id, clean.clickhouse_settings) });
    },
    exec(args: ExecArgs) {
      const clean = withoutOwned(args);
      return clientFor(lane).exec({ ...clean, ...identity(clean.query_id, clean.clickhouse_settings) });
    },
    insert<T>(args: InsertArgs<T>) {
      const clean = withoutOwned(args);
      return clientFor(lane).insert({ ...clean, ...identity(clean.query_id, clean.clickhouse_settings) });
    },
    async ping(): Promise<boolean> {
      return (await clientFor(lane).ping()).success;
    },
    session(signal?: AbortSignal, sessionId?: string): ChSession {
      const client = clientFor(lane);
      return buildSession(
        {
          query: (args) => client.query({ ...args, ...identity(args.query_id, args.clickhouse_settings) }),
          command: (args) => client.command({ ...args, ...identity(args.query_id, args.clickhouse_settings) }),
        },
        signal,
        sessionId,
      );
    },
    queryIdFor(nonce: string): string {
      return makeQueryId(actor, nonce);
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
