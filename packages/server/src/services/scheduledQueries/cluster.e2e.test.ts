/**
 * Docker-backed e2e for cluster-aware materialize destinations (ADR 0015).
 *
 * Runs the real writer (`executeMaterialize`) against an isolated 3-node cluster
 * with Keeper (testbed/scheduled-cluster-e2e): `fleet_cluster` (3 shards × 1
 * replica) and `fleet_replicated` (1 shard × 3 replicas). These are the merge-gating checks:
 * cross-replica/cross-shard visibility, retry idempotency, the plain-MergeTree →
 * Replicated staging swap, no per-run cluster DDL, and session pinning.
 *
 * Skipped unless CH_E2E_URLS (comma-separated node HTTP URLs, first = the
 * connection's node) is set:
 *
 *   ./scripts/e2e-scheduled-cluster.sh
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createClient, type ClickHouseClient } from "@clickhouse/client";

import { inspectClusterJob } from "./cluster";
import { describeDestination, executeMaterialize } from "./materialize";
import { plainSession } from "./session";
import type { ExpectedColumn, OutputConfig, ScheduledQueryRow } from "./types";

const URLS = (process.env["CH_E2E_URLS"] ?? "").split(",").map((u) => u.trim()).filter(Boolean);
const USER = process.env["CH_E2E_USER"] ?? "default";
const PASSWORD = process.env["CH_E2E_PASSWORD"] ?? "default";
const DB = `e2e_sq_${Date.now()}`;

const COLUMNS: ExpectedColumn[] = [
  { name: "id", type: "UInt64" },
  { name: "day", type: "Date" },
  { name: "v", type: "UInt64" },
];
const SELECT = "SELECT number AS id, toDate('2026-01-01') + (number % 2) AS day, number * 10 AS v FROM numbers(30)";

describe.skipIf(URLS.length < 3)("scheduled query cluster materialize e2e (ADR 0015)", () => {
  let nodes: ClickHouseClient[] = [];
  const conn = (): ClickHouseClient => nodes[0]!;

  async function scalar(client: ClickHouseClient, query: string): Promise<number> {
    const rs = await client.query({ query, format: "JSON" });
    const json = (await rs.json()) as { data: Array<Record<string, string | number>> };
    return Number(Object.values(json.data[0] ?? { v: 0 })[0]);
  }

  /** Mirror the save route: derive + pin the topology before the job runs. */
  async function saveJob(name: string, outputMode: ScheduledQueryRow["outputMode"], cfg: OutputConfig): Promise<ScheduledQueryRow> {
    const s = plainSession(conn());
    const inspection = await inspectClusterJob(s, {
      cluster: cfg.cluster!,
      outputMode,
      destDatabase: DB,
      destTable: name,
      createIfMissing: Boolean(cfg.createIfMissing),
      engine: cfg.engine,
      orderBy: cfg.orderBy,
    }, (db, tbl) => describeDestination(s, db, tbl));
    expect(inspection.checks.filter((c) => !c.ok)).toEqual([]);
    return {
      id: `job_${name}`,
      outputMode,
      destDatabase: DB,
      destTable: name,
      outputConfig: { ...cfg, cluster: { ...cfg.cluster!, topology: inspection.topology! } },
    } as ScheduledQueryRow;
  }

  function run(job: ScheduledQueryRow, slotAt: number, runId: string): Promise<number | null> {
    return executeMaterialize({
      client: conn(),
      job,
      selectSql: SELECT,
      params: {},
      queryId: runId,
      slotAt,
      signal: new AbortController().signal,
      columns: COLUMNS,
    });
  }

  const ddlQueueSize = (): Promise<number> =>
    scalar(conn(), `SELECT count() FROM system.distributed_ddl_queue WHERE query LIKE '%${DB}%'`);

  beforeAll(async () => {
    nodes = URLS.map((url) => createClient({ url, username: USER, password: PASSWORD, request_timeout: 120_000 }));
    await conn().command({
      query: `CREATE DATABASE IF NOT EXISTS ${DB} ON CLUSTER fleet_cluster`,
      clickhouse_settings: { distributed_ddl_output_mode: "throw" },
    });
  });

  afterAll(async () => {
    if (nodes.length === 0) return;
    try {
      await conn().command({
        query: `DROP DATABASE IF EXISTS ${DB} ON CLUSTER fleet_cluster SYNC`,
        clickhouse_settings: { distributed_ddl_output_mode: "throw" },
      });
    } finally {
      await Promise.all(nodes.map((n) => n.close()));
    }
  });

  it("replicated append: visible on every replica, retry of the same slot is a no-op", async () => {
    const job = await saveJob("rep_append", "append", {
      createIfMissing: true,
      engine: "ReplicatedMergeTree('/clickhouse/tables/{uuid}/single', '{replica}')",
      orderBy: "id",
      cluster: { name: "fleet_replicated" },
    });
    await run(job, 1000, "e2e_rep_a1");
    await run(job, 1000, "e2e_rep_a2"); // retry of the same slot
    for (const node of nodes) {
      await node.command({ query: `SYSTEM SYNC REPLICA ${DB}.rep_append` });
      expect(await scalar(node, `SELECT count() FROM ${DB}.rep_append`)).toBe(30);
    }
  });

  it("replicated replace: plain-MergeTree staging swaps into ReplicatedMergeTree and replicates", async () => {
    const job = await saveJob("rep_replace", "replace", {
      createIfMissing: true,
      engine: "ReplicatedMergeTree('/clickhouse/tables/{uuid}/single', '{replica}')",
      orderBy: "id",
      partitionExpr: "day",
      cluster: { name: "fleet_replicated" },
    });
    await run(job, 2000, "e2e_rep_r1");
    await run(job, 2000, "e2e_rep_r2"); // re-running replaces the same partitions
    for (const node of nodes) {
      await node.command({ query: `SYSTEM SYNC REPLICA ${DB}.rep_replace` });
      expect(await scalar(node, `SELECT count() FROM ${DB}.rep_replace`)).toBe(30);
    }
    expect(await scalar(conn(), `SELECT engine = 'MergeTree' FROM system.tables WHERE database = '${DB}' AND name = 'rep_replace__sq_staging'`)).toBe(1);
  });

  it("sharded append: rows spread over shards via Distributed, retry does not duplicate", async () => {
    const job = await saveJob("sh_append", "append", {
      createIfMissing: true,
      engine: "ReplicatedMergeTree",
      orderBy: "id",
      cluster: { name: "fleet_cluster", shardingKey: "cityHash64(id)" },
    });
    await run(job, 3000, "e2e_sh_a1");
    await run(job, 3000, "e2e_sh_a2");
    const perShard = await Promise.all(nodes.map((n) => scalar(n, `SELECT count() FROM ${DB}.sh_append_local`)));
    expect(perShard.reduce((a, b) => a + b, 0)).toBe(30);
    expect(perShard.filter((c) => c > 0).length).toBeGreaterThan(1);
    expect(await scalar(conn(), `SELECT count() FROM ${DB}.sh_append`)).toBe(30);
  });

  it("sharded upsert: keys colocate and the newest row wins after FINAL", async () => {
    const job = await saveJob("sh_upsert", "upsert", {
      createIfMissing: true,
      engine: "ReplicatedReplacingMergeTree",
      orderBy: "id",
      cluster: { name: "fleet_cluster", shardingKey: "id" },
    });
    await run(job, 4000, "e2e_sh_u1");
    await run(job, 4001, "e2e_sh_u2"); // a NEW slot re-writes the same keys
    expect(await scalar(conn(), `SELECT count() FROM ${DB}.sh_upsert FINAL`)).toBe(30);
  });

  it("issues no cluster DDL once the destination exists", async () => {
    const job = await saveJob("sh_append", "append", {
      createIfMissing: true,
      engine: "ReplicatedMergeTree",
      orderBy: "id",
      cluster: { name: "fleet_cluster", shardingKey: "cityHash64(id)" },
    });
    const before = await ddlQueueSize();
    await run(job, 5000, "e2e_sh_noddl");
    expect(await ddlQueueSize()).toBe(before);
  });

  it("session pinning: a checked statement on another node fails", async () => {
    await conn().query({ query: "SELECT 1", session_id: `e2e_pin_${DB}` });
    await expect(
      nodes[1]!.query({ query: "SELECT 1", session_id: `e2e_pin_${DB}`, clickhouse_settings: { session_check: 1 } }),
    ).rejects.toThrow(/SESSION_NOT_FOUND|Session .* not found/);
  });
});
