/** /api/ai-evals and the eval gate on agent saves (ADR 0024 §Phase 6). */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import * as h from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { addMessage, createThread } from "../services/chatHistory";
import { syncRegistrySeeds } from "../services/ai/registry/seedSync";
import { loadSnapshot } from "../services/ai/registry/store";
import { agentDraftHash } from "../services/ai/evals/scoring";
import { createRun, finishRun } from "../services/ai/evals/store";
import { normalizedAgent } from "../services/ai/registry/schemas";
import aiEvals from "./ai-evals";
import aiAgents from "./ai-agents";

const AGENT = "builtin-agent-clickhouse-data";
const ADMIN = "evals-admin";

const app = new Hono();
app.onError(errorHandler);
app.route("/e", aiEvals);
app.route("/a", aiAgents);

let admin = "";
let viewer = "";

async function call<T>(method: string, path: string, bearer: string, body?: unknown): Promise<{ status: number; data: T; error?: { message: string; code?: string } }> {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { data: T; error?: { message: string; code?: string } };
  return { status: res.status, data: json.data, error: json.error };
}

const chatCase = { name: "Counts tables", kind: "chat", input: { messages: [{ role: "user", content: "How many tables?" }] }, expectedTools: ["list_tables"], rubric: "Gives a number" };

beforeAll(async () => {
  await h.freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  await syncRegistrySeeds();
  await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${ADMIN}, 'e@test.local', 'evals', 'x', 1, unixepoch(), unixepoch())`);
  admin = await generateAccessToken({ sub: ADMIN, email: "e@test.local", username: "evals", roles: ["custom"], permissions: ["ai_agents:view", "ai_agents:manage"], sessionId: "s1" });
  viewer = await generateAccessToken({ sub: "viewer", email: "v@test.local", username: "viewer", roles: ["custom"], permissions: ["ai_agents:view"], sessionId: "s1" });
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

describe("/api/ai-evals cases", () => {
  it("adds a valid case and lists it; viewers can read, not write", async () => {
    expect((await call("POST", `/e/agents/${AGENT}/cases`, viewer, chatCase)).status).toBe(403);
    const created = await call<{ id: string; source: string }>("POST", `/e/agents/${AGENT}/cases?source=console`, admin, chatCase);
    expect(created.status).toBe(201);
    expect(created.data.source).toBe("console");
    const listed = await call<{ cases: Array<{ id: string }>; runs: unknown[]; maxCases: number }>("GET", `/e/agents/${AGENT}`, viewer);
    expect(listed.data.cases.map((c) => c.id)).toEqual([created.data.id]);
    expect(listed.data.maxCases).toBe(50);
    expect((await call("GET", "/e/agents/missing", viewer)).status).toBe(404);
  });

  it("refuses a chat case that does not end with the user, and a feature case with a bad input", async () => {
    const ending = await call("POST", `/e/agents/${AGENT}/cases`, admin, { ...chatCase, input: { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] } });
    expect(ending.status).toBe(400);
    const unknown = await call("POST", `/e/agents/${AGENT}/cases`, admin, { ...chatCase, kind: "feature", featureId: "nope", input: {} });
    expect(unknown.status).toBe(400);
    const badInput = await call("POST", `/e/agents/${AGENT}/cases`, admin, { ...chatCase, kind: "feature", featureId: "debug-query", input: { query: "SELECT 1" } });
    expect(badInput.status).toBe(400);
    expect(badInput.error?.message).toContain("error");
    const good = await call<{ kind: string; featureId: string }>("POST", `/e/agents/${AGENT}/cases`, admin, { ...chatCase, kind: "feature", featureId: "debug-query", input: { query: "SELEC 1", error: "Syntax error" } });
    expect(good.data).toMatchObject({ kind: "feature", featureId: "debug-query" });
    expect((await call("DELETE", `/e/cases/${(good.data as unknown as { id: string }).id}`, admin)).status).toBe(200);
  });

  it("edits and deletes a case", async () => {
    const created = await call<{ id: string }>("POST", `/e/agents/${AGENT}/cases`, admin, { ...chatCase, name: "Temp" });
    const edited = await call<{ name: string; rubric: string | null }>("PUT", `/e/cases/${created.data.id}`, admin, { ...chatCase, name: "Temp, edited", rubric: null });
    expect(edited.data).toMatchObject({ name: "Temp, edited", rubric: null });
    expect((await call("DELETE", `/e/cases/${created.data.id}`, admin)).status).toBe(200);
    expect((await call("PUT", `/e/cases/${created.data.id}`, admin, chatCase)).status).toBe(404);
  });

  it("saves a chat request from AI activity as a case, and explains why a feature request can't be", async () => {
    const thread = await createThread(ADMIN, "t");
    await addMessage(thread.id, "user", "Which tables are biggest?\n\n[attached: sizes.csv]");
    await addMessage(thread.id, "assistant", "orders and events", [{ name: "list_tables", args: {} }, { name: "get_table_size", args: {} }, { name: "list_tables", args: {} }]);
    const at = Date.now();
    await h.rawRun(sql`INSERT INTO ai_usage_requests (id, started_at, user_id, thread_id, feature_id, agent_id, source, status) VALUES
      ('req-chat', ${at}, ${ADMIN}, ${thread.id}, 'chat', ${AGENT}, 'chat', 'ok'),
      ('req-feature', ${at}, ${ADMIN}, NULL, 'debug-query', ${AGENT}, 'feature', 'ok'),
      ('req-other', ${at}, 'someone-else', ${thread.id}, 'chat', ${AGENT}, 'chat', 'ok')`);
    const saved = await call<{ name: string; input: unknown; expectedTools: string[]; source: string }>("POST", "/e/cases/from-request", admin, { requestId: "req-chat" });
    expect(saved.status).toBe(201);
    expect(saved.data).toMatchObject({ name: "Which tables are biggest?", input: { messages: [{ role: "user", content: "Which tables are biggest?" }] }, expectedTools: ["list_tables", "get_table_size"], source: "request" });
    const feature = await call("POST", "/e/cases/from-request", admin, { requestId: "req-feature" });
    expect(feature.status).toBe(400);
    expect(feature.error?.message).toContain("features don't keep their input");
    // Someone else's request is not found without ai_usage:view.
    expect((await call("POST", "/e/cases/from-request", admin, { requestId: "req-other" })).status).toBe(404);
  });
});

describe("eval gate on saving an agent", () => {
  async function agentBody(threshold: number | null, prompt?: string): Promise<Record<string, unknown>> {
    const agent = (await loadSnapshot()).agents.get(AGENT)!;
    return {
      slug: agent.slug, name: agent.name, description: agent.description, kind: agent.kind, systemPrompt: prompt ?? agent.systemPrompt, taskTemplate: agent.taskTemplate,
      modelConfigId: agent.modelConfigId, harnessId: agent.harnessId, tuning: { ...agent.tuning, evalThreshold: threshold }, requiredPermissions: agent.requiredPermissions,
      tools: agent.tools, skills: agent.skills, subagents: agent.subagents, enabled: agent.enabled, version: agent.version,
    };
  }

  it("saves freely without a threshold", async () => {
    const res = await call("PUT", `/a/agents/${AGENT}`, admin, await agentBody(null, "Be precise."));
    expect(res.status).toBe(200);
  });

  it("refuses an unscored or failing draft and saves one that passed", async () => {
    const body = await agentBody(0.8, "Be precise and brief.");
    const unscored = await call("PUT", `/a/agents/${AGENT}`, admin, body);
    expect(unscored.status).toBe(409);
    expect(unscored.error).toMatchObject({ code: "EVALS_REQUIRED" });
    expect(unscored.error?.message).toContain("Run the evals for this draft first");

    const { version: _version, ...draft } = body;
    const hash = agentDraftHash(normalizedAgent(draft as never) as unknown as Record<string, unknown>);
    const gate = await call<{ required: boolean; passing: boolean; cases: number }>("POST", `/e/agents/${AGENT}/gate`, viewer, { agent: draft });
    expect(gate.data).toMatchObject({ required: true, passing: false, cases: 2 });

    const cases = (await call<{ cases: Array<{ id: string; name: string }> }>("GET", `/e/agents/${AGENT}`, viewer)).data.cases;
    const result = (id: string, passed: boolean) => ({ caseId: id, name: id, passed, toolsOk: null, missingTools: [], calledTools: [], judge: null, answer: "", error: null, durationMs: 1 });
    const failing = await createRun(AGENT, hash, cases.length, ADMIN);
    await finishRun(failing.id, { status: "completed", results: cases.map((c, i) => result(c.id, i === 0)), regressions: [], tokens: 0, costUsd: null });
    const low = await call("PUT", `/a/agents/${AGENT}`, admin, body);
    expect(low.status).toBe(409);
    expect(low.error?.message).toContain("passed 50% of its evals");

    await Bun.sleep(3);
    const passing = await createRun(AGENT, hash, cases.length, ADMIN);
    await finishRun(passing.id, { status: "completed", results: cases.map((c) => result(c.id, true)), regressions: [], tokens: 0, costUsd: null });
    expect((await call<{ passing: boolean }>("POST", `/e/agents/${AGENT}/gate`, viewer, { agent: draft })).data.passing).toBe(true);
    expect((await call("PUT", `/a/agents/${AGENT}`, admin, body)).status).toBe(200);
  });
});
