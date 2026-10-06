import { describe, expect, it } from "bun:test";

import type { ClickHouseClient } from "@clickhouse/client";

import {
  databaseReplication,
  externalTables,
  isSourceFailure,
  queueEngines,
  refreshableViews,
  refreshPeriodSeconds,
  viewProgress,
  type AdapterContext,
  type CatalogTable,
} from "./adapters";

describe("viewProgress", () => {
  it("counts a run that wrote rows as progress", () => {
    expect(viewProgress([{ ok: 3, wrote: 1, failed: 2 }])).toBe(true);
  });

  it("accepts successful runs that wrote nothing when nothing failed", () => {
    expect(viewProgress([{ ok: 5, wrote: 0, failed: 0 }])).toBe(true);
  });

  it("does not mistake a queue's empty polls for progress while batches fail", () => {
    expect(viewProgress([{ ok: 4461, wrote: 0, failed: 1 }])).toBe(false);
  });

  it("is false without any successful run", () => {
    expect(viewProgress([{ ok: 0, wrote: 0, failed: 0 }])).toBe(false);
    expect(viewProgress([])).toBe(false);
  });
});

describe("refreshPeriodSeconds", () => {
  it("reads EVERY and AFTER, plural units and long periods", () => {
    expect(refreshPeriodSeconds("CREATE MATERIALIZED VIEW v REFRESH EVERY 1 DAY OFFSET 2 HOUR AS SELECT 1")).toBe(86_400);
    expect(refreshPeriodSeconds("CREATE MATERIALIZED VIEW v REFRESH AFTER 30 MINUTES AS SELECT 1")).toBe(1800);
    expect(refreshPeriodSeconds("CREATE MATERIALIZED VIEW v REFRESH EVERY 1 MONTH AS SELECT 1")).toBe(31 * 86_400);
  });

  it("adds compound intervals and RANDOMIZE FOR jitter", () => {
    expect(refreshPeriodSeconds("CREATE MATERIALIZED VIEW v REFRESH EVERY 1 HOUR 30 MINUTE RANDOMIZE FOR 10 MINUTE AS SELECT 1")).toBe(6000);
  });

  it("is null when there is no readable schedule", () => {
    expect(refreshPeriodSeconds("CREATE MATERIALIZED VIEW v TO t AS SELECT 1")).toBeNull();
  });
});

describe("isSourceFailure", () => {
  it("counts an unreachable source and ignores the caller's own mistakes", () => {
    expect(isSourceFailure("Code: 614. DB::Exception: connection refused (POSTGRESQL_CONNECTION_FAILURE)")).toBe(true);
    expect(isSourceFailure("Code: 47. DB::Exception: Unknown identifier: x (UNKNOWN_IDENTIFIER)")).toBe(false);
    expect(isSourceFailure("Code: 62. DB::Exception: Syntax error (SYNTAX_ERROR)")).toBe(false);
    expect(isSourceFailure("Code: 241. DB::Exception: Memory limit exceeded (MEMORY_LIMIT_EXCEEDED)")).toBe(false);
  });
});

/** A ClickHouse client that answers each query with the rows of the first matching pattern. */
function fakeClient(answers: Array<[RegExp, Array<Record<string, unknown>>]>): ClickHouseClient {
  const client = {
    query: async ({ query }: { query: string }) => ({
      json: async () => answers.find(([pattern]) => pattern.test(query))?.[1] ?? [],
    }),
  };
  return client as unknown as ClickHouseClient;
}

const NOW = 1_800_000_000_000;

function adapterCtx(client: ClickHouseClient, tables: string[], extra: Partial<AdapterContext> = {}): AdapterContext {
  return {
    client,
    capabilities: { connectionId: "c", serverVersion: "26.5", systemTables: new Set(tables), systemColumns: new Map([["view_refreshes", new Set(["last_success_time"])]]), probedAt: NOW },
    nowMs: NOW,
    sinceMs: NOW - 60_000,
    previous: new Map(),
    viewsBySource: new Map(),
    ...extra,
  };
}

const table = (database: string, name: string, engine: string, createQuery = ""): CatalogTable => ({ database, table: name, engine, createQuery, totalRows: null });

describe("queueEngines (Kafka)", () => {
  const kafka = [table("db", "events_queue", "Kafka")];
  const viewsBySource = new Map([["table:db.events_queue", ["db.events_mv"]]]);
  const row = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    database: "db", table: "events_queue", messages: 100, commits: 10,
    last_commit_ms: NOW - 6 * 3600_000, last_poll_ms: NOW - 1000, exception_ms: 0, exception: "", ...overrides,
  });

  it("treats a consumer polling an empty topic as alive", async () => {
    const ctx = adapterCtx(fakeClient([[/kafka_consumers/, [row({})]]]), ["kafka_consumers"], { viewsBySource, previous: new Map([["queue_engine:db.events_queue", { messages: 100, commits: 10 }]]) });
    const out = await queueEngines(ctx, kafka, new Map());
    const sample = out.samples.get("queue_engine:db.events_queue");
    expect(sample?.lastSuccessAt).toBe(NOW - 1000);
    expect(sample?.progressing).toBeNull();
    expect(out.attrs.get("queue_engine:db.events_queue")?.expectsRecurring).toBe(true);
  });

  it("sets no expectation for a consumer without an attached view", async () => {
    const ctx = adapterCtx(fakeClient([[/kafka_consumers/, [row({})]]]), ["kafka_consumers"]);
    const out = await queueEngines(ctx, kafka, new Map());
    expect(out.attrs.get("queue_engine:db.events_queue")?.expectsRecurring).toBe(false);
  });
});

describe("refreshableViews", () => {
  it("marks a view stopped with SYSTEM STOP VIEW as paused and follows its TO table", async () => {
    const view = table("db", "daily_rollup", "MaterializedView", "CREATE MATERIALIZED VIEW db.daily_rollup REFRESH EVERY 1 DAY TO db.rollup AS SELECT 1");
    const client = fakeClient([[/view_refreshes/, [{ database: "db", view: "daily_rollup", status: "Disabled", last_success: NOW - 3 * 86_400_000, next_refresh: 0, exception: "", retry: 0, written_rows: 0 }]]]);
    const out = await refreshableViews(adapterCtx(client, ["view_refreshes"]), [view]);
    const attrs = out.attrs.get("refreshable_view:db.daily_rollup");
    expect(attrs?.paused).toContain("SYSTEM STOP VIEW");
    expect(attrs?.writesTo).toBe("table:db.rollup");
    expect(attrs?.periodSeconds).toBe(86_400);
  });
});

describe("databaseReplication", () => {
  it("judges a quiet table by the whole replicated database", async () => {
    const tables = [table("pg", "orders", "ReplacingMergeTree"), table("pg", "countries", "ReplacingMergeTree")];
    const client = fakeClient([[/part_log/, [{ database: "pg", table: "orders", parts: 3, rows: 30, last_ms: NOW - 5000 }]]]);
    const out = await databaseReplication(adapterCtx(client, ["part_log"]), tables, new Map([["pg", "MaterializedPostgreSQL"]]));
    expect(out.samples.get("database_replication:pg.countries")?.lastSuccessAt).toBe(NOW - 5000);
  });
});

describe("externalTables", () => {
  it("ignores failing queries that are the caller's mistake", async () => {
    const client = fakeClient([[/query_log/, [
      { tbl: "db.pg_users", code: 0, ok: 4, failed: 0, last_ok_ms: NOW - 1000, exception: "" },
      { tbl: "db.pg_users", code: 47, ok: 0, failed: 2, last_ok_ms: 0, exception: "Unknown identifier: nme (UNKNOWN_IDENTIFIER)" },
    ]]]);
    const out = await externalTables(adapterCtx(client, []), [table("db", "pg_users", "PostgreSQL")]);
    const sample = out.samples.get("external_table:db.pg_users");
    expect(sample?.errors).toBe(0);
    expect(sample?.progressing).toBe(true);
  });

  it("counts an unreachable source", async () => {
    const client = fakeClient([[/query_log/, [
      { tbl: "db.pg_users", code: 614, ok: 0, failed: 3, last_ok_ms: 0, exception: "connection refused (POSTGRESQL_CONNECTION_FAILURE)" },
    ]]]);
    const out = await externalTables(adapterCtx(client, []), [table("db", "pg_users", "PostgreSQL")]);
    const sample = out.samples.get("external_table:db.pg_users");
    expect(sample?.errors).toBe(3);
    expect(sample?.progressing).toBe(false);
  });
});
