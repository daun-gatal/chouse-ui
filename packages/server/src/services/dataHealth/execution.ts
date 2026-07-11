import type { ClickHouseClient } from "@clickhouse/client";

import { escapeQualifiedIdentifier } from "../../utils/sqlIdentifier";
import { describeSelectSchema, diffSchema } from "../scheduledQueries/materialize";
import type { ScheduledQueryRow } from "../scheduledQueries/types";
import * as scheduledStore from "../scheduledQueries/store";
import { buildExecutableQuery } from "../scheduledQueries/validation";
import { compileDataHealthQuery } from "./compiler";
import { evaluateDataHealth } from "./evaluator";
import * as store from "./store";
import type { DataHealthMetricEvaluation } from "./types";

export interface DataHealthRunEvaluation {
  conditionMet: boolean;
  conditionValue: string;
  message: string | null;
  notified: boolean;
}

/** Recompile generated SQL at execution time so existing promises receive compiler fixes. */
export async function currentDataHealthJob(job: ScheduledQueryRow): Promise<ScheduledQueryRow> {
  const promise = await store.getPromiseByJobId(job.id);
  if (!promise) throw new Error("Data Health promise metadata is missing for the scheduled job");
  const checks = await store.getChecks(promise.id);
  const compiled = compileDataHealthQuery({
    sourceType: promise.sourceType,
    databaseName: promise.databaseName ?? undefined,
    tableName: promise.tableName ?? undefined,
    sourceQuery: promise.sourceQuery ?? undefined,
    eventTimeColumn: promise.eventTimeColumn ?? undefined,
    rowFilter: promise.rowFilter ?? undefined,
  }, checks);
  return { ...job, query: compiled.sql };
}

function evaluationSummary(name: string, result: ReturnType<typeof evaluateDataHealth>): string {
  const breached = result.checks.filter((check) => check.outcome === "breach");
  if (breached.length === 0) return `${name} is ${result.state}`;
  return `${name}: ${breached.map((check) => `${check.checkKey} (${check.observedValue ?? "no value"})`).join(", ")}`;
}

export async function processDataHealthSuccess(
  job: ScheduledQueryRow,
  runId: string,
  slotAt: number,
  observed: Record<string, unknown>,
  client: ClickHouseClient,
  params: Record<string, string>,
): Promise<DataHealthRunEvaluation> {
  const promise = await store.getPromiseByJobId(job.id);
  if (!promise) throw new Error("Data Health promise metadata is missing for the scheduled job");
  const [checks, history] = await Promise.all([store.getChecks(promise.id), store.metricHistory(promise.id)]);
  const result = evaluateDataHealth(checks, observed, history);
  const schemaChecks = checks.filter((check) => check.type === "schema_contract" && check.enabled);
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
  await store.insertEvaluations(promise.id, runId, slotAt, result.checks);
  await store.updatePromiseEvaluation(promise.id, result.state, Date.now());
  const summary = evaluationSummary(promise.name, result);
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
  return {
    conditionMet: result.state === "degraded" || result.state === "unhealthy",
    conditionValue: result.state,
    message: result.state === "healthy" ? null : summary,
    notified,
  };
}

export async function processDataHealthError(job: ScheduledQueryRow): Promise<void> {
  const promise = await store.getPromiseByJobId(job.id);
  if (promise) await store.updatePromiseEvaluation(promise.id, "unknown", Date.now());
}
