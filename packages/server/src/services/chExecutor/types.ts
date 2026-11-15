/**
 * Types of the statement executor (ADR 0033 §2): who a request is for, which
 * login sends it, and the client-shaped calls the rest of the server may make.
 */

import type {
  ClickHouseSettings,
  CommandParams,
  CommandResult,
  DataFormat,
  ExecParams,
  ExecResult,
  InsertParams,
  InsertResult,
  QueryParams,
  ResultSet,
} from "@clickhouse/client";
import type Stream from "node:stream";

import type { ConnectionConfig } from "../../types";
import type { CheckedStatement } from "./checked";
import type { ConnectionIdentity } from "./identity";
import type { ChSession } from "./session";
import type { ReadOnlyLevel } from "./settings";

/** Work CHouse does on its own account, by name. The list is closed. */
export const SERVICE_PURPOSES = [
  "collector",
  "access-parse",
  "fleet-metrics",
  "stop-query",
  "health-check",
  "version-probe",
  "upgrade-check",
  "connection-test",
  "remediation",
  // System-table reads CHouse builds for a monitoring page, on a connection where a person's own role holds no system grant.
  "monitoring",
] as const;
export type ServicePurpose = (typeof SERVICE_PURPOSES)[number];

/** Who CHouse is acting for when it sends a statement. */
export type Actor =
  | { kind: "person"; accountId: string; tokenId?: string }
  | { kind: "service"; purpose: ServicePurpose; triggeredBy?: string };

/** Which stored login a request authenticates with. */
export type Credential = "connection" | "remediation";

export function personActor(accountId: string, tokenId?: string): Actor {
  return tokenId ? { kind: "person", accountId, tokenId } : { kind: "person", accountId };
}

export function serviceActor(purpose: ServicePurpose, triggeredBy?: string): Actor {
  return triggeredBy ? { kind: "service", purpose, triggeredBy } : { kind: "service", purpose };
}

/** A query call with its format in the type, as the client declares it. */
export type QueryParamsWithFormat<Format extends DataFormat> = Omit<QueryParams, "format"> & { format?: Format };

/** Fields of a client call that only the executor may set. */
type Owned = "session_id" | "role" | "auth" | "http_headers";

export type QueryArgs<Format extends DataFormat = "JSON"> = Omit<QueryParamsWithFormat<Format>, Owned>;
export type CommandArgs = Omit<CommandParams, Owned>;
export type ExecArgs = Omit<ExecParams, Owned>;
export type InsertArgs<T> = Omit<InsertParams<Stream.Readable, T>, Owned>;

/** What a call may still choose for a checked statement: the text and its parameters come from the statement. */
type CheckedOwned = "query" | "query_params";
interface CheckedExtras {
  /** Set by a feature that only reads (dashboards, data health); the level it sends for every person. */
  readOnlyFeature?: ReadOnlyLevel;
}
export type CheckedQueryArgs<Format extends DataFormat = "JSON"> = Omit<QueryArgs<Format>, CheckedOwned> & CheckedExtras;
export type CheckedCommandArgs = Omit<CommandArgs, CheckedOwned> & CheckedExtras;

/**
 * A handle for one connection, actor and login. Its methods have the shape of
 * the ClickHouse client's, minus the fields in `Owned`. `query_id` is treated
 * as the random part of the id the executor builds, and `log_comment` in
 * `clickhouse_settings` is ignored: use `context` when the handle is made.
 */
export interface ChExecutor {
  readonly actor: Actor;
  query<Format extends DataFormat = "JSON">(args: QueryArgs<Format>): Promise<ResultSet<Format>>;
  command(args: CommandArgs): Promise<CommandResult>;
  exec(args: ExecArgs): Promise<ExecResult<Stream.Readable>>;
  insert<T>(args: InsertArgs<T>): Promise<InsertResult>;
  /**
   * Run typed text. It takes only a checked statement, made for this handle's
   * person, and decides `readonly` itself (`settings.ts`); a `readonly` in
   * `clickhouse_settings` is ignored.
   */
  queryChecked<Format extends DataFormat = "JSON">(statement: CheckedStatement, args?: CheckedQueryArgs<Format>): Promise<ResultSet<Format>>;
  /** As `queryChecked`, for typed text that returns no rows. */
  commandChecked(statement: CheckedStatement, args?: CheckedCommandArgs): Promise<CommandResult>;
  ping(): Promise<boolean>;
  /**
   * Statements as a sequence. With a `sessionId` every statement runs in that one
   * ClickHouse session and a moved request fails (ADR 0015 §4); without one each
   * statement is stateless. Only CHouse-built text may be sent this way.
   */
  session(signal?: AbortSignal, sessionId?: string): ChSession;
  /** The full query id a request sent with this nonce carries. */
  queryIdFor(nonce: string): string;
  /** The same connection and actor, with extra `log_comment` context. */
  withContext(context: Record<string, string>): ChExecutor;
  /** The same connection and actor on the lane kept free for short service requests. */
  onServiceLane(): ChExecutor;
}

export interface ExecutorOptions {
  /** Context fields for `log_comment` (source, agent, token). Never identity. */
  context?: Record<string, string>;
  /** The connection's kind and health. With it the handle names a ClickHouse role on each request, or refuses (`identity.ts`). */
  identity?: ConnectionIdentity;
  /**
   * For checking a login (the identity checks, and the connection test):
   * `null` sends a bare request, a name sends with that role, and neither is
   * refused for the connection's health, since a check must run on a
   * connection that is refusing. The name comes from the connection's own
   * settings; never pass one taken from a request.
   */
  roleOverride?: string | null;
  /** The stored login this handle authenticates with. Set by the executor's own factories; a personal connection's self-test names it. */
  login?: string;
  /** The saved connection this handle sends on, when known. A checked statement for another connection is refused. */
  connectionId?: string;
  /** True for a feature's own requests (collection, dashboard panels): their query ids are marked so reports leave them out. */
  internal?: boolean;
  /** Settings every request of this handle carries unless the call overrides them. */
  defaults?: ClickHouseSettings;
}

export interface ResolvedTarget {
  config: ConnectionConfig;
  actor: Actor;
  options: ExecutorOptions;
}
