/**
 * Explain this spike (ADR 0023 §9): the evidence the model reads, gathered as
 * the viewer through the same checks as any panel run — dashboard access, the
 * connection, read-only SQL, data access and the dashboard caps. A part the
 * viewer may not read, or that fails, is listed as unavailable with the reason;
 * the model is told so and so is the user. Nothing here writes anything.
 */

import { PERMISSIONS } from "../../rbac/schema/base";
import { getUserById } from "../../rbac/services/rbac";
import { AppError } from "../../types";
import { NOT_OBSERVE } from "../observe/clickhouse";
import { dashboardAccess, has, type Viewer } from "./access";
import { loadAnnotations, type AnnotationEvent } from "./annotations";
import type { ExplainRequest } from "./explainSchemas";
import { runPanelWindow, viewerConnection, type PanelData, type PanelQuery } from "./runner";
import { ResultCache } from "./cache";
import { inScope } from "./spec";
import * as store from "./store";
import { intervalFor } from "./macros";

const WEEK_SECONDS = 604_800;
const MAX_POINTS = 240;
/** Changes in the hour before a spike often cause it. */
const LOOKBACK_MS = 3_600_000;

// Explain runs are one-off; they get their own small cache rather than filling the panels'.
const explainCache = new ResultCache<PanelData>(60_000, 50, 16 * 1024 * 1024);

export interface ExplainEvidence {
  dashboard: { title: string };
  panel: { title: string; sql: string; chart: string; unit: string; x: string | null; y: string[] };
  range: { from: string; to: string; minutes: number };
  /** The panel's rows in the range and the same range a week earlier (at most 240 each). */
  series: { now: Array<Record<string, unknown>> | null; weekBefore: Array<Record<string, unknown>> | null };
  /** What changed from an hour before the range to its end, oldest first. */
  changes: Array<Omit<AnnotationEvent, "at" | "authorId"> & { at: string }>;
  slowestQueries: Array<Record<string, unknown>> | null;
  mutations: Array<Record<string, unknown>> | null;
  merges: Array<Record<string, unknown>> | null;
  unavailable: Array<{ part: string; reason: string }>;
}

async function viewerOf(userId: string | undefined): Promise<Viewer> {
  if (!userId) throw AppError.forbidden("Explain this spike runs as a signed-in user");
  const user = await getUserById(userId);
  if (!user || !user.isActive) throw AppError.forbidden("Your account is not active");
  return { id: user.id, roles: user.roles, permissions: user.permissions };
}

/** Gather the evidence for one panel and range (see the module comment). */
export async function gatherEvidence(request: ExplainRequest, userId: string | undefined): Promise<ExplainEvidence> {
  const viewer = await viewerOf(userId);
  if (!has(viewer, PERMISSIONS.QUERY_EXECUTE)) throw AppError.forbidden("Explaining a panel runs queries, which needs query:execute");
  const detail = await store.getDashboard(request.dashboardId);
  if (!detail || !dashboardAccess(viewer, detail.dashboard, detail.shares).view) throw AppError.notFound("Dashboard not found");
  const panel = detail.panels.find((p) => p.id === request.panelId);
  if (!panel) throw AppError.notFound("Panel not found");
  if (panel.kind !== "chart") throw AppError.badRequest("Only chart panels can be explained");
  if (!inScope(detail.dashboard.connectionScope, request.connectionId)) throw AppError.badRequest("This dashboard is not assigned to the connection you are on");
  await viewerConnection(viewer, request.connectionId);

  const unavailable: ExplainEvidence["unavailable"] = [];
  const from = Math.floor(request.fromMs / 1000);
  const to = Math.ceil(request.toMs / 1000);
  const window = { from, to, intervalSeconds: intervalFor(to - from) };
  const run = async (part: string, sql: string, w = window): Promise<Array<Record<string, unknown>> | null> => {
    const query: PanelQuery = { sql, variables: detail.dashboard.variables, values: request.values, range: { kind: "absolute", from: w.from, to: w.to }, dashboardId: detail.dashboard.id, panelId: "explain" };
    try {
      const result = await runPanelWindow(viewer, request.connectionId, query, w, () => null, explainCache);
      return result.data.rows.slice(0, MAX_POINTS);
    } catch (error) {
      unavailable.push({ part, reason: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  const now = await run("the panel in the selected range", panel.sql);
  const weekBefore = await run("the panel a week earlier", panel.sql, { from: from - WEEK_SECONDS, to: to - WEEK_SECONDS, intervalSeconds: window.intervalSeconds });
  const slowestQueries = await run("the slowest queries (system.query_log)", `SELECT toString(normalized_query_hash) AS shape, any(substring(query, 1, 300)) AS sample, count() AS runs,
  round(quantile(0.95)(query_duration_ms)) AS p95_ms, sum(read_bytes) AS read_bytes, any(tables) AS tables
FROM system.query_log WHERE type = 'QueryFinish' AND event_time >= {{from}} AND event_time < {{to}} AND ${NOT_OBSERVE}
GROUP BY normalized_query_hash ORDER BY p95_ms DESC LIMIT 10`);
  const mutations = await run("mutations (system.mutations)", `SELECT database, table, mutation_id, substring(command, 1, 300) AS command, create_time, is_done, parts_to_do, latest_fail_reason
FROM system.mutations WHERE (create_time >= {{from}} - INTERVAL 1 HOUR AND create_time < {{to}}) OR is_done = 0
ORDER BY create_time DESC LIMIT 20`);
  const merges = await run("merges and new parts (system.part_log)", `SELECT database, table, toString(event_type) AS event, count() AS events, round(avg(duration_ms)) AS avg_ms, sum(size_in_bytes) AS bytes
FROM system.part_log WHERE event_time >= {{from}} AND event_time < {{to}}
GROUP BY database, table, event ORDER BY events DESC LIMIT 20`);

  const changes: AnnotationEvent[] = [];
  for (const source of await loadAnnotations({ viewer, connectionId: request.connectionId, dashboardId: detail.dashboard.id, fromMs: request.fromMs - LOOKBACK_MS, toMs: request.toMs }, ["ddl", "upgrades", "settings", "writers", "alerts", "incidents", "fixes", "notes"])) {
    if (source.ok) changes.push(...source.events);
    else unavailable.push({ part: `${source.source} annotations`, reason: source.error });
  }

  return {
    dashboard: { title: detail.dashboard.title },
    panel: { title: panel.title, sql: panel.sql, chart: panel.viz.type, unit: panel.viz.unit, x: panel.viz.x, y: panel.viz.y },
    range: { from: new Date(request.fromMs).toISOString(), to: new Date(request.toMs).toISOString(), minutes: Math.round((request.toMs - request.fromMs) / 60_000) },
    series: { now, weekBefore },
    changes: changes.sort((a, b) => a.at - b.at).map(({ authorId: _authorId, ...e }) => ({ ...e, at: new Date(e.at).toISOString() })),
    slowestQueries,
    mutations,
    merges,
    unavailable,
  };
}
