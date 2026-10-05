/**
 * optionalRbacMiddleware is how every `/api/query` request authenticates
 * (via connectionContextMiddleware). Token requests must carry their auth
 * method and token id, or agent governance (budgets, pause, session counts)
 * and log_comment attribution silently skip them.
 */

import { afterAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

mock.module("../rbac/services/patAuth", () => ({
  verifyBearer: async (token: string) =>
    token.startsWith("ch_pat_")
      ? { userId: "u1", email: "u@test", username: "u", roles: ["analyst"], permissions: ["query:execute"], sessionId: "pat:p1", authMethod: "pat", patId: "p1", patName: "bot" }
      : { userId: "u1", email: "u@test", username: "u", roles: ["analyst"], permissions: [], sessionId: "s1", authMethod: "jwt" },
}));

const { optionalRbacMiddleware } = await import("./dataAccess");

afterAll(() => {
  mock.restore();
});

async function contextFor(token: string): Promise<Record<string, unknown>> {
  const app = new Hono();
  app.use("*", optionalRbacMiddleware);
  app.get("/", (c) => c.json({ authMethod: c.get("authMethod") ?? null, patId: c.get("patId") ?? null, roles: c.get("rbacRoles") ?? null }));
  const res = await app.request("/", { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()) as Record<string, unknown>;
}

describe("optionalRbacMiddleware", () => {
  it("marks token requests as PAT with their token id", async () => {
    expect(await contextFor("ch_pat_secret")).toEqual({ authMethod: "pat", patId: "p1", roles: ["analyst"] });
  });

  it("marks browser sessions as JWT without a token id", async () => {
    expect(await contextFor("eyJ.jwt.token")).toEqual({ authMethod: "jwt", patId: null, roles: ["analyst"] });
  });
});
