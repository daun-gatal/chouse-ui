/**
 * Built-in eval cases (ADR 0025 §5): every case names tools CHouse Assistant
 * has, they are added once per shipped version, and a case an administrator
 * deleted stays deleted.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase, initializeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import { rawAll, rawRun } from "../../../rbac/db/migrationTestHarness";
import { syncRegistrySeeds } from "../registry/seedSync";
import { SEED_AGENTS } from "../seeds";
import { listCases } from "./store";
import { BUILTIN_EVAL_CASES, syncBuiltinEvalCases } from "./builtin";

const ASSISTANT = "builtin-agent-chouse-assistant";
/** DeepAgents' own tools the assistant's harness keeps. */
const HARNESS_TOOLS = ["task", "write_todos", "read_file"];

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
});

afterAll(async () => {
  await closeDatabase();
});

describe("built-in eval cases", () => {
  it("are about forty chat cases with unique ids, using only the assistant's tools", () => {
    expect(BUILTIN_EVAL_CASES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(BUILTIN_EVAL_CASES.map((c) => c.id)).size).toBe(BUILTIN_EVAL_CASES.length);
    const tools = new Set([...(SEED_AGENTS.find((a) => a.id === ASSISTANT)?.tools ?? []), ...HARNESS_TOOLS]);
    for (const c of BUILTIN_EVAL_CASES) {
      expect(c.agentId).toBe(ASSISTANT);
      expect(c.message.length).toBeGreaterThan(0);
      for (const tool of c.expectedTools) expect(tools.has(tool) ? tool : `${c.id} expects unknown ${tool}`).toBe(tool);
      // A case checks something: expected tools, a rubric, or both.
      expect(c.expectedTools.length > 0 || Boolean(c.rubric)).toBe(true);
    }
  });

  it("are added with the seeds, once, and a deleted one stays deleted", async () => {
    await syncRegistrySeeds();
    const cases = await listCases(ASSISTANT);
    expect(cases.filter((c) => c.source === "builtin")).toHaveLength(BUILTIN_EVAL_CASES.length);
    expect(cases.find((c) => c.id === "builtin-eval-watch")).toMatchObject({ kind: "chat", expectedTools: ["load_toolkit", "watch_table"], input: { messages: [{ role: "user", content: expect.stringContaining("Keep an eye on") }] } });

    await rawRun(sql`DELETE FROM ai_eval_cases WHERE id = 'builtin-eval-hello'`);
    expect(await syncBuiltinEvalCases()).toBe(0);
    expect((await rawAll(sql`SELECT id FROM ai_eval_cases WHERE id = 'builtin-eval-hello'`))).toEqual([]);

    // A later release ships its set again: the missing case comes back, the rest are untouched.
    await rawRun(sql`UPDATE obs_settings SET value = '0' WHERE setting_key = 'builtin_eval_cases_version'`);
    expect(await syncBuiltinEvalCases()).toBe(1);
    expect((await listCases(ASSISTANT)).filter((c) => c.source === "builtin")).toHaveLength(BUILTIN_EVAL_CASES.length);
  });
});
