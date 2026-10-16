/**
 * The AI request caller through the real `/api` router (ADR 0020): a real
 * personal access token and JWT, the API protection middleware, and auth that
 * runs inside the route — as AI chat and `/api/ai/invoke` do through
 * connectionContextMiddleware — rather than in `rbacAuthMiddleware`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../../../rbac/services/jwt";
import { createPat } from "../../../rbac/services/personalAccessTokens";
import { optionalRbacMiddleware } from "../../../middleware/dataAccess";
import { errorHandler } from "../../../middleware/error";
import api from "../../../routes";
import { currentCaller } from "./origin";

const USER = "origin-user";
let root: Hono;
let patToken = "";
let patId = "";

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'o@test.local', 'origin', 'x', 1, unixepoch(), unixepoch())`);
  const pat = await createPat(USER, { name: "ci-agent" });
  patToken = pat.rawToken;
  patId = pat.id;
  // A probe that authenticates inside the route, like the AI chat route does.
  api.get("/__caller-probe", async (c) => {
    await optionalRbacMiddleware(c, async () => {});
    return c.json({ success: true, data: currentCaller() });
  });
  root = new Hono();
  root.onError(errorHandler);
  root.route("/api", api);
});

afterAll(async () => {
  await closeDatabase();
});

async function probe(headers: Record<string, string>): Promise<unknown> {
  const res = await root.request("/api/__caller-probe", { headers });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: unknown }).data;
}

describe("AI request caller through the API router", () => {
  it("records a direct token caller with its token and client", async () => {
    expect(await probe({ Authorization: `Bearer ${patToken}`, "User-Agent": "chouse-cli/1.1.0" })).toEqual({ origin: "token", patId, clientName: "chouse CLI" });
  });

  it("records an MCP subrequest with the agent it forwards", async () => {
    const headers = { Authorization: `Bearer ${patToken}`, "User-Agent": "chouse-mcp/1", "X-Chouse-Agent-Source": "mcp", "X-Chouse-Agent-Client": "Claude Code" };
    expect(await probe(headers)).toEqual({ origin: "mcp", patId, clientName: "Claude Code" });
  });

  it("records a browser session as the UI", async () => {
    const jwt = await generateAccessToken({ sub: USER, email: "o@test.local", username: "origin", roles: ["custom"], permissions: [], sessionId: "s1" });
    expect(await probe({ Authorization: `Bearer ${jwt}`, "X-Requested-With": "XMLHttpRequest" })).toEqual({ origin: "ui", patId: null, clientName: null });
  });

  it("has no caller when the request is not authenticated", async () => {
    expect(await probe({ "X-Requested-With": "XMLHttpRequest" })).toBeNull();
  });
});
