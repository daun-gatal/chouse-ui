/**
 * Multi-source e2e for the Data Observability Platform (ADR 0016, gate 8).
 *
 * Runs in the testbed of testbed/observe-e2e (scripts/e2e-observe.sh): a
 * ClickHouse fed by Redpanda (Kafka), RabbitMQ, NATS, an S3-compatible store
 * (S3Queue), Azurite (AzureQueue) and PostgreSQL (MaterializedPostgreSQL and
 * the PostgreSQL engine), plus an older ClickHouse. Every source gets one
 * healthy pipeline and one injected failure; the real collectors then run and
 * the evidence store is asserted end to end:
 *
 * - discovery and lineage edges for every adapter
 * - the status vocabulary per adapter, `unsupported_on_version` on the old node
 * - one root-cause chain per layer (ingestion, transform, external, engine)
 *   and the blast radius
 * - remediation with approval, execution, verification and rollback
 * - DDL preflight blocking a breaking change
 * - workload replay against a canary on a different version
 *
 * Skipped unless OBSERVE_E2E_SOURCES is set.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../../rbac/db/migrationTestHarness";
import { createConnection } from "../../rbac/services/connections";
import { PERMISSIONS } from "../../rbac/schema/base";
import { approveAction, executeAction, proposeAction, rollbackAction, verifyAction, type Actor } from "../remediation/executor";
import * as remediationStore from "../remediation/store";
import { analyzeDdl } from "../schemaPreflight/impact";
import { getReplay, runReplay } from "../upgrades/assess";
import { probeCapabilities } from "./capabilities";
import { observeClient } from "./clickhouse";
import type { CollectorContext, ConnectionCollector } from "./collector";
import { catalogCollector } from "./collectors/catalog";
import { lineageCollector } from "./collectors/lineage";
import { pipelinesCollector } from "./collectors/pipelines";
import { queriesCollector } from "./collectors/queries";
import { tablesCollector } from "./collectors/tables";
import { downstreamOf } from "./rca";
import { computeAndStoreRca, getStoredRca } from "./rcaService";
import { pinCriticality } from "./suggestions";

const ENABLED = Boolean(process.env["OBSERVE_E2E_SOURCES"]);
const URL_ = process.env["OBSERVE_E2E_URL"] ?? "http://clickhouse:8123";
const OLD_URL = process.env["OBSERVE_E2E_OLD_URL"] ?? "http://clickhouse-old:8123";
const PASSWORD = process.env["OBSERVE_E2E_PASSWORD"] ?? "e2e";
const PG_ADMIN_URL = process.env["OBSERVE_E2E_PG_URL"] ?? "postgres://postgres:e2e@postgres:5432/postgres";
const AZURE = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://azurite:10000/devstoreaccount1;";
const RUN = Date.now().toString(36);
const DB = `src_${RUN}`;
const REPL_DB = `crm_repl_${RUN}`;
// MaterializedPostgreSQL names its slot and publication after the source
// database, so every run replicates its own PostgreSQL database.
const PG_DB = `crm_${RUN}`;

const PROPOSER = "e2e-proposer";
const APPROVER_A = "e2e-approver-a";
const APPROVER_B = "e2e-approver-b";
const approverActor = (id: string): Actor => ({ id, roles: ["custom"], permissions: [PERMISSIONS.REMEDIATION_APPROVE, PERMISSIONS.REMEDIATION_APPROVE_HIGH] });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!ENABLED)("observability across every source (ADR 0016)", () => {
  let ch: ClickHouseClient;
  let old: ClickHouseClient;
  let pg: postgres.Sql;
  let pgAdmin: postgres.Sql;
  let connectionId = "";
  let oldConnectionId = "";
  const watermarks = new Map<string, number>();

  async function exec(query: string, client: ClickHouseClient = ch): Promise<void> {
    await client.command({ query, clickhouse_settings: { wait_end_of_query: 1 } });
  }

  async function scalar(query: string): Promise<number> {
    const rs = await ch.query({ query, format: "JSONEachRow" });
    const rows = (await rs.json()) as Array<Record<string, unknown>>;
    return Number(Object.values(rows[0] ?? {})[0] ?? 0);
  }

  async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await sleep(1000);
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  async function runCollector(collector: ConnectionCollector, id = connectionId): Promise<void> {
    const client = await observeClient(id, collector.name);
    const capabilities = await probeCapabilities(id, client, true);
    const key = `${id}:${collector.name}`;
    const ctx: CollectorContext = {
      connection: { id, name: id === connectionId ? "e2e" : "e2e-old" },
      client,
      capabilities,
      nowMs: Date.now(),
      getWatermark: async () => watermarks.get(key) ?? 0,
      setWatermark: async (value) => void watermarks.set(key, value),
    };
    await collector.run(ctx);
  }

  async function pipeline(id: string, conn = connectionId): Promise<{ status: string; reason: string; kind: string; engine: string } | null> {
    const rows = await rawAll(sql`SELECT status, status_reason, kind, engine FROM obs_pipelines WHERE connection_id = ${conn} AND pipeline_id = ${id}`);
    const r = rows[0];
    return r ? { status: String(r.status), reason: String(r.status_reason ?? ""), kind: String(r.kind), engine: String(r.engine) } : null;
  }

  async function incidentFor(pipelineId: string): Promise<string> {
    const rows = await rawAll(sql`SELECT id FROM obs_incidents WHERE connection_id = ${connectionId} AND subject_ref = ${pipelineId} AND status <> 'recovered'`);
    expect(rows.length).toBe(1);
    return String(rows[0].id);
  }

  /** One collection pass, after flushing ClickHouse's logs so the evidence is visible. */
  async function collect(): Promise<void> {
    // Keep the per-sample failures flowing: the external table is read, the timeout view is fed.
    await exec(`INSERT INTO ${DB}.pg_sync SELECT id FROM ${DB}.pg_legacy`).catch(() => undefined);
    await exec(`INSERT INTO ${DB}.events_raw SELECT number, 'e' FROM numbers(5)`).catch(() => undefined);
    // The view's GROUP BY outgrows the insert's memory limit: MEMORY_LIMIT_EXCEEDED.
    await ch.command({ query: `INSERT INTO ${DB}.heavy_raw SELECT number FROM numbers(3)`, clickhouse_settings: { max_memory_usage: "60000000" } }).catch(() => undefined);
    await exec("SYSTEM FLUSH LOGS");
    await runCollector(catalogCollector);
    await runCollector(lineageCollector);
    await runCollector(tablesCollector);
    await runCollector(pipelinesCollector);
  }

  beforeAll(async () => {
    process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
    process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
    process.env.REMEDIATION_MAINTENANCE_WINDOW = "02:00-04:00";
    // The suite runs for minutes, not hours: open pipeline incidents on the first bad run.
    process.env.OBSERVE_INCIDENT_HOLD_SECONDS = "0";
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    for (const id of [PROPOSER, APPROVER_A, APPROVER_B]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@e2e.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
    }
    const url = new URL(URL_);
    connectionId = (await createConnection({ name: "e2e", host: url.hostname, port: Number(url.port || 8123), username: "default", password: PASSWORD, sslEnabled: false })).id;
    const oldUrl = new URL(OLD_URL);
    oldConnectionId = (await createConnection({ name: "e2e-old", host: oldUrl.hostname, port: Number(oldUrl.port || 8123), username: "default", password: PASSWORD, sslEnabled: false })).id;
    ch = createClient({ url: URL_, username: "default", password: PASSWORD, request_timeout: 120_000 });
    old = createClient({ url: OLD_URL, username: "default", password: PASSWORD, request_timeout: 120_000 });
    pgAdmin = postgres(PG_ADMIN_URL, { max: 1, onnotice: () => undefined });
    await pgAdmin.unsafe(`CREATE DATABASE ${PG_DB}`);
    const pgUrl = new URL(PG_ADMIN_URL);
    pgUrl.pathname = `/${PG_DB}`;
    pg = postgres(pgUrl.toString(), { max: 1, onnotice: () => undefined });

    // --- PostgreSQL source tables -------------------------------------------------
    await pg.unsafe(`CREATE TABLE accounts_${RUN} (id int primary key, name text)`);
    await pg.unsafe(`INSERT INTO accounts_${RUN} SELECT g, 'a' || g FROM generate_series(1, 100) g`);
    await pg.unsafe(`CREATE TABLE legacy_${RUN} (id int primary key)`);

    await exec(`CREATE DATABASE ${DB}`);

    // --- Kafka (Redpanda): healthy topic and a topic of malformed JSON -------------
    await exec(`CREATE TABLE ${DB}.kafka_pub (id UInt64, v String) ENGINE = Kafka SETTINGS kafka_broker_list = 'redpanda:9092', kafka_topic_list = 'orders_${RUN}', kafka_group_name = 'pub_${RUN}', kafka_format = 'JSONEachRow'`);
    await exec(`CREATE TABLE ${DB}.kafka_bad_pub (raw String) ENGINE = Kafka SETTINGS kafka_broker_list = 'redpanda:9092', kafka_topic_list = 'orders_bad_${RUN}', kafka_group_name = 'pub_bad_${RUN}', kafka_format = 'RawBLOB'`);
    await exec(`INSERT INTO ${DB}.kafka_pub SELECT number, toString(number) FROM numbers(1000)`);
    await exec(`INSERT INTO ${DB}.kafka_bad_pub VALUES ('{not json')`);
    await exec(`DROP TABLE ${DB}.kafka_pub`);
    await exec(`DROP TABLE ${DB}.kafka_bad_pub`);
    for (const [name, topic] of [["kafka", `orders_${RUN}`], ["kafka_bad", `orders_bad_${RUN}`]] as const) {
      await exec(`CREATE TABLE ${DB}.${name}_rows (id UInt64, v String) ENGINE = MergeTree ORDER BY id`);
      await exec(`CREATE TABLE ${DB}.${name}_in (id UInt64, v String) ENGINE = Kafka SETTINGS kafka_broker_list = 'redpanda:9092', kafka_topic_list = '${topic}', kafka_group_name = 'ch_${name}_${RUN}', kafka_format = 'JSONEachRow'`);
      await exec(`CREATE MATERIALIZED VIEW ${DB}.${name}_mv TO ${DB}.${name}_rows AS SELECT * FROM ${DB}.${name}_in`);
    }

    // --- RabbitMQ and NATS: a healthy flow and a view that rejects every batch ------
    await exec(`CREATE TABLE ${DB}.rmq_in (id UInt64, v String) ENGINE = RabbitMQ SETTINGS rabbitmq_host_port = 'rabbitmq:5672', rabbitmq_exchange_name = 'clicks_${RUN}', rabbitmq_format = 'JSONEachRow', rabbitmq_queue_base = 'clicks_${RUN}'`);
    await exec(`CREATE TABLE ${DB}.rmq_bad_in (id UInt64, v String) ENGINE = RabbitMQ SETTINGS rabbitmq_host_port = 'rabbitmq:5672', rabbitmq_exchange_name = 'clicks_bad_${RUN}', rabbitmq_format = 'JSONEachRow', rabbitmq_queue_base = 'clicks_bad_${RUN}'`);
    await exec(`CREATE TABLE ${DB}.nats_in (id UInt64, v String) ENGINE = NATS SETTINGS nats_url = 'nats:4222', nats_subjects = 'events_${RUN}', nats_format = 'JSONEachRow'`);
    await exec(`CREATE TABLE ${DB}.nats_bad_in (id UInt64, v String) ENGINE = NATS SETTINGS nats_url = 'nats:4222', nats_subjects = 'events_bad_${RUN}', nats_format = 'JSONEachRow'`);
    for (const name of ["rmq", "rmq_bad", "nats", "nats_bad"]) {
      const reject = name.endsWith("_bad") ? " WHERE throwIf(id >= 0, 'downstream rejected batch') = 0" : "";
      await exec(`CREATE TABLE ${DB}.${name}_rows (id UInt64, v String) ENGINE = MergeTree ORDER BY id`);
      await exec(`CREATE MATERIALIZED VIEW ${DB}.${name}_mv TO ${DB}.${name}_rows AS SELECT id, v FROM ${DB}.${name}_in${reject}`);
    }
    await sleep(3000);
    for (const name of ["rmq", "rmq_bad", "nats", "nats_bad"]) await exec(`INSERT INTO ${DB}.${name}_in SELECT number, 'x' FROM numbers(200)`);

    // --- S3Queue and AzureQueue: a good file and a malformed one each ---------------
    const s3 = (path: string): string => `'http://s3:9090/events/${RUN}/${path}', 'k', 's'`;
    await exec(`INSERT INTO FUNCTION s3(${s3("good/part1.jsonl")}, 'JSONEachRow', 'id UInt64, v String') SELECT number, 'a' FROM numbers(300)`);
    await exec(`INSERT INTO FUNCTION s3(${s3("bad/part1.jsonl")}, 'RawBLOB', 'raw String') VALUES ('{broken')`);
    await exec(`INSERT INTO FUNCTION azureBlobStorage('${AZURE}', 'events', '${RUN}/good/part1.jsonl', 'JSONEachRow', 'auto', 'id UInt64, v String') SELECT number, 'z' FROM numbers(200)`);
    await exec(`INSERT INTO FUNCTION azureBlobStorage('${AZURE}', 'events', '${RUN}/bad/part1.jsonl', 'RawBLOB', 'auto', 'raw String') VALUES ('{broken')`);
    for (const [name, engine] of [
      ["s3", `S3Queue(${s3("good/*.jsonl")}, 'JSONEachRow') SETTINGS mode = 'unordered'`],
      ["s3_bad", `S3Queue(${s3("bad/*.jsonl")}, 'JSONEachRow') SETTINGS mode = 'unordered', s3queue_loading_retries = 1`],
      ["az", `AzureQueue('${AZURE}', 'events', '${RUN}/good/*.jsonl', 'JSONEachRow') SETTINGS mode = 'unordered'`],
      ["az_bad", `AzureQueue('${AZURE}', 'events', '${RUN}/bad/*.jsonl', 'JSONEachRow') SETTINGS mode = 'unordered', loading_retries = 1`],
    ] as const) {
      await exec(`CREATE TABLE ${DB}.${name}_rows (id UInt64, v String) ENGINE = MergeTree ORDER BY id`);
      await exec(`CREATE TABLE ${DB}.${name}_in (id UInt64, v String) ENGINE = ${engine}`);
      await exec(`CREATE MATERIALIZED VIEW ${DB}.${name}_mv TO ${DB}.${name}_rows AS SELECT * FROM ${DB}.${name}_in`);
    }

    // --- PostgreSQL: replication and an external table whose source disappears -----
    await exec(`CREATE DATABASE ${REPL_DB} ENGINE = MaterializedPostgreSQL('postgres:5432', '${PG_DB}', 'postgres', '${PASSWORD}') SETTINGS materialized_postgresql_tables_list = 'accounts_${RUN}'`);
    await exec(`CREATE TABLE ${DB}.pg_sync (id Int32) ENGINE = MergeTree ORDER BY id`);
    await exec(`CREATE TABLE ${DB}.pg_legacy (id Int32) ENGINE = PostgreSQL('postgres:5432', '${PG_DB}', 'legacy_${RUN}', 'postgres', '${PASSWORD}')`);

    // --- Insert-driven views: one rejects every insert (transform), one runs out of memory (engine)
    await exec(`CREATE TABLE ${DB}.events_raw (id UInt64, v String) ENGINE = MergeTree ORDER BY id`);
    await exec(`CREATE TABLE ${DB}.events_clean (id UInt64, v String) ENGINE = MergeTree ORDER BY id`);
    await exec(`CREATE MATERIALIZED VIEW ${DB}.events_mv TO ${DB}.events_clean AS SELECT id, v FROM ${DB}.events_raw WHERE throwIf(v = 'e', 'value e is not allowed') = 0`);
    await exec(`CREATE TABLE ${DB}.heavy_raw (n UInt64) ENGINE = MergeTree ORDER BY n`);
    await exec(`CREATE TABLE ${DB}.heavy_agg (n UInt64, s UInt64) ENGINE = MergeTree ORDER BY n`);
    await exec(`CREATE MATERIALIZED VIEW ${DB}.heavy_mv TO ${DB}.heavy_agg AS SELECT n, length(groupArray(toString(number))) AS s FROM (SELECT n, arrayJoin(range(2000000)) AS number FROM ${DB}.heavy_raw) GROUP BY n`);

    // Wait for the healthy flows, then break the external table's source.
    await waitFor("kafka rows", async () => (await scalar(`SELECT count() FROM ${DB}.kafka_rows`)) >= 1000);
    await waitFor("rabbitmq rows", async () => (await scalar(`SELECT count() FROM ${DB}.rmq_rows`)) >= 200);
    await waitFor("nats rows", async () => (await scalar(`SELECT count() FROM ${DB}.nats_rows`)) >= 200);
    await waitFor("s3 rows", async () => (await scalar(`SELECT count() FROM ${DB}.s3_rows`)) >= 300);
    await waitFor("azure rows", async () => (await scalar(`SELECT count() FROM ${DB}.az_rows`)) >= 200);
    await waitFor("replicated rows", async () => (await scalar(`SELECT count() FROM ${REPL_DB}.accounts_${RUN}`)) >= 100);
    await pg.unsafe(`INSERT INTO accounts_${RUN} SELECT g, 'b' || g FROM generate_series(101, 150) g`);
    await waitFor("replicated changes", async () => (await scalar(`SELECT count() FROM ${REPL_DB}.accounts_${RUN}`)) >= 150);
    // One successful sync records the lineage edge; then the source disappears.
    await pg.unsafe(`INSERT INTO legacy_${RUN} SELECT g FROM generate_series(1, 10) g`);
    await exec(`INSERT INTO ${DB}.pg_sync SELECT id FROM ${DB}.pg_legacy`);
    await pg.unsafe(`DROP TABLE legacy_${RUN}`);
    // Let the bad sources fail at least once.
    await sleep(8000);

    // First pass learns the catalog and baselines; criticality makes incidents page.
    await collect();
    for (const table of ["kafka_bad_rows", "rmq_bad_rows", "nats_bad_rows", "s3_bad_rows", "az_bad_rows", "pg_sync", "events_clean", "heavy_agg"]) {
      expect(await pinCriticality(connectionId, DB, table, "critical")).toBe(true);
    }
    // Three samples: the classifier needs consecutive evidence.
    for (let i = 0; i < 3; i++) {
      await sleep(4000);
      await collect();
    }
  }, 600_000);

  afterAll(async () => {
    await exec(`DROP DATABASE IF EXISTS ${DB} SYNC`).catch(() => undefined);
    await exec(`DROP DATABASE IF EXISTS ${REPL_DB} SYNC`).catch(() => undefined);
    await pg?.end();
    await pgAdmin?.unsafe(`DROP DATABASE IF EXISTS ${PG_DB} WITH (FORCE)`).catch(() => undefined);
    await pgAdmin?.end();
    await ch?.close();
    await old?.close();
    await closeDatabase();
  }, 120_000);

  it("discovers every source as a pipeline of the right kind", async () => {
    const expectations: Array<[string, string, string]> = [
      [`queue_engine:${DB}.kafka_in`, "queue_engine", "Kafka"],
      [`queue_engine:${DB}.rmq_in`, "queue_engine", "RabbitMQ"],
      [`queue_engine:${DB}.nats_in`, "queue_engine", "NATS"],
      [`object_storage_queue:${DB}.s3_in`, "object_storage_queue", "S3Queue"],
      [`object_storage_queue:${DB}.az_in`, "object_storage_queue", "AzureQueue"],
      [`database_replication:${REPL_DB}.accounts_${RUN}`, "database_replication", "MaterializedPostgreSQL"],
      [`external_table:${DB}.pg_legacy`, "external_table", "PostgreSQL"],
      [`materialized_view:${DB}.events_mv`, "materialized_view", "MaterializedView"],
    ];
    for (const [id, kind, engine] of expectations) {
      const p = await pipeline(id);
      expect({ id, kind: p?.kind, engine: p?.engine }).toEqual({ id, kind, engine });
    }
  });

  it("connects each source to the tables it feeds in the lineage graph", async () => {
    const edges = (await rawAll(sql`SELECT source_id, target_id, kind FROM obs_lineage_edges WHERE connection_id = ${connectionId}`))
      .map((e) => ({ source: String(e.source_id), target: String(e.target_id), kind: String(e.kind) }));
    const next = downstreamOf(edges);
    const reaches = (from: string, to: string): boolean => {
      const seen = new Set([from]);
      let frontier = [from];
      for (let d = 0; d < 6 && frontier.length > 0; d++) {
        frontier = frontier.flatMap(next).filter((n) => !seen.has(n) && seen.add(n));
      }
      return seen.has(to);
    };
    for (const name of ["kafka", "rmq", "nats", "s3", "az"]) {
      expect({ name, reaches: reaches(`table:${DB}.${name}_in`, `table:${DB}.${name}_rows`) }).toEqual({ name, reaches: true });
    }
    expect(reaches(`table:${DB}.events_raw`, `table:${DB}.events_clean`)).toBe(true);
    expect(reaches(`table:${DB}.pg_legacy`, `table:${DB}.pg_sync`)).toBe(true);
  });

  it("judges every source with one status vocabulary", async () => {
    const expected: Array<[string, string[]]> = [
      [`queue_engine:${DB}.kafka_in`, ["healthy"]],
      [`queue_engine:${DB}.kafka_bad_in`, ["retrying"]],
      [`queue_engine:${DB}.rmq_in`, ["healthy"]],
      [`queue_engine:${DB}.rmq_bad_in`, ["retrying"]],
      [`queue_engine:${DB}.nats_in`, ["healthy"]],
      [`queue_engine:${DB}.nats_bad_in`, ["retrying"]],
      [`object_storage_queue:${DB}.s3_in`, ["healthy"]],
      [`object_storage_queue:${DB}.s3_bad_in`, ["failing"]],
      [`object_storage_queue:${DB}.az_in`, ["healthy"]],
      [`object_storage_queue:${DB}.az_bad_in`, ["failing"]],
      [`database_replication:${REPL_DB}.accounts_${RUN}`, ["healthy"]],
      [`external_table:${DB}.pg_legacy`, ["retrying", "failing"]],
      [`materialized_view:${DB}.events_mv`, ["retrying", "failing"]],
      [`materialized_view:${DB}.heavy_mv`, ["retrying", "failing"]],
    ];
    const actual = [];
    for (const [id] of expected) {
      const p = await pipeline(id);
      actual.push({ id, status: p?.status ?? "missing", reason: p?.reason ?? "" });
    }
    for (let i = 0; i < expected.length; i++) {
      expect({ id: expected[i][0], ok: expected[i][1].includes(actual[i].status), status: actual[i].status, reason: actual[i].reason })
        .toMatchObject({ id: expected[i][0], ok: true });
    }
  });

  it("names the feature a server version lacks as unsupported_on_version", async () => {
    await exec(`CREATE DATABASE IF NOT EXISTS ${DB}`, old);
    await old.command({ query: `CREATE TABLE ${DB}.s3_in (id UInt64, v String) ENGINE = S3Queue('http://s3:9090/events/${RUN}/good/*.jsonl', 'k', 's', 'JSONEachRow') SETTINGS mode = 'unordered'`, clickhouse_settings: { allow_experimental_s3queue: 1 } });
    try {
      await runCollector(catalogCollector, oldConnectionId);
      await runCollector(pipelinesCollector, oldConnectionId);
      const p = await pipeline(`object_storage_queue:${DB}.s3_in`, oldConnectionId);
      expect(p?.status).toBe("unsupported_on_version");
      expect(p?.reason).toContain("s3queue_log");
    } finally {
      await exec(`DROP DATABASE IF EXISTS ${DB} SYNC`, old).catch(() => undefined);
    }
  });

  it("traces one root-cause chain per layer and the blast radius", async () => {
    const layersOf = async (pipelineId: string): Promise<string[]> => {
      const id = await incidentFor(pipelineId);
      await computeAndStoreRca("observe", id);
      const rca = await getStoredRca("observe", id);
      return (rca?.chain ?? []).map((s) => s.layer);
    };
    expect(await layersOf(`queue_engine:${DB}.kafka_bad_in`)).toContain("ingestion");
    expect(await layersOf(`materialized_view:${DB}.events_mv`)).toContain("transform");
    expect(await layersOf(`external_table:${DB}.pg_legacy`)).toContain("external");
    expect(await layersOf(`materialized_view:${DB}.heavy_mv`)).toContain("engine");

    const kafkaIncident = await incidentFor(`queue_engine:${DB}.kafka_bad_in`);
    const rca = await getStoredRca("observe", kafkaIncident);
    expect(rca?.blastRadius.map((b) => b.nodeId)).toContain(`table:${DB}.kafka_bad_rows`);
  });

  it("runs a fix through approval, execution, verification and rollback", async () => {
    await exec(`CREATE USER IF NOT EXISTS fixer_${RUN} IDENTIFIED BY 'fixer-pass'`);
    await exec(`GRANT ALTER MODIFY TTL, ALTER TABLE, DROP TABLE, CREATE TABLE, SELECT ON ${DB}.* TO fixer_${RUN}`);
    await exec(`GRANT SELECT ON system.* TO fixer_${RUN}`);
    await exec(`GRANT TABLE ENGINE ON RabbitMQ TO fixer_${RUN}`);
    await remediationStore.setCredential(connectionId, `fixer_${RUN}`, "fixer-pass", null);
    const inWindow = new Date();
    inWindow.setUTCHours(3, 0, 0, 0);

    // High-impact, window-only: two approvers who are not the proposer.
    const ttl = await proposeAction({ connectionId, params: { type: "modify_ttl", database: DB, table: "kafka_rows", ttl: "toDateTime(id) + INTERVAL 1 DAY" }, proposedBy: PROPOSER, proposedSource: "user" });
    await expect(approveAction(ttl.id, approverActor(PROPOSER), "ui", null)).rejects.toThrow("proposer");
    expect((await approveAction(ttl.id, approverActor(APPROVER_A), "ui", null)).action.status).toBe("proposed");
    expect((await approveAction(ttl.id, approverActor(APPROVER_B), "cli", null)).action.status).toBe("approved");
    await expect(executeAction(ttl.id, inWindow.getTime() + 12 * 3600 * 1000)).rejects.toThrow("maintenance window");
    expect((await executeAction(ttl.id, inWindow.getTime())).status).toBe("executed");
    expect(await verifyAction((await remediationStore.getAction(ttl.id))!)).toBe(true);
    expect((await remediationStore.getAction(ttl.id))?.status).toBe("verified");
    expect(await scalar(`SELECT position(create_table_query, 'TTL') > 0 FROM system.tables WHERE database = '${DB}' AND name = 'kafka_rows'`)).toBe(1);
    expect((await rollbackAction(ttl.id, approverActor(APPROVER_A))).status).toBe("rolled_back");
    expect(await scalar(`SELECT position(create_table_query, 'TTL') > 0 FROM system.tables WHERE database = '${DB}' AND name = 'kafka_rows'`)).toBe(0);

    // Class 1, proposed by an agent: still needs someone else, then restarts the stuck consumer.
    const restart = await proposeAction({ connectionId, params: { type: "restart_engine_table", database: DB, table: "rmq_bad_in" }, proposedBy: PROPOSER, proposedSource: "mcp", incidentSource: "observe", incidentId: await incidentFor(`queue_engine:${DB}.rmq_bad_in`) });
    await expect(approveAction(restart.id, approverActor(PROPOSER), "ui", null)).rejects.toThrow("proposer");
    expect((await approveAction(restart.id, approverActor(APPROVER_A), "slack", null)).action.status).toBe("approved");
    expect((await executeAction(restart.id)).status).toBe("executed");
    expect(await verifyAction((await remediationStore.getAction(restart.id))!)).toBe(true);
    expect((await remediationStore.getAction(restart.id))?.status).toBe("verified");
  });

  it("blocks a schema change that breaks a dependent view", async () => {
    const result = await analyzeDdl(connectionId, `ALTER TABLE ${DB}.events_raw DROP COLUMN v`, DB);
    expect(result.breaking).toBe(true);
    expect(result.items.some((i) => i.severity === "breaks" && i.ref.includes("events_mv"))).toBe(true);
    const harmless = await analyzeDdl(connectionId, `ALTER TABLE ${DB}.events_raw ADD COLUMN extra UInt8 DEFAULT 0`, DB);
    expect(harmless.breaking).toBe(false);
  });

  it("replays the workload on a canary running another version", async () => {
    for (let i = 0; i < 5; i++) {
      for (const q of ["SELECT sum(number) FROM numbers(100000)", "SELECT count() FROM numbers(1000) WHERE number % 7 = 0", "SELECT avg(toFloat32(number)) FROM numbers(10000)"]) {
        await ch.query({ query: q, format: "JSONEachRow" }).then((r) => r.json());
      }
    }
    await exec("SYSTEM FLUSH LOGS");
    await runCollector(queriesCollector);
    const id = await runReplay(connectionId, oldConnectionId, null, APPROVER_A, 50);
    let replay = await getReplay(id, true);
    for (let i = 0; i < 60 && replay?.status === "running"; i++) {
      await sleep(1000);
      replay = await getReplay(id, true);
    }
    expect(replay?.status).toBe("done");
    expect(Number(replay?.total)).toBeGreaterThan(0);
    // Total counts every replayed shape: objects missing only on the canary are a
    // schema gap of their own; shapes the baseline itself can no longer run are skipped.
    expect(Number(replay?.same) + Number(replay?.differs) + Number(replay?.slower) + Number(replay?.errors) + Number(replay?.missing)).toBe(Number(replay?.total));
  }, 120_000);
});
