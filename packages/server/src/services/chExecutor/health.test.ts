import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../../rbac/db/migrationTestHarness";
import type { ConnectionConfig } from "../../types";
import { setExecutorClientForTests } from "./executor";
import { checkSavedConnection, forbiddenGrant, identityHealthTick, parseGrantLine, runIdentityChecks, writeVerdict, type IdentityCheckInput } from "./health";

/** A ClickHouse login as the checks see it. Mirrors what 24.4 and 26.5 answered for the same fixtures. */
interface FakeLogin {
  grants: string[];
  defaultRoles?: string[];
  /** Grants of each role the login can name. */
  roles: Record<string, string[]>;
  /** False models a server older than 24.4, which answers a role with error 115. */
  takesRole?: boolean;
  /** True models select_from_system_db_requires_grant = 0: a bare request reads system tables. */
  openSystemTables?: boolean;
}

function chError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code: String(code) });
}

function fakeServer(logins: Record<string, FakeLogin>, asked: Array<{ user: string; role: string | undefined; query: string }> = []): void {
  setExecutorClientForTests((_connectionId, config) => ({
    async query(args: { query: string; role?: string }) {
      const user = (config as ConnectionConfig).username;
      const login = logins[user];
      asked.push({ user, role: args.role, query: args.query });
      if (!login) throw chError(516, `${user}: Authentication failed`);
      const text = ((): string => {
        if (args.role !== undefined && login.takesRole === false) throw chError(115, "Setting role is neither a builtin setting nor started with the prefix 'SQL_'");
        if (args.role !== undefined && !(args.role in login.roles)) throw chError(511, `There is no role \`${args.role}\``);
        const held = args.role ? login.roles[args.role] : login.grants.filter((line) => / ON /.test(line));
        const reads = (table: string): boolean => held.some((line) => new RegExp(`SELECT.* ON (\\*\\.\\*|${table.split(".")[0]}\\.\\*|${table.replace(".", "\\.")}) `).test(line));
        if (args.query === "SELECT version()") return "26.5.7.64";
        if (args.query === "SHOW GRANTS") return login.grants.join("\n");
        if (args.query === "SELECT arrayJoin(currentRoles())") return (login.defaultRoles ?? []).join("\n");
        const forRole = /^SHOW GRANTS FOR (\w+)$/.exec(args.query);
        if (forRole) return (login.roles[forRole[1]] ?? []).join("\n");
        if (args.query.startsWith("SELECT concat(database")) return reads("system.tables") ? "public.events" : "";
        const from = /^SELECT 1 FROM (\S+) LIMIT 1$/.exec(args.query);
        if (from) {
          if (reads(from[1]) || (login.openSystemTables && from[1].startsWith("system."))) return "1";
          if (from[1] === "system.query_log") throw chError(60, "Unknown table expression identifier 'system.query_log'");
          throw chError(497, `${user}: Not enough privileges. To execute this query, it's necessary to have the grant SELECT ON ${from[1]}. (ACCESS_DENIED)`);
        }
        throw new Error(`fake server: unexpected statement ${args.query}`);
      })();
      return { query_id: "q", text: async () => text, json: async () => ({ data: [] }) };
    },
  }));
}

const SYSTEM = ["GRANT SHOW, KILL QUERY ON *.* TO chouse_system", "GRANT SELECT ON system.* TO chouse_system"];
const ANALYST = ["GRANT SELECT ON public.* TO analyst_ro"];
const empty = (over: Partial<FakeLogin> = {}): FakeLogin => ({
  grants: ["GRANT analyst_ro, chouse_system TO svc"],
  roles: { chouse_system: SYSTEM, analyst_ro: ANALYST },
  ...over,
});
const input = (over: Partial<IdentityCheckInput> = {}): IdentityCheckInput => ({
  config: { url: "http://h:8123", username: "svc", password: "p" },
  mode: "shared_ceiling", systemRole: "chouse_system", host: "h", port: 8123, ...over,
});
const failed = async (logins: Record<string, FakeLogin>, over: Partial<IdentityCheckInput> = {}) => {
  fakeServer(logins);
  const verdict = await runIdentityChecks(input(over));
  return { verdict, failing: verdict.checks.filter((check) => !check.ok).map((check) => check.id) };
};

describe("identity checks (ADR 0033 §5)", () => {
  beforeAll(async () => {
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
  });
  afterEach(() => setExecutorClientForTests(null));
  afterAll(async () => {
    await closeDatabase();
  });

  it("passes an empty login whose roles are plain, and records the server version", async () => {
    const asked: Array<{ user: string; role: string | undefined; query: string }> = [];
    fakeServer({ svc: empty() }, asked);
    const verdict = await runIdentityChecks(input());
    expect(verdict).toMatchObject({ ok: true, reason: null, serverVersion: "26.5.7.64" });
    expect(verdict.checks.map((check) => check.id)).toEqual(["version", "empty_login", "roles", "system_role", "bare_reads", "login_reuse"]);
    // The bare reads name no role; the role reads name the role under test.
    expect(asked.filter((a) => a.query.startsWith("SELECT 1 FROM") && a.role === undefined).map((a) => a.query)).toEqual([
      "SELECT 1 FROM system.processes LIMIT 1", "SELECT 1 FROM system.query_log LIMIT 1", "SELECT 1 FROM public.events LIMIT 1",
    ]);
    expect(asked.find((a) => a.query === "SHOW GRANTS FOR analyst_ro")?.role).toBe("analyst_ro");
  });

  it("fails a login that holds a direct grant", async () => {
    const { verdict, failing } = await failed({ svc: empty({ grants: ["GRANT SELECT ON public.* TO svc", "GRANT chouse_system TO svc"] }) });
    expect(verdict.ok).toBe(false);
    expect(failing).toContain("empty_login");
    expect(verdict.reason).toContain("direct grant");
  });

  it("fails a login with a default role, and says how to clear it", async () => {
    const { verdict, failing } = await failed({ svc: empty({ defaultRoles: ["analyst_ro"] }) });
    expect(failing).toEqual(["empty_login"]);
    expect(verdict.reason).toContain("DEFAULT ROLE NONE");
  });

  it("fails a role held WITH ADMIN OPTION", async () => {
    const { failing } = await failed({ svc: empty({ grants: ["GRANT analyst_ro, chouse_system TO svc WITH ADMIN OPTION"] }) });
    expect(failing).toContain("empty_login");
  });

  it("fails when a role, or a role granted to it, can manage users, re-grant, or impersonate everyone", async () => {
    for (const bad of [
      ["GRANT CREATE USER ON *.* TO too_strong"],
      ["GRANT ROLE ADMIN ON *.* TO too_strong"],
      ["GRANT SELECT ON public.* TO too_strong WITH GRANT OPTION"],
      ["GRANT IMPERSONATE ON * TO too_strong"],
      ["GRANT IMPERSONATE ON alice TO too_strong"],
      ["GRANT SET DEFINER ON * TO too_strong"],
      ["GRANT ALLOW SQL SECURITY NONE ON *.* TO too_strong"],
      ["GRANT REMOTE ON *.* TO too_strong"],
      ["GRANT NAMED COLLECTION ADMIN ON * TO too_strong"],
      ["GRANT ALL ON *.* TO too_strong"],
      // A role under a name CHouse cannot read the grants of is not shown to be harmless.
      ["GRANT `ops-admin` TO too_strong"],
      ["GRANT nested TO too_strong"],
    ]) {
      const { failing } = await failed({ svc: empty({
        grants: ["GRANT chouse_system, too_strong TO svc"],
        roles: { chouse_system: SYSTEM, too_strong: bad, nested: ["GRANT ALTER USER ON *.* TO nested"] },
      }) });
      expect({ bad, failing }).toEqual({ bad, failing: ["roles"] });
    }
  });

  it("fails a login that holds a role under a name CHouse cannot put on a request", async () => {
    const { failing } = await failed({ svc: empty({ grants: ["GRANT `ops-admin`, chouse_system TO svc"] }) });
    expect(failing).toContain("empty_login");
  });

  it("lets a role own its database, and does not read a column name as a privilege", async () => {
    const { verdict } = await failed({ svc: empty({
      grants: ["GRANT chouse_system, owner TO svc"],
      roles: { chouse_system: SYSTEM, owner: ["GRANT ALL ON sales.* TO owner", "GRANT SELECT(`all`, remote) ON public.t TO owner"] },
    }) });
    expect({ ok: verdict.ok, reason: verdict.reason }).toEqual({ ok: true, reason: null });
  });

  it("follows a harmless nested role without failing", async () => {
    const { verdict } = await failed({ svc: empty({
      grants: ["GRANT chouse_system, wrapper TO svc"],
      roles: { chouse_system: SYSTEM, wrapper: ["GRANT analyst_ro TO wrapper"], analyst_ro: ANALYST },
    }) });
    expect(verdict.ok).toBe(true);
  });

  it("fails when a request that names no role can read a system table", async () => {
    const { verdict, failing } = await failed({ svc: empty({ openSystemTables: true }) });
    expect(failing).toEqual(["bare_reads"]);
    expect(verdict.reason).toContain("select_from_system_db_requires_grant");
  });

  it("fails closed on a server that takes no role on a request, naming the version it needs", async () => {
    const { verdict, failing } = await failed({ svc: empty({ takesRole: false }) });
    expect(failing).toContain("system_role");
    expect(verdict.checks.find((check) => check.id === "system_role")?.detail).toContain("24.4");
  });

  it("fails when the system role is missing, not granted, or cannot read system tables", async () => {
    expect((await failed({ svc: empty() }, { systemRole: null })).failing).toEqual(["system_role"]);
    expect((await failed({ svc: empty() }, { systemRole: "not_granted" })).failing).toEqual(["system_role"]);
    expect((await failed({ svc: empty({ roles: { chouse_system: ["GRANT SHOW ON *.* TO chouse_system"], analyst_ro: ANALYST } }) })).failing).toEqual(["system_role"]);
  });

  it("fails when the login cannot connect, without running the rest", async () => {
    const { verdict, failing } = await failed({}, {});
    expect(failing).toEqual(["version"]);
    expect(verdict.checks.map((check) => check.id)).toEqual(["version", "login_reuse"]);
  });

  it("fails a kind it does not know", async () => {
    const { verdict } = await failed({ svc: empty() }, { mode: "personal" });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("personal");
  });

  it("asks nothing of a shared login but that no connection of another kind uses it", async () => {
    const asked: Array<{ user: string; role: string | undefined; query: string }> = [];
    fakeServer({ svc: empty() }, asked);
    const verdict = await runIdentityChecks(input({ mode: "shared", systemRole: null }));
    expect(verdict).toMatchObject({ ok: true });
    expect(asked).toHaveLength(0);
  });

  it("fails the remediation login when it can impersonate or manage users", async () => {
    const remediation: ConnectionConfig = { url: "http://h:8123", username: "fixer", password: "p" };
    for (const [grant, ok] of [["GRANT ALTER TABLE ON public.* TO fixer", true], ["GRANT ALL ON public.* TO fixer", true], ["GRANT IMPERSONATE ON analyst TO fixer", false], ["GRANT CREATE USER ON *.* TO fixer", false]] as const) {
      const { verdict } = await failed({ svc: empty(), fixer: { grants: [grant], roles: {} } }, { remediation });
      expect({ grant, ok: verdict.ok }).toEqual({ grant, ok });
    }
  });

  describe("the stored verdict", () => {
    const connection = (id: string, username: string, mode: string) => rawRun(sql`
      INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, is_default, is_active, ssl_enabled, identity_mode, system_role, created_at, updated_at)
      VALUES (${id}, ${id}, 'h', 8123, ${username}, 0, 1, 0, ${mode}, ${mode === "shared" ? null : "chouse_system"}, unixepoch(), unixepoch())`);
    const stored = async (id: string) => (await rawAll(sql`SELECT identity_health, identity_health_reason, identity_checked_at, identity_server_version FROM rbac_clickhouse_connections WHERE id = ${id}`))[0];

    it("refuses a login another kind of connection already uses, and accepts the same kind", async () => {
      await connection("shared-1", "svc", "shared");
      expect((await failed({ svc: empty() })).failing).toEqual(["login_reuse"]);
      // The connection being checked is not its own conflict.
      await connection("ceiling-1", "svc_c", "shared_ceiling");
      const own = await failed({ svc_c: empty({ grants: ["GRANT analyst_ro, chouse_system TO svc_c"] }) }, { config: { url: "http://h:8123", username: "svc_c", password: "p" }, connectionId: "ceiling-1" });
      expect(own.verdict.ok).toBe(true);
    });

    it("writes ok or failing with the reason, the time and the version, for every replica to read", async () => {
      fakeServer({ svc_c: empty({ grants: ["GRANT analyst_ro, chouse_system TO svc_c"] }) });
      const verdict = await checkSavedConnection("ceiling-1");
      expect(verdict?.ok).toBe(true);
      expect(await stored("ceiling-1")).toMatchObject({ identity_health: "ok", identity_health_reason: null, identity_server_version: "26.5.7.64" });
      expect(Number((await stored("ceiling-1")).identity_checked_at)).toBeGreaterThan(Date.now() - 5000);

      fakeServer({ svc_c: empty({ grants: ["GRANT SELECT ON *.* TO svc_c", "GRANT chouse_system TO svc_c"] }) });
      expect((await checkSavedConnection("ceiling-1"))?.ok).toBe(false);
      const row = await stored("ceiling-1");
      expect(row.identity_health).toBe("failing");
      expect(String(row.identity_health_reason)).toContain("direct grant");
    });

    it("stores no verdict for a shared connection", async () => {
      expect(await checkSavedConnection("shared-1")).toBeNull();
      expect((await stored("shared-1")).identity_health ?? null).toBeNull();
      expect(await checkSavedConnection("no-such-connection")).toBeNull();
    });

    it("one round checks every connection that is not shared, and a second holder of the timer does nothing", async () => {
      await writeVerdict("ceiling-1", "svc_c", { ok: false, reason: "old", checks: [], serverVersion: null }, 1);
      // A verdict about a login the connection no longer uses is not written over the current one's.
      await writeVerdict("ceiling-1", "previous_login", { ok: true, reason: null, checks: [], serverVersion: null }, 2);
      expect((await stored("ceiling-1")).identity_health).toBe("failing");
      fakeServer({ svc_c: empty({ grants: ["GRANT analyst_ro, chouse_system TO svc_c"] }) });
      expect(await identityHealthTick()).toBe(1);
      expect((await stored("ceiling-1")).identity_health).toBe("ok");
    });
  });
});

describe("grant lines", () => {
  it("reads role grants, privilege grants and their options", () => {
    expect(parseGrantLine("GRANT analyst_ro, chouse_system TO svc")).toMatchObject({ roles: ["analyst_ro", "chouse_system"], privileges: null });
    expect(parseGrantLine("GRANT `a_b` TO svc WITH ADMIN OPTION")).toMatchObject({ roles: ["a_b"], withAdminOption: true });
    // Kept as written, for the caller to refuse: never dropped.
    expect(parseGrantLine("GRANT `ops-admin`, plain TO svc")).toMatchObject({ roles: ["ops-admin", "plain"], privileges: null });
    expect(parseGrantLine("GRANT SELECT, INSERT ON public.* TO analyst_ro WITH GRANT OPTION")).toMatchObject({ roles: [], privileges: "SELECT, INSERT", target: "public.*", withGrantOption: true });
    expect(parseGrantLine("GRANT CREATE USER ON * TO r")).toMatchObject({ privileges: "CREATE USER", target: "*" });
  });

  it("never takes a line it cannot read for a plain role grant", () => {
    for (const odd of ["REVOKE SELECT ON x.* FROM svc", "something else", "GRANT SELECT ON x.* TO svc"]) {
      expect(parseGrantLine(odd).privileges).not.toBeNull();
      expect(parseGrantLine(odd).roles).toEqual([]);
    }
  });

  it("allows data grants and a named IMPERSONATE, and forbids what manages or becomes other users", () => {
    const check = (line: string) => forbiddenGrant(parseGrantLine(line));
    for (const fine of ["GRANT SELECT ON public.* TO r", "GRANT SHOW, KILL QUERY ON *.* TO r", "GRANT ALL ON sales.* TO r", "GRANT CREATE TABLE, ALTER TABLE ON db.* TO r", "GRANT SHOW USERS ON *.* TO r", "GRANT S3, URL ON *.* TO r"]) {
      expect({ fine, problem: check(fine) }).toEqual({ fine, problem: null });
    }
    for (const bad of ["GRANT CREATE USER ON *.* TO r", "GRANT ALTER ROLE ON *.* TO r", "GRANT ACCESS MANAGEMENT ON *.* TO r", "GRANT ALL ON *.* TO r", "GRANT ALL ON * TO r", "GRANT IMPERSONATE ON * TO r", "GRANT IMPERSONATE ON *.* TO r", "GRANT IMPERSONATE ON alice TO r", "GRANT SET DEFINER ON bob TO r", "GRANT REMOTE ON *.* TO r", "GRANT SELECT ON x.* TO r WITH GRANT OPTION", "GRANT CREATE QUOTA ON *.* TO r", "GRANT ALTER SETTINGS PROFILE ON *.* TO r"]) {
      expect({ bad, forbidden: check(bad) !== null }).toEqual({ bad, forbidden: true });
    }
  });
});
