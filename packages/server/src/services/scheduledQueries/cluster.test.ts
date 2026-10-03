import { describe, expect, it } from "bun:test";

import {
  colocationError,
  destinationChecks,
  inspectClusterJob,
  localTableName,
  parseDistributedEngine,
  parseReplicatedEngine,
  referencedIdentifiers,
  shardingKeyErrors,
  topologyFor,
  type ClusterJobInput,
  type TableShape,
} from "./cluster";
import type { ChSession } from "./session";

const MISSING: TableShape = { exists: false, engine: null, engineFull: null, sortingKey: null };

interface FakeState {
  clusters?: { shards: number; hosts: number; maxReplicas: number; isLocal: number } | null;
  dbEngine?: string | null;
  macros?: string[];
  serverSettings?: Array<{ name: string; value: string }>;
  tables?: Record<string, TableShape>;
}

function fakeSession(state: FakeState): ChSession {
  return {
    async rows<T>(query: string): Promise<T[]> {
      if (query.includes("FROM system.clusters")) {
        return (state.clusters === null ? [{ shards: 0, hosts: 0, maxReplicas: 0, isLocal: 0 }] : [state.clusters ?? { shards: 1, hosts: 3, maxReplicas: 3, isLocal: 1 }]) as T[];
      }
      if (query.includes("FROM system.databases")) {
        return (state.dbEngine === null ? [] : [{ engine: state.dbEngine ?? "Atomic" }]) as T[];
      }
      if (query.includes("FROM system.macros")) return (state.macros ?? ["shard", "replica"]).map((macro) => ({ macro })) as T[];
      if (query.includes("FROM system.server_settings")) return (state.serverSettings ?? []) as T[];
      return [];
    },
    async command(): Promise<never> {
      throw new Error("inspection must not issue commands");
    },
  };
}

const describeFrom = (tables: Record<string, TableShape> = {}) =>
  async (db: string, tbl: string): Promise<TableShape> => tables[`${db}.${tbl}`] ?? MISSING;

function input(overrides: Partial<ClusterJobInput> = {}): ClusterJobInput {
  return {
    cluster: { name: "prod" },
    outputMode: "append",
    destDatabase: "analytics",
    destTable: "daily",
    createIfMissing: true,
    engine: "ReplicatedMergeTree",
    orderBy: "id",
    ...overrides,
  };
}

const failed = (checks: Array<{ id: string; ok: boolean }>): string[] => checks.filter((c) => !c.ok).map((c) => c.id);

describe("topology + naming", () => {
  it("derives topology from the shard count", () => {
    expect(topologyFor(1)).toBe("replicated");
    expect(topologyFor(3)).toBe("sharded");
  });

  it("defaults the local table to <dest>_local", () => {
    expect(localTableName("daily", { name: "c" })).toBe("daily_local");
    expect(localTableName("daily", { name: "c", localTable: " shard_daily " })).toBe("shard_daily");
  });
});

describe("sharding key rules", () => {
  it("requires a key", () => {
    expect(shardingKeyErrors(undefined)).toHaveLength(1);
    expect(shardingKeyErrors("  ")).toHaveLength(1);
  });

  it("rejects nondeterministic functions", () => {
    for (const key of ["rand()", "cityHash64(id, now())", "generateUUIDv4()", "randomString(3)", "rowNumberInAllBlocks()"]) {
      expect(shardingKeyErrors(key).some((e) => e.includes("deterministic"))).toBe(true);
    }
  });

  it("accepts deterministic expressions over columns", () => {
    expect(shardingKeyErrors("cityHash64(user_id)")).toEqual([]);
    expect(shardingKeyErrors("id")).toEqual([]);
  });

  it("ignores function names inside string literals and requires a column", () => {
    expect(shardingKeyErrors("cityHash64('rand()')")).toEqual(["Sharding key must reference at least one output column"]);
  });

  it("extracts identifiers but not functions, literals or SQL words", () => {
    expect([...referencedIdentifiers("cityHash64(user_id, `odd col`) % 3 AND x")].sort()).toEqual(["odd col", "user_id", "x"]);
  });

  it("requires upsert sharding-key columns to be in ORDER BY", () => {
    expect(colocationError("cityHash64(id)", "(id, ts)")).toBeNull();
    expect(colocationError("cityHash64(tenant)", "(id, ts)")).toContain("tenant");
    expect(colocationError("id", null)).toContain("id");
  });
});

describe("engine parsing", () => {
  it("parses replicated engines with and without explicit paths", () => {
    expect(parseReplicatedEngine("ReplicatedMergeTree")).toEqual({ family: "ReplicatedMergeTree", path: null, replica: null });
    expect(parseReplicatedEngine("ReplicatedReplacingMergeTree(ver)")).toEqual({ family: "ReplicatedReplacingMergeTree", path: null, replica: null });
    expect(parseReplicatedEngine("ReplicatedMergeTree('/ch/{shard}/t', '{replica}')")).toEqual({ family: "ReplicatedMergeTree", path: "/ch/{shard}/t", replica: "{replica}" });
    expect(parseReplicatedEngine("MergeTree")).toBeNull();
    expect(parseReplicatedEngine(undefined)).toBeNull();
  });

  it("parses Distributed engine_full in quoted and bare forms", () => {
    expect(parseDistributedEngine("Distributed('prod', 'analytics', 'daily_local', cityHash64(id))")).toEqual({ cluster: "prod", database: "analytics", table: "daily_local" });
    expect(parseDistributedEngine("Distributed(`prod`, analytics, daily_local)")).toEqual({ cluster: "prod", database: "analytics", table: "daily_local" });
    expect(parseDistributedEngine("MergeTree ORDER BY id")).toBeNull();
    expect(parseDistributedEngine("Distributed('prod')")).toBeNull();
  });
});

describe("destinationChecks", () => {
  const replicated: TableShape = { exists: true, engine: "ReplicatedMergeTree", engineFull: "ReplicatedMergeTree(...)", sortingKey: "id" };
  const dist: TableShape = { exists: true, engine: "Distributed", engineFull: "Distributed('prod', 'analytics', 'daily_local', id)", sortingKey: null };

  it("accepts a replicated table for a replicated cluster and rejects plain MergeTree", () => {
    expect(failed(destinationChecks("prod", "replicated", "analytics", "", replicated, null))).toEqual([]);
    expect(failed(destinationChecks("prod", "replicated", "analytics", "", { ...replicated, engine: "MergeTree" }, null))).toEqual(["destination.engine"]);
  });

  it("requires Distributed over the configured local table when sharded", () => {
    expect(failed(destinationChecks("prod", "sharded", "analytics", "daily_local", dist, replicated))).toEqual([]);
    expect(failed(destinationChecks("prod", "sharded", "analytics", "other_local", dist, replicated))).toEqual(["destination.engine"]);
    expect(failed(destinationChecks("other", "sharded", "analytics", "daily_local", dist, replicated))).toEqual(["destination.engine"]);
    expect(failed(destinationChecks("prod", "sharded", "analytics", "daily_local", dist, { ...replicated, engine: "MergeTree" }))).toEqual(["destination.local"]);
  });

  it("does not report missing tables", () => {
    expect(destinationChecks("prod", "sharded", "analytics", "daily_local", MISSING, MISSING)).toEqual([]);
  });
});

describe("inspectClusterJob", () => {
  it("passes a replicated cluster with defaults and defined macros", async () => {
    const r = await inspectClusterJob(fakeSession({}), input(), describeFrom());
    expect(r.ok).toBe(true);
    expect(r.topology).toBe("replicated");
    expect(r.checks.find((c) => c.id === "engine.macros")?.ok).toBe(true);
  });

  it("fails fast when the cluster is unknown", async () => {
    const r = await inspectClusterJob(fakeSession({ clusters: null }), input(), describeFrom());
    expect(r.ok).toBe(false);
    expect(r.topology).toBeNull();
    expect(failed(r.checks)).toEqual(["cluster.exists"]);
  });

  it("rejects a connection that is not a cluster member", async () => {
    const r = await inspectClusterJob(fakeSession({ clusters: { shards: 1, hosts: 2, maxReplicas: 2, isLocal: 0 } }), input(), describeFrom());
    expect(failed(r.checks)).toContain("cluster.local");
  });

  it("rejects missing and Replicated-engine databases", async () => {
    expect(failed((await inspectClusterJob(fakeSession({ dbEngine: null }), input(), describeFrom())).checks)).toContain("database.exists");
    expect(failed((await inspectClusterJob(fakeSession({ dbEngine: "Replicated" }), input(), describeFrom())).checks)).toContain("database.engine");
  });

  it("fails on topology drift against the stored topology", async () => {
    const sharded = { shards: 2, hosts: 4, maxReplicas: 2, isLocal: 1 };
    const r = await inspectClusterJob(
      fakeSession({ clusters: sharded }),
      input({ expectedTopology: "replicated", cluster: { name: "prod", shardingKey: "id" } }),
      describeFrom(),
    );
    expect(failed(r.checks)).toContain("cluster.topology");
  });

  it("rejects plain MergeTree and missing macros when creating", async () => {
    expect(failed((await inspectClusterJob(fakeSession({}), input({ engine: "MergeTree" }), describeFrom())).checks)).toEqual(["engine.replicated"]);
    expect(failed((await inspectClusterJob(fakeSession({ macros: ["replica"] }), input(), describeFrom())).checks)).toEqual(["engine.macros"]);
  });

  it("validates explicit Keeper paths per topology", async () => {
    const noReplica = input({ engine: "ReplicatedMergeTree('/ch/{shard}/t', 'r1')" });
    expect(failed((await inspectClusterJob(fakeSession({}), noReplica, describeFrom())).checks)).toEqual(["engine.replicaPath"]);
    const sharded = { shards: 2, hosts: 2, maxReplicas: 1, isLocal: 1 };
    const noShard = input({ engine: "ReplicatedMergeTree('/ch/{uuid}', '{replica}')", cluster: { name: "prod", shardingKey: "id" } });
    expect(failed((await inspectClusterJob(fakeSession({ clusters: sharded }), noShard, describeFrom())).checks)).toEqual(["engine.replicaPath"]);
  });

  it("uses the server's default replica path when no args are given", async () => {
    const sharded = { shards: 2, hosts: 2, maxReplicas: 1, isLocal: 1 };
    const r = await inspectClusterJob(
      fakeSession({ clusters: sharded, serverSettings: [{ name: "default_replica_path", value: "/ch/{uuid}" }] }),
      input({ cluster: { name: "prod", shardingKey: "id" } }),
      describeFrom(),
    );
    expect(failed(r.checks)).toEqual(["engine.replicaPath"]);
  });

  it("blocks replace and requires a sharding key on sharded clusters", async () => {
    const sharded = { shards: 3, hosts: 3, maxReplicas: 1, isLocal: 1 };
    const r = await inspectClusterJob(fakeSession({ clusters: sharded }), input({ outputMode: "replace" }), describeFrom());
    expect(r.topology).toBe("sharded");
    expect(failed(r.checks)).toEqual(expect.arrayContaining(["mode.replace", "sharding.key"]));
  });

  it("rejects a local table named like the destination", async () => {
    const sharded = { shards: 3, hosts: 3, maxReplicas: 1, isLocal: 1 };
    const r = await inspectClusterJob(fakeSession({ clusters: sharded }), input({ cluster: { name: "prod", shardingKey: "id", localTable: "daily" } }), describeFrom());
    expect(failed(r.checks)).toContain("sharding.localTable");
  });

  it("checks upsert colocation against ORDER BY (new) or the local sorting key (existing)", async () => {
    const sharded = { shards: 3, hosts: 3, maxReplicas: 1, isLocal: 1 };
    const job = input({ outputMode: "upsert", engine: "ReplicatedReplacingMergeTree", orderBy: "(id, ts)", cluster: { name: "prod", shardingKey: "cityHash64(tenant)" } });
    expect(failed((await inspectClusterJob(fakeSession({ clusters: sharded }), job, describeFrom())).checks)).toEqual(["sharding.colocated"]);

    const tables = {
      "analytics.daily": { exists: true, engine: "Distributed", engineFull: "Distributed('prod', 'analytics', 'daily_local', cityHash64(tenant))", sortingKey: null },
      "analytics.daily_local": { exists: true, engine: "ReplicatedReplacingMergeTree", engineFull: "", sortingKey: "tenant, id" },
    };
    const r = await inspectClusterJob(fakeSession({ clusters: sharded }), { ...job, createIfMissing: false }, describeFrom(tables));
    expect(r.ok).toBe(true);
  });

  it("requires create-if-missing when the cluster destination is absent", async () => {
    const r = await inspectClusterJob(fakeSession({}), input({ createIfMissing: false }), describeFrom());
    expect(failed(r.checks)).toEqual(["destination.exists"]);
  });

  it("skips engine checks when the destination already exists", async () => {
    const tables = { "analytics.daily": { exists: true, engine: "ReplicatedMergeTree", engineFull: "", sortingKey: "id" } };
    const r = await inspectClusterJob(fakeSession({ macros: [] }), input({ engine: "MergeTree" }), describeFrom(tables));
    expect(r.ok).toBe(true);
  });
});
