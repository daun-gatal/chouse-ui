/**
 * `/api/agents` policy scopes (ADR 0016 §10): the role / token picker is
 * manage-only, policies come back with display names, and a policy can only
 * target a role or token that exists. Runs against a real in-memory database.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { createPat } from "../rbac/services/personalAccessTokens";
import { errorHandler } from "../middleware/error";
import { touchSession } from "../services/agents/store";
import agents from "./agents";

const USER = "agents-route-user";
let app: Hono;
let patId = "";

async function call(method: string, path: string, permissions: string[], body?: unknown): Promise<Response> {
  const token = await generateAccessToken({ sub: USER, email: "a@test.local", username: "agents", roles: ["custom"], permissions, sessionId: "s1" });
  return app.request(`/agents${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function policy(scopeKind: string, scopeId: string): Record<string, unknown> {
  return { scopeKind, scopeId, maxBytesPerQuery: null, dailyBytes: 1024, partitionFilterBytes: null, incidentMode: "warn", alertMultiplier: null };
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, display_name, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'a@test.local', 'agents', 'Agent Owner', 'x', 1, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, is_default, priority, created_at, updated_at) VALUES ('role-analysts', 'analysts', 'Analysts', 0, 0, 0, unixepoch(), unixepoch())`);
  patId = (await createPat(USER, { name: "warehouse-bot" })).id;
  app = new Hono();
  app.onError(errorHandler);
  app.route("/agents", agents);
});

afterAll(async () => {
  await closeDatabase();
});

describe("GET /agents/policy-scopes", () => {
  it("lists roles and tokens by display name for managers", async () => {
    const res = await call("GET", "/policy-scopes", ["agents:manage"]);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { roles: Array<{ id: string; label: string }>; tokens: Array<{ id: string; label: string; detail: string }> } };
    expect(data.roles).toContainEqual(expect.objectContaining({ id: "analysts", label: "Analysts" }));
    expect(data.tokens).toContainEqual(expect.objectContaining({ id: patId, label: "warehouse-bot" }));
  });

  it("is refused without agents:manage", async () => {
    expect((await call("GET", "/policy-scopes", ["agents:view"])).status).toBe(403);
  });
});

describe("PUT /agents/policies", () => {
  it("saves a role policy and lists it by the role's display name", async () => {
    expect((await call("PUT", "/policies", ["agents:manage"], policy("role", "analysts"))).status).toBe(200);
    expect((await call("PUT", "/policies", ["agents:manage"], policy("pat", patId))).status).toBe(200);
    const res = await call("GET", "/policies", ["agents:view"]);
    const { data } = (await res.json()) as { data: { policies: Array<{ scopeKind: string; scopeLabel: string }> } };
    expect(data.policies.find((p) => p.scopeKind === "role")?.scopeLabel).toBe("Analysts");
    expect(data.policies.find((p) => p.scopeKind === "pat")?.scopeLabel).toBe("warehouse-bot · Agent Owner");
  });

  it("rejects a role or token that does not exist", async () => {
    const role = await call("PUT", "/policies", ["agents:manage"], policy("role", "no-such-role"));
    expect(role.status).toBe(400);
    const token = await call("PUT", "/policies", ["agents:manage"], policy("pat", "no-such-token"));
    expect(token.status).toBe(400);
    const wildcard = await call("PUT", "/policies", ["agents:manage"], policy("default", "analysts"));
    expect(wildcard.status).toBe(400);
  });
});

describe("GET /agents/sessions", () => {
  it("keeps the first client seen and names the token and user", async () => {
    await touchSession(patId, USER, "mcp", "Claude Code");
    await touchSession(patId, USER, "mcp", "Node.js client");
    await touchSession(null, USER, "pat", "chouse-mcp/1");
    const res = await call("GET", "/sessions", ["agents:view"]);
    const { data } = (await res.json()) as { data: { sessions: Array<{ source: string; clientName: string | null; patName: string | null; userName: string | null }> } };
    const mcp = data.sessions.find((s) => s.source === "mcp");
    expect(mcp).toMatchObject({ clientName: "Claude Code", patName: "warehouse-bot", userName: "Agent Owner" });
    // CHouse's own subrequest agent recorded by older builds is never shown as the client.
    expect(data.sessions.find((s) => s.source === "pat")?.clientName).toBeNull();
  });
});

describe("PUT /agents/policies/assign", () => {
  const settings = { maxBytesPerQuery: null, dailyBytes: 4096, partitionFilterBytes: null, incidentMode: "block", alertMultiplier: null };

  it("writes the same limits to every target and drops deselected ones", async () => {
    const first = await call("PUT", "/policies/assign", ["agents:manage"], { settings, targets: [{ scopeKind: "role", scopeId: "analysts" }, { scopeKind: "pat", scopeId: patId }, { scopeKind: "default", scopeId: "*" }] });
    expect(first.status).toBe(200);
    const created = ((await first.json()) as { data: { policies: Array<{ id: string; scopeKind: string; dailyBytes: number; scopeLabel: string }> } }).data.policies;
    expect(created.map((p) => p.scopeLabel)).toEqual(["Analysts", "warehouse-bot · Agent Owner", "Every agent"]);
    expect(new Set(created.map((p) => p.dailyBytes))).toEqual(new Set([4096]));

    const tokenRow = created.find((p) => p.scopeKind === "pat")!;
    const second = await call("PUT", "/policies/assign", ["agents:manage"], { settings, targets: [{ scopeKind: "role", scopeId: "analysts" }], removeIds: created.map((p) => p.id) });
    expect(second.status).toBe(200);
    const listed = ((await (await call("GET", "/policies", ["agents:view"])).json()) as { data: { policies: Array<{ id: string; scopeKind: string }> } }).data.policies;
    expect(listed.map((p) => p.scopeKind)).toEqual(["role"]);
    expect(listed.some((p) => p.id === tokenRow.id)).toBe(false);
  });

  it("validates every target before writing any", async () => {
    const before = ((await (await call("GET", "/policies", ["agents:view"])).json()) as { data: { policies: unknown[] } }).data.policies.length;
    const res = await call("PUT", "/policies/assign", ["agents:manage"], { settings, targets: [{ scopeKind: "pat", scopeId: patId }, { scopeKind: "role", scopeId: "ghost" }] });
    expect(res.status).toBe(400);
    const after = ((await (await call("GET", "/policies", ["agents:view"])).json()) as { data: { policies: unknown[] } }).data.policies.length;
    expect(after).toBe(before);
  });

  it("needs agents:manage and at least one target", async () => {
    expect((await call("PUT", "/policies/assign", ["agents:view"], { settings, targets: [{ scopeKind: "default", scopeId: "*" }] })).status).toBe(403);
    expect((await call("PUT", "/policies/assign", ["agents:manage"], { settings, targets: [] })).status).toBe(400);
  });
});

describe("session roles and policy", () => {
  it("shows the user's roles and the role policy that governs the session", async () => {
    await rawRun(sql`INSERT OR IGNORE INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES ('ur-1', ${USER}, 'role-analysts', unixepoch())`);
    const res = await call("GET", "/sessions", ["agents:view"]);
    const { data } = (await res.json()) as { data: { sessions: Array<{ source: string; roles: Array<{ name: string; label: string }>; policy: { source: string; label: string; dailyBytes: number | null } }> } };
    const pat = data.sessions.find((s) => s.source === "pat")!;
    expect(pat.roles).toEqual([{ name: "analysts", label: "Analysts" }]);
    expect(pat.policy).toEqual({ source: "role", label: "Analysts", dailyBytes: 4096 });
  });
});
