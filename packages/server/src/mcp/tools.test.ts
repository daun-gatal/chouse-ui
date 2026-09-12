/**
 * Tool registration matrix and tool-call flow (ADR 0013 §3/§4).
 *
 * Drives the assembled McpServer over the SDK's InMemoryTransport like a
 * real client, and captures the subrequests each tool projects against a
 * stub Hono proxy. The gate matrix is the safety contract: reads on by
 * default, writes and destructive tools only when the operator enables
 * them, and the privilege fence never appears as a tool.
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types";
import { buildMcpServer, buildMcpDeps } from "./server";
import type { McpConfig } from "./config";
import type { McpToolContext } from "./types";

function makeConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return {
    enabled: true,
    host: "localhost",
    port: 8752,
    allowWrites: false,
    allowDestructive: false,
    toolsets: ["core", "explore", "query", "observe", "ops"],
    allowedOrigins: [],
    timeoutSeconds: 60,
    ...overrides,
  };
}

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
 * responses by id. `onClientRequest` can answer server-to-client requests
 * (elicitation) — e.g. replying with an error to simulate a client without
 * elicitation support.
 */
async function createHarness(
  mcp: McpServer,
  onClientRequest?: (
    request: { id: number; method: string },
    replyError: (id: number) => Promise<void>,
    replyResult: (id: number, result: Record<string, unknown>) => Promise<void>
  ) => void
): Promise<Harness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: { id: number; result?: unknown; error?: unknown }) => void>();

  clientTransport.onmessage = (message: JSONRPCMessage) => {
    if (isResponse(message)) {
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
      return;
    }
    if (onClientRequest && "method" in message && "id" in message && typeof message.id === "number") {
      const requestId = message.id;
      void onClientRequest(
        { id: requestId, method: message.method },
        async (id) => {
          await clientTransport.send({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "Method not found" },
          } as JSONRPCMessage);
        },
        async (id, result) => {
          await clientTransport.send({ jsonrpc: "2.0", id, result } as JSONRPCMessage);
        }
      );
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
];

describe("tool registration matrix", () => {
  it("registers the read-only default toolset and nothing else", async () => {
    const { proxy } = makeProxy({});
    const mcp = buildMcpServer(makeConfig(), buildMcpDeps(proxy, 5000));
    const names = (await listToolNames(mcp)).sort();
    expect(names).toEqual([...DEFAULT_TOOL_NAMES].sort());
  });

  it("hides write tools until MCP_ALLOW_WRITES", async () => {
    const { proxy } = makeProxy({});
    const off = buildMcpServer(makeConfig(), buildMcpDeps(proxy, 5000));
    const offNames = await listToolNames(off);
    expect(offNames).not.toContain("run_scheduled_job");
    expect(offNames).not.toContain("acknowledge_incident");
    await off.close();

    const on = buildMcpServer(
      makeConfig({ allowWrites: true, toolsets: ["core", "writes"] }),
      buildMcpDeps(proxy, 5000)
    );
    const onNames = await listToolNames(on);
    expect(onNames).toEqual(
      expect.arrayContaining([
        "create_saved_query",
        "run_scheduled_job",
        "run_health_check",
        "acknowledge_incident",
        "test_alert_channel",
      ])
    );
    expect(onNames).not.toContain("kill_query");
    await on.close();
  });

  it("hides destructive tools until MCP_ALLOW_DESTRUCTIVE, then registers them", async () => {
    const { proxy } = makeProxy({});
    const off = buildMcpServer(makeConfig(), buildMcpDeps(proxy, 5000));
    expect(await listToolNames(off)).not.toContain("kill_query");
    await off.close();

    const on = buildMcpServer(
      makeConfig({ allowWrites: true, allowDestructive: true, toolsets: ["core", "destructive"] }),
      buildMcpDeps(proxy, 5000)
    );
    const names = await listToolNames(on);
    expect(names).toEqual(
      expect.arrayContaining(["kill_query", "query_raw", "delete_saved_query", "delete_scheduled_job"])
    );
    await on.close();
  });

  it("registers ai tools only for the opt-in ai toolset", async () => {
    const { proxy } = makeProxy({});
    const on = buildMcpServer(makeConfig({ toolsets: ["core", "ai"] }), buildMcpDeps(proxy, 5000));
    const names = await listToolNames(on);
    expect(names).toEqual(expect.arrayContaining(["ai_optimize", "doctor_scan", "doctor_reports", "get_doctor_report"]));
    await on.close();
  });

  it("marks the query tool read-only and destructive tools destructive", async () => {
    const { proxy } = makeProxy({});
    const on = buildMcpServer(
      makeConfig({ allowWrites: true, allowDestructive: true, toolsets: ["core", "query", "destructive"] }),
      buildMcpDeps(proxy, 5000)
    );
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
    await on.connect(serverTransport);
    const response = new Promise<{ id: number; result?: unknown; error?: unknown }>((resolve) => {
      pending.set(1, resolve);
    });
    await clientTransport.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } as JSONRPCMessage);
    const message = await response;
    await on.close();
    const tools = (message.result?.tools ?? []) as Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
    }>;
    const query = tools.find((tool) => tool.name === "query");
    expect(query?.annotations?.readOnlyHint).toBe(true);
    const kill = tools.find((tool) => tool.name === "kill_query");
    expect(kill?.annotations?.destructiveHint).toBe(true);
  });
});

describe("tool call flow (raw JSON-RPC with authInfo)", () => {
  it("projects a subrequest with the caller's PAT and caps the result", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ n: index }));
    const { proxy } = makeProxy({ rows });
    const mcp = buildMcpServer(makeConfig(), buildMcpDeps(proxy, 5000));
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
    const mcp = buildMcpServer(makeConfig(), buildMcpDeps(proxy, 5000));
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
    const mcp = buildMcpServer(makeConfig(), buildMcpDeps(proxy, 5000));
    const harness = await createHarness(mcp);
    const { result } = await harness.request("tools/call", { name: "metrics_overview", arguments: {} }, CTX);
    expect(result?.isError).toBe(true);
    expect(resultText(result)).toContain("FORBIDDEN");
    await harness.close();
  });

  it("fails closed when invoked without authenticated context", async () => {
    const { proxy } = makeProxy({});
    const mcp = buildMcpServer(makeConfig(), buildMcpDeps(proxy, 5000));
    const harness = await createHarness(mcp);
    const { result, error } = await harness.request("tools/call", { name: "metrics_overview", arguments: {} });
    // A missing identity surfaces as a protocol error (the handler refuses
    // before any subrequest happens) — never a silent success.
    expect(result?.isError).not.toBe(false);
    const message = (result?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? error?.message ?? "";
    expect(message).toContain("authenticated context");
    await harness.close();
  });

  it("destructive tools refuse when the client cannot elicit (fail closed)", async () => {
    const { proxy, calls } = makeProxy({});
    const mcp = buildMcpServer(
      makeConfig({ allowWrites: true, allowDestructive: true, toolsets: ["core", "destructive"] }),
      buildMcpDeps(proxy, 5000)
    );
    const harness = await createHarness(mcp, (_request, replyError) => replyError(_request.id));
    const { result } = await harness.request(
      "tools/call",
      { name: "kill_query", arguments: { query_id: "q-1" } },
      CTX
    );
    expect(result?.isError).toBe(true);
    expect(resultText(result)).toContain("Refused");
    expect(calls).toEqual([]);
    await harness.close();
  });

  it("destructive tools execute only after an elicitation 'yes'", async () => {
    const { proxy, calls } = makeProxy({ killed: true });
    const mcp = buildMcpServer(
      makeConfig({ allowWrites: true, allowDestructive: true, toolsets: ["core", "destructive"] }),
      buildMcpDeps(proxy, 5000)
    );
    // Simulate an elicitation-capable client: answer the server request with accept + "yes".
    const harness = await createHarness(mcp, async (request, replyError, replyAccept) => {
      expect(request.method).toBe("elicitation/create");
      await replyAccept(request.id, { action: "accept", content: { approve: "yes" } });
    });
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
});

describe("privilege fence (source contract)", () => {
  const FORBIDDEN_FRAGMENTS = [
    "/rbac/pats",
    "change-password",
    "auth/login",
    "auth/refresh",
    "auth/logout",
    "sso",
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
