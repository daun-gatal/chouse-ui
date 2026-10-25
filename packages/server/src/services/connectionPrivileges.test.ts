import { describe, expect, it } from "bun:test";

import type { ClickHouseClient } from "@clickhouse/client";

import {
  PRIVILEGE_FEATURES,
  buildPrivilegeTree,
  checkConnectionPrivileges,
  holdsPrivilege,
  parseGrantLines,
  privilegeReportMessage,
  quoteGrantName,
  requiredGrantFromError,
  type PrivilegeTreeRow,
} from "./connectionPrivileges";

/** The part of ClickHouse's system.privileges these tests need, with its real shape. */
const TREE_ROWS: PrivilegeTreeRow[] = [
  { privilege: "ALL", aliases: ["ALL PRIVILEGES"], level: null, parent_group: null },
  { privilege: "SELECT", level: "COLUMN", parent_group: "ALL" },
  { privilege: "INSERT", level: "COLUMN", parent_group: "ALL" },
  { privilege: "ALTER", level: null, parent_group: "ALL" },
  { privilege: "ALTER TABLE", level: null, parent_group: "ALTER" },
  { privilege: "ALTER UPDATE", aliases: ["UPDATE"], level: "COLUMN", parent_group: "ALTER TABLE" },
  { privilege: "ALTER DELETE", aliases: ["DELETE"], level: "COLUMN", parent_group: "ALTER TABLE" },
  { privilege: "ALTER COLUMN", level: null, parent_group: "ALTER TABLE" },
  { privilege: "ALTER ADD COLUMN", level: "COLUMN", parent_group: "ALTER COLUMN" },
  { privilege: "ALTER DROP COLUMN", level: "COLUMN", parent_group: "ALTER COLUMN" },
  { privilege: "ALTER NAMED COLLECTION", level: "NAMED_COLLECTION", parent_group: "ALTER" },
  { privilege: "CREATE", level: null, parent_group: "ALL" },
  { privilege: "CREATE TABLE", level: "TABLE", parent_group: "CREATE" },
  { privilege: "CREATE FUNCTION", level: "GLOBAL", parent_group: "CREATE" },
  { privilege: "DROP", level: null, parent_group: "ALL" },
  { privilege: "DROP TABLE", level: "TABLE", parent_group: "DROP" },
  { privilege: "KILL QUERY", level: "GLOBAL", parent_group: "ALL" },
  { privilege: "ACCESS MANAGEMENT", level: null, parent_group: "ALL" },
  { privilege: "CREATE USER", level: "USER_NAME", parent_group: "ACCESS MANAGEMENT" },
  { privilege: "ALTER USER", level: "USER_NAME", parent_group: "ACCESS MANAGEMENT" },
  { privilege: "DROP USER", level: "USER_NAME", parent_group: "ACCESS MANAGEMENT" },
  { privilege: "CREATE ROLE", level: "USER_NAME", parent_group: "ACCESS MANAGEMENT" },
  { privilege: "ALTER ROLE", level: "USER_NAME", parent_group: "ACCESS MANAGEMENT" },
  { privilege: "DROP ROLE", level: "USER_NAME", parent_group: "ACCESS MANAGEMENT" },
  { privilege: "ROLE ADMIN", level: "GLOBAL", parent_group: "ACCESS MANAGEMENT" },
];
const TREE = buildPrivilegeTree(TREE_ROWS);

function holds(lines: string[], privilege: string, database: string | null, table?: string): boolean {
  return holdsPrivilege([parseGrantLines(lines)], TREE, privilege, { database, table });
}

describe("quoteGrantName", () => {
  it("keeps plain names bare and backquotes the rest", () => {
    expect(quoteGrantName("chouse_reader")).toBe("chouse_reader");
    expect(quoteGrantName("chouse-reader")).toBe("`chouse-reader`");
    expect(quoteGrantName("a`b")).toBe("`a\\`b`");
    expect(quoteGrantName("a\\b")).toBe("`a\\\\b`");
    expect(quoteGrantName("x` TO admin; DROP USER y --")).toBe("`x\\` TO admin; DROP USER y --`");
  });
});

describe("parseGrantLines", () => {
  it("parses targets, revokes and column grants", () => {
    const parsed = parseGrantLines([
      "GRANT SELECT, KILL QUERY ON *.* TO r1",
      "GRANT CREATE USER ON * TO r1",
      "GRANT INSERT(a, b), ALTER UPDATE ON analytics.t TO r1",
      "GRANT SELECT ON `my-db`.`t.x` TO `odd user` WITH GRANT OPTION",
      "REVOKE SELECT ON system.processes FROM r1",
      "GRANT TABLE ENGINE ON MergeTree TO r1",
      "GRANT monrole TO r1",
    ]);
    expect(parsed).toEqual([
      { kind: "GRANT", privileges: ["SELECT", "KILL QUERY"], database: null, table: null },
      { kind: "GRANT", privileges: ["CREATE USER"], database: null, table: null },
      { kind: "GRANT", privileges: ["ALTER UPDATE"], database: "analytics", table: "t" },
      { kind: "GRANT", privileges: ["SELECT"], database: "my-db", table: "t.x" },
      { kind: "REVOKE", privileges: ["SELECT"], database: "system", table: "processes" },
      { kind: "GRANT", privileges: ["TABLE ENGINE"], database: "MergeTree", table: "" },
    ]);
  });

  it("skips lines that are only column grants", () => {
    expect(parseGrantLines(["GRANT SELECT(a) ON db.t TO u"])).toEqual([]);
  });
});

describe("holdsPrivilege", () => {
  it("accepts the privilege, an ancestor, or ALL on a covering target", () => {
    expect(holds(["GRANT KILL QUERY ON *.* TO u"], "KILL QUERY", null)).toBe(true);
    expect(holds(["GRANT ALL ON *.* TO u"], "KILL QUERY", null)).toBe(true);
    expect(holds(["GRANT ALTER ON analytics.* TO u"], "ALTER TABLE", "analytics")).toBe(true);
    expect(holds(["GRANT ACCESS MANAGEMENT ON *.* TO u"], "ROLE ADMIN", null)).toBe(true);
    expect(holds(["GRANT CREATE TABLE ON *.* TO u"], "CREATE TABLE", "analytics")).toBe(true);
  });

  it("rejects a narrower target or another database", () => {
    expect(holds(["GRANT CREATE TABLE ON analytics.* TO u"], "CREATE TABLE", "other")).toBe(false);
    expect(holds(["GRANT CREATE TABLE ON analytics.t TO u"], "CREATE TABLE", "analytics")).toBe(false);
    expect(holds(["GRANT KILL QUERY ON analytics.* TO u"], "KILL QUERY", null)).toBe(false);
    expect(holds(["GRANT INSERT(a) ON analytics.* TO u"], "INSERT", "analytics")).toBe(false);
    expect(holds([], "KILL QUERY", null)).toBe(false);
  });

  it("honours prefix wildcards", () => {
    expect(holds(["GRANT INSERT ON analytics*.* TO u"], "INSERT", "analytics_eu")).toBe(true);
    expect(holds(["GRANT INSERT ON analytics*.* TO u"], "INSERT", "raw")).toBe(false);
  });

  it("matches a single table target", () => {
    expect(holds(["GRANT SELECT ON system.query_log TO u"], "SELECT", "system", "query_log")).toBe(true);
    expect(holds(["GRANT SELECT ON system.parts TO u"], "SELECT", "system", "query_log")).toBe(false);
  });

  it("treats a revoke inside the target as not held", () => {
    expect(holds(["GRANT INSERT ON analytics.* TO u", "REVOKE INSERT ON analytics.secret FROM u"], "INSERT", "analytics")).toBe(false);
    expect(holds(["GRANT SELECT ON *.* TO u", "REVOKE SELECT ON system.processes FROM u"], "SELECT", "system", "query_log")).toBe(true);
    expect(holds(["GRANT SELECT ON *.* TO u", "REVOKE SELECT ON system.processes FROM u"], "SELECT", "system", "processes")).toBe(false);
    expect(holds(["GRANT ALTER ON analytics.* TO u", "REVOKE ALTER DELETE ON analytics.* FROM u"], "ALTER TABLE", "analytics")).toBe(false);
  });

  it("counts a group as held when ClickHouse printed it as all of its children", () => {
    const expanded = ["GRANT CREATE USER, ALTER USER, DROP USER, CREATE ROLE, ALTER ROLE, DROP ROLE ON * TO u", "GRANT ROLE ADMIN ON *.* TO u"];
    expect(holds(expanded, "ACCESS MANAGEMENT", null)).toBe(true);
    expect(holds(["GRANT ALTER UPDATE, ALTER DELETE, ALTER ADD COLUMN, ALTER DROP COLUMN ON analytics.* TO u"], "ALTER TABLE", "analytics")).toBe(true);
    expect(holds(["GRANT ALTER UPDATE, ALTER ADD COLUMN, ALTER DROP COLUMN ON analytics.* TO u"], "ALTER TABLE", "analytics")).toBe(false);
  });

  it("ignores children that can't be granted on a database when checking one", () => {
    // ALTER NAMED COLLECTION is never part of ALTER on db.*.
    expect(holds(["GRANT ALTER TABLE ON analytics.* TO u"], "ALTER", "analytics")).toBe(true);
    expect(holds(["GRANT ALTER TABLE ON *.* TO u"], "ALTER", null)).toBe(false);
  });

  it("combines grants from the user and each role", () => {
    const sets = [parseGrantLines(["GRANT ALTER UPDATE, ALTER DELETE ON analytics.* TO u"]), parseGrantLines(["GRANT ALTER COLUMN ON analytics.* TO r"])];
    expect(holdsPrivilege(sets, TREE, "ALTER TABLE", { database: "analytics" })).toBe(true);
    // A role's revoke only narrows that role.
    const withRevoke = [parseGrantLines(["GRANT INSERT ON analytics.* TO u"]), parseGrantLines(["GRANT INSERT ON *.* TO r", "REVOKE INSERT ON analytics.* FROM r"])];
    expect(holdsPrivilege(withRevoke, TREE, "INSERT", { database: "analytics" })).toBe(true);
  });

  it("resolves aliases", () => {
    expect(holds(["GRANT ALL PRIVILEGES ON *.* TO u"], "KILL QUERY", null)).toBe(true);
    expect(holds(["GRANT DELETE, UPDATE, ALTER COLUMN ON db.* TO u"], "ALTER TABLE", "db")).toBe(true);
  });

  it("without a tree, only exact grants and ALL count", () => {
    const bare = buildPrivilegeTree([]);
    expect(holdsPrivilege([parseGrantLines(["GRANT KILL QUERY ON *.* TO u"])], bare, "KILL QUERY", { database: null })).toBe(true);
    expect(holdsPrivilege([parseGrantLines(["GRANT ALL ON *.* TO u"])], bare, "KILL QUERY", { database: null })).toBe(true);
    expect(holdsPrivilege([parseGrantLines(["GRANT ACCESS MANAGEMENT ON *.* TO u"])], bare, "CREATE USER", { database: null })).toBe(false);
  });
});

describe("requiredGrantFromError", () => {
  it("reads the grant from ClickHouse's message, without the column list", () => {
    expect(requiredGrantFromError("r1: Not enough privileges. To execute this query, it's necessary to have the grant SELECT ON system.metric_log. (ACCESS_DENIED) (version 26.5.7.64)")).toBe("SELECT ON system.metric_log");
    expect(requiredGrantFromError("necessary to have the grant SELECT(hostname, event_date, ProfileEvent_Query) ON system.metric_log. (ACCESS_DENIED)")).toBe("SELECT ON system.metric_log");
    expect(requiredGrantFromError("Authentication failed")).toBeNull();
  });
});

// ============================================
// checkConnectionPrivileges
// ============================================

interface FakeServer {
  /** Tables whose probe fails, with the ClickHouse error type. */
  tables?: Record<string, { type: string; message?: string }>;
  grantsFinal?: string[] | "unsupported";
  grants?: string[];
  roles?: Record<string, string[]>;
  privilegesTree?: PrivilegeTreeRow[] | "denied";
}

class FakeClickHouseError extends Error {
  type: string;
  constructor(type: string, message: string) {
    super(message);
    this.type = type;
  }
}

function fakeClient(server: FakeServer): { client: ClickHouseClient; queries: string[] } {
  const queries: string[] = [];
  const respond = (rows: unknown[] | string[], text = false): { json: () => Promise<unknown>; text: () => Promise<string> } => ({
    json: async () => rows,
    text: async () => (text ? (rows as string[]).join("\n") + "\n" : ""),
  });
  const client = {
    query: async ({ query }: { query: string }) => {
      queries.push(query);
      const table = /^SELECT \* FROM system\.(\w+) LIMIT 0$/.exec(query)?.[1];
      if (table) {
        const failure = server.tables?.[table];
        if (failure) throw new FakeClickHouseError(failure.type, failure.message ?? `${failure.type} on ${table}`);
        return respond([]);
      }
      if (query === "SHOW GRANTS FINAL") {
        if (server.grantsFinal === "unsupported") throw new FakeClickHouseError("SYNTAX_ERROR", "Syntax error: failed at position 13 ('FINAL')");
        return respond(server.grantsFinal ?? [], true);
      }
      if (query === "SHOW GRANTS") return respond(server.grants ?? [], true);
      if (query === "SELECT role_name FROM system.enabled_roles") return respond(Object.keys(server.roles ?? {}), true);
      const role = /^SHOW GRANTS FOR (.+)$/.exec(query)?.[1];
      if (role) return respond(server.roles?.[role.replace(/`/g, "")] ?? [], true);
      if (query.startsWith("SELECT privilege, aliases, level, parent_group FROM system.privileges")) {
        if (server.privilegesTree === "denied") throw new FakeClickHouseError("ACCESS_DENIED", "Not enough privileges");
        return respond(server.privilegesTree ?? TREE_ROWS);
      }
      throw new Error(`unexpected query: ${query}`);
    },
  };
  // Only `query` is used by the check; the cast keeps the fake small.
  return { client: client as unknown as ClickHouseClient, queries };
}

const FULL_GRANTS = ["GRANT ALL ON *.* TO chouse"];

function feature(report: Awaited<ReturnType<typeof checkConnectionPrivileges>>, id: string): (typeof report.features)[number] {
  const found = report.features.find((f) => f.id === id);
  if (!found) throw new Error(`no feature ${id}`);
  return found;
}

describe("checkConnectionPrivileges", () => {
  it("passes a fully granted user and lists tables the server doesn't have", async () => {
    const { client } = fakeClient({ grantsFinal: FULL_GRANTS, tables: { crash_log: { type: "UNKNOWN_TABLE" }, distributed_ddl_queue: { type: "NO_ELEMENTS_IN_CONFIG" } } });
    const report = await checkConnectionPrivileges(client, { username: "chouse", database: "analytics" });
    expect(report.ok).toBe(true);
    expect(report.missingCount).toBe(0);
    expect(report.grantScript).toBe("");
    expect(feature(report, "monitoring").unavailable).toEqual(["system.distributed_ddl_queue", "system.crash_log"]);
    expect(report.features.map((f) => f.id)).toEqual(PRIVILEGE_FEATURES.map((f) => f.id));
  });

  it("reports denied tables and missing privileges with GRANT statements", async () => {
    const { client } = fakeClient({
      grantsFinal: ["GRANT SELECT ON analytics.* TO `chouse-ro`", "GRANT CREATE TABLE, INSERT ON analytics.* TO `chouse-ro`"],
      tables: {
        metric_log: { type: "ACCESS_DENIED", message: "Not enough privileges. To execute this query, it's necessary to have the grant SELECT(a, b) ON system.metric_log. (ACCESS_DENIED)" },
        processes: { type: "ACCESS_DENIED", message: "Not enough privileges" },
        users: { type: "ACCESS_DENIED", message: "Not enough privileges. To execute this query, it's necessary to have the grant SELECT ON system.users. (ACCESS_DENIED)" },
      },
    });
    const report = await checkConnectionPrivileges(client, { username: "chouse-ro", database: "analytics" });
    expect(report.ok).toBe(false);
    expect(feature(report, "core").status).toBe("granted");
    expect(feature(report, "monitoring").missing).toEqual(["SELECT ON system.processes", "SELECT ON system.metric_log"]);
    // processes is needed by two features but counted once.
    expect(feature(report, "observability").missing).toEqual(["SELECT ON system.processes"]);
    expect(feature(report, "query_control").grants).toEqual(["GRANT KILL QUERY ON *.* TO `chouse-ro`;"]);
    expect(feature(report, "data_editing").grants).toEqual(["GRANT ALTER TABLE, DROP TABLE ON analytics.* TO `chouse-ro`;"]);
    expect(feature(report, "access_admin").grants).toEqual([
      "GRANT SELECT ON system.users TO `chouse-ro`;",
      "GRANT CREATE USER, ALTER USER, DROP USER, CREATE ROLE, ALTER ROLE, DROP ROLE, ROLE ADMIN ON *.* TO `chouse-ro`;",
    ]);
    expect(report.missingCount).toBe(13);
    expect(report.grantScript.split("\n")).toEqual([
      "GRANT SELECT ON system.processes TO `chouse-ro`;",
      "GRANT SELECT ON system.metric_log TO `chouse-ro`;",
      "GRANT KILL QUERY ON *.* TO `chouse-ro`;",
      "GRANT ALTER TABLE, DROP TABLE ON analytics.* TO `chouse-ro`;",
      "GRANT SELECT ON system.users TO `chouse-ro`;",
      "GRANT CREATE USER, ALTER USER, DROP USER, CREATE ROLE, ALTER ROLE, DROP ROLE, ROLE ADMIN ON *.* TO `chouse-ro`;",
    ]);
    expect(privilegeReportMessage(report)).toStartWith("chouse-ro is missing 13 privileges across 5 features. Run as an admin, then save again:\nGRANT SELECT ON system.processes");
  });

  it("checks data editing on the default database when none is set, quoting odd names", async () => {
    const { client } = fakeClient({ grantsFinal: ["GRANT SELECT, KILL QUERY, ACCESS MANAGEMENT ON *.* TO u"] });
    const report = await checkConnectionPrivileges(client, { username: "u", database: "  " });
    expect(report.database).toBe("default");
    expect(feature(report, "data_editing").grants).toEqual(["GRANT CREATE TABLE, INSERT, ALTER TABLE, DROP TABLE ON default.* TO u;"]);
    const odd = await checkConnectionPrivileges(fakeClient({ grantsFinal: [] }).client, { username: "u", database: "my-db" });
    expect(feature(odd, "data_editing").grants[0]).toContain(" ON `my-db`.* TO u;");
  });

  it("falls back to SHOW GRANTS plus each enabled role on servers without FINAL", async () => {
    const { client, queries } = fakeClient({
      grantsFinal: "unsupported",
      grants: ["GRANT KILL QUERY ON *.* TO u", "GRANT ops TO u"],
      roles: { ops: ["GRANT CREATE TABLE, INSERT, ALTER, DROP ON analytics.* TO ops"], "odd-role": ["GRANT ACCESS MANAGEMENT ON *.* TO `odd-role`"] },
    });
    const report = await checkConnectionPrivileges(client, { username: "u", database: "analytics" });
    expect(report.ok).toBe(true);
    expect(queries).toContain("SHOW GRANTS FOR `odd-role`");
  });

  it("needs the query_log grant even before the server has created the table", async () => {
    const lazy = { query_log: { type: "UNKNOWN_TABLE" } };
    const without = await checkConnectionPrivileges(fakeClient({ grantsFinal: ["GRANT KILL QUERY, ACCESS MANAGEMENT ON *.* TO u", "GRANT CREATE TABLE, INSERT, ALTER, DROP ON default.* TO u"], tables: lazy }).client, { username: "u" });
    expect(feature(without, "monitoring").missing).toEqual(["SELECT ON system.query_log"]);
    const withGrant = await checkConnectionPrivileges(fakeClient({ grantsFinal: FULL_GRANTS, tables: lazy }).client, { username: "u" });
    expect(feature(withGrant, "monitoring").unavailable).toEqual(["system.query_log"]);
    expect(withGrant.ok).toBe(true);
  });

  it("fails a feature whose check errored, without inventing a grant", async () => {
    const { client } = fakeClient({ grantsFinal: FULL_GRANTS, tables: { replicas: { type: "TIMEOUT_EXCEEDED", message: "Timeout exceeded: elapsed 5 seconds\nstack…" } } });
    const report = await checkConnectionPrivileges(client, { username: "u" });
    expect(report.ok).toBe(false);
    expect(report.missingCount).toBe(0);
    expect(feature(report, "monitoring").errors).toEqual(["system.replicas: Timeout exceeded: elapsed 5 seconds"]);
    expect(feature(report, "monitoring").grants).toEqual([]);
    expect(privilegeReportMessage(report)).toBe("Couldn't check every privilege for u: system.replicas: Timeout exceeded: elapsed 5 seconds. Try again.");
  });

  it("still works when system.privileges is unreadable", async () => {
    const { client } = fakeClient({ grantsFinal: FULL_GRANTS, privilegesTree: "denied" });
    expect((await checkConnectionPrivileges(client, { username: "u" })).ok).toBe(true);
  });

  it("lets connection errors through", async () => {
    const client = { query: async () => { throw new FakeClickHouseError("AUTHENTICATION_FAILED", "Authentication failed"); } };
    await expect(checkConnectionPrivileges(client as unknown as ClickHouseClient, { username: "u" })).rejects.toThrow("Authentication failed");
  });
});
