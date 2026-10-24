/** Approved actions store (ADR 0024 §Phase 2) on SQLite and PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

const { closeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const h = await import("../../../rbac/db/migrationTestHarness");
const store = await import("./store");
const grants = await import("./grants");

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

    it("claims a run's approved action once and records its outcome", async () => {
      const action = await store.createAction({ ...base, source: "chat", runId: "run-2" });
      expect(await store.claimApprovedForRun("run-2", "kill_query")).toBeNull();
      await store.decideAction(action.id, "approved", "alice");
      const [first, second] = await Promise.all([store.claimApprovedForRun("run-2", "kill_query"), store.claimApprovedForRun("run-2", "kill_query")]);
      expect([first?.id, second?.id].filter(Boolean)).toEqual([action.id]);
      expect((await store.getAction(action.id))?.status).toBe("running");
      await store.finishAction(action.id, { result: { killed: true } });
      expect(await store.getAction(action.id)).toMatchObject({ status: "executed", result: { killed: true }, undo: null, undoExpiresAt: null });
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

    it("lists what waits for a user, by source and run", async () => {
      await store.createAction({ ...base, userId: "dave", source: "chat", runId: "run-5" });
      await store.createAction({ ...base, userId: "erin", source: "background" });
      await store.createAction({ ...base, userId: "dave", source: "held", origin: "mcp", tokenId: "pat-1", tier: "t2" });
      const mine = await store.listActions({ userId: "dave" });
      expect(mine.every((a) => a.userId === "dave")).toBe(true);
      expect((await store.listActions({ userId: "dave", runId: "run-5" })).map((a) => a.runId)).toEqual(["run-5"]);
      const held = await store.listActions({ userId: "dave", source: "held" });
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ source: "held", origin: "mcp", tokenId: "pat-1", tier: "t2" });
      const pendingBackground = await store.listActions({ userId: null, source: "background", status: "pending" });
      expect(pendingBackground.every((a) => a.source === "background" && a.status === "pending")).toBe(true);
    });

    it("records the tier, origin and tool call of an action, defaulting the origin from its source (ADR 0025)", async () => {
      const chat = await store.createAction({ ...base, source: "chat", runId: "run-6", toolCallId: "call-1", tier: "t2" });
      expect(chat).toMatchObject({ tier: "t2", origin: "chat", tokenId: null, undo: null, undoneAt: null });
      const queued = await store.createAction({ ...base, source: "background", tier: "t3", origin: "mcp" });
      expect(queued).toMatchObject({ tier: "t3", origin: "mcp", source: "background" });
      const legacy = await store.createAction({ ...base, source: "background" });
      expect(legacy).toMatchObject({ tier: null, origin: "background" });
      const running = await store.createAction({ ...base, source: "chat", status: "running", tier: "t1" });
      expect(running.status).toBe("running");
    });

    it("knows which paused calls were answered, so a resumed run re-raises them", async () => {
      const action = await store.createAction({ ...base, source: "chat", runId: "run-7", toolCallId: "call-7" });
      expect(await store.decisionRecordedFor("run-7", "call-7")).toBe(false);
      await store.decideAction(action.id, "rejected", "alice");
      expect(await store.decisionRecordedFor("run-7", "call-7")).toBe(true);
      expect(await store.decisionRecordedFor("run-7", "call-other")).toBe(false);
      expect(await store.decisionRecordedFor("run-other", "call-7")).toBe(false);
    });

    it("keeps an undo for 24 hours and lets exactly one undo claim it", async () => {
      const action = await store.createAction({ ...base, source: "chat", status: "running", tier: "t1" });
      const undo = { mode: "delete-created" as const, resource: "saved_query" as const, id: "sq-1", afterHash: "h" };
      const before = Date.now();
      await store.finishAction(action.id, { result: { id: "sq-1" }, undo });
      const done = await store.getAction(action.id);
      expect(done?.undo).toEqual(undo);
      expect(done?.undoExpiresAt ?? 0).toBeGreaterThanOrEqual(before + store.UNDO_TTL_MS);
      const claims = await Promise.all([store.claimUndo(action.id, "alice"), store.claimUndo(action.id, "alice")]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect((await store.getAction(action.id))?.undoneBy).toBe("alice");
      await store.releaseUndo(action.id);
      expect((await store.getAction(action.id))?.undoneAt).toBeNull();
      // Past the window, nothing can claim it.
      expect(await store.claimUndo(action.id, "alice", Date.now() + store.UNDO_TTL_MS + 1)).toBe(false);
    });

    it("never stores an undo for a failed action", async () => {
      const action = await store.createAction({ ...base, source: "chat", status: "running", tier: "t1" });
      await store.finishAction(action.id, { error: "boom", undo: { mode: "restore", resource: "saved_query", id: "x", before: {}, afterHash: "h" } });
      expect(await store.getAction(action.id)).toMatchObject({ status: "failed", undo: null, undoExpiresAt: null });
      expect(await store.claimUndo(action.id, "alice")).toBe(false);
    });

    it("grants a T2 tool for a thread or an hour, and nothing else (ADR 0025)", async () => {
      const ts = dialect === "sqlite" ? sql`unixepoch()` : sql`NOW()`;
      const active = dialect === "sqlite" ? 1 : true;
      await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at)
        VALUES ('u-grant', 'g@test.local', 'granter', 'x', ${active}, ${ts}, ${ts})`);
      expect(await grants.hasGrant("u-grant", "run_scheduled_job", "thread-a")).toBe(false);
      await grants.createGrant({ userId: "u-grant", tool: "run_scheduled_job", scope: "thread", threadId: "thread-a" });
      expect(await grants.hasGrant("u-grant", "run_scheduled_job", "thread-a")).toBe(true);
      expect(await grants.hasGrant("u-grant", "run_scheduled_job", "thread-b")).toBe(false);
      expect(await grants.hasGrant("u-grant", "test_alert_channel", "thread-a")).toBe(false);
      await grants.createGrant({ userId: "u-grant", tool: "test_alert_channel", scope: "hour", threadId: null });
      expect(await grants.hasGrant("u-grant", "test_alert_channel", "thread-b")).toBe(true);
      expect(await grants.hasGrant("u-grant", "test_alert_channel", null, Date.now() + 61 * 60_000)).toBe(false);
      await expect(grants.createGrant({ userId: "u-grant", tool: "x", scope: "thread", threadId: null })).rejects.toThrow();
      await grants.pruneGrants(Date.now() + 13 * 60 * 60_000);
      expect(await grants.hasGrant("u-grant", "run_scheduled_job", "thread-a")).toBe(false);
    });
  });
}
