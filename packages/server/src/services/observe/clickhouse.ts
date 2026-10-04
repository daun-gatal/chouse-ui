/**
 * Read-only ClickHouse access for the collector (ADR 0016 §1).
 *
 * Every collector query runs with `readonly=1` and an execution cap, tagged
 * with a `log_comment` of `{source:"observe", collector}` so CHouse's own
 * collection is attributable — and excluded — in `system.query_log`.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { clientForConnection } from "../scheduledQueries/chClient";

export const OBSERVE_SOURCE = "observe";

export function observeLogComment(collector: string): string {
  return JSON.stringify({ source: OBSERVE_SOURCE, collector });
}

export async function observeClient(connectionId: string, collector: string): Promise<ClickHouseClient> {
  return clientForConnection(connectionId, observeLogComment(collector));
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
    },
  });
  return (await result.json()) as T[];
}

/** Exclude CHouse's own observe traffic from query_log reads. */
export const NOT_OBSERVE = `JSONExtractString(log_comment, 'source') NOT IN ('observe', 'remediation_preflight')`;
