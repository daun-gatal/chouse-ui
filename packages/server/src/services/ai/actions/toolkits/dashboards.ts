/**
 * Dashboards & Context toolkit (ADR 0025 §2): dashboards, their panels,
 * versions, notes and sharing, and the curated context and metrics of tables.
 * Dashboard edits read the document (from /export) and its version, change
 * it, and save it back, so the route's every save check applies.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import { CHART_TYPES } from "../../../dashboards/spec";
import { metricKey, tableContextId } from "../resources";
import type { ActionContext, ActionDefinition } from "../types";
import { dashboardDocument, given, idOf, needConnection, panelSchema, quote, record, seg, str } from "./shared";

const TIME_RANGES = ["15m", "1h", "3h", "6h", "12h", "24h", "2d", "7d", "30d"] as const;
const GRID_COLUMNS = 24;

interface Loaded {
  document: Record<string, unknown>;
  version: number;
}

async function loadDashboard(ctx: ActionContext, id: string): Promise<Loaded> {
  const exported = await ctx.api.get<{ dashboard?: Record<string, unknown> }>(`/api/dashboards/${seg(id)}/export`);
  const detail = await ctx.api.get<{ dashboard?: { version?: number } }>(`/api/dashboards/${seg(id)}`);
  const version = detail.dashboard?.version;
  if (!exported.dashboard || typeof version !== "number") throw new Error("Dashboard not found");
  return { document: exported.dashboard, version };
}

async function saveDashboard(ctx: ActionContext, id: string, change: (document: Record<string, unknown>) => Record<string, unknown>): Promise<unknown> {
  const { document, version } = await loadDashboard(ctx, id);
  return ctx.api.put(`/api/dashboards/${seg(id)}`, { version, dashboard: change(document) });
}

function panelsOf(document: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(document.panels) ? document.panels.map(record) : [];
}

/** A v2 chart panel from what the model described, placed below every existing panel. */
export function chartPanel(args: Record<string, unknown>, below: Array<Record<string, unknown>>): Record<string, unknown> {
  const type = str(args.chart, "table");
  const bottom = below.reduce((max, panel) => {
    const layout = record(panel.layout);
    return Math.max(max, (typeof layout.y === "number" ? layout.y : 0) + (typeof layout.h === "number" ? layout.h : 0));
  }, 0);
  const width = type === "table" ? GRID_COLUMNS : GRID_COLUMNS / 2;
  return {
    id: null,
    kind: "chart",
    title: str(args.title, "Panel"),
    sql: str(args.sql),
    viz: {
      version: 2,
      type,
      x: typeof args.x === "string" && args.x ? args.x : null,
      y: Array.isArray(args.y) ? args.y.filter((c): c is string => typeof c === "string") : [],
      series: null,
      unit: "none",
      decimals: null,
      thresholds: [],
      colorScheme: "violet",
      reduce: type === "stat" ? "last" : null,
      links: [],
      baseline: null,
    },
    fleet: false,
    layout: { x: 0, y: bottom, w: width, h: type === "stat" ? 4 : 8 },
  };
}

const dashboardId = z.string().min(1).describe("Dashboard id (from list_dashboards)");
const panelId = z.string().min(1).describe("Panel id (from get_dashboard)");
const DASHBOARD_FIELDS = ["title", "description", "timeRange", "refreshSeconds"] as const;

export const DASHBOARD_ACTIONS: ActionDefinition[] = [
  {
    name: "create_dashboard",
    title: "Create a dashboard",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Create a dashboard on the active connection from panels (title, SQL, chart type and columns).",
    schema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      timeRange: z.enum(TIME_RANGES).optional().describe("Default time range, 24h if omitted"),
      panels: z.array(panelSchema).min(1).max(24),
    }),
    describe: (args) => `Create the dashboard ${quote(str(args.title))} with ${Array.isArray(args.panels) ? args.panels.length : 0} panel(s)`,
    execute: async (args, ctx) => ctx.api.post("/api/dashboards", dashboardDocument(args, needConnection(ctx))),
    undo: { mode: "delete-created", resource: "dashboard", id: (result) => idOf(result) },
  },
  {
    name: "update_dashboard",
    title: "Edit a dashboard",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Change a dashboard's title, description, default time range or auto-refresh. Only the fields given change.",
    schema: z.object({
      id: dashboardId,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      timeRange: z.enum(TIME_RANGES).optional(),
      refreshSeconds: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(300), z.literal(900)]).optional(),
    }),
    describe: (args) => `Edit the dashboard ${quote(str(args.id))} (${DASHBOARD_FIELDS.filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => saveDashboard(ctx, str(args.id), (doc) => ({ ...doc, ...given(args, DASHBOARD_FIELDS) })),
    undo: { mode: "restore", resource: "dashboard", id: (args) => str(args.id) },
  },
  {
    name: "add_panel",
    title: "Add a dashboard panel",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Add a chart panel (title, read-only SQL, chart type, x and y columns) at the bottom of a dashboard.",
    schema: panelSchema.extend({ id: dashboardId }),
    describe: (args) => `Add the panel ${quote(str(args.title))} to the dashboard ${quote(str(args.id))}`,
    execute: async (args, ctx) => saveDashboard(ctx, str(args.id), (doc) => ({ ...doc, panels: [...panelsOf(doc), chartPanel(args, panelsOf(doc))] })),
    undo: { mode: "restore", resource: "dashboard", id: (args) => str(args.id) },
  },
  {
    name: "update_panel",
    title: "Edit a dashboard panel",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Change a chart panel's title, SQL, chart type or columns. Only the fields given change; its place on the canvas stays.",
    schema: z.object({
      id: dashboardId,
      panelId,
      title: z.string().min(1).max(200).optional(),
      sql: z.string().min(1).optional(),
      chart: z.enum(CHART_TYPES).optional(),
      x: z.string().nullable().optional(),
      y: z.array(z.string()).max(8).optional(),
    }),
    describe: (args) => `Edit the panel ${quote(str(args.panelId))} (${["title", "sql", "chart", "x", "y"].filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => saveDashboard(ctx, str(args.id), (doc) => {
      const panels = panelsOf(doc);
      const index = panels.findIndex((p) => p.id === args.panelId);
      if (index < 0) throw new Error("That panel is not on this dashboard");
      const panel = panels[index];
      if (panel.kind !== "chart") throw new Error("Only chart panels can be edited this way");
      const viz = record(panel.viz);
      const type = typeof args.chart === "string" ? args.chart : viz.type;
      panels[index] = {
        ...panel,
        ...(typeof args.title === "string" ? { title: args.title } : {}),
        ...(typeof args.sql === "string" ? { sql: args.sql } : {}),
        viz: {
          ...viz,
          type,
          ...(args.x !== undefined ? { x: args.x } : {}),
          ...(Array.isArray(args.y) ? { y: args.y } : {}),
          reduce: type === "stat" ? viz.reduce ?? "last" : null,
        },
      };
      return { ...doc, panels };
    }),
    undo: { mode: "restore", resource: "dashboard", id: (args) => str(args.id) },
  },
  {
    name: "remove_panel",
    title: "Remove a dashboard panel",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Remove a panel from a dashboard (its alerts go with it).",
    schema: z.object({ id: dashboardId, panelId }),
    describe: (args) => `Remove the panel ${quote(str(args.panelId))} from the dashboard ${quote(str(args.id))}`,
    execute: async (args, ctx) => saveDashboard(ctx, str(args.id), (doc) => {
      const panels = panelsOf(doc);
      if (!panels.some((p) => p.id === args.panelId)) throw new Error("That panel is not on this dashboard");
      return { ...doc, panels: panels.filter((p) => p.id !== args.panelId) };
    }),
    undo: { mode: "restore", resource: "dashboard", id: (args) => str(args.id) },
  },
  {
    name: "restore_dashboard_version",
    title: "Restore a dashboard version",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Save an older version of a dashboard (from its version history) as the newest one.",
    schema: z.object({ id: dashboardId, version: z.number().int().positive() }),
    describe: (args) => `Restore version ${String(args.version)} of the dashboard ${quote(str(args.id))}`,
    execute: async (args, ctx) => {
      const { version } = await loadDashboard(ctx, str(args.id));
      return ctx.api.post(`/api/dashboards/${seg(args.id)}/versions/${seg(String(args.version))}/restore`, { currentVersion: version });
    },
    undo: { mode: "restore", resource: "dashboard", id: (args) => str(args.id) },
  },
  {
    name: "delete_dashboard",
    title: "Delete a dashboard",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_DELETE],
    description: "Delete a dashboard (with its alerts). Undo creates it again from its last document, with a new id.",
    schema: z.object({ id: dashboardId }),
    describe: (args) => `Delete the dashboard ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.delete(`/api/dashboards/${seg(args.id)}`),
    undo: { mode: "recreate-deleted", resource: "dashboard", id: (args) => str(args.id) },
  },
  {
    name: "add_dashboard_note",
    title: "Add a dashboard note",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Pin a note to a moment on a dashboard's timeline (e.g. a deploy), on the active connection.",
    schema: z.object({ id: dashboardId, text: z.string().min(1).max(2000), at: z.string().optional().describe("ISO time; default now") }),
    describe: (args) => `Add the note ${quote(str(args.text))} to the dashboard ${quote(str(args.id))}`,
    execute: async (args, ctx) => {
      const at = typeof args.at === "string" ? Date.parse(args.at) : Date.now();
      if (!Number.isFinite(at)) throw new Error("at is not a valid time");
      return ctx.api.post(`/api/dashboards/${seg(args.id)}/notes`, { at, text: str(args.text) });
    },
  },
  {
    name: "delete_dashboard_note",
    title: "Delete a dashboard note",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_VIEW],
    description: "Delete a note from a dashboard's timeline (yours, or any if you can edit the dashboard).",
    schema: z.object({ id: dashboardId, noteId: z.string().min(1) }),
    describe: (args) => `Delete the note ${quote(str(args.noteId))} from the dashboard ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.delete(`/api/dashboards/${seg(args.id)}/notes/${seg(args.noteId)}`),
  },
  {
    name: "share_dashboard",
    title: "Share a dashboard",
    toolkit: "dashboards",
    category: "operations",
    tier: "t2",
    connectionScoped: false,
    permissions: [PERMISSIONS.DASHBOARDS_SHARE],
    description: "Set which roles can see a dashboard, and which of them can edit it. Replaces the current shares.",
    schema: z.object({
      id: dashboardId,
      shares: z.array(z.object({ roleId: z.string().min(1), canEdit: z.boolean() })).max(50),
    }),
    describe: (args) => `Share the dashboard ${quote(str(args.id))} with ${Array.isArray(args.shares) ? args.shares.length : 0} role(s)`,
    execute: async (args, ctx) => ctx.api.put(`/api/dashboards/${seg(args.id)}/shares`, { shares: args.shares }),
  },
  {
    name: "update_table_context",
    title: "Update table context",
    toolkit: "dashboards",
    category: "data",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.CONTEXT_EDIT],
    description: "Set a table's curated context (description, grain, owner, tags) that every agent and person reads. Only the fields given change.",
    schema: z.object({
      database: z.string().min(1).max(64),
      table: z.string().min(1).max(64),
      description: z.string().max(4000).optional(),
      grain: z.string().max(500).optional().describe("What one row is, e.g. one order line"),
      owner: z.string().max(200).optional(),
      tags: z.array(z.string().min(1).max(60)).max(30).optional(),
    }),
    describe: (args) => `Update the context of ${str(args.database)}.${str(args.table)} (${["description", "grain", "owner", "tags"].filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => {
      const path = `/api/context/tables/${seg(args.database)}/${seg(args.table)}`;
      const existing = await ctx.api.get<{ curated?: Record<string, unknown> | null }>(path).catch(() => ({ curated: null }));
      const current = record(existing.curated);
      const pick = (key: string): unknown => (args[key] !== undefined ? args[key] : current[key]);
      return ctx.api.put(path, {
        description: pick("description") ?? null,
        grain: pick("grain") ?? null,
        owner: pick("owner") ?? null,
        insteadOf: current.insteadOf ?? null,
        deprecated: current.deprecated === true,
        tags: Array.isArray(pick("tags")) ? pick("tags") : [],
      });
    },
    undo: { mode: "restore", resource: "table_context", id: (args) => tableContextId(str(args.database), str(args.table)) },
  },
  {
    name: "upsert_metric",
    title: "Define a metric",
    toolkit: "dashboards",
    category: "data",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.CONTEXT_EDIT],
    description: "Define (or redefine, by name) a business metric on a table: an aggregate SQL expression every agent and person reads, e.g. revenue = sum(price * qty).",
    schema: z.object({
      database: z.string().min(1).max(64),
      table: z.string().min(1).max(64),
      name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Metric names are identifiers").max(100),
      expression: z.string().min(1).max(2000),
      description: z.string().max(2000).optional(),
      owner: z.string().max(200).optional(),
    }),
    describe: (args) => `Define the metric ${str(args.name)} = ${str(args.expression)} on ${str(args.database)}.${str(args.table)}`,
    execute: async (args, ctx) => ctx.api.put(`/api/context/tables/${seg(args.database)}/${seg(args.table)}/metrics`, given(args, ["name", "expression", "description", "owner"])),
    undo: { mode: "restore", resource: "metric", id: (args) => metricKey(str(args.database), str(args.table), str(args.name)) },
  },
  {
    name: "delete_metric",
    title: "Delete a metric",
    toolkit: "dashboards",
    category: "data",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.CONTEXT_EDIT],
    description: "Delete a table's business metric by name.",
    schema: z.object({ database: z.string().min(1).max(64), table: z.string().min(1).max(64), name: z.string().min(1).max(100) }),
    describe: (args) => `Delete the metric ${str(args.name)} on ${str(args.database)}.${str(args.table)}`,
    execute: async (args, ctx) => {
      const listed = await ctx.api.get<{ metrics?: Array<Record<string, unknown>> }>("/api/context/metrics");
      const found = (listed.metrics ?? []).find((m) => m.database === args.database && m.table === args.table && m.name === args.name);
      if (!found || typeof found.id !== "string") throw new Error("Metric not found");
      return ctx.api.delete(`/api/context/metrics/${seg(found.id)}`);
    },
    undo: { mode: "recreate-deleted", resource: "metric", id: (args) => metricKey(str(args.database), str(args.table), str(args.name)) },
  },
];
