/**
 * Observe & Ops toolkit (ADR 0025 §2): alerting, observability incidents,
 * fixes, notebooks, Doctor, fleet, collectors, cost and upgrades.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import { ACTION_TYPES } from "../../../remediation/catalog";
import type { ActionContext, ActionDefinition } from "../types";
import { given, idOf, needConnection, quote, record, seg, str } from "./shared";

const SEVERITIES = ["info", "warning", "critical"] as const;
const ATTACHMENTS = ["incident_data_health", "incident_observe", "doctor_report"] as const;
const RULE_FIELDS = ["name", "severity", "enabled", "aiRcaEnabled", "config", "channelIds"] as const;

async function editRule(ctx: ActionContext, id: string, change: Record<string, unknown>): Promise<unknown> {
  const rules = await ctx.api.get<Array<Record<string, unknown>>>("/api/alerting/rules");
  const rule = (Array.isArray(rules) ? rules : []).find((r) => r.id === id);
  if (!rule) throw new Error("Alert rule not found");
  const body = Object.fromEntries(RULE_FIELDS.map((k) => [k, rule[k]]));
  return ctx.api.put(`/api/alerting/rules/${seg(id)}`, { ...body, aiRcaModelId: rule.aiRcaModelId ?? null, ...change });
}

const ruleId = z.string().min(1).describe("Alert rule id (from list_alerting with kind rules)");
const tableKey = (args: Record<string, unknown>): string => JSON.stringify([str(args.database), str(args.table)]);

export const OBSERVE_ACTIONS: ActionDefinition[] = [
  {
    name: "propose_remediation",
    title: "Propose a fix",
    toolkit: "observe",
    category: "operations",
    // Only files a proposal; the remediation queue and its approval classes decide.
    tier: "t1",
    connectionScoped: false,
    proposalOnly: true,
    permissions: [PERMISSIONS.REMEDIATION_PROPOSE],
    description: `File a remediation proposal for approvers, under the remediation approval rules. params.type is one of: ${ACTION_TYPES.filter((t) => t !== "create_panel_rollup").join(", ")}.`,
    schema: z.object({
      title: z.string().min(1).max(200),
      rationale: z.string().min(1).max(4000).describe("Why this fixes the problem, with the evidence"),
      params: z.record(z.string(), z.unknown()).describe("The remediation action: { type, …its parameters }"),
    }),
    describe: (args) => `Propose ${quote(str(args.title))} (${str(record(args.params).type, "fix")}) for approval in Fixes`,
    execute: async (args, ctx) => ctx.api.post("/api/remediation/actions", {
      connectionId: needConnection(ctx),
      params: args.params,
      title: str(args.title),
      rationale: str(args.rationale),
    }),
  },
  {
    name: "create_alert_rule",
    title: "Create an alert rule",
    toolkit: "observe",
    category: "alerting",
    tier: "t1",
    connectionScoped: false,
    permissions: [PERMISSIONS.ALERTING_EDIT],
    description: "Create an alert rule that notifies channels (from list_alerting) when its condition fires. Fleet threshold rules use config keys memoryPercent, queryMemoryGb, longQueryMin, partsEtaMin; only one fleet rule may be enabled.",
    schema: z.object({
      name: z.string().min(1).max(120),
      sourceType: z.enum(["fleet_threshold", "data_quality"]).optional().describe("Default fleet_threshold"),
      severity: z.enum(SEVERITIES).optional(),
      enabled: z.boolean().default(true),
      config: z.record(z.string(), z.unknown()).optional(),
      channelIds: z.array(z.string()).max(20).optional(),
    }),
    describe: (args) => `Create the alert rule ${quote(str(args.name))}${args.enabled === false ? " (disabled)" : ""}`,
    execute: async (args, ctx) => ctx.api.post("/api/alerting/rules", { enabled: args.enabled !== false, ...given(args, ["name", "sourceType", "severity", "config", "channelIds"]) }),
    undo: { mode: "delete-created", resource: "alert_rule", id: (result) => idOf(result) },
  },
  {
    name: "update_alert_rule",
    title: "Edit an alert rule",
    toolkit: "observe",
    category: "alerting",
    tier: "t1",
    connectionScoped: false,
    permissions: [PERMISSIONS.ALERTING_EDIT],
    description: "Change an alert rule's name, severity, thresholds (config), channels or whether it is on. Only the fields given change.",
    schema: z.object({
      id: ruleId,
      name: z.string().min(1).max(120).optional(),
      severity: z.enum(SEVERITIES).optional(),
      enabled: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional().describe("Replaces the rule's config"),
      channelIds: z.array(z.string()).max(20).optional(),
    }),
    describe: (args) => `Edit the alert rule ${quote(str(args.id))} (${RULE_FIELDS.filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => editRule(ctx, str(args.id), given(args, RULE_FIELDS)),
    undo: { mode: "restore", resource: "alert_rule", id: (args) => str(args.id) },
  },
  {
    name: "mute_alert_rule",
    title: "Mute an alert rule",
    toolkit: "observe",
    category: "alerting",
    tier: "t1",
    connectionScoped: false,
    permissions: [PERMISSIONS.ALERTING_EDIT],
    description: "Turn an alert rule off so it stops notifying; undo (or update_alert_rule with enabled true) turns it back on.",
    schema: z.object({ id: ruleId }),
    describe: (args) => `Mute the alert rule ${quote(str(args.id))}`,
    execute: async (args, ctx) => editRule(ctx, str(args.id), { enabled: false }),
    undo: { mode: "restore", resource: "alert_rule", id: (args) => str(args.id) },
  },
  {
    name: "test_alert_channel",
    title: "Send a test alert",
    toolkit: "observe",
    category: "alerting",
    tier: "t2",
    connectionScoped: false,
    permissions: [PERMISSIONS.ALERTING_EDIT],
    description: "Send a test notification to an alert channel (Slack, email…) to check it works. It reaches real people.",
    schema: z.object({ id: z.string().min(1).describe("Alert channel id (from list_alerting with kind channels)") }),
    describe: (args) => `Send a test notification to the channel ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.post(`/api/alerting/channels/${seg(args.id)}/test`, {}),
  },
  {
    name: "clear_alert_events",
    title: "Clear recent alerts",
    toolkit: "observe",
    category: "alerting",
    tier: "t2",
    connectionScoped: false,
    permissions: [PERMISSIONS.ALERTING_DELETE],
    description: "Delete fired alert events: all of them, or those older than a number of hours.",
    schema: z.object({ olderThanHours: z.number().min(1).max(24 * 365).optional().describe("Only events older than this; omit for all") }),
    describe: (args) => (typeof args.olderThanHours === "number" ? `Clear alert events older than ${args.olderThanHours} hour(s)` : "Clear every recent alert event"),
    execute: async (args, ctx) => ctx.api.delete(typeof args.olderThanHours === "number"
      ? `/api/alerting/events?before=${Date.now() - Math.round(args.olderThanHours * 3_600_000)}`
      : "/api/alerting/events"),
  },
  {
    name: "acknowledge_observe_incident",
    title: "Acknowledge an observability incident",
    toolkit: "observe",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.OBSERVE_EDIT],
    description: "Mark an observability incident (from list_observe_incidents) as acknowledged.",
    schema: z.object({ id: z.string().min(1) }),
    describe: (args) => `Acknowledge the observability incident ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.post(`/api/observe/incidents/observe/${seg(args.id)}/acknowledge`, {}),
  },
  {
    name: "dismiss_suggestion",
    title: "Dismiss an Observe suggestion",
    toolkit: "observe",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.OBSERVE_EDIT],
    description: "Hide an Observe suggestion (by its key) so it is not offered again.",
    schema: z.object({ key: z.string().min(1).max(300) }),
    describe: (args) => `Dismiss the suggestion ${quote(str(args.key))}`,
    execute: async (args, ctx) => ctx.api.post("/api/observe/suggestions/dismiss", { key: str(args.key) }),
  },
  {
    name: "pin_table_criticality",
    title: "Set a table's criticality",
    toolkit: "observe",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.OBSERVE_EDIT],
    description: "Pin how critical a table is (critical, important, standard), or clear the pin with null so Observe infers it.",
    schema: z.object({
      database: z.string().min(1).max(64),
      table: z.string().min(1).max(64),
      criticality: z.enum(["critical", "important", "standard"]).nullable(),
    }),
    describe: (args) => `Set ${str(args.database)}.${str(args.table)} to ${args.criticality === null ? "inferred" : str(args.criticality)} criticality`,
    execute: async (args, ctx) => ctx.api.put(`/api/observe/datasets/${seg(args.database)}/${seg(args.table)}/criticality`, { criticality: args.criticality ?? null }),
    undo: { mode: "restore", resource: "table_criticality", id: tableKey },
  },
  {
    name: "add_notebook_cell",
    title: "Add to an investigation notebook",
    toolkit: "observe",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.NOTEBOOKS_EDIT],
    description: "Add a note or a query to the investigation notebook of an incident or Doctor report (created if it has none). Query cells run once when added.",
    schema: z.object({
      attachedTo: z.enum(ATTACHMENTS),
      ref: z.string().min(1).max(100).describe("The incident or report id"),
      kind: z.enum(["note", "query"]),
      text: z.string().max(20_000).optional().describe("Note text (kind note)"),
      sql: z.string().max(20_000).optional().describe("Read-only SELECT (kind query)"),
      title: z.string().max(200).optional().describe("Query cell title"),
    }),
    describe: (args) => `Add a ${str(args.kind)} to the notebook of ${str(args.attachedTo).replace(/_/g, " ")} ${quote(str(args.ref))}`,
    execute: async (args, ctx) => {
      const ensured = await ctx.api.post<{ notebook?: { id?: string } }>("/api/notebooks/ensure", { kind: args.attachedTo, ref: str(args.ref) });
      const notebookId = ensured.notebook?.id;
      if (!notebookId) throw new Error("The notebook could not be opened");
      const content = args.kind === "note"
        ? { kind: "note", text: str(args.text) }
        : { kind: "query", sql: str(args.sql), ...(typeof args.title === "string" ? { title: args.title } : {}) };
      const cell = await ctx.api.post<Record<string, unknown>>(`/api/notebooks/${seg(notebookId)}/cells`, content);
      return { ...cell, notebookId };
    },
    undo: { mode: "delete-created", resource: "notebook_cell", id: (result) => {
      const r = record(result);
      return typeof r.notebookId === "string" && typeof r.id === "string" ? `${r.notebookId}:${r.id}` : null;
    } },
  },
  {
    name: "update_cost_rates",
    title: "Set cost rates",
    toolkit: "observe",
    category: "operations",
    tier: "t2",
    connectionScoped: false,
    permissions: [PERMISSIONS.SETTINGS_UPDATE],
    description: "Set the prices Observe uses to estimate query cost: per TiB read and per CPU hour, in a currency.",
    schema: z.object({ currency: z.string().min(1).max(8), perTibRead: z.number().min(0).max(1e6), perCpuHour: z.number().min(0).max(1e6) }),
    describe: (args) => `Set cost rates to ${String(args.perTibRead)} ${str(args.currency)}/TiB read and ${String(args.perCpuHour)} ${str(args.currency)}/CPU hour`,
    execute: async (args, ctx) => ctx.api.put("/api/observe/cost-rates", given(args, ["currency", "perTibRead", "perCpuHour"])),
  },
  {
    name: "update_collector_schedule",
    title: "Change the collection schedule",
    toolkit: "observe",
    category: "operations",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.CONNECTIONS_EDIT],
    description: "Change how often Observe collectors run on the active connection, or pause them. Keys are collector names (from get_collector_schedule); a null value inherits the default.",
    schema: z.object({
      collectors: z.record(z.string().regex(/^[a-z][a-z_]*$/).max(40), z.object({
        intervalSeconds: z.number().int().positive().nullable().optional(),
        paused: z.boolean().nullable().optional(),
      })),
    }),
    describe: (args) => `Change the collection schedule of ${Object.keys(record(args.collectors)).join(", ") || "no collectors"}`,
    execute: async (args, ctx) => ctx.api.put(`/api/observe/collectors/schedule/${seg(needConnection(ctx))}`, { collectors: args.collectors }),
  },
  {
    name: "start_codec_trial",
    title: "Try a column codec",
    toolkit: "observe",
    category: "operations",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.UPGRADES_RUN],
    description: "Measure how a different compression codec would do on one column, by writing a sample to a scratch table on the active connection.",
    schema: z.object({ database: z.string().min(1).max(64), table: z.string().min(1).max(64), column: z.string().min(1).max(64), candidateCodec: z.string().min(1).max(100) }),
    describe: (args) => `Try codec ${str(args.candidateCodec)} on ${str(args.database)}.${str(args.table)}.${str(args.column)}`,
    execute: async (args, ctx) => ctx.api.post("/api/observe/codec-trials", given(args, ["database", "table", "column", "candidateCodec"])),
  },
  {
    name: "run_doctor_scan",
    title: "Run a Doctor scan",
    toolkit: "observe",
    category: "operations",
    tier: "t2",
    connectionScoped: false,
    permissions: [PERMISSIONS.DOCTOR_RUN],
    description: "Run the fleet Doctor now over the last hours of metrics (it uses the AI model and takes a while).",
    schema: z.object({
      hours: z.number().int().min(1).max(72).optional(),
      connectionIds: z.array(z.string()).max(50).optional().describe("Default: every connection"),
    }),
    describe: (args) => `Run a Doctor scan over the last ${typeof args.hours === "number" ? args.hours : 24} hour(s)`,
    execute: async (args, ctx) => ctx.api.post("/api/fleet/doctor/scan", given(args, ["hours", "connectionIds"])),
  },
  {
    name: "update_doctor_schedule",
    title: "Schedule the Doctor",
    toolkit: "observe",
    category: "operations",
    tier: "t2",
    connectionScoped: false,
    permissions: [PERMISSIONS.DOCTOR_RUN],
    description: "Turn the scheduled Doctor scan on or off and set when it runs.",
    schema: z.object({
      enabled: z.boolean(),
      frequency: z.enum(["daily", "weekly", "monthly"]),
      hour: z.number().int().min(0).max(23),
      dayOfWeek: z.number().int().min(0).max(6).default(1),
      dayOfMonth: z.number().int().min(1).max(28).default(1),
      hours: z.number().int().min(1).max(744).default(24).describe("Hours of metrics each scan reads"),
      connectionIds: z.array(z.string()).max(50).optional(),
      deliver: z.boolean().default(false).describe("Send each report to the alert channels"),
    }),
    describe: (args) => (args.enabled === false ? "Turn the scheduled Doctor scan off" : `Schedule the Doctor ${str(args.frequency)} at ${String(args.hour).padStart(2, "0")}:00`),
    execute: async (args, ctx) => ctx.api.put("/api/fleet/doctor/schedule", given(args, ["enabled", "frequency", "hour", "dayOfWeek", "dayOfMonth", "hours", "connectionIds", "deliver"])),
  },
  {
    name: "update_fleet_alert_config",
    title: "Change fleet alert thresholds",
    toolkit: "observe",
    category: "alerting",
    tier: "t2",
    connectionScoped: false,
    permissions: [PERMISSIONS.SETTINGS_UPDATE],
    description: "Turn fleet threshold alerts on or off and set their thresholds. Notification channels and their secrets are left as they are.",
    schema: z.object({
      enabled: z.boolean(),
      memoryPercent: z.number().min(0).max(100),
      queryMemoryGb: z.number().min(0),
      longQueryMin: z.number().min(0),
      partsEtaMin: z.number().min(0).max(1440).optional(),
    }),
    describe: (args) => `${args.enabled === false ? "Turn off" : "Set"} fleet alerts: memory ${String(args.memoryPercent)}%, query memory ${String(args.queryMemoryGb)} GB, long query ${String(args.longQueryMin)} min`,
    execute: async (args, ctx) => ctx.api.put("/api/fleet/alert-config", {
      enabled: args.enabled === true,
      rules: { memoryPercent: args.memoryPercent, queryMemoryGb: args.queryMemoryGb, longQueryMin: args.longQueryMin, partsEtaMin: typeof args.partsEtaMin === "number" ? args.partsEtaMin : 0 },
    }),
  },
  {
    name: "run_upgrade_assessment",
    title: "Assess an upgrade",
    toolkit: "observe",
    category: "operations",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.UPGRADES_RUN],
    description: "Assess what would break upgrading the active connection's ClickHouse to a version (it scans settings, functions and recent queries).",
    schema: z.object({ targetVersion: z.string().regex(/^\d+(\.\d+){1,3}$/, "Use a version such as 25.3") }),
    describe: (args) => `Assess an upgrade to ClickHouse ${str(args.targetVersion)}`,
    execute: async (args, ctx) => {
      needConnection(ctx);
      return ctx.api.post("/api/upgrades/assessments", { targetVersion: str(args.targetVersion) });
    },
  },
  {
    name: "run_canary_replay",
    title: "Replay queries on a canary",
    toolkit: "observe",
    category: "operations",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.UPGRADES_RUN],
    description: "Replay recent read queries from the active connection against a canary connection to compare results before an upgrade.",
    schema: z.object({
      canaryConnectionId: z.string().min(1),
      assessmentId: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    describe: (args) => `Replay up to ${typeof args.limit === "number" ? args.limit : 500} queries on the canary ${quote(str(args.canaryConnectionId))}`,
    execute: async (args, ctx) => {
      needConnection(ctx);
      return ctx.api.post("/api/upgrades/replays", given(args, ["canaryConnectionId", "assessmentId", "limit"]));
    },
  },
];
