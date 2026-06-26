/**
 * Scheduled Queries runner — the single entry point the scheduler AND the manual
 * run route call. Composed of `enqueueRun` → execute (read-only push-down or
 * engine-generated materialize) + `evaluateCondition` → `finalizeRun` (+ outbox).
 * Exported phases let a future producer (Data Health) drive the lifecycle without
 * the HTTP layer. See ADR 0002 (D2, D3, D3a, D4, D5, D7).
 */

import { randomUUID } from "crypto";

import type { ClickHouseClient } from "@clickhouse/client";

import { logger } from "../../utils/logger";
import { validateQueryAccess } from "../../middleware/dataAccess";
import { getUserPermissions, getUserRoles } from "../../rbac/services/rbac";
import { getConnectionById } from "../../rbac/services/connections";
import { SYSTEM_ROLES } from "../../rbac/schema/base";
import { clientForConnection } from "./chClient";
import * as store from "./store";
import {
  buildExecutableQuery,
  toDateTime64Param,
  toParseableSql,
  validateReadOnlySelect,
} from "./validation";
import { describeSelectSchema, diffSchema, executeMaterialize } from "./materialize";
import type {
  ScheduledQueryRow,
  ScheduledQueryRunRow,
  SqStatus,
  SqTrigger,
} from "./types";

/** Stable per-process runner id (the K8s pod name when available). */
export const RUNNER_ID = process.env.HOSTNAME || `runner-${randomUUID().slice(0, 8)}`;

// Conservative resource caps applied to every scheduled SELECT (D3, D3a #5).
const MAX_MEMORY_USAGE = String(4 * 1024 * 1024 * 1024); // 4 GiB
const MAX_ROWS_TO_READ = String(5_000_000_000);
const LOW_PRIORITY = 10;

// --- client + window params -------------------------------------------------

export interface WindowParams {
  slotStartMs: number;
  slotEndMs: number;
  prevRunAtMs: number;
}

/** Build the `{{…}}` param values for a slot from the shared cadence (D3b). */
export async function resolveWindow(job: ScheduledQueryRow, slotAt: number): Promise<WindowParams> {
  const { previousFireMs } = await import("./cadence");
  const slotStartMs = previousFireMs(job, slotAt) ?? slotAt;
  const lastSuccess = await store.getLastSuccessSlot(job.id, slotAt);
  return {
    slotStartMs,
    slotEndMs: slotAt,
    prevRunAtMs: lastSuccess ?? slotStartMs,
  };
}

function buildParamValues(window: WindowParams): Record<string, string> {
  return {
    sq_slot_start: toDateTime64Param(window.slotStartMs),
    sq_slot_end: toDateTime64Param(window.slotEndMs),
    sq_prev_run_at: toDateTime64Param(window.prevRunAtMs),
  };
}

/**
 * The RBAC tag for a scheduled run — attributes every query the run issues (the
 * SELECT and any materialize writes) to the job's owner in ClickHouse query_log,
 * not the bare ClickHouse user. Applied at the client level via clientForConnection.
 */
function scheduledLogComment(job: ScheduledQueryRow): string {
  return JSON.stringify({ rbac_user_id: job.createdBy ?? null, source: "scheduled_query", job_id: job.id });
}

function clickhouseSettings(job: ScheduledQueryRow): Record<string, string | number> {
  const settings: Record<string, string | number> = {
    max_execution_time: job.timeoutSecs,
    max_result_rows: String(job.maxRows + 1),
    result_overflow_mode: "break",
    max_memory_usage: MAX_MEMORY_USAGE,
    max_rows_to_read: MAX_ROWS_TO_READ,
    priority: LOW_PRIORITY,
  };
  if (job.useFinal) settings.final = 1;
  if (job.seqConsistency) settings.select_sequential_consistency = 1;
  return settings;
}

interface SelectOutcome {
  rowCount: number;
  truncated: boolean;
  snapshot: Array<Record<string, unknown>>;
  columns: Array<{ name: string; type: string }>;
}

async function runSelect(
  client: ClickHouseClient,
  job: ScheduledQueryRow,
  execSql: string,
  params: Record<string, string>,
  runId: string,
  signal: AbortSignal,
): Promise<SelectOutcome> {
  const rs = await client.query({
    query: execSql,
    format: "JSON",
    query_id: runId,
    abort_signal: signal,
    query_params: params,
    clickhouse_settings: clickhouseSettings(job) as never,
  });
  const json = (await rs.json()) as {
    data?: Array<Record<string, unknown>>;
    meta?: Array<{ name: string; type: string }>;
    rows?: number;
  };
  const data = json.data ?? [];
  // result_overflow_mode='break' caps at maxRows+1; >maxRows ⇒ truncated.
  const truncated = data.length > job.maxRows;
  const snapshot = truncated ? data.slice(0, job.maxRows) : data;

  // True result-row count from the summary header when available (counts the
  // pre-'break' result), else fall back to the returned-row count.
  let rowCount = data.length;
  const headers = (rs as { response_headers?: Record<string, unknown> }).response_headers;
  const rawSummary = headers?.["x-clickhouse-summary"];
  if (typeof rawSummary === "string") {
    try {
      const summary = JSON.parse(rawSummary) as { result_rows?: string | number };
      if (summary.result_rows != null) rowCount = Number(summary.result_rows);
    } catch {
      /* keep returned-row count */
    }
  }

  return { rowCount, truncated, snapshot, columns: json.meta ?? [] };
}

/**
 * Re-evaluate the job OWNER's CURRENT data-access policy at run time, so a job
 * keeps failing once the owner loses access to a table it reads — access isn't
 * frozen at create time. Super-admin owners bypass (as interactively).
 * Returns `null` when allowed, or a human-readable reason when denied.
 */
async function ownerDataAccessDenial(job: ScheduledQueryRow): Promise<string | null> {
  const ownerId = job.createdBy;
  if (!ownerId) return null; // system/legacy job with no owner to evaluate
  const [roles, permissions, conn] = await Promise.all([
    getUserRoles(ownerId),
    getUserPermissions(ownerId),
    getConnectionById(job.connectionId),
  ]);
  const isAdmin = roles.includes(SYSTEM_ROLES.SUPER_ADMIN);
  const result = await validateQueryAccess(
    ownerId,
    isAdmin,
    permissions,
    toParseableSql(job.query),
    conn?.database ?? undefined,
    job.connectionId,
  );
  return result.allowed ? null : (result.reason ?? "data access denied for one or more tables");
}

// --- run lifecycle phases ---------------------------------------------------

export interface ExecuteOptions {
  trigger: SqTrigger;
  slotAt: number;
  attempt: number;
}

/** Insert the `running` row and return the run id (the ClickHouse query_id). */
export async function enqueueRun(job: ScheduledQueryRow, opts: ExecuteOptions): Promise<string> {
  const runId = randomUUID();
  const startedAt = Date.now();
  await store.insertRun({
    id: runId,
    queryId: job.id,
    trigger: opts.trigger,
    slotAt: opts.slotAt,
    attempt: opts.attempt,
    runnerId: RUNNER_ID,
    deadline: startedAt + job.timeoutSecs * 2 * 1000,
    startedAt,
  });
  return runId;
}

function notificationText(job: ScheduledQueryRow, run: { status: SqStatus; message: string | null }, window: WindowParams): string {
  const win = `${new Date(window.slotStartMs).toISOString()} .. ${new Date(window.slotEndMs).toISOString()}`;
  const lines = [
    `[Scheduled Query] "${job.name}" — ${run.status.toUpperCase()}`,
    `Connection: ${job.connectionId}`,
    `Window: ${win}`,
    run.message ? `Error: ${run.message}` : undefined,
  ].filter((l): l is string => Boolean(l));
  return lines.join("\n");
}

/**
 * Execute one run end-to-end: record `running`, run the read-only SELECT (or the
 * engine-generated materialize write), finalize, and — on a success→failure or
 * failure→recovery transition — enqueue a notification into the outbox.
 * Alerting is purely failure-based: a run is `error` if it fails to execute,
 * else `success`. Re-execution is safe (read-only source + idempotent write).
 */
export async function execute(job: ScheduledQueryRow, opts: ExecuteOptions): Promise<ScheduledQueryRunRow | null> {
  const runId = await enqueueRun(job, opts);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), job.timeoutSecs * 1000);

  let status: SqStatus = "success";
  let rowCount: number | null = null;
  let truncated = false;
  let writtenRows: number | null = null;
  let resultJson: string | null = null;
  let message: string | null = null;

  let client: ClickHouseClient | null = null;
  const window = await resolveWindow(job, opts.slotAt);
  const params = buildParamValues(window);

  try {
    // Re-validate read-only on the SOURCE every run (an edit can't smuggle a write).
    const validation = validateReadOnlySelect(job.query);
    if (!validation.ok) throw new Error(validation.error ?? "Source query failed read-only validation");

    // Re-check the owner's CURRENT data access every run — revoking access to a
    // table mid-life must start failing the job, not keep running on stale grants.
    const denial = await ownerDataAccessDenial(job);
    if (denial) throw new Error(`data access denied: ${denial}`);

    const { sql: execSql } = buildExecutableQuery(job.query);
    client = await clientForConnection(job.connectionId, scheduledLogComment(job));

    if (job.outputMode === "none") {
      const outcome = await runSelect(client, job, execSql, params, runId, controller.signal);
      rowCount = outcome.rowCount;
      truncated = outcome.truncated;
      resultJson = JSON.stringify({
        columns: outcome.columns,
        rows: outcome.snapshot,
        window: { slot_start: params.sq_slot_start, slot_end: params.sq_slot_end, prev_run_at: params.sq_prev_run_at },
      });
    } else {
      // Materialize: pin-diff the schema, then run the engine-generated write.
      const columns = await describeSelectSchema(client, execSql, params);
      const pinned = job.outputConfig?.expectedSchema;
      if (pinned && pinned.length > 0) {
        const diff = diffSchema(pinned, columns);
        if (!diff.compatible) {
          const parts = [
            ...diff.missing.map((c) => `-${c.name}`),
            ...diff.additive.map((c) => `+${c.name}`),
            ...diff.retyped.map((c) => `~${c.name}(${c.from}→${c.to})`),
          ];
          throw new Error(`source schema changed since configuration: ${parts.join(", ")}`);
        }
      }
      writtenRows = await executeMaterialize({
        client, job, selectSql: execSql, params, queryId: runId, slotAt: opts.slotAt, signal: controller.signal, columns,
      });
      rowCount = writtenRows;
      resultJson = JSON.stringify({
        mode: job.outputMode,
        dest: `${job.destDatabase}.${job.destTable}`,
        writtenRows,
        window: { slot_start: params.sq_slot_start, slot_end: params.sq_slot_end },
      });
    }

    status = "success";
  } catch (err) {
    status = "error";
    message = err instanceof Error ? err.message : String(err);
    // Best-effort real cancellation (the abort only drops the socket).
    if (client) {
      try {
        await client.command({ query: `KILL QUERY WHERE query_id = {qid:String}`, query_params: { qid: runId } });
      } catch {
        /* best-effort */
      }
    }
    logger.warn({ module: "ScheduledQueries", jobId: job.id, runId, err: message }, "Scheduled query run failed");
  } finally {
    clearTimeout(timer);
  }

  const finishedAt = Date.now();
  const notified = await maybeEnqueueDeliveries(job, runId, status, message, window);

  await store.finalizeRun(runId, {
    status,
    rowCount,
    truncated,
    writtenRows,
    resultJson,
    conditionValue: null,
    conditionMet: null,
    durationMs: finishedAt - startedAt,
    message,
    notified,
    finishedAt,
  });

  return store.getRun(runId);
}

/**
 * Failure-based, transition alerting. Notify linked channels only when a job
 * flips success → failure (and once more on recovery), so sustained failures
 * stay quiet. Returns whether a failure alert was enqueued (the `notified` flag).
 */
async function maybeEnqueueDeliveries(
  job: ScheduledQueryRow,
  runId: string,
  status: SqStatus,
  message: string | null,
  window: WindowParams,
): Promise<boolean> {
  const channelIds = await store.getJobChannelIds(job.id);
  if (channelIds.length === 0) return false;
  const isBad = status === "failed" || status === "error";

  // Transition: compare to the previous terminal run for this job.
  const prev = await store.getPreviousTerminalRun(job.id, Date.now());
  const prevBad = prev ? prev.status === "failed" || prev.status === "error" : false;

  const text = notificationText(job, { status, message }, window);

  if (isBad && !prevBad) {
    await store.enqueueOutbox({
      runId,
      queryId: job.id,
      kind: "alert",
      dedupKey: `${runId}:alert`,
      payload: JSON.stringify({ title: `🔴 Scheduled Query failed — ${job.name}`, text, channelIds }),
    });
    return true;
  }
  if (!isBad && prevBad) {
    await store.enqueueOutbox({
      runId,
      queryId: job.id,
      kind: "recovery",
      dedupKey: `${runId}:recovery`,
      payload: JSON.stringify({ title: `🟢 Scheduled Query recovered — ${job.name}`, text, channelIds }),
    });
  }
  return false;
}
