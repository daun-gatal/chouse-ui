/**
 * Docker-backed e2e for the observability collectors (ADR 0016 §1–§6).
 *
 * Runs every collector against a real ClickHouse with materialized and
 * refreshable views, a queue engine, a Distributed table, a Buffer table, a
 * dictionary and an external writer, then asserts the evidence store:
 * catalog, structural + observed lineage, pipeline statuses, baselines,
 * usage, fingerprints, change events and capacity.
 *
 * Skipped unless OBSERVE_E2E_URL is set (scripts/e2e-observe.sh sets it):
 *   OBSERVE_E2E_URL=http://host:8123 OBSERVE_E2E_PASSWORD=… bun test src/services/observe/observe.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawAll } from "../../rbac/db/migrationTestHarness";
import { createConnection } from "../../rbac/services/connections";
import { probeCapabilities } from "./capabilities";
import type { CollectorContext, ConnectionCollector } from "./collector";
import { catalogCollector } from "./collectors/catalog";
import { changesCollector } from "./collectors/changes";
import { capacityCollector } from "./collectors/capacity";
import { lineageCollector } from "./collectors/lineage";
import { pipelinesCollector } from "./collectors/pipelines";
import { profilesCollector } from "./collectors/profiles";
import { queriesCollector } from "./collectors/queries";
import { tablesCollector } from "./collectors/tables";
import { usageCollector } from "./collectors/usage";
import { observeClient } from "./clickhouse";

const URL_ = process.env["OBSERVE_E2E_URL"] ?? "";
const PASSWORD = process.env["OBSERVE_E2E_PASSWORD"] ?? "";
const DB = `obs_e2e_${Date.now()}`;

describe.skipIf(!URL_)("observability collectors e2e (ADR 0016)", () => {
  let ch: ClickHouseClient;
  let writer: ClickHouseClient;
  let connectionId = "";
  const watermarks = new Map<string, number>();

  async function exec(query: string): Promise<void> {
    await ch.command({ query });
  }

  async function runCollector(collector: ConnectionCollector, nowMs = Date.now()): Promise<void> {
    const client = await observeClient(connectionId, collector.name);
    const capabilities = await probeCapabilities(connectionId, client, true);
    const ctx: CollectorContext = {
      connection: { id: connectionId, name: "e2e" },
      client,
      capabilities,
      nowMs,
      getWatermark: async () => watermarks.get(collector.name) ?? 0,
      setWatermark: async (value) => void watermarks.set(collector.name, value),
    };
    await collector.run(ctx);
  }

  beforeAll(async () => {
    process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
    process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    const url = new URL(URL_);
    connectionId = (await createConnection({ name: "e2e", host: url.hostname, port: Number(url.port || 8123), username: "default", password: PASSWORD, sslEnabled: false })).id;
    ch = createClient({ url: URL_, username: "default", password: PASSWORD });
    writer = createClient({ url: URL_, username: "default", password: PASSWORD, application: "vector-e2e" });

    await exec(`CREATE DATABASE ${DB}`);
    await exec(`CREATE TABLE ${DB}.orders_raw (id UInt64, amount Float64, country LowCardinality(String), created_at DateTime) ENGINE = MergeTree ORDER BY (created_at, id)`);
    await exec(`CREATE TABLE ${DB}.orders_daily (day Date, country LowCardinality(String), orders UInt64, revenue Float64) ENGINE = SummingMergeTree ORDER BY (day, country)`);
    await exec(`CREATE MATERIALIZED VIEW ${DB}.mv_orders TO ${DB}.orders_daily AS SELECT toDate(created_at) AS day, country, count() AS orders, sum(amount) AS revenue FROM ${DB}.orders_raw GROUP BY day, country`);
    // A queue engine whose broker does not exist: the consumer keeps failing.
    await exec(`CREATE TABLE ${DB}.orders_queue (id UInt64, amount Float64, country String, created_at DateTime) ENGINE = Kafka SETTINGS kafka_broker_list = '127.0.0.1:1', kafka_topic_list = 'orders.v2', kafka_group_name = 'e2e', kafka_format = 'JSONEachRow'`);
    await exec(`CREATE MATERIALIZED VIEW ${DB}.mv_queue TO ${DB}.orders_raw AS SELECT id, amount, country, created_at FROM ${DB}.orders_queue`);
    // A refreshable view whose SELECT always throws: every refresh fails.
    await exec(`CREATE TABLE ${DB}.fx_rates (code String, rate Float64) ENGINE = MergeTree ORDER BY code`);
    await exec(`CREATE MATERIALIZED VIEW ${DB}.fx_refresh REFRESH EVERY 1 HOUR TO ${DB}.fx_rates AS SELECT 'EUR' AS code, toFloat64(throwIf(number = 0, 'rates feed unavailable')) AS rate FROM numbers(1)`);
    await exec(`CREATE TABLE ${DB}.orders_dist AS ${DB}.orders_raw ENGINE = Distributed('default', '${DB}', 'orders_raw', rand())`);
    await exec(`CREATE TABLE ${DB}.orders_buffer AS ${DB}.orders_raw ENGINE = Buffer('${DB}', 'orders_raw', 1, 1, 10, 10, 100, 10000, 100000)`);
    await exec(`CREATE DICTIONARY ${DB}.countries (country String, orders UInt64) PRIMARY KEY country SOURCE(CLICKHOUSE(DB '${DB}' TABLE 'orders_daily' USER 'default' PASSWORD '${PASSWORD}')) LIFETIME(300) LAYOUT(COMPLEX_KEY_HASHED())`);

    // An external writer with many small inserts, and some reads.
    for (let i = 0; i < 12; i++) {
      await writer.insert({ table: `${DB}.orders_raw`, values: [{ id: i, amount: 10 + i, country: i % 2 ? "DE" : "FR", created_at: "2026-10-01 10:00:00" }], format: "JSONEachRow" });
    }
    for (let i = 0; i < 6; i++) {
      await ch.query({ query: `SELECT country, sum(revenue) FROM ${DB}.orders_daily WHERE day >= '2026-09-01' GROUP BY country`, format: "JSON" }).then((r) => r.json());
    }
    await exec(`ALTER TABLE ${DB}.orders_raw ADD COLUMN coupon String DEFAULT ''`);
    await exec("SYSTEM FLUSH LOGS");
  }, 120_000);

  afterAll(async () => {
    await ch?.command({ query: `DROP DATABASE IF EXISTS ${DB} SYNC` }).catch(() => undefined);
    await ch?.close();
    await writer?.close();
    await closeDatabase();
  }, 60_000);

  it("collects the catalog and structural lineage for every engine family", async () => {
    await runCollector(catalogCollector);
    const tables = await rawAll(sql`SELECT table_name, engine FROM obs_catalog_tables WHERE connection_id = ${connectionId} AND database_name = ${DB}`);
    expect(tables.map((t) => String(t.table_name)).sort()).toEqual(["countries", "fx_rates", "fx_refresh", "mv_orders", "mv_queue", "orders_buffer", "orders_daily", "orders_dist", "orders_queue", "orders_raw"]);
    const edges = await rawAll(sql`SELECT kind, source_id, target_id FROM obs_lineage_edges WHERE connection_id = ${connectionId}`);
    const has = (kind: string, source: string, target: string): boolean => edges.some((e) => String(e.kind) === kind && String(e.source_id) === source && String(e.target_id) === target);
    expect(has("view_source", `table:${DB}.orders_raw`, `table:${DB}.mv_orders`)).toBe(true);
    expect(has("view_target", `table:${DB}.mv_orders`, `table:${DB}.orders_daily`)).toBe(true);
    expect(has("ingest", "external:kafka:orders.v2", `table:${DB}.orders_queue`)).toBe(true);
    expect(has("view_target", `table:${DB}.fx_refresh`, `table:${DB}.fx_rates`)).toBe(true);
    expect(has("distributed", `table:${DB}.orders_dist`, `table:${DB}.orders_raw`)).toBe(true);
    expect(has("buffer_flush", `table:${DB}.orders_buffer`, `table:${DB}.orders_raw`)).toBe(true);
    expect(has("dictionary_source", `table:${DB}.orders_daily`, `table:${DB}.countries`)).toBe(true);
  });

  it("adds observed writers and readers from query_log", async () => {
    await runCollector(lineageCollector);
    const edges = await rawAll(sql`SELECT kind, source_id, target_id FROM obs_lineage_edges WHERE connection_id = ${connectionId} AND origin = 'observed'`);
    expect(edges.some((e) => String(e.kind) === "write" && String(e.source_id).includes("vector-e2e") && String(e.target_id) === `table:${DB}.orders_raw`)).toBe(true);
    expect(edges.some((e) => String(e.kind).startsWith("reader_") && String(e.source_id) === `table:${DB}.orders_daily`)).toBe(true);
  });

  it("learns baselines and usage", async () => {
    await runCollector(tablesCollector);
    await runCollector(usageCollector);
    const baselines = await rawAll(sql`SELECT table_name, state, reads_7d FROM obs_table_baselines WHERE connection_id = ${connectionId} AND database_name = ${DB}`);
    const raw = baselines.find((b) => String(b.table_name) === "orders_raw");
    expect(raw).toBeDefined();
    expect(["learning", "trusted"]).toContain(String(raw?.state));
    expect(Number(baselines.find((b) => String(b.table_name) === "orders_daily")?.reads_7d)).toBeGreaterThan(0);
  });

  it("classifies pipelines of every kind with one vocabulary", async () => {
    const start = Date.now();
    // Let the first refresh attempt fail before sampling.
    for (let i = 0; i < 20; i++) {
      const [row] = (await (await ch.query({ query: `SELECT exception FROM system.view_refreshes WHERE database = '${DB}' AND view = 'fx_refresh'`, format: "JSONEachRow" })).json()) as Array<{ exception: string }>;
      if (row?.exception) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    for (let i = 0; i < 3; i++) {
      await ch.command({ query: "SYSTEM FLUSH LOGS" });
      await runCollector(pipelinesCollector, start + i * 60_000);
    }
    const pipelines = await rawAll(sql`SELECT pipeline_id, kind, status, status_reason FROM obs_pipelines WHERE connection_id = ${connectionId}`);
    const byId = new Map(pipelines.map((p) => [String(p.pipeline_id), p]));
    expect(byId.get(`materialized_view:${DB}.mv_orders`)?.kind).toBe("materialized_view");
    expect(byId.get(`queue_engine:${DB}.orders_queue`)?.kind).toBe("queue_engine");
    expect(byId.get(`refreshable_view:${DB}.fx_refresh`)?.kind).toBe("refreshable_view");
    expect(byId.get(`distributed:${DB}.orders_dist`)?.kind).toBe("distributed");
    expect(byId.get(`buffer:${DB}.orders_buffer`)?.kind).toBe("buffer");
    expect(byId.get(`dictionary:${DB}.countries`)?.kind).toBe("dictionary");
    expect([...byId.keys()].some((id) => id.startsWith("writer:vector-e2e"))).toBe(true);
    // The refreshable view against an unreachable URL is not healthy.
    expect(["retrying", "failing", "stopped"]).toContain(String(byId.get(`refreshable_view:${DB}.fx_refresh`)?.status));
  }, 60_000);

  it("collects fingerprints, change events, capacity and profiles", async () => {
    await runCollector(queriesCollector);
    await runCollector(changesCollector);
    await runCollector(capacityCollector);
    await runCollector(profilesCollector);
    expect((await rawAll(sql`SELECT 1 FROM obs_query_fingerprints WHERE connection_id = ${connectionId} LIMIT 1`)).length).toBe(1);
    const ddl = await rawAll(sql`SELECT summary FROM obs_change_events WHERE connection_id = ${connectionId} AND kind = 'ddl'`);
    expect(ddl.some((d) => String(d.summary).includes("ADD COLUMN coupon"))).toBe(true);
    expect((await rawAll(sql`SELECT 1 FROM obs_capacity_forecasts WHERE connection_id = ${connectionId}`)).length).toBeGreaterThan(0);
    const caps = await rawAll(sql`SELECT server_version FROM obs_capabilities WHERE connection_id = ${connectionId}`);
    expect(String(caps[0]?.server_version)).toMatch(/^\d+\./);
  }, 60_000);
});
