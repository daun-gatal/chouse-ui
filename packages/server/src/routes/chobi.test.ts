/**
 * /api/chobi (ADR 0025 §6): the briefing is built from the viewer's own reads
 * and cached per viewer; organization settings are readable by every chat
 * user and changed only with ai_agents:manage, with an audit entry.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import * as h from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { registerInProcessApi } from "../services/ai/registry/inProcessApi";
import { resetChobiSettingsCache } from "../services/chobi/settings";
import chobi, { resetBriefingCache } from "./chobi";

const ALICE = "chobi-alice";
const BOB = "chobi-bob";
const reads: Array<{ path: string; auth: string | undefined }> = [];

async function token(sub: string, permissions: string[]): Promise<string> {
  return generateAccessToken({ sub, email: `${sub}@test.local`, username: sub, roles: ["custom"], permissions, sessionId: "s1" });
}

function app(): Hono {
  const a = new Hono();
  a.onError(errorHandler);
  a.route("/chobi", chobi);
  return a;
}

async function call<T>(method: string, path: string, bearer: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await app().request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { data: T };
  return { status: res.status, data: json.data };
}

beforeAll(async () => {
  await h.freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  for (const id of [ALICE, BOB]) {
    await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at)
      VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
  }
  const api = new Hono();
  const record = (path: string) => (c: { req: { header: (n: string) => string | undefined } }) => {
    reads.push({ path, auth: c.req.header("Authorization") });
  };
  api.get("/api/rbac/connections/my", (c) => {
    record("/api/rbac/connections/my")(c);
    return c.json({ success: true, data: [{ id: "conn-1", name: "lab", metadata: null }] });
  });
  api.get("/api/fleet/snapshots", (c) => {
    record("/api/fleet/snapshots")(c);
    return c.json({ success: true, data: { connections: [] } });
  });
  api.get("/api/ai-actions/inbox", (c) => c.json({ success: true, data: { actions: [] } }));
  api.get("/api/ai-actions/activity", (c) => c.json({ success: true, data: { actions: [] } }));
  registerInProcessApi(api);
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

beforeEach(() => {
  reads.length = 0;
  resetBriefingCache();
  resetChobiSettingsCache();
});

describe("/api/chobi", () => {
  it("needs ai:chat for the briefing and reads as the caller", async () => {
    expect((await call("GET", "/chobi/briefing", await token(ALICE, []))).status).toBe(403);

    const bearer = await token(ALICE, ["ai:chat"]);
    const res = await call<{ connections: Array<{ id: string; status: string }>; unavailable: string[] }>("GET", "/chobi/briefing", bearer);
    expect(res.status).toBe(200);
    expect(res.data.connections).toEqual([expect.objectContaining({ id: "conn-1", status: "ok" })]);
    expect(res.data.unavailable).toContain("incidents (needs observe:view or data_health:view)");
    expect(reads.every((r) => r.auth === `Bearer ${bearer}`)).toBe(true);
  });

  it("caches a briefing per viewer, and refreshes on request", async () => {
    const alice = await token(ALICE, ["ai:chat"]);
    await call("GET", "/chobi/briefing", alice);
    const first = reads.length;
    await call("GET", "/chobi/briefing", alice);
    expect(reads.length).toBe(first);

    // Another user never gets Alice's briefing.
    await call("GET", "/chobi/briefing", await token(BOB, ["ai:chat"]));
    expect(reads.length).toBe(first * 2);

    await call("GET", "/chobi/briefing?fresh=1", alice);
    expect(reads.length).toBe(first * 3);
  });

  it("lets chat users read the settings and only AI admins change them, audited", async () => {
    const reader = await token(BOB, ["ai:chat"]);
    expect((await call("GET", "/chobi/settings", reader)).data).toMatchObject({ plainMode: false, nudges: true });
    expect((await call("PUT", "/chobi/settings", reader, { plainMode: true })).status).toBe(403);
    expect((await call("PUT", "/chobi/settings", await token(ALICE, ["ai_agents:manage"]), { colour: "red" })).status).toBe(400);

    const saved = await call<{ plainMode: boolean; nudges: boolean }>("PUT", "/chobi/settings", await token(ALICE, ["ai_agents:manage"]), { plainMode: true });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ plainMode: true, nudges: true });
    expect((await call("GET", "/chobi/settings", reader)).data).toMatchObject({ plainMode: true });

    const audit = await h.rawAll(sql`SELECT action, user_id, resource_type FROM rbac_audit_logs WHERE action = 'chobi.settings_update'`);
    expect(audit).toEqual([expect.objectContaining({ user_id: ALICE, resource_type: "chobi_settings" })]);
  });
});
