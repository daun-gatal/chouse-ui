/**
 * /api/ai-usage against a real RBAC database on SQLite and PostgreSQL (ADR 0020):
 * who sees what, the aggregates the AI activity tab shows, search, and the
 * request detail.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase, getDatabaseType } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import * as h from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { UsageRun, writeUsageRun, type ModelRef, type UsageCaller } from "../services/ai/usage";
import aiUsage, { originParam, windowDays } from "./ai-usage";

const DIALECTS: h.Dialect[] = ["sqlite", "postgres"];
const ADMIN = "usage-admin";
const ALICE = "usage-alice";
const BOB = "usage-bob";
const PRICED: ModelRef = { modelConfigId: "model-priced", providerType: "anthropic", modelId: "claude-sonnet", pricing: { input: 3, output: 15 } };
const UNPRICED: ModelRef = { modelConfigId: "model-unpriced", providerType: "openai", modelId: "gpt-x", pricing: null };

let pg: h.PostgresContainer | undefined;

beforeAll(async () => {
  pg = await h.startPostgresContainer();
}, 180_000);

afterAll(async () => {
  await closeDatabase();
  pg?.stop();
}, 30_000);

async function token(sub: string, permissions: string[]): Promise<string> {
  return generateAccessToken({ sub, email: `${sub}@test.local`, username: sub, roles: ["custom"], permissions, sessionId: "s1" });
}

function app(): Hono {
  const a = new Hono();
  a.onError(errorHandler);
  a.route("/ai-usage", aiUsage);
  return a;
}

async function get<T>(path: string, bearer: string): Promise<{ status: number; data: T }> {
  const res = await app().request(path, { headers: { Authorization: `Bearer ${bearer}` } });
  const body = (await res.json()) as { data: T };
  return { status: res.status, data: body.data };
}

const now = (): number => Date.now();

/** A finished run: one priced or unpriced LLM call, and optionally a tool step that read and sent data. */
async function seedRun(options: {
  userId: string;
  model: ModelRef;
  agent: string;
  startedAt: number;
  input: number;
  output: number;
  table?: string;
  rows?: number;
  status?: "ok" | "error";
  chouse?: string;
  source?: "chat" | "feature" | "background";
  caller?: UsageCaller | null;
}): Promise<string> {
  let t = options.startedAt;
  const run = new UsageRun({
    featureId: "chat", source: options.source ?? "chat", userId: options.userId, connectionId: "conn-1",
    threadId: `thread-${options.userId}`, caller: options.caller,
  }, () => t);
  run.setAgent({ id: `agent-${options.agent}`, slug: options.agent, name: `Agent ${options.agent}` });
  const llm = run.beginLlm(options.model, options.agent);
  t += 100;
  run.endLlm(llm, { input: options.input, output: options.output, cacheRead: 0, cacheWrite: 0 });
  if (options.table) {
    const tool = run.beginTool("run_select_query", options.agent, { model: options.model, connectionId: "conn-1", defaultDatabase: "default" });
    tool.observer.onQuery({
      queryId: `${run.id}-q`, sql: `SELECT id, email FROM ${options.table}`, elapsedMs: 5,
      readRows: 1_000, readBytes: 50_000, resultRows: options.rows ?? 10, resultBytes: 300, columns: ["id", "email"],
    });
    tool.end({ result: "[]" });
  }
  if (options.chouse) {
    const tool = run.beginTool("list_users", options.agent, { model: options.model, connectionId: null, defaultDatabase: null });
    tool.addChouseSource(options.chouse, [{ username: "a" }, { username: "b" }]);
    tool.end({ result: [] });
  }
  t += 50;
  run.finish(options.status ?? "ok", options.status === "error" ? new Error("boom") : undefined);
  await writeUsageRun(run);
  return run.id;
}

for (const dialect of DIALECTS) {
  describe(`/api/ai-usage [${dialect}]`, () => {
    let adminToken = "";
    let aliceToken = "";
    let nobodyToken = "";
    let aliceRequest = "";
    let bobRequest = "";
    let mcpRequest = "";
    let tokenRequest = "";
    let backgroundRequest = "";

    beforeAll(async () => {
      process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
      process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
      await h.freshDatabase(dialect, pg);
      await runMigrations();
      const ts = getDatabaseType() === "sqlite" ? sql`unixepoch()` : sql`NOW()`;
      const active = getDatabaseType() === "sqlite" ? 1 : true;
      for (const [id, name, display] of [[ALICE, "alice", "Alice Doe"], [BOB, "bob", null], [ADMIN, "admin2", null]] as const) {
        await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, display_name, password_hash, is_active, created_at, updated_at)
          VALUES (${id}, ${`${name}@test.local`}, ${name}, ${display}, 'x', ${active}, ${ts}, ${ts})`);
      }
      await h.rawRun(sql`INSERT INTO rbac_ai_providers (id, name, provider_type, is_active, created_at, updated_at) VALUES ('prov', 'P', 'openai', ${active}, ${ts}, ${ts})`);
      await h.rawRun(sql`INSERT INTO rbac_ai_models (id, provider_id, name, model_id, pricing, created_at, updated_at)
        VALUES ('model-priced', 'prov', 'Sonnet', 'claude-sonnet', ${JSON.stringify(PRICED.pricing)}, ${ts}, ${ts})`);
      await h.rawRun(sql`INSERT INTO rbac_ai_models (id, provider_id, name, model_id, created_at, updated_at)
        VALUES ('model-unpriced', 'prov', 'GPT X', 'gpt-x', ${ts}, ${ts})`);

      aliceRequest = await seedRun({ userId: ALICE, model: PRICED, agent: "sql-assistant", startedAt: now() - 3_600_000, input: 1_000_000, output: 100_000, table: "crm.customers", rows: 25 });
      bobRequest = await seedRun({ userId: BOB, model: UNPRICED, agent: "ai-sre", startedAt: now() - 7_200_000, input: 2_000, output: 300, table: "sales.orders", rows: 7, chouse: "Audit log", status: "error" });
      // Outside a 1-day window, inside 7 days.
      await seedRun({ userId: ALICE, model: PRICED, agent: "sql-assistant", startedAt: now() - 3 * 86_400_000, input: 10, output: 10 });
      // Outside 7 days: requests an MCP agent, a token caller and a scheduler started.
      await h.rawRun(sql`INSERT INTO rbac_api_keys (id, user_id, name, key_hash, key_prefix, scopes, created_at)
        VALUES ('pat-ci', ${BOB}, 'ci-agent', 'hash-ci', 'ch_pat_ci', ${sql.raw("'[]'")}, ${ts})`);
      mcpRequest = await seedRun({
        userId: BOB, model: PRICED, agent: "sql-optimizer", source: "feature", startedAt: now() - 10 * 86_400_000, input: 1_000_000, output: 0,
        caller: { origin: "mcp", patId: "pat-ci", clientName: "Claude Code" },
      });
      tokenRequest = await seedRun({
        userId: BOB, model: UNPRICED, agent: "sql-optimizer", source: "feature", startedAt: now() - 11 * 86_400_000, input: 100, output: 10,
        caller: { origin: "token", patId: "pat-deleted", clientName: "chouse CLI" },
      });
      backgroundRequest = await seedRun({ userId: ADMIN, model: UNPRICED, agent: "doctor", source: "background", startedAt: now() - 12 * 86_400_000, input: 5, output: 5, caller: null });

      adminToken = await token(ADMIN, ["ai_usage:view"]);
      aliceToken = await token(ALICE, ["ai:chat"]);
      nobodyToken = await token("usage-nobody", []);
    }, 60_000);

    it("refuses users without any AI permission", async () => {
      expect((await get("/ai-usage/summary", nobodyToken)).status).toBe(403);
    });

    it("summarizes everyone's usage for ai_usage:view", async () => {
      const { status, data } = await get<Record<string, unknown>>("/ai-usage/summary?days=1", adminToken);
      expect(status).toBe(200);
      expect(data).toMatchObject({
        scope: "all", days: 1, requests: 2, failedRequests: 1, users: 2, llmCalls: 2,
        inputTokens: 1_002_000, outputTokens: 100_300, unpricedCalls: 1, incompleteCalls: 0,
        chQueries: 2, chReadBytes: 100_000, egressRows: 25 + 7 + 2, egressSources: 3,
      });
      // Only Alice's call is priced: 1M × $3 + 100k × $15.
      expect(data.costUsd as number).toBeCloseTo(4.5, 6);
      expect(data.unpricedModels).toEqual([{ modelConfigId: "model-unpriced", name: "GPT X", providerType: "openai", calls: 1 }]);
    });

    it("shows a chat user only their own requests", async () => {
      const { data } = await get<Record<string, unknown>>("/ai-usage/summary?days=7", aliceToken);
      expect(data).toMatchObject({ scope: "own", requests: 2, users: 1, unpricedModels: [] });
      const list = await get<{ requests: Array<{ id: string; userId: string }>; total: number }>("/ai-usage/requests?days=7", aliceToken);
      expect(list.data.total).toBe(2);
      expect(list.data.requests.every((r) => r.userId === ALICE)).toBe(true);
      expect((await get("/ai-usage/requests/" + bobRequest, aliceToken)).status).toBe(404);
      expect((await get("/ai-usage/requests/" + aliceRequest, aliceToken)).status).toBe(200);
    });

    it("lists requests newest first with names, and pages", async () => {
      const { data } = await get<{ requests: Array<Record<string, unknown>>; total: number }>("/ai-usage/requests?days=7&limit=2", adminToken);
      expect(data.total).toBe(3);
      expect(data.requests.map((r) => r.id)).toEqual([aliceRequest, bobRequest]);
      expect(data.requests[0]).toMatchObject({ userName: "Alice Doe", agentName: "Agent sql-assistant", status: "ok", egressRows: 25 });
      expect(data.requests[1]).toMatchObject({ userName: "bob", status: "error", error: "boom", costUsd: null });
      const page2 = await get<{ requests: Array<Record<string, unknown>> }>("/ai-usage/requests?days=7&limit=2&offset=2", adminToken);
      expect(page2.data.requests).toHaveLength(1);
    });

    it("searches by user, agent and data source, with LIKE wildcards taken literally", async () => {
      const ids = async (q: string): Promise<string[]> =>
        (await get<{ requests: Array<{ id: string }> }>(`/ai-usage/requests?days=1&q=${encodeURIComponent(q)}`, adminToken)).data.requests.map((r) => r.id);
      expect(await ids("alice")).toEqual([aliceRequest]);
      expect(await ids("SRE")).toEqual([bobRequest]);
      expect(await ids("crm.cust")).toEqual([aliceRequest]);
      expect(await ids("audit")).toEqual([bobRequest]);
      expect(await ids("%")).toEqual([]);
      expect(await ids("_")).toEqual([]);
    });

    it("aggregates data sent by source with columns, users and providers", async () => {
      const { data } = await get<{ sources: Array<Record<string, unknown>> }>("/ai-usage/egress?days=1", adminToken);
      expect(data.sources.map((s) => [s.kind, s.source, s.rows])).toEqual([
        ["clickhouse", "crm.customers", 25],
        ["clickhouse", "sales.orders", 7],
        ["chouse", "Audit log", 2],
      ]);
      expect(data.sources[0]).toMatchObject({ columns: ["id", "email"], users: 1, requests: 1, providers: ["anthropic"], connectionIds: ["conn-1"] });
      expect(data.sources[2]).toMatchObject({ columns: ["username"], connectionIds: [] });
    });

    it("searches sources on the server and says how many match", async () => {
      const all = await get<{ sources: Array<{ source: string }>; total: number; limit: number }>("/ai-usage/egress?days=1", adminToken);
      expect(all.data).toMatchObject({ total: 3, limit: 100 });
      const found = await get<{ sources: Array<{ source: string }>; total: number }>("/ai-usage/egress?days=1&q=ORDERS", adminToken);
      expect(found.data.total).toBe(1);
      expect(found.data.sources.map((s) => s.source)).toEqual(["sales.orders"]);
      const none = await get<{ sources: unknown[]; total: number }>("/ai-usage/egress?days=1&q=%25", adminToken);
      expect(none.data).toMatchObject({ sources: [], total: 0 });
    });

    it("breaks usage down by model", async () => {
      const { data } = await get<{ models: Array<Record<string, unknown>> }>("/ai-usage/models?days=1", adminToken);
      expect(data.models).toHaveLength(2);
      expect(data.models[0]).toMatchObject({ modelConfigId: "model-priced", name: "Sonnet", hasPrice: true, calls: 1, requests: 1, inputTokens: 1_000_000 });
      expect(data.models[0].costUsd as number).toBeCloseTo(4.5, 6);
      expect(data.models[1]).toMatchObject({ modelConfigId: "model-unpriced", name: "GPT X", hasPrice: false, costUsd: null });
    });

    it("returns a request with its steps, queries, egress and connection names", async () => {
      await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, created_at, updated_at)
        VALUES ('conn-1', 'prod-eu', 'ch', 8123, 'u', ${getDatabaseType() === "sqlite" ? sql`unixepoch()` : sql`NOW()`}, ${getDatabaseType() === "sqlite" ? sql`unixepoch()` : sql`NOW()`})`);
      const { status, data } = await get<{ request: Record<string, unknown>; steps: Array<Record<string, unknown>>; egress: Array<Record<string, unknown>>; connections: Record<string, string> }>(`/ai-usage/requests/${bobRequest}`, adminToken);
      expect(status).toBe(200);
      expect(data.request).toMatchObject({ id: bobRequest, status: "error", unpricedCalls: 1, threadId: `thread-${BOB}` });
      expect(data.steps[0].calls).toEqual([]);
      expect(data.steps[1].calls).toBeNull();
      expect(data.steps.map((s) => [s.kind, s.name, s.status])).toEqual([
        ["llm", "gpt-x", "ok"],
        ["tool", "run_select_query", "ok"],
        ["tool", "list_users", "ok"],
      ]);
      expect(data.steps[1].queries).toEqual([expect.objectContaining({ tables: ["sales.orders"], readBytes: 50_000, connectionId: "conn-1" })]);
      expect(data.egress).toHaveLength(2);
      expect(data.connections).toEqual({ "conn-1": "prod-eu" });
      expect((await get("/ai-usage/requests/missing", adminToken)).status).toBe(404);
    });

    it("breaks usage down by who started it", async () => {
      const { data } = await get<{ byOrigin: Array<Record<string, unknown>> }>("/ai-usage/summary?days=30", adminToken);
      const byOrigin = Object.fromEntries(data.byOrigin.map((o) => [o.origin, o]));
      // Requests recorded without a caller (the first three) predate origin tracking.
      expect(byOrigin.unknown).toMatchObject({ requests: 3 });
      expect(byOrigin.mcp).toMatchObject({ requests: 1, inputTokens: 1_000_000 });
      expect(byOrigin.mcp.costUsd as number).toBeCloseTo(3, 6);
      expect(byOrigin.token).toMatchObject({ requests: 1, costUsd: null });
      expect(byOrigin.background).toMatchObject({ requests: 1 });
      expect(data.byOrigin[0].origin).toBe("unknown");
    });

    it("lists the origin, token and client of each request, and filters by origin", async () => {
      const list = async (query: string): Promise<Array<Record<string, unknown>>> =>
        (await get<{ requests: Array<Record<string, unknown>> }>(`/ai-usage/requests?days=30&${query}`, adminToken)).data.requests;
      const mcp = await list("origin=mcp");
      expect(mcp.map((r) => r.id)).toEqual([mcpRequest]);
      expect(mcp[0]).toMatchObject({ origin: "mcp", patId: "pat-ci", patName: "ci-agent", clientName: "Claude Code" });
      const token = await list("origin=token");
      expect(token.map((r) => r.id)).toEqual([tokenRequest]);
      // The token was deleted: its id stays, its name is gone.
      expect(token[0]).toMatchObject({ origin: "token", patId: "pat-deleted", patName: null, clientName: "chouse CLI" });
      expect((await list("origin=background")).map((r) => r.id)).toEqual([backgroundRequest]);
      expect(await list("origin=ui")).toEqual([]);
      expect((await list("q=ci-agent")).map((r) => r.id)).toEqual([mcpRequest]);
      expect((await list("q=chouse%20cli")).map((r) => r.id)).toEqual([tokenRequest]);
      const detail = await get<{ request: Record<string, unknown> }>(`/ai-usage/requests/${mcpRequest}`, adminToken);
      expect(detail.data.request).toMatchObject({ origin: "mcp", patName: "ci-agent" });
      expect((await get(`/ai-usage/requests?origin=browser`, adminToken)).status).toBe(400);
      expect(originParam(undefined)).toBeUndefined();
      expect(originParam("")).toBeUndefined();
      expect(originParam("token")).toBe("token");
    });

    it("clamps the window to retention and rejects nonsense", async () => {
      expect(windowDays("90", 30)).toBe(30);
      expect(windowDays("0", 30)).toBe(1);
      expect(windowDays(undefined, 30)).toBe(7);
      expect((await get("/ai-usage/summary?days=abc", adminToken)).status).toBe(400);
    });
  });
}
