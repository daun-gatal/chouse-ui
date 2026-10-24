/** /api/ai-triage (ADR 0024 §Phase 4): rules, validation, permissions and runs. */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import * as h from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { syncRegistrySeeds } from "../services/ai/registry/seedSync";
import { claimRun, finishRun } from "../services/ai/triage/store";
import aiTriage from "./ai-triage";

const ADMIN = "triage-admin";
const VIEWER = "triage-viewer";

async function token(sub: string, permissions: string[]): Promise<string> {
  return generateAccessToken({ sub, email: `${sub}@test.local`, username: sub, roles: ["custom"], permissions, sessionId: "s1" });
}

const app = new Hono();
app.onError(errorHandler);
app.route("/t", aiTriage);

async function call<T>(method: string, path: string, bearer: string, body?: unknown): Promise<{ status: number; data: T; error?: { message: string } }> {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { data: T; error?: { message: string } };
  return { status: res.status, data: json.data, error: json.error };
}

type Rules = { canManage: boolean; defaultAgentId: string | null; rules: Array<{ trigger: string; label: string; enabled: boolean; tokensToday: number; updatedByName: string | null }>; channels: Array<{ id: string; name: string }>; agents: Array<{ id: string; name: string }> };

let admin = "";
let viewer = "";

beforeAll(async () => {
  await h.freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  await syncRegistrySeeds();
  for (const id of [ADMIN, VIEWER]) {
    await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, display_name, password_hash, is_active, created_at, updated_at)
      VALUES (${id}, ${`${id}@test.local`}, ${id}, ${id === ADMIN ? "Ada Admin" : null}, 'x', 1, unixepoch(), unixepoch())`);
  }
  await h.rawRun(sql`INSERT INTO notification_channels (id, name, type, config, enabled) VALUES ('ch1', 'Ops webhook', 'webhook', '{}', 1)`);
  admin = await token(ADMIN, ["ai_agents:view", "ai_agents:manage"]);
  viewer = await token(VIEWER, ["ai_agents:view"]);
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

describe("/api/ai-triage", () => {
  it("lists every trigger off, with the channels and agents to pick", async () => {
    const res = await call<Rules>("GET", "/t/rules", viewer);
    expect(res.status).toBe(200);
    expect(res.data.canManage).toBe(false);
    expect(res.data.rules.map((r) => r.label)).toEqual(["Data Health incident", "Observe incident", "Fleet alert", "Failed scheduled run", "Doctor report with findings"]);
    expect(res.data.rules.every((r) => !r.enabled && r.tokensToday === 0)).toBe(true);
    expect(res.data.channels.map((c) => c.name)).toEqual(["Ops webhook"]);
    expect(res.data.defaultAgentId).toBe("builtin-agent-incident-triager");
    expect(res.data.agents.some((a) => a.name === "Incident Triager")).toBe(true);
    expect((await call("GET", "/t/rules", await token("nobody", [])))).toMatchObject({ status: 403 });
  });

  it("lets a manager turn a trigger on, and validates what it picks", async () => {
    const body = { enabled: true, agentId: null, cooldownMinutes: 30, dailyTokenBudget: 50_000, channelIds: ["ch1"] };
    expect((await call("PUT", "/t/rules/observe_incident", viewer, body)).status).toBe(403);
    expect((await call("PUT", "/t/rules/nope", admin, body)).status).toBe(404);
    expect((await call("PUT", "/t/rules/observe_incident", admin, { ...body, agentId: "missing" })).status).toBe(400);
    expect((await call("PUT", "/t/rules/observe_incident", admin, { ...body, channelIds: ["gone"] })).status).toBe(400);
    expect((await call("PUT", "/t/rules/observe_incident", admin, { ...body, dailyTokenBudget: 10 })).status).toBe(400);
    const saved = await call<{ enabled: boolean; proposeAs: string; watermark: number }>("PUT", "/t/rules/observe_incident", admin, body);
    expect(saved.data).toMatchObject({ enabled: true, proposeAs: ADMIN });
    expect(saved.data.watermark).toBeGreaterThan(0);
    const rules = await call<Rules>("GET", "/t/rules", admin);
    expect(rules.data.canManage).toBe(true);
    expect(rules.data.rules.find((r) => r.trigger === "observe_incident")).toMatchObject({ enabled: true, updatedByName: "Ada Admin" });
  });

  it("lists runs and finds the run for one subject", async () => {
    const run = await claimRun({ trigger: "observe_incident", id: "inc-1", title: "Kafka lag", connectionId: null });
    await finishRun(run!.id, { status: "completed", summary: "Lag from a stuck consumer", tokens: 900 });
    const runs = await call<{ runs: Array<{ subjectId: string; summary: string }>; total: number }>("GET", "/t/runs?trigger=observe_incident", viewer);
    expect(runs.data.total).toBe(1);
    expect(runs.data.runs[0]).toMatchObject({ subjectId: "inc-1", summary: "Lag from a stuck consumer" });
    // People who can see incidents see the badge, without ai_agents:view.
    const observer = await token("observer", ["observe:view"]);
    const forSubject = await call<{ status: string } | null>("GET", "/t/runs/for-subject?trigger=observe_incident&subjectId=inc-1", observer);
    expect(forSubject.data?.status).toBe("completed");
    expect((await call<null>("GET", "/t/runs/for-subject?trigger=observe_incident&subjectId=other", observer)).data).toBeNull();
    expect((await call("GET", "/t/runs", observer)).status).toBe(403);
  });
});
