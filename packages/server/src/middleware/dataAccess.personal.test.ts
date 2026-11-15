import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawRun } from "../rbac/db/migrationTestHarness";
import type { ConnectionIdentity } from "../services/chExecutor/identity";
import { setAccessOverrideForTests, validateQueryAccess, validateSystemRead, type QueryAccessResult } from "./dataAccess";
import type { SqlParsePort } from "./sqlAccess";
import recorded from "./sqlAccess/fixtures/explain-ast-impersonation.json";
import { IMPERSONATION_CASES } from "./sqlAccess/fixtures/impersonation-cases";

const PRINTOUTS = (recorded as { printouts: Record<string, { lines?: string[]; code?: string }> }).printouts;

/** Answers from printouts ClickHouse 26.3.63.123 gave. A text that was never recorded fails the test loudly. */
function recordedParser(unavailableFor?: (sql: string) => boolean): SqlParsePort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async explainAst(text) {
      asked.push(text);
      if (unavailableFor?.(text)) return { ok: false, code: "CHECK_UNAVAILABLE", message: "no answer" };
      const answer = PRINTOUTS[text];
      if (!answer) throw new Error(`No recorded printout for ${JSON.stringify(text)}`);
      if (answer.lines) return { ok: true, lines: answer.lines };
      return { ok: false, code: answer.code as "SQL_SYNTAX", message: `${answer.code} (recorded)` };
    },
    async defaultDatabase() {
      throw new Error("the connection's default database must not be asked for on a personal connection");
    },
  };
}

const identity: ConnectionIdentity = { connectionId: "conn-p", mode: "personal", systemRole: "chouse_system", impersonationRole: "chouse_impersonate", health: "ok", healthReason: null, checkedAt: Date.now(), accessContact: null };
const ALL = ["table:select", "table:view", "table:insert", "table:update", "table:delete", "table:create", "table:alter", "table:drop", "database:create", "database:drop", "query:execute", "query:execute:misc", "live_queries:kill_all"];
const READ = ["table:select", "table:view", "query:execute:misc"];

const check = (statement: string, over: { userId?: string; isAdmin?: boolean; permissions?: string[]; parser?: SqlParsePort } = {}): Promise<QueryAccessResult> =>
  validateQueryAccess({ userId: over.userId ?? "ann", isAdmin: over.isAdmin ?? false, permissions: over.permissions ?? ALL, sql: statement, connectionId: "conn-p", parser: over.parser ?? recordedParser(), identity });

describe("the access check on a personal connection (ADR 0033 §7.2, §7.3)", () => {
  beforeAll(async () => {
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    for (const id of ["ann", "ben", "eve"]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@t.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
    }
    await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, is_default, is_active, ssl_enabled, identity_mode, created_at, updated_at) VALUES ('conn-p', 'p', 'h', 8123, 'svc', 0, 1, 0, 'personal', unixepoch(), unixepoch())`);
    await rawRun(sql`INSERT INTO rbac_clickhouse_bindings (id, user_id, connection_id, clickhouse_user, clickhouse_user_id, default_database, state, created_at, updated_at) VALUES ('l1', 'ann', 'conn-p', 'alice', 'id-1', 'public', 'active', 1, 1), ('l2', 'ben', 'conn-p', 'bob', 'id-2', 'default', 'suspended', 1, 1)`);
  });
  afterEach(() => setAccessOverrideForTests(null));
  afterAll(async () => {
    await closeDatabase();
  });

  it("returns the wrapped texts ClickHouse confirmed, for the person's bound user", async () => {
    const result = await check("SELECT count() FROM public.events");
    expect(result).toMatchObject({ allowed: true, statementType: "select" });
    expect(result.statement).toMatchObject({
      sql: "SELECT count() FROM public.events",
      accountId: "ann",
      connectionId: "conn-p",
      isRead: true,
      impersonated: {
        user: "alice",
        sql: "EXECUTE AS `alice` SELECT count() FROM public.events",
        readOnlySql: "EXECUTE AS `alice` SELECT count() FROM public.events\nSETTINGS readonly = 1",
      },
    });
  });

  it("checks no table: an unqualified name, and a table no policy allows, are ClickHouse's to refuse", async () => {
    // No data access policy exists for ann at all, and the connection's default database is never asked for.
    expect((await check("SELECT * FROM events")).allowed).toBe(true);
    expect((await check("DROP TABLE public.events")).allowed).toBe(true);
  });

  it("places readonly where the statement can carry it", async () => {
    const readOnly = async (statement: string): Promise<string | null | undefined> => (await check(statement)).statement?.impersonated?.readOnlySql;
    expect(await readOnly("SELECT 1 SETTINGS max_threads = 1")).toBe("EXECUTE AS `alice` SELECT 1 SETTINGS max_threads = 1\n, readonly = 1");
    expect(await readOnly("SELECT 1 FROM (SELECT 2 SETTINGS max_threads = 1)")).toBe("EXECUTE AS `alice` SELECT 1 FROM (SELECT 2 SETTINGS max_threads = 1)\nSETTINGS readonly = 1");
    expect(await readOnly("SELECT 1 UNION ALL SELECT 2")).toBe("EXECUTE AS `alice` SELECT 1 UNION ALL SELECT 2\nSETTINGS readonly = 1");
    expect(await readOnly("SELECT 1;")).toBe("EXECUTE AS `alice` SELECT 1\nSETTINGS readonly = 1");
    // On its own line, so a trailing comment cannot swallow it.
    expect(await readOnly("SELECT 1 -- note")).toBe("EXECUTE AS `alice` SELECT 1 -- note\nSETTINGS readonly = 1");
    expect(await readOnly("WITH x AS (SELECT 1 AS a) SELECT a FROM x")).toEndWith("\nSETTINGS readonly = 1");
    expect(await readOnly("EXPLAIN SELECT 1")).toBe("EXECUTE AS `alice` EXPLAIN SELECT 1\nSETTINGS readonly = 1");
    // Kinds that cannot write and cannot carry the clause are their own read-only text.
    for (const statement of ["SHOW TABLES FROM public", "SHOW DATABASES", "SHOW CREATE TABLE public.events", "DESCRIBE TABLE public.events", "EXISTS TABLE public.events", "CHECK TABLE public.events"]) {
      expect(await readOnly(statement)).toBe(`EXECUTE AS \`alice\` ${statement}`);
    }
    // A write has none.
    for (const statement of ["INSERT INTO public.events SELECT 1, 'a'", "ALTER TABLE public.events DELETE WHERE 1", "DELETE FROM public.events WHERE 1", "DROP TABLE public.events", "TRUNCATE TABLE public.events", "CREATE DATABASE made_db"]) {
      expect({ statement, readOnly: await readOnly(statement) }).toEqual({ statement, readOnly: null });
    }
  });

  it("refuses a statement whose FORMAT, INTO OUTFILE or trailing clause would land on the wrapper", async () => {
    for (const statement of ["SELECT 1 FORMAT TabSeparated", "SELECT 1 FORMAT JSON SETTINGS max_threads = 1", "SELECT 1 SETTINGS max_threads = 1 FORMAT JSON"]) {
      const result = await check(statement);
      expect({ statement, allowed: result.allowed, code: result.code }).toEqual({ statement, allowed: false, code: "UNSUPPORTED_SHAPE" });
      expect(result.reason).toContain("FORMAT clause");
    }
  });

  it("refuses INTO OUTFILE as on every connection", async () => {
    expect((await check("SELECT 1 INTO OUTFILE 'x'", { isAdmin: false })).allowed).toBe(false);
  });

  it("refuses SET, USE and an INSERT that carries its rows, with what to do instead, for an admin too", async () => {
    for (const isAdmin of [false, true]) {
      expect(await check("SET max_threads = 1", { isAdmin })).toMatchObject({ allowed: false, code: "UNSUPPORTED_SHAPE", reason: expect.stringContaining("SETTINGS clause") });
      expect(await check("USE public", { isAdmin })).toMatchObject({ allowed: false, code: "UNSUPPORTED_SHAPE", reason: expect.stringContaining("in front of the table name") });
      for (const statement of ["INSERT INTO public.events VALUES (1, 'a')", "INSERT INTO public.events FORMAT JSONEachRow"]) {
        expect(await check(statement, { isAdmin })).toMatchObject({ allowed: false, code: "UNSUPPORTED_SHAPE", reason: expect.stringContaining("carries its rows") });
      }
    }
  });

  it("refuses EXECUTE AS, several statements, bad SQL and kinds outside the list, for an admin too", async () => {
    for (const isAdmin of [false, true]) {
      expect(await check("EXECUTE AS bob SELECT 1", { isAdmin })).toMatchObject({ allowed: false, code: "IMPERSONATION" });
      expect(await check("/* hidden */ EXECUTE AS bob SELECT 1", { isAdmin })).toMatchObject({ allowed: false, code: "IMPERSONATION" });
      expect((await check("SELECT 1; SELECT 2", { isAdmin })).allowed).toBe(false);
      expect(await check("SELEC 1", { isAdmin })).toMatchObject({ allowed: false, status: 400 });
      expect((await check("SYSTEM FLUSH LOGS", { isAdmin })).allowed).toBe(false);
      expect((await check("GRANT SELECT ON public.* TO bob", { isAdmin })).allowed).toBe(false);
      expect(await check("  ", { isAdmin })).toMatchObject({ allowed: false, code: "SQL_SYNTAX" });
    }
  });

  it("still asks for the CHouse permission of the statement's kind, except from an admin", async () => {
    expect(await check("DROP TABLE public.events", { permissions: READ })).toMatchObject({ allowed: false, code: "PERMISSION_DENIED", statementType: "drop" });
    expect(await check("INSERT INTO public.events SELECT 1, 'a'", { permissions: READ })).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
    expect((await check("DROP TABLE public.events", { permissions: [], isAdmin: true })).allowed).toBe(true);
    expect((await check("SELECT 1", { permissions: [] })).allowed).toBe(false);
  });

  it("marks a person who may write nothing, so the executor sends every statement as a read", async () => {
    expect((await check("SELECT 1", { permissions: ["table:select", "table:view"] })).statement?.mayWrite).toBe(false);
    expect((await check("SELECT 1", { permissions: ALL })).statement?.mayWrite).toBe(true);
    expect((await check("SELECT 1", { permissions: [], isAdmin: true })).statement?.mayWrite).toBe(true);
    setAccessOverrideForTests((stage) => stage === "permission");
    const forced = await check("INSERT INTO public.events SELECT 1, 'a'", { permissions: ["table:select"] });
    expect(forced.statement).toMatchObject({ mayWrite: false, isRead: false, impersonated: { readOnlySql: null } });
  });

  it("refuses an account with no active link before asking ClickHouse anything", async () => {
    const parser = recordedParser();
    await expect(check("SELECT 1", { userId: "eve", parser })).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", statusCode: 403, message: expect.stringContaining("not linked") });
    await expect(check("SELECT 1", { userId: "ben", parser, isAdmin: true })).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", message: expect.stringContaining("suspended") });
    expect(parser.asked).toEqual([]);
    expect(await check("SELECT 1", { userId: "" })).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
  });

  it("fails closed when ClickHouse does not answer one of the parses", async () => {
    expect(await check("SELECT 1", { parser: recordedParser(() => true) })).toMatchObject({ allowed: false, code: "CHECK_UNAVAILABLE", status: 503 });
    expect(await check("SELECT 1", { parser: recordedParser((text) => text === "EXECUTE AS `alice` SELECT 1") })).toMatchObject({ allowed: false, code: "CHECK_UNAVAILABLE" });
    expect(await check("SELECT 1", { parser: recordedParser((text) => text.endsWith("SETTINGS readonly = 1")) })).toMatchObject({ allowed: false, code: "CHECK_UNAVAILABLE" });
  });

  it("every recorded statement is either refused or returns texts that start with the wrapper for alice", async () => {
    for (const statement of IMPERSONATION_CASES) {
      const result = await check(statement, { isAdmin: true });
      if (!result.allowed) continue;
      const wrapped = result.statement?.impersonated;
      expect(wrapped?.user).toBe("alice");
      expect(wrapped?.sql).toBe(`EXECUTE AS \`alice\` ${statement}`);
      if (wrapped?.readOnlySql) expect(wrapped.readOnlySql.startsWith("EXECUTE AS `alice` ")).toBe(true);
    }
  });

  it("a system read (the fleet AI) is a single SELECT sent as the person, with no CHouse table permission asked", async () => {
    const read = (statement: string): Promise<QueryAccessResult> => validateSystemRead({ userId: "ann", isAdmin: false, permissions: [], sql: statement, connectionId: "conn-p", parser: recordedParser(), identity });
    const allowed = await read("SELECT count() FROM system.parts");
    expect(allowed.statement).toMatchObject({ mayWrite: false, impersonated: { user: "alice" } });
    // The tool reads system tables only, whatever else the person's own user may read.
    expect(await read("SELECT count() FROM public.events")).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
    expect(await read("SELECT * FROM events")).toMatchObject({ allowed: false, code: "TABLE_DENIED" });
    expect(await read("SHOW DATABASES")).toMatchObject({ allowed: false, code: "UNSUPPORTED_SHAPE" });
    expect((await read("DROP TABLE public.events")).allowed).toBe(false);
  });
});
