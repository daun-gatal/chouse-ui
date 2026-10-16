/**
 * Read-only ClickHouse access for the collector (ADR 0016 §1).
 *
 * Every collector query runs with `readonly=1` and an execution cap, tagged
 * with a `log_comment` of `{source:"observe", collector}` so CHouse's own
 * collection is attributable — and excluded — in `system.query_log`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { ClickHouseClient } from "@clickhouse/client";

import { clientForConnection } from "../scheduledQueries/chClient";

export const OBSERVE_SOURCE = "observe";

export function observeLogComment(collector: string): string {
  return JSON.stringify({ source: OBSERVE_SOURCE, collector });
}

export async function observeClient(connectionId: string, collector: string): Promise<ClickHouseClient> {
  return clientForConnection(connectionId, observeLogComment(collector));
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

export async function selectRows<T = Record<string, unknown>>(
  client: ClickHouseClient,
  query: string,
  options: QueryOptions = {},
): Promise<T[]> {
  const result = await client.query({
    query,
    query_params: options.params,
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "1",
      max_execution_time: options.maxExecutionTime ?? 30,
      ...(options.maxResultRows ? { max_result_rows: String(options.maxResultRows), result_overflow_mode: "break" } : {}),
      // Numbers as JSON numbers keeps parsing cheap; UInt64 beyond 2^53 is acceptable loss for metrics.
      output_format_json_quote_64bit_integers: 0,
      // Inside a measured run, send headers only once the query finished, so
      // X-ClickHouse-Summary holds the final rows and bytes read.
      ...(costScope.getStore() ? { wait_end_of_query: 1 } : {}),
    },
  });
  const rows = (await result.json()) as T[];
  // Measuring must never break a query: without the header it is just not counted.
  recordSummary(result.response_headers?.["x-clickhouse-summary"]);
  return rows;
}

/** Exclude CHouse's own observe traffic from query_log reads. */
/** HTTP clients append `FORMAT …` to what query_log records; wrapping that text (EXPLAIN, subquery) needs it gone. */
export function stripFormat(query: string): string {
  return query.replace(/;\s*$/, "").replace(/\s+FORMAT\s+\w+\s*;?\s*$/i, "");
}

export const NOT_OBSERVE = `JSONExtractString(log_comment, 'source') NOT IN ('observe', 'remediation_preflight')`;
