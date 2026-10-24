/**
 * Dashboards store (ADR 0021 §1, ADR 0023 §1 and §11). Dashboards, their panels,
 * role shares, per-user pins and version history live in the RBAC database
 * (migrations 1.61.0 and 1.63.0).
 *
 * A save replaces the dashboard and all its panels in one transaction and only
 * applies when the stored `version` is the one the editor loaded — a stale save
 * changes nothing and reports a conflict. The same transaction records the
 * saved document in the version history and keeps the last 50 versions.
 * Stored JSON is parsed with the same schemas that validated it; a row that no
 * longer parses is an error, never replaced by a default.
 */

import { randomUUID } from "crypto";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getDatabase, getDatabaseType, type PostgresDb, type SqliteDb } from "../../rbac/db";
import { all, num, one, run, str, strOrNull, type Row } from "../observe/db";
import { alertIdsForPanels, deleteAlertStatements } from "./alertStore";
import {
  PANEL_KINDS,
  RELATIVE_RANGE_KEYS,
  annotationSourcesSchema,
  connectionScopeSchema,
  dashboardInputSchema,
  layoutSchema,
  readingOrder,
  variableSchema,
  vizSpecSchema,
  type AnnotationSource,
  type ConnectionScope,
  type DashboardInput,
  type Layout,
  type PanelInput,
  type RelativeRange,
  type Variable,
  type VizSpec,
} from "./spec";

export interface DashboardRecord {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  timeRange: RelativeRange;
  refreshSeconds: number;
  connectionScope: ConnectionScope;
  variables: Variable[];
  annotations: AnnotationSource[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

interface PanelMeta {
  id: string;
  dashboardId: string;
  position: number;
  layout: Layout;
  createdAt: number;
  updatedAt: number;
}

export type ChartPanelRecord = PanelMeta & { kind: "chart"; title: string; sql: string; viz: VizSpec; fleet: boolean };
export type TextPanelRecord = PanelMeta & { kind: "text"; title: string; markdown: string };
export type HeadingPanelRecord = PanelMeta & { kind: "heading"; title: string; description: string };
export type PanelRecord = ChartPanelRecord | TextPanelRecord | HeadingPanelRecord;

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

/** Where a version came from (ADR 0023 §11). */
export const VERSION_SOURCES = ["ui", "token", "import", "template", "duplicate", "restore", "migration", "rollup"] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];
/** How many versions a dashboard keeps. */
export const MAX_VERSIONS = 50;

export interface VersionSummary {
  version: number;
  savedBy: string | null;
  savedByName: string | null;
  savedAt: number;
  source: VersionSource;
}

export interface VersionRecord extends VersionSummary {
  dashboardId: string;
  document: DashboardInput;
}

class CorruptRowError extends Error {}

export function parseStored<T>(schema: z.ZodType<T, unknown>, raw: unknown, what: string): T {
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

const RANGE_SCHEMA = z.enum(RELATIVE_RANGE_KEYS);

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
    connectionScope: parseStored(connectionScopeSchema, r.connection_scope, `connection scope of dashboard ${id}`),
    variables: parseStored(z.array(variableSchema), r.variables, `variables of dashboard ${id}`),
    annotations: parseStored(annotationSourcesSchema, r.annotations, `annotation sources of dashboard ${id}`),
    version: num(r.version),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function panelRow(r: Row): PanelRecord {
  const id = str(r.id);
  const kind = z.enum(PANEL_KINDS).safeParse(str(r.kind));
  if (!kind.success) throw new CorruptRowError(`Stored kind of panel ${id} is unknown`);
  const layout = layoutSchema.safeParse({ x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) });
  if (!layout.success) throw new CorruptRowError(`Stored layout of panel ${id} is not a place on the canvas`);
  const meta: PanelMeta = {
    id,
    dashboardId: str(r.dashboard_id),
    position: num(r.position),
    layout: layout.data,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
  switch (kind.data) {
    case "chart":
      return {
        ...meta,
        kind: "chart",
        title: str(r.title),
        sql: str(r.sql),
        viz: parseStored(vizSpecSchema, r.viz, `viz spec of panel ${id}`),
        fleet: num(r.fleet) === 1 || r.fleet === true,
      };
    case "text":
      return { ...meta, kind: "text", title: str(r.title), markdown: str(r.markdown) };
    case "heading":
      return { ...meta, kind: "heading", title: str(r.title), description: str(r.description) };
  }
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

/** A stored panel as the document's panel. */
export function panelInputOf(p: PanelRecord): PanelInput {
  switch (p.kind) {
    case "chart": return { id: p.id, kind: "chart", title: p.title, sql: p.sql, viz: p.viz, fleet: p.fleet, layout: p.layout };
    case "text": return { id: p.id, kind: "text", title: p.title, markdown: p.markdown, layout: p.layout };
    case "heading": return { id: p.id, kind: "heading", title: p.title, description: p.description, layout: p.layout };
  }
}

/** A stored dashboard as the document a save, an export or a version holds. */
export function toInput(detail: DashboardDetail): DashboardInput {
  const { dashboard, panels } = detail;
  return {
    title: dashboard.title,
    description: dashboard.description,
    timeRange: dashboard.timeRange,
    refreshSeconds: dashboard.refreshSeconds as DashboardInput["refreshSeconds"],
    connectionScope: dashboard.connectionScope,
    variables: dashboard.variables,
    annotations: dashboard.annotations,
    panels: panels.map(panelInputOf),
  };
}

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

function panelValues(panel: PanelInput): { title: string; sql: string; viz: string; fleet: number; markdown: string; description: string } {
  switch (panel.kind) {
    case "chart": return { title: panel.title, sql: panel.sql, viz: JSON.stringify(panel.viz), fleet: panel.fleet ? 1 : 0, markdown: "", description: "" };
    case "text": return { title: panel.title, sql: "", viz: "null", fleet: 0, markdown: panel.markdown, description: "" };
    case "heading": return { title: panel.title, sql: "", viz: "null", fleet: 0, markdown: "", description: panel.description };
  }
}

/**
 * Statements writing `panels` to `dashboardId`, in reading order. Panels whose
 * id is already on the dashboard are updated in place (their alerts stay with
 * them); others get a new id. Returns the panels as saved, ids included.
 */
function panelStatements(dashboardId: string, panels: PanelInput[], existingIds: Set<string>, now: number): { statements: SQL[]; saved: PanelInput[] } {
  const statements: SQL[] = [];
  const saved: PanelInput[] = [];
  readingOrder(panels).forEach((panel, position) => {
    const v = panelValues(panel);
    const { x, y, w, h } = panel.layout;
    if (panel.id !== null && existingIds.has(panel.id)) {
      saved.push(panel);
      statements.push(sql`
        UPDATE dashboard_panels SET position = ${position}, kind = ${panel.kind}, title = ${v.title}, sql = ${v.sql}, viz = ${v.viz},
          fleet = ${v.fleet}, markdown = ${v.markdown}, description = ${v.description}, x = ${x}, y = ${y}, w = ${w}, h = ${h}, updated_at = ${now}
        WHERE id = ${panel.id} AND dashboard_id = ${dashboardId}`);
    } else {
      const id = randomUUID();
      saved.push({ ...panel, id });
      statements.push(sql`
        INSERT INTO dashboard_panels (id, dashboard_id, position, kind, title, sql, viz, fleet, markdown, description, x, y, w, h, created_at, updated_at)
        VALUES (${id}, ${dashboardId}, ${position}, ${panel.kind}, ${v.title}, ${v.sql}, ${v.viz}, ${v.fleet}, ${v.markdown}, ${v.description}, ${x}, ${y}, ${w}, ${h}, ${now}, ${now})`);
    }
  });
  return { statements, saved };
}

/** Record `document` as `version` and drop versions beyond the last MAX_VERSIONS. */
function versionStatements(dashboardId: string, version: number, document: DashboardInput, savedBy: string | null, source: VersionSource, now: number): SQL[] {
  return [
    sql`INSERT INTO dashboard_versions (dashboard_id, version, document, saved_by, saved_at, source)
      VALUES (${dashboardId}, ${version}, ${JSON.stringify(document)}, ${savedBy}, ${now}, ${source})`,
    sql`DELETE FROM dashboard_versions WHERE dashboard_id = ${dashboardId} AND version <= ${version - MAX_VERSIONS}`,
  ];
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
  const panels = (await all(sql`SELECT * FROM dashboard_panels WHERE dashboard_id = ${id} ORDER BY position, id`)).map(panelRow);
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

function versionSource(raw: unknown, dashboardId: string): VersionSource {
  const source = z.enum(VERSION_SOURCES).safeParse(str(raw));
  if (!source.success) throw new CorruptRowError(`Stored source of a version of dashboard ${dashboardId} is unknown`);
  return source.data;
}

/** The dashboard's versions, newest first, without their documents. */
export async function listVersions(dashboardId: string): Promise<VersionSummary[]> {
  const rows = await all(sql`
    SELECT v.version, v.saved_by, v.saved_at, v.source, u.username AS saved_by_name
    FROM dashboard_versions v LEFT JOIN rbac_users u ON u.id = v.saved_by
    WHERE v.dashboard_id = ${dashboardId} ORDER BY v.version DESC`);
  return rows.map((r) => ({
    version: num(r.version),
    savedBy: strOrNull(r.saved_by),
    savedByName: strOrNull(r.saved_by_name),
    savedAt: num(r.saved_at),
    source: versionSource(r.source, dashboardId),
  }));
}

export async function getVersion(dashboardId: string, version: number): Promise<VersionRecord | null> {
  const r = await one(sql`
    SELECT v.*, u.username AS saved_by_name
    FROM dashboard_versions v LEFT JOIN rbac_users u ON u.id = v.saved_by
    WHERE v.dashboard_id = ${dashboardId} AND v.version = ${version}`);
  if (!r) return null;
  return {
    dashboardId,
    version: num(r.version),
    savedBy: strOrNull(r.saved_by),
    savedByName: strOrNull(r.saved_by_name),
    savedAt: num(r.saved_at),
    source: versionSource(r.source, dashboardId),
    document: parseStored(dashboardInputSchema, r.document, `document of version ${num(r.version)} of dashboard ${dashboardId}`),
  };
}

// ============================================
// Writes
// ============================================

export interface SaveContext {
  /** Who saved it (null for a system action). */
  userId: string | null;
  source: VersionSource;
}

export async function createDashboard(input: DashboardInput, ownerId: string, context: SaveContext): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  // Ids in the input belong to wherever it came from (an import, a duplicate); a new dashboard gets new panels.
  const { statements, saved } = panelStatements(id, input.panels, new Set(), now);
  await atomic(sql`
    INSERT INTO dashboards (id, title, description, owner_id, time_range, refresh_seconds, connection_scope, variables, annotations, version, created_at, updated_at)
    VALUES (${id}, ${input.title}, ${input.description}, ${ownerId}, ${input.timeRange}, ${input.refreshSeconds}, ${JSON.stringify(input.connectionScope)}, ${JSON.stringify(input.variables)}, ${JSON.stringify(input.annotations)}, 1, ${now}, ${now})
    RETURNING id`, [...statements, ...versionStatements(id, 1, { ...input, panels: saved }, context.userId, context.source, now)]);
  return id;
}

export interface UpdateResult {
  version: number;
  /** Panels the save removed. */
  removedPanelIds: string[];
  /** Alerts on those panels, deleted with them. */
  removedAlertIds: string[];
}

/** Panels a save would remove and the alerts that go with them. */
export async function removals(id: string, input: DashboardInput): Promise<{ removedPanelIds: string[]; removedAlertIds: string[] }> {
  const existing = (await all(sql`SELECT id FROM dashboard_panels WHERE dashboard_id = ${id}`)).map((r) => str(r.id));
  const kept = new Set(input.panels.map((p) => p.id).filter((panelId): panelId is string => panelId !== null));
  const removedPanelIds = existing.filter((panelId) => !kept.has(panelId));
  return { removedPanelIds, removedAlertIds: await alertIdsForPanels(removedPanelIds) };
}

/**
 * Replace dashboard `id` with `input` if it is still at `version`. Panel ids
 * that are not on this dashboard are treated as new panels. Throws
 * SaveConflictError when the dashboard is gone or was saved since.
 */
export async function updateDashboard(id: string, version: number, input: DashboardInput, context: SaveContext): Promise<UpdateResult> {
  const now = Date.now();
  const existing = (await all(sql`SELECT id FROM dashboard_panels WHERE dashboard_id = ${id}`)).map((r) => str(r.id));
  const { statements, saved } = panelStatements(id, input.panels, new Set(existing), now);
  const keptIds = new Set(saved.map((p) => p.id));
  const removedPanelIds = existing.filter((panelId) => !keptIds.has(panelId));
  const removedAlertIds = await alertIdsForPanels(removedPanelIds);
  const removalStatements = [
    ...removedPanelIds.map((panelId) => sql`DELETE FROM dashboard_panels WHERE id = ${panelId} AND dashboard_id = ${id}`),
    ...deleteAlertStatements(removedAlertIds),
  ];
  const next = version + 1;
  await atomic(sql`
    UPDATE dashboards SET title = ${input.title}, description = ${input.description},
      time_range = ${input.timeRange}, refresh_seconds = ${input.refreshSeconds}, connection_scope = ${JSON.stringify(input.connectionScope)},
      variables = ${JSON.stringify(input.variables)}, annotations = ${JSON.stringify(input.annotations)},
      version = ${next}, updated_at = ${now}
    WHERE id = ${id} AND version = ${version}
    RETURNING id`, [...removalStatements, ...statements, ...versionStatements(id, next, { ...input, panels: saved }, context.userId, context.source, now)]);
  return { version: next, removedPanelIds, removedAlertIds };
}

/** Delete a dashboard with its panels, shares, pins, panel alerts, notes, versions, snapshots and reports. Returns the alert ids it removed. */
export async function deleteDashboard(id: string): Promise<string[]> {
  const panelIds = (await all(sql`SELECT id FROM dashboard_panels WHERE dashboard_id = ${id}`)).map((r) => str(r.id));
  const alertIds = await alertIdsForPanels(panelIds);
  const reportIds = (await all(sql`SELECT id FROM dashboard_reports WHERE dashboard_id = ${id}`)).map((r) => str(r.id));
  await atomic(sql`DELETE FROM dashboards WHERE id = ${id} RETURNING id`, [
    sql`DELETE FROM dashboard_panels WHERE dashboard_id = ${id}`,
    sql`DELETE FROM dashboard_shares WHERE dashboard_id = ${id}`,
    sql`DELETE FROM dashboard_pins WHERE dashboard_id = ${id}`,
    sql`DELETE FROM dashboard_notes WHERE dashboard_id = ${id}`,
    sql`DELETE FROM dashboard_versions WHERE dashboard_id = ${id}`,
    sql`DELETE FROM dashboard_snapshots WHERE dashboard_id = ${id}`,
    ...reportIds.map((reportId) => sql`DELETE FROM dashboard_report_channels WHERE report_id = ${reportId}`),
    sql`DELETE FROM dashboard_reports WHERE dashboard_id = ${id}`,
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

/** Which of these dashboard ids exist. */
export async function existingDashboardIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await all(sql`SELECT id FROM dashboards WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
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
