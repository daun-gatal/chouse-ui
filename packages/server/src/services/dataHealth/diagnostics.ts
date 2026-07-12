import type { ClickHouseClient } from "@clickhouse/client";

import { escapeIdentifier, escapeQualifiedIdentifier } from "../../utils/sqlIdentifier";
import { previousFireMs } from "../scheduledQueries/cadence";
import { buildExecutableQuery, toDateTime64Param, validateReadOnlySelect } from "../scheduledQueries/validation";
import { evaluateDataHealth } from "./evaluator";
import type { DataHealthCheckDefinition, DataHealthPromiseRow } from "./types";
import type { ScheduledQueryRow } from "../scheduledQueries/types";

export interface DataHealthBacktestSlot {
  slotAt: number;
  state: "healthy" | "degraded" | "unhealthy" | "unknown";
  checks: Array<{
    checkKey: string;
    outcome: "pass" | "breach" | "learning" | "not_evaluated";
    observedValue: number | null;
    expectedLower: number | null;
    expectedUpper: number | null;
  }>;
  error?: string;
}

export interface DataHealthBacktestResult {
  slots: DataHealthBacktestSlot[];
  summary: { evaluated: number; healthy: number; breached: number; unknown: number; errors: number };
}

function sourceSql(promise: DataHealthPromiseRow): string {
  if (promise.sourceType === "table") {
    if (!promise.databaseName || !promise.tableName) throw new Error("Data Health table source is incomplete");
    return escapeQualifiedIdentifier([promise.databaseName, promise.tableName]);
  }
  const query = promise.sourceQuery?.trim().replace(/;+$/, "");
  if (!query) throw new Error("Data Health query source is empty");
  return `(${query})`;
}

function baseFilters(promise: DataHealthPromiseRow, slotStart: string, slotEnd: string): string[] {
  const filters: string[] = [];
  if (promise.eventTimeColumn) {
    const column = escapeIdentifier(promise.eventTimeColumn);
    filters.push(`${column} >= ${slotStart} AND ${column} < ${slotEnd}`);
  }
  if (promise.rowFilter?.trim()) filters.push(`(${promise.rowFilter.trim()})`);
  return filters;
}

export function buildFailingRowsQuery(
  promise: DataHealthPromiseRow,
  check: DataHealthCheckDefinition,
  limit: number,
): string | null {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const slotStart = "{{slot_start}}";
  const slotEnd = "{{slot_end}}";
  const filters = baseFilters(promise, slotStart, slotEnd);
  const source = sourceSql(promise);

  switch (check.type) {
    case "completeness":
      filters.push(`${escapeIdentifier(check.config.column)} IS NULL`);
      break;
    case "validity":
      filters.push(`NOT (${check.config.predicate})`);
      break;
    case "freshness": {
      const column = escapeIdentifier(check.config.eventTimeColumn);
      const query = `SELECT * FROM ${source}${filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY ${column} DESC LIMIT ${boundedLimit}`;
      const validation = validateReadOnlySelect(query);
      if (!validation.ok) throw new Error(validation.error ?? "Invalid diagnostic query");
      return query;
    }
    case "uniqueness": {
      const keys = check.config.columns.map(escapeIdentifier);
      const query = `SELECT ${keys.join(", ")}, count() AS duplicate_count FROM ${source}${filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : ""} GROUP BY ${keys.join(", ")} HAVING duplicate_count > 1 ORDER BY duplicate_count DESC LIMIT ${boundedLimit}`;
      const validation = validateReadOnlySelect(query);
      if (!validation.ok) throw new Error(validation.error ?? "Invalid diagnostic query");
      return query;
    }
    case "row_count":
    case "volume_anomaly":
    case "schema_contract":
    case "custom_metric":
      return null;
  }

  const query = `SELECT * FROM ${source}${filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : ""} LIMIT ${boundedLimit}`;
  const validation = validateReadOnlySelect(query);
  if (!validation.ok) throw new Error(validation.error ?? "Invalid diagnostic query");
  return query;
}

export async function runFailingRowsDiagnostic(
  client: ClickHouseClient,
  promise: DataHealthPromiseRow,
  job: ScheduledQueryRow,
  check: DataHealthCheckDefinition,
  slotAt: number,
  limit = 50,
): Promise<{ supported: boolean; rows: Array<Record<string, unknown>>; columns: Array<{ name: string; type: string }>; slotStart: number; slotEnd: number }> {
  const query = buildFailingRowsQuery(promise, check, limit);
  const slotStart = previousFireMs(job, slotAt) ?? slotAt - 24 * 60 * 60 * 1000;
  if (!query) return { supported: false, rows: [], columns: [], slotStart, slotEnd: slotAt };
  const executable = buildExecutableQuery(query).sql;
  const result = await client.query({
    query: executable,
    query_params: {
      sq_slot_start: toDateTime64Param(slotStart),
      sq_slot_end: toDateTime64Param(slotAt),
      sq_prev_run_at: toDateTime64Param(slotStart),
    },
    format: "JSON",
    clickhouse_settings: { readonly: "1", max_execution_time: 20, max_result_rows: "100" },
  });
  const json = (await result.json()) as { data?: Array<Record<string, unknown>>; meta?: Array<{ name: string; type: string }> };
  return { supported: true, rows: json.data ?? [], columns: json.meta ?? [], slotStart, slotEnd: slotAt };
}

export async function backtestDataHealth(
  client: ClickHouseClient,
  job: ScheduledQueryRow,
  compiledSql: string,
  checks: DataHealthCheckDefinition[],
  slotCount: number,
  now = Date.now(),
): Promise<DataHealthBacktestResult> {
  const count = Math.min(30, Math.max(1, Math.trunc(slotCount)));
  const slots: number[] = [];
  let cursor = now;
  for (let index = 0; index < count; index += 1) {
    const slot = previousFireMs(job, cursor);
    if (slot == null) break;
    slots.push(slot);
    cursor = slot;
  }
  const executable = buildExecutableQuery(compiledSql).sql;
  const history: Record<string, number[]> = {};
  const results: DataHealthBacktestSlot[] = [];
  for (const slotAt of slots.reverse()) {
    const slotStart = previousFireMs(job, slotAt) ?? slotAt - 24 * 60 * 60 * 1000;
    try {
      const response = await client.query({
        query: executable,
        query_params: {
          sq_slot_start: toDateTime64Param(slotStart),
          sq_slot_end: toDateTime64Param(slotAt),
          sq_prev_run_at: toDateTime64Param(slotStart),
        },
        format: "JSON",
        clickhouse_settings: { readonly: "1", max_execution_time: Math.min(30, job.timeoutSecs), max_result_rows: "1" },
      });
      const json = (await response.json()) as { data?: Array<Record<string, unknown>> };
      const evaluation = evaluateDataHealth(checks, json.data?.[0] ?? {}, history);
      for (const check of evaluation.checks) {
        if (check.observedValue == null) continue;
        const values = history[check.checkKey] ?? [];
        values.push(check.observedValue);
        history[check.checkKey] = values.slice(-100);
      }
      results.push({
        slotAt,
        state: evaluation.state,
        checks: evaluation.checks.map((check) => ({
          checkKey: check.checkKey,
          outcome: check.outcome,
          observedValue: check.observedValue,
          expectedLower: check.expectedLower,
          expectedUpper: check.expectedUpper,
        })),
      });
    } catch (error) {
      results.push({ slotAt, state: "unknown", checks: [], error: error instanceof Error ? error.message : "Backtest evaluation failed" });
    }
  }
  return {
    slots: results.reverse(),
    summary: {
      evaluated: results.length,
      healthy: results.filter((slot) => slot.state === "healthy").length,
      breached: results.filter((slot) => slot.state === "degraded" || slot.state === "unhealthy").length,
      unknown: results.filter((slot) => slot.state === "unknown").length,
      errors: results.filter((slot) => Boolean(slot.error)).length,
    },
  };
}
