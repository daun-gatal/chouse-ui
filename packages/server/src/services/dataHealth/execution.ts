import type { ClickHouseClient } from "@clickhouse/client";

import { escapeQualifiedIdentifier } from "../../utils/sqlIdentifier";
import { describeDestination, describeSelectSchema, diffSchema } from "../scheduledQueries/materialize";
import type { ScheduledQueryRow } from "../scheduledQueries/types";
import * as scheduledStore from "../scheduledQueries/store";
import { buildExecutableQuery } from "../scheduledQueries/validation";
import { compileDataHealthQuery, eventTimeTypeFromSchema } from "./compiler";
import { evaluateDataHealth } from "./evaluator";
import * as store from "./store";
import type { DataHealthCheckDefinition, DataHealthMetricEvaluation } from "./types";

type SchemaContractCheck = Extract<DataHealthCheckDefinition, { type: "schema_contract" }>;

export interface DataHealthRunEvaluation {
  conditionMet: boolean;
  conditionValue: string;
  message: string | null;
  notified: boolean;
}

/** Recompile generated SQL at execution time so existing promises receive compiler fixes. */
export async function currentDataHealthJob(job: ScheduledQueryRow, client?: ClickHouseClient): Promise<ScheduledQueryRow> {
  const promise = await store.getPromiseByJobId(job.id);
  if (!promise) throw new Error("Data Health promise metadata is missing for the scheduled job");
  const checks = await store.getChecks(promise.id);
  const partitionMetadata = client && promise.sourceType === "table" && promise.databaseName && promise.tableName
    ? await describeDestination(client, promise.databaseName, promise.tableName)
    : null;
  const compiled = compileDataHealthQuery({
    sourceType: promise.sourceType,
    databaseName: promise.databaseName ?? undefined,
    tableName: promise.tableName ?? undefined,
    sourceQuery: promise.sourceQuery ?? undefined,
    eventTimeColumn: promise.eventTimeColumn ?? undefined,
    eventTimeType: promise.eventTimeType ?? eventTimeTypeFromSchema(promise.eventTimeColumn, promise.schemaSnapshot),
    eventTimeEncoding: promise.eventTimeEncoding,
    eventTimeTimezone: promise.eventTimeTimezone ?? undefined,
    eventTimeFormat: promise.eventTimeFormat,
    rowFilter: promise.rowFilter ?? undefined,
    partitionKey: partitionMetadata?.partitionKey ?? undefined,
    partitionColumns: partitionMetadata?.columns,
  }, checks);
  return { ...job, query: compiled.sql };
}

function evaluationSummary(name: string, result: ReturnType<typeof evaluateDataHealth>): string {
  const breached = result.checks.filter((check) => check.outcome === "breach");
  if (breached.length === 0) return `${name} is ${result.state}`;
  return `${name}: ${breached.map((check) => `${check.checkKey} (${check.observedValue ?? "no value"})`).join(", ")}`;
}

export interface ProcessDataHealthOptions {
  /**
   * Replay (clear & rerun, ADR 0007): replace the slot's samples instead of
   * keeping them, bound anomaly history to earlier slots, and — when the slot is
   * strictly older than the newest evaluated slot — skip status updates, incident
   * transitions, and notifications entirely. Only the newest slot defines current
   * health.
   */
  replay?: boolean;
}

export async function processDataHealthSuccess(
  job: ScheduledQueryRow,
  runId: string,
  slotAt: number,
  observed: Record<string, unknown>,
  client: ClickHouseClient,
  params: Record<string, string>,
  opts: ProcessDataHealthOptions = {},
): Promise<DataHealthRunEvaluation> {
  const promise = await store.getPromiseByJobId(job.id);
  if (!promise) throw new Error("Data Health promise metadata is missing for the scheduled job");
  // The newest previously-evaluated slot, read BEFORE this run's samples land, so
  // "older than newest" compares against prior history (a first-ever slot is newest).
  const latestLiveSlot = opts.replay ? await store.latestLiveSlotAt(promise.id) : null;
  const [checks, history] = await Promise.all([
    store.getChecks(promise.id),
    store.metricHistory(promise.id, 100, opts.replay ? slotAt : undefined),
  ]);
  const result = evaluateDataHealth(checks, observed, history);
  const schemaChecks = checks.filter((check): check is SchemaContractCheck => check.type === "schema_contract" && check.enabled);
  if (schemaChecks.length > 0) {
    const rawSource = promise.sourceType === "table"
      ? `SELECT * FROM ${escapeQualifiedIdentifier([promise.databaseName ?? "", promise.tableName ?? ""])}`
      : promise.sourceQuery ?? "";
    const executableSource = buildExecutableQuery(rawSource).sql;
    const currentSchema = await describeSelectSchema(client, executableSource, params);
    for (const check of schemaChecks) {
      const diff = diffSchema(check.config.expectedColumns, currentSchema);
      const pass = diff.missing.length === 0 && diff.retyped.length === 0 && (check.config.allowAdditionalColumns || diff.additive.length === 0);
      const evaluation: DataHealthMetricEvaluation = {
        checkKey: check.checkKey,
        type: check.type,
        severity: check.severity,
        outcome: pass ? "pass" : "breach",
        observedValue: diff.additive.length + diff.missing.length + diff.retyped.length,
        expectedLower: 0,
        expectedUpper: 0,
        message: pass ? "Schema matches its contract" : `Schema changed: ${diff.missing.length} missing, ${diff.retyped.length} retyped, ${diff.additive.length} added`,
      };
      const index = result.checks.findIndex((item) => item.checkKey === check.checkKey);
      if (index >= 0) result.checks[index] = evaluation;
      else result.checks.push(evaluation);
    }
    const breaches = result.checks.filter((check) => check.outcome === "breach");
    result.state = breaches.some((check) => check.severity === "critical") ? "unhealthy" : breaches.length > 0 ? "degraded" : "healthy";
  }
  await store.insertEvaluations(promise.id, runId, slotAt, result.checks, { replace: opts.replay });
  const summary = evaluationSummary(promise.name, result);
  // Replay of a slot older than the newest evaluated slot rewrites its samples
  // only — current status, incidents, and channels belong to the newest slot.
  if (opts.replay && latestLiveSlot != null && slotAt < latestLiveSlot) {
    return {
      conditionMet: result.state === "degraded" || result.state === "unhealthy",
      conditionValue: result.state,
      message: result.state === "healthy" ? null : summary,
      notified: false,
    };
  }
  await store.updatePromiseEvaluation(promise.id, result.state, Date.now());
  const executionRecovery = await store.transitionExecutionIncident(promise, false, runId, `${promise.name} monitor execution recovered`);
  const transition = await store.transitionDataIncident(promise, result.state, runId, summary);
  let notified = false;
  if (transition.incident && transition.type !== "none") {
    const snoozed = transition.incident.status === "snoozed" && (transition.incident.snoozedUntil ?? 0) > Date.now();
    if (!snoozed) {
      const channelIds = await scheduledStore.getJobChannelIds(job.id);
      if (channelIds.length > 0) {
        const isRecovery = transition.type === "recovered";
        await scheduledStore.enqueueOutbox({
          runId,
          queryId: job.id,
          kind: isRecovery ? "recovery" : "alert",
          dedupKey: `data-health:${transition.incident.id}:${transition.type}`,
          payload: JSON.stringify({
            title: `${isRecovery ? "🟢" : "🔴"} Data Health ${transition.type} — ${promise.name}`,
            text: `${summary}\nOwner: ${promise.ownerId ?? "Unassigned"}\nIncident: /dataops/data-health/incidents/${transition.incident.id}`,
            channelIds,
          }),
        });
        notified = true;
      }
    }
  }
  if (executionRecovery.incident && executionRecovery.type === "recovered") {
    const channelIds = await scheduledStore.getJobChannelIds(job.id);
    if (channelIds.length > 0) {
      await scheduledStore.enqueueOutbox({
        runId,
        queryId: job.id,
        kind: "recovery",
        dedupKey: `data-health:${executionRecovery.incident.id}:recovered`,
        payload: JSON.stringify({
          title: `🟢 Data Health monitor recovered — ${promise.name}`,
          text: `${promise.name} can evaluate data again.\nIncident: /dataops/data-health/incidents/${executionRecovery.incident.id}`,
          channelIds,
        }),
      });
      notified = true;
    }
  }
  return {
    conditionMet: result.state === "degraded" || result.state === "unhealthy",
    conditionValue: result.state,
    message: result.state === "healthy" ? null : summary,
    notified,
  };
}

/**
 * An event-triggered promise's upstream pipeline failed to deliver: health is
 * `unknown` (the data was never produced — this is not a data breach), and an
 * execution incident alerts the promise's channels. The next successful chained
 * run recovers it through the executionRecovery branch above (ADR 0006).
 */
export async function processUpstreamFailure(upstreamJob: ScheduledQueryRow, runId: string, message: string): Promise<void> {
  const promises = await store.listPromisesByUpstreamJobId(upstreamJob.id);
  for (const promise of promises) {
    if (!promise.enabled) continue;
    await store.updatePromiseEvaluation(promise.id, "unknown", Date.now());
    const summary = `${promise.name}: upstream pipeline "${upstreamJob.name}" failed: ${message}`;
    const transition = await store.transitionExecutionIncident(promise, true, runId, summary);
    if (!transition.incident || transition.type !== "opened") continue;
    const channelIds = await scheduledStore.getJobChannelIds(promise.scheduledQueryId);
    if (channelIds.length === 0) continue;
    await scheduledStore.enqueueOutbox({
      runId,
      queryId: promise.scheduledQueryId,
      kind: "alert",
      dedupKey: `data-health:${transition.incident.id}:opened`,
      payload: JSON.stringify({
        title: `🔴 Data Health upstream failed — ${promise.name}`,
        text: `${summary}\nThis is a delivery failure; data health is unknown until the pipeline recovers.\nIncident: /dataops/data-health/incidents/${transition.incident.id}`,
        channelIds,
      }),
    });
  }
}

export async function processDataHealthError(job: ScheduledQueryRow, runId: string, message: string): Promise<boolean> {
  const promise = await store.getPromiseByJobId(job.id);
  if (!promise) return false;
  await store.updatePromiseEvaluation(promise.id, "unknown", Date.now());
  const summary = `${promise.name} monitor could not execute: ${message}`;
  const transition = await store.transitionExecutionIncident(promise, true, runId, summary);
  if (!transition.incident || transition.type !== "opened") return false;
  const channelIds = await scheduledStore.getJobChannelIds(job.id);
  if (channelIds.length === 0) return false;
  await scheduledStore.enqueueOutbox({
    runId,
    queryId: job.id,
    kind: "alert",
    dedupKey: `data-health:${transition.incident.id}:opened`,
    payload: JSON.stringify({
      title: `🔴 Data Health monitor failed — ${promise.name}`,
      text: `${summary}\nThis is a monitoring failure; data health is unknown.\nIncident: /dataops/data-health/incidents/${transition.incident.id}`,
      channelIds,
    }),
  });
  return true;
}
