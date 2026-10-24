/** Agent eval cases and runs (ADR 0024 §Phase 6) on SQLite and PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

const { closeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const h = await import("../../../rbac/db/migrationTestHarness");
const { syncRegistrySeeds } = await import("../registry/seedSync");
const store = await import("./store");

const DIALECTS: Array<"sqlite" | "postgres"> = ["sqlite", "postgres"];
let pg: Awaited<ReturnType<typeof h.startPostgresContainer>> | undefined;

beforeAll(async () => {
  pg = await h.startPostgresContainer();
}, 180_000);

afterAll(async () => {
  await closeDatabase();
  pg?.stop();
}, 30_000);

const AGENT = "builtin-agent-clickhouse-data";
const CASE = { name: "Counts tables", kind: "chat" as const, featureId: null, input: { messages: [{ role: "user", content: "How many tables?" }] }, expectedTools: ["list_tables"], rubric: "Gives a number" };
const result = (caseId: string, passed: boolean) => ({ caseId, name: caseId, passed, toolsOk: passed, missingTools: [], calledTools: [], judge: null, answer: "", error: null, durationMs: 1 });

for (const dialect of DIALECTS) {
  describe(`ai evals store [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
      await syncRegistrySeeds();
    }, 120_000);

    it("creates, lists, updates and deletes cases", async () => {
      const created = await store.createCase(AGENT, CASE, "manual", "ann");
      expect(created).toMatchObject({ agentId: AGENT, name: "Counts tables", kind: "chat", expectedTools: ["list_tables"], rubric: "Gives a number", source: "manual", createdBy: "ann" });
      expect(await store.caseCount(AGENT)).toBe(1);
      const updated = await store.updateCase(created.id, { ...CASE, name: "Counts tables, renamed", rubric: null, expectedTools: [] });
      expect(updated).toMatchObject({ name: "Counts tables, renamed", rubric: null, expectedTools: [] });
      await Bun.sleep(3);
      const feature = await store.createCase(AGENT, { ...CASE, kind: "feature", featureId: "debug-query", input: { query: "SELECT 1" } }, "console", null);
      expect((await store.listCases(AGENT)).map((c) => c.id)).toEqual([created.id, feature.id]);
      await store.deleteCase(feature.id);
      expect(await store.getCase(feature.id)).toBeNull();
    });

    it("records runs and finds the newest completed one, per draft", async () => {
      const first = await store.createRun(AGENT, "hash-a", 2, "ann");
      expect(first).toMatchObject({ status: "running", total: 2, score: null, draftHash: "hash-a" });
      const done = await store.finishRun(first.id, { status: "completed", results: [result("c1", true), result("c2", false)], regressions: [{ caseId: "c2", name: "c2" }], tokens: 900, costUsd: 0.02 });
      expect(done).toMatchObject({ status: "completed", score: 0.5, passed: 1, total: 2, tokens: 900, costUsd: 0.02, regressions: [{ caseId: "c2", name: "c2" }] });
      await Bun.sleep(5);
      const second = await store.createRun(AGENT, "hash-b", 1, "ann");
      await store.finishRun(second.id, { status: "failed", results: [], regressions: [], tokens: 0, costUsd: null, error: "boom" });
      expect((await store.latestCompletedRun(AGENT))?.id).toBe(first.id);
      expect((await store.latestCompletedRun(AGENT, "hash-a"))?.id).toBe(first.id);
      expect(await store.latestCompletedRun(AGENT, "hash-b")).toBeNull();
      expect((await store.listRuns(AGENT)).map((r) => r.id)).toEqual([second.id, first.id]);
    });

    it("reports a run left running by a stopped server as failed", async () => {
      const stale = await store.createRun(AGENT, "hash-c", 1, null);
      await h.rawRun(sql`UPDATE ai_eval_runs SET started_at = ${Date.now() - store.STALE_EVAL_RUN_MS - 1} WHERE id = ${stale.id}`);
      expect(await store.getRun(stale.id)).toMatchObject({ status: "failed", error: "The eval run stopped (the server restarted). Run it again." });
    });

    it("deletes cases and runs with their agent", async () => {
      await h.rawRun(sql`DELETE FROM ai_agents WHERE id = ${AGENT}`);
      expect(await store.caseCount(AGENT)).toBe(0);
      expect(await store.listRuns(AGENT)).toEqual([]);
    });
  });
}
