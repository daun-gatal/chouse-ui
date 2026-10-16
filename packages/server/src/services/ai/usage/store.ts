/**
 * Writes finished usage runs to the RBAC database and prunes old ones
 * (ADR 0020 §3). A write never fails or slows the AI call: it starts after the
 * run closes, and errors are logged. Every replica writes to the shared
 * database, so no lease is involved; the prune is an idempotent DELETE.
 */

import { sql, type SQL } from "drizzle-orm";

import { rawRun } from "../../../rbac/db/raw";
import { logger } from "../../../utils/logger";
import type { UsageRun, UsageStep } from "./run";

const INSERT_CHUNK = 100;
export const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Request-level totals derived from the run's steps. */
export interface RunTotals {
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** LLM calls that reported no usage. */
  incompleteCalls: number;
  /** LLM calls with usage but no price. */
  unpricedCalls: number;
  /** Sum over priced calls; null when no call was priced. */
  costUsd: number | null;
  egressRows: number;
  egressBytes: number;
}

export function runTotals(run: UsageRun): RunTotals {
  const totals: RunTotals = {
    llmCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    incompleteCalls: 0,
    unpricedCalls: 0,
    costUsd: null,
    egressRows: 0,
    egressBytes: 0,
  };
  for (const step of run.steps) {
    if (step.kind === "tool") {
      totals.toolCalls += 1;
      continue;
    }
    totals.llmCalls += 1;
    totals.inputTokens += step.usage.input;
    totals.outputTokens += step.usage.output;
    totals.cacheReadTokens += step.usage.cacheRead;
    totals.cacheWriteTokens += step.usage.cacheWrite;
    if (!step.usageReported) totals.incompleteCalls += 1;
    else if (step.costUsd === null) totals.unpricedCalls += 1;
    else totals.costUsd = (totals.costUsd ?? 0) + step.costUsd;
  }
  for (const e of run.egress) {
    totals.egressRows += e.rows;
    totals.egressBytes += e.bytes;
  }
  return totals;
}

async function insertRows(table: string, columns: string[], rows: SQL[][]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).map((values) => sql`(${sql.join(values, sql`, `)})`);
    await rawRun(sql`INSERT INTO ${sql.raw(table)} (${sql.raw(columns.join(", "))}) VALUES ${sql.join(chunk, sql`, `)}`);
  }
}

function v(value: string | number | null): SQL {
  return sql`${value}`;
}

function stepDetail(step: UsageStep): string {
  return JSON.stringify({
    queries: step.queries,
    ...(step.calls !== null ? { calls: step.calls } : {}),
    ...(step.error ? { error: step.error } : {}),
  });
}

/** Write one finished run. Runs with no steps (a cached result, a failure before any call) are skipped. */
export async function writeUsageRun(run: UsageRun): Promise<void> {
  if (run.steps.length === 0) return;
  const totals = runTotals(run);
  const priced = run.steps.some((s) => s.kind === "llm" && s.costUsd !== null);

  await insertRows("ai_usage_steps", [
    "id", "request_id", "seq", "kind", "agent_path", "name", "model_config_id", "provider_type", "model_id",
    "started_at", "duration_ms", "status", "usage_reported", "input_tokens", "output_tokens", "cache_read_tokens",
    "cache_write_tokens", "cost_usd", "price_source", "ch_queries", "ch_read_rows", "ch_read_bytes", "result_bytes", "detail",
  ], run.steps.map((s) => [
    v(s.id), v(run.id), v(s.seq), v(s.kind), v(s.agentPath), v(s.name), v(s.model?.modelConfigId ?? null),
    v(s.model?.providerType ?? null), v(s.model?.modelId ?? null), v(s.startedAt), v(s.durationMs), v(s.status),
    v(s.usageReported ? 1 : 0), v(s.usage.input), v(s.usage.output), v(s.usage.cacheRead), v(s.usage.cacheWrite),
    v(s.costUsd), v(s.costUsd === null ? "none" : "model"), v(s.queries.length),
    v(s.queries.reduce((n, q) => n + q.readRows, 0)), v(s.queries.reduce((n, q) => n + q.readBytes, 0)),
    v(s.resultBytes), v(stepDetail(s)),
  ]));

  if (run.egress.length > 0) {
    await insertRows("ai_usage_egress", [
      "id", "request_id", "step_id", "started_at", "user_id", "connection_id", "provider_type", "model_id",
      "kind", "source", "columns", "row_count", "bytes",
    ], run.egress.map((e) => [
      // CHouse records come from the RBAC database, not a ClickHouse connection.
      v(e.id), v(run.id), v(e.stepId), v(run.startedAt), v(run.meta.userId), v(e.kind === "chouse" ? null : e.connectionId ?? run.meta.connectionId),
      v(e.providerType), v(e.modelId), v(e.kind), v(e.source), v(JSON.stringify(e.columns)), v(e.rows), v(e.bytes),
    ]));
  }

  // The request row goes last: the API lists requests, so a reader never sees
  // one whose steps are still being written.
  await insertRows("ai_usage_requests", [
    "id", "started_at", "duration_ms", "user_id", "connection_id", "thread_id", "feature_id", "agent_id", "agent_slug", "agent_name",
    "source", "status", "error", "llm_calls", "tool_calls", "input_tokens", "output_tokens", "cache_read_tokens",
    "cache_write_tokens", "incomplete_calls", "unpriced_calls", "cost_usd", "ch_queries", "ch_read_rows", "ch_read_bytes",
    "egress_rows", "egress_bytes", "origin", "pat_id", "client_name",
  ], [[
    v(run.id), v(run.startedAt), v(run.durationMs), v(run.meta.userId), v(run.meta.connectionId), v(run.meta.threadId ?? null), v(run.meta.featureId),
    v(run.agent?.id ?? null), v(run.agent?.slug ?? null), v(run.agent?.name ?? null), v(run.meta.source), v(run.status),
    v(run.error), v(totals.llmCalls), v(totals.toolCalls), v(totals.inputTokens), v(totals.outputTokens),
    v(totals.cacheReadTokens), v(totals.cacheWriteTokens), v(totals.incompleteCalls), v(totals.unpricedCalls),
    v(priced ? totals.costUsd : null), v(run.chQueries), v(run.chReadRows), v(run.chReadBytes),
    v(totals.egressRows), v(totals.egressBytes), v(run.meta.caller?.origin ?? null), v(run.meta.caller?.patId ?? null),
    v(run.meta.caller?.clientName ?? null),
  ]]);
}

const pending = new Set<Promise<void>>();

/** Persist a finished run in the background; never throws. */
export function persistUsageRun(run: UsageRun): void {
  const write = writeUsageRun(run)
    .catch((error: unknown) => {
      logger.error(
        { module: "AIUsage", requestId: run.id, err: error instanceof Error ? error.message : String(error) },
        "Failed to record AI usage",
      );
    })
    .finally(() => pending.delete(write));
  pending.add(write);
}

/** Wait for background writes (tests, graceful shutdown). */
export async function flushUsageWrites(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}

/** `AI_USAGE_RETENTION_DAYS`, clamped to 1–365; 30 when unset or invalid. */
export function usageRetentionDays(raw: string | undefined = process.env.AI_USAGE_RETENTION_DAYS): number {
  const parsed = Number(raw);
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(1, Math.floor(parsed)));
}

/** Delete requests older than the retention window, with their steps and egress. */
export async function pruneAiUsage(now: number = Date.now(), retentionDays: number = usageRetentionDays()): Promise<void> {
  const cutoff = now - retentionDays * DAY_MS;
  const old = sql`SELECT id FROM ai_usage_requests WHERE started_at < ${cutoff}`;
  // `started_at` also catches rows whose request row was never written.
  await rawRun(sql`DELETE FROM ai_usage_steps WHERE request_id IN (${old}) OR started_at < ${cutoff}`);
  await rawRun(sql`DELETE FROM ai_usage_egress WHERE request_id IN (${old}) OR started_at < ${cutoff}`);
  await rawRun(sql`DELETE FROM ai_usage_requests WHERE started_at < ${cutoff}`);
}
