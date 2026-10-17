/**
 * Dashboards tools (ADR 0021 §11): read dashboards, run a panel, and manage
 * dashboards as code. Every tool calls /api/dashboards with the caller's
 * token, so each run is checked against the caller's own connection and table
 * access and passes agent governance like any query.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import type { McpDeps } from "../types";
import { argOptionalString, argString, registerChouseTool, runApiTool, toolContext, type McpToolSink } from "./helpers";

const RANGES = ["15m", "1h", "3h", "6h", "12h", "24h", "2d", "7d", "30d"] as const;

const idSchema: Record<string, z.ZodTypeAny> = { id: z.string().min(1).describe("Dashboard id (from list_dashboards)") };

const runSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Dashboard id"),
  panel_id: z.string().min(1).describe("Panel id (from get_dashboard)"),
  range: z.enum(RANGES).describe("How far back to run the panel"),
  values: z.record(z.string()).optional().describe("Variable values by name; a variable left out uses its default"),
  connection_id: z.string().min(1).optional().describe("Connection to run on (defaults to the dashboard's connection)"),
};

const applySchema: Record<string, z.ZodTypeAny> = {
  dashboard: z.record(z.unknown()).describe(
    "A dashboard export ({format: \"chouse.dashboard/v1\", id, dashboard}) as export_dashboard returns it. " +
    "With an id, that dashboard is updated in place (its panel ids are kept); with id null, a new dashboard is created.",
  ),
};

function segment(value: string): string {
  return encodeURIComponent(value);
}

function argValues(args: Record<string, unknown>): Record<string, string> {
  const raw = args.values;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("values must be an object of variable names to values");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") throw new Error(`values.${k} must be a string`);
    out[k] = v;
  }
  return out;
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
    description: "A dashboard as JSON (format chouse.dashboard/v1) that apply_dashboard and the CLI take — to review or keep in git.",
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
      const body = { range: { kind: "relative", value: argString(args, "range") }, values: argValues(args), connectionId: argOptionalString(args, "connection_id") ?? null };
      return runApiTool(ctx, deps.clientFor(ctx), "run_dashboard_panel", `${id}/${panelId}`, () =>
        deps.clientFor(ctx).request("POST", `/api/dashboards/${segment(id)}/panels/${segment(panelId)}/run`, { body }));
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
