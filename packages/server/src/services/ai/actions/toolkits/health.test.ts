/**
 * watch_table's end time (ADR 0025 §6): 09:00 tomorrow in the asker's zone by
 * default, an explicit time when given, never past or beyond a week.
 */

import { describe, expect, it } from "bun:test";

import { HEALTH_ACTIONS, tomorrowAtNine, watchExpiry } from "./health";

const DAY = 24 * 60 * 60 * 1000;

describe("tomorrowAtNine", () => {
  it("is 09:00 the next local day", () => {
    // 2026-10-24 22:30 UTC is already the 25th in Jakarta (UTC+7).
    const now = Date.UTC(2026, 9, 24, 22, 30);
    expect(new Date(tomorrowAtNine(now, "UTC")).toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(new Date(tomorrowAtNine(now, "Asia/Jakarta")).toISOString()).toBe("2026-10-26T02:00:00.000Z");
    expect(new Date(tomorrowAtNine(now, "America/New_York")).toISOString()).toBe("2026-10-25T13:00:00.000Z");
  });

  it("follows a daylight-saving change overnight", () => {
    // Europe/Berlin leaves summer time on 2026-10-25 at 03:00: 09:00 that day is UTC+1.
    const now = Date.UTC(2026, 9, 24, 12, 0);
    expect(new Date(tomorrowAtNine(now, "Europe/Berlin")).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });
});

describe("watchExpiry", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0);

  it("defaults to 09:00 tomorrow, in UTC when the zone is unknown", () => {
    expect(watchExpiry({}, now)).toBe(Date.UTC(2026, 9, 25, 9, 0));
    expect(watchExpiry({ timezone: "Not/AZone" }, now)).toBe(Date.UTC(2026, 9, 25, 9, 0));
    expect(watchExpiry({ timezone: "Asia/Jakarta" }, now)).toBe(Date.UTC(2026, 9, 25, 2, 0));
  });

  it("takes an explicit time within a week, and refuses anything else", () => {
    expect(watchExpiry({ until: "2026-10-27T18:00:00Z" }, now)).toBe(Date.UTC(2026, 9, 27, 18, 0));
    expect(() => watchExpiry({ until: "tomorrow-ish" }, now)).toThrow("not a date");
    expect(() => watchExpiry({ until: "2026-10-24T11:00:00Z" }, now)).toThrow("future");
    expect(() => watchExpiry({ until: new Date(now + 8 * DAY).toISOString() }, now)).toThrow("7 days");
  });
});

describe("watch_table", () => {
  const tool = HEALTH_ACTIONS.find((a) => a.name === "watch_table");

  it("is an undoable Data Health write that needs the event-time column", () => {
    expect(tool).toMatchObject({ toolkit: "health", tier: "t1", connectionScoped: true });
    expect(tool?.undo).toMatchObject({ mode: "delete-created", resource: "health_promise" });
    expect(tool?.schema.safeParse({ database: "shop", table: "orders" }).success).toBe(false);
    expect(tool?.schema.safeParse({ database: "shop", table: "orders", eventTimeColumn: "ts" }).success).toBe(true);
  });

  it("creates a personal, expiring freshness promise checked every 15 minutes", async () => {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
    const api = {
      get: async () => ({}),
      post: async <T>(path: string, body?: unknown): Promise<T> => {
        posts.push({ path, body: body as Record<string, unknown> });
        return { promise: { id: "p1" } } as T;
      },
      put: async () => ({}),
      patch: async () => ({}),
      delete: async () => ({}),
    };
    await tool?.execute({ database: "shop", table: "orders", eventTimeColumn: "created_at", maxAgeMinutes: 30, until: new Date(Date.now() + 3 * 3_600_000).toISOString() }, { api, connectionId: "c1", userId: "u1" });
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe("/api/data-health");
    expect(posts[0].body).toMatchObject({
      connectionId: "c1",
      name: "Watch: shop.orders",
      frequency: "cron",
      cronExpr: "*/15 * * * *",
      source: { sourceType: "table", databaseName: "shop", tableName: "orders", eventTimeColumn: "created_at", eventTimeEncoding: "native" },
      checks: [{ type: "freshness", config: { eventTimeColumn: "created_at", maxAgeSeconds: 1800 } }],
    });
    expect(typeof posts[0].body.expiresAt).toBe("number");
    expect(tool?.describe({ database: "shop", table: "orders", eventTimeColumn: "created_at", until: "2026-10-27T18:00:00Z" })).toContain("until 2026-10-27T18:00:00Z");
  });
});
