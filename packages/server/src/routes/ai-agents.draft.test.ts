/**
 * POST /api/ai-agents/draft/:kind (issue #381) against a real in-memory RBAC
 * database: permission gates, request validation, the targeted re-ask, and
 * that drafting never writes to the registry. Only the model call is faked —
 * each capability's real prepare and finalize run on canned model output.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import type { AgentRunContext, AnyStructuredCapability } from "../services/ai/types";

let aiEnabled = true;
const answers: Record<string, unknown[]> = {};
const calls: Array<{ featureId: string; input: unknown; modelId?: string }> = [];

const realAiConfig = await import("../services/aiConfig");
mock.module("../services/aiConfig", () => ({ ...realAiConfig, isAIEnabled: async () => aiEnabled }));

const realEngine = await import("../services/ai/engine");
mock.module("../services/ai/engine", () => ({
  ...realEngine,
  runStructuredCapability: async (cap: AnyStructuredCapability, input: unknown, ctx: AgentRunContext) => {
    // Same order as the real engine: access checks and evidence before the model.
    const prepared = await cap.prepare(input, ctx);
    calls.push({ featureId: cap.id, input, modelId: ctx.modelId });
    const parsed = answers[cap.id]?.shift();
    if (parsed === undefined) throw new Error(`No canned answer for ${cap.id}`);
    return cap.finalize(cap.outputSchema.parse(parsed), prepared, ctx, { raw: "", steps: [], modelLabel: "fake" });
  },
}));

const { closeDatabase } = await import("../rbac/db");
const { runMigrations } = await import("../rbac/db/migrations");
const { freshDatabase, rawAll, rawRun } = await import("../rbac/db/migrationTestHarness");
const { generateAccessToken } = await import("../rbac/services/jwt");
const { errorHandler } = await import("../middleware/error");
const { syncRegistrySeeds } = await import("../services/ai/registry/seedSync");
const { BUILTIN_TOOLS } = await import("../services/ai/registry/harness");
const { default: aiAgents } = await import("./ai-agents");

const USER = "ai-draft-user";
const VIEW = ["ai_agents:view"];
const MANAGE_ONLY = ["ai_agents:view", "ai_agents:manage"];
const DRAFTER = ["ai_agents:view", "ai_agents:manage", "ai:optimize"];
let app: Hono;

async function call(method: string, path: string, permissions: string[], body?: unknown): Promise<Response> {
  const token = await generateAccessToken({ sub: USER, email: "d@test.local", username: "drafter", roles: ["custom"], permissions, sessionId: "s1" });
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

async function registryRows(): Promise<{ version: unknown; rows: number }> {
  const [{ version }] = await rawAll(sql`SELECT version FROM ai_registry_state`);
  const counts = await Promise.all(["ai_agents", "ai_harnesses", "ai_skills", "ai_registry_revisions"].map(async (table) => {
    const [row] = await rawAll(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`));
    return Number(row.n);
  }));
  return { version, rows: counts.reduce((a, b) => a + b, 0) };
}

const SKILL_BODY = [
  "## When to use",
  "Use this skill when inserts fail with TOO_MANY_PARTS on a MergeTree table.",
  "## Procedure",
  "1. Count active parts per partition in system.parts.",
  "2. Check merges in system.merges.",
  "3. Read reference.md for thresholds.",
  "## Examples",
  "```sql\nSELECT partition, count() FROM system.parts WHERE active GROUP BY partition\n```",
  "## Pitfalls",
  "Avoid OPTIMIZE FINAL on large tables at peak; it competes with merges.",
].join("\n");

const skillAnswer = {
  summary: "Parts triage",
  dir: "too-many-parts",
  name: "too-many-parts",
  description: "Use when inserts fail with TOO_MANY_PARTS or merges fall behind.",
  body: SKILL_BODY,
  files: { items: [{ name: "reference.md", content: "parts_to_throw_insert defaults to 300.", why: "Keeps SKILL.md short" }], emptyReason: null },
  enabled: true,
  enabledWhy: "Ready",
};

const AGENT_PROMPT = [
  "You are the Table Size Analyst. Your job is to explain table sizes.",
  "Scope: table and database sizes only; anything else is out of scope.",
  "1. Call list_tables to find the table.",
  "2. Call get_table_size to read its size.",
  "Safety: tools are read-only; never invent numbers.",
  "Output format: a short answer, then a table of sizes.",
].join("\n").padEnd(450, " Keep answers short.");

const agentAnswer = (systemPrompt: string): Record<string, unknown> => ({
  summary: "Sizes",
  name: "Table Size Analyst",
  slug: "table-size-analyst",
  description: "Answers how much space ClickHouse tables and databases use.",
  kind: "agent",
  systemPrompt,
  taskTemplate: null,
  tools: { items: [{ name: "list_tables", why: "Find tables" }, { name: "get_table_size", why: "Sizes" }], emptyReason: null },
  skills: { items: [], emptyReason: "No skill covers sizes." },
  subagents: { items: [], emptyReason: "Single-purpose agent." },
  harness: { slug: "focused", why: "No delegation" },
  model: { configId: null, why: "Default is fine" },
  tuning: { stepBudget: 6, recursionLimit: null, timeoutMs: null, maxOutputTokens: null, why: "Few lookups" },
  suggestedSkills: [],
});

beforeAll(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'd@test.local', 'drafter', 'x', 1, unixepoch(), unixepoch())`);
  await syncRegistrySeeds();
  app = new Hono();
  app.onError(errorHandler);
  app.route("/ai-agents", aiAgents);
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(() => {
  aiEnabled = true;
  calls.length = 0;
  for (const key of Object.keys(answers)) delete answers[key];
});

describe("permission gates", () => {
  it("needs ai_agents:manage and the drafter's AI permission", async () => {
    expect((await call("POST", "/ai-agents/draft/skill", VIEW, { goal: "Triage parts errors" })).status).toBe(403);
    const noAi = await call("POST", "/ai-agents/draft/skill", MANAGE_ONLY, { goal: "Triage parts errors" });
    expect(noAi.status).toBe(403);
    expect(((await noAi.json()) as { error: { message: string } }).error.message).toContain("Drafting with AI needs 'ai:optimize'");
    expect(calls).toHaveLength(0);
  });

  it("refuses when no AI model is configured", async () => {
    aiEnabled = false;
    expect((await call("POST", "/ai-agents/draft/skill", DRAFTER, { goal: "Triage parts errors" })).status).toBe(400);
  });

  it("reports whether each drafter can run", async () => {
    const data = await json<{ drafting: Record<string, boolean> }>(await call("GET", "/ai-agents/registry", VIEW));
    expect(data.drafting).toEqual({ agent: true, harness: true, skill: true });
    aiEnabled = false;
    const off = await json<{ drafting: Record<string, boolean> }>(await call("GET", "/ai-agents/registry", VIEW));
    expect(off.drafting).toEqual({ agent: false, harness: false, skill: false });
  });
});

describe("requests", () => {
  it("rejects an unknown kind and a request without a goal", async () => {
    expect((await call("POST", "/ai-agents/draft/router", DRAFTER, { goal: "Route things" })).status).toBe(404);
    expect((await call("POST", "/ai-agents/draft/skill", DRAFTER, { goal: "x" })).status).toBe(400);
    expect((await call("POST", "/ai-agents/draft/skill", DRAFTER, { instruction: "Make it stricter" })).status).toBe(400);
  });

  it("refuses to refine a built-in entity", async () => {
    const skill = { path: "references/clickhouse-playbook", skillMd: "---\nname: clickhouse-playbook\ndescription: x\n---\n\nbody", files: {}, enabled: true };
    const res = await call("POST", "/ai-agents/draft/skill", DRAFTER, { current: skill, instruction: "Add TTL advice", entityId: "builtin-skill-clickhouse-playbook" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("Built-in skills cannot be refined");
  });

  it("rejects a feature the agent cannot serve", async () => {
    const res = await call("POST", "/ai-agents/draft/agent", DRAFTER, { goal: "Answer chat questions", agentHints: { featureId: "chat", delegate: "auto" } });
    expect(res.status).toBe(400);
  });
});

describe("drafting", () => {
  it("returns a reviewed skill draft and never writes to the registry", async () => {
    answers["draft-ai-skill"] = [skillAnswer];
    const before = await registryRows();
    const res = await call("POST", "/ai-agents/draft/skill", DRAFTER, { goal: "Triage TOO_MANY_PARTS errors" });
    expect(res.status).toBe(200);
    const data = await json<{ input: { path: string; skillMd: string }; sections: Record<string, { state: string }>; rounds: number }>(res);
    expect(data.input.path).toBe("custom/too-many-parts");
    expect(Object.values(data.sections).every((s) => s.state === "drafted")).toBe(true);
    expect(data.rounds).toBe(1);
    expect(await registryRows()).toEqual(before);
  });

  it("runs on the drafter's picked model", async () => {
    answers["draft-ai-skill"] = [skillAnswer];
    calls.length = 0;
    const res = await call("POST", "/ai-agents/draft/skill?modelId=model-7", DRAFTER, { goal: "Triage TOO_MANY_PARTS errors" });
    expect(res.status).toBe(200);
    expect(calls[0]?.modelId).toBe("model-7");
  });

  it("re-asks only for the failing section and returns the fixed draft", async () => {
    answers["draft-ai-agent"] = [agentAnswer("You help with sizes."), agentAnswer(AGENT_PROMPT)];
    const res = await call("POST", "/ai-agents/draft/agent", DRAFTER, { goal: "Explain table sizes", agentHints: { featureId: null, delegate: "no" } });
    expect(res.status).toBe(200);
    const data = await json<{ input: { systemPrompt: string; enabled: boolean }; sections: Record<string, { state: string }>; rounds: number }>(res);
    expect(calls).toHaveLength(2);
    expect(calls[1].input).toMatchObject({ sections: ["prompt"] });
    expect(data.rounds).toBe(2);
    expect(data.sections.prompt.state).toBe("drafted");
    expect(data.input.systemPrompt).toBe(AGENT_PROMPT.trim());
    expect(data.input.enabled).toBe(false);
  });

  it("flags a harness section that keeps failing instead of dropping it", async () => {
    const partial = {
      summary: "Terse",
      name: "Terse",
      slug: "terse",
      description: "For single agents that answer briefly, with no file writes.",
      builtinTools: BUILTIN_TOOLS.filter((t) => t.name !== "grep").map((t) => ({ name: t.name, enabled: t.name === "read_file", why: "Decided" })),
      generalPurpose: { enabled: false, description: null, systemPrompt: null, why: "No delegation" },
      promptSuffix: { text: "Answer in three sentences.", emptyReason: null },
      toolDescriptionOverrides: { items: [], emptyReason: "Defaults are clear." },
    };
    answers["draft-ai-harness"] = [partial, partial, partial];
    const before = await registryRows();
    const data = await json<{ sections: Record<string, { state: string; problems: string[] }>; rounds: number }>(
      await call("POST", "/ai-agents/draft/harness", DRAFTER, { goal: "Terse agents without file writes" }),
    );
    expect(calls).toHaveLength(3);
    expect(data.rounds).toBe(3);
    expect(data.sections.builtinTools).toMatchObject({ state: "attention", problems: ["No on/off decision for the built-in tool 'grep'"] });
    expect(data.sections.identity.state).toBe("drafted");
    expect(await registryRows()).toEqual(before);
  });
});
