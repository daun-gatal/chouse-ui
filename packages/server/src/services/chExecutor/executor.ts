/**
 * The statement executor (ADR 0033 §2): the only code that sends anything to
 * ClickHouse. A handle is bound to one login and one actor; on every request it
 * sets the query id, `log_comment` and the quota key from that actor, and it
 * accepts no session, role, credentials or headers from the call.
 */

import { createClient, type ClickHouseClient, type ClickHouseSettings, type DataFormat, type ResultSet } from "@clickhouse/client";

import { AppError, type ConnectionConfig } from "../../types";
import { CheckedStatement } from "./checked";
import { ClientManager, type ClientLane } from "./clientPool";
import { connectionUnavailable, identityOfConnection, requestIdentity, type RequestIdentity } from "./identity";
import { importAs, IMPORT_SESSION_SECONDS } from "./importSession";
import { wrapBuilt } from "./impersonate";
import { makeQueryId } from "./queryId";
import { buildSession, type ChSession } from "./session";
import { ensureCreateChecked } from "./selfTest";
import { readonlyFor, type ReadOnlyLevel } from "./settings";
import { serviceActor } from "./types";
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
  // The client writes every setting as a URL parameter, and `role` is one ClickHouse reads there.
  const { role: _role, ...settings } = { ...options.defaults, ...given } as ClickHouseSettings & { role?: unknown };
  return { ...settings, log_comment: logCommentFor(actor, options.context) };
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
function checkedSettings(actor: Actor, connectionId: string | undefined, statement: CheckedStatement, given: ClickHouseSettings | undefined, feature: ReadOnlyLevel | undefined): ClickHouseSettings {
  if (!CheckedStatement.isReal(statement)) {
    throw new Error("Typed text can only be sent as a statement the access check returned");
  }
  if (actor.kind !== "person" || actor.accountId !== statement.accountId) {
    throw new Error("A checked statement can only be sent for the person it was checked for");
  }
  if (connectionId !== undefined && statement.connectionId !== undefined && connectionId !== statement.connectionId) {
    throw new Error("A checked statement can only be sent on the connection it was checked for");
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
  const envelope = (queryId: string, settings: ClickHouseSettings, withKey: boolean, role: string | undefined) => ({
    query_id: queryId,
    clickhouse_settings: settings,
    ...(role ? { role } : {}),
    ...(withKey ? { http_headers: { "X-ClickHouse-Quota": quotaKeyFor(actor) } } : {}),
  });
  /**
   * The ClickHouse identity of this request (ADR 0033 §5 to §7), resolved for
   * every request so a removed role, a changed binding or a failing verdict
   * stops the next one. It rejects when the request must not be sent.
   * `roleOverride` is for checking a login: a bare request, or a role named
   * from the connection's own settings, never from a request.
   */
  const resolve = async (): Promise<RequestIdentity> => {
    if (options.roleOverride !== undefined) return options.roleOverride ? { role: options.roleOverride } : {};
    const resolved = await requestIdentity(options.identity, actor);
    if (resolved.executeAs) await createChecked(resolved);
    return resolved;
  };
  /**
   * Before anything runs as a person, the server must still refuse an
   * unchecked `CREATE` under `EXECUTE AS` (§7.1). Remembered for a minute per
   * connection and login.
   */
  const createChecked = async (resolved: RequestIdentity): Promise<void> => {
    const identity = options.identity;
    if (!identity || !options.login) throw new Error("A personal connection needs its login to be known before a statement can run as a person");
    const login = options.login;
    const client = clientFor("service");
    try {
      await ensureCreateChecked(`${identity.connectionId}\u0000${login}`, async (query) => {
        await client.command({ query, role: resolved.role, query_id: makeQueryId(serviceActor("health-check"), undefined, true), clickhouse_settings: { log_comment: logCommentFor(serviceActor("health-check"), { source: "create_recheck" }), max_execution_time: 10 } });
        return "";
      }, login);
    } catch (error) {
      throw connectionUnavailable(`This connection is not available: ${error instanceof Error ? error.message : String(error)}`, identity);
    }
  };
  /** Text CHouse built, and its settings, as this request sends them. */
  const built = (resolved: RequestIdentity, query: string, given: ClickHouseSettings | undefined): { query: string; settings: ClickHouseSettings } => {
    const settings = settingsFor(actor, options, given);
    if (!resolved.executeAs) return { query, settings };
    // `readonly` on the URL would apply to the wrapper, and ClickHouse refuses the whole request (observed): it goes into the statement.
    const { readonly, ...rest } = settings;
    return { query: wrapBuilt(resolved.executeAs.user, query, readonly !== undefined && String(readonly) !== "0"), settings: rest };
  };
  /** A checked statement's text and settings, as this request sends them. */
  const checked = (resolved: RequestIdentity, statement: CheckedStatement, given: ClickHouseSettings | undefined, feature: ReadOnlyLevel | undefined): { query: string; settings: ClickHouseSettings } => {
    const settings = settingsFor(actor, options, checkedSettings(actor, options.connectionId, statement, given, feature));
    if (!resolved.executeAs) {
      if (statement.impersonated) throw new Error("A statement checked for a personal connection can only be sent on one");
      return { query: statement.sql, settings };
    }
    const wrapped = statement.impersonated;
    if (!wrapped || wrapped.user !== resolved.executeAs.user) {
      throw new AppError("Your link to a ClickHouse user on this connection changed while the statement was being checked. Run it again.", "IDENTITY_UNAVAILABLE", "permission", 403);
    }
    const { readonly, ...rest } = settings;
    // A read is sent as a read whenever it can be; a statement that must be one and cannot carry it is refused.
    if (wrapped.readOnlySql !== null) return { query: wrapped.readOnlySql, settings: rest };
    if (readonly !== undefined) {
      throw new AppError("This statement must be a read here, and CHouse could not send it as one. If it has a FORMAT clause, remove it.", "READ_ONLY", "permission", 403);
    }
    return { query: wrapped.sql, settings: rest };
  };
  return {
    actor,
    async query<Format extends DataFormat = "JSON">(args: QueryArgs<Format>): Promise<ResultSet<Format>> {
      const clean = withoutOwned(args);
      const client = clientFor(lane) as { query(params: QueryArgs<Format>): Promise<ResultSet<Format>> };
      const queryId = idFor(clean.query_id);
      const resolved = await resolve();
      const { query, settings } = built(resolved, clean.query, clean.clickhouse_settings);
      return sendWithQuotaKey(client, (withKey) => client.query({ ...clean, query, ...envelope(queryId, settings, withKey, resolved.role) }), true);
    },
    async command(args: CommandArgs) {
      const clean = withoutOwned(args);
      const client = clientFor(lane);
      const queryId = idFor(clean.query_id);
      const resolved = await resolve();
      const { query, settings } = built(resolved, clean.query, clean.clickhouse_settings);
      return sendWithQuotaKey(client, (withKey) => client.command({ ...clean, query, ...envelope(queryId, settings, withKey, resolved.role) }), true);
    },
    async exec(args: ExecArgs) {
      const clean = withoutOwned(args);
      const client = clientFor(lane);
      const queryId = idFor(clean.query_id);
      const resolved = await resolve();
      const { query, settings } = built(resolved, clean.query, clean.clickhouse_settings);
      return sendWithQuotaKey(client, (withKey) => client.exec({ ...clean, query, ...envelope(queryId, settings, withKey, resolved.role) }), true);
    },
    async insert<T>(args: InsertArgs<T>) {
      const clean = withoutOwned(args);
      const client = clientFor(lane);
      const queryId = idFor(clean.query_id);
      const resolved = await resolve();
      const settings = settingsFor(actor, options, clean.clickhouse_settings);
      if (resolved.executeAs) {
        return importAs(resolved.executeAs.user, resolved.role, {
          open: (query, sessionId) => sendWithQuotaKey(client, (withKey) => client.command({ query, session_id: sessionId, ...envelope(idFor(undefined), { log_comment: settings.log_comment, session_timeout: String(IMPORT_SESSION_SECONDS) }, withKey, resolved.role) }), true),
          // The one request on a personal connection that names no role: the session already runs as the person (§7.7).
          insert: (sessionId) => {
            const { readonly: _readonly, ...rest } = settings;
            return sendWithQuotaKey(client, (withKey) => client.insert({ ...clean, session_id: sessionId, ...envelope(queryId, { ...rest, session_check: 1 }, withKey, undefined) }), false);
          },
        });
      }
      return sendWithQuotaKey(client, (withKey) => client.insert({ ...clean, ...envelope(queryId, settings, withKey, resolved.role) }), false);
    },
    async queryChecked<Format extends DataFormat = "JSON">(statement: CheckedStatement, args: CheckedQueryArgs<Format> = {}): Promise<ResultSet<Format>> {
      const { readOnlyFeature, ...rest } = withoutText(withoutOwned(args));
      const client = clientFor(lane) as { query(params: QueryArgs<Format>): Promise<ResultSet<Format>> };
      const queryId = idFor(rest.query_id);
      const resolved = await resolve();
      const { query, settings } = checked(resolved, statement, rest.clickhouse_settings, readOnlyFeature);
      const call = { ...rest, query, ...(statement.params ? { query_params: statement.params } : {}) } as QueryArgs<Format>;
      return sendWithQuotaKey(client, (withKey) => client.query({ ...call, ...envelope(queryId, settings, withKey, resolved.role) }), true);
    },
    async commandChecked(statement: CheckedStatement, args: CheckedCommandArgs = {}) {
      const { readOnlyFeature, ...rest } = withoutText(withoutOwned(args));
      const client = clientFor(lane);
      const queryId = idFor(rest.query_id);
      const resolved = await resolve();
      const { query, settings } = checked(resolved, statement, rest.clickhouse_settings, readOnlyFeature);
      const call: CommandArgs = { ...rest, query, ...(statement.params ? { query_params: statement.params } : {}) };
      return sendWithQuotaKey(client, (withKey) => client.command({ ...call, ...envelope(queryId, settings, withKey, resolved.role) }), true);
    },
    async ping(): Promise<boolean> {
      return (await clientFor(lane).ping()).success;
    },
    session(signal?: AbortSignal, sessionId?: string): ChSession {
      const client = clientFor(lane);
      /** A pinned session cannot switch user for each statement, so it is not available to a person on a personal connection (§7.5). */
      const forSession = async (): Promise<RequestIdentity> => {
        const resolved = await resolve();
        if (resolved.executeAs && sessionId) {
          throw new AppError("This needs one ClickHouse session for several statements, which is not available on a personal connection.", "UNAVAILABLE_ON_CONNECTION", "validation", 400);
        }
        return resolved;
      };
      return buildSession(
        {
          query: async (args) => {
            const queryId = idFor(args.query_id);
            const resolved = await forSession();
            const { query, settings } = built(resolved, args.query, args.clickhouse_settings);
            return sendWithQuotaKey(client, (withKey) => client.query({ ...args, query, ...envelope(queryId, settings, withKey, resolved.role) }), true);
          },
          command: async (args) => {
            const queryId = idFor(args.query_id);
            const resolved = await forSession();
            const { query, settings } = built(resolved, args.query, args.clickhouse_settings);
            return sendWithQuotaKey(client, (withKey) => client.command({ ...args, query, ...envelope(queryId, settings, withKey, resolved.role) }), true);
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
    return executorOverClient(() => stand(undefined, config) as ClientLike, actor, { ...options, identity: options.identity ?? config.identity, login: config.username });
  }
  return executorOverClient((lane) => ClientManager.getInstance().getClient(config, lane), actor, { ...options, identity: options.identity ?? config.identity, login: config.username });
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
  // The remediation login above carries no identity: it is outside the ceiling by design (ADR 0033 §5).
  return { url, username: connection.username, password: connection.password || "", database: connection.database || undefined, identity: identityOfConnection(connection) };
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
    return executorOverClient(() => stand(connectionId, undefined) as ClientLike, actor, { ...rest, connectionId });
  }
  return executorForConfig(await connectionConfig(connectionId, credential), actor, { ...rest, connectionId });
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
  if (testClient) {
    const stand = testClient;
    return { executor: executorOverClient(() => stand(undefined, config) as ClientLike, actor, { ...rest, identity: rest.identity ?? config.identity, login: config.username }), close: async () => undefined };
  }
  const client = createClient({
    url: config.url,
    username: config.username,
    password: config.password || "",
    database: config.database || "default",
    request_timeout: requestTimeoutMs,
  });
  return { executor: executorOverClient(() => client, actor, { ...rest, identity: rest.identity ?? config.identity, login: config.username }), close: () => client.close() };
}
