import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { McpApiClient, McpApiError } from "./api";
import type { McpToolContext } from "./types";

const CTX: McpToolContext = {
  identity: {
    userId: "user-1",
    email: "user@example.com",
    username: "user",
    roles: ["member"],
    permissions: ["table:select"],
    patId: "pat-1",
  },
  token: "ch_pat_testtoken123456789012",
  connectionId: "conn-header",
  clientIp: "10.0.0.9",
};

function makeProxy(capture: { headers?: Record<string, string>; path?: string }): Hono {
  const proxy = new Hono();
  proxy.all("*", (c) => {
    if (capture.headers !== undefined) {
      capture.headers = Object.fromEntries(Object.entries(c.req.header()));
    }
    capture.path = c.req.path + (new URL(c.req.url).search || "");
    return c.json({ success: true, data: { echoed: true } });
  });
  return proxy;
}

describe("McpApiClient", () => {
  it("returns the envelope data on success", async () => {
    const client = new McpApiClient(makeProxy({}), CTX, 5000);
    const data = await client.request<{ echoed: boolean }>("GET", "/api/example");
    expect(data).toEqual({ echoed: true });
  });

  it("sends the PAT, connection, forwarded IP, and user-agent headers", async () => {
    const capture: { headers: Record<string, string> } = { headers: {} };
    const client = new McpApiClient(makeProxy(capture), CTX, 5000);
    await client.request("GET", "/api/example");
    expect(capture.headers["authorization"]).toBe(`Bearer ${CTX.token}`);
    expect(capture.headers["x-connection-id"]).toBe("conn-header");
    expect(capture.headers["x-forwarded-for"]).toBe("10.0.0.9");
    expect(capture.headers["user-agent"]).toBe("chouse-mcp/1");
  });

  it("serializes JSON bodies with a content-type", async () => {
    const seen: { contentType: string } = { contentType: "" };
    const proxy = new Hono();
    proxy.post("/api/example", async (c) => {
      seen.contentType = c.req.header("content-type") ?? "";
      const body = await c.req.json();
      return c.json({ success: true, data: body });
    });
    const client = new McpApiClient(proxy, CTX, 5000);
    const data = await client.request<{ query: string }>("POST", "/api/example", {
      body: { query: "SELECT 1" },
    });
    expect(data.query).toBe("SELECT 1");
    expect(seen.contentType).toContain("application/json");
  });

  it("appends query parameters to the path", async () => {
    const capture: { path?: string } = {};
    const client = new McpApiClient(makeProxy(capture), CTX, 5000);
    await client.request("GET", "/api/example", { query: { limit: "20" } });
    expect(capture.path).toBe("/api/example?limit=20");
  });

  it("withConnection overrides the X-Connection-Id header", async () => {
    const capture: { headers: Record<string, string> } = { headers: {} };
    const client = new McpApiClient(makeProxy(capture), CTX, 5000).withConnection("conn-arg");
    await client.request("GET", "/api/example");
    expect(capture.headers["x-connection-id"]).toBe("conn-arg");
  });

  it("throws McpApiError with the standard error shape", async () => {
    const proxy = new Hono();
    proxy.get("/api/fail", (c) =>
      c.json({ success: false, error: { code: "FORBIDDEN", message: "Permission denied" } }, 403)
    );
    const client = new McpApiClient(proxy, CTX, 5000);
    expect(client.request("GET", "/api/fail")).rejects.toThrow(McpApiError);
    const error = await client.request("GET", "/api/fail").catch((e: unknown) => e as McpApiError);
    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
    expect(error.message).toBe("Permission denied");
  });

  it("decodes the guard failure shape (string error, top-level code)", async () => {
    const proxy = new Hono();
    proxy.get("/api/guard", (c) =>
      c.json({ success: false, error: "Direct API access is not allowed.", code: "DIRECT_ACCESS_DENIED" }, 403)
    );
    const client = new McpApiClient(proxy, CTX, 5000);
    const error = await client.request("GET", "/api/guard").catch((e: unknown) => e as McpApiError);
    expect(error).toBeInstanceOf(McpApiError);
    expect(error.code).toBe("DIRECT_ACCESS_DENIED");
    expect(error.message).toBe("Direct API access is not allowed.");
  });

  it("decodes a non-JSON error body", async () => {
    const proxy = new Hono();
    proxy.get("/api/raw", (c) => c.text("server exploded", 500));
    const client = new McpApiClient(proxy, CTX, 5000);
    const error = await client.request("GET", "/api/raw").catch((e: unknown) => e as McpApiError);
    expect(error.code).toBe("REQUEST_FAILED");
    expect(error.message).toContain("server exploded");
  });
});
