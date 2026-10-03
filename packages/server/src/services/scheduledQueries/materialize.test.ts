import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@clickhouse/client";

import { buildCreateStatements, buildStagingDDL, executeMaterialize, resolveWriteTarget, type DestInfo } from "./materialize";
import { plainSession } from "./session";
import type { ExpectedColumn, OutputConfig, ScheduledQueryRow } from "./types";

const COLUMNS: ExpectedColumn[] = [
  { name: "id", type: "UInt64" },
  { name: "day", type: "Date" },
];

function job(outputMode: ScheduledQueryRow["outputMode"], outputConfig: OutputConfig): ScheduledQueryRow {
  return { id: "job1", outputMode, destDatabase: "analytics", destTable: "daily", outputConfig } as ScheduledQueryRow;
}

interface TableRow {
  engine: string;
  engine_full: string;
  partition_key: string;
  sorting_key: string;
  primary_key: string;
}

interface Recorded {
  kind: "query" | "command";
  query: string;
  sessionId?: string;
  settings?: Record<string, unknown>;
}

/**
 * Fake client: answers system.* reads from `tables` (mutated by CREATE statements)
 * and records every statement with its session + settings.
 */
function fakeClient(opts: { tables?: Record<string, TableRow>; clusterShards?: number; parts?: string[] } = {}): { client: ClickHouseClient; log: Recorded[] } {
  const tables: Record<string, TableRow> = { ...opts.tables };
  const log: Recorded[] = [];
  const respond = (data: unknown[]) => ({ json: async () => ({ data }) });
  const client = {
    async query(params: { query: string; query_params?: Record<string, string>; session_id?: string; clickhouse_settings?: Record<string, unknown> }) {
      log.push({ kind: "query", query: params.query, sessionId: params.session_id, settings: params.clickhouse_settings });
      const q = params.query;
      const p = params.query_params ?? {};
      if (q.includes("FROM system.tables")) {
        const t = tables[`${p.db}.${p.tbl}`];
        return respond(t ? [t] : []);
      }
      if (q.includes("FROM system.columns")) return respond(tables[`${p.db}.${p.tbl}`] ? COLUMNS : []);
      if (q.includes("FROM system.clusters")) {
        const shards = opts.clusterShards ?? 1;
        return respond([{ shards, hosts: shards * 2, maxReplicas: 2, isLocal: 1 }]);
      }
      if (q.includes("FROM system.databases")) return respond([{ engine: "Atomic" }]);
      if (q.includes("FROM system.macros")) return respond([{ macro: "shard" }, { macro: "replica" }]);
      if (q.includes("FROM system.server_settings")) return respond([]);
      if (q.includes("FROM system.parts")) return respond((opts.parts ?? []).map((partition_id) => ({ partition_id })));
      return respond([]);
    },
    async command(params: { query: string; session_id?: string; clickhouse_settings?: Record<string, unknown> }) {
      log.push({ kind: "command", query: params.query, sessionId: params.session_id, settings: params.clickhouse_settings });
      const created = /^CREATE TABLE IF NOT EXISTS `(\w+)`\.`(\w+)`/.exec(params.query);
      if (created) {
        const engine = /ENGINE = (\w+)/.exec(params.query)?.[1] ?? "MergeTree";
        const engineFull = params.query.slice(params.query.indexOf("ENGINE = ") + 9);
        tables[`${created[1]}.${created[2]}`] = { engine, engine_full: engineFull, partition_key: "", sorting_key: "id", primary_key: "id" };
      }
      return { query_id: "q", response_headers: { "x-clickhouse-summary": JSON.stringify({ written_rows: "7" }) } };
    },
  };
  return { client: client as unknown as ClickHouseClient, log };
}

const commands = (log: Recorded[]): string[] => log.filter((r) => r.kind === "command").map((r) => r.query);

function run(j: ScheduledQueryRow, client: ClickHouseClient): Promise<number | null> {
  return executeMaterialize({
    client,
    job: j,
    selectSql: "SELECT id, day FROM src",
    params: {},
    queryId: "run1",
    slotAt: 1000,
    signal: new AbortController().signal,
    columns: COLUMNS,
  });
}

describe("buildCreateStatements", () => {
  it("emits one local statement without a cluster", () => {
    const [ddl, ...rest] = buildCreateStatements(job("append", { engine: "MergeTree", orderBy: "id" }), COLUMNS);
    expect(rest).toEqual([]);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS `analytics`.`daily` (");
    expect(ddl).not.toContain("ON CLUSTER");
  });

  it("emits one ON CLUSTER statement for a replicated cluster", () => {
    const statements = buildCreateStatements(
      job("replace", { engine: "ReplicatedMergeTree", orderBy: "id", partitionExpr: "day", cluster: { name: "prod", topology: "replicated" } }),
      COLUMNS,
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("`analytics`.`daily` ON CLUSTER `prod` (");
    expect(statements[0]).toContain("ENGINE = ReplicatedMergeTree\nPARTITION BY day\nORDER BY id");
  });

  it("emits a local table and a Distributed table when sharded", () => {
    const statements = buildCreateStatements(
      job("append", { engine: "ReplicatedMergeTree", orderBy: "id", cluster: { name: "it's", topology: "sharded", shardingKey: "cityHash64(id)" } }),
      COLUMNS,
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("`analytics`.`daily_local` ON CLUSTER `it's` (");
    expect(statements[1]).toBe(
      "CREATE TABLE IF NOT EXISTS `analytics`.`daily` ON CLUSTER `it's` AS `analytics`.`daily_local`\n" +
        "ENGINE = Distributed('it\\'s', 'analytics', 'daily_local', cityHash64(id))",
    );
  });
});

describe("buildStagingDDL", () => {
  const base: DestInfo = { exists: true, engine: "MergeTree", engineFull: "", partitionKey: "day", sortingKey: "id", primaryKey: "id", columns: [] };

  it("clones a non-replicated destination", () => {
    expect(buildStagingDDL("`a`.`s`", "`a`.`d`", base)).toBe("CREATE TABLE IF NOT EXISTS `a`.`s` AS `a`.`d`");
  });

  it("never clones a replicated destination's Keeper path", () => {
    const ddl = buildStagingDDL("`a`.`s`", "`a`.`d`", { ...base, engine: "ReplicatedMergeTree" });
    expect(ddl).toBe("CREATE TABLE IF NOT EXISTS `a`.`s` AS `a`.`d` ENGINE = MergeTree PARTITION BY day ORDER BY id");
  });

  it("keeps a distinct primary key and an empty sorting key", () => {
    const ddl = buildStagingDDL("`a`.`s`", "`a`.`d`", { ...base, engine: "ReplicatedMergeTree", sortingKey: "id, ts", primaryKey: "id" });
    expect(ddl).toContain("ORDER BY id, ts PRIMARY KEY id");
    expect(buildStagingDDL("`a`.`s`", "`a`.`d`", { ...base, engine: "ReplicatedMergeTree", sortingKey: null, primaryKey: null })).toContain("ORDER BY tuple()");
  });
});

describe("resolveWriteTarget", () => {
  it("resolves a Distributed destination to its local table", async () => {
    const { client } = fakeClient({
      tables: { "analytics.daily_local": { engine: "ReplicatedReplacingMergeTree", engine_full: "", partition_key: "", sorting_key: "id", primary_key: "id" } },
    });
    const dest: DestInfo = { exists: true, engine: "Distributed", engineFull: "Distributed('prod', 'analytics', 'daily_local', id)", partitionKey: null, sortingKey: null, primaryKey: null, columns: [] };
    expect((await resolveWriteTarget(plainSession(client), "analytics", dest)).engine).toBe("ReplicatedReplacingMergeTree");
  });
});

describe("executeMaterialize", () => {
  it("pins every statement to one session and checks it after the first", async () => {
    const { client, log } = fakeClient({ tables: { "analytics.daily": { engine: "MergeTree", engine_full: "", partition_key: "", sorting_key: "id", primary_key: "id" } } });
    expect(await run(job("append", {}), client)).toBe(7);
    expect(log.every((r) => r.sessionId === "sq_run1")).toBe(true);
    expect(log[0].settings?.session_check).toBeUndefined();
    expect(log.slice(1).every((r) => r.settings?.session_check === 1)).toBe(true);
  });

  it("creates a missing local destination without ON CLUSTER", async () => {
    const { client, log } = fakeClient();
    await run(job("append", { createIfMissing: true, engine: "MergeTree", orderBy: "id" }), client);
    expect(commands(log)[0]).toStartWith("CREATE TABLE IF NOT EXISTS `analytics`.`daily` (");
    expect(commands(log)[1]).toStartWith("INSERT INTO `analytics`.`daily`");
  });

  it("issues no DDL when the destination already exists", async () => {
    const { client, log } = fakeClient({ tables: { "analytics.daily": { engine: "MergeTree", engine_full: "", partition_key: "", sorting_key: "id", primary_key: "id" } } });
    await run(job("append", { createIfMissing: true, engine: "MergeTree", orderBy: "id" }), client);
    expect(commands(log).filter((q) => q.startsWith("CREATE"))).toEqual([]);
  });

  it("creates a replicated cluster destination with fail-on-any-host DDL settings", async () => {
    const { client, log } = fakeClient();
    await run(job("append", { createIfMissing: true, engine: "ReplicatedMergeTree", orderBy: "id", cluster: { name: "prod", topology: "replicated" } }), client);
    const ddl = log.find((r) => r.kind === "command" && r.query.startsWith("CREATE"));
    expect(ddl?.query).toContain("ON CLUSTER `prod`");
    expect(ddl?.settings).toMatchObject({ distributed_ddl_output_mode: "throw", distributed_ddl_task_timeout: "180" });
  });

  it("creates local + Distributed tables and inserts synchronously through Distributed", async () => {
    const { client, log } = fakeClient({ clusterShards: 3 });
    await run(
      job("append", { createIfMissing: true, engine: "ReplicatedMergeTree", orderBy: "id", cluster: { name: "prod", topology: "sharded", shardingKey: "cityHash64(id)", localTable: "daily_local" } }),
      client,
    );
    const cmds = commands(log);
    expect(cmds[0]).toContain("`analytics`.`daily_local` ON CLUSTER `prod`");
    expect(cmds[1]).toContain("ENGINE = Distributed('prod', 'analytics', 'daily_local', cityHash64(id))");
    const insert = log.find((r) => r.query.startsWith("INSERT"));
    expect(insert?.query).toStartWith("INSERT INTO `analytics`.`daily` (`id`, `day`)");
    expect(insert?.settings).toMatchObject({ insert_deduplication_token: "job1:1000", distributed_foreground_insert: 1 });
  });

  it("fails closed when the cluster topology drifted", async () => {
    const { client, log } = fakeClient({ clusterShards: 2 });
    const j = job("append", { createIfMissing: true, engine: "ReplicatedMergeTree", orderBy: "id", cluster: { name: "prod", topology: "replicated" } });
    await expect(run(j, client)).rejects.toThrow(/cluster destination check failed: .*re-save the job/);
    expect(commands(log)).toEqual([]);
  });

  it("fails closed when an existing cluster destination has the wrong engine", async () => {
    const { client, log } = fakeClient({ tables: { "analytics.daily": { engine: "MergeTree", engine_full: "", partition_key: "", sorting_key: "id", primary_key: "id" } } });
    const j = job("append", { cluster: { name: "prod", topology: "replicated" } });
    await expect(run(j, client)).rejects.toThrow(/Replicated\*MergeTree/);
    expect(commands(log)).toEqual([]);
  });

  it("stages replace into a replicated destination via a plain MergeTree on the pinned node", async () => {
    const { client, log } = fakeClient({
      tables: { "analytics.daily": { engine: "ReplicatedMergeTree", engine_full: "", partition_key: "day", sorting_key: "id", primary_key: "id" } },
      parts: ["20260101", "20260102"],
    });
    await run(job("replace", { cluster: { name: "prod", topology: "replicated" } }), client);
    const cmds = commands(log);
    expect(cmds[0]).toBe("CREATE TABLE IF NOT EXISTS `analytics`.`daily__sq_staging` AS `analytics`.`daily` ENGINE = MergeTree PARTITION BY day ORDER BY id");
    expect(cmds.filter((q) => q.includes("REPLACE PARTITION"))).toHaveLength(2);
    expect(cmds.some((q) => q.includes("ON CLUSTER"))).toBe(false);
    expect(log.every((r) => r.sessionId === "sq_run1")).toBe(true);
  });
});
