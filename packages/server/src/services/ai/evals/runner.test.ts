/**
 * Running evals (ADR 0024 §Phase 6) on a real RBAC database, with the agent
 * runs and the judge stubbed: scoring, regressions, failures and the gate.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

type Call = { kind: "chat" | "feature"; ctx: Record<string, unknown>; options: Record<string, unknown>; input: unknown };
const calls: Call[] = [];
let chatTools: string[] = ["list_tables"];
let chatAnswer = "There are 12 tables.";
let chatFails = false;
let verdict = { pass: true, reason: "Gives a number", tokens: 30 };

mock.module("../engine", () => ({
  isStructured: (cap: { delivery: string }) => cap.delivery === "structured",
  invokeChat: async (ctx: Record<string, unknown>, messages: unknown, options: Record<string, unknown>) => {
    calls.push({ kind: "chat", ctx, options, input: messages });
    (options.onUsage as (u: unknown) => void)({ tokens: 500, costUsd: 0.01 });
    if (chatFails) throw new Error("The model is unavailable");
    return { content: chatAnswer, toolCalls: chatTools.map((name) => ({ name, args: {} })), agent: { id: "a", slug: "a", name: "A" }, interrupts: [] };
  },
  runStructuredCapability: async (_cap: unknown, input: unknown, ctx: Record<string, unknown>, options: Record<string, unknown>) => {
    calls.push({ kind: "feature", ctx, options, input });
    (options.onTrace as (t: unknown) => void)({ calls: [{ name: "get_table_ddl" }, { name: "validate_sql" }] });
    (options.onUsage as (u: unknown) => void)({ tokens: 200, costUsd: null });
    return { fixedQuery: "SELECT 1" };
  },
}));
mock.module("./judge", () => ({ judgeAnswer: async () => verdict }));

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { syncRegistrySeeds } = await import("../registry/seedSync");
const { loadSnapshot } = await import("../registry/store");
const runner = await import("./runner");
const store = await import("./store");

const AGENT = "builtin-agent-clickhouse-data";

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  await syncRegistrySeeds();
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(() => {
  calls.length = 0;
  chatTools = ["list_tables"];
  chatAnswer = "There are 12 tables.";
  chatFails = false;
  verdict = { pass: true, reason: "Gives a number", tokens: 30 };
});

async function score(hash: string): Promise<import("./store").EvalRun> {
  const { run, done } = await runner.startEvalRun({ agentId: AGENT, draftHash: hash, snapshot: await loadSnapshot(), ctx: { userId: "ann", isAdmin: true }, actor: "ann" });
  expect(run.status).toBe("running");
  await done;
  return (await store.getRun(run.id))!;
}

describe("eval runs", () => {
  it("refuses to run without cases", async () => {
    await expect(runner.startEvalRun({ agentId: AGENT, draftHash: "h", snapshot: await loadSnapshot(), ctx: {}, actor: "ann" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("scores every case through the test-console paths, with actions simulated", async () => {
    const chat = await store.createCase(AGENT, { name: "Counts tables", kind: "chat", featureId: null, input: { messages: [{ role: "user", content: "How many tables?" }] }, expectedTools: ["list_tables"], rubric: "Gives a number" }, "manual", "ann");
    await Bun.sleep(3);
    const feature = await store.createCase(AGENT, { name: "Fixes SQL", kind: "feature", featureId: "debug-query", input: { query: "SELEC 1", error: "Syntax error" }, expectedTools: ["get_table_ddl", "validate_sql"], rubric: null }, "console", "ann");
    const run = await score("draft-1");
    expect(run).toMatchObject({ status: "completed", passed: 2, total: 2, score: 1, tokens: 730, costUsd: 0.01, regressions: [] });
    expect(run.results.find((r) => r.caseId === chat.id)).toMatchObject({ passed: true, toolsOk: true, judge: { pass: true, reason: "Gives a number" }, calledTools: ["list_tables"], answer: "There are 12 tables." });
    expect(run.results.find((r) => r.caseId === feature.id)).toMatchObject({ passed: true, toolsOk: true, judge: null, calledTools: ["get_table_ddl", "validate_sql"] });
    expect(calls.map((c) => c.ctx.actionMode)).toEqual(["simulate", "simulate"]);
    expect(calls[0].options).toMatchObject({ agentId: AGENT });
    expect(calls[1].input).toMatchObject({ query: "SELEC 1", error: "Syntax error" });
  });

  it("flags cases that passed before and fail now as regressions", async () => {
    chatTools = ["run_select_query"];
    verdict = { pass: false, reason: "No number given", tokens: 30 };
    const run = await score("draft-2");
    expect(run).toMatchObject({ passed: 1, total: 2, score: 0.5 });
    const failed = run.results.find((r) => !r.passed)!;
    expect(failed).toMatchObject({ toolsOk: false, missingTools: ["list_tables"], judge: { pass: false, reason: "No number given" } });
    expect(run.regressions).toEqual([{ caseId: failed.caseId, name: "Counts tables" }]);
  });

  it("records a case that could not run as failed, and keeps going", async () => {
    chatFails = true;
    const run = await score("draft-3");
    expect(run.status).toBe("completed");
    expect(run.results.find((r) => r.name === "Counts tables")).toMatchObject({ passed: false, error: "The model is unavailable" });
    expect(run.results.find((r) => r.name === "Fixes SQL")?.passed).toBe(true);
  });
});

describe("eval gate", () => {
  it("needs nothing without a threshold", async () => {
    expect(await runner.evalGate(AGENT, "unscored", null)).toMatchObject({ required: false, passing: true, cases: 2 });
  });

  it("needs a run of this draft that scores at least the threshold", async () => {
    expect(await runner.evalGate(AGENT, "unscored", 0.8)).toMatchObject({ required: true, passing: false, run: null });
    expect(await runner.evalGate(AGENT, "draft-1", 0.8)).toMatchObject({ required: true, passing: true });
    expect(await runner.evalGate(AGENT, "draft-2", 0.8)).toMatchObject({ passing: false, run: { score: 0.5 } });
    expect(await runner.evalGate(AGENT, "draft-2", 0.5)).toMatchObject({ passing: true });
  });

  it("needs a new run once a case is added", async () => {
    await store.createCase(AGENT, { name: "New case", kind: "chat", featureId: null, input: { messages: [{ role: "user", content: "hi" }] }, expectedTools: [], rubric: null }, "manual", "ann");
    expect(await runner.evalGate(AGENT, "draft-1", 0.8)).toMatchObject({ passing: false, cases: 3 });
  });
});
