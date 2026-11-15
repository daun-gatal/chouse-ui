/**
 * Connection kinds and the role ceiling on real ClickHouse (ADR 0033 §5, §6,
 * §10.5 row 3). Each server has the fixture in
 * `testbed/connection-identity/fixture.sql`: an empty login `svc_ceiling` with
 * the roles `chouse_system`, `analyst_ro` (reads `public`) and `finance_rw`
 * (reads `public`, reads and writes `secret`), and three logins that must
 * fail the checks.
 *
 * 24.3 takes no role on a request, so everything there must fail closed.
 * Where a case must show that ClickHouse refuses what CHouse would have
 * refused first, `setAccessOverrideForTests` forces the access check to allow.
 *
 * Skipped unless IDENTITY_E2E_SERVERS is set (scripts/e2e-connection-identity.sh):
 *   IDENTITY_E2E_SERVERS="26.5=http://host:8123" IDENTITY_E2E_PASSWORD=e2e bun test src/services/chExecutor/identity.e2e.test.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { sql } from "drizzle-orm";

import { checkedOf, setAccessOverrideForTests, validateQueryAccess } from "../../middleware/dataAccess";
import { resetDefaultDatabaseCache } from "../../middleware/sqlAccess";
import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../../rbac/db/migrationTestHarness";
import { checkIdentityChange, setRoleMap, switchIdentity } from "../../rbac/services/connectionIdentity";
import { createConnection, getConnectionById, testSavedConnection } from "../../rbac/services/connections";
import { ClickHouseService } from "../clickhouse";
import { checkSavedConnection, runIdentityChecks } from "./health";
import { connectionConfig, executorForConnection, personActor, serviceActor } from "./index";

const SERVERS = (process.env["IDENTITY_E2E_SERVERS"] ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.includes("="))
  .map((entry) => ({ label: entry.slice(0, entry.indexOf("=")), url: entry.slice(entry.indexOf("=") + 1) }));
const PASSWORD = process.env["IDENTITY_E2E_PASSWORD"] ?? "e2e";

/** Accounts in the RBAC database: one CHouse role each. */
const ANN = "e2e-ann"; // analyst → analyst_ro
const FIN = "e2e-fin"; // finance → finance_rw
const ADMIN = "e2e-admin"; // an admin whose role maps to analyst_ro
const LOOSE = "e2e-loose"; // a role with no mapping
const READER = ["table:select", "table:view", "query:execute"];
const WRITER = [...READER, "table:insert"];

describe.skipIf(SERVERS.length === 0)("connection kinds and the role ceiling on a real server (ADR 0033)", () => {
  beforeAll(async () => {
    process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
    process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    for (const role of ["analyst", "finance", "boss", "loose"]) {
      await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, created_at, updated_at) VALUES (${`role-${role}`}, ${`e2e_${role}`}, ${role}, 0, unixepoch(), unixepoch())`);
    }
    for (const [user, role] of [[ANN, "analyst"], [FIN, "finance"], [ADMIN, "boss"], [LOOSE, "loose"]]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${user}, ${`${user}@test.local`}, ${user}, 'x', 1, unixepoch(), unixepoch())`);
      await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`ur-${user}`}, ${user}, ${`role-${role}`}, unixepoch())`);
    }
  }, 60_000);

  afterEach(() => setAccessOverrideForTests(null));

  afterAll(async () => {
    await closeDatabase();
  });

  for (const server of SERVERS) {
    describe(`ClickHouse ${server.label}`, () => {
      const url = new URL(server.url);
      const host = url.hostname;
      const port = Number(url.port || 8123);
      let raw: ClickHouseClient;
      let version = "";
      let takesRole = false;
      let connectionId = "";
      let sharedId = "";

      const login = (username: string) => ({ url: server.url, username, password: PASSWORD });
      const checks = (username: string, over: Record<string, unknown> = {}) =>
        runIdentityChecks({ config: login(username), mode: "shared_ceiling", systemRole: "chouse_system", host, port, ...over });
      const failing = async (username: string): Promise<string[]> => (await checks(username)).checks.filter((check) => !check.ok).map((check) => check.id);

      const serviceFor = async (accountId: string, connection = connectionId): Promise<ClickHouseService> =>
        new ClickHouseService(await connectionConfig(connection), personActor(accountId));
      /** The real access check for the account, then the statement it returned, on the ceiling connection. */
      const run = async (accountId: string, permissions: string[], statement: string, isAdmin = false, connection = connectionId): Promise<unknown[]> => {
        const access = await validateQueryAccess({ userId: accountId, isAdmin, permissions, sql: statement, connectionId: connection });
        if (!access.allowed) throw new Error(`refused by CHouse: ${access.code} ${access.reason}`);
        const rows = (await (await serviceFor(accountId, connection)).executeChecked<Record<string, unknown>>(checkedOf(access))).data;
        // Servers differ in whether a UInt64 comes back as a number or a string; the cases compare counts as strings.
        return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "number" ? String(value) : value])));
      };
      const scalar = async (statement: string): Promise<string> => {
        const result = await raw.query({ query: statement, format: "JSONEachRow" });
        const rows = (await result.json()) as Array<Record<string, unknown>>;
        return rows[0] ? String(Object.values(rows[0])[0]) : "";
      };

      beforeAll(async () => {
        raw = createClient({ url: server.url, username: "default", password: PASSWORD });
        version = await scalar("SELECT version()");
        const [major, minor] = version.split(".").map(Number);
        takesRole = major > 24 || (major === 24 && minor >= 4);
        // A previous run on the same server may have left a drifted login.
        await raw.command({ query: "REVOKE SELECT ON public.* FROM svc_ceiling" }).catch(() => undefined);
        await raw.command({ query: "GRANT chouse_system, analyst_ro, finance_rw TO svc_ceiling" });
        await raw.command({ query: "ALTER USER svc_ceiling DEFAULT ROLE NONE" });
        sharedId = (await createConnection({ name: `shared-${server.label}`, host, port, username: "default", password: PASSWORD, sslEnabled: false })).id;
        // Starts as an ordinary shared connection on a login of its own; the switch below replaces the login.
        await raw.command({ query: `CREATE USER IF NOT EXISTS before_switch IDENTIFIED BY '${PASSWORD}'` });
        await raw.command({ query: "GRANT ALL ON *.* TO before_switch" }).catch(() => undefined);
        connectionId = (await createConnection({ name: `ceiling-${server.label}`, host, port, username: "before_switch", password: PASSWORD, sslEnabled: false })).id;
        await setRoleMap(connectionId, [
          { roleId: "role-analyst", clickhouseRole: "analyst_ro" },
          { roleId: "role-finance", clickhouseRole: "finance_rw" },
          { roleId: "role-boss", clickhouseRole: "analyst_ro" },
        ], ADMIN);
        resetDefaultDatabaseCache();
      }, 120_000);

      afterAll(async () => {
        await raw?.command({ query: "REVOKE SELECT ON public.* FROM svc_ceiling" }).catch(() => undefined);
        await raw?.command({ query: "DROP TABLE IF EXISTS secret.e2e_written" }).catch(() => undefined);
        await raw?.close();
      });

      describe("the identity checks", () => {
        it("fail a login that holds a direct grant, a default role, or a role that manages users", async () => {
          expect(await failing("svc_direct")).toContain("empty_login");
          expect(await failing("svc_default_role")).toContain("empty_login");
          if (takesRole) expect(await failing("svc_strong")).toEqual(["roles"]);
          else expect(await failing("svc_strong")).toContain("roles");
        });

        it("pass the empty login on a server that takes a role, and fail closed on one that does not", async () => {
          const verdict = await checks("svc_ceiling");
          if (takesRole) {
            expect({ ok: verdict.ok, reason: verdict.reason }).toEqual({ ok: true, reason: null });
            expect(verdict.serverVersion).toBe(version);
          } else {
            expect(verdict.ok).toBe(false);
            expect(verdict.checks.find((check) => check.id === "system_role")?.detail).toContain("24.4");
          }
        });

        it("fail a system role that is not granted, and a login that cannot connect", async () => {
          expect((await checks("svc_ceiling", { systemRole: "no_such_role" })).ok).toBe(false);
          const wrong = await runIdentityChecks({ config: { ...login("svc_ceiling"), password: "wrong" }, mode: "shared_ceiling", systemRole: "chouse_system", host, port });
          expect(wrong.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual(["version"]);
        });

        it("refuse a login that a connection of another kind already uses", async () => {
          // `default` is the login of the shared connection above.
          const verdict = await runIdentityChecks({ config: login("default"), mode: "shared_ceiling", systemRole: "chouse_system", host, port });
          expect(verdict.checks.find((check) => check.id === "login_reuse")?.ok).toBe(false);
        });

        it("a request that names no role reads no data with the empty login (goal 9)", async () => {
          const bare = createClient({ url: server.url, username: "svc_ceiling", password: PASSWORD });
          try {
            for (const table of ["public.events", "secret.salaries", "system.processes", "system.query_log"]) {
              let refused = false;
              try {
                await (await bare.query({ query: `SELECT 1 FROM ${table} LIMIT 1`, format: "JSONEachRow" })).json();
              } catch {
                refused = true;
              }
              expect({ table, refused }).toEqual({ table, refused: true });
            }
          } finally {
            await bare.close();
          }
        });
      });

      describe("the switch", () => {
        it("is refused while the new login holds a direct grant or a default role, and writes nothing", async () => {
          for (const username of ["svc_direct", "svc_default_role"]) {
            const result = await switchIdentity(connectionId, { identityMode: "shared_ceiling", username, password: PASSWORD, systemRole: "chouse_system" });
            expect({ username, ok: result.ok }).toEqual({ username, ok: false });
          }
          expect(await getConnectionById(connectionId)).toMatchObject({ identityMode: "shared", username: "before_switch" });
        });

        it("a check saves nothing", async () => {
          const { result } = await checkIdentityChange(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: PASSWORD, systemRole: "chouse_system" });
          expect(result.ok).toBe(takesRole);
          expect((await getConnectionById(connectionId))?.identityMode).toBe("shared");
        });

        it("replaces the login and stores a passing verdict where the server takes a role, and is refused where it does not", async () => {
          const result = await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: PASSWORD, systemRole: "chouse_system", accessContact: "data-platform@example.test" });
          if (!takesRole) {
            expect(result.ok).toBe(false);
            expect(result.reason).toContain("24.4");
            expect((await getConnectionById(connectionId))?.identityMode).toBe("shared");
            return;
          }
          expect({ ok: result.ok, reason: result.reason }).toEqual({ ok: true, reason: null });
          // The privilege check ran on the system role: system reads and stopping queries, nothing about data.
          expect(result.privileges).toMatchObject({ kind: "shared_ceiling", ok: true });
          expect(await getConnectionById(connectionId)).toMatchObject({ identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system", identityHealth: "ok", identityServerVersion: version });
        });
      });

      // Everything below needs the switch to have happened.
      describe("on the role-ceiling connection", () => {
        const onCeiling = (name: string, fn: () => Promise<void>, timeout?: number): void => {
          it(name, async () => {
            if (!takesRole) return;
            await fn();
          }, timeout);
        };

        onCeiling("a person's statement runs with the ClickHouse role mapped to their CHouse role", async () => {
          setAccessOverrideForTests(() => true);
          expect(await run(ANN, READER, "SELECT currentUser() AS u, currentRoles() AS r")).toEqual([{ u: "svc_ceiling", r: ["analyst_ro"] }]);
          expect(await run(FIN, READER, "SELECT currentRoles() AS r")).toEqual([{ r: ["finance_rw"] }]);
          expect(await run(ANN, READER, "SELECT count() AS c FROM public.events")).toEqual([{ c: "10" }]);
        });

        onCeiling("ClickHouse refuses a table outside the mapped role when the table check is forced to allow (goal 5)", async () => {
          setAccessOverrideForTests(() => true);
          await expect(run(ANN, READER, "SELECT count() FROM secret.salaries")).rejects.toMatchObject({ code: "CLICKHOUSE_ACCESS_DENIED", statusCode: 403 });
          await expect(run(ANN, READER, "SELECT count() FROM secret.salaries")).rejects.toThrow("Your ClickHouse role");
          // The same statement runs for someone whose role reaches the table.
          expect(await run(FIN, READER, "SELECT count() AS c FROM secret.salaries")).toEqual([{ c: "10" }]);
        });

        onCeiling("an admin is held to their mapped role too: the bypass of CHouse's table check does not widen ClickHouse (goal 11)", async () => {
          expect(await run(ADMIN, [], "SELECT count() AS c FROM public.events", true)).toEqual([{ c: "10" }]);
          await expect(run(ADMIN, [], "SELECT count() FROM secret.salaries", true)).rejects.toMatchObject({ code: "CLICKHOUSE_ACCESS_DENIED" });
          await expect(run(ADMIN, [], "CREATE TABLE secret.e2e_admin_made (a Int32) ENGINE = Memory", true)).rejects.toMatchObject({ code: "CLICKHOUSE_ACCESS_DENIED" });
        });

        onCeiling("writes follow the role as well", async () => {
          setAccessOverrideForTests(() => true);
          await run(FIN, [...WRITER, "table:create"], "CREATE TABLE IF NOT EXISTS secret.e2e_written (a Int32) ENGINE = MergeTree ORDER BY a");
          await run(FIN, WRITER, "INSERT INTO secret.e2e_written SETTINGS async_insert = 0 VALUES (1)");
          expect(await scalar("SELECT count() FROM secret.e2e_written")).toBe("1");
          await expect(run(ANN, WRITER, "INSERT INTO secret.e2e_written SETTINGS async_insert = 0 VALUES (2)")).rejects.toMatchObject({ code: "CLICKHOUSE_ACCESS_DENIED" });
          expect(await scalar("SELECT count() FROM secret.e2e_written")).toBe("1");
        });

        onCeiling("an account whose role has no ClickHouse role here is refused by CHouse and nothing is sent", async () => {
          setAccessOverrideForTests(() => true);
          const before = await scalar("SELECT count() FROM system.processes");
          await expect((await serviceFor(LOOSE)).executeQuery("SELECT 1")).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", statusCode: 403 });
          await expect((await serviceFor(LOOSE)).executeQuery("SELECT 1")).rejects.toThrow("data-platform@example.test");
          expect(before).not.toBe("");
        });

        onCeiling("removing a mapping stops that role's people on their next request, and restoring it lets them back", async () => {
          setAccessOverrideForTests(() => true);
          await setRoleMap(connectionId, [{ roleId: "role-finance", clickhouseRole: "finance_rw" }, { roleId: "role-boss", clickhouseRole: "analyst_ro" }], ADMIN);
          await expect(run(ANN, READER, "SELECT 1")).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
          await setRoleMap(connectionId, [{ roleId: "role-analyst", clickhouseRole: "analyst_ro" }, { roleId: "role-finance", clickhouseRole: "finance_rw" }, { roleId: "role-boss", clickhouseRole: "analyst_ro" }], ADMIN);
          expect(await run(ANN, READER, "SELECT 1 AS one")).toEqual([{ one: "1" }]);
        });

        onCeiling("a mapping to a role ClickHouse does not have is an identity problem, not a sign-in failure", async () => {
          setAccessOverrideForTests(() => true);
          await setRoleMap(connectionId, [{ roleId: "role-analyst", clickhouseRole: "role_nobody_created" }, { roleId: "role-finance", clickhouseRole: "finance_rw" }, { roleId: "role-boss", clickhouseRole: "analyst_ro" }], ADMIN);
          await expect(run(ANN, READER, "SELECT 1")).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", statusCode: 403 });
          await setRoleMap(connectionId, [{ roleId: "role-analyst", clickhouseRole: "analyst_ro" }, { roleId: "role-finance", clickhouseRole: "finance_rw" }, { roleId: "role-boss", clickhouseRole: "analyst_ro" }], ADMIN);
        });

        onCeiling("CHouse's own work names the system role: it reads system tables and no user table", async () => {
          const collector = await executorForConnection(connectionId, serviceActor("collector"));
          const roles = (await (await collector.query({ query: "SELECT currentRoles() AS r", format: "JSONEachRow" })).json()) as Array<{ r: string[] }>;
          expect(roles[0].r).toEqual(["chouse_system"]);
          await (await collector.query({ query: "SELECT count() FROM system.processes", format: "JSONEachRow" })).json();
          let refused = false;
          try {
            await (await collector.query({ query: "SELECT count() FROM public.events", format: "JSONEachRow" })).json();
          } catch {
            refused = true;
          }
          expect(refused).toBe(true);
        });

        onCeiling("every request of a pinned session names the role", async () => {
          const owner = await executorForConnection(connectionId, personActor(FIN));
          const session = owner.session(new AbortController().signal, `e2e-${Date.now()}`);
          const first = await session.rows<{ r: string[] }>("SELECT currentRoles() AS r");
          await session.command("SET max_threads = 1");
          const second = await session.rows<{ r: string[] }>("SELECT currentRoles() AS r");
          expect([first[0].r, second[0].r]).toEqual([["finance_rw"], ["finance_rw"]]);
        });

        onCeiling("the saved connection's privilege report is about the system role", async () => {
          const tested = await testSavedConnection(connectionId);
          expect(tested.success).toBe(true);
          expect(tested.privileges).toMatchObject({ kind: "shared_ceiling", ok: true });
          expect(tested.privileges?.features.find((f) => f.id === "data_editing")?.source).toBe("mapped_role");
        });

        onCeiling("a failing or a stale verdict makes the connection refuse for everyone, and a fresh check lets it back", async () => {
          setAccessOverrideForTests(() => true);
          await rawRun(sql`UPDATE rbac_clickhouse_connections SET identity_checked_at = ${Date.now() - 16 * 60_000} WHERE id = ${connectionId}`);
          await expect(run(ANN, READER, "SELECT 1")).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE", statusCode: 503 });
          const collector = await executorForConnection(connectionId, serviceActor("collector"));
          await expect(collector.query({ query: "SELECT 1" })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
          expect((await checkSavedConnection(connectionId))?.ok).toBe(true);
          expect(await run(ANN, READER, "SELECT 1 AS one")).toEqual([{ one: "1" }]);
        });

        onCeiling("the timer's check notices a login that gained a grant, and the connection refuses until it is fixed", async () => {
          setAccessOverrideForTests(() => true);
          await raw.command({ query: "GRANT SELECT ON public.* TO svc_ceiling" });
          try {
            const verdict = await checkSavedConnection(connectionId);
            expect(verdict?.ok).toBe(false);
            expect(verdict?.reason).toContain("direct grant");
            const stored = await rawAll(sql`SELECT identity_health FROM rbac_clickhouse_connections WHERE id = ${connectionId}`);
            expect(stored[0].identity_health).toBe("failing");
            await expect(run(ANN, READER, "SELECT 1")).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
            // The reason is stored for the super admin; people are told only that the checks failed.
            await expect(run(ANN, READER, "SELECT 1")).rejects.toThrow("failed CHouse's checks");
          } finally {
            await raw.command({ query: "REVOKE SELECT ON public.* FROM svc_ceiling" });
          }
          expect((await checkSavedConnection(connectionId))?.ok).toBe(true);
          expect(await run(ANN, READER, "SELECT 1 AS one")).toEqual([{ one: "1" }]);
        }, 60_000);
      });

      describe("a server that takes no role", () => {
        it("a connection forced to the ceiling kind sends nothing useful: ClickHouse answers 115 and CHouse reports the connection, not the person", async () => {
          if (takesRole) return;
          await rawRun(sql`UPDATE rbac_clickhouse_connections SET identity_mode = 'shared_ceiling', username = 'svc_ceiling', system_role = 'chouse_system', identity_health = 'ok', identity_checked_at = ${Date.now()} WHERE id = ${connectionId}`);
          try {
            setAccessOverrideForTests(() => true);
            await expect((await serviceFor(ANN)).executeQuery("SELECT 1")).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE", statusCode: 503 });
            // And the next check marks it failing.
            expect((await checkSavedConnection(connectionId))?.ok).toBe(false);
          } finally {
            await rawRun(sql`UPDATE rbac_clickhouse_connections SET identity_mode = 'shared', username = 'before_switch', system_role = NULL, identity_health = NULL, identity_checked_at = NULL WHERE id = ${connectionId}`);
          }
        });
      });

      describe("a shared connection is unchanged (goal 12)", () => {
        it("sends no role, needs no verdict and no mapping, and CHouse's table check is still the boundary", async () => {
          expect(await getConnectionById(sharedId)).toMatchObject({ identityMode: "shared", systemRole: null, identityHealth: null });
          setAccessOverrideForTests(() => true);
          const rows = await run(LOOSE, READER, "SELECT currentUser() AS u, length(currentRoles()) AS n, count() AS c FROM secret.salaries", false, sharedId);
          expect(rows).toEqual([{ u: "default", n: "0", c: "10" }]);
          expect(await checkSavedConnection(sharedId)).toBeNull();
        });
      });
    });
  }
});
