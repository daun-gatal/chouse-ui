/** Approved actions store (ADR 0024 §Phase 2) on SQLite and PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

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

const base = { userId: "alice", tool: "kill_query", args: { queryId: "q1" }, description: "KILL QUERY q1" };

for (const dialect of DIALECTS) {
  describe(`ai actions [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
    }, 120_000);

    it("creates a pending chat action that expires in 15 minutes", async () => {
      const before = Date.now();
      const action = await store.createAction({ ...base, source: "chat", runId: "run-1", interruptId: "int-1", threadId: "t1" });
      expect(action).toMatchObject({ status: "pending", source: "chat", runId: "run-1", interruptId: "int-1", args: { queryId: "q1" } });
      expect(action.expiresAt).toBeGreaterThanOrEqual(before + store.CHAT_APPROVAL_TTL_MS);
      expect(action.expiresAt).toBeLessThan(before + store.CHAT_APPROVAL_TTL_MS + 5_000);
      expect((await store.actionsForRun("run-1")).map((a) => a.id)).toEqual([action.id]);
    });

    it("lets exactly one decision win, and keeps edited arguments", async () => {
      const action = await store.createAction({ ...base, source: "background" });
      expect(action.expiresAt - action.createdAt).toBe(store.BACKGROUND_APPROVAL_TTL_MS);
      const [first, second] = await Promise.all([
        store.decideAction(action.id, "approved", "bob", { queryId: "q1-edited" }),
        store.decideAction(action.id, "rejected", "carol"),
      ]);
      const winners = [first, second].filter((d) => d !== null);
      expect(winners).toHaveLength(1);
      const decided = await store.getAction(action.id);
      expect(decided?.decidedBy).toBe(winners[0]?.decidedBy ?? null);
      if (decided?.status === "approved") expect(decided.args).toEqual({ queryId: "q1-edited" });
    });

    it("finds a run's approved action and records its outcome", async () => {
      const action = await store.createAction({ ...base, source: "chat", runId: "run-2" });
      expect(await store.approvedActionForRun("run-2", "kill_query")).toBeNull();
      await store.decideAction(action.id, "approved", "alice");
      const approved = await store.approvedActionForRun("run-2", "kill_query");
      expect(approved?.id).toBe(action.id);
      await store.finishAction(action.id, { result: { killed: true } });
      expect(await store.getAction(action.id)).toMatchObject({ status: "executed", result: { killed: true } });
      const failing = await store.createAction({ ...base, source: "chat", runId: "run-2" });
      await store.decideAction(failing.id, "approved", "alice");
      await store.finishAction(failing.id, { error: "Permission denied" });
      expect(await store.getAction(failing.id)).toMatchObject({ status: "failed", error: "Permission denied" });
    });

    it("expires overdue actions, refuses to decide them, and reports their runs", async () => {
      const overdue = await store.createAction({ ...base, source: "chat", runId: "run-3", expiresAt: Date.now() - 1 });
      expect(await store.decideAction(overdue.id, "approved", "alice")).toBeNull();
      expect(await store.expireActions()).toEqual(["run-3"]);
      expect((await store.getAction(overdue.id))?.status).toBe("expired");
      expect(await store.expireActions()).toEqual([]);
    });

    it("rejects a stopped run's pending actions", async () => {
      const a = await store.createAction({ ...base, source: "chat", runId: "run-4" });
      await store.rejectRunActions("run-4", "alice");
      expect(await store.getAction(a.id)).toMatchObject({ status: "rejected", decidedBy: "alice" });
    });

    it("names the people on a list, preferring the display name", async () => {
      const ts = dialect === "sqlite" ? sql`unixepoch()` : sql`NOW()`;
      const active = dialect === "sqlite" ? 1 : true;
      await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, display_name, password_hash, is_active, created_at, updated_at)
        VALUES ('u-named', 'n@test.local', 'named', 'Named Person', 'x', ${active}, ${ts}, ${ts}),
               ('u-plain', 'p@test.local', 'plain', NULL, 'x', ${active}, ${ts}, ${ts})`);
      const names = await store.userNames(["u-named", "u-plain", "u-gone", null, "u-named"]);
      expect([...names.entries()].sort()).toEqual([["u-named", "Named Person"], ["u-plain", "plain"]]);
      expect((await store.userNames([])).size).toBe(0);
    });

    it("lists and counts what waits for a user", async () => {
      await store.createAction({ ...base, userId: "dave", source: "chat", runId: "run-5" });
      await store.createAction({ ...base, userId: "erin", source: "background" });
      expect(await store.pendingCount("dave", false)).toBe(1);
      // With ai:act, background proposals for anyone count too.
      expect(await store.pendingCount("dave", true)).toBeGreaterThanOrEqual(2);
      const mine = await store.listActions({ userId: "dave" });
      expect(mine.every((a) => a.userId === "dave")).toBe(true);
      const pendingBackground = await store.listActions({ userId: null, source: "background", status: "pending" });
      expect(pendingBackground.every((a) => a.source === "background" && a.status === "pending")).toBe(true);
    });
  });
}
