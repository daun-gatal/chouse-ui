/**
 * Observe incidents (pipeline / engine / regression / capacity) and the
 * unified incident view across Data Health and Observe (ADR 0016 §6).
 *
 * Pipeline incidents only open when the pipeline feeds something that matters
 * — a critical or important table, or a table with a Data Health promise,
 * within three hops downstream — so noisy side pipelines stay a status, not a
 * page.
 */

import { randomUUID } from "crypto";

import { logger } from "../../utils/logger";
import { all, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "./db";
import { downstreamOf, type GraphEdge } from "./rca";

export type ObserveIncidentKind = "pipeline" | "engine" | "regression" | "capacity";
export type IncidentSource = "data_health" | "observe";

export interface ObserveIncident {
  id: string;
  connectionId: string;
  kind: ObserveIncidentKind;
  subjectRef: string;
  status: "open" | "acknowledged" | "recovered";
  severity: "warning" | "critical";
  summary: string;
  openedAt: number;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
  recoveredAt: number | null;
  lastEventAt: number;
}

function incidentRow(row: Row): ObserveIncident {
  return {
    id: str(row.id),
    connectionId: str(row.connection_id),
    kind: str(row.kind) as ObserveIncidentKind,
    subjectRef: str(row.subject_ref),
    status: str(row.status) as ObserveIncident["status"],
    severity: str(row.severity) === "critical" ? "critical" : "warning",
    summary: str(row.summary),
    openedAt: num(row.opened_at),
    acknowledgedBy: strOrNull(row.acknowledged_by),
    acknowledgedAt: numOrNull(row.acknowledged_at),
    recoveredAt: numOrNull(row.recovered_at),
    lastEventAt: num(row.last_event_at),
  };
}

export async function getObserveIncident(id: string): Promise<ObserveIncident | null> {
  const row = await one(sql`SELECT * FROM obs_incidents WHERE id = ${id}`);
  return row ? incidentRow(row) : null;
}

export async function listObserveIncidents(filter: { connectionIds?: string[]; status?: "active" | "all"; limit?: number }): Promise<ObserveIncident[]> {
  const conditions = [sql`1 = 1`];
  if (filter.connectionIds) {
    if (filter.connectionIds.length === 0) return [];
    conditions.push(sql`connection_id IN (${sql.join(filter.connectionIds.map((c) => sql`${c}`), sql`, `)})`);
  }
  if (filter.status !== "all") conditions.push(sql`status <> 'recovered'`);
  const rows = await all(sql`SELECT * FROM obs_incidents WHERE ${sql.join(conditions, sql` AND `)} ORDER BY last_event_at DESC LIMIT ${Math.min(filter.limit ?? 200, 1000)}`);
  return rows.map(incidentRow);
}

/** Does `node` (or anything up to 3 hops downstream) matter enough to page? */
export async function feedsImportantData(connectionId: string, node: string | null): Promise<boolean> {
  if (!node) return false;
  const edges = (await all(sql`SELECT source_id, target_id, kind FROM obs_lineage_edges WHERE connection_id = ${connectionId}`)).map((r) => ({ source: str(r.source_id), target: str(r.target_id), kind: str(r.kind) }) as GraphEdge);
  const next = downstreamOf(edges);
  const seen = new Set<string>([node]);
  let frontier = [node];
  for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    for (const n of frontier) for (const m of next(n)) if (!seen.has(m)) { seen.add(m); nextFrontier.push(m); }
    frontier = nextFrontier;
  }
  const tables = [...seen].filter((n) => n.startsWith("table:")).map((n) => n.slice("table:".length));
  if (tables.length === 0) return false;
  for (const fq of tables) {
    const dot = fq.indexOf(".");
    const database = fq.slice(0, dot);
    const table = fq.slice(dot + 1);
    const baseline = await one(sql`SELECT criticality FROM obs_table_baselines WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
    if (baseline && ["critical", "important"].includes(str(baseline.criticality))) return true;
    const promise = await one(sql`SELECT id FROM data_health_promises WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} LIMIT 1`);
    if (promise) return true;
  }
  return false;
}

export interface OpenIncidentInput {
  connectionId: string;
  kind: ObserveIncidentKind;
  subjectRef: string;
  subjectNode: string | null;
  severity: "warning" | "critical";
  summary: string;
  onsetAt: number;
  /** Skip the importance gate (engine / capacity incidents always page). */
  force?: boolean;
}

export async function openOrUpdateIncident(input: OpenIncidentInput): Promise<ObserveIncident | null> {
  const active = await one(sql`
    SELECT * FROM obs_incidents WHERE connection_id = ${input.connectionId} AND kind = ${input.kind} AND subject_ref = ${input.subjectRef} AND status <> 'recovered'
    ORDER BY opened_at DESC LIMIT 1`);
  const now = Date.now();
  if (active) {
    const escalate = str(active.severity) === "warning" && input.severity === "critical";
    await run(sql`UPDATE obs_incidents SET summary = ${input.summary}, severity = ${escalate ? "critical" : str(active.severity)}, last_event_at = ${now}, updated_at = ${now} WHERE id = ${str(active.id)}`);
    return getObserveIncident(str(active.id));
  }
  if (!input.force && !(await feedsImportantData(input.connectionId, input.subjectNode))) return null;
  const id = randomUUID();
  await run(sql`
    INSERT INTO obs_incidents (id, connection_id, kind, subject_ref, status, severity, summary, opened_at, last_event_at, created_at, updated_at)
    VALUES (${id}, ${input.connectionId}, ${input.kind}, ${input.subjectRef}, 'open', ${input.severity}, ${input.summary}, ${input.onsetAt}, ${now}, ${now}, ${now})
  `);
  // RCA is deterministic and cheap; run it now so the incident opens with its chain.
  try {
    const { computeAndStoreRca } = await import("./rcaService");
    await computeAndStoreRca("observe", id);
  } catch (error) {
    logger.warn({ module: "Observe", incidentId: id, err: error instanceof Error ? error.message : String(error) }, "RCA for new incident failed");
  }
  return getObserveIncident(id);
}

/** Refresh the summary and severity of an incident that is already open; never opens one. */
export async function updateActiveIncident(input: OpenIncidentInput): Promise<void> {
  const active = await one(sql`
    SELECT id, severity FROM obs_incidents WHERE connection_id = ${input.connectionId} AND kind = ${input.kind} AND subject_ref = ${input.subjectRef} AND status <> 'recovered'
    ORDER BY opened_at DESC LIMIT 1`);
  if (!active) return;
  const now = Date.now();
  const severity = str(active.severity) === "warning" && input.severity === "critical" ? "critical" : str(active.severity);
  await run(sql`UPDATE obs_incidents SET summary = ${input.summary}, severity = ${severity}, last_event_at = ${now}, updated_at = ${now} WHERE id = ${str(active.id)}`);
}

export async function recoverIncident(connectionId: string, kind: ObserveIncidentKind, subjectRef: string): Promise<void> {
  const now = Date.now();
  await run(sql`
    UPDATE obs_incidents SET status = 'recovered', recovered_at = ${now}, last_event_at = ${now}, updated_at = ${now}
    WHERE connection_id = ${connectionId} AND kind = ${kind} AND subject_ref = ${subjectRef} AND status <> 'recovered'
  `);
}

/** Recover the active incidents of `kind` whose subject is not in `stillBad`. */
export async function recoverIncidentsExcept(connectionId: string, kind: ObserveIncidentKind, stillBad: Iterable<string>): Promise<void> {
  const live = new Set(stillBad);
  const active = await all(sql`SELECT subject_ref FROM obs_incidents WHERE connection_id = ${connectionId} AND kind = ${kind} AND status <> 'recovered'`);
  for (const ref of new Set(active.map((r) => str(r.subject_ref)))) {
    if (!live.has(ref)) await recoverIncident(connectionId, kind, ref);
  }
}

export async function acknowledgeObserveIncident(id: string, actorId: string): Promise<ObserveIncident | null> {
  const now = Date.now();
  await run(sql`UPDATE obs_incidents SET status = 'acknowledged', acknowledged_by = ${actorId}, acknowledged_at = ${now}, updated_at = ${now} WHERE id = ${id} AND status = 'open'`);
  return getObserveIncident(id);
}
