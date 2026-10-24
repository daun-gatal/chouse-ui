/**
 * Data observability tools (ADR 0016 §10): dataset health, lineage, curated
 * context, metrics, pipeline status, incidents, remediation actions and
 * investigation notebooks (read-only), plus `propose_remediation` (a write
 * tool, off by default), which only files a proposal. Approval and execution stay with humans in the UI, CLI or Slack;
 * an MCP proposal is never self-approved.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import { ACTION_STATUSES } from "../../services/remediation/store";
import type { McpDeps } from "../types";
import { apiFor, argEnum, argOptionalString, argString, registerChouseTool, type McpToolSink, runApiTool, toolContext } from "./helpers";

const connectionArg = z.string().min(1).optional().describe("Connection id (defaults to the request's connection)");

const tableSchema: Record<string, z.ZodTypeAny> = {
  database: z.string().min(1).describe("Database name"),
  table: z.string().min(1).describe("Table name"),
  connection_id: connectionArg,
};

const lineageSchema: Record<string, z.ZodTypeAny> = {
  database: z.string().min(1).describe("Database name"),
  table: z.string().min(1).describe("Table name"),
  direction: z.enum(["up", "down", "both"]).default("both").describe("Upstream, downstream or both"),
  depth: z.number().int().min(1).max(8).default(3).describe("Hops to follow"),
  connection_id: connectionArg,
};

const metricSchema: Record<string, z.ZodTypeAny> = {
  name: z.string().min(1).optional().describe("Metric name to look up; omit to list all"),
  connection_id: connectionArg,
};

const pipelineSchema: Record<string, z.ZodTypeAny> = {
  status: z.enum(["healthy", "lagging", "stalled", "retrying", "failing", "stopped", "inefficient", "paused", "unsupported_on_version"]).optional().describe("Only pipelines in this status"),
  kind: z.string().min(1).optional().describe("Only this source kind (e.g. kafka, s3queue, refreshable_view)"),
  connection_id: connectionArg,
};

const incidentsSchema: Record<string, z.ZodTypeAny> = {
  status: z.enum(["active", "all"]).default("active").describe("Active incidents only, or include recovered"),
  connection_id: connectionArg,
};

const proposeSchema: Record<string, z.ZodTypeAny> = {
  type: z.string().min(1).describe("Catalog action type, e.g. kill_query, optimize_partition, restart_engine_table"),
  params: z.record(z.string(), z.unknown()).describe("Action parameters as defined by the remediation catalog"),
  rationale: z.string().min(1).max(4000).describe("Why this fix: the evidence it addresses"),
  incident_source: z.enum(["data_health", "observe"]).optional().describe("Incident this fixes"),
  incident_id: z.string().max(64).optional().describe("Incident id this fixes"),
  connection_id: connectionArg,
};

const actionsSchema: Record<string, z.ZodTypeAny> = {
  status: z.array(z.enum(ACTION_STATUSES)).min(1).optional().describe("Only actions in these statuses (e.g. proposed, approved, failed)"),
  incident_id: z.string().min(1).max(64).optional().describe("Only actions proposed for this incident"),
  connection_id: connectionArg,
};

const actionSchema: Record<string, z.ZodTypeAny> = { id: z.string().min(1).describe("Remediation action id") };

const NOTEBOOK_ATTACHMENTS = ["incident_data_health", "incident_observe", "doctor_report"] as const;

const notebookSchema: Record<string, z.ZodTypeAny> = {
  attached_to: z.enum(NOTEBOOK_ATTACHMENTS).describe("What the notebook belongs to: a Data Health incident, an observability incident or a Doctor report"),
  ref: z.string().min(1).max(100).describe("The incident id (from list_incidents) or Doctor report id"),
};

const ANY_REMEDIATION = [PERMISSIONS.REMEDIATION_PROPOSE, PERMISSIONS.REMEDIATION_APPROVE, PERMISSIONS.REMEDIATION_APPROVE_HIGH];

function connectionOf(args: Record<string, unknown>, fallback: string | undefined): string | undefined {
  return argOptionalString(args, "connection_id") ?? fallback;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function registerDataObservabilityTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "get_dataset_health",
    title: "Dataset health",
    category: "data_observability",
    access: "read",
    permissions: [PERMISSIONS.OBSERVE_VIEW],
    description: "Health of one table: trust state, freshness, volume baseline, open incidents, owners and recent writers. Check this before relying on a table's data.",
    inputSchema: tableSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      const database = argString(args, "database");
      const table = argString(args, "table");
      return runApiTool(ctx, api, "get_dataset_health", `${database}.${table}`, () =>
        api.request("GET", `/api/observe/datasets/${segment(database)}/${segment(table)}`)
      );
    },
  });

  registerChouseTool(sink, {
    name: "get_lineage",
    title: "Table lineage",
    category: "data_observability",
    access: "read",
    permissions: [PERMISSIONS.OBSERVE_VIEW],
    description: "Column-free table lineage around one table: sources, materialized views, dictionaries, scheduled jobs and downstream tables.",
    inputSchema: lineageSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      const node = `table:${argString(args, "database")}.${argString(args, "table")}`;
      const direction = argEnum(args, "direction", ["up", "down", "both"]) ?? "both";
      const depth = typeof args.depth === "number" ? String(args.depth) : "3";
      return runApiTool(ctx, api, "get_lineage", node, () =>
        api.request("GET", "/api/observe/lineage", { query: { node, direction, depth } })
      );
    },
  });

  registerChouseTool(sink, {
    name: "get_table_context",
    title: "Table context",
    category: "data_observability",
    access: "read",
    permissions: [PERMISSIONS.OBSERVE_VIEW],
    description: "Curated context for a table: description, owner, column meanings, caveats and defined metrics.",
    inputSchema: tableSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      const database = argString(args, "database");
      const table = argString(args, "table");
      return runApiTool(ctx, api, "get_table_context", `${database}.${table}`, () =>
        api.request("GET", `/api/context/tables/${segment(database)}/${segment(table)}`)
      );
    },
  });

  registerChouseTool(sink, {
    name: "get_metric",
    title: "Metric definitions",
    category: "data_observability",
    access: "read",
    permissions: [PERMISSIONS.OBSERVE_VIEW],
    description: "Defined business metrics (name, SQL expression, table, filters). Use these definitions instead of inventing aggregations.",
    inputSchema: metricSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      const name = argOptionalString(args, "name");
      return runApiTool(ctx, api, "get_metric", name, async () => {
        const result = await api.request<{ metrics: Array<{ name: string }> }>("GET", "/api/context/metrics");
        return name ? { metrics: result.metrics.filter((m) => m.name === name) } : result;
      });
    },
  });

  registerChouseTool(sink, {
    name: "get_pipeline_status",
    title: "Pipeline status",
    category: "data_observability",
    access: "read",
    permissions: [PERMISSIONS.OBSERVE_VIEW],
    description: "Ingestion pipelines (Kafka, RabbitMQ, NATS, S3Queue, AzureQueue, refreshable views, scheduled jobs, ...) with one shared status vocabulary, lag and error class.",
    inputSchema: pipelineSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      const query: Record<string, string> = {};
      const status = argOptionalString(args, "status");
      const kind = argOptionalString(args, "kind");
      if (status) query.status = status;
      if (kind) query.kind = kind;
      return runApiTool(ctx, api, "get_pipeline_status", kind ?? status, () => api.request("GET", "/api/observe/pipelines", { query }));
    },
  });

  registerChouseTool(sink, {
    name: "list_incidents",
    title: "Data incidents",
    category: "data_observability",
    access: "read",
    permissions: [PERMISSIONS.OBSERVE_VIEW, PERMISSIONS.DATA_HEALTH_VIEW],
    description: "Data and pipeline incidents with severity, subject and the deterministic root-cause summary when computed.",
    inputSchema: incidentsSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const connectionId = connectionOf(args, ctx.connectionId);
      const query: Record<string, string> = { status: argEnum(args, "status", ["active", "all"]) ?? "active" };
      if (connectionId) query.connectionId = connectionId;
      return runApiTool(ctx, api, "list_incidents", connectionId, () => api.request("GET", "/api/observe/incidents", { query }));
    },
  });
}

export function registerRemediationReadTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "list_remediation_actions",
    title: "Remediation actions",
    category: "data_observability",
    access: "read",
    permissions: ANY_REMEDIATION,
    description:
      "Proposed and past fixes on a connection: action type and parameters, who proposed it and why, approvals needed and given, status and the incident it addresses.",
    inputSchema: actionsSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const connectionId = connectionOf(args, ctx.connectionId);
      const statuses = Array.isArray(args.status) ? args.status.filter((s): s is string => typeof s === "string") : [];
      const incidentId = argOptionalString(args, "incident_id");
      return runApiTool(ctx, api, "list_remediation_actions", connectionId, async () => {
        if (!connectionId) throw new Error("connection_id is required (or pin a connection with X-Connection-Id)");
        const query: Record<string, string> = { connectionId };
        if (statuses.length > 0) query.status = statuses.join(",");
        if (incidentId) query.incidentId = incidentId;
        return api.request("GET", "/api/remediation/actions", { query });
      });
    },
  });

  registerChouseTool(sink, {
    name: "get_remediation_action",
    title: "Remediation action",
    category: "data_observability",
    access: "read",
    permissions: ANY_REMEDIATION,
    description: "One remediation action with its approvals and every execution: the statements run, verification and rollback.",
    inputSchema: actionSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const id = argString(args, "id");
      return runApiTool(ctx, api, "get_remediation_action", id, () => api.request("GET", `/api/remediation/actions/${segment(id)}`));
    },
  });

  registerChouseTool(sink, {
    name: "get_investigation_notebook",
    title: "Investigation notebook",
    category: "data_observability",
    access: "read",
    permissions: [PERMISSIONS.DATA_HEALTH_VIEW, PERMISSIONS.OBSERVE_VIEW, PERMISSIONS.DOCTOR_VIEW],
    description:
      "The investigation notebook of an incident or Doctor report: Chouse AI findings, query snapshots, notes and actions, in order. " +
      "Needs the view permission of what it belongs to.",
    inputSchema: notebookSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const kind = argEnum(args, "attached_to", NOTEBOOK_ATTACHMENTS);
      const ref = argString(args, "ref");
      return runApiTool(ctx, api, "get_investigation_notebook", `${kind}:${ref}`, async () => {
        if (!kind) throw new Error(`attached_to must be one of: ${NOTEBOOK_ATTACHMENTS.join(", ")}`);
        return api.request("GET", `/api/notebooks/attached/${kind}/${segment(ref)}`);
      });
    },
  });
}

export function registerRemediationProposalTool(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "propose_remediation",
    title: "Propose a fix",
    category: "data_observability",
    access: "write",
    permissions: [PERMISSIONS.REMEDIATION_PROPOSE],
    description:
      "Propose a fix from the closed remediation catalog. This only files a proposal: a human approves it in CHouse UI, the CLI or Slack " +
      "before anything runs, and the proposer can never approve its own proposal.",
    inputSchema: proposeSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const connectionId = connectionOf(args, ctx.connectionId);
      const type = argString(args, "type");
      const params = typeof args.params === "object" && args.params !== null ? args.params : {};
      return runApiTool(ctx, api, "propose_remediation", type, async () => {
        if (!connectionId) throw new Error("connection_id is required (or pin a connection with X-Connection-Id)");
        return api.request("POST", "/api/remediation/actions", {
          body: {
            connectionId,
            params: { ...params, type },
            rationale: argString(args, "rationale"),
            incidentSource: argEnum(args, "incident_source", ["data_health", "observe"]) ?? null,
            incidentId: argOptionalString(args, "incident_id") ?? null,
          },
        });
      });
    },
  });
}
