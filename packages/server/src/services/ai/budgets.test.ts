/**
 * AI budgets (ADR 0024, D5) against a real RBAC database: spend comes from
 * ai_usage_requests, `stop` fails a run with 429, `fallback` switches its model.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase } = await import("../../rbac/db");
const { runMigrations } = await import("../../rbac/db/migrations");
const { run, sql } = await import("../observe/db");
const budgets = await import("./budgets");
const h = await import("../../rbac/db/migrationTestHarness");

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const YESTERDAY = NOW - 86_400_000;

async function usage(row: { feature: string; user: string | null; tokens: number; cost?: number | null; at?: number }): Promise<void> {
  await run(sql`
    INSERT INTO ai_usage_requests (id, started_at, user_id, feature_id, source, status, input_tokens, output_tokens, cost_usd)
    VALUES (${crypto.randomUUID()}, ${row.at ?? NOW - 1_000}, ${row.user}, ${row.feature}, 'chat', 'ok', ${row.tokens - 10}, 10, ${row.cost ?? null})`);
}

const base = {
  featureId: null,
  appliesTo: "all" as const,
  userId: null,
  period: "day" as const,
  limitTokens: null,
  limitCostUsd: null,
  onExhaust: "stop" as const,
  fallbackModelConfigId: null,
  enabled: true,
};

const DIALECTS: Array<"sqlite" | "postgres"> = ["sqlite", "postgres"];
let pg: Awaited<ReturnType<typeof h.startPostgresContainer>> | undefined;

beforeAll(async () => {
  pg = await h.startPostgresContainer();
}, 180_000);

afterAll(async () => {
  await closeDatabase();
  pg?.stop();
}, 30_000);

beforeEach(async () => {
  await run(sql`DELETE FROM ai_budgets`);
  await run(sql`DELETE FROM ai_usage_requests`);
});

for (const dialect of DIALECTS) {
  describe(`setup [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
    }, 120_000);
    it("is ready", () => expect(true).toBe(true));
  });

  describe(`budget input [${dialect}]`, () => {
    it("needs a limit, a user for single-user budgets and a model for fallback budgets", () => {
      const issues = (value: Record<string, unknown>): string[] => {
        const parsed = budgets.budgetInputSchema.safeParse({ ...base, name: "b", ...value });
        return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
      };
      expect(issues({})).toEqual(["Set a token limit, a cost limit or both"]);
      expect(issues({ limitTokens: 10, appliesTo: "user" })).toEqual(["Pick the user this budget applies to"]);
      expect(issues({ limitTokens: 10, userId: "u1" })).toEqual(["Only a single-user budget names a user"]);
      expect(issues({ limitTokens: 10, onExhaust: "fallback" })).toEqual(["Pick the model to switch to when the budget runs out"]);
      expect(issues({ limitCostUsd: 1.5 })).toEqual([]);
    });
  });

  describe(`periodWindow [${dialect}]`, () => {
    it("starts days and months at UTC midnight", () => {
      expect(budgets.periodWindow("day", NOW)).toEqual({ start: Date.UTC(2026, 9, 23), resetsAt: Date.UTC(2026, 9, 24) });
      expect(budgets.periodWindow("month", NOW)).toEqual({ start: Date.UTC(2026, 9, 1), resetsAt: Date.UTC(2026, 10, 1) });
      expect(budgets.periodWindow("month", Date.UTC(2026, 11, 31, 23)).resetsAt).toBe(Date.UTC(2027, 0, 1));
    });
  });

  describe(`checkBudgets [${dialect}]`, () => {
    it("passes when nothing applies or nothing is used up", async () => {
      await budgets.createBudget({ ...base, name: "chat cap", featureId: "chat", limitTokens: 1_000 }, null);
      await usage({ feature: "chat", user: "u1", tokens: 500 });
      await usage({ feature: "optimize-query", user: "u1", tokens: 5_000 });
      expect(await budgets.checkBudgets("chat", "u1", NOW)).toEqual({ fallbackModelConfigId: null, budget: null });
      expect(await budgets.checkBudgets("optimize-query", "u1", NOW)).toEqual({ fallbackModelConfigId: null, budget: null });
    });

    it("stops a run with 429 and says when the budget resets", async () => {
      await budgets.createBudget({ ...base, name: "chat cap", featureId: "chat", limitTokens: 1_000 }, null);
      await usage({ feature: "chat", user: "u1", tokens: 1_000 });
      await expect(budgets.checkBudgets("chat", "u2", NOW)).rejects.toMatchObject({
        statusCode: 429,
        code: "AI_BUDGET_EXHAUSTED",
        message: "The AI budget 'chat cap' is used up for this day. It resets at 2026-10-24 00:00 UTC.",
      });
    });

    it("counts only this period", async () => {
      await budgets.createBudget({ ...base, name: "daily", limitTokens: 1_000 }, null);
      await usage({ feature: "chat", user: "u1", tokens: 5_000, at: YESTERDAY });
      expect((await budgets.checkBudgets("chat", "u1", NOW)).budget).toBeNull();
    });

    it("switches to the fallback model, and a stop budget wins over it", async () => {
      await budgets.createBudget({ ...base, name: "soft", limitCostUsd: 1, onExhaust: "fallback", fallbackModelConfigId: "cheap" }, null);
      await usage({ feature: "chat", user: "u1", tokens: 10, cost: 2 });
      const decision = await budgets.checkBudgets("chat", "u1", NOW);
      expect(decision.fallbackModelConfigId).toBe("cheap");
      expect(decision.budget?.name).toBe("soft");

      await budgets.createBudget({ ...base, name: "hard", limitCostUsd: 1.5 }, null);
      await expect(budgets.checkBudgets("chat", "u1", NOW)).rejects.toMatchObject({ statusCode: 429 });
    });

    it("gives each user their own share, and single-user budgets only bind that user", async () => {
      await budgets.createBudget({ ...base, name: "per user", appliesTo: "each_user", limitTokens: 1_000 }, null);
      await budgets.createBudget({ ...base, name: "alice only", appliesTo: "user", userId: "alice", limitTokens: 100 }, null);
      await usage({ feature: "chat", user: "bob", tokens: 1_200 });
      await usage({ feature: "chat", user: "alice", tokens: 150 });
      await expect(budgets.checkBudgets("chat", "bob", NOW)).rejects.toMatchObject({ message: expect.stringContaining("'per user'") });
      await expect(budgets.checkBudgets("chat", "alice", NOW)).rejects.toMatchObject({ message: expect.stringContaining("'alice only'") });
      expect((await budgets.checkBudgets("chat", "carol", NOW)).budget).toBeNull();
      // Background runs have no user: per-user budgets never bind them.
      expect((await budgets.checkBudgets("chat", null, NOW)).budget).toBeNull();
    });

    it("ignores disabled budgets", async () => {
      await budgets.createBudget({ ...base, name: "off", limitTokens: 1, enabled: false }, null);
      await usage({ feature: "chat", user: "u1", tokens: 100 });
      expect((await budgets.checkBudgets("chat", "u1", NOW)).budget).toBeNull();
    });
  });

  describe(`budgetStatuses [${dialect}]`, () => {
    it("reports spend, and the highest user for per-user budgets", async () => {
      await budgets.createBudget({ ...base, name: "all", limitTokens: 10_000 }, null);
      await budgets.createBudget({ ...base, name: "per user", appliesTo: "each_user", limitTokens: 1_000 }, null);
      await usage({ feature: "chat", user: "bob", tokens: 1_200 });
      await usage({ feature: "chat", user: "alice", tokens: 300 });
      const statuses = await budgets.budgetStatuses(NOW);
      const all = statuses.find((s) => s.name === "all")!;
      const perUser = statuses.find((s) => s.name === "per user")!;
      expect(all.spend.tokens).toBe(1_500);
      expect(all.exhausted).toBe(false);
      expect(perUser.spend.tokens).toBe(1_200);
      expect(perUser.exhaustedUsers).toBe(1);
      expect(perUser.exhausted).toBe(true);
      expect(perUser.resetsAt).toBe(Date.UTC(2026, 9, 24));
    });
  });

  describe(`budget CRUD [${dialect}]`, () => {
    it("updates, clears the fallback model of a stop budget and deletes", async () => {
      const created = await budgets.createBudget({ ...base, name: "b", limitTokens: 5, onExhaust: "fallback", fallbackModelConfigId: "m" }, "admin");
      expect(created.createdBy).toBe("admin");
      const updated = await budgets.updateBudget(created.id, { ...base, name: "b2", limitTokens: 9, onExhaust: "stop", fallbackModelConfigId: "m" });
      expect(updated).toMatchObject({ name: "b2", limitTokens: 9, onExhaust: "stop", fallbackModelConfigId: null });
      await budgets.deleteBudget(created.id);
      expect(await budgets.getBudget(created.id)).toBeNull();
      await expect(budgets.deleteBudget(created.id)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
}
