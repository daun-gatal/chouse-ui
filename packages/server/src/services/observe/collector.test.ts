/**
 * The collector scheduler with the admin-set schedule (issue #380): the
 * interval and pause each run resolves from, the lease length, step
 * sub-watermarks, and the per-run cost it records. ClickHouse is a fake
 * client that reports a query summary; everything else is the real code on
 * an in-memory RBAC database.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";

const queries: string[] = [];
const fakeClient = {
  query: async ({ query }: { query: string }) => {
    queries.push(query);
    return {
      json: async () => [{ n: 1 }],
      response_headers: { "x-clickhouse-summary": JSON.stringify({ read_rows: "250", read_bytes: "4096" }) },
    };
  },
};

const realClickhouse = await import("./clickhouse");
mock.module("./clickhouse", () => ({ ...realClickhouse, observeClient: async () => fakeClient }));
const realCapabilities = await import("./capabilities");
mock.module("./capabilities", () => ({ ...realCapabilities, probeCapabilities: async () => ({ serverVersion: "25.3", systemTables: [], systemColumns: {} }) }));

const { closeDatabase } = await import("../../rbac/db");
const { runMigrations } = await import("../../rbac/db/migrations");
const { freshDatabase, rawAll, rawRun } = await import("../../rbac/db/migrationTestHarness");
const { ObserveService } = await import("./collector");
const { resetCollectorSettingsCache, saveSchedules } = await import("./collectorSettings");
const { selectRows } = await import("./clickhouse");

import type { CollectorContext, ConnectionCollector, GlobalCollector } from "./collector";

const CONN = "conn-sched";
const MIN = 60_000;
const T0 = 1_800_000_000_000;

function counting(name: string, intervalMs: number, body?: (ctx: CollectorContext) => Promise<void>): ConnectionCollector & { runs: number[] } {
  const collector = {
    name,
    scope: "connection" as const,
    intervalMs,
    requires: [],
    runs: [] as number[],
    async run(ctx: CollectorContext): Promise<void> {
      collector.runs.push(ctx.nowMs);
      await body?.(ctx);
    },
  };
  return collector;
}

/** A fresh scheduler each time: `lastStarted` lives in memory per instance. */
function scheduler(collectors: Array<ConnectionCollector | GlobalCollector>): InstanceType<typeof ObserveService> {
  const service = new ObserveService();
  for (const c of collectors) service.register(c);
  return service;
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
    VALUES (${CONN}, 'sched', 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await rawRun(sql`DELETE FROM obs_settings`);
  await rawRun(sql`DELETE FROM obs_leases`);
  await rawRun(sql`DELETE FROM obs_collector_status`);
  await rawRun(sql`DELETE FROM obs_watermarks`);
  resetCollectorSettingsCache();
  queries.length = 0;
});

describe("collector schedule", () => {
  it("runs at the built-in interval when nothing is set", async () => {
    const usage = counting("usage", 15 * MIN);
    const service = scheduler([usage]);
    await service.tick(T0);
    await service.tick(T0 + 5 * MIN);
    await service.tick(T0 + 15 * MIN);
    expect(usage.runs).toEqual([T0, T0 + 15 * MIN]);
  });

  it("runs at the default interval, and a connection override wins", async () => {
    await saveSchedules({ connectionId: null }, { usage: { intervalSeconds: 3600 } }, new Set([CONN]), "admin");
    const usage = counting("usage", 15 * MIN);
    const service = scheduler([usage]);
    await service.tick(T0);
    await service.tick(T0 + 15 * MIN);
    await service.tick(T0 + 60 * MIN);
    expect(usage.runs).toEqual([T0, T0 + 60 * MIN]);

    await saveSchedules({ connectionId: CONN }, { usage: { intervalSeconds: 600 } }, new Set([CONN]), "admin");
    await service.tick(T0 + 70 * MIN);
    expect(usage.runs).toEqual([T0, T0 + 60 * MIN, T0 + 70 * MIN]);
  });

  it("skips a paused collector until it is resumed", async () => {
    await saveSchedules({ connectionId: CONN }, { usage: { paused: true } }, new Set([CONN]), "admin");
    const usage = counting("usage", 15 * MIN);
    const catalog = counting("catalog", 5 * MIN);
    const service = scheduler([usage, catalog]);
    await service.tick(T0);
    expect(usage.runs).toEqual([]);
    expect(catalog.runs).toEqual([T0]);

    await saveSchedules({ connectionId: CONN }, {}, new Set([CONN]), "admin");
    await service.tick(T0 + MIN);
    expect(usage.runs).toEqual([T0 + MIN]);
  });

  it("keeps running a global collector whatever a connection sets", async () => {
    const runs: number[] = [];
    const fleet: GlobalCollector = { name: "fleet", scope: "global", intervalMs: 30_000, run: async (_refs, nowMs) => void runs.push(nowMs) };
    await saveSchedules({ connectionId: null }, { fleet: { intervalSeconds: 60 } }, new Set([CONN]), "admin");
    const service = scheduler([fleet]);
    await service.tick(T0);
    await service.tick(T0 + 30_000);
    await service.tick(T0 + 60_000);
    expect(runs).toEqual([T0, T0 + 60_000]);
  });

  it("leases a run for its interval, capped at an hour beyond it", async () => {
    await saveSchedules({ connectionId: null }, { usage: { intervalSeconds: 86_400 }, catalog: { intervalSeconds: 300 } }, new Set([CONN]), "admin");
    const service = scheduler([counting("usage", 15 * MIN), counting("catalog", 5 * MIN)]);
    await service.tick(T0);
    const leases = new Map((await rawAll(sql`SELECT lease_key, expires_at, acquired_at FROM obs_leases`)).map((r) => [String(r.lease_key), Number(r.expires_at) - Number(r.acquired_at)]));
    expect(leases.get(`observe:usage:${CONN}`)).toBe(86_400 + 3_600);
    expect(leases.get(`observe:catalog:${CONN}`)).toBe(900);
  });

  it("keeps step sub-watermarks apart from the collector's own", async () => {
    const usage = counting("usage", 15 * MIN, async (ctx) => {
      await ctx.setWatermark(111);
      await ctx.setWatermark(222, "shapes");
    });
    await scheduler([usage]).tick(T0);
    const marks = await rawAll(sql`SELECT collector, watermark FROM obs_watermarks WHERE connection_id = ${CONN} ORDER BY collector`);
    expect(marks.map((m) => [String(m.collector), Number(m.watermark)])).toEqual([["usage", 111], ["usage:shapes", 222]]);
  });

  it("records what each run read from ClickHouse, also when it fails", async () => {
    const ok = counting("usage", 15 * MIN, async (ctx) => {
      await selectRows(ctx.client, "SELECT 1");
      await selectRows(ctx.client, "SELECT 2");
    });
    const failing = counting("catalog", 5 * MIN, async (ctx) => {
      await selectRows(ctx.client, "SELECT 3");
      throw new Error("boom");
    });
    await scheduler([ok, failing]).tick(T0);
    const status = new Map((await rawAll(sql`SELECT collector, state, read_rows, read_bytes, query_count FROM obs_collector_status`)).map((r) => [String(r.collector), r]));
    expect(status.get("usage")).toMatchObject({ state: "ok", read_rows: 500, read_bytes: 8192, query_count: 2 });
    expect(status.get("catalog")).toMatchObject({ state: "error", read_rows: 250, read_bytes: 4096, query_count: 1 });
    // The two runs interleave (they run in parallel); each still got only its own reads.
    expect([...queries].sort()).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
  });

  it("still runs a query whose response has no summary header, counting it without bytes", async () => {
    const bare = { query: async () => ({ json: async () => [{ n: 1 }] }) };
    const usage = counting("usage", 15 * MIN, async () => {
      await selectRows(bare as never, "SELECT 1");
    });
    await scheduler([usage]).tick(T0);
    const status = await rawAll(sql`SELECT state, read_bytes, query_count FROM obs_collector_status WHERE collector = 'usage'`);
    expect(status[0]).toMatchObject({ state: "ok", read_bytes: 0, query_count: 1 });
  });

  it("falls back to built-in intervals when the stored schedule is unreadable", async () => {
    await rawRun(sql`INSERT INTO obs_settings (setting_key, value, updated_at) VALUES ('collector_settings', 'not json', 0)`);
    const usage = counting("usage", 15 * MIN);
    const service = scheduler([usage]);
    await service.tick(T0);
    await service.tick(T0 + 15 * MIN);
    expect(usage.runs).toEqual([T0, T0 + 15 * MIN]);
  });
});
