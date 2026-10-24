/** AI memory store (ADR 0024 §Phase 3) on SQLite and PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

const { closeDatabase, getDatabaseType } = await import("../../../rbac/db");
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

async function seedUser(id: string): Promise<void> {
  const sqlite = getDatabaseType() === "sqlite";
  const ts = sqlite ? sql`unixepoch()` : sql`NOW()`;
  await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at)
    VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', ${sqlite ? 1 : true}, ${ts}, ${ts})`);
}

async function seedConnection(id: string): Promise<void> {
  const sqlite = getDatabaseType() === "sqlite";
  const ts = sqlite ? sql`unixepoch()` : sql`NOW()`;
  await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, created_at, updated_at)
    VALUES (${id}, ${`conn ${id}`}, 'localhost', 8123, 'default', ${ts}, ${ts})`);
}

for (const dialect of DIALECTS) {
  describe(`ai memories [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
      for (const u of ["ann", "ben", "gone"]) await seedUser(u);
      for (const c of ["c1", "c2", "c-gone"]) await seedConnection(c);
    }, 120_000);

    it("keeps a user memory at once and does not duplicate it", async () => {
      const first = await store.createMemory({ scope: "user", userId: "ann", connectionId: null, content: "  Prefers   UTC timestamps ", source: "agent", agentSlug: "clickhouse-data", threadId: "t1" });
      expect(first.duplicate).toBe(false);
      expect(first.memory).toMatchObject({ scope: "user", ownerId: "ann", status: "active", content: "Prefers UTC timestamps", agentSlug: "clickhouse-data", proposedBy: "ann" });
      const again = await store.createMemory({ scope: "user", userId: "ann", connectionId: null, content: "prefers utc timestamps", source: "person" });
      expect(again).toMatchObject({ duplicate: true, memory: { id: first.memory.id } });
      expect((await store.listUserMemories("ann")).map((m) => m.id)).toEqual([first.memory.id]);
      expect(await store.listUserMemories("ben")).toEqual([]);
    });

    it("proposes a team memory, and lets one review win", async () => {
      const { memory } = await store.createMemory({ scope: "connection", userId: "ben", connectionId: "c1", content: "events.ts is stored in UTC", source: "agent", flag: null });
      expect(memory).toMatchObject({ scope: "connection", ownerId: null, connectionId: "c1", status: "proposed", proposedBy: "ben", decidedBy: null });
      expect(await store.pendingMemoryCount()).toBe(1);
      const [a, b] = await Promise.all([store.decideMemory(memory.id, true, "ann"), store.decideMemory(memory.id, false, "ben")]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect(await store.pendingMemoryCount()).toBe(0);
      expect(await store.decideMemory(memory.id, true, "ann")).toBeNull();
      // A user memory is never "reviewed".
      const own = await store.createMemory({ scope: "user", userId: "ben", connectionId: null, content: "Likes short answers", source: "person" });
      expect(await store.decideMemory(own.memory.id, false, "ann")).toBeNull();
    });

    it("lets a manager save a team memory directly", async () => {
      const { memory } = await store.createMemory({ scope: "connection", userId: "ann", connectionId: "c2", content: "orders_v1 is deprecated", source: "person", status: "active" });
      expect(memory).toMatchObject({ status: "active", decidedBy: "ann" });
      expect(memory.decidedAt).not.toBeNull();
      const active = await store.listConnectionMemories({ connectionId: "c2", status: "active" });
      expect(active.map((m) => m.content)).toEqual(["orders_v1 is deprecated"]);
      expect((await store.listConnectionMemories({ connectionId: null })).length).toBeGreaterThanOrEqual(2);
      expect((await store.listConnectionMemories({ connectionId: null, proposedBy: "ann" })).every((m) => m.proposedBy === "ann")).toBe(true);
    });

    it("edits, flags and deletes", async () => {
      const { memory } = await store.createMemory({ scope: "user", userId: "ann", connectionId: null, content: "Works on billing", source: "person" });
      const edited = await store.updateMemoryContent(memory.id, "Owns the  billing tables", "Matched X");
      expect(edited).toMatchObject({ content: "Owns the billing tables", flag: "Matched X" });
      await store.deleteMemory(memory.id);
      expect(await store.getMemory(memory.id)).toBeNull();
    });

    it("caps how many notes one person keeps", async () => {
      for (let i = 0; i < store.MEMORY_MAX_PER_OWNER; i++) {
        await store.createMemory({ scope: "user", userId: "gone", connectionId: null, content: `note number ${i}`, source: "person" });
      }
      await expect(store.createMemory({ scope: "user", userId: "gone", connectionId: null, content: "one too many", source: "person" })).rejects.toMatchObject({ statusCode: 409 });
    }, 60_000);

    it("turns memory off and on per user, on by default", async () => {
      expect(await store.memoryEnabled("ben")).toBe(true);
      await store.setMemoryEnabled("ben", false);
      expect(await store.memoryEnabled("ben")).toBe(false);
      await store.setMemoryEnabled("ben", true);
      expect(await store.memoryEnabled("ben")).toBe(true);
    });

    it("deletes memories with their user or connection, but keeps team notes their proposer left", async () => {
      await store.setMemoryEnabled("gone", false);
      const team = await store.createMemory({ scope: "connection", userId: "gone", connectionId: "c1", content: "Proposed by someone who leaves", source: "agent" });
      const onGoneConnection = await store.createMemory({ scope: "connection", userId: "ann", connectionId: "c-gone", content: "About a connection that goes", source: "person" });
      await h.rawRun(sql`DELETE FROM rbac_users WHERE id = 'gone'`);
      expect(await store.listUserMemories("gone")).toEqual([]);
      expect(await h.rowCount("ai_memory_settings")).toBe(1);
      expect(await store.getMemory(team.memory.id)).not.toBeNull();
      await h.rawRun(sql`DELETE FROM rbac_clickhouse_connections WHERE id = 'c-gone'`);
      expect(await store.getMemory(onGoneConnection.memory.id)).toBeNull();
    });
  });
}

describe("normalizeNote", () => {
  it("trims and collapses whitespace", () => {
    expect(store.normalizeNote("  a \n b\t c ")).toBe("a b c");
  });
});
