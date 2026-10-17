/**
 * Custom dashboards store (ADR 0021 §1). Dashboards, their panels, role shares
 * and per-user pins live in the RBAC database (migration 1.61.0).
 *
 * A save replaces the dashboard and all its panels in one transaction and only
 * applies when the stored `version` is the one the editor loaded — a stale save
 * changes nothing and reports a conflict. Stored JSON is parsed with the same
 * schemas that validated it; a row that no longer parses is an error, never
 * replaced by a default.
 */

import { randomUUID } from "crypto";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getDatabase, getDatabaseType, type PostgresDb, type SqliteDb } from "../../rbac/db";
import { all, num, one, run, str, strOrNull, type Row } from "../observe/db";
import { alertIdsForPanels, deleteAlertStatements } from "./alertStore";
import { PANEL_HEIGHTS, variableSchema, vizSpecSchema, type DashboardInput, type PanelInput, type RelativeRange, type Variable, type VizSpec } from "./spec";

export interface DashboardRecord {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  timeRange: RelativeRange;
  refreshSeconds: number;
  variables: Variable[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface PanelRecord {
  id: string;
  dashboardId: string;
  position: number;
  title: string;
  sql: string;
  viz: VizSpec;
  width: 3 | 4 | 6 | 8 | 12;
  height: (typeof PANEL_HEIGHTS)[number];
  fleet: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ShareRecord {
  roleId: string;
  roleName: string;
  roleDisplayName: string;
  canEdit: boolean;
}

export interface DashboardDetail {
  dashboard: DashboardRecord;
  panels: PanelRecord[];
  shares: ShareRecord[];
}

export interface DashboardSummary extends DashboardRecord {
  panelCount: number;
  ownerName: string | null;
  shares: ShareRecord[];
}

class CorruptRowError extends Error {}

function parseStored<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown, what: string): T {
  let value: unknown;
  try {
    value = JSON.parse(str(raw));
  } catch {
    throw new CorruptRowError(`Stored ${what} is not valid JSON`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CorruptRowError(`Stored ${what} does not match its schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

const RANGE_SCHEMA = z.enum(["15m", "1h", "3h", "6h", "12h", "24h", "2d", "7d", "30d"]);
const WIDTH_SCHEMA = z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]);

function dashboardRow(r: Row): DashboardRecord {
  const id = str(r.id);
  const range = RANGE_SCHEMA.safeParse(str(r.time_range));
  if (!range.success) throw new CorruptRowError(`Stored time range of dashboard ${id} is unknown`);
  return {
    id,
    title: str(r.title),
    description: str(r.description),
    ownerId: str(r.owner_id),
    timeRange: range.data,
    refreshSeconds: num(r.refresh_seconds),
    variables: parseStored(z.array(variableSchema), r.variables, `variables of dashboard ${id}`),
    version: num(r.version),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function panelRow(r: Row): PanelRecord {
  const id = str(r.id);
  const width = WIDTH_SCHEMA.safeParse(num(r.width));
  const height = z.enum(PANEL_HEIGHTS).safeParse(str(r.height));
  if (!width.success || !height.success) throw new CorruptRowError(`Stored size of panel ${id} is unknown`);
  return {
    id,
    dashboardId: str(r.dashboard_id),
    position: num(r.position),
    title: str(r.title),
    sql: str(r.sql),
    viz: parseStored(vizSpecSchema, r.viz, `viz spec of panel ${id}`),
    width: width.data,
    height: height.data,
    fleet: num(r.fleet) === 1 || r.fleet === true,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function shareRow(r: Row): ShareRecord {
  return {
    roleId: str(r.role_id),
    roleName: str(r.role_name),
    roleDisplayName: str(r.role_display_name),
    canEdit: num(r.can_edit) === 1 || r.can_edit === true,
  };
}

export { CorruptRowError };

// ============================================
// Transactions
// ============================================

export class SaveConflictError extends Error {}

/**
 * Run `guard` and then `statements` in one transaction. `guard` must return at
 * least one row (an INSERT/UPDATE/DELETE … RETURNING); when it returns none the
 * transaction is rolled back and SaveConflictError is thrown.
 *
 * SQLite shares one connection across requests, so its path runs every
 * statement synchronously — no other request can interleave a statement into
 * the transaction. PostgreSQL gets a dedicated connection from the pool.
 */
async function atomic(guard: SQL, statements: SQL[]): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    const sqlite = db as SqliteDb;
    sqlite.run(sql`BEGIN IMMEDIATE`);
    try {
      const rows = sqlite.all(guard) as Row[];
      if (rows.length === 0) throw new SaveConflictError("guard matched no row");
      for (const statement of statements) sqlite.run(statement);
      sqlite.run(sql`COMMIT`);
    } catch (error) {
      sqlite.run(sql`ROLLBACK`);
      throw error;
    }
    return;
  }
  await (db as PostgresDb).transaction(async (tx) => {
    const result = (await tx.execute(guard)) as unknown;
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    if (rows.length === 0) throw new SaveConflictError("guard matched no row");
    for (const statement of statements) await tx.execute(statement);
  });
}

function panelStatements(dashboardId: string, panels: PanelInput[], existingIds: Set<string>, now: number): { statements: SQL[]; keptIds: string[] } {
  const statements: SQL[] = [];
  const keptIds: string[] = [];
  panels.forEach((panel, position) => {
    const viz = JSON.stringify(panel.viz);
    if (panel.id !== null && existingIds.has(panel.id)) {
      keptIds.push(panel.id);
      statements.push(sql`
        UPDATE dashboard_panels SET position = ${position}, title = ${panel.title}, sql = ${panel.sql}, viz = ${viz},
          width = ${panel.width}, height = ${panel.height}, fleet = ${panel.fleet ? 1 : 0}, updated_at = ${now}
        WHERE id = ${panel.id} AND dashboard_id = ${dashboardId}`);
    } else {
      statements.push(sql`
        INSERT INTO dashboard_panels (id, dashboard_id, position, title, sql, viz, width, height, fleet, created_at, updated_at)
        VALUES (${randomUUID()}, ${dashboardId}, ${position}, ${panel.title}, ${panel.sql}, ${viz}, ${panel.width}, ${panel.height}, ${panel.fleet ? 1 : 0}, ${now}, ${now})`);
    }
  });
  return { statements, keptIds };
}

// ============================================
// Reads
// ============================================

const SHARES_SELECT = sql`
  SELECT s.dashboard_id, s.role_id, s.can_edit, r.name AS role_name, r.display_name AS role_display_name
  FROM dashboard_shares s JOIN rbac_roles r ON r.id = s.role_id`;

export async function getDashboard(id: string): Promise<DashboardDetail | null> {
  const row = await one(sql`SELECT * FROM dashboards WHERE id = ${id}`);
  if (!row) return null;
  const panels = (await all(sql`SELECT * FROM dashboard_panels WHERE dashboard_id = ${id} ORDER BY position`)).map(panelRow);
  const shares = (await all(sql`${SHARES_SELECT} WHERE s.dashboard_id = ${id} ORDER BY r.name`)).map(shareRow);
  return { dashboard: dashboardRow(row), panels, shares };
}

/** Every dashboard with its panel count, owner name and shares — access is decided by the caller. */
export async function listDashboards(): Promise<DashboardSummary[]> {
  const rows = await all(sql`
    SELECT d.*, u.username AS owner_name,
      (SELECT COUNT(*) FROM dashboard_panels p WHERE p.dashboard_id = d.id) AS panel_count
    FROM dashboards d LEFT JOIN rbac_users u ON u.id = d.owner_id
    ORDER BY d.updated_at DESC`);
  const shares = await all(SHARES_SELECT);
  const byDashboard = new Map<string, ShareRecord[]>();
  for (const s of shares) {
    const list = byDashboard.get(str(s.dashboard_id)) ?? [];
    list.push(shareRow(s));
    byDashboard.set(str(s.dashboard_id), list);
  }
  return rows.map((r) => ({
    ...dashboardRow(r),
    panelCount: num(r.panel_count),
    ownerName: strOrNull(r.owner_name),
    shares: byDashboard.get(str(r.id)) ?? [],
  }));
}

export async function getPanel(dashboardId: string, panelId: string): Promise<PanelRecord | null> {
  const row = await one(sql`SELECT * FROM dashboard_panels WHERE id = ${panelId} AND dashboard_id = ${dashboardId}`);
  return row ? panelRow(row) : null;
}

// ============================================
// Writes
// ============================================

export async function createDashboard(input: DashboardInput, ownerId: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  // Ids in the input belong to wherever it came from (an import, a duplicate); a new dashboard gets new panels.
  const { statements } = panelStatements(id, input.panels, new Set(), now);
  await atomic(sql`
    INSERT INTO dashboards (id, title, description, owner_id, time_range, refresh_seconds, variables, version, created_at, updated_at)
    VALUES (${id}, ${input.title}, ${input.description}, ${ownerId}, ${input.timeRange}, ${input.refreshSeconds}, ${JSON.stringify(input.variables)}, 1, ${now}, ${now})
    RETURNING id`, statements);
  return id;
}

export interface UpdateResult {
  version: number;
  /** Panels the save removed. */
  removedPanelIds: string[];
  /** Alerts on those panels, deleted with them. */
  removedAlertIds: string[];
}

/**
 * Replace dashboard `id` with `input` if it is still at `version`. Panel ids
 * that are not on this dashboard are treated as new panels. Throws
 * SaveConflictError when the dashboard is gone or was saved since.
 */
export async function updateDashboard(id: string, version: number, input: DashboardInput): Promise<UpdateResult> {
  const now = Date.now();
  const existing = (await all(sql`SELECT id FROM dashboard_panels WHERE dashboard_id = ${id}`)).map((r) => str(r.id));
  const { statements, keptIds } = panelStatements(id, input.panels, new Set(existing), now);
  const removedPanelIds = existing.filter((panelId) => !keptIds.includes(panelId));
  const removedAlertIds = await alertIdsForPanels(removedPanelIds);
  const removals = [
    ...removedPanelIds.map((panelId) => sql`DELETE FROM dashboard_panels WHERE id = ${panelId} AND dashboard_id = ${id}`),
    ...deleteAlertStatements(removedAlertIds),
  ];
  await atomic(sql`
    UPDATE dashboards SET title = ${input.title}, description = ${input.description},
      time_range = ${input.timeRange}, refresh_seconds = ${input.refreshSeconds}, variables = ${JSON.stringify(input.variables)},
      version = ${version + 1}, updated_at = ${now}
    WHERE id = ${id} AND version = ${version}
    RETURNING id`, [...removals, ...statements]);
  return { version: version + 1, removedPanelIds, removedAlertIds };
}

/** Delete a dashboard with its panels, shares, pins and panel alerts. Returns the alert ids it removed. */
export async function deleteDashboard(id: string): Promise<string[]> {
  const panelIds = (await all(sql`SELECT id FROM dashboard_panels WHERE dashboard_id = ${id}`)).map((r) => str(r.id));
  const alertIds = await alertIdsForPanels(panelIds);
  await atomic(sql`DELETE FROM dashboards WHERE id = ${id} RETURNING id`, [
    sql`DELETE FROM dashboard_panels WHERE dashboard_id = ${id}`,
    sql`DELETE FROM dashboard_shares WHERE dashboard_id = ${id}`,
    sql`DELETE FROM dashboard_pins WHERE dashboard_id = ${id}`,
    ...deleteAlertStatements(alertIds),
  ]);
  return alertIds;
}

export interface ShareInput {
  roleId: string;
  canEdit: boolean;
}

/** Replace the dashboard's shares. Unknown role ids are refused by the caller. */
export async function setShares(id: string, shares: ShareInput[]): Promise<void> {
  const now = Date.now();
  await atomic(sql`UPDATE dashboards SET updated_at = ${now} WHERE id = ${id} RETURNING id`, [
    sql`DELETE FROM dashboard_shares WHERE dashboard_id = ${id}`,
    ...shares.map((s) => sql`INSERT INTO dashboard_shares (dashboard_id, role_id, can_edit, created_at) VALUES (${id}, ${s.roleId}, ${s.canEdit ? 1 : 0}, ${now})`),
  ]);
}

export async function existingRoleIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await all(sql`SELECT id FROM rbac_roles WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  return new Set(rows.map((r) => str(r.id)));
}

export async function pin(userId: string, dashboardId: string): Promise<void> {
  await run(sql`INSERT INTO dashboard_pins (user_id, dashboard_id, created_at) VALUES (${userId}, ${dashboardId}, ${Date.now()})
    ON CONFLICT (user_id, dashboard_id) DO NOTHING`);
}

export async function unpin(userId: string, dashboardId: string): Promise<void> {
  await run(sql`DELETE FROM dashboard_pins WHERE user_id = ${userId} AND dashboard_id = ${dashboardId}`);
}

export async function pinnedIds(userId: string): Promise<Set<string>> {
  const rows = await all(sql`SELECT dashboard_id FROM dashboard_pins WHERE user_id = ${userId}`);
  return new Set(rows.map((r) => str(r.dashboard_id)));
}
