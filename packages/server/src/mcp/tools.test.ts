/**
 * Tool registration matrix and tool-call flow (ADR 0013 §3/§4).
 *
 * Drives the assembled McpServer over the SDK's InMemoryTransport like a
 * real client, and captures the subrequests each tool projects against a
 * stub Hono proxy. The gate matrix is the safety contract: reads on by
 * default, writes, destructive and LLM-spending tools only when an
 * administrator turns them on (AI Governance › MCP), tools a token cannot use are
 * never listed, and the privilege fence never appears as a tool.
 */

import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

// Guardrails on MCP results read the registry database, which these tests do
// not open; ai-guardrails.test.ts covers them against a real database.
mock.module("./guardrails", () => ({ guardMcpResult: async (_tool: string, result: unknown) => result }));
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types";
import { PERMISSIONS } from "../rbac/schema/base";
import { buildMcpServer, buildMcpDeps, listToolDefinitions, toolCatalog, toolParameters } from "./server";
import type { McpSettings } from "./settings";
import { MCP_TOOL_CATEGORIES } from "./tools/helpers";
import type { McpToolContext } from "./types";

type ToolSwitches = Pick<McpSettings, "toolOverrides">;

const DEFAULTS: ToolSwitches = { toolOverrides: {} };

/** Settings with the named tools switched on. */
function enable(...names: string[]): ToolSwitches {
  return { toolOverrides: Object.fromEntries(names.map((name) => [name, true])) };
}

/** An identity holding every permission, so only the switches decide. */
const ALL = { permissions: Object.values(PERMISSIONS) as string[] };

interface Captured {
  method: string;
  path: string;
  body?: unknown;
}

function makeProxy(response: unknown, status = 200): { proxy: Hono; calls: Captured[] } {
  const calls: Captured[] = [];
  const proxy = new Hono();
  proxy.all("*", async (c) => {
    calls.push({
      method: c.req.method,
      path: c.req.path,
      body: c.req.method === "GET" ? undefined : await c.req.json().catch(() => undefined),
    });
    return c.json({ success: true, data: response }, status);
  });
  return { proxy, calls };
}

const CTX: McpToolContext = {
  identity: {
    userId: "user-1",
    email: "u@example.com",
    username: "user",
    roles: [],
    permissions: ["table:select", "metrics:view"],
    patId: "pat-1",
  },
  token: "ch_pat_testtoken123456789012",
  timeoutMs: 5000,
};

function isResponse(
  message: JSONRPCMessage
): message is { id: number; result?: unknown; error?: unknown } {
  return "id" in message && message.id !== undefined && ("result" in message || "error" in message);
}

interface Harness {
  request(method: string, params: Record<string, unknown> | undefined, context?: McpToolContext): Promise<{
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  }>;
  close(): Promise<void>;
}

/**
 * Minimal JSON-RPC harness over InMemoryTransport: sends requests with an
 * authInfo payload (like the Streamable HTTP transport does) and resolves
 * responses by id.
 */
async function createHarness(mcp: McpServer): Promise<Harness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: { id: number; result?: unknown; error?: unknown }) => void>();

  clientTransport.onmessage = (message: JSONRPCMessage) => {
    if (isResponse(message)) {
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  };

  await mcp.connect(serverTransport);

  let nextId = 0;
  return {
    async request(method, params, context) {
      const id = ++nextId;
      const response = new Promise<{ id: number; result?: unknown; error?: unknown }>((resolve) => {
        pending.set(id, resolve);
      });
      await clientTransport.send(
        { jsonrpc: "2.0", id, method, params } as JSONRPCMessage,
        {
          authInfo: {
            token: context?.token ?? "",
            clientId: "test",
            scopes: [],
            extra: { mcp: context ?? {} },
          },
        }
      );
      const message = await response;
      return {
        result: message.result as Record<string, unknown> | undefined,
        error: message.error as { code: number; message: string } | undefined,
      };
    },
    async close() {
      await mcp.close();
    },
  };
}

function resultText(result: Record<string, unknown> | undefined): string {
  const content = result?.content as Array<{ type: string; text: string }> | undefined;
  return content?.[0]?.text ?? "";
}

async function listToolNames(mcp: McpServer): Promise<string[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: { id: number; result?: unknown; error?: unknown }) => void>();
  clientTransport.onmessage = (message: JSONRPCMessage) => {
    if (isResponse(message)) {
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  };
  await mcp.connect(serverTransport);
  const response = new Promise<{ id: number; result?: unknown; error?: unknown }>((resolve) => {
    pending.set(1, resolve);
  });
  await clientTransport.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } as JSONRPCMessage);
  const message = await response;
  await mcp.close();
  return ((message.result?.tools ?? []) as Array<{ name: string }>).map((tool) => tool.name);
}

const DEFAULT_TOOL_NAMES = [
  "whoami",
  "list_connections",
  "use_connection",
  "list_databases",
  "list_tables",
  "describe_table",
  "sample_table",
  "query",
  "explain_query",
  "list_saved_queries",
  "get_saved_query",
  "run_saved_query",
  "metrics_overview",
  "live_queries",
  "fleet_snapshots",
  "list_scheduled_jobs",
  "get_scheduled_job",
  "list_scheduled_runs",
  "list_health_checks",
  "get_health_check",
  "health_timeline",
  "list_alerts",
  "audit_list",
  "get_dataset_health",
  "get_lineage",
  "get_table_context",
  "get_metric",
  "get_pipeline_status",
  "list_incidents",
  "list_remediation_actions",
  "get_remediation_action",
  "get_investigation_notebook",
  "get_query_regressions",
  "get_query_shape_history",
  "get_capacity",
  "list_upgrade_assessments",
  "get_upgrade_assessment",
  "get_canary_replay",
  "get_upgrade_rollout",
  "get_collector_status",
  "get_collector_schedule",
  "get_ai_usage",
  "get_ai_data_egress",
  "list_ai_requests",
  "get_ai_request",
  "list_ai_agents",
  "list_ai_guardrails",
  "list_ai_guardrail_triggers",
  "list_dashboards",
  "get_dashboard",
  "export_dashboard",
  "run_dashboard_panel",
];

const WRITE_TOOLS = [
  "create_saved_query",
  "run_scheduled_job",
  "run_health_check",
  "acknowledge_incident",
  "test_alert_channel",
  "propose_remediation",
  "apply_dashboard",
];

const DESTRUCTIVE_TOOLS = ["kill_query", "query_raw", "delete_saved_query", "delete_scheduled_job", "delete_dashboard"];

async function listTools(mcp: McpServer): Promise<Array<{ name: string; title?: string; annotations?: Record<string, unknown> }>> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: { id: number; result?: unknown; error?: unknown }) => void>();
  clientTransport.onmessage = (message: JSONRPCMessage) => {
    if (isResponse(message)) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  };
  await mcp.connect(serverTransport);
  const response = new Promise<{ id: number; result?: unknown; error?: unknown }>((resolve) => {
    pending.set(1, resolve);
  });
  await clientTransport.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } as JSONRPCMessage);
  const message = await response;
  await mcp.close();
  return ((message.result as { tools?: unknown[] } | undefined)?.tools ?? []) as Array<{ name: string; title?: string; annotations?: Record<string, unknown> }>;
}

describe("tool registration matrix", () => {
  it("lists every read-only tool by default and nothing else", async () => {
    const { proxy } = makeProxy({});
    const names = (await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL))).sort();
    expect(names).toEqual([...DEFAULT_TOOL_NAMES, "doctor_reports", "get_doctor_report"].sort());
  });

  it("keeps write tools off until an administrator enables them", async () => {
    const { proxy } = makeProxy({});
    const offNames = await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    for (const name of WRITE_TOOLS) expect(offNames).not.toContain(name);

    const onNames = await listToolNames(buildMcpServer(enable(...WRITE_TOOLS), buildMcpDeps(proxy), ALL));
    expect(onNames).toEqual(expect.arrayContaining(WRITE_TOOLS));
    expect(onNames).not.toContain("kill_query");
  });

  it("keeps destructive tools off until an administrator enables them", async () => {
    const { proxy } = makeProxy({});
    expect(await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL))).not.toContain("kill_query");

    const names = await listToolNames(buildMcpServer(enable(...DESTRUCTIVE_TOOLS), buildMcpDeps(proxy), ALL));
    expect(names).toEqual(expect.arrayContaining(DESTRUCTIVE_TOOLS));
  });

  it("keeps LLM-spending tools off by default", async () => {
    const { proxy } = makeProxy({});
    const off = await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    expect(off).not.toContain("ai_optimize");
    expect(off).not.toContain("doctor_scan");
    const on = await listToolNames(buildMcpServer(enable("ai_optimize", "doctor_scan"), buildMcpDeps(proxy), ALL));
    expect(on).toEqual(expect.arrayContaining(["ai_optimize", "doctor_scan"]));
  });

  it("hides a read-only tool an administrator turned off", async () => {
    const { proxy } = makeProxy({});
    const names = await listToolNames(buildMcpServer({ toolOverrides: { audit_list: false } }, buildMcpDeps(proxy), ALL));
    expect(names).not.toContain("audit_list");
    expect(names).toContain("query");
  });

  it("lists only the tools the token's permissions allow", async () => {
    const { proxy } = makeProxy({});
    const names = (await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), { permissions: ["metrics:view"] }))).sort();
    expect(names).toEqual(["metrics_overview", "whoami"]);
  });

  it("derives titles and annotations from each tool's access level", async () => {
    const { proxy } = makeProxy({});
    const tools = await listTools(buildMcpServer(enable("kill_query", "create_saved_query"), buildMcpDeps(proxy), ALL));
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("query")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.get("query")?.title).toBe("Run a read-only query");
    expect(byName.get("kill_query")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get("create_saved_query")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
});

describe("tool catalog", () => {
  const tools = listToolDefinitions();
  const known = new Set<string>(Object.values(PERMISSIONS));

  it("names every tool once", () => {
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
  });

  it("gives every tool a title, a known category and known permissions", () => {
    for (const tool of tools) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(MCP_TOOL_CATEGORIES).toContain(tool.category);
      for (const permission of tool.permissions) expect(known.has(permission)).toBe(true);
    }
  });

  it("requires a permission for every tool but whoami", () => {
    expect(tools.filter((tool) => tool.permissions.length === 0).map((tool) => tool.name)).toEqual(["whoami"]);
  });

  it("reports each tool's state and default", () => {
    const catalog = toolCatalog(tools, { toolOverrides: { kill_query: true, audit_list: false } });
    const byName = new Map(catalog.map((entry) => [entry.name, entry]));
    expect(byName.get("kill_query")).toMatchObject({ access: "destructive", enabled: true, enabledByDefault: false });
    expect(byName.get("audit_list")).toMatchObject({ access: "read", enabled: false, enabledByDefault: true });
    expect(byName.get("ai_optimize")).toMatchObject({ access: "read", spendsLlm: true, enabled: false, enabledByDefault: false });
  });

  it("describes input parameters", () => {
    const sample = tools.find((tool) => tool.name === "sample_table");
    expect(sample).toBeDefined();
    expect(toolParameters(sample!)).toEqual([
      { name: "database", type: "string", required: true, description: "Database name" },
      { name: "table", type: "string", required: true, description: "Table name" },
      { name: "limit", type: "number", required: false, description: "Rows to sample (max 20)" },
      { name: "connection_id", type: "string", required: false, description: "Connection id (defaults to the request/header connection)" },
    ]);
  });
});

describe("tool call flow (raw JSON-RPC with authInfo)", () => {
  it("projects a subrequest with the caller's PAT and caps the result", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ n: index }));
    const { proxy } = makeProxy({ rows });
    const mcp = buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    const { result } = await harness.request("tools/call", { name: "metrics_overview", arguments: {} }, CTX);
    expect(result?.isError).toBeFalsy();
    const payload = JSON.parse(resultText(result)) as { truncated: boolean; data: { rows: number[] } };
    expect(payload.truncated).toBe(true);
    expect(payload.data.rows.length).toBe(100);
    await harness.close();
  });

  it("refuses non-read SQL in the query tool without calling the API", async () => {
    const { proxy, calls } = makeProxy({});
    const mcp = buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    const { result } = await harness.request("tools/call", { name: "query", arguments: { sql: "DROP TABLE t" } }, CTX);
    expect(result?.isError).toBe(true);
    expect(resultText(result)).toContain("Refused");
    expect(calls).toEqual([]);
    await harness.close();
  });

  it("surfaces API failures as tool errors with the server code", async () => {
    const proxy = new Hono();
    proxy.all("*", (c) => c.json({ success: false, error: { code: "FORBIDDEN", message: "nope" } }, 403));
    const mcp = buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    const { result } = await harness.request("tools/call", { name: "metrics_overview", arguments: {} }, CTX);
    expect(result?.isError).toBe(true);
    expect(resultText(result)).toContain("FORBIDDEN");
    await harness.close();
  });

  it("fails closed when invoked without authenticated context", async () => {
    const { proxy } = makeProxy({});
    const mcp = buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    const { result, error } = await harness.request("tools/call", { name: "metrics_overview", arguments: {} });
    // A missing identity surfaces as a protocol error (the handler refuses
    // before any subrequest happens) — never a silent success.
    expect(result?.isError).not.toBe(false);
    const message = (result?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? error?.message ?? "";
    expect(message).toContain("authenticated context");
    await harness.close();
  });

  it("destructive tools run once an administrator enables them", async () => {
    const { proxy, calls } = makeProxy({ killed: true });
    const mcp = buildMcpServer(enable(...DESTRUCTIVE_TOOLS), buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    const { result } = await harness.request(
      "tools/call",
      { name: "kill_query", arguments: { query_id: "q-1" } },
      CTX
    );
    expect(result?.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toBe("/api/live-queries/kill");
    await harness.close();
  });

  it("destructive tools surface the API's authorization error when the PAT lacks the route permission", async () => {
    const proxy = new Hono();
    proxy.all("*", (c) => c.json({ success: false, error: { code: "FORBIDDEN", message: "missing live_queries:kill" } }, 403));
    const mcp = buildMcpServer(enable(...DESTRUCTIVE_TOOLS), buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    const { result } = await harness.request(
      "tools/call",
      { name: "kill_query", arguments: { query_id: "q-1" } },
      CTX
    );
    expect(result?.isError).toBe(true);
    expect(resultText(result)).toContain("FORBIDDEN");
    await harness.close();
  });
});

describe("privilege fence (source contract)", () => {
  const FORBIDDEN_FRAGMENTS = [
    "/rbac/pats",
    "change-password",
    "auth/login",
    "auth/refresh",
    "auth/logout",
    "/sso",
    "ai-providers",
    "ai-base-models",
    "ai-models",
    "data-access-policies",
    "clickhouse-users",
    "clickhouse-roles",
    "/upload",
    "audit/export",
  ];

  const toolsDir = join(import.meta.dir, "tools");
  const files = readdirSync(toolsDir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));

  it("never projects a fenced or UI-only surface", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(toolsDir, file), "utf8");
      for (const fragment of FORBIDDEN_FRAGMENTS) {
        if (source.includes(fragment)) {
          violations.push(`${file} references '${fragment}'`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("data observability tools (ADR 0016)", () => {
  it("projects dataset health, lineage and context onto the observe API", async () => {
    const { proxy, calls } = makeProxy({ ok: true });
    const mcp = buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    await harness.request("tools/call", { name: "get_dataset_health", arguments: { database: "shop", table: "orders" } }, CTX);
    await harness.request("tools/call", { name: "get_lineage", arguments: { database: "shop", table: "orders", direction: "up", depth: 2 } }, CTX);
    await harness.request("tools/call", { name: "get_table_context", arguments: { database: "shop", table: "orders" } }, CTX);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/observe/datasets/shop/orders",
      "GET /api/observe/lineage",
      "GET /api/context/tables/shop/orders",
    ]);
    await harness.close();
  });

  it("filters metrics by name", async () => {
    const { proxy } = makeProxy({ metrics: [{ name: "gmv" }, { name: "orders" }] });
    const mcp = buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    const { result } = await harness.request("tools/call", { name: "get_metric", arguments: { name: "gmv" } }, CTX);
    expect(resultText(result)).toContain("gmv");
    expect(resultText(result)).not.toContain("\"orders\"");
    await harness.close();
  });

  it("files a remediation proposal and never approves it", async () => {
    const { proxy, calls } = makeProxy({ id: "a1", status: "proposed" });
    const mcp = buildMcpServer(enable("propose_remediation"), buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    const { result } = await harness.request(
      "tools/call",
      { name: "propose_remediation", arguments: { type: "kill_query", params: { queryId: "q-1" }, rationale: "runaway scan", connection_id: "conn-1" } },
      CTX
    );
    expect(result?.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/remediation/actions");
    expect(calls[0]?.body).toMatchObject({ connectionId: "conn-1", params: { type: "kill_query", queryId: "q-1" }, rationale: "runaway scan" });
    expect(calls.some((c) => c.path.endsWith("/approve"))).toBe(false);
    await harness.close();
  });

  it("tags subrequests with the agent source and tool", async () => {
    const seen: Array<Record<string, string>> = [];
    const proxy = new Hono();
    proxy.all("*", (c) => {
      seen.push(c.req.header());
      return c.json({ success: true, data: {} });
    });
    const mcp = buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL);
    const harness = await createHarness(mcp);
    await harness.request("tools/call", { name: "get_pipeline_status", arguments: { status: "failing" } }, CTX);
    expect(seen[0]?.["x-chouse-agent-source"]).toBe("mcp");
    expect(seen[0]?.["x-chouse-agent-tool"]).toBe("get_pipeline_status");
    await harness.close();
  });
});

/** Path and query string of each projected subrequest. */
function makeUrlProxy(response: unknown): { proxy: Hono; urls: string[]; headers: Array<Record<string, string>> } {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const proxy = new Hono();
  proxy.all("*", (c) => {
    const url = new URL(c.req.url);
    urls.push(`${c.req.method} ${url.pathname}${url.search}`);
    headers.push(c.req.header());
    return c.json({ success: true, data: response });
  });
  return { proxy, urls, headers };
}

describe("performance, capacity and upgrade tools", () => {
  it("projects onto the observe and upgrades API, pinned to the requested connection", async () => {
    const { proxy, urls, headers } = makeUrlProxy({ ok: true });
    const harness = await createHarness(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    const calls: Array<[string, Record<string, unknown>]> = [
      ["get_query_regressions", { connection_id: "conn-2" }],
      ["get_query_shape_history", { fingerprint: "ab/12", connection_id: "conn-2" }],
      ["get_capacity", { connection_id: "conn-2" }],
      ["list_upgrade_assessments", { connection_id: "conn-2" }],
      ["get_upgrade_assessment", { id: "as-1" }],
      ["get_canary_replay", { id: "rp-1" }],
      ["get_upgrade_rollout", {}],
      ["get_collector_status", { connection_id: "conn-2" }],
      ["get_collector_schedule", {}],
      ["get_collector_schedule", { connection_id: "conn-2" }],
    ];
    for (const [name, args] of calls) {
      const { result } = await harness.request("tools/call", { name, arguments: args }, CTX);
      expect({ name, isError: result?.isError ?? false }).toEqual({ name, isError: false });
    }
    expect(urls).toEqual([
      "GET /api/observe/performance",
      "GET /api/observe/performance/fingerprints/ab%2F12",
      "GET /api/observe/capacity",
      "GET /api/upgrades/assessments",
      "GET /api/upgrades/assessments/as-1",
      "GET /api/upgrades/replays/rp-1",
      "GET /api/upgrades/rollout",
      "GET /api/observe/status",
      "GET /api/observe/collectors/schedule",
      "GET /api/observe/collectors/schedule/conn-2",
    ]);
    // Connection-scoped observe routes read the connection from the header.
    for (const i of [0, 1, 2, 3, 7]) expect(headers[i]?.["x-connection-id"]).toBe("conn-2");
    await harness.close();
  });

  it("lists performance tools only for tokens with their permission", async () => {
    const { proxy } = makeProxy({});
    const names = await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), { permissions: [PERMISSIONS.CAPACITY_VIEW, PERMISSIONS.UPGRADES_VIEW] }));
    expect(names.sort()).toEqual(["get_canary_replay", "get_capacity", "get_upgrade_assessment", "get_upgrade_rollout", "list_upgrade_assessments", "whoami"]);
  });
});

describe("remediation and notebook read tools", () => {
  it("lists a connection's remediation actions with status and incident filters", async () => {
    const { proxy, urls } = makeUrlProxy({ actions: [] });
    const harness = await createHarness(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    await harness.request("tools/call", { name: "list_remediation_actions", arguments: { connection_id: "conn-1", status: ["proposed", "approved"], incident_id: "inc-9" } }, CTX);
    await harness.request("tools/call", { name: "get_remediation_action", arguments: { id: "act 1" } }, CTX);
    expect(urls).toEqual([
      "GET /api/remediation/actions?connectionId=conn-1&status=proposed%2Capproved&incidentId=inc-9",
      "GET /api/remediation/actions/act%201",
    ]);
    await harness.close();
  });

  it("needs a connection to list remediation actions and rejects unknown statuses", async () => {
    const { proxy, urls } = makeUrlProxy({ actions: [] });
    const harness = await createHarness(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    const missing = await harness.request("tools/call", { name: "list_remediation_actions", arguments: {} }, CTX);
    expect(missing.result?.isError).toBe(true);
    expect(resultText(missing.result)).toContain("connection_id is required");
    const bad = await harness.request("tools/call", { name: "list_remediation_actions", arguments: { connection_id: "conn-1", status: ["done"] } }, CTX);
    expect(bad.result?.isError ?? Boolean(bad.error)).toBe(true);
    expect(urls).toEqual([]);
    await harness.close();
  });

  it("finds a notebook by the incident or report it belongs to", async () => {
    const { proxy, urls } = makeUrlProxy({ notebook: { id: "nb-1" }, cells: [] });
    const harness = await createHarness(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    await harness.request("tools/call", { name: "get_investigation_notebook", arguments: { attached_to: "incident_observe", ref: "inc/1" } }, CTX);
    const bad = await harness.request("tools/call", { name: "get_investigation_notebook", arguments: { attached_to: "scratch", ref: "x" } }, CTX);
    expect(bad.result?.isError ?? Boolean(bad.error)).toBe(true);
    expect(urls).toEqual(["GET /api/notebooks/attached/incident_observe/inc%2F1"]);
    await harness.close();
  });
});

describe("AI governance tools", () => {
  it("projects AI usage, egress and requests onto /api/ai-usage", async () => {
    const { proxy, urls } = makeUrlProxy({ models: [{ name: "Sonnet" }], requests: [], total: 0 });
    const harness = await createHarness(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    const usage = await harness.request("tools/call", { name: "get_ai_usage", arguments: { days: 30 } }, CTX);
    expect(JSON.parse(resultText(usage.result))).toMatchObject({ summary: { models: [{ name: "Sonnet" }] }, models: [{ name: "Sonnet" }] });
    await harness.request("tools/call", { name: "get_ai_data_egress", arguments: { q: "orders" } }, CTX);
    await harness.request("tools/call", { name: "list_ai_requests", arguments: { origin: "mcp", limit: 10, offset: 20, days: 7 } }, CTX);
    await harness.request("tools/call", { name: "list_ai_requests", arguments: {} }, CTX);
    await harness.request("tools/call", { name: "get_ai_request", arguments: { id: "req-1" } }, CTX);
    expect(urls).toEqual([
      "GET /api/ai-usage/summary?days=30",
      "GET /api/ai-usage/models?days=30",
      "GET /api/ai-usage/egress?q=orders",
      "GET /api/ai-usage/requests?days=7&origin=mcp&limit=10&offset=20",
      "GET /api/ai-usage/requests",
      "GET /api/ai-usage/requests/req-1",
    ]);
    const bad = await harness.request("tools/call", { name: "list_ai_requests", arguments: { origin: "browser" } }, CTX);
    expect(bad.result?.isError ?? Boolean(bad.error)).toBe(true);
    await harness.close();
  });

  it("summarizes the agent registry without prompts or skill files", async () => {
    const registry = {
      version: 4,
      features: [{ id: "optimize-query", title: "Optimize query", surface: "sql-editor", background: false, agentId: "a-1", variables: { query: {} } }],
      agents: [{
        id: "a-1", slug: "sql-optimizer", name: "SQL Optimizer", description: "Optimizes SQL", kind: "agent", systemPrompt: "SECRET PROMPT", taskTemplate: "TASK",
        modelConfigId: null, harnessId: "h-1", tuning: { stepBudget: 8 }, requiredPermissions: [], tools: ["explain_query"],
        skills: [{ skillId: "s-1", mode: "listed", pinnedFile: null }], subagents: [], enabled: true, isSystem: true, seedHash: "x",
        customized: false, version: 2, createdBy: null, createdAt: 1, updatedAt: 2, updateAvailable: false, usedBy: ["feature 'Optimize query'"],
      }],
      harnesses: [{ id: "h-1", slug: "focused", name: "Focused", description: "", excludedTools: ["task"], generalPurpose: { enabled: false }, promptSuffix: "SUFFIX", toolDescriptionOverrides: {}, isSystem: true, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0, updateAvailable: false, usedBy: [] }],
      skills: [{ id: "s-1", name: "optimizer", path: "ai-optimizer/optimizer", description: "Rules", skillMd: "SKILL BODY", files: { "a.md": "FILE" }, enabled: true, isSystem: true, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0, updateAvailable: false, usedBy: [] }],
      tools: [{ name: "explain_query" }],
      problems: [],
    };
    const { proxy, urls } = makeUrlProxy(registry);
    const harness = await createHarness(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    const { result } = await harness.request("tools/call", { name: "list_ai_agents", arguments: {} }, CTX);
    const text = resultText(result);
    expect(urls).toEqual(["GET /api/ai-agents/registry"]);
    for (const hidden of ["SECRET PROMPT", "TASK", "SUFFIX", "SKILL BODY", "FILE"]) expect(text).not.toContain(hidden);
    expect(JSON.parse(text)).toMatchObject({
      version: 4,
      features: [{ id: "optimize-query", agentId: "a-1" }],
      agents: [{ slug: "sql-optimizer", builtIn: true, harnessId: "h-1", tools: ["explain_query"], skillIds: ["s-1"], subagentIds: [] }],
      harnesses: [{ slug: "focused", excludedTools: ["task"] }],
      skills: [{ name: "optimizer", path: "ai-optimizer/optimizer" }],
    });
    await harness.close();
  });

  it("offers usage tools to chat and optimize users, and the registry only with ai_agents:view", async () => {
    const { proxy } = makeProxy({});
    const chat = await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), { permissions: [PERMISSIONS.AI_CHAT] }));
    expect(chat.sort()).toEqual(["get_ai_data_egress", "get_ai_request", "get_ai_usage", "list_ai_requests", "whoami"]);
    const registry = await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), { permissions: [PERMISSIONS.AI_AGENTS_VIEW] }));
    expect(registry.sort()).toEqual(["list_ai_agents", "whoami"]);
    const guardrails = await listToolNames(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), { permissions: [PERMISSIONS.AI_GUARDRAILS_VIEW] }));
    expect(guardrails.sort()).toEqual(["list_ai_guardrail_triggers", "list_ai_guardrails", "whoami"]);
  });
});

describe("dashboards tools (ADR 0021)", () => {
  function dashboardProxy(): { proxy: Hono; calls: Array<{ call: string; body: unknown; headers: Record<string, string> }> } {
    const calls: Array<{ call: string; body: unknown; headers: Record<string, string> }> = [];
    const proxy = new Hono();
    proxy.all("*", async (c) => {
      const url = new URL(c.req.url);
      calls.push({ call: `${c.req.method} ${url.pathname}`, body: c.req.method === "GET" || c.req.method === "DELETE" ? undefined : await c.req.json(), headers: c.req.header() });
      return c.json({ success: true, data: { dashboard: { id: "d1", version: 7 } } });
    });
    return { proxy, calls };
  }

  it("reads dashboards and runs a panel with the caller's token", async () => {
    const { proxy, calls } = dashboardProxy();
    const harness = await createHarness(buildMcpServer(DEFAULTS, buildMcpDeps(proxy), ALL));
    for (const [name, args] of [
      ["list_dashboards", {}],
      ["get_dashboard", { id: "d/1" }],
      ["export_dashboard", { id: "d1" }],
      ["run_dashboard_panel", { id: "d1", panel_id: "p1", range: "6h", values: { db: "shop" }, connection_id: "conn-2" }],
    ] as Array<[string, Record<string, unknown>]>) {
      const { result } = await harness.request("tools/call", { name, arguments: args }, CTX);
      expect({ name, isError: result?.isError ?? false }).toEqual({ name, isError: false });
    }
    expect(calls.map((c) => c.call)).toEqual([
      "GET /api/dashboards",
      "GET /api/dashboards/d%2F1",
      "GET /api/dashboards/d1/export",
      "POST /api/dashboards/d1/panels/p1/run",
    ]);
    expect(calls[3].body).toEqual({ range: { kind: "relative", value: "6h" }, values: { db: "shop" } });
    expect(calls[3].headers["x-connection-id"]).toBe("conn-2");
    expect(calls[3].headers["x-chouse-agent-source"]).toBe("mcp");
    await harness.close();
  });

  it("applies an export: a new dashboard is imported, an existing one is updated at its current version", async () => {
    const { proxy, calls } = dashboardProxy();
    const harness = await createHarness(buildMcpServer(enable("apply_dashboard"), buildMcpDeps(proxy), ALL));
    const doc = { title: "Orders", description: "", timeRange: "6h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], panels: [] };
    await harness.request("tools/call", { name: "apply_dashboard", arguments: { dashboard: { format: "chouse.dashboard/v1", id: null, dashboard: doc } } }, CTX);
    await harness.request("tools/call", { name: "apply_dashboard", arguments: { dashboard: { format: "chouse.dashboard/v1", id: "d1", dashboard: doc } } }, CTX);
    expect(calls.map((c) => c.call)).toEqual(["POST /api/dashboards/import", "GET /api/dashboards/d1", "PUT /api/dashboards/d1"]);
    expect(calls[0].body).toEqual({ format: "chouse.dashboard/v1", id: null, dashboard: doc });
    expect(calls[2].body).toEqual({ version: 7, dashboard: doc });
    await harness.close();
  });

  it("lists dashboard tools only for tokens with dashboards:view, and deleting needs dashboards:delete", async () => {
    const { proxy } = makeProxy({});
    const names = await listToolNames(buildMcpServer(enable("apply_dashboard", "delete_dashboard"), buildMcpDeps(proxy), { permissions: [PERMISSIONS.DASHBOARDS_VIEW] }));
    expect(names.sort()).toEqual(["export_dashboard", "get_dashboard", "list_dashboards", "run_dashboard_panel", "whoami"]);
  });
});
