/**
 * The tool catalog (ADR 0019 §4) — the only place an AI tool is defined.
 *
 * Admins compose agents from these entries; they never define tool behaviour.
 * Each entry declares the run context it needs (`requires`); a feature declares
 * the contexts it provides, and both save-time validation and the runtime
 * builder use the pair to keep a tool away from a run that cannot serve it.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { PERMISSIONS, type Permission } from "../../../rbac/schema/base";
import { applyCaps } from "../../../mcp/safety";
import { createChartTool, createCoreTools, type AgentToolContext } from "../../agentTools";
import { queryNodeTool, type FleetNode } from "../capabilities/fleetShared";
import { createAgentTool, type AgentTool, type AgentToolSet } from "../langchainTools";
import type { AgentRunContext } from "../types";
import { InProcessApiClient } from "./inProcessApi";
import type { ToolContextKind } from "./types";

export type ToolDomain = "clickhouse" | "chouse";
export type ToolAccess = "read" | "write" | "destructive";

/** Everything a tool factory may draw on for one run. */
export interface ToolRuntime {
  ctx: AgentRunContext;
  /** Fleet nodes resolved by the feature (fleet context). */
  fleetNodes?: FleetNode[];
}

export interface CatalogTool {
  name: string;
  title: string;
  domain: ToolDomain;
  category: string;
  access: ToolAccess;
  /** Run context the tool needs; null when it needs nothing. */
  requires: ToolContextKind | null;
  /**
   * The chat user needs at least one of these for the tool to be offered (empty:
   * anyone). Mirrors the projected route's guard; the route still decides.
   */
  permissions: Permission[];
  build(runtime: ToolRuntime): AgentTool | null;
}

// ============================================
// Runtime availability of each context
// ============================================

export function runtimeProvides(runtime: ToolRuntime, kind: ToolContextKind): boolean {
  switch (kind) {
    case "session":
      return Boolean(runtime.ctx.clickhouseService);
    case "fleet":
      return Array.isArray(runtime.fleetNodes) && runtime.fleetNodes.length > 0;
    case "userApi":
      return Boolean(runtime.ctx.bearerToken);
  }
}

// ============================================
// ClickHouse session tools
// ============================================

function toolContext(ctx: AgentRunContext): AgentToolContext | null {
  if (!ctx.clickhouseService) return null;
  return {
    userId: ctx.userId ?? "",
    isAdmin: ctx.isAdmin ?? false,
    permissions: ctx.permissions ?? [],
    connectionId: ctx.connectionId,
    clickhouseService: ctx.clickhouseService,
    defaultDatabase: ctx.defaultDatabase,
  };
}

const coreCache = new WeakMap<ToolRuntime, AgentToolSet>();

function coreTool(runtime: ToolRuntime, name: string): AgentTool | null {
  let tools = coreCache.get(runtime);
  if (!tools) {
    const context = toolContext(runtime.ctx);
    if (!context) return null;
    tools = { ...createCoreTools(context), ...createChartTool(context) } as AgentToolSet;
    coreCache.set(runtime, tools);
  }
  return tools[name] ?? null;
}

const CORE_TOOLS: Array<{ name: string; title: string; category: string }> = [
  { name: "list_databases", title: "List databases", category: "schema" },
  { name: "list_tables", title: "List tables", category: "schema" },
  { name: "get_table_schema", title: "Table schema", category: "schema" },
  { name: "get_table_ddl", title: "Table DDL", category: "schema" },
  { name: "get_table_size", title: "Table size", category: "schema" },
  { name: "get_table_sample", title: "Sample rows", category: "data" },
  { name: "run_select_query", title: "Run SELECT", category: "data" },
  { name: "explain_query", title: "EXPLAIN a query", category: "query" },
  { name: "get_database_info", title: "Database overview", category: "schema" },
  { name: "get_running_queries", title: "Running queries", category: "monitoring" },
  { name: "get_server_info", title: "Server info", category: "monitoring" },
  { name: "search_columns", title: "Search columns", category: "schema" },
  { name: "analyze_query", title: "Analyze a query", category: "query" },
  { name: "validate_sql", title: "Validate SQL", category: "query" },
  { name: "export_query_result", title: "Export a result", category: "data" },
  { name: "get_slow_queries", title: "Slow queries", category: "monitoring" },
  { name: "render_chart", title: "Render a chart", category: "visualization" },
];

const sessionTools: CatalogTool[] = CORE_TOOLS.map((entry) => ({
  ...entry,
  domain: "clickhouse",
  access: "read",
  requires: "session",
  permissions: [],
  build: (runtime) => coreTool(runtime, entry.name),
}));

const generateQueryTool: CatalogTool = {
  name: "generate_query",
  title: "Draft SQL from a description",
  domain: "clickhouse",
  category: "query",
  access: "read",
  requires: null,
  permissions: [],
  build: () => createAgentTool("generate_query", {
    description:
      "Generate a SQL query based on a natural language description. Use this after gathering schema information from other tools. After calling this, you MUST output the generated query in a ```sql code block. If the user wants the query executed, call run_select_query with that SQL.",
    inputSchema: z.object({
      description: z.string().describe("Natural language description of what the query should do"),
      context: z.string().describe("Relevant schema information gathered from other tools"),
    }),
    execute: async ({ description, context }: { description: string; context: string }) => ({
      note: "Generate the SQL query based on the description and schema context. Present it in a ```sql code block. If the user asked to run or execute the query, call run_select_query with that SQL.",
      description,
      schemaContext: context,
    }),
  }),
};

const optimizeQueryTool: CatalogTool = {
  name: "optimize_query",
  title: "Optimize a query (runs the optimize-query feature)",
  domain: "clickhouse",
  category: "query",
  access: "read",
  requires: "session",
  permissions: [],
  build: (runtime) => (runtime.ctx.clickhouseService
    ? createAgentTool("optimize_query", {
      description: "Get AI-powered optimization suggestions for a SQL query.",
      inputSchema: z.object({ sql: z.string().describe("The SQL query to optimize") }),
      execute: async ({ sql }: { sql: string }) => {
        try {
          // Runs the optimize-query feature through its own binding.
          const { runFeature } = await import("../engine");
          const result = await runFeature("optimize-query", { query: sql }, runtime.ctx);
          const optimization = result as { optimizedQuery: string; summary: string; explanation: string; cause: string; suggestions: string[] };
          return {
            optimizedQuery: optimization.optimizedQuery,
            summary: optimization.summary,
            explanation: optimization.explanation,
            cause: optimization.cause,
            suggestions: optimization.suggestions,
          };
        } catch (error: unknown) {
          return { error: error instanceof Error ? error.message : "Failed to optimize query" };
        }
      },
    })
    : null),
};

const boundedAggregateTool: CatalogTool = {
  name: "run_bounded_aggregate",
  title: "Run a bounded aggregate",
  domain: "clickhouse",
  category: "data",
  access: "read",
  requires: "session",
  permissions: [],
  build: (runtime) => {
    const runSelect = coreTool(runtime, "run_select_query");
    if (!runSelect) return null;
    return tool(async ({ sql }: { sql: string }) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      const hasAggregate = /\b(count|sum|avg|min|max|quantile\w*|uniq\w*)\s*\(/i.test(normalized);
      if (!hasAggregate || /select\s+\*/i.test(normalized)) return { error: "Only bounded aggregate queries are allowed for health recommendations." };
      return runSelect.invoke({ sql: normalized });
    }, {
      name: "run_bounded_aggregate",
      description: "Run one read-only aggregate SELECT for a health recommendation. Raw-row SELECTs and SELECT * are rejected.",
      schema: z.object({ sql: z.string().min(1).max(20000) }),
    }) as AgentTool;
  },
};

const queryNode: CatalogTool = {
  name: "query_node",
  title: "Query a node's system tables",
  domain: "clickhouse",
  category: "fleet",
  access: "read",
  requires: "fleet",
  permissions: [],
  build: (runtime) => (runtime.fleetNodes?.length ? (queryNodeTool(runtime.fleetNodes).query_node as AgentTool) : null),
};

// ============================================
// CHouse management tools (read-only API projections)
// ============================================

const MANAGEMENT_RESULT_CAPS = { maxRows: 100, maxCellChars: 2048, maxBytes: 60 * 1024 };

function segment(value: string): string {
  return encodeURIComponent(value);
}

/** Lift the first array out of `{ users: [...], total }`-style payloads so caps apply to rows. */
function rowsOf(data: unknown): unknown {
  if (Array.isArray(data) || !data || typeof data !== "object") return data;
  const entries = Object.entries(data as Record<string, unknown>);
  const arrays = entries.filter(([, value]) => Array.isArray(value));
  if (arrays.length !== 1) return data;
  const [key, rows] = arrays[0];
  return { ...Object.fromEntries(entries.filter(([k]) => k !== key)), rows };
}

interface ApiToolSpec {
  name: string;
  title: string;
  category: string;
  permissions: Permission[];
  description: string;
  schema?: z.ZodObject<z.ZodRawShape>;
  request: (args: Record<string, unknown>) => { path: string; query?: Record<string, string | undefined> };
}

function apiTool(spec: ApiToolSpec): CatalogTool {
  const schema = spec.schema ?? z.object({});
  return {
    name: spec.name,
    title: spec.title,
    domain: "chouse",
    category: spec.category,
    access: "read",
    requires: "userApi",
    permissions: spec.permissions,
    build: (runtime) => {
      const token = runtime.ctx.bearerToken;
      if (!token) return null;
      const client = new InProcessApiClient(token, runtime.ctx.connectionId);
      return createAgentTool(spec.name, {
        description: `${spec.description} Read-only; results respect your CHouse permissions.`,
        inputSchema: schema,
        execute: async (args: Record<string, unknown>) => {
          try {
            const { path, query } = spec.request(args);
            const { data, truncated } = applyCaps(rowsOf(await client.get(path, query)), MANAGEMENT_RESULT_CAPS);
            return truncated ? { truncated: true, data } : data;
          } catch (error: unknown) {
            return { error: error instanceof Error ? error.message : "Request failed" };
          }
        },
      });
    },
  };
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const int = (value: unknown, fallback: number, max: number): string => String(Math.min(max, Math.max(1, typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback)));

const managementTools: CatalogTool[] = [
  apiTool({
    name: "whoami", title: "Who am I", category: "identity", permissions: [],
    description: "The signed-in CHouse user: id, email, username, roles and effective permissions.",
    request: () => ({ path: "/api/rbac/auth/profile" }),
  }),
  apiTool({
    name: "list_users", title: "List users", category: "access", permissions: [PERMISSIONS.USERS_VIEW],
    description: "List CHouse users with their roles and status. Optional search text and role filter.",
    schema: z.object({
      search: z.string().optional().describe("Match on username, email or display name"),
      roleId: z.string().optional().describe("Only users holding this role id"),
      limit: z.number().int().min(1).max(100).optional().describe("Rows to return (default 50)"),
    }),
    request: (a) => ({ path: "/api/rbac/users", query: { search: str(a.search), roleId: str(a.roleId), limit: int(a.limit, 50, 100) } }),
  }),
  apiTool({
    name: "get_user", title: "Get a user", category: "access", permissions: [PERMISSIONS.USERS_VIEW],
    description: "One CHouse user by id, with roles and permissions.",
    schema: z.object({ id: z.string().min(1).describe("User id") }),
    request: (a) => ({ path: `/api/rbac/users/${segment(String(a.id))}` }),
  }),
  apiTool({
    name: "list_roles", title: "List roles", category: "access", permissions: [PERMISSIONS.ROLES_VIEW],
    description: "List CHouse roles with their permissions and user counts.",
    request: () => ({ path: "/api/rbac/roles" }),
  }),
  apiTool({
    name: "get_role", title: "Get a role", category: "access", permissions: [PERMISSIONS.ROLES_VIEW],
    description: "One CHouse role by id with its permission list.",
    schema: z.object({ id: z.string().min(1).describe("Role id") }),
    request: (a) => ({ path: `/api/rbac/roles/${segment(String(a.id))}` }),
  }),
  apiTool({
    name: "list_permissions", title: "Permission catalog", category: "access", permissions: [PERMISSIONS.ROLES_VIEW],
    description: "Every CHouse permission grouped by category, with display names.",
    request: () => ({ path: "/api/rbac/roles/permissions/by-category" }),
  }),
  apiTool({
    name: "list_data_access_policies", title: "Data access policies", category: "access", permissions: [PERMISSIONS.DATA_ACCESS_VIEW],
    description: "Data access policies (which roles may read/write which databases and tables, per connection).",
    request: () => ({ path: "/api/rbac/data-access-policies" }),
  }),
  apiTool({
    name: "list_my_access_tokens", title: "My access tokens", category: "access", permissions: [],
    description: "Your personal access tokens: name, scopes, expiry and last use (never the secret).",
    request: () => ({ path: "/api/rbac/pats" }),
  }),
  apiTool({
    name: "list_clickhouse_users", title: "ClickHouse users", category: "access", permissions: [PERMISSIONS.CH_USERS_VIEW],
    description: "Users defined in ClickHouse itself on the active connection.",
    request: () => ({ path: "/api/rbac/clickhouse-users" }),
  }),
  apiTool({
    name: "list_clickhouse_roles", title: "ClickHouse roles", category: "access", permissions: [PERMISSIONS.CH_ROLES_VIEW],
    description: "Roles defined in ClickHouse itself on the active connection.",
    request: () => ({ path: "/api/rbac/clickhouse-roles" }),
  }),
  apiTool({
    name: "get_sso_settings", title: "SSO settings", category: "access", permissions: [PERMISSIONS.SSO_VIEW],
    description: "Single sign-on settings and configured identity providers (secrets redacted).",
    schema: z.object({ part: z.enum(["settings", "providers"]).describe("settings or providers") }),
    request: (a) => ({ path: a.part === "providers" ? "/api/rbac/sso-admin/providers" : "/api/rbac/sso-admin/settings" }),
  }),
  apiTool({
    name: "list_connections", title: "Connections", category: "platform", permissions: [PERMISSIONS.CONNECTIONS_VIEW],
    description: "ClickHouse connections registered in CHouse (host, port, status; never passwords).",
    request: () => ({ path: "/api/rbac/connections" }),
  }),
  apiTool({
    name: "list_ai_models", title: "AI models", category: "platform", permissions: [PERMISSIONS.AI_MODELS_VIEW],
    description: "Configured AI models and providers, which one is the default, and their runtime parameters (API keys redacted).",
    request: () => ({ path: "/api/rbac/ai-models" }),
  }),
  apiTool({
    name: "audit_log", title: "Audit log", category: "platform", permissions: [PERMISSIONS.AUDIT_VIEW],
    description: "Recent audit log entries, newest first. Filter by action (e.g. user.update), username or status.",
    schema: z.object({
      action: z.string().optional().describe("Audit action, e.g. role.update"),
      username: z.string().optional().describe("Actor username"),
      status: z.enum(["success", "failed"]).optional(),
      startDate: z.string().optional().describe("ISO date lower bound"),
      limit: z.number().int().min(1).max(100).optional().describe("Rows to return (default 50)"),
    }),
    request: (a) => ({ path: "/api/rbac/audit", query: { action: str(a.action), username: str(a.username), status: str(a.status), startDate: str(a.startDate), limit: int(a.limit, 50, 100) } }),
  }),
  apiTool({
    name: "list_scheduled_jobs", title: "Scheduled jobs", category: "operations", permissions: [PERMISSIONS.SCHEDULED_QUERIES_VIEW],
    description: "Scheduled queries you can see: schedule, owner, last run status and next run.",
    request: () => ({ path: "/api/scheduled-queries" }),
  }),
  apiTool({
    name: "get_scheduled_job", title: "Scheduled job", category: "operations", permissions: [PERMISSIONS.SCHEDULED_QUERIES_VIEW],
    description: "One scheduled query by id with its definition.",
    schema: z.object({ id: z.string().min(1).describe("Scheduled query id") }),
    request: (a) => ({ path: `/api/scheduled-queries/${segment(String(a.id))}` }),
  }),
  apiTool({
    name: "list_scheduled_runs", title: "Scheduled runs", category: "operations", permissions: [PERMISSIONS.SCHEDULED_QUERIES_VIEW],
    description: "Recent runs of one scheduled query: status, duration, rows, error.",
    schema: z.object({ id: z.string().min(1).describe("Scheduled query id") }),
    request: (a) => ({ path: `/api/scheduled-queries/${segment(String(a.id))}/runs` }),
  }),
  apiTool({
    name: "list_health_checks", title: "Data health promises", category: "operations", permissions: [PERMISSIONS.DATA_HEALTH_VIEW],
    description: "Data Health promises you can see with their current status.",
    request: () => ({ path: "/api/data-health" }),
  }),
  apiTool({
    name: "get_health_check", title: "Data health promise", category: "operations", permissions: [PERMISSIONS.DATA_HEALTH_VIEW],
    description: "One Data Health promise by id with its checks.",
    schema: z.object({ id: z.string().min(1).describe("Promise id") }),
    request: (a) => ({ path: `/api/data-health/${segment(String(a.id))}` }),
  }),
  apiTool({
    name: "list_health_incidents", title: "Data health incidents", category: "operations", permissions: [PERMISSIONS.DATA_HEALTH_VIEW],
    description: "Open and recent Data Health incidents you can see.",
    request: () => ({ path: "/api/data-health/incidents" }),
  }),
  apiTool({
    name: "list_alerting", title: "Alerting", category: "operations", permissions: [PERMISSIONS.ALERTING_VIEW],
    description: "Alert notification channels or alert rules (channel secrets redacted).",
    schema: z.object({ kind: z.enum(["channels", "rules"]).describe("channels or rules") }),
    request: (a) => ({ path: `/api/alerting/${a.kind === "rules" ? "rules" : "channels"}` }),
  }),
  apiTool({
    name: "list_observe_incidents", title: "Observability incidents", category: "operations", permissions: [PERMISSIONS.OBSERVE_VIEW],
    description: "Data observability incidents with their root-cause summaries.",
    schema: z.object({ status: z.enum(["open", "resolved"]).optional() }),
    request: (a) => ({ path: "/api/observe/incidents", query: { status: str(a.status) } }),
  }),
  apiTool({
    name: "list_doctor_reports", title: "Doctor reports", category: "operations", permissions: [PERMISSIONS.DOCTOR_VIEW],
    description: "Recent fleet Doctor reports: verdict, summary, model and when they ran.",
    request: () => ({ path: "/api/fleet/doctor/reports" }),
  }),
  apiTool({
    name: "fleet_snapshots", title: "Fleet snapshot", category: "operations", permissions: [PERMISSIONS.FLEET_VIEW],
    description: "Latest health snapshot of every ClickHouse node (memory, CPU, queries, replication).",
    request: () => ({ path: "/api/fleet/snapshots" }),
  }),
  apiTool({
    name: "list_agent_sessions", title: "Agent sessions", category: "platform", permissions: [PERMISSIONS.AGENTS_VIEW],
    description: "External agents (MCP / access tokens) active in the last N days: queries, bytes read, warnings, blocks.",
    schema: z.object({ days: z.number().int().min(1).max(30).optional().describe("Window in days (default 1)") }),
    request: (a) => ({ path: "/api/agents/sessions", query: { days: int(a.days, 1, 30) } }),
  }),
  apiTool({
    name: "get_agent_governance", title: "Agent governance", category: "platform", permissions: [PERMISSIONS.AGENTS_VIEW],
    description: "Agent budget policies or the MCP endpoint settings and enabled tools.",
    schema: z.object({ part: z.enum(["policies", "mcp"]).describe("policies or mcp") }),
    request: (a) => ({ path: a.part === "mcp" ? "/api/agents/mcp" : "/api/agents/policies" }),
  }),
];

// ============================================
// Catalog
// ============================================

export const TOOL_CATALOG: readonly CatalogTool[] = [
  ...sessionTools,
  generateQueryTool,
  optimizeQueryTool,
  boundedAggregateTool,
  queryNode,
  ...managementTools,
];

const BY_NAME = new Map(TOOL_CATALOG.map((entry) => [entry.name, entry]));

export function catalogTool(name: string): CatalogTool | undefined {
  return BY_NAME.get(name);
}

/** Whether a chat user may be offered this tool (any of its permissions, or admin). */
export function userMayUseTool(entry: CatalogTool, ctx: AgentRunContext): boolean {
  if (entry.permissions.length === 0 || ctx.isAdmin) return true;
  const held = new Set(ctx.permissions ?? []);
  return entry.permissions.some((p) => held.has(p));
}

/**
 * Build the granted tools for one agent, in grant order. Tools whose context
 * the run does not provide, or that the user may not use, are left out.
 */
export function buildGrantedTools(grants: string[], runtime: ToolRuntime): AgentTool[] {
  const tools: AgentTool[] = [];
  for (const name of grants) {
    const entry = BY_NAME.get(name);
    if (!entry) continue;
    if (entry.requires && !runtimeProvides(runtime, entry.requires)) continue;
    if (entry.domain === "chouse" && !userMayUseTool(entry, runtime.ctx)) continue;
    const built = entry.build(runtime);
    if (built) tools.push(built);
  }
  return tools;
}

/** Static description of every entry, for the UI (built against a placeholder context). */
export function describeCatalog(): Array<Omit<CatalogTool, "build"> & { description: string }> {
  const placeholder: ToolRuntime = {
    ctx: { userId: "", isAdmin: true, permissions: [], clickhouseService: {} as never, bearerToken: "placeholder" },
    fleetNodes: [{ id: "node", name: "node" }],
  };
  return TOOL_CATALOG.map(({ build, ...entry }) => ({ ...entry, description: build(placeholder)?.description ?? "" }));
}
