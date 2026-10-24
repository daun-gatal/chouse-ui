/**
 * Snapshots (ADR 0023 §12): every chart panel's result for one absolute range,
 * frozen. Each panel runs as the creator through the full pipeline; results are
 * stored whole or not at all (10 MiB cap — never cut down to fit).
 *
 * Opening one is not a bypass of access: the viewer must be the creator or hold
 * one of the snapshot's roles, must still be able to view the dashboard, and each
 * panel's data-access check runs again as the viewer. A panel they may not read
 * shows "Access denied", never the data.
 */

import { randomUUID } from "crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { AppError } from "../../types";
import { all, num, one, run, str, strOrNull } from "../observe/db";
import { dashboardAccess, type Viewer } from "./access";
import { assertDataAccess, compilePanel, runFleet, runPanel, viewerConnection, type AgentFor, type FleetRun, type PanelQuery, type PanelRun } from "./runner";
import { dashboardInputSchema, variableValuesSchema, type DashboardInput, type VariableValues } from "./spec";
import * as store from "./store";

export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 365;
/** Panels run a few at a time: a snapshot is one user's action, not a fleet sweep. */
const PARALLEL_PANELS = 4;
const DAY_MS = 86_400_000;
const ACCESS_DENIED = "Access denied";

export type SnapshotResult =
  | ({ ok: true; kind: "single" } & PanelRun)
  | ({ ok: true; kind: "fleet" } & FleetRun)
  | { ok: false; error: string };

const windowSchema = z.object({ from: z.number(), to: z.number(), intervalSeconds: z.number() });
const panelDataSchema = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.record(z.string(), z.unknown())),
  elapsedMs: z.number(),
  readRows: z.number(),
  readBytes: z.number(),
  ranAt: z.number(),
  timezone: z.string().nullable(),
});
const fleetEntrySchema = z.union([
  z.object({ connectionId: z.string(), connectionName: z.string(), ok: z.literal(true), data: panelDataSchema, cached: z.boolean() }),
  z.object({ connectionId: z.string(), connectionName: z.string(), ok: z.literal(false), error: z.string() }),
]);
const snapshotResultSchema = z.union([
  z.object({ ok: z.literal(true), kind: z.literal("single"), connectionId: z.string(), window: windowSchema, data: panelDataSchema, cached: z.boolean() }),
  z.object({ ok: z.literal(true), kind: z.literal("fleet"), window: windowSchema, connections: z.array(fleetEntrySchema), omitted: z.number() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
const storedResultsSchema = z.object({ values: variableValuesSchema, panels: z.record(z.string(), snapshotResultSchema) });
type StoredResults = z.infer<typeof storedResultsSchema>;
const roleIdsSchema = z.array(z.string());

export interface SnapshotSummary {
  id: string;
  dashboardId: string;
  name: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: number;
  expiresAt: number;
  connectionId: string;
  range: { from: number; to: number };
  sizeBytes: number;
  roleIds: string[];
  incidentId: string | null;
}

export interface Snapshot extends SnapshotSummary {
  document: DashboardInput;
  values: VariableValues;
  results: Record<string, SnapshotResult>;
}

export interface CreateSnapshot {
  viewer: Viewer;
  detail: store.DashboardDetail;
  connectionId: string;
  /** Unix seconds. */
  from: number;
  to: number;
  values: VariableValues;
  name: string;
  roleIds: string[];
  expiresInDays: number;
  incidentId: string | null;
  agentFor: AgentFor;
  nowMs?: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function summaryRow(r: Record<string, unknown>): SnapshotSummary {
  return {
    id: str(r.id),
    dashboardId: str(r.dashboard_id),
    name: str(r.name),
    createdBy: str(r.created_by),
    createdByName: strOrNull(r.created_by_name),
    createdAt: num(r.created_at),
    expiresAt: num(r.expires_at),
    connectionId: str(r.connection_id),
    range: { from: num(r.range_from_s), to: num(r.range_to_s) },
    sizeBytes: num(r.size_bytes),
    roleIds: store.parseStored(roleIdsSchema, r.role_ids, `roles of snapshot ${str(r.id)}`),
    incidentId: strOrNull(r.incident_id),
  };
}

/** Check what the creator asked for; every problem is a 400 with the reason. */
async function assertCreatable(input: CreateSnapshot): Promise<void> {
  if (input.to <= input.from) throw AppError.badRequest("A snapshot's range must end after it starts");
  if (input.to * 1000 > (input.nowMs ?? Date.now()) + 60_000) throw AppError.badRequest("A snapshot's range cannot end in the future");
  if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < MIN_EXPIRY_DAYS || input.expiresInDays > MAX_EXPIRY_DAYS) {
    throw AppError.badRequest(`A snapshot expires after ${MIN_EXPIRY_DAYS} to ${MAX_EXPIRY_DAYS} days`);
  }
  // A role that cannot see the dashboard could never open the snapshot, so only its shares are offered.
  const shared = new Set(input.detail.shares.map((s) => s.roleId));
  const stray = input.roleIds.filter((id) => !shared.has(id));
  if (stray.length > 0) throw AppError.badRequest("A snapshot can only be opened by roles the dashboard is shared with");
  if (input.incidentId !== null) {
    const incident = await one(sql`SELECT connection_id FROM obs_incidents WHERE id = ${input.incidentId}`);
    if (!incident) throw AppError.badRequest("That incident does not exist");
    if (str(incident.connection_id) !== input.connectionId) throw AppError.badRequest("That incident is on another connection");
  }
}

/** Run every chart panel as the creator and store the results. */
export async function createSnapshot(input: CreateSnapshot): Promise<SnapshotSummary> {
  await assertCreatable(input);
  const { viewer, detail, connectionId } = input;
  await viewerConnection(viewer, connectionId);
  const charts = detail.panels.filter((p): p is Extract<store.PanelRecord, { kind: "chart" }> => p.kind === "chart");
  const now = input.nowMs ?? Date.now();
  const results = await mapLimit(charts, PARALLEL_PANELS, async (panel): Promise<[string, SnapshotResult]> => {
    const query: PanelQuery = { sql: panel.sql, variables: detail.dashboard.variables, values: input.values, range: { kind: "absolute", from: input.from, to: input.to }, dashboardId: detail.dashboard.id, panelId: panel.id };
    try {
      if (panel.fleet) return [panel.id, { ok: true, kind: "fleet", ...(await runFleet(viewer, query, input.agentFor, detail.dashboard.connectionScope, now)) }];
      return [panel.id, { ok: true, kind: "single", ...(await runPanel(viewer, connectionId, query, input.agentFor, now)) }];
    } catch (error) {
      return [panel.id, { ok: false, error: messageOf(error) }];
    }
  });
  const stored: StoredResults = { values: input.values, panels: Object.fromEntries(results) };
  const text = JSON.stringify(stored);
  const size = Buffer.byteLength(text, "utf8");
  if (size > MAX_SNAPSHOT_BYTES) {
    const mib = (n: number): string => (n / 1024 / 1024).toFixed(1);
    throw new AppError(`The snapshot's results are ${mib(size)} MiB; the limit is ${mib(MAX_SNAPSHOT_BYTES)} MiB. Pick a shorter range or fewer rows.`, "PAYLOAD_TOO_LARGE", "validation", 413);
  }
  const id = randomUUID();
  const document = JSON.stringify(store.toInput(detail));
  await run(sql`INSERT INTO dashboard_snapshots (id, dashboard_id, name, created_by, created_at, expires_at, connection_id, range_from_s, range_to_s, document, results, size_bytes, role_ids, incident_id)
    VALUES (${id}, ${detail.dashboard.id}, ${input.name}, ${viewer.id}, ${now}, ${now + input.expiresInDays * DAY_MS}, ${connectionId}, ${input.from}, ${input.to}, ${document}, ${text}, ${size}, ${JSON.stringify(input.roleIds)}, ${input.incidentId})`);
  const created = await one(sql`SELECT s.*, u.username AS created_by_name FROM dashboard_snapshots s LEFT JOIN rbac_users u ON u.id = s.created_by WHERE s.id = ${id}`);
  if (!created) throw AppError.internal("The snapshot was not saved");
  return summaryRow(created);
}

/** Role id → name, read once per request: a snapshot stores role ids, a viewer carries role names. */
async function roleNameMap(): Promise<Map<string, string>> {
  return new Map((await all(sql`SELECT id, name FROM rbac_roles`)).map((r) => [str(r.id), str(r.name)]));
}

function mayOpen(viewer: Viewer, snapshot: SnapshotSummary, detail: store.DashboardDetail, roleNames: Map<string, string>): boolean {
  if (!dashboardAccess(viewer, detail.dashboard, detail.shares).view) return false;
  if (snapshot.createdBy === viewer.id) return true;
  return snapshot.roleIds.some((id) => {
    const name = roleNames.get(id);
    return name !== undefined && viewer.roles.includes(name);
  });
}

/** The snapshots of a dashboard this viewer may open, newest first (no results). */
export async function listSnapshots(viewer: Viewer, detail: store.DashboardDetail, nowMs: number = Date.now()): Promise<SnapshotSummary[]> {
  const rows = await all(sql`SELECT s.id, s.dashboard_id, s.name, s.created_by, s.created_at, s.expires_at, s.connection_id, s.range_from_s, s.range_to_s, s.size_bytes, s.role_ids, s.incident_id, u.username AS created_by_name
    FROM dashboard_snapshots s LEFT JOIN rbac_users u ON u.id = s.created_by
    WHERE s.dashboard_id = ${detail.dashboard.id} AND s.expires_at > ${nowMs} ORDER BY s.created_at DESC`);
  const roleNames = await roleNameMap();
  return rows.map(summaryRow).filter((summary) => mayOpen(viewer, summary, detail, roleNames));
}

/** Re-check one stored run as the viewer; what they may not read becomes "Access denied". */
async function recheck(viewer: Viewer, result: SnapshotResult, query: Omit<PanelQuery, "range">, allowed: (connectionId: string) => Promise<boolean>): Promise<SnapshotResult> {
  if (!result.ok) return result;
  const check = async (connectionId: string, window: PanelRun["window"]): Promise<boolean> => {
    if (!(await allowed(connectionId))) return false;
    try {
      const connection = await viewerConnection(viewer, connectionId);
      await assertDataAccess(viewer, compilePanel({ ...query, range: { kind: "absolute", from: window.from, to: window.to } }, window), connection);
      return true;
    } catch {
      return false;
    }
  };
  if (result.kind === "single") return (await check(result.connectionId, result.window)) ? result : { ok: false, error: ACCESS_DENIED };
  const connections = await Promise.all(result.connections.map(async (entry) => {
    if (!entry.ok) return entry;
    return (await check(entry.connectionId, result.window)) ? entry : { connectionId: entry.connectionId, connectionName: entry.connectionName, ok: false as const, error: ACCESS_DENIED };
  }));
  return { ...result, connections };
}

/** Open a snapshot as `viewer` (see the module comment). Not found covers expired and not allowed. */
export async function openSnapshot(viewer: Viewer, detail: store.DashboardDetail, snapshotId: string, nowMs: number = Date.now()): Promise<Snapshot> {
  const row = await one(sql`SELECT s.*, u.username AS created_by_name FROM dashboard_snapshots s LEFT JOIN rbac_users u ON u.id = s.created_by
    WHERE s.id = ${snapshotId} AND s.dashboard_id = ${detail.dashboard.id}`);
  if (!row) throw AppError.notFound("Snapshot not found");
  const summary = summaryRow(row);
  if (summary.expiresAt <= nowMs) throw AppError.notFound("This snapshot has expired");
  if (!mayOpen(viewer, summary, detail, await roleNameMap())) throw AppError.notFound("Snapshot not found");
  const document = store.parseStored(dashboardInputSchema, row.document, `document of snapshot ${snapshotId}`);
  const stored = store.parseStored(storedResultsSchema, row.results, `results of snapshot ${snapshotId}`);
  // The connection check is per connection, not per panel: one lookup each.
  const usable = new Map<string, Promise<boolean>>();
  const allowed = (connectionId: string): Promise<boolean> => {
    let known = usable.get(connectionId);
    if (!known) {
      known = viewerConnection(viewer, connectionId).then(() => true, () => false);
      usable.set(connectionId, known);
    }
    return known;
  };
  const checked = await Promise.all(document.panels.map(async (panel): Promise<[string, SnapshotResult] | null> => {
    if (panel.kind !== "chart" || panel.id === null) return null;
    const result = stored.panels[panel.id];
    if (!result) return null;
    return [panel.id, await recheck(viewer, result, { sql: panel.sql, variables: document.variables, values: stored.values, dashboardId: detail.dashboard.id, panelId: panel.id }, allowed)];
  }));
  const results: Record<string, SnapshotResult> = Object.fromEntries(checked.filter((entry): entry is [string, SnapshotResult] => entry !== null));
  return { ...summary, document, values: stored.values, results };
}

/** Delete a snapshot: its creator, or anyone who may edit the dashboard. */
export async function deleteSnapshot(viewer: Viewer, detail: store.DashboardDetail, snapshotId: string): Promise<SnapshotSummary> {
  const row = await one(sql`SELECT s.*, NULL AS created_by_name FROM dashboard_snapshots s WHERE s.id = ${snapshotId} AND s.dashboard_id = ${detail.dashboard.id}`);
  if (!row) throw AppError.notFound("Snapshot not found");
  const summary = summaryRow(row);
  const access = dashboardAccess(viewer, detail.dashboard, detail.shares);
  if (!mayOpen(viewer, summary, detail, await roleNameMap())) throw AppError.notFound("Snapshot not found");
  if (summary.createdBy !== viewer.id && !access.edit) throw AppError.forbidden("Only its creator or an editor of the dashboard can delete a snapshot");
  await run(sql`DELETE FROM dashboard_snapshots WHERE id = ${snapshotId}`);
  return summary;
}

/** Delete expired snapshots; returns how many. Run by the report scheduler's sweep. */
export async function deleteExpiredSnapshots(nowMs: number = Date.now()): Promise<number> {
  const rows = await all(sql`SELECT id FROM dashboard_snapshots WHERE expires_at <= ${nowMs}`);
  if (rows.length === 0) return 0;
  await run(sql`DELETE FROM dashboard_snapshots WHERE expires_at <= ${nowMs}`);
  return rows.length;
}
