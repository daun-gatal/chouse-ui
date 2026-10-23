/**
 * The write tools an agent can ask for (ADR 0024 §Phase 2). Each one calls a
 * CHouse route in-process as the approving user, so the route's permission
 * checks, validation and audit entry apply exactly as in the UI.
 *
 * - Low risk: the chat pauses and the user approves, edits or rejects the call.
 * - High risk (`propose_remediation`): the tool only files a remediation
 *   proposal; the remediation queue and its approval classes decide.
 */

import { z } from "zod";

import { PERMISSIONS, type Permission } from "../../../rbac/schema/base";
import { CHART_TYPES } from "../../dashboards/spec";
import { ACTION_TYPES } from "../../remediation/catalog";
import type { InProcessApiClient } from "../registry/inProcessApi";

export type ActionRisk = "low" | "high";

export interface ActionContext {
  client: InProcessApiClient;
  /** The chat's active connection, the default for every action. */
  connectionId: string | null;
}

export interface ActionDefinition {
  name: string;
  title: string;
  category: string;
  risk: ActionRisk;
  /** The user needs one of these for the tool to be offered; the route still decides. */
  permissions: Permission[];
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  /** One line for the approval card. */
  describe(args: Record<string, unknown>): string;
  execute(args: Record<string, unknown>, ctx: ActionContext): Promise<unknown>;
}

const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const quote = (value: string, max = 80): string => `"${value.length > max ? `${value.slice(0, max)}…` : value}"`;

function needConnection(ctx: ActionContext): string {
  if (!ctx.connectionId) throw new Error("Pick a ClickHouse connection first: this action runs on the active connection.");
  return ctx.connectionId;
}

const FREQUENCIES = ["hourly", "daily", "weekly", "monthly", "cron"] as const;

function scheduleText(args: Record<string, unknown>): string {
  const hour = typeof args.hour === "number" ? `${String(args.hour).padStart(2, "0")}:00` : "08:00";
  const tz = str(args.timezone, "UTC");
  switch (args.frequency) {
    case "hourly": return "every hour";
    case "daily": return `daily at ${hour} ${tz}`;
    case "weekly": return `weekly on day ${typeof args.dayOfWeek === "number" ? args.dayOfWeek : 1} at ${hour} ${tz}`;
    case "monthly": return `monthly on day ${typeof args.dayOfMonth === "number" ? args.dayOfMonth : 1} at ${hour} ${tz}`;
    case "cron": return `on cron ${quote(str(args.cronExpr))}`;
    default: return "on a schedule";
  }
}

const scheduleFields = {
  frequency: z.enum(FREQUENCIES).describe("How often it runs"),
  hour: z.number().int().min(0).max(23).optional().describe("Hour of day (daily, weekly, monthly)"),
  dayOfWeek: z.number().int().min(0).max(6).optional().describe("0 = Sunday (weekly)"),
  dayOfMonth: z.number().int().min(1).max(28).optional().describe("Day of month (monthly)"),
  cronExpr: z.string().optional().describe("Cron expression (frequency cron)"),
  timezone: z.string().optional().describe("IANA timezone, default UTC"),
};

const panelSchema = z.object({
  title: z.string().min(1).max(200),
  sql: z.string().min(1).describe("Read-only SELECT; may use {{from}} / {{to}} time-range macros"),
  chart: z.enum(CHART_TYPES).describe("Chart type; table shows every column"),
  x: z.string().optional().describe("x column (not for stat or table)"),
  y: z.array(z.string()).max(8).optional().describe("y columns (stat: exactly one; table and histogram: none)"),
});

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  {
    name: "kill_query",
    title: "Kill a query",
    category: "operations",
    risk: "low",
    permissions: [PERMISSIONS.LIVE_QUERIES_KILL, PERMISSIONS.LIVE_QUERIES_KILL_ALL],
    description: "Stop a running ClickHouse query by its query_id (from get_running_queries).",
    schema: z.object({ queryId: z.string().min(1).describe("query_id of the running query") }),
    describe: (args) => `KILL QUERY WHERE query_id = ${quote(str(args.queryId))}`,
    execute: async (args, ctx) => ctx.client.post("/api/live-queries/kill", { queryId: str(args.queryId) }),
  },
  {
    name: "create_saved_query",
    title: "Save a query",
    category: "data",
    risk: "low",
    permissions: [PERMISSIONS.SAVED_QUERIES_CREATE],
    description: "Save a SQL query to the user's saved queries on the active connection.",
    schema: z.object({
      name: z.string().min(1).max(200),
      query: z.string().min(1),
      description: z.string().max(2000).optional(),
    }),
    describe: (args) => `Save the query ${quote(str(args.name))}`,
    execute: async (args, ctx) => ctx.client.post("/api/saved-queries", {
      connectionId: needConnection(ctx),
      name: str(args.name),
      query: str(args.query),
      description: typeof args.description === "string" ? args.description : undefined,
    }),
  },
  {
    name: "create_scheduled_query",
    title: "Schedule a query",
    category: "operations",
    risk: "low",
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_EDIT],
    description: "Create a scheduled report query (read-only SELECT, no materialization) on the active connection.",
    schema: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      query: z.string().min(1).describe("Read-only SELECT"),
      ...scheduleFields,
    }),
    describe: (args) => `Schedule ${quote(str(args.name))} ${scheduleText(args)}`,
    execute: async (args, ctx) => ctx.client.post("/api/scheduled-queries", {
      connectionId: needConnection(ctx),
      name: str(args.name),
      description: typeof args.description === "string" ? args.description : null,
      query: str(args.query),
      frequency: args.frequency,
      ...(typeof args.hour === "number" ? { hour: args.hour } : {}),
      ...(typeof args.dayOfWeek === "number" ? { dayOfWeek: args.dayOfWeek } : {}),
      ...(typeof args.dayOfMonth === "number" ? { dayOfMonth: args.dayOfMonth } : {}),
      ...(typeof args.cronExpr === "string" ? { cronExpr: args.cronExpr } : {}),
      timezone: str(args.timezone, "UTC"),
      outputMode: "none",
    }),
  },
  {
    name: "create_health_promise",
    title: "Create a data health promise",
    category: "operations",
    risk: "low",
    permissions: [PERMISSIONS.DATA_HEALTH_EDIT],
    description: "Create a data health promise on a table of the active connection: checks (freshness, volume, nulls…) evaluated on a schedule. Use the check definitions recommend_health_promise or the data health docs describe.",
    schema: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      database: z.string().min(1).max(64),
      table: z.string().min(1).max(64),
      eventTimeColumn: z.string().max(64).optional().describe("Column holding each row's event time, for freshness and slot checks"),
      criticality: z.enum(["standard", "important", "critical"]).optional(),
      ...scheduleFields,
      checks: z.array(z.record(z.unknown())).min(1).max(20).describe("Check definitions, each with a type and its settings"),
    }),
    describe: (args) => `Promise ${quote(str(args.name))} on ${str(args.database)}.${str(args.table)} with ${Array.isArray(args.checks) ? args.checks.length : 0} check(s), ${scheduleText(args)}`,
    execute: async (args, ctx) => ctx.client.post("/api/data-health", {
      connectionId: needConnection(ctx),
      name: str(args.name),
      description: typeof args.description === "string" ? args.description : null,
      source: {
        sourceType: "table",
        databaseName: str(args.database),
        tableName: str(args.table),
        ...(typeof args.eventTimeColumn === "string" && args.eventTimeColumn ? { eventTimeColumn: args.eventTimeColumn } : {}),
      },
      ...(typeof args.criticality === "string" ? { criticality: args.criticality } : {}),
      frequency: args.frequency,
      ...(typeof args.hour === "number" ? { hour: args.hour } : {}),
      ...(typeof args.dayOfWeek === "number" ? { dayOfWeek: args.dayOfWeek } : {}),
      ...(typeof args.dayOfMonth === "number" ? { dayOfMonth: args.dayOfMonth } : {}),
      ...(typeof args.cronExpr === "string" ? { cronExpr: args.cronExpr } : {}),
      checks: args.checks,
    }),
  },
  {
    name: "create_dashboard",
    title: "Create a dashboard",
    category: "operations",
    risk: "low",
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Create a dashboard on the active connection from panels (title, SQL, chart type and columns).",
    schema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      timeRange: z.enum(["15m", "1h", "3h", "6h", "12h", "24h", "2d", "7d", "30d"]).optional().describe("Default time range, 24h if omitted"),
      panels: z.array(panelSchema).min(1).max(24),
    }),
    describe: (args) => `Create the dashboard ${quote(str(args.title))} with ${Array.isArray(args.panels) ? args.panels.length : 0} panel(s)`,
    execute: async (args, ctx) => ctx.client.post("/api/dashboards", dashboardDocument(args, needConnection(ctx))),
  },
  {
    name: "update_table_context",
    title: "Update table context",
    category: "data",
    risk: "low",
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
      const path = `/api/context/tables/${encodeURIComponent(str(args.database))}/${encodeURIComponent(str(args.table))}`;
      const existing = await ctx.client.get<{ curated?: Record<string, unknown> | null }>(path).catch(() => ({ curated: null }));
      const current = existing.curated ?? {};
      const pick = (key: string): unknown => (args[key] !== undefined ? args[key] : current[key]);
      return ctx.client.put(path, {
        description: pick("description") ?? null,
        grain: pick("grain") ?? null,
        owner: pick("owner") ?? null,
        insteadOf: current.insteadOf ?? null,
        deprecated: current.deprecated === true,
        tags: Array.isArray(pick("tags")) ? pick("tags") : [],
      });
    },
  },
  {
    name: "propose_remediation",
    title: "Propose a fix",
    category: "operations",
    risk: "high",
    permissions: [PERMISSIONS.REMEDIATION_PROPOSE],
    description: `File a remediation proposal for approvers, under the remediation approval rules. params.type is one of: ${ACTION_TYPES.filter((t) => t !== "create_panel_rollup").join(", ")}.`,
    schema: z.object({
      title: z.string().min(1).max(200),
      rationale: z.string().min(1).max(4000).describe("Why this fixes the problem, with the evidence"),
      params: z.record(z.unknown()).describe("The remediation action: { type, …its parameters }"),
    }),
    describe: (args) => `Propose ${quote(str(args.title))} (${str((args.params as { type?: unknown } | undefined)?.type, "fix")}) for approval in Fixes`,
    execute: async (args, ctx) => ctx.client.post("/api/remediation/actions", {
      connectionId: needConnection(ctx),
      params: args.params,
      title: str(args.title),
      rationale: str(args.rationale),
    }),
  },
];

const BY_NAME = new Map(ACTION_DEFINITIONS.map((d) => [d.name, d]));

export function actionDefinition(name: string): ActionDefinition | undefined {
  return BY_NAME.get(name);
}

/** A format 1 dashboard document (the route converts it), laid out two panels per row. */
/** Validates arguments a person edited on an approval, in words the approval card can show. */
export function parseEditedArgs(definition: ActionDefinition, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
  const parsed = definition.schema.safeParse(args ?? {});
  if (parsed.success) return { ok: true, args: parsed.data };
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ");
  return { ok: false, message: `The edited "${definition.title}" action is not valid: ${problems}` };
}

export function dashboardDocument(args: Record<string, unknown>, connectionId: string): Record<string, unknown> {
  const panels = Array.isArray(args.panels) ? args.panels : [];
  return {
    title: str(args.title),
    description: str(args.description),
    timeRange: str(args.timeRange, "24h"),
    refreshSeconds: 0,
    connectionScope: { kind: "only", connectionIds: [connectionId] },
    variables: [],
    panels: panels.map((raw) => {
      const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const type = str(p.chart, "table");
      const y = Array.isArray(p.y) ? p.y.filter((c): c is string => typeof c === "string") : [];
      return {
        id: null,
        title: str(p.title, "Panel"),
        sql: str(p.sql),
        viz: {
          version: 1,
          type,
          x: typeof p.x === "string" && p.x ? p.x : null,
          y,
          series: null,
          unit: "none",
          decimals: null,
          thresholds: [],
          colorScheme: "violet",
          reduce: type === "stat" ? "last" : null,
        },
        width: type === "table" ? 12 : 6,
        height: "m",
        fleet: false,
      };
    }),
  };
}
