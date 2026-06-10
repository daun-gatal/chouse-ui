/**
 * doctorReports — persistence for ChouseD fleet health scans.
 *
 * Each scan is saved so it gets a stable URL (/doctor/:id) and a browsable
 * history. We keep the newest N (default 100) and prune the rest right after
 * every insert, so the table stays small without a separate timer.
 *
 * Raw SQL (dual SQLite/Postgres) mirrors fleetPoller.ts — list-preview columns
 * (status/summary) are denormalised out of the JSON blobs so the history rail
 * never has to parse every report.
 */

import { sql } from "drizzle-orm";
import {
  getDatabase,
  getDatabaseType,
  type SqliteDb,
  type PostgresDb,
} from "../rbac/db";
import { logger } from "../utils/logger";
import type { DoctorAnalysis, DoctorReport, NodeVitals } from "./ai/capabilities/fleetScan";

/** How many reports to retain (oldest beyond this are pruned after each insert). */
export const DOCTOR_REPORT_RETENTION = 100;

/** How a scan was kicked off. */
export type DoctorTrigger = "manual" | "auto" | "scheduled";

/** Compact row for the history rail — no JSON blobs. */
export interface DoctorReportSummary {
  id: string;
  createdAt: number; // unix ms
  createdBy: string | null;
  model: string | null;
  status: string | null; // verdict status, for the list badge
  summary: string | null; // verdict summary, for the list preview
  nodeCount: number;
  durationMs: number;
  trigger: DoctorTrigger; // "manual" run vs "auto" RCA from an alert breach
}

/** Full stored report — analysis/vitals/steps re-hydrated from JSON. */
export interface StoredDoctorReport extends DoctorReportSummary {
  analysis: DoctorAnalysis | null;
  vitals: NodeVitals[];
  raw: string;
  steps: { tool: string; input: unknown }[];
}

// ============================================
// Dialect-agnostic exec helpers
// ============================================

async function run(stmt: ReturnType<typeof sql>): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(stmt);
  } else {
    await (db as PostgresDb).execute(stmt);
  }
}

async function selectAll(stmt: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(stmt) as Record<string, unknown>[];
  }
  const res = await (db as PostgresDb).execute(stmt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  return (Array.isArray(anyRes) ? anyRes : anyRes.rows ?? []) as Record<string, unknown>[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function asTrigger(v: unknown): DoctorTrigger {
  if (v === "auto") return "auto";
  if (v === "scheduled") return "scheduled";
  return "manual";
}

// ============================================
// CRUD
// ============================================

/**
 * Persist a freshly-run report, then prune to the retention window. Best-effort:
 * a storage failure must never break the scan response, so callers wrap nothing —
 * we log and swallow here.
 */
export async function saveDoctorReport(
  report: DoctorReport,
  createdBy: string | null,
  triggerSource: DoctorTrigger = "manual",
): Promise<void> {
  try {
    await run(sql`
      INSERT INTO doctor_reports
        (id, created_at, created_by, model, status, summary, node_count, duration_ms, analysis, vitals, raw, steps, trigger_source)
      VALUES (
        ${report.id},
        ${report.scannedAt},
        ${createdBy},
        ${report.model},
        ${report.analysis?.verdict.status ?? null},
        ${report.analysis?.verdict.summary ?? null},
        ${report.nodes},
        ${report.durationMs},
        ${JSON.stringify(report.analysis)},
        ${JSON.stringify(report.vitals)},
        ${report.raw},
        ${JSON.stringify(report.steps)},
        ${triggerSource}
      )
    `);
    await pruneDoctorReports(DOCTOR_REPORT_RETENTION);
  } catch (err) {
    logger.error(
      { module: "DoctorReports", err: err instanceof Error ? err.message : String(err) },
      "Failed to persist doctor report",
    );
  }
}

/** Newest-first list for the history rail. */
export async function listDoctorReports(limit = DOCTOR_REPORT_RETENTION): Promise<DoctorReportSummary[]> {
  const rows = await selectAll(sql`
    SELECT id, created_at, created_by, model, status, summary, node_count, duration_ms, trigger_source
    FROM doctor_reports
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: num(r.created_at),
    createdBy: r.created_by == null ? null : String(r.created_by),
    model: r.model == null ? null : String(r.model),
    status: r.status == null ? null : String(r.status),
    summary: r.summary == null ? null : String(r.summary),
    nodeCount: num(r.node_count),
    durationMs: num(r.duration_ms),
    trigger: asTrigger(r.trigger_source),
  }));
}

/** Full report by id, or null if it doesn't exist. */
export async function getDoctorReport(id: string): Promise<StoredDoctorReport | null> {
  const rows = await selectAll(sql`
    SELECT id, created_at, created_by, model, status, summary, node_count, duration_ms, analysis, vitals, raw, steps, trigger_source
    FROM doctor_reports
    WHERE id = ${id}
    LIMIT 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    createdAt: num(r.created_at),
    createdBy: r.created_by == null ? null : String(r.created_by),
    model: r.model == null ? null : String(r.model),
    status: r.status == null ? null : String(r.status),
    summary: r.summary == null ? null : String(r.summary),
    nodeCount: num(r.node_count),
    durationMs: num(r.duration_ms),
    trigger: asTrigger(r.trigger_source),
    analysis: parseJson<DoctorAnalysis | null>(r.analysis, null),
    vitals: parseJson<NodeVitals[]>(r.vitals, []),
    raw: typeof r.raw === "string" ? r.raw : "",
    steps: parseJson<{ tool: string; input: unknown }[]>(r.steps, []),
  };
}

/** Keep the newest `keep` reports; delete the rest. */
export async function pruneDoctorReports(keep = DOCTOR_REPORT_RETENTION): Promise<void> {
  await run(sql`
    DELETE FROM doctor_reports
    WHERE id NOT IN (
      SELECT id FROM doctor_reports ORDER BY created_at DESC LIMIT ${keep}
    )
  `);
}

/** Delete specific reports by id (no-op for an empty list). */
export async function deleteDoctorReports(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  await run(sql`DELETE FROM doctor_reports WHERE id IN (${list})`);
}

/** Wipe the entire report history. */
export async function deleteAllDoctorReports(): Promise<void> {
  await run(sql`DELETE FROM doctor_reports`);
}
