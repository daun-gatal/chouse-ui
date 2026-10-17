import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { all, run } = await import("../../observe/db");
const { UsageRun, pruneAiUsage, writeUsageRun } = await import("../usage");

const EVENT = {
  guardrailId: "builtin-guardrail-pii", guardrailName: "PII redaction", kind: "pattern" as const, stage: "tool_result" as const,
  action: "redact" as const, mode: "enforce" as const, matchCount: 3, agentPath: "root › data", tool: "run_select_query", reason: "3 matches", stepId: null,
};

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
});

afterAll(async () => {
  await closeDatabase();
});

describe("guardrail events with the usage run", () => {
  it("records a trigger even when the run stopped before any call", async () => {
    const usage = new UsageRun({ featureId: "chat", source: "chat", userId: "u1", connectionId: null });
    usage.recordGuardrail({ ...EVENT, stage: "input", action: "block" });
    usage.finish("error", new Error("Blocked"));
    await writeUsageRun(usage);
    const rows = await all(sql`SELECT * FROM ai_guardrail_events WHERE stage = 'input'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ source: "agent", user_id: "u1", request_id: null, action: "block", match_count: 3 }));
    expect(await all(sql`SELECT id FROM ai_usage_requests`)).toHaveLength(0);
  });

  it("links triggers to the request when the run made calls, and prunes them with it", async () => {
    const usage = new UsageRun({ featureId: "chat", source: "chat", userId: "u1", connectionId: null });
    const step = usage.beginTool("run_select_query", "root", { model: null, connectionId: null, defaultDatabase: null });
    step.end({ result: { rows: [] } });
    usage.recordGuardrail(EVENT);
    usage.finish("ok");
    await writeUsageRun(usage);
    const rows = await all(sql`SELECT request_id, agent_path, tool, reason FROM ai_guardrail_events WHERE stage = 'tool_result'`);
    expect(rows).toEqual([{ request_id: usage.id, agent_path: "root › data", tool: "run_select_query", reason: "3 matches" }]);

    await run(sql`UPDATE ai_guardrail_events SET created_at = 1`);
    await pruneAiUsage(Date.now(), 30);
    expect(await all(sql`SELECT id FROM ai_guardrail_events`)).toHaveLength(0);
  });
});
