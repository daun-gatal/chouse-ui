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

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
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
];

const WRITE_TOOLS = [
  "create_saved_query",
  "run_scheduled_job",
  "run_health_check",
  "acknowledge_incident",
  "test_alert_channel",
  "propose_remediation",
];

const DESTRUCTIVE_TOOLS = ["kill_query", "query_raw", "delete_saved_query", "delete_scheduled_job"];

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
