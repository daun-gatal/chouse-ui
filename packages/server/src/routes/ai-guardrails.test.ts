/**
 * /api/ai-guardrails (ADR 0022) against a real in-memory RBAC database:
 * permission gates, CRUD with versions, the sample test, the AI draft (model
 * call faked, real prepare and finalize), and guardrails on MCP tool results.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import type { AgentRunContext, AnyStructuredCapability } from "../services/ai/types";

let draftAnswer: unknown = null;
const realAiConfig = await import("../services/aiConfig");
mock.module("../services/aiConfig", () => ({ ...realAiConfig, isAIEnabled: async () => true }));
const realEngine = await import("../services/ai/engine");
mock.module("../services/ai/engine", () => ({
  ...realEngine,
  runStructuredCapability: async (cap: AnyStructuredCapability, input: unknown, ctx: AgentRunContext) => {
    const prepared = await cap.prepare(input, ctx);
    return cap.finalize(cap.outputSchema.parse(draftAnswer), prepared, ctx, { raw: "", steps: [], modelLabel: "fake" });
  },
}));

const { closeDatabase } = await import("../rbac/db");
const { runMigrations } = await import("../rbac/db/migrations");
const { freshDatabase, rawAll, rawRun } = await import("../rbac/db/migrationTestHarness");
const { generateAccessToken } = await import("../rbac/services/jwt");
const { errorHandler } = await import("../middleware/error");
const { syncRegistrySeeds } = await import("../services/ai/registry/seedSync");
const { guardMcpResult } = await import("../mcp/guardrails");
const { default: aiGuardrails } = await import("./ai-guardrails");

const USER = "guardrail-user";
const VIEW = ["ai_guardrails:view"];
const MANAGE = ["ai_guardrails:view", "ai_guardrails:manage"];
let app: Hono;

async function call(method: string, path: string, permissions: string[], body?: unknown): Promise<Response> {
  const token = await generateAccessToken({ sub: USER, email: "g@test.local", username: "guard", roles: ["custom"], permissions, sessionId: "s1" });
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function data<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

interface Row { id: string; slug: string; version: number; mode: string; enabled: boolean; position: number; triggers24h: { total: number } }

const custom = {
  slug: "employee-ids", name: "Employee IDs", description: "Internal ids", kind: "pattern",
  config: { detectors: [], patterns: [{ label: "Employee ID", regex: "EMP-\\d{6}", caseInsensitive: false }], strategy: "placeholder" },
  stages: ["tool_result"], action: "redact", mode: "shadow", scope: { agents: "all", features: "all", mcp: true }, position: 25, enabled: true,
};

beforeAll(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'g@test.local', 'guard', 'x', 1, unixepoch(), unixepoch())`);
  await syncRegistrySeeds();
  app = new Hono();
  app.onError(errorHandler);
  app.route("/ai-guardrails", aiGuardrails);
});

afterAll(async () => {
  await closeDatabase();
});

describe("/api/ai-guardrails", () => {
  it("lists the built-ins with kinds, detectors, agents and features for the editor", async () => {
    expect((await call("GET", "/ai-guardrails", [])).status).toBe(403);
    const body = await data<{ guardrails: Row[]; kinds: Record<string, unknown>; detectors: unknown[]; features: Array<{ id: string }>; drafting: boolean }>(await call("GET", "/ai-guardrails", VIEW));
    expect(body.guardrails.map((g) => g.slug)).toEqual(["result-size-cap", "pii-redaction", "sensitive-columns", "secret-detection", "prompt-injection-shield", "call-limits", "sql-safety", "topic-restriction"]);
    expect(Object.keys(body.kinds)).toHaveLength(8);
    expect(body.features.some((f) => f.id === "chat")).toBe(true);
    expect(body.drafting).toBe(true);
  });

  it("creates, edits, switches mode, reorders and deletes, with view-only refused", async () => {
    expect((await call("POST", "/ai-guardrails", VIEW, custom)).status).toBe(403);
    const created = await data<Row>(await call("POST", "/ai-guardrails", MANAGE, custom));
    expect([created.mode, created.version]).toEqual(["shadow", 1]);

    const conflict = await call("PUT", `/ai-guardrails/${created.id}`, MANAGE, { ...custom, name: "Renamed", version: 9 });
    expect(conflict.status).toBe(409);
    const enforced = await data<Row>(await call("PATCH", `/ai-guardrails/${created.id}/state`, MANAGE, { mode: "enforce", version: 1 }));
    expect([enforced.mode, enforced.version]).toEqual(["enforce", 2]);

    const list = await data<{ guardrails: Row[] }>(await call("GET", "/ai-guardrails", VIEW));
    const ids = list.guardrails.map((g) => g.id).reverse();
    expect((await call("POST", "/ai-guardrails/reorder", MANAGE, { ids })).status).toBe(200);
    const reordered = await data<{ guardrails: Row[] }>(await call("GET", "/ai-guardrails", VIEW));
    expect(reordered.guardrails[0].id).toBe(ids[0]);

    const revisions = await data<{ revisions: Array<{ id: string; action: string }> }>(await call("GET", `/ai-guardrails/${created.id}/revisions`, VIEW));
    expect(revisions.revisions.map((r) => r.action)).toEqual(["reorder", "mode", "create"]);
    const current = (await data<{ guardrails: Row[] }>(await call("GET", "/ai-guardrails", VIEW))).guardrails.find((g) => g.id === created.id)!;
    expect((await call("DELETE", `/ai-guardrails/${created.id}?version=${current.version}`, MANAGE)).status).toBe(200);
    const audit = await rawAll(sql`SELECT action FROM rbac_audit_logs WHERE resource_type = 'ai_guardrail' ORDER BY created_at`);
    expect(audit.map((r) => r.action)).toContain("ai_guardrail.delete");
  });

  it("pages and filters recent triggers, with the total", async () => {
    const now = Date.now();
    for (let i = 0; i < 12; i++) {
      await rawRun(sql`
        INSERT INTO ai_guardrail_events (id, created_at, guardrail_id, guardrail_name, kind, stage, action, mode, match_count, source)
        VALUES (${`route-${i}`}, ${now - i * 1000}, ${i < 8 ? "g-route" : "g-other"}, 'Route', 'pattern', 'tool_result', 'redact', ${i % 2 === 0 ? "enforce" : "shadow"}, 1, 'agent')`);
    }
    type Page = { events: Array<{ id: string; mode: string }>; total: number };
    expect((await call("GET", "/ai-guardrails/events", [])).status).toBe(403);
    const first = await data<Page>(await call("GET", "/ai-guardrails/events?guardrailId=g-route&limit=3", VIEW));
    expect(first.total).toBe(8);
    expect(first.events.map((e) => e.id)).toEqual(["route-0", "route-1", "route-2"]);
    const last = await data<Page>(await call("GET", "/ai-guardrails/events?guardrailId=g-route&limit=3&offset=6", VIEW));
    expect([last.total, last.events.map((e) => e.id)]).toEqual([8, ["route-6", "route-7"]]);
    const shadow = await data<Page>(await call("GET", "/ai-guardrails/events?guardrailId=g-route&mode=shadow", VIEW));
    expect([shadow.total, shadow.events.every((e) => e.mode === "shadow")]).toEqual([4, true]);
    for (const bad of ["offset=-1", "mode=audit", "limit=0", "limit=501"]) {
      expect((await call("GET", `/ai-guardrails/events?${bad}`, VIEW)).status).toBe(400);
    }
    await rawRun(sql`DELETE FROM ai_guardrail_events WHERE id LIKE 'route-%'`);
  });

  it("explains invalid guardrails", async () => {
    const res = await call("POST", "/ai-guardrails", MANAGE, { ...custom, slug: "bad", action: "redact", stages: ["tool_call"] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("cannot redact at the tool call stage");
  });

  it("tests a guardrail on sample text without storing anything", async () => {
    const before = await rawAll(sql`SELECT COUNT(*) AS n FROM ai_guardrail_events`);
    const redacted = await data<{ outcome: string; output: string }>(await call("POST", "/ai-guardrails/test", MANAGE, {
      guardrail: custom, stage: "tool_result", text: JSON.stringify([{ owner: "EMP-204518" }]),
    }));
    expect(redacted).toEqual(expect.objectContaining({ outcome: "matched", output: JSON.stringify([{ owner: "[EMPLOYEE_ID]" }]) }));
    const blocked = await data<{ outcome: string; output: string }>(await call("POST", "/ai-guardrails/test", MANAGE, {
      guardrail: { ...custom, action: "block" }, stage: "tool_result", text: "EMP-204518",
    }));
    expect(blocked).toEqual(expect.objectContaining({ outcome: "blocked", output: "Blocked by guardrail 'Employee IDs': 1 match" }));
    expect(await rawAll(sql`SELECT COUNT(*) AS n FROM ai_guardrail_events`)).toEqual(before);
  });

  it("drafts a guardrail in shadow mode and reports problems instead of saving", async () => {
    draftAnswer = { name: "Employee IDs", description: "Hide employee ids", kind: "pattern", config: { detectors: [], patterns: [{ label: "Employee ID", regex: "EMP-\\d{6}", caseInsensitive: false }], strategy: "placeholder" }, stages: ["tool_result"], action: "redact", rationale: "Ids are internal" };
    expect((await call("POST", "/ai-guardrails/draft", MANAGE, { goal: "Mask employee ids" })).status).toBe(403);
    const draft = await data<{ input: { slug: string; mode: string }; problems: string[] }>(await call("POST", "/ai-guardrails/draft", [...MANAGE, "ai:optimize"], { goal: "Mask employee ids" }));
    expect(draft.input).toEqual(expect.objectContaining({ slug: "employee-ids", mode: "shadow" }));
    expect(draft.problems).toEqual([]);
    draftAnswer = { ...(draftAnswer as object), action: "redact", stages: ["tool_call"] };
    const bad = await data<{ problems: string[] }>(await call("POST", "/ai-guardrails/draft", [...MANAGE, "ai:optimize"], { goal: "Mask employee ids" }));
    expect(bad.problems[0]).toContain("cannot redact at the tool call stage");
  });
});

describe("guardrails on MCP tool results", () => {
  const identity = { userId: USER, permissions: [], roles: ["custom"] };

  it("redacts PII before the client sees it and records the trigger", async () => {
    const out = await guardMcpResult("run_select_query", { content: [{ type: "text", text: JSON.stringify({ rows: [{ email: "dana@acme.io" }] }) }] }, identity);
    expect(out.content[0]).toEqual({ type: "text", text: JSON.stringify({ rows: [{ email: "[EMAIL]" }] }) });
    const events = await rawAll(sql`SELECT guardrail_id, source, user_id, tool FROM ai_guardrail_events WHERE source = 'mcp'`);
    expect(events).toContainEqual({ guardrail_id: "builtin-guardrail-pii", source: "mcp", user_id: USER, tool: "run_select_query" });
  });

  it("returns an error result with no data when a guardrail blocks", async () => {
    await rawRun(sql`UPDATE ai_guardrails SET action = 'block' WHERE id = 'builtin-guardrail-pii'`);
    await rawRun(sql`UPDATE ai_registry_state SET version = version + 1`);
    const out = await guardMcpResult("run_select_query", { content: [{ type: "text", text: "contact dana@acme.io" }] }, identity);
    expect(out).toEqual({ content: [{ type: "text", text: "Blocked by guardrail 'PII redaction': 1 match" }], isError: true });
  });
});
