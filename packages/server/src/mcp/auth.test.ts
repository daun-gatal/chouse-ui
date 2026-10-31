import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { AppError } from "../types";
import { errorHandler } from "../middleware/error";
import { createMcpAuthMiddleware } from "./auth";
import type { McpIdentity } from "./types";

const IDENTITY: McpIdentity = {
  userId: "user-1",
  email: "user@example.com",
  username: "user",
  roles: ["member"],
  permissions: ["table:select"],
  patId: "pat-1",
};

function makeApp(verify = async () => IDENTITY): { app: Hono; calls: string[] } {
  const calls: string[] = [];
  const app = new Hono();
  app.onError(errorHandler);
  app.use("*", createMcpAuthMiddleware(verify));
  app.get("/mcp", (c) => {
    calls.push("handler");
    return c.json({ userId: c.get("mcpIdentity").userId, token: c.get("mcpToken") });
  });
  return { app, calls };
}

describe("createMcpAuthMiddleware", () => {
  it("rejects requests without an Authorization header", async () => {
    const { app, calls } = makeApp();
    const res = await app.request("/mcp");
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("rejects browser JWTs with a clear machine-surface message", async () => {
    const { app, calls } = makeApp();
    const res = await app.request("/mcp", {
      headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("personal access tokens only");
    expect(calls).toEqual([]);
  });

  it("rejects a token that fails verification with the standard 401 message", async () => {
    const { app } = makeApp(async () => {
      throw AppError.unauthorized("Invalid personal access token");
    });
    const res = await app.request("/mcp", {
      headers: { Authorization: "Bearer ch_pat_bogus_bogus_bogus" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Invalid personal access token");
  });

  it("passes a valid PAT through with identity in context", async () => {
    const seen: string[] = [];
    const { app } = makeApp(async (token) => {
      seen.push(token);
      return IDENTITY;
    });
    const res = await app.request("/mcp", {
      headers: { Authorization: "Bearer ch_pat_validtoken1234567890" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; token: string };
    expect(body.userId).toBe("user-1");
    expect(body.token).toBe("ch_pat_validtoken1234567890");
    expect(seen).toEqual(["ch_pat_validtoken1234567890"]);
  });
});

describe("createMcpAuthMiddleware with OAuth (ADR 0028)", () => {
  const OAUTH_ON = { oauthEnabled: true, oauthPatsAllowed: true, publicUrl: "https://chouse.corp" };

  function withSettings(settings: Record<string, unknown>, verify = async () => IDENTITY): Hono {
    const app = new Hono();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("mcpSettings", settings as never);
      await next();
    });
    app.use("*", createMcpAuthMiddleware(verify));
    app.get("/mcp", (c) => c.json({ userId: c.get("mcpIdentity").userId }));
    return app;
  }

  it("points a 401 at the resource metadata while OAuth is on", async () => {
    const res = await withSettings(OAUTH_ON).request("/mcp");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer resource_metadata="https://chouse.corp/.well-known/oauth-protected-resource/mcp"');
    const bad = await withSettings(OAUTH_ON, async () => { throw AppError.unauthorized("Invalid or expired OAuth access token"); }).request("/mcp", { headers: { Authorization: "Bearer ch_oat_x" } });
    expect(bad.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  it("refuses OAuth tokens while OAuth is off, without a challenge", async () => {
    const res = await withSettings({ ...OAUTH_ON, oauthEnabled: false }).request("/mcp", { headers: { Authorization: "Bearer ch_oat_x" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("accepts an OAuth token, and a PAT only while PATs are allowed", async () => {
    expect((await withSettings(OAUTH_ON).request("/mcp", { headers: { Authorization: "Bearer ch_oat_x" } })).status).toBe(200);
    expect((await withSettings(OAUTH_ON).request("/mcp", { headers: { Authorization: "Bearer ch_pat_x" } })).status).toBe(200);
    const off = await withSettings({ ...OAUTH_ON, oauthPatsAllowed: false }).request("/mcp", { headers: { Authorization: "Bearer ch_pat_x" } });
    expect(off.status).toBe(401);
    expect(((await off.json()) as { error: { message: string } }).error.message).toContain("Personal access tokens are turned off");
  });

  it("gives no challenge when there is no usable public address", async () => {
    const res = await withSettings({ ...OAUTH_ON, publicUrl: null }).request("/mcp");
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
  });
});
