/** Auto-triage rules and runs (ADR 0024 §Phase 4) on SQLite and PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const { closeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const h = await import("../../../rbac/db/migrationTestHarness");
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

const RULE = { enabled: true, agentId: null, cooldownMinutes: 30, dailyTokenBudget: 5_000, channelIds: ["ch1", "ch1", "ch2"] };
const subject = (id: string, connectionId: string | null = "c1") => ({ trigger: "observe_incident" as const, id, title: `Incident ${id}`, connectionId });

for (const dialect of DIALECTS) {
  describe(`ai triage store [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
    }, 120_000);

    it("lists every trigger, off by default", async () => {
      const rules = await store.listRules();
      expect(rules.map((r) => r.trigger)).toEqual(["data_health_incident", "observe_incident", "fleet_alert", "scheduled_run_failed", "doctor_report"]);
      expect(rules.every((r) => !r.enabled && r.cooldownMinutes === 60 && r.dailyTokenBudget === 200_000 && r.watermark === 0)).toBe(true);
    });

    it("starts a newly enabled rule from now, keeps it while on, and restarts it when turned back on", async () => {
      const before = Date.now();
      const on = await store.saveRule("observe_incident", RULE, "ann");
      expect(on).toMatchObject({ enabled: true, cooldownMinutes: 30, dailyTokenBudget: 5_000, channelIds: ["ch1", "ch2"], proposeAs: "ann", updatedBy: "ann" });
      expect(on.watermark).toBeGreaterThanOrEqual(before);
      await store.setWatermark("observe_incident", on.watermark + 10);
      await store.setWatermark("observe_incident", on.watermark + 5);
      expect((await store.getRule("observe_incident")).watermark).toBe(on.watermark + 10);
      const edited = await store.saveRule("observe_incident", { ...RULE, cooldownMinutes: 5 }, "ben");
      expect(edited).toMatchObject({ watermark: on.watermark + 10, proposeAs: "ben" });
      const off = await store.saveRule("observe_incident", { ...RULE, enabled: false }, "ben");
      expect(off.watermark).toBe(on.watermark + 10);
      await Bun.sleep(20);
      const reenabledAt = Date.now();
      const again = await store.saveRule("observe_incident", RULE, "ben");
      expect(again.watermark).toBeGreaterThanOrEqual(reenabledAt);
    });

    it("claims each subject once", async () => {
      const first = await store.claimRun(subject("s1"));
      expect(first).toMatchObject({ status: "running", subjectId: "s1", connectionId: "c1" });
      expect(await store.claimRun(subject("s1"))).toBeNull();
      // Another trigger may look at the same id.
      expect(await store.claimRun({ ...subject("s1"), trigger: "fleet_alert" })).not.toBeNull();
    });

    it("finishes runs and finds them by subject", async () => {
      const run = await store.claimRun(subject("s2"));
      const done = await store.finishRun(run!.id, { status: "completed", summary: "Disk full", result: { severity: "high" }, notebookId: "nb1", actionIds: ["a1"], tokens: 1_200, costUsd: 0.01 });
      expect(done).toMatchObject({ status: "completed", summary: "Disk full", result: { severity: "high" }, notebookId: "nb1", actionIds: ["a1"], tokens: 1_200, costUsd: 0.01 });
      expect(done!.finishedAt).not.toBeNull();
      expect((await store.runForSubject("observe_incident", "s2"))?.id).toBe(run!.id);
      expect(await store.runForSubject("observe_incident", "missing")).toBeNull();
    });

    it("measures cooldown per connection, ignoring skipped runs", async () => {
      const a = await store.claimRun(subject("s3", "c9"));
      expect(await store.lastInvestigatedAt("observe_incident", "c9", a!.id)).toBeNull();
      const b = await store.claimRun(subject("s4", "c9"));
      expect(await store.lastInvestigatedAt("observe_incident", "c9", b!.id)).toBe(a!.startedAt);
      await store.finishRun(a!.id, { status: "skipped", reason: "budget" });
      expect(await store.lastInvestigatedAt("observe_incident", "c9", b!.id)).toBeNull();
      const n = await store.claimRun(subject("s5", null));
      const m = await store.claimRun(subject("s6", null));
      expect(await store.lastInvestigatedAt("observe_incident", null, m!.id)).toBe(n!.startedAt);
    });

    it("adds up today's tokens per trigger", async () => {
      const before = await store.tokensToday("observe_incident");
      const run = await store.claimRun(subject("s7"));
      await store.finishRun(run!.id, { status: "failed", error: "x", tokens: 300 });
      expect(await store.tokensToday("observe_incident")).toBe(before + 300);
      expect(await store.tokensToday("observe_incident", Date.now() + 2 * 86_400_000)).toBe(0);
    });

    it("lists runs newest first with filters", async () => {
      const all = await store.listRuns({ limit: 100 });
      expect(all.total).toBeGreaterThanOrEqual(8);
      expect(all.runs.map((r) => r.startedAt)).toEqual([...all.runs.map((r) => r.startedAt)].sort((x, y) => y - x));
      const completed = await store.listRuns({ status: "completed" });
      expect(completed.runs.every((r) => r.status === "completed")).toBe(true);
      expect((await store.listRuns({ trigger: "fleet_alert" })).total).toBe(1);
      expect((await store.listRuns({ limit: 2, offset: 1 })).runs).toHaveLength(2);
    });

    it("fails runs a stopped replica left running, and prunes old runs", async () => {
      expect(await store.failStaleRuns(-1)).toBeGreaterThanOrEqual(1);
      expect((await store.listRuns({ status: "running" })).total).toBe(0);
      await store.pruneRuns(Date.now() + store.TRIAGE_RETENTION_MS + 1);
      expect((await store.listRuns({})).total).toBe(0);
    });
  });
}
