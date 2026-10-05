/**
 * Principal display names (lineage, RCA, usage) and agent policy scopes: ids
 * recorded in the evidence store resolve to the current names of jobs,
 * tokens, people and roles, and missing ones never fall back to a raw id.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "crypto";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, getDatabase, getSchema, initializeDatabase } = await import("../../rbac/db");
const { runMigrations } = await import("../../rbac/db/migrations");
const { createPat, revokePat } = await import("../../rbac/services/personalAccessTokens");
const { createJob } = await import("../scheduledQueries/store");
const { principalLabels, principalOfNode, relabelPrincipalNodes } = await import("./principals");
const agents = await import("../agents/store");
const { lineageGraph } = await import("./views");
const { run, sql } = await import("./db");

let userId = "";
let bareUserId = "";
let patId = "";
let revokedPatId = "";
let jobId = "";
const roleName = `governed-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getDatabase() as any;
  const schema = getSchema();
  userId = randomUUID();
  bareUserId = randomUUID();
  await db.insert(schema.users).values([
    { id: userId, email: `${userId}@test.local`, username: "alice", displayName: "Alice Analyst", passwordHash: "unused" },
    { id: bareUserId, email: `${bareUserId}@test.local`, username: "bob", passwordHash: "unused" },
  ]);
  await db.insert(schema.roles).values({ id: randomUUID(), name: roleName, displayName: "Governed Analysts", description: "Analysts behind agents" });
  patId = (await createPat(userId, { name: "dbt-bot" })).id;
  revokedPatId = (await createPat(userId, { name: "old-bot" })).id;
  await revokePat(userId, revokedPatId);
  jobId = await createJob({
    name: "Nightly orders rollup", description: null, connectionId: "conn-1", query: "SELECT 1", enabled: true,
    frequency: "daily", hour: 1, dayOfWeek: 1, dayOfMonth: 1, cronExpr: null, timezone: "UTC",
    outputMode: "none", destDatabase: null, destTable: null, outputConfig: null,
    maxRows: 100, timeoutSecs: 60, useFinal: false, seqConsistency: false, maxAttempts: 1, retentionDays: 30,
  }, userId);
});

afterAll(async () => {
  await closeDatabase();
});

describe("principalLabels", () => {
  it("resolves jobs, tokens with their owner, people and clients", async () => {
    const labels = await principalLabels([
      { kind: "job", id: jobId },
      { kind: "agent", id: patId },
      { kind: "person", id: userId },
      { kind: "person", id: bareUserId },
      { kind: "client", id: "default|clickhouse-client" },
    ]);
    expect(labels.get(`job:${jobId}`)).toBe("Nightly orders rollup");
    expect(labels.get(`agent:${patId}`)).toBe("dbt-bot · Alice Analyst");
    expect(labels.get(`person:${userId}`)).toBe("Alice Analyst");
    // No display name: the username, never the id.
    expect(labels.get(`person:${bareUserId}`)).toBe("bob");
    expect(labels.get("client:default|clickhouse-client")).toBe("clickhouse-client (default)");
  });

  it("names a missing principal instead of echoing its id", async () => {
    const ghost = randomUUID();
    const labels = await principalLabels([{ kind: "job", id: ghost }, { kind: "agent", id: ghost }, { kind: "person", id: ghost }]);
    expect(labels.get(`job:${ghost}`)).toBe("Deleted scheduled query");
    expect(labels.get(`agent:${ghost}`)).toBe("Deleted token");
    expect(labels.get(`person:${ghost}`)).toBe("Deleted user");
    for (const label of labels.values()) expect(label).not.toContain(ghost);
  });

  it("returns nothing for no refs and ignores unknown kinds", async () => {
    expect((await principalLabels([])).size).toBe(0);
    expect((await principalLabels([{ kind: "table", id: "db.t" }])).size).toBe(0);
  });
});

describe("principal nodes", () => {
  it("recognises only principal node ids", () => {
    expect(principalOfNode(`job:${jobId}`)).toEqual({ kind: "job", id: jobId });
    expect(principalOfNode("client:default|x")).toEqual({ kind: "client", id: "default|x" });
    expect(principalOfNode("table:db.t")).toBeNull();
    expect(principalOfNode(null)).toBeNull();
    expect(principalOfNode("no-colon")).toBeNull();
  });

  it("relabels principal nodes and leaves tables alone", async () => {
    const items = [
      { nodeId: `job:${jobId}`, label: `job ${jobId}` },
      { nodeId: `person:${userId}`, label: `user ${userId}` },
      { nodeId: "table:db.orders", label: "db.orders" },
      { nodeId: null, label: "connection" },
    ];
    const out = await relabelPrincipalNodes(items, (i) => i.nodeId);
    expect(out.map((i) => i.label)).toEqual(["Nightly orders rollup", "Alice Analyst", "db.orders", "connection"]);
  });
});

describe("agent policy scopes", () => {
  it("lists roles by display name and only active tokens", async () => {
    const { roles, tokens } = await agents.listPolicyScopes();
    expect(roles).toContainEqual({ id: roleName, label: "Governed Analysts", detail: "Analysts behind agents" });
    const token = tokens.find((t) => t.id === patId);
    expect(token?.label).toBe("dbt-bot");
    expect(token?.owner).toBe("Alice Analyst");
    expect(token?.detail).toStartWith("Alice Analyst · ch_pat_");
    expect(tokens.some((t) => t.id === revokedPatId)).toBe(false);
  });

  it("labels policies by what they apply to", async () => {
    const base = { maxBytesPerQuery: null, dailyBytes: null, partitionFilterBytes: null, incidentMode: "warn" as const, alertMultiplier: null, updatedBy: null, updatedAt: 0 };
    const labelled = await agents.withScopeLabels([
      { ...base, id: "1", scopeKind: "default", scopeId: "*" },
      { ...base, id: "2", scopeKind: "role", scopeId: roleName },
      { ...base, id: "3", scopeKind: "pat", scopeId: patId },
      { ...base, id: "4", scopeKind: "role", scopeId: "gone" },
      { ...base, id: "5", scopeKind: "pat", scopeId: revokedPatId },
    ]);
    expect(labelled.map((p) => p.scopeLabel)).toEqual(["Every agent", "Governed Analysts", "dbt-bot · Alice Analyst", "gone (role not found)", "Revoked or deleted token"]);
  });

  it("accepts only scopes that exist", async () => {
    expect(await agents.policyScopeExists("default", "*")).toBe(true);
    expect(await agents.policyScopeExists("default", roleName)).toBe(false);
    expect(await agents.policyScopeExists("role", roleName)).toBe(true);
    expect(await agents.policyScopeExists("role", "nope")).toBe(false);
    expect(await agents.policyScopeExists("pat", patId)).toBe(true);
    expect(await agents.policyScopeExists("pat", revokedPatId)).toBe(false);
  });
});

describe("lineage graph", () => {
  it("shows people, tokens and jobs by name, not the id the collector stored", async () => {
    const nodes: Array<[string, string, string]> = [
      ["table:shop.orders", "table", "shop.orders"],
      [`person:${userId}`, "person", `user ${userId}`],
      [`agent:${patId}`, "agent", `agent ${patId}`],
      [`job:${jobId}`, "job", `job ${jobId}`],
    ];
    for (const [id, kind, label] of nodes) {
      await run(sql`INSERT INTO obs_lineage_nodes (connection_id, node_id, kind, label, attrs, last_seen_at) VALUES ('conn-lineage', ${id}, ${kind}, ${label}, '{}', 1)`);
      if (kind !== "table") {
        await run(sql`INSERT INTO obs_lineage_edges (connection_id, edge_id, source_id, target_id, kind, origin) VALUES ('conn-lineage', ${`e-${id}`}, 'table:shop.orders', ${id}, 'reads', 'observed')`);
      }
    }
    const graph = await lineageGraph("conn-lineage", () => true, null, 2, "both");
    const label = (id: string): string | undefined => graph.nodes.find((n) => n.id === id)?.label;
    expect(label(`person:${userId}`)).toBe("Alice Analyst");
    expect(label(`agent:${patId}`)).toBe("dbt-bot · Alice Analyst");
    expect(label(`job:${jobId}`)).toBe("Nightly orders rollup");
    expect(label("table:shop.orders")).toBe("shop.orders");
    expect(graph.nodes.some((n) => n.label.includes(userId))).toBe(false);
  });
});
