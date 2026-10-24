/**
 * Dashboards tools (ADR 0021 §11): read dashboards, run a panel, and manage
 * dashboards as code. Every tool calls /api/dashboards with the caller's
 * token, so each run is checked against the caller's own connection and table
 * access and passes agent governance like any query.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import type { McpDeps } from "../types";
import { apiFor, argOptionalString, argString, registerChouseTool, runApiTool, toolContext, type McpToolSink } from "./helpers";

const RANGES = ["15m", "1h", "3h", "6h", "12h", "24h", "2d", "7d", "30d"] as const;

const idSchema: Record<string, z.ZodTypeAny> = { id: z.string().min(1).describe("Dashboard id (from list_dashboards)") };

const runSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Dashboard id"),
  panel_id: z.string().min(1).describe("Panel id (from get_dashboard)"),
  range: z.enum(RANGES).describe("How far back to run the panel"),
  values: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional().describe("Variable values by name: a string, or a list for a multi-value variable; a variable left out uses its default"),
  connection_id: z.string().min(1).optional().describe("Connection to run on (defaults to the request/header connection); a fleet panel runs on every connection"),
};

const applySchema: Record<string, z.ZodTypeAny> = {
  dashboard: z.record(z.string(), z.unknown()).describe(
    "A dashboard export ({format: \"chouse.dashboard/v2\", id, dashboard}) as export_dashboard returns it; a chouse.dashboard/v1 export from before CHouse 3.16 is converted. " +
    "With an id, that dashboard is updated in place (its panel ids are kept); with id null, a new dashboard is created.",
  ),
};

function segment(value: string): string {
  return encodeURIComponent(value);
}

function argValues(args: Record<string, unknown>): Record<string, string | string[]> {
  const raw = args.values;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("values must be an object of variable names to values");
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v;
    else throw new Error(`values.${k} must be a string, or a list of strings for a multi-value variable`);
  }
  return out;
}

const ANNOTATION_SOURCES = ["ddl", "upgrades", "settings", "writers", "alerts", "incidents", "fixes", "notes"] as const;

const annotationsSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Dashboard id"),
  range: z.enum(RANGES).describe("How far back to look"),
  sources: z.array(z.enum(ANNOTATION_SOURCES)).optional().describe("Which kinds of event to read (default: every kind): DDL, upgrades, settings changes, new writers, panel alerts, incidents, fixes, notes"),
  connection_id: z.string().min(1).optional().describe("Connection whose events to read (defaults to the request/header connection)"),
};

const snapshotSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Dashboard id"),
  name: z.string().min(1).max(200).describe("Snapshot name"),
  range: z.enum(RANGES).describe("The range to freeze, ending now"),
  values: runSchema.values,
  role_ids: z.array(z.string()).optional().describe("Roles (from the dashboard's shares) that may open it besides you; default none"),
  expires_in_days: z.number().int().min(1).max(365).optional().describe("Days until it expires (default 30)"),
  connection_id: runSchema.connection_id,
};

const RANGE_SECONDS: Record<(typeof RANGES)[number], number> = { "15m": 900, "1h": 3_600, "3h": 10_800, "6h": 21_600, "12h": 43_200, "24h": 86_400, "2d": 172_800, "7d": 604_800, "30d": 2_592_000 };

function argRange(args: Record<string, unknown>): (typeof RANGES)[number] {
  const value = RANGES.find((r) => r === args.range);
  if (!value) throw new Error(`range must be one of ${RANGES.join(", ")}`);
  return value;
}

export function registerDashboardTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "list_dashboards",
    title: "List dashboards",
    category: "dashboards",
    access: "read",
    permissions: [PERMISSIONS.DASHBOARDS_VIEW],
    description: "Dashboards this token's user may view (own, shared with their roles, or all with dashboards:manage), with panel counts and access.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_dashboards", undefined, () => deps.clientFor(ctx).request("GET", "/api/dashboards"));
    },
  });

  registerChouseTool(sink, {
    name: "get_dashboard",
    title: "Get a dashboard",
    category: "dashboards",
    access: "read",
    permissions: [PERMISSIONS.DASHBOARDS_VIEW],
    description: "One dashboard: its variables, panels (SQL and chart settings), shares, lint findings and the caller's access.",
    inputSchema: idSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "get_dashboard", id, () => deps.clientFor(ctx).request("GET", `/api/dashboards/${segment(id)}`));
    },
  });

  registerChouseTool(sink, {
    name: "export_dashboard",
    title: "Export a dashboard",
    category: "dashboards",
    access: "read",
    permissions: [PERMISSIONS.DASHBOARDS_VIEW],
    description: "A dashboard as JSON (format chouse.dashboard/v2) that apply_dashboard and the CLI take — to review or keep in git.",
    inputSchema: idSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "export_dashboard", id, () => deps.clientFor(ctx).request("GET", `/api/dashboards/${segment(id)}/export`));
    },
  });

  registerChouseTool(sink, {
    name: "run_dashboard_panel",
    title: "Run a dashboard panel",
    category: "dashboards",
    access: "read",
    permissions: [PERMISSIONS.DASHBOARDS_VIEW],
    description:
      "Run one panel's read-only query for a time range and variable values, with the caller's own data access. " +
      "Returns columns and rows (at most 10,000), or for a fleet panel one result per connection.",
    inputSchema: runSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      const panelId = argString(args, "panel_id");
      const body = { range: { kind: "relative", value: argString(args, "range") }, values: argValues(args) };
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "run_dashboard_panel", `${id}/${panelId}`, () =>
        client.request("POST", `/api/dashboards/${segment(id)}/panels/${segment(panelId)}/run`, { body }));
    },
  });

  registerChouseTool(sink, {
    name: "list_dashboard_versions",
    title: "List dashboard versions",
    category: "dashboards",
    access: "read",
    permissions: [PERMISSIONS.DASHBOARDS_VIEW],
    description: "The last 50 saves of a dashboard, newest first: version number, who saved it, when, and how (UI, token, import, restore, rollup…).",
    inputSchema: idSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "list_dashboard_versions", id, () => deps.clientFor(ctx).request("GET", `/api/dashboards/${segment(id)}/versions`));
    },
  });

  registerChouseTool(sink, {
    name: "get_dashboard_annotations",
    title: "Get dashboard annotations",
    category: "dashboards",
    access: "read",
    permissions: [PERMISSIONS.DASHBOARDS_VIEW],
    description:
      "What changed around a dashboard's charts in a range — DDL, upgrades, settings, new writers, panel alerts, incidents, fixes and notes — " +
      "read with the caller's own access. Each kind says whether it could be read and why not.",
    inputSchema: annotationsSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      const sources = Array.isArray(args.sources) ? args.sources : [...ANNOTATION_SOURCES];
      const body = { range: { kind: "relative", value: argRange(args) }, sources };
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "get_dashboard_annotations", id, () => client.request("POST", `/api/dashboards/${segment(id)}/annotations`, { body }));
    },
  });

  registerChouseTool(sink, {
    name: "create_dashboard_snapshot",
    title: "Snapshot a dashboard",
    category: "dashboards",
    access: "write",
    permissions: [PERMISSIONS.DASHBOARDS_VIEW, PERMISSIONS.QUERY_EXECUTE],
    description:
      "Freeze every chart panel's result for a range ending now, as the caller, so it can be shared after the data moves on (at most 10 MiB). " +
      "Whoever opens it still only sees what their own access allows.",
    inputSchema: snapshotSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      const to = Math.floor(Date.now() / 1000);
      const roleIds = Array.isArray(args.role_ids) ? args.role_ids.filter((r): r is string => typeof r === "string") : [];
      const days = typeof args.expires_in_days === "number" ? args.expires_in_days : 30;
      const body = { name: argString(args, "name"), from: to - RANGE_SECONDS[argRange(args)], to, values: argValues(args), roleIds, expiresInDays: days, incidentId: null };
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "create_dashboard_snapshot", id, () => client.request("POST", `/api/dashboards/${segment(id)}/snapshots`, { body }));
    },
  });

  registerChouseTool(sink, {
    name: "apply_dashboard",
    title: "Create or update a dashboard",
    category: "dashboards",
    access: "write",
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description:
      "Create a dashboard from an export, or update the one its id names to match it exactly (panels left out are removed with their alerts). " +
      "Every panel is validated like a save in the UI; nothing is partly applied.",
    inputSchema: applySchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const body = args.dashboard as Record<string, unknown>;
      const id = typeof body.id === "string" && body.id.length > 0 ? body.id : null;
      const client = deps.clientFor(ctx);
      return runApiTool(ctx, client, "apply_dashboard", id ?? "new", async () => {
        if (id === null) return client.request("POST", "/api/dashboards/import", { body });
        const current = await client.request<{ dashboard: { version: number } }>("GET", `/api/dashboards/${segment(id)}`);
        return client.request("PUT", `/api/dashboards/${segment(id)}`, { body: { version: current.dashboard.version, dashboard: body.dashboard } });
      });
    },
  });

  registerChouseTool(sink, {
    name: "delete_dashboard",
    title: "Delete a dashboard",
    category: "dashboards",
    access: "destructive",
    permissions: [PERMISSIONS.DASHBOARDS_DELETE],
    description:
      "Delete a dashboard with its panels, shares, pins and panel alerts. Destructive — enabled by an administrator and limited by " +
      "your token's scopes; the human approves via the client's permission prompt before the call.",
    inputSchema: idSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "delete_dashboard", id, () => deps.clientFor(ctx).request("DELETE", `/api/dashboards/${segment(id)}`));
    },
  });
}
