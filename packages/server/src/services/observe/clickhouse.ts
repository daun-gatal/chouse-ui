/**
 * Read-only ClickHouse access for the collector (ADR 0016 §1).
 *
 * Every collector query runs with `readonly=1` and an execution cap, tagged
 * with a `log_comment` of `{source:"observe", collector}` so CHouse's own
 * collection is attributable — and excluded — in `system.query_log`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { executorForConnection, serviceActor, type Actor, type ChExecutor, type CheckedStatement } from "../chExecutor";

export const OBSERVE_SOURCE = "observe";

/**
 * A handle tagged as observe traffic. Collection passes no actor and runs as
 * the service purpose `collector`; a route acting for a signed-in person
 * passes that person.
 */
export async function observeClient(connectionId: string, collector: string, actor: Actor = serviceActor("collector")): Promise<ChExecutor> {
  return executorForConnection(connectionId, actor, { context: { source: OBSERVE_SOURCE, collector } });
}

/** What one collector run read from ClickHouse, summed over its queries. */
export interface RunCost {
  queries: number;
  readRows: number;
  readBytes: number;
}

const costScope = new AsyncLocalStorage<RunCost>();

/** Run `fn`, summing what every `selectRows` inside it reads — also when it fails, since the reads still happened (issue #380). */
export async function measureRunCost<T>(fn: () => Promise<T>): Promise<{ cost: RunCost; error: unknown }> {
  const cost: RunCost = { queries: 0, readRows: 0, readBytes: 0 };
  try {
    await costScope.run(cost, fn);
    return { cost, error: null };
  } catch (error) {
    return { cost, error };
  }
}

function recordSummary(header: unknown): void {
  const cost = costScope.getStore();
  if (!cost) return;
  cost.queries += 1;
  if (typeof header !== "string") return;
  try {
    const summary = JSON.parse(header) as { read_rows?: unknown; read_bytes?: unknown };
    cost.readRows += Number(summary.read_rows) || 0;
    cost.readBytes += Number(summary.read_bytes) || 0;
  } catch {
    // A missing or malformed summary only leaves this query uncounted.
  }
}

export interface QueryOptions {
  params?: Record<string, unknown>;
  maxExecutionTime?: number;
  maxResultRows?: number;
}

function readSettings(options: QueryOptions): Record<string, string | number> {
  return {
    max_execution_time: options.maxExecutionTime ?? 30,
    ...(options.maxResultRows ? { max_result_rows: String(options.maxResultRows), result_overflow_mode: "break" } : {}),
    // Numbers as JSON numbers keeps parsing cheap; UInt64 beyond 2^53 is acceptable loss for metrics.
    output_format_json_quote_64bit_integers: 0,
    // Inside a measured run, send headers only once the query finished, so
    // X-ClickHouse-Summary holds the final rows and bytes read.
    ...(costScope.getStore() ? { wait_end_of_query: 1 } : {}),
  };
}

/** Rows of typed text a person wrote (a notebook cell), read-only. Its parameters are the ones it was checked with. */
export async function selectCheckedRows<T = Record<string, unknown>>(
  client: ChExecutor,
  statement: CheckedStatement,
  options: Omit<QueryOptions, "params"> = {},
): Promise<T[]> {
  const result = await client.queryChecked(statement, { format: "JSONEachRow", readOnlyFeature: 1, clickhouse_settings: readSettings(options) });
  const rows = (await result.json()) as T[];
  recordSummary(result.response_headers?.["x-clickhouse-summary"]);
  return rows;
}

/** Rows of CHouse-built text, read-only. */
export async function selectRows<T = Record<string, unknown>>(
  client: ChExecutor,
  query: string,
  options: QueryOptions = {},
): Promise<T[]> {
  const result = await client.query({
    query,
    query_params: options.params,
    format: "JSONEachRow",
    clickhouse_settings: { readonly: "1", ...readSettings(options) },
  });
  const rows = (await result.json()) as T[];
  // Measuring must never break a query: without the header it is just not counted.
  recordSummary(result.response_headers?.["x-clickhouse-summary"]);
  return rows;
}

/** HTTP clients append `FORMAT …` to what query_log records; wrapping that text (EXPLAIN, subquery) needs it gone. */
export function stripFormat(query: string): string {
  return query.replace(/;\s*$/, "").replace(/\s+FORMAT\s+\w+\s*;?\s*$/i, "");
}

/** Exclude CHouse's own traffic (collection, preflights, dashboard panels) from query_log reads. */
export const NOT_OBSERVE = `JSONExtractString(log_comment, 'source') NOT IN ('observe', 'remediation_preflight', 'dashboards')`;
