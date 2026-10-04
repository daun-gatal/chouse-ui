/**
 * Agent governance at the query chokepoint (ADR 0016 §10).
 *
 * Every PAT-authenticated query (CLI or MCP) passes through here:
 * - the pause switch blocks all of them;
 * - SELECTs are estimated with `EXPLAIN ESTIMATE` and checked against the
 *   effective policy (per-query bytes, daily budget, partition filters,
 *   tables with open critical incidents);
 * - tables that are stale, degraded or under an incident produce health
 *   notices that travel with the result;
 * - every call is recorded on the agent's session.
 */

import { decideBudget, healthNotices, type BudgetDecision, type HealthNotice, type TableEstimate, type TableHealth } from "./budget";
import * as store from "./store";
import { all, num, one, sql, str } from "../observe/db";
import { logger } from "../../utils/logger";

export interface AgentContext {
  patId: string | null;
  userId: string;
  roles: string[];
  source: store.AgentSource;
  clientName: string | null;
  tool: string;
  connectionId: string;
}

interface EstimateRunner {
  executeQuery<T = Record<string, unknown>>(query: string, format?: string): Promise<{ data: T[] }>;
}

export interface GovernanceResult {
  decision: BudgetDecision;
  sessionId: string;
}

const READ_STATEMENT = /^\s*(with|select)\b/i;

/** Tables touched by a query, from `EXPLAIN ESTIMATE` (database, table, rows, marks). */
async function estimate(service: EstimateRunner, statement: string, connectionId: string): Promise<TableEstimate[]> {
  const result = await service.executeQuery<{ database: string; table: string; rows: number | string; marks: number | string }>(`EXPLAIN ESTIMATE ${statement}`, "JSON");
  const estimates: TableEstimate[] = [];
  for (const row of result.data) {
    const catalog = await one(sql`SELECT total_rows, total_bytes FROM obs_catalog_tables WHERE connection_id = ${connectionId} AND database_name = ${row.database} AND table_name = ${row.table}`);
    const totalRows = catalog ? num(catalog.total_rows) : 0;
    const totalBytes = catalog ? num(catalog.total_bytes) : 0;
    const rows = Number(row.rows) || 0;
    const bytesPerRow = totalRows > 0 ? totalBytes / totalRows : 0;
    estimates.push({
      table: `${row.database}.${row.table}`,
      estimatedBytes: Math.round(rows * bytesPerRow),
      markRatio: totalRows > 0 ? Math.min(1, rows / totalRows) : 0,
      totalBytes,
    });
  }
  return estimates;
}

/** Freshness and open incidents for the given `db.table` list. */
export async function tableHealth(connectionId: string, tables: string[]): Promise<TableHealth[]> {
  const out: TableHealth[] = [];
  for (const fq of [...new Set(tables)]) {
    const dot = fq.indexOf(".");
    const database = fq.slice(0, dot);
    const table = fq.slice(dot + 1);
    const baseline = await one(sql`SELECT state, state_reason FROM obs_table_baselines WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
    const dataIncident = await one(sql`
      SELECT i.id, i.severity, i.summary FROM data_health_incidents i JOIN data_health_promises p ON p.id = i.promise_id
      WHERE p.connection_id = ${connectionId} AND p.database_name = ${database} AND p.table_name = ${table} AND i.status <> 'recovered'
      ORDER BY CASE WHEN i.severity = 'critical' THEN 0 ELSE 1 END LIMIT 1`);
    const pipelineIncident = dataIncident ? null : await one(sql`
      SELECT o.id, o.severity, o.summary FROM obs_incidents o JOIN obs_pipelines p ON p.connection_id = o.connection_id AND p.pipeline_id = o.subject_ref
      WHERE o.connection_id = ${connectionId} AND o.status <> 'recovered' AND p.target_node = ${`table:${fq}`} LIMIT 1`);
    const incident = dataIncident ?? pipelineIncident;
    out.push({
      table: fq,
      state: (baseline ? str(baseline.state) : "trusted") as TableHealth["state"],
      reason: baseline ? str(baseline.state_reason) || null : null,
      openIncident: incident ? { id: str(incident.id), severity: str(incident.severity) === "critical" ? "critical" : "warning", summary: str(incident.summary) } : null,
    });
  }
  return out;
}

export async function governAgentQuery(ctx: AgentContext, statement: string, service: EstimateRunner): Promise<GovernanceResult> {
  const session = await store.touchSession(ctx.patId, ctx.userId, ctx.source, ctx.clientName);
  const paused = await store.isAgentAccessPaused();
  let estimates: TableEstimate[] = [];
  if (!paused && READ_STATEMENT.test(statement)) {
    try {
      estimates = await estimate(service, statement, ctx.connectionId);
    } catch (error) {
      // An estimate that cannot run (e.g. a query EXPLAIN ESTIMATE does not support) is not a reason to block.
      logger.debug({ module: "Agents", err: error instanceof Error ? error.message : String(error) }, "EXPLAIN ESTIMATE failed");
    }
  }
  const health = await tableHealth(ctx.connectionId, estimates.map((e) => e.table));
  const decision = decideBudget({
    policy: await store.effectivePolicy(ctx.patId, ctx.roles),
    estimates,
    usedTodayBytes: await store.bytesUsedToday(ctx.patId, ctx.userId),
    health,
    paused,
  });
  if (decision.decision === "block") {
    await store.recordToolCall({ sessionId: session.id, patId: ctx.patId, userId: ctx.userId, tool: ctx.tool, argsSummary: statement, outcome: "blocked", detail: { reasons: decision.reasons, estimatedBytes: decision.estimatedBytes } });
  }
  return { decision, sessionId: session.id };
}

export async function recordAgentQuery(ctx: AgentContext, governance: GovernanceResult, statement: string, outcome: "ok" | "error", readBytes: number, error?: string): Promise<void> {
  const warned = governance.decision.decision === "warn";
  await store.recordToolCall({
    sessionId: governance.sessionId,
    patId: ctx.patId,
    userId: ctx.userId,
    tool: ctx.tool,
    argsSummary: statement,
    outcome: outcome === "error" ? "error" : warned ? "warned" : "ok",
    detail: { estimatedBytes: governance.decision.estimatedBytes, notices: governance.decision.notices, reasons: governance.decision.reasons, ...(error ? { error: error.slice(0, 500) } : {}) },
    readBytes,
  });
}

/** Health notices for an arbitrary table list (MCP get_dataset_health). */
export async function noticesFor(connectionId: string, tables: string[]): Promise<HealthNotice[]> {
  return healthNotices(await tableHealth(connectionId, tables));
}

export async function agentUsageByConnection(sinceMs: number): Promise<Array<{ sessionId: string; bytes: number }>> {
  return (await all(sql`SELECT session_id, SUM(read_bytes) AS bytes FROM agent_tool_calls WHERE created_at >= ${sinceMs} GROUP BY session_id`)).map((r) => ({ sessionId: str(r.session_id), bytes: num(r.bytes) }));
}
