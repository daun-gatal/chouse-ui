/**
 * HTTP-level MCP app tests (ADR 0013): origin guard, PAT-only auth, and the
 * end-to-end initialize → tools/call path through the stateless Streamable
 * HTTP transport with a stubbed verifier and stubbed proxy API.
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { AppError } from "../types";
import { createMcpApp } from "./index";
import { buildMcpDeps } from "./server";
import { loadMcpConfig } from "./config";
import type { McpIdentity } from "./types";

const IDENTITY: McpIdentity = {
  userId: "user-1",
  email: "user@example.com",
  username: "user",
  roles: [],
  permissions: ["table:select", "metrics:view"],
  patId: "pat-1",
  patName: "test-pat",
};

const VALID_TOKEN = "ch_pat_validtoken123456789012";

function makeApp() {
  const proxy = new Hono();
  proxy.get("/api/rbac/auth/profile", (c) =>
    c.json({ success: true, data: { user: { username: "user" }, roles: [], permissions: ["metrics:view"] } })
  );
  const config = loadMcpConfig({ NODE_ENV: "production", MCP_ENABLED: "true" }).config;
  if (!config) throw new Error("test config missing");
  return createMcpApp(config, buildMcpDeps(proxy, 5000), {
    verifyToken: async (token: string) => {
      if (token === VALID_TOKEN) return IDENTITY;
      throw AppError.unauthorized("Invalid personal access token");
    },
  }).app;
}

const ACCEPT = "application/json, text/event-stream";

function post(app: Hono, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: ACCEPT,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

interface RpcEnvelope {
  result?: { serverInfo?: { name?: string }; tools?: Array<{ name: string }> };
  error?: { code: number; message: string };
}

/** Extract the JSON-RPC message from a JSON or SSE response body. */
async function rpcBody(response: Response): Promise<RpcEnvelope> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data.length > 0) return JSON.parse(data) as RpcEnvelope;
      }
    }
    throw new Error(`no SSE data in response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as RpcEnvelope;
}

describe("createMcpApp (HTTP)", () => {
  it("rejects requests without a Bearer token (401)", async () => {
    const app = makeApp();
    const res = await post(app, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
  });

  it("rejects browser JWTs with the machine-surface message (401)", async () => {
    const app = makeApp();
    const res = await post(
      app,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig" }
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("personal access tokens only");
  });

  it("rejects an Origin header when the allowlist is empty (403, DNS rebinding)", async () => {
    const app = makeApp();
    const res = await post(
      app,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { Authorization: `Bearer ${VALID_TOKEN}`, Origin: "https://evil.example" }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("completes initialize and reports the server identity", async () => {
    const app = makeApp();
    const res = await post(
      app,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      },
      { Authorization: `Bearer ${VALID_TOKEN}` }
    );
    expect(res.status).toBe(200);
    const body = await rpcBody(res);
    expect(body.result?.serverInfo?.name).toBe("chouse");
  });

  it("serves a tools/call end-to-end through the proxy with caps", async () => {
    const app = makeApp();
    await post(
      app,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      },
      { Authorization: `Bearer ${VALID_TOKEN}` }
    );

    const res = await post(
      app,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } },
      { Authorization: `Bearer ${VALID_TOKEN}` }
    );
    expect(res.status).toBe(200);
    const body = await rpcBody(res);
    const result = body.result as { content: Array<{ text: string }>; isError?: boolean } | undefined;
    expect(result?.isError).toBeFalsy();
    const payload = JSON.parse(result?.content?.[0]?.text ?? "{}") as {
      user?: { username?: string };
    };
    expect(payload.user?.username).toBe("user");
  });

  it("rejects an invalid PAT on a tool call (fail closed, per request)", async () => {
    const app = makeApp();
    await post(
      app,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      },
      { Authorization: `Bearer ${VALID_TOKEN}` }
    );
    const res = await post(
      app,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } },
      { Authorization: "Bearer ch_pat_revokedtoken1234567890" }
    );
    expect(res.status).toBe(401);
  });
});
