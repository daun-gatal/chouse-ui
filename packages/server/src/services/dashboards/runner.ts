/**
 * Panel execution (ADR 0021 §4). Every run, for every viewer:
 *
 *   1. the viewer may use the connection;
 *   2. the SQL compiles with the dashboard's variables (macros.ts);
 *   3. it is a single read-only SELECT;
 *   4. the viewer's data-access rules allow every table it reads;
 *   5. a token caller (CLI, MCP) passes agent governance like any query
 *      (ADR 0016 §10: pause switch, budget, session record);
 *   6. it runs read-only with hard caps — never truncated — tagged in
 *      `log_comment` so Performance leaves it out.
 *
 * Only after 1–5 pass is the shared cache consulted (cache.ts). Errors are
 * AppErrors whose message says what to change; nothing is retried, hidden or
 * replaced by an empty result.
 */

import { ClickHouseError, type ClickHouseClient } from "@clickhouse/client";

import { validateQueryAccess } from "../../middleware/dataAccess";
import { governAgentQuery, recordAgentQuery, type AgentContext } from "../agents/governance";
import type { ConnectionResponse } from "../../rbac/services/connections";
import { AppError } from "../../types";
import { clientForConnection } from "../scheduledQueries/chClient";
import { validateReadOnlySelect } from "../scheduledQueries/validation";
import { isAdmin, viewerConnections, type Viewer } from "./access";
import { cacheKey, KeyedSemaphore, ResultCache, type Cached } from "./cache";
import { compileSql, resolveWindow, type Compiled, type Window } from "./macros";
import type { TimeRange, Variable } from "./spec";

export const DASHBOARDS_SOURCE = "dashboards";
export const MAX_RESULT_ROWS = 10_000;
export const MAX_OPTION_ROWS = 1_000;
export const MAX_BYTES_TO_READ = 20 * 1024 * 1024 * 1024;
export const MAX_EXECUTION_SECONDS = 30;
export const MAX_FLEET_CONNECTIONS = 20;

export interface PanelColumn {
  name: string;
  type: string;
}

export interface PanelData {
  columns: PanelColumn[];
  rows: Array<Record<string, unknown>>;
  elapsedMs: number;
  readRows: number;
  readBytes: number;
  ranAt: number;
}

export interface PanelRun {
  connectionId: string;
  window: Window;
  data: PanelData;
  cached: boolean;
}

export type FleetEntry =
  | { connectionId: string; connectionName: string; ok: true; data: PanelData; cached: boolean }
  | { connectionId: string; connectionName: string; ok: false; error: string };

export interface FleetRun {
  window: Window;
  connections: FleetEntry[];
  /** Connections the viewer may use beyond MAX_FLEET_CONNECTIONS, not run. */
  omitted: number;
}

const cache = new ResultCache<PanelData>();
const semaphore = new KeyedSemaphore();

/** For tests: forget every cached result. */
export function clearPanelCache(): void {
  cache.clear();
}

export interface PanelQuery {
  sql: string;
  variables: Variable[];
  /** Values chosen for the variables; a variable without one uses its default. */
  values: Record<string, string>;
  range: TimeRange;
  /** Tags for `log_comment`. */
  dashboardId: string | null;
  panelId: string | null;
}

/** Defaults merged with the chosen values; a value for an undeclared variable is refused. */
export function resolveValues(variables: Variable[], values: Record<string, string>): Record<string, string> {
  const declared = new Set(variables.map((v) => v.name));
  const unknown = Object.keys(values).filter((name) => !declared.has(name));
  if (unknown.length > 0) throw AppError.badRequest(`Unknown variable: ${unknown.join(", ")}`);
  return { ...Object.fromEntries(variables.map((v) => [v.name, v.default])), ...values };
}

/** Steps 2–3: compile and check the statement shape. */
export function compilePanel(query: PanelQuery, window: Window): Compiled {
  const result = compileSql(query.sql, query.variables, resolveValues(query.variables, query.values), window);
  if (!result.ok) throw AppError.badRequest(result.error);
  const readOnly = validateReadOnlySelect(result.compiled.validationSql);
  if (!readOnly.ok) throw AppError.badRequest(readOnly.error ?? "Only a single read-only SELECT is allowed");
  return result.compiled;
}

/** Step 4: the viewer's data-access rules for the compiled statement. */
export async function assertDataAccess(viewer: Viewer, compiled: Compiled, connection: ConnectionResponse): Promise<void> {
  const access = await validateQueryAccess(viewer.id, isAdmin(viewer), viewer.permissions, compiled.validationSql, connection.database ?? undefined, connection.id);
  if (!access.allowed) throw AppError.forbidden(access.reason ?? "Access denied");
}

/** Step 1: the viewer's connection, or a refusal. */
export async function viewerConnection(viewer: Viewer, connectionId: string): Promise<ConnectionResponse> {
  const connection = (await viewerConnections(viewer)).find((c) => c.id === connectionId);
  if (!connection) throw AppError.forbidden("You do not have access to this connection");
  return connection;
}

function queryError(error: unknown, maxRows: number): AppError {
  if (error instanceof ClickHouseError) {
    if (error.type === "TOO_MANY_ROWS_OR_BYTES") {
      return AppError.badRequest(`The query returned more than ${maxRows.toLocaleString("en-US")} rows. Aggregate further (a coarser bucket, fewer groups) or add a LIMIT.`);
    }
    if (error.type === "TOO_MANY_BYTES") {
      return AppError.badRequest("The query would read more than 20 GiB. Narrow the time range or filter on the table's partition or primary key.");
    }
    if (error.type === "TIMEOUT_EXCEEDED") {
      return AppError.badRequest(`The query ran longer than ${MAX_EXECUTION_SECONDS} s. Narrow the time range or aggregate less.`);
    }
    return AppError.badRequest(`ClickHouse: ${error.message}`);
  }
  if (error instanceof AppError) return error;
  return AppError.unavailable(`Could not run the query on ClickHouse: ${error instanceof Error ? error.message : String(error)}`);
}

interface JsonResult {
  meta: PanelColumn[];
  data: Array<Record<string, unknown>>;
  statistics?: { elapsed?: number; rows_read?: number; bytes_read?: number };
}

async function connectionClient(connectionId: string): Promise<ClickHouseClient> {
  return clientForConnection(connectionId, JSON.stringify({ source: DASHBOARDS_SOURCE }));
}

/** Agent identity per connection for token callers; null for browser sessions. */
export type AgentFor = (connectionId: string) => AgentContext | null;

function estimator(connectionId: string): { executeQuery<T>(query: string): Promise<{ data: T[] }> } {
  return {
    async executeQuery<T>(query: string): Promise<{ data: T[] }> {
      const client = await connectionClient(connectionId);
      const result = await client.query({ query, format: "JSON", clickhouse_settings: { readonly: "1", max_execution_time: 10 } });
      return (await result.json()) as { data: T[] };
    },
  };
}

/** Step 6: run a compiled statement with the dashboard caps. */
export async function execute(connectionId: string, compiled: Compiled, tags: Record<string, string | null>, maxRows: number = MAX_RESULT_ROWS): Promise<PanelData> {
  try {
    const client = await connectionClient(connectionId);
    const result = await client.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: "JSON",
      clickhouse_settings: {
        readonly: "1",
        max_execution_time: MAX_EXECUTION_SECONDS,
        max_result_rows: String(maxRows),
        result_overflow_mode: "throw",
        max_bytes_to_read: String(MAX_BYTES_TO_READ),
        read_overflow_mode: "throw",
        output_format_json_quote_64bit_integers: 0,
        log_comment: JSON.stringify({ source: DASHBOARDS_SOURCE, ...tags }),
      },
    });
    const json = (await result.json()) as JsonResult;
    return {
      columns: json.meta,
      rows: json.data,
      elapsedMs: Math.round((json.statistics?.elapsed ?? 0) * 1000),
      readRows: Number(json.statistics?.rows_read ?? 0),
      readBytes: Number(json.statistics?.bytes_read ?? 0),
      ranAt: Date.now(),
    };
  } catch (error) {
    throw queryError(error, maxRows);
  }
}

async function runOn(viewer: Viewer, connection: ConnectionResponse, query: PanelQuery, window: Window, agentFor: AgentFor): Promise<{ data: PanelData; cached: boolean }> {
  const compiled = compilePanel(query, window);
  await assertDataAccess(viewer, compiled, connection);
  const agent = agentFor(connection.id);
  const governance = agent ? await governAgentQuery(agent, compiled.validationSql, estimator(connection.id)) : null;
  if (governance?.decision.decision === "block") {
    throw AppError.forbidden(`Blocked by agent policy: ${governance.decision.reasons.join("; ") || "agent access is restricted"}`);
  }
  let outcome: Cached<PanelData>;
  try {
    outcome = await cache.getOrRun(cacheKey(connection.id, compiled.sql, compiled.params), async () => {
      const data = await semaphore.run(connection.id, () => execute(connection.id, compiled, { dashboardId: query.dashboardId, panelId: query.panelId }));
      return { value: data, bytes: Buffer.byteLength(JSON.stringify(data.rows)) };
    });
  } catch (error) {
    if (agent && governance) await recordAgentQuery(agent, governance, query.sql, "error", 0, error instanceof Error ? error.message : String(error));
    throw error;
  }
  if (agent && governance) await recordAgentQuery(agent, governance, query.sql, "ok", outcome.cached ? 0 : outcome.value.readBytes);
  return { data: outcome.value, cached: outcome.cached };
}

/** Run one panel on one connection, as `viewer`. */
export async function runPanel(viewer: Viewer, connectionId: string, query: PanelQuery, agentFor: AgentFor, nowMs: number = Date.now()): Promise<PanelRun> {
  const connection = await viewerConnection(viewer, connectionId);
  const window = resolveWindow(query.range, nowMs);
  const { data, cached } = await runOn(viewer, connection, query, window, agentFor);
  return { connectionId, window, data, cached };
}

/** Run one panel on every connection the viewer may use (up to MAX_FLEET_CONNECTIONS). */
export async function runFleet(viewer: Viewer, query: PanelQuery, agentFor: AgentFor, nowMs: number = Date.now()): Promise<FleetRun> {
  const all = await viewerConnections(viewer);
  const connections = [...all].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_FLEET_CONNECTIONS);
  const window = resolveWindow(query.range, nowMs);
  const entries = await Promise.all(connections.map(async (connection): Promise<FleetEntry> => {
    try {
      const { data, cached } = await runOn(viewer, connection, query, window, agentFor);
      return { connectionId: connection.id, connectionName: connection.name, ok: true, data, cached };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { connectionId: connection.id, connectionName: connection.name, ok: false, error: message };
    }
  }));
  return { window, connections: entries, omitted: all.length - connections.length };
}

/** A variable's options from its one-column query, as the viewer. */
export async function runOptions(viewer: Viewer, connectionId: string, sql: string, agentFor: AgentFor): Promise<string[]> {
  const connection = await viewerConnection(viewer, connectionId);
  const readOnly = validateReadOnlySelect(sql);
  if (!readOnly.ok) throw AppError.badRequest(readOnly.error ?? "Only a single read-only SELECT is allowed");
  const compiled: Compiled = { sql, params: {}, validationSql: sql };
  await assertDataAccess(viewer, compiled, connection);
  const agent = agentFor(connection.id);
  const governance = agent ? await governAgentQuery(agent, sql, estimator(connection.id)) : null;
  if (governance?.decision.decision === "block") {
    throw AppError.forbidden(`Blocked by agent policy: ${governance.decision.reasons.join("; ") || "agent access is restricted"}`);
  }
  let data: PanelData;
  try {
    data = await semaphore.run(connection.id, () => execute(connection.id, compiled, { dashboardId: null, panelId: "options" }, MAX_OPTION_ROWS));
  } catch (error) {
    if (agent && governance) await recordAgentQuery(agent, governance, sql, "error", 0, error instanceof Error ? error.message : String(error));
    throw error;
  }
  if (agent && governance) await recordAgentQuery(agent, governance, sql, "ok", data.readBytes);
  if (data.columns.length !== 1) throw AppError.badRequest(`An options query must return exactly one column; this one returns ${data.columns.length}`);
  const column = data.columns[0].name;
  if (data.rows.some((row) => row[column] === null)) throw AppError.badRequest(`The options query returned NULL; add WHERE ${column} IS NOT NULL`);
  return data.rows.map((row) => String(row[column]));
}
