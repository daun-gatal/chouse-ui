/**
 * The dashboard side of the create_panel_rollup remediation action (ADR 0023
 * §10): what must still hold when it is proposed and again before it runs, and
 * the switch of the panel's SQL once verification found an exact match.
 *
 * The action's parameters must be exactly what analysing the panel's current
 * SQL gives; anything else is refused, so the action can only ever build the
 * rollup of the query that panel runs.
 */

import { quoteString, rollupDescribeSql, rollupPanelSql, ROLLUP_TYPE_RE, type ActionParams, type PriorState } from "../remediation/catalog";
import { analyzeRollup, readsRollup, rollupTarget, type RollupPlan } from "./rollup";
import { inScope } from "./spec";
import * as store from "./store";

export type RollupParams = Extract<ActionParams, { type: "create_panel_rollup" }>;

/** Thrown when a precondition fails; the executor turns it into a refusal. */
export class RollupPrecondition extends Error {}

type QueryRows = (sql: string) => Promise<Array<Record<string, unknown>>>;

function planOf(p: RollupParams): RollupPlan {
  return { database: p.database, table: p.table, timeColumn: p.timeColumn, bucketAlias: p.bucketAlias, groups: p.groups, aggregates: p.aggregates, filters: p.filters };
}

async function chartPanel(p: RollupParams): Promise<{ detail: store.DashboardDetail; sql: string }> {
  const detail = await store.getDashboard(p.dashboardId);
  const panel = detail?.panels.find((x) => x.id === p.panelId);
  if (!detail || !panel) throw new RollupPrecondition("The dashboard panel no longer exists");
  if (panel.kind !== "chart") throw new RollupPrecondition("The panel is no longer a chart");
  if (panel.fleet) throw new RollupPrecondition("A fleet panel runs on many connections; a rollup is made on one");
  return { detail, sql: panel.sql };
}

/** Re-read the panel and ClickHouse; the result is the prior state approvers see and execution re-checks. */
export async function readRollupPrior(connectionId: string, p: RollupParams, query: QueryRows): Promise<PriorState> {
  const { detail, sql } = await chartPanel(p);
  if (!inScope(detail.dashboard.connectionScope, connectionId)) throw new RollupPrecondition("The dashboard is not assigned to this connection");
  if (readsRollup(sql)) throw new RollupPrecondition("The panel already reads a rollup");
  const analysis = analyzeRollup(sql);
  if (!analysis.ok) throw new RollupPrecondition(`The panel cannot be rolled up: ${analysis.reason}`);
  if (JSON.stringify(analysis.plan) !== JSON.stringify(planOf(p)) || rollupTarget(analysis.plan) !== p.target) {
    throw new RollupPrecondition("The panel's query is not the one this rollup was proposed for; propose it again from the panel");
  }
  if (p.cluster !== null) {
    const shards = await query(`SELECT count() AS hosts, max(shard_num) AS value FROM system.clusters WHERE cluster = ${quoteString(p.cluster)}`);
    if (Number(shards[0]?.hosts ?? 0) === 0) throw new RollupPrecondition(`There is no cluster named ${p.cluster}`);
    // A sharded source is split across hosts: one replicated rollup could not hold every shard's rows.
    if (Number(shards[0]?.value ?? 0) > 1) throw new RollupPrecondition(`${p.cluster} has more than one shard; rollups support one shard with replicas`);
  }
  const existing = await query(`SELECT count() AS value FROM system.tables WHERE database = ${quoteString(p.database)} AND name IN (${quoteString(p.target)}, ${quoteString(`${p.target}_mv`)})`);
  if (Number(existing[0]?.value ?? 0) > 0) throw new RollupPrecondition(`${p.database}.${p.target} already exists; drop it or use it`);
  const rows = await query(rollupDescribeSql(p));
  const types: Record<string, string> = {};
  for (const row of rows) {
    const name = String(row.name ?? "");
    const type = String(row.type ?? "");
    if (!ROLLUP_TYPE_RE.test(type)) throw new RollupPrecondition(`ClickHouse reports a type for ${name} a rollup cannot use: ${type}`);
    // Float sums depend on the order rows are added in, so the rollup could never match exactly.
    if (/^AggregateFunction\((sum|avg), .*Float/.test(type)) throw new RollupPrecondition(`${name.replace(/^a_/, "")} sums a Float column, which a rollup cannot reproduce exactly`);
    types[name] = type;
  }
  return { rollup: { panelSql: sql, types } };
}

/**
 * After an exact match: point the panel at the rollup, as a new dashboard
 * version. A panel changed since the proposal is left alone; the caller fails
 * the action with the returned reason.
 */
export async function switchPanelToRollup(p: RollupParams, prior: PriorState, userId: string | null): Promise<string | null> {
  const detail = await store.getDashboard(p.dashboardId);
  const panel = detail?.panels.find((x) => x.id === p.panelId);
  if (!detail || !panel || panel.kind !== "chart") return "The panel no longer exists; the rollup was made but nothing reads it";
  // Another pod's verification may have switched it already.
  if (panel.sql === rollupPanelSql(p)) return null;
  if (panel.sql !== prior.rollup?.panelSql) return "The panel's query changed after the rollup was proposed; it was left as it is";
  const input = store.toInput(detail);
  const next = { ...input, panels: input.panels.map((x) => (x.id === p.panelId && x.kind === "chart" ? { ...x, sql: rollupPanelSql(p) } : x)) };
  try {
    await store.updateDashboard(detail.dashboard.id, detail.dashboard.version, next, { userId, source: "rollup" });
  } catch (error) {
    return `The panel could not be switched: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}
