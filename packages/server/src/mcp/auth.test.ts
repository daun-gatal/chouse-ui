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
