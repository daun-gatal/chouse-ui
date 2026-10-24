/**
 * /api/ai-memories (ADR 0024 §Phase 3): your own memories, team memories and
 * their review, who may change what, and the guardrail screen.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

type GuardrailDef = import("../services/ai/guardrails/types").GuardrailDef;
const pii: GuardrailDef = {
  id: "g-email", slug: "pii", name: "PII redaction", description: "", kind: "pattern",
  config: { detectors: ["email"], patterns: [], strategy: "placeholder" }, stages: ["tool_result"], action: "redact", mode: "enforce",
  scope: { agents: "all", features: "all", mcp: true }, position: 1, enabled: true, isSystem: true, seedHash: null, customized: false,
  version: 1, createdBy: null, createdAt: 0, updatedAt: 0,
};

mock.module("../services/ai/registry/cache", () => ({
  getRegistrySnapshot: async () => ({ version: 1, agents: new Map(), harnesses: new Map(), skills: new Map(), bindings: new Map(), guardrails: new Map([[pii.id, pii]]) }),
}));
// Data access: Alice reaches c1 only; the admin is a super admin (all connections).
mock.module("../rbac/services/connections", () => ({
  getUserConnections: async (userId: string) => (userId === "mem-alice" ? [{ id: "c1" }] : []),
}));

const { closeDatabase } = await import("../rbac/db");
const { runMigrations } = await import("../rbac/db/migrations");
const h = await import("../rbac/db/migrationTestHarness");
const { generateAccessToken } = await import("../rbac/services/jwt");
const { errorHandler } = await import("../middleware/error");
const { default: aiMemories } = await import("./ai-memories");

const ALICE = "mem-alice";
const BOB = "mem-bob";
const ADMIN = "mem-admin";

async function token(sub: string, permissions: string[], roles = ["custom"]): Promise<string> {
  return generateAccessToken({ sub, email: `${sub}@test.local`, username: sub, roles, permissions, sessionId: "s1" });
}

const app = new Hono();
app.onError(errorHandler);
app.route("/m", aiMemories);

async function call<T>(method: string, path: string, bearer: string, body?: unknown): Promise<{ status: number; data: T; error?: { message: string } }> {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { data: T; error?: { message: string } };
  return { status: res.status, data: json.data, error: json.error };
}

type View = { id: string; scope: string; status: string; content: string; canEdit: boolean; flag: string | null; connectionName: string | null; proposedByName: string | null; duplicate?: boolean };

let alice = "";
let bob = "";
let admin = "";

beforeAll(async () => {
  await h.freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  for (const id of [ALICE, BOB, ADMIN]) {
    await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, display_name, password_hash, is_active, created_at, updated_at)
      VALUES (${id}, ${`${id}@test.local`}, ${id}, ${id === ALICE ? "Alice" : null}, 'x', 1, unixepoch(), unixepoch())`);
  }
  for (const id of ["c1", "c2"]) {
    await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, created_at, updated_at) VALUES (${id}, ${`Cluster ${id}`}, 'localhost', 8123, 'default', unixepoch(), unixepoch())`);
  }
  alice = await token(ALICE, ["ai:chat"]);
  bob = await token(BOB, ["ai:chat"]);
  admin = await token(ADMIN, ["ai:chat", "ai_memories:manage"], ["super_admin"]);
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

describe("/api/ai-memories", () => {
  it("needs an AI permission", async () => {
    expect((await call("GET", "/m/mine", await token(ALICE, []))).status).toBe(403);
  });

  it("keeps your own memories private, editable and exportable", async () => {
    const created = await call<View>("POST", "/m", alice, { scope: "user", content: "Prefers UTC" });
    expect(created.data).toMatchObject({ scope: "user", status: "active", canEdit: true, duplicate: false });
    expect((await call<View>("POST", "/m", alice, { scope: "user", content: "prefers  utc" })).data.duplicate).toBe(true);
    const mine = await call<{ enabled: boolean; memories: View[] }>("GET", "/m/mine", alice);
    expect(mine.data.enabled).toBe(true);
    expect(mine.data.memories.map((m) => m.content)).toEqual(["Prefers UTC"]);
    // Bob can't see, edit or delete it.
    expect((await call<{ memories: View[] }>("GET", "/m/mine", bob)).data.memories).toEqual([]);
    expect((await call("PUT", `/m/${created.data.id}`, bob, { content: "hacked" })).status).toBe(404);
    expect((await call("DELETE", `/m/${created.data.id}`, bob)).status).toBe(404);
    const edited = await call<View>("PUT", `/m/${created.data.id}`, alice, { content: "Prefers UTC in all charts" });
    expect(edited.data.content).toBe("Prefers UTC in all charts");
    const exported = await call<{ memories: Array<{ content: string }> }>("GET", "/m/export", alice);
    expect(exported.data.memories.map((m) => m.content)).toEqual(["Prefers UTC in all charts"]);
    expect((await call("DELETE", `/m/${created.data.id}`, alice)).status).toBe(200);
    expect((await call<{ memories: View[] }>("GET", "/m/mine", alice)).data.memories).toEqual([]);
  });

  it("refuses personal data in your memory", async () => {
    const res = await call("POST", "/m", alice, { scope: "user", content: "My email is alice@example.com" });
    expect(res.status).toBe(400);
    expect(res.error?.message).toContain("PII redaction");
  });

  it("turns memory off and on", async () => {
    expect((await call<{ enabled: boolean }>("PUT", "/m/settings", alice, { enabled: false })).data.enabled).toBe(false);
    expect((await call<{ enabled: boolean }>("GET", "/m/mine", alice)).data.enabled).toBe(false);
    await call("PUT", "/m/settings", alice, { enabled: true });
  });

  it("reviews team proposals: proposer and managers see them, others see only approved notes", async () => {
    expect((await call("POST", "/m", alice, { scope: "connection", content: "No connection" })).status).toBe(400);
    expect((await call("POST", "/m", alice, { scope: "connection", connectionId: "c2", content: "Not my cluster" })).status).toBe(403);
    const proposed = await call<View>("POST", "/m", alice, { scope: "connection", connectionId: "c1", content: "sales.orders is append-only" });
    expect(proposed.data).toMatchObject({ status: "proposed", connectionName: "Cluster c1", proposedByName: "Alice", canEdit: true });
    const flagged = await call<View>("POST", "/m", alice, { scope: "connection", connectionId: "c1", content: "Page ops@example.com on failures" });
    expect(flagged.data.flag).toBe("Matched PII redaction");

    expect((await call<{ count: number }>("GET", "/m/pending-count", alice)).data.count).toBe(0);
    expect((await call<{ count: number }>("GET", "/m/pending-count", admin)).data.count).toBe(2);
    expect((await call("POST", `/m/${proposed.data.id}/approve`, alice)).status).toBe(403);
    // Bob reaches no connection, so he sees nothing; Alice sees her proposals.
    expect((await call<{ memories: View[] }>("GET", "/m/team", bob)).data.memories).toEqual([]);
    expect((await call<{ memories: View[] }>("GET", "/m/team?connectionId=c1", alice)).data.memories).toHaveLength(2);

    const approved = await call<View>("POST", `/m/${proposed.data.id}/approve`, admin);
    expect(approved.data.status).toBe("active");
    expect(approved.data.canEdit).toBe(true);
    expect((await call("POST", `/m/${proposed.data.id}/reject`, admin)).status).toBe(409);
    // Once reviewed, the proposer can no longer change it.
    expect((await call("PUT", `/m/${proposed.data.id}`, alice, { content: "changed" })).status).toBe(403);
    expect((await call<View>("POST", `/m/${flagged.data.id}/reject`, admin)).data.status).toBe("rejected");

    const forTable = await call<{ memories: View[] }>("GET", "/m/for-table?connectionId=c1&database=sales&table=orders", alice);
    expect(forTable.data.memories.map((m) => m.content)).toEqual(["sales.orders is append-only"]);
    expect((await call("GET", "/m/for-table?connectionId=c2&database=sales&table=orders", alice)).status).toBe(403);
  });

  it("saves a manager's own team note directly", async () => {
    const res = await call<View>("POST", "/m", admin, { scope: "connection", connectionId: "c2", content: "c2 is the staging cluster" });
    expect(res.data.status).toBe("active");
    const all = await call<{ canManage: boolean; memories: View[] }>("GET", "/m/team", admin);
    expect(all.data.canManage).toBe(true);
    expect(all.data.memories.some((m) => m.content === "c2 is the staging cluster")).toBe(true);
    expect((await call("DELETE", `/m/${res.data.id}`, admin)).status).toBe(200);
  });
});
