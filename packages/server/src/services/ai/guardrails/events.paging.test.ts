/**
 * The Recent triggers query on SQLite and PostgreSQL: filters, the total that
 * pages are counted against, and stable paging when rows share a timestamp.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import * as h from "../../../rbac/db/migrationTestHarness";
import { guardrailEvents } from "./events";

const DIALECTS: h.Dialect[] = ["sqlite", "postgres"];
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

let pg: h.PostgresContainer | undefined;

beforeAll(async () => {
  pg = await h.startPostgresContainer();
}, 180_000);

afterAll(async () => {
  await closeDatabase();
  pg?.stop();
}, 30_000);

async function seed(id: string, createdAt: number, guardrailId: string, mode: string): Promise<void> {
  await h.rawRun(sql`
    INSERT INTO ai_guardrail_events (id, created_at, guardrail_id, guardrail_name, kind, stage, action, mode, match_count, source)
    VALUES (${id}, ${createdAt}, ${guardrailId}, ${guardrailId}, 'pattern', 'tool_result', 'redact', ${mode}, 2, 'agent')`);
}

for (const dialect of DIALECTS) {
  describe(`guardrailEvents [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations();
      // 30 recent pii triggers (alternating mode, ten sharing one timestamp), 5 secrets, 3 outside a one-day window.
      for (let i = 0; i < 30; i++) await seed(`pii-${String(i).padStart(2, "0")}`, i < 10 ? NOW - 1000 : NOW - 1000 - i * 60_000, "pii", i % 2 === 0 ? "enforce" : "shadow");
      for (let i = 0; i < 5; i++) await seed(`sec-${i}`, NOW - 2000 - i, "secrets", "enforce");
      for (let i = 0; i < 3; i++) await seed(`old-${i}`, NOW - 3 * DAY, "pii", "enforce");
    }, 60_000);

    const base = { since: NOW - DAY, guardrailId: null, mode: null, limit: 100, offset: 0 } as const;

    it("counts every match while returning one page, as numbers", async () => {
      const page = await guardrailEvents({ ...base, limit: 10 });
      expect(page.total).toBe(35);
      expect(typeof page.total).toBe("number");
      expect(page.events).toHaveLength(10);
      expect(typeof page.events[0].createdAt).toBe("number");
      expect(typeof page.events[0].matchCount).toBe("number");
      expect((await guardrailEvents({ ...base, since: NOW - 7 * DAY })).total).toBe(38);
    });

    it("pages newest first without gaps or repeats, ties included", async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < 35; offset += 8) {
        const page = await guardrailEvents({ ...base, limit: 8, offset });
        expect(page.total).toBe(35);
        seen.push(...page.events.map((e) => e.id));
      }
      expect(seen).toHaveLength(35);
      expect(new Set(seen).size).toBe(35);
      const all = (await guardrailEvents(base)).events;
      expect(all.map((e) => e.id)).toEqual(seen);
      for (let i = 1; i < all.length; i++) expect(all[i - 1].createdAt).toBeGreaterThanOrEqual(all[i].createdAt);
      expect((await guardrailEvents({ ...base, offset: 35 })).events).toEqual([]);
    });

    it("filters by guardrail and mode, alone and together", async () => {
      expect((await guardrailEvents({ ...base, guardrailId: "secrets" })).total).toBe(5);
      const shadow = await guardrailEvents({ ...base, mode: "shadow" });
      expect(shadow.total).toBe(15);
      expect(shadow.events.every((e) => e.mode === "shadow")).toBe(true);
      const both = await guardrailEvents({ ...base, guardrailId: "pii", mode: "enforce", limit: 4, offset: 12 });
      expect(both.total).toBe(15);
      expect(both.events.map((e) => [e.guardrailId, e.mode])).toEqual([["pii", "enforce"], ["pii", "enforce"], ["pii", "enforce"]]);
      expect((await guardrailEvents({ ...base, guardrailId: "secrets", mode: "shadow" })).total).toBe(0);
    });
  });
}
