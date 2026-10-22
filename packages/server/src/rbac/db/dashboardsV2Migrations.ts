/**
 * ADR 0023 migrations.
 *
 * 1.63.0 — the canvas and dashboards v2. Adds the panel layout and kind
 * columns, the dashboard's annotation sources, and the tables for notes,
 * version history, snapshots and reports. It then converts every stored
 * dashboard with the rule format 1 files use (legacy.ts):
 *   - each panel's layout, from its old width, height and order;
 *   - each viz spec, v1 to v2;
 *   - each panel alert config, which gains `kind: "threshold"`;
 *   - one version-history entry per dashboard (source `migration`).
 * Every step is idempotent. The layout is recomputed from the old columns,
 * which this migration does not change, so a re-run writes the same values.
 * A dashboard whose stored JSON cannot be read is left as it is and logged:
 * it was unreadable before and stays an explicit read error, never a default.
 *
 * 1.64.0 — drops the old `width` and `height` columns, in its own migration so
 * a failed conversion never reaches the drop.
 */

import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { logger } from '../../utils/logger';
import { convertVizV1, layoutFromV1, PANEL_HEIGHTS_V1, vizSpecV1Schema, type PanelHeightV1, type PanelWidthV1 } from '../../services/dashboards/legacy';
import { ANNOTATION_SOURCES, dashboardInputSchema, vizSpecSchema, type DashboardInput, type VizSpec } from '../../services/dashboards/spec';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { dashboardsV2Columns, dashboardsV2SchemaStatements } from './dashboardsV2Schema';
import type { Migration } from './migrations';

type Row = Record<string, unknown>;

async function rows(db: RbacDb, statement: SQL): Promise<Row[]> {
  if (getDatabaseType() === 'sqlite') return (db as SqliteDb).all(statement) as Row[];
  const result = (await (db as PostgresDb).execute(statement)) as unknown;
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows?: Row[] }).rows ?? [];
}

async function exec(db: RbacDb, statement: SQL): Promise<void> {
  if (getDatabaseType() === 'sqlite') (db as SqliteDb).run(statement);
  else await (db as PostgresDb).execute(statement);
}

async function columnExists(db: RbacDb, table: string, column: string): Promise<boolean> {
  if (getDatabaseType() === 'sqlite') {
    const info = await rows(db, sql.raw(`PRAGMA table_info(${table})`));
    return info.some((r) => String(r.name) === column);
  }
  const found = await rows(db, sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}`);
  return found.length > 0;
}

function parseJson(raw: unknown): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(String(raw)) };
  } catch {
    return { ok: false };
  }
}

const WIDTHS = new Set([3, 4, 6, 8, 12]);

/** A stored viz spec as v2: v1 is converted, v2 (a re-run) is kept; anything else is unreadable. */
function storedVizAsV2(raw: unknown): VizSpec | null {
  const json = parseJson(raw);
  if (!json.ok) return null;
  const v2 = vizSpecSchema.safeParse(json.value);
  if (v2.success) return v2.data;
  const v1 = vizSpecV1Schema.safeParse(json.value);
  return v1.success ? convertVizV1(v1.data) : null;
}

export interface ConvertedDashboard {
  document: DashboardInput;
  panels: Array<{ id: string; viz: VizSpec; layout: { x: number; y: number; w: number; h: number } }>;
}

/**
 * One stored dashboard and its panels (in stored order) as format 2, or the
 * reason it cannot be converted. Exported for the migration tests.
 */
export function convertStoredDashboard(dashboard: Row, panels: Row[]): ConvertedDashboard | string {
  const sizes: Array<{ width: PanelWidthV1; height: PanelHeightV1 }> = [];
  const vizzes: VizSpec[] = [];
  for (const panel of panels) {
    const width = Number(panel.width);
    const height = String(panel.height);
    if (!WIDTHS.has(width) || !(PANEL_HEIGHTS_V1 as readonly string[]).includes(height)) return `panel ${String(panel.id)} has an unknown size (${width}, ${height})`;
    const viz = storedVizAsV2(panel.viz);
    if (!viz) return `panel ${String(panel.id)} has a viz spec that is neither v1 nor v2`;
    sizes.push({ width: width as PanelWidthV1, height: height as PanelHeightV1 });
    vizzes.push(viz);
  }
  const layouts = layoutFromV1(sizes);
  const scope = parseJson(dashboard.connection_scope);
  const variables = parseJson(dashboard.variables);
  const annotations = parseJson(dashboard.annotations);
  if (!scope.ok || !variables.ok || !annotations.ok) return 'its connection scope, variables or annotation sources are not valid JSON';
  const document = dashboardInputSchema.safeParse({
    title: String(dashboard.title),
    description: String(dashboard.description ?? ''),
    timeRange: String(dashboard.time_range),
    refreshSeconds: Number(dashboard.refresh_seconds),
    connectionScope: scope.value,
    variables: variables.value,
    annotations: annotations.value,
    panels: panels.map((panel, i) => ({
      id: String(panel.id),
      kind: 'chart',
      title: String(panel.title),
      sql: String(panel.sql),
      viz: vizzes[i],
      fleet: Number(panel.fleet) === 1 || panel.fleet === true,
      layout: layouts[i],
    })),
  });
  if (!document.success) return document.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  return { document: document.data, panels: panels.map((panel, i) => ({ id: String(panel.id), viz: vizzes[i], layout: layouts[i] })) };
}

async function convertDashboards(db: RbacDb): Promise<{ converted: number; skipped: number }> {
  let converted = 0;
  let skipped = 0;
  const now = Date.now();
  for (const dashboard of await rows(db, sql`SELECT * FROM dashboards ORDER BY id`)) {
    const id = String(dashboard.id);
    const panels = await rows(db, sql`SELECT * FROM dashboard_panels WHERE dashboard_id = ${id} ORDER BY position, id`);
    const result = convertStoredDashboard(dashboard, panels);
    if (typeof result === 'string') {
      skipped += 1;
      logger.warn({ module: 'RBAC', phase: 'migration', dashboardId: id, reason: result }, '[Migration 1.63.0] Dashboard left unconverted: its stored data cannot be read');
      continue;
    }
    for (const panel of result.panels) {
      await exec(db, sql`
        UPDATE dashboard_panels SET kind = 'chart', viz = ${JSON.stringify(panel.viz)},
          x = ${panel.layout.x}, y = ${panel.layout.y}, w = ${panel.layout.w}, h = ${panel.layout.h}
        WHERE id = ${panel.id}`);
    }
    const version = Number(dashboard.version);
    const existing = await rows(db, sql`SELECT 1 FROM dashboard_versions WHERE dashboard_id = ${id} AND version = ${version}`);
    if (existing.length === 0) {
      await exec(db, sql`
        INSERT INTO dashboard_versions (dashboard_id, version, document, saved_by, saved_at, source)
        VALUES (${id}, ${version}, ${JSON.stringify(result.document)}, ${String(dashboard.owner_id)}, ${now}, 'migration')`);
    }
    converted += 1;
  }
  return { converted, skipped };
}

/** Panel alert configs gain `kind: "threshold"`, the only kind there was. */
async function convertAlertConfigs(db: RbacDb): Promise<number> {
  let changed = 0;
  for (const alert of await rows(db, sql`SELECT id, config FROM dashboard_alerts ORDER BY id`)) {
    const json = parseJson(alert.config);
    const config = json.ok ? z.record(z.unknown()).safeParse(json.value) : null;
    if (!config?.success) {
      logger.warn({ module: 'RBAC', phase: 'migration', alertId: String(alert.id) }, '[Migration 1.63.0] Panel alert left unconverted: its stored config is not a JSON object');
      continue;
    }
    if ('kind' in config.data) continue;
    await exec(db, sql`UPDATE dashboard_alerts SET config = ${JSON.stringify({ kind: 'threshold', ...config.data })} WHERE id = ${String(alert.id)}`);
    changed += 1;
  }
  return changed;
}

export const DASHBOARDS_V2_MIGRATIONS: Migration[] = [
  {
    version: '1.63.0',
    name: 'dashboards_v2',
    description: `ADR 0023 — dashboards v2: panel kind, layout (x, y, w, h on a 24-column canvas), markdown and description columns; dashboards.annotations (every source: ${ANNOTATION_SOURCES.join(', ')}); dashboard_notes, dashboard_versions, dashboard_snapshots, dashboard_reports and dashboard_report_channels. Converts every dashboard: layouts from the old width/height/order, viz specs v1 to v2, panel alert configs gain kind "threshold", and one version-history entry each.`,
    up: async (db) => {
      const dialect = getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
      for (const [table, column, definition] of dashboardsV2Columns(dialect)) {
        if (!(await columnExists(db, table, column))) await exec(db, sql.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`));
      }
      for (const statement of dashboardsV2SchemaStatements(dialect)) await exec(db, sql.raw(statement));
      const { converted, skipped } = await convertDashboards(db);
      const alerts = await convertAlertConfigs(db);
      logger.info({ module: 'RBAC', phase: 'migration', converted, skipped, alerts }, `[Migration 1.63.0] Dashboards v2 (${dialect})`);
    },
    down: async () => { /* forward-only */ },
  },
  {
    version: '1.64.0',
    name: 'dashboards_v2_drop_fixed_sizes',
    description: 'ADR 0023 — drops dashboard_panels.width and dashboard_panels.height, replaced by the canvas layout in 1.63.0.',
    up: async (db) => {
      for (const column of ['width', 'height']) {
        if (await columnExists(db, 'dashboard_panels', column)) await exec(db, sql.raw(`ALTER TABLE dashboard_panels DROP COLUMN ${column}`));
      }
      logger.info({ module: 'RBAC', phase: 'migration' }, '[Migration 1.64.0] Dropped dashboard_panels.width and height');
    },
    down: async () => { /* forward-only */ },
  },
];
