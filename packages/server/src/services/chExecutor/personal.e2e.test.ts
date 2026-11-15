/**
 * Personal connections on real ClickHouse (ADR 0033 §7, §10.5 row 4).
 *
 * The login `svc_personal` holds two roles and nothing else: `chouse_system`
 * (system tables) and `chouse_impersonate` (IMPERSONATE on named users). A
 * person's statement is sent as `EXECUTE AS <their ClickHouse user>`.
 *
 *   alice   reads public
 *   bob     reads public; reads, writes and creates in secret
 *   carol   can create users, so she may not be linked
 *   dave    the role holds no IMPERSONATE grant on him yet
 *
 * Only a build that passes the self-test may be a personal connection. Of the
 * builds here that is 26.3.63; every other one must be refused: 26.5.7 runs
 * `CREATE` under `EXECUTE AS` unchecked, and older builds have no `EXECUTE AS`
 * or take no role on a request.
 *
 * Skipped unless IDENTITY_E2E_SERVERS is set (scripts/e2e-connection-identity.sh).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { sql } from "drizzle-orm";
import { Readable } from "node:stream";

import { checkedOf, checkTableAccess, filterDatabases, filterTables, setAccessOverrideForTests, validateQueryAccess } from "../../middleware/dataAccess";
import { resetDefaultDatabaseCache } from "../../middleware/sqlAccess";
import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../../rbac/db/migrationTestHarness";
import {
  checkConnectionBindings,
  confirmBinding,
  createBinding,
  getBinding,
  grantScript,
  listBindingsOfUser,
  recheckBinding,
  removeBinding,
  suspendBindingsOf,
} from "../../rbac/services/clickhouseBindings";
import { checkIdentityChange, switchIdentity } from "../../rbac/services/connectionIdentity";
import { createConnection, getConnectionById, getUserConnections } from "../../rbac/services/connections";
import { ClickHouseService } from "../clickhouse";
import { checkSavedConnection } from "./health";
import { connectionConfig, executorForConnection, personActor, serviceActor } from "./index";
import { resetCreateChecks } from "./selfTest";
import { resetVisibleTables } from "./visibleTables";

const SERVERS = (process.env["IDENTITY_E2E_SERVERS"] ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.includes("="))
  .map((entry) => ({ label: entry.slice(0, entry.indexOf("=")), url: entry.slice(entry.indexOf("=") + 1) }));
const PASSWORD = process.env["IDENTITY_E2E_PASSWORD"] ?? "e2e";

const ANN = "p-ann"; // → alice
const BEN = "p-ben"; // → bob
const CAT = "p-cat"; // → carol (excluded)
const DAN = "p-dan"; // → dave (waits for the grant)
const EVE = "p-eve"; // no link
const ROOT = "p-root"; // the super admin who makes the links
const READER = ["table:select", "table:view", "query:execute"];
const WRITER = [...READER, "table:insert", "table:create", "table:drop", "table:alter", "table:update", "table:delete", "query:execute:misc", "database:create", "database:drop", "live_queries:kill_all"];
const SYSTEM = "chouse_system";
const IMPERSONATE = "chouse_impersonate";

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return `${typeof code === "string" || typeof code === "number" ? code : ""} ${message}`;
}

describe.skipIf(SERVERS.length === 0)("personal connections on a real server (ADR 0033 §7)", () => {
  beforeAll(async () => {
    process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
    process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, created_at, updated_at) VALUES ('role-p', 'e2e_person', 'person', 0, unixepoch(), unixepoch())`);
    for (const user of [ANN, BEN, CAT, DAN, EVE, ROOT]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${user}, ${`${user}@test.local`}, ${user}, 'x', 1, unixepoch(), unixepoch())`);
      await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`ur-${user}`}, ${user}, 'role-p', unixepoch())`);
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
      const qualifies = server.label.startsWith("26.3");
      let raw: ClickHouseClient;
      let connectionId = "";

      const admin = async (statement: string): Promise<void> => {
        await raw.command({ query: statement });
      };
      const tryAdmin = (statement: string): Promise<void> => admin(statement).catch(() => undefined);
      const scalar = async (statement: string): Promise<string> => {
        const rows = (await (await raw.query({ query: statement, format: "JSONEachRow" })).json()) as Array<Record<string, unknown>>;
        return rows[0] ? String(Object.values(rows[0])[0]) : "";
      };
      const change = (over: Record<string, unknown> = {}) => ({ identityMode: "personal", username: "svc_personal", password: PASSWORD, systemRole: SYSTEM, impersonationRole: IMPERSONATE, ...over });
      const serviceFor = async (accountId: string): Promise<ClickHouseService> => new ClickHouseService(await connectionConfig(connectionId), personActor(accountId));
      /** The real access check, then the statement it returned, through the service the routes use. */
      const run = async (accountId: string, permissions: string[], statement: string, isAdmin = false, readOnlyFeature?: 1 | 2): Promise<Array<Record<string, unknown>>> => {
        const access = await validateQueryAccess({ userId: accountId, isAdmin, permissions, sql: statement, connectionId });
        if (!access.allowed) throw new Error(`refused by CHouse: ${access.code} ${access.reason}`);
        const rows = (await (await serviceFor(accountId)).executeChecked<Record<string, unknown>>(checkedOf(access), "JSON", undefined, undefined, readOnlyFeature)).data;
        return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "number" ? String(value) : value])));
      };
      const failure = async (work: () => Promise<unknown>): Promise<string> => {
        try {
          await work();
        } catch (error) {
          return codeOf(error);
        }
        return "no error";
      };

      beforeAll(async () => {
        raw = createClient({ url: server.url, username: "default", password: PASSWORD });
        await admin("CREATE DATABASE IF NOT EXISTS public");
        await admin("CREATE DATABASE IF NOT EXISTS secret");
        await admin("CREATE TABLE IF NOT EXISTS public.events (id UInt32, name String) ENGINE = MergeTree ORDER BY id");
        await admin("CREATE TABLE IF NOT EXISTS secret.salaries (id UInt32, amount UInt32) ENGINE = MergeTree ORDER BY id");
        await admin("CREATE TABLE IF NOT EXISTS secret.imports (id UInt32, name String) ENGINE = MergeTree ORDER BY id");
        await admin("TRUNCATE TABLE secret.imports");
        // The same rows whatever ran on this server before.
        await admin("TRUNCATE TABLE public.events");
        await admin("TRUNCATE TABLE secret.salaries");
        await admin("INSERT INTO public.events SELECT number, 'e' FROM numbers(10)");
        await admin("INSERT INTO secret.salaries SELECT number, 1000 FROM numbers(10)");
        for (const user of ["alice", "bob", "carol", "dave"]) {
          await admin(`DROP USER IF EXISTS ${user}`);
          await admin(`CREATE USER ${user} IDENTIFIED BY '${PASSWORD}'`);
          await admin(`GRANT SELECT ON public.* TO ${user}`);
        }
        await admin("GRANT SELECT, INSERT, CREATE TABLE, DROP TABLE, ALTER TABLE ON secret.* TO bob");
        await admin("GRANT CREATE USER ON *.* TO carol");
        await admin(`DROP ROLE IF EXISTS ${IMPERSONATE}`);
        await admin(`CREATE ROLE ${IMPERSONATE}`);
        await admin("DROP USER IF EXISTS svc_personal");
        await admin(`CREATE USER svc_personal IDENTIFIED BY '${PASSWORD}'`);
        await admin(`GRANT ${SYSTEM}, ${IMPERSONATE} TO svc_personal`);
        await admin("ALTER USER svc_personal DEFAULT ROLE NONE");
        // A build without IMPERSONATE refuses these; it then fails the self-test, which is what the cases below expect.
        for (const user of ["alice", "bob", "carol", "svc_personal"]) await tryAdmin(`GRANT IMPERSONATE ON ${user} TO ${IMPERSONATE}`);
        await tryAdmin(`CREATE USER IF NOT EXISTS before_personal IDENTIFIED BY '${PASSWORD}'`);
        await tryAdmin("GRANT ALL ON *.* TO before_personal");
        connectionId = (await createConnection({ name: `personal-${server.label}`, host, port, username: "before_personal", password: PASSWORD, sslEnabled: false })).id;
        resetDefaultDatabaseCache();
        resetCreateChecks();
        resetVisibleTables();
      }, 120_000);

      afterAll(async () => {
        for (const table of ["secret.e2e_made", "secret.e2e_ro"]) await raw?.command({ query: `DROP TABLE IF EXISTS ${table}` }).catch(() => undefined);
        await raw?.close();
      });

      describe("the self-test and the switch", () => {
        it("a check saves nothing, and passes only on a build that qualifies", async () => {
          const { result } = await checkIdentityChange(connectionId, change());
          const failed = result.verdict.checks.filter((check) => !check.ok).map((check) => check.id);
          if (qualifies) {
            expect({ ok: result.ok, failed, reason: result.reason }).toEqual({ ok: true, failed: [], reason: null });
            expect(result.verdict.impersonationTargets?.sort()).toEqual(["alice", "bob", "carol", "svc_personal"]);
          } else {
            expect(result.ok).toBe(false);
            expect(failed.length).toBeGreaterThan(0);
          }
          expect((await getConnectionById(connectionId))?.identityMode).toBe("shared");
        }, 60_000);

        it.skipIf(!server.label.startsWith("26.5"))("26.5 is refused because it runs CREATE under EXECUTE AS unchecked", async () => {
          const { result } = await checkIdentityChange(connectionId, change());
          expect(result.verdict.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual(["create_checked"]);
        }, 60_000);

        it.skipIf(!qualifies)("is refused while the role lacks IMPERSONATE on the login itself, holds another privilege, or equals the system role", async () => {
          await admin(`REVOKE IMPERSONATE ON svc_personal FROM ${IMPERSONATE}`);
          try {
            const { result } = await checkIdentityChange(connectionId, change());
            expect(result.ok).toBe(false);
            expect(result.verdict.checks.find((check) => check.id === "impersonation")?.detail).toContain("IMPERSONATE");
          } finally {
            await admin(`GRANT IMPERSONATE ON svc_personal TO ${IMPERSONATE}`);
          }
          await admin(`GRANT SELECT ON public.* TO ${IMPERSONATE}`);
          try {
            const { result } = await checkIdentityChange(connectionId, change());
            expect(result.verdict.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual(["impersonation_role"]);
          } finally {
            await admin(`REVOKE SELECT ON public.* FROM ${IMPERSONATE}`);
          }
          expect(await failure(() => checkIdentityChange(connectionId, change({ impersonationRole: SYSTEM })))).toContain("two roles");
          expect(await failure(() => checkIdentityChange(connectionId, change({ impersonationRole: "" })))).toContain("impersonation role is required");
        }, 90_000);

        it("the switch stores the kind where the build qualifies, and is refused where it does not", async () => {
          const result = await switchIdentity(connectionId, change({ accessContact: "data-platform@example.test" }));
          const saved = await getConnectionById(connectionId);
          if (!qualifies) {
            expect(result.ok).toBe(false);
            expect(saved).toMatchObject({ identityMode: "shared", username: "before_personal" });
            return;
          }
          expect({ ok: result.ok, reason: result.reason }).toEqual({ ok: true, reason: null });
          expect(saved).toMatchObject({ identityMode: "personal", username: "svc_personal", systemRole: SYSTEM, impersonationRole: IMPERSONATE, identityHealth: "ok" });
        }, 90_000);
      });

      describe.skipIf(qualifies)("a build that does not qualify, forced to personal in the database", () => {
        it("refuses a person's statement before anything runs as them", async () => {
          // What an operator editing the database, or a server downgraded after the switch, would leave behind.
          await rawRun(sql`UPDATE rbac_clickhouse_connections SET identity_mode = 'personal', username = 'svc_personal', system_role = ${SYSTEM}, impersonation_role = ${IMPERSONATE}, identity_health = 'ok', identity_checked_at = ${Date.now()} WHERE id = ${connectionId}`);
          await rawRun(sql`INSERT INTO rbac_clickhouse_bindings (id, user_id, connection_id, clickhouse_user, clickhouse_user_id, state, created_at, updated_at) VALUES (${`forced-${server.label}`}, ${ANN}, ${connectionId}, 'alice', 'x', 'active', 0, 0)`);
          try {
            resetCreateChecks();
            const client = await executorForConnection(connectionId, personActor(ANN));
            const outcome = await failure(() => client.query({ query: "SELECT 1", format: "JSONEachRow" }));
            expect(outcome).toContain("This connection is not available");
            // And the health check stores a failing verdict, so every replica refuses.
            const verdict = await checkSavedConnection(connectionId);
            expect(verdict?.ok).toBe(false);
            expect((await getConnectionById(connectionId))?.identityHealth).toBe("failing");
          } finally {
            await rawRun(sql`DELETE FROM rbac_clickhouse_bindings WHERE id = ${`forced-${server.label}`}`);
            await rawRun(sql`UPDATE rbac_clickhouse_connections SET identity_mode = 'shared', username = 'before_personal', system_role = NULL, impersonation_role = NULL, identity_health = NULL WHERE id = ${connectionId}`);
          }
        }, 90_000);
      });

      describe.skipIf(!qualifies)("bindings", () => {
        it("a link is active once ClickHouse lets the connection act as the user, and waits until then", async () => {
          const ann = await createBinding(connectionId, ANN, "alice", ROOT);
          const ben = await createBinding(connectionId, BEN, "bob", ROOT);
          expect([ann.state, ben.state]).toEqual(["active", "active"]);
          expect(ann.defaultDatabase).toBe("default");

          const dan = await createBinding(connectionId, DAN, "dave", ROOT);
          expect(dan.state).toBe("pending_grant");
          const script = await grantScript(connectionId);
          expect(script.grants).toEqual([`GRANT IMPERSONATE ON dave TO ${IMPERSONATE};  -- ${DAN}`]);
          // carol may be acted as but has no link: a warning with the statement that takes the grant away.
          expect(script.unbound).toEqual([{ user: "carol", revoke: `REVOKE IMPERSONATE ON carol FROM ${IMPERSONATE};` }]);

          expect(await failure(() => run(DAN, READER, "SELECT 1"))).toContain("waiting for a ClickHouse administrator");
          // Only an active link lists the connection: its monitoring pages run as CHouse itself.
          expect((await getUserConnections(DAN)).map((connection) => connection.id)).not.toContain(connectionId);
          await admin(`GRANT IMPERSONATE ON dave TO ${IMPERSONATE}`);
          expect((await recheckBinding(dan.id, DAN)).state).toBe("active");
          expect(await run(DAN, READER, "SELECT currentUser() AS u")).toEqual([{ u: "dave" }]);
        }, 90_000);

        it("refuses the users that may not be linked", async () => {
          expect((await createBinding(connectionId, CAT, "carol", ROOT)).state).toBe("disabled");
          expect((await listBindingsOfUser(CAT))[0]?.reason).toContain("manages users");
          expect(await failure(() => run(CAT, READER, "SELECT 1"))).toContain("disabled");
          expect(await failure(() => createBinding(connectionId, EVE, "default", ROOT))).toContain("default cannot be linked");
          expect(await failure(() => createBinding(connectionId, EVE, "svc_personal", ROOT))).toContain("login of a connection");
          expect(await failure(() => createBinding(connectionId, EVE, "bad-name", ROOT))).toContain("letters, digits and underscores");
          expect(await failure(() => createBinding(connectionId, EVE, "no_such_user", ROOT))).toContain("no ClickHouse user named");
          // One ClickHouse user belongs to one account, and one account has one link.
          expect(await failure(() => createBinding(connectionId, EVE, "alice", ROOT))).toContain("already linked to another account");
          expect(await failure(() => createBinding(connectionId, ANN, "dave", ROOT))).toContain("already has a link");
        }, 90_000);

        it("an account without a link is refused and does not see the connection; a linked one does", async () => {
          expect(await failure(() => run(EVE, READER, "SELECT 1"))).toContain("not linked to a ClickHouse user");
          expect((await getUserConnections(EVE)).map((connection) => connection.id)).not.toContain(connectionId);
          expect((await getUserConnections(ANN)).map((connection) => connection.id)).toContain(connectionId);
        });
      });

      describe.skipIf(!qualifies)("statements run as the person's own ClickHouse user", () => {
        it("ClickHouse sees the bound user, and the service login only authenticated", async () => {
          expect(await run(ANN, READER, "SELECT currentUser() AS u")).toEqual([{ u: "alice" }]);
          expect(await run(BEN, READER, "SELECT currentUser() AS u")).toEqual([{ u: "bob" }]);
          await run(ANN, READER, "SELECT 'personal-e2e-marker' AS m");
          await admin("SYSTEM FLUSH LOGS");
          const rows = (await (await raw.query({
            query: "SELECT user, authenticated_user FROM system.query_log WHERE type = 'QueryFinish' AND query LIKE '%personal-e2e-marker%' AND query NOT LIKE '%query_log%' AND query NOT LIKE 'EXECUTE AS%' AND query NOT LIKE 'EXPLAIN%' ORDER BY event_time_microseconds DESC LIMIT 1",
            format: "JSONEachRow",
          })).json()) as Array<Record<string, unknown>>;
          expect(rows).toEqual([{ user: "alice", authenticated_user: "svc_personal" }]);
        }, 60_000);

        it("a table outside the person's grants is refused by ClickHouse, for a restricted person and for an admin (goals 6 and 11)", async () => {
          expect(await run(ANN, READER, "SELECT count() AS n FROM public.events")).toEqual([{ n: "10" }]);
          setAccessOverrideForTests(() => true);
          for (const isAdmin of [false, true]) {
            const outcome = await failure(() => run(ANN, READER, "SELECT count() FROM secret.salaries", isAdmin));
            expect(outcome).toContain("CLICKHOUSE_ACCESS_DENIED");
            expect(outcome).toContain("alice: Not enough privileges");
          }
          expect(await run(BEN, READER, "SELECT count() AS n FROM secret.salaries")).toEqual([{ n: "10" }]);
        }, 60_000);

        it("every kind CHouse wraps is checked against the person's grants (the wrappable list)", async () => {
          setAccessOverrideForTests(() => true);
          const refusedForAlice = [
            "SELECT * FROM secret.salaries",
            "DESCRIBE TABLE secret.salaries",
            "SHOW CREATE TABLE secret.salaries",
            "EXPLAIN SELECT * FROM secret.salaries",
            "CHECK TABLE public.events",
            "INSERT INTO secret.salaries SELECT 1, 1",
            "ALTER TABLE secret.salaries UPDATE amount = 0 WHERE 1",
            "ALTER TABLE secret.salaries DELETE WHERE 1",
            "DELETE FROM secret.salaries WHERE 1",
            "CREATE TABLE secret.e2e_made (id UInt32) ENGINE = MergeTree ORDER BY id",
            "CREATE DATABASE e2e_made_db",
            "DROP TABLE secret.salaries",
            "DROP DATABASE secret",
            "ALTER TABLE secret.salaries ADD COLUMN x UInt8",
            "TRUNCATE TABLE secret.salaries",
            "KILL QUERY WHERE query_id = 'none' SYNC",
          ];
          for (const statement of refusedForAlice) {
            const outcome = await failure(() => run(ANN, WRITER, statement));
            expect({ statement, outcome: outcome.includes("CLICKHOUSE_ACCESS_DENIED") && outcome.includes("alice: Not enough privileges") ? "refused for alice" : outcome }).toEqual({ statement, outcome: "refused for alice" });
          }
          expect(await scalar("SELECT count() FROM secret.salaries")).toBe("10");
          expect(await scalar("SELECT count() FROM system.databases WHERE name = 'e2e_made_db'")).toBe("0");
        }, 120_000);

        it("the same kinds run for a person who holds the grants", async () => {
          await run(BEN, WRITER, "CREATE TABLE secret.e2e_made (id UInt32) ENGINE = MergeTree ORDER BY id");
          await run(BEN, WRITER, "INSERT INTO secret.e2e_made SELECT number FROM numbers(3)");
          expect(await run(BEN, WRITER, "SELECT count() AS n FROM secret.e2e_made")).toEqual([{ n: "3" }]);
          await run(BEN, WRITER, "ALTER TABLE secret.e2e_made ADD COLUMN note String");
          expect((await run(BEN, WRITER, "DESCRIBE TABLE secret.e2e_made")).map((row) => row.name)).toEqual(["id", "note"]);
          expect((await run(BEN, WRITER, "SHOW TABLES FROM secret")).map((row) => row.name)).toContain("e2e_made");
          await run(BEN, WRITER, "DROP TABLE secret.e2e_made");
          expect(await scalar("SELECT count() FROM system.tables WHERE database = 'secret' AND name = 'e2e_made'")).toBe("0");
        }, 60_000);

        it("what cannot be sent as one statement for the person is refused by CHouse, for an admin too", async () => {
          for (const isAdmin of [false, true]) {
            expect(await failure(() => run(BEN, WRITER, "SET max_threads = 1", isAdmin))).toContain("SET runs in a session");
            expect(await failure(() => run(BEN, WRITER, "USE secret", isAdmin))).toContain("USE runs in a session");
            expect(await failure(() => run(BEN, WRITER, "INSERT INTO secret.salaries VALUES (1, 1)", isAdmin))).toContain("carries its rows");
            expect(await failure(() => run(BEN, WRITER, "EXECUTE AS alice SELECT 1", isAdmin))).toContain("EXECUTE AS is not allowed");
            expect(await failure(() => run(BEN, WRITER, "/* x */ EXECUTE AS alice SELECT 1", isAdmin))).toContain("EXECUTE AS is not allowed");
            expect(await failure(() => run(BEN, WRITER, "SELECT 1; SELECT 2", isAdmin))).toContain("refused by CHouse");
            expect(await failure(() => run(BEN, WRITER, "SYSTEM FLUSH LOGS", isAdmin))).toContain("refused by CHouse");
            expect(await failure(() => run(BEN, WRITER, "GRANT SELECT ON secret.* TO alice", isAdmin))).toContain("refused by CHouse");
          }
        }, 60_000);

        it("unqualified names resolve in the person's own default database", async () => {
          await admin("ALTER USER bob DEFAULT DATABASE secret");
          try {
            await checkConnectionBindings(connectionId);
            expect((await listBindingsOfUser(BEN))[0]).toMatchObject({ state: "active", defaultDatabase: "secret" });
            expect(await run(BEN, READER, "SELECT count() AS n FROM salaries")).toEqual([{ n: "10" }]);
          } finally {
            await admin("ALTER USER bob DEFAULT DATABASE default");
            await checkConnectionBindings(connectionId);
          }
        }, 60_000);
      });

      describe.skipIf(!qualifies)("statements that must be reads", () => {
        it("a read carries readonly in its own SETTINGS clause, next to the person's own settings", async () => {
          expect(await run(ANN, READER, "SELECT getSetting('readonly') AS r")).toEqual([{ r: "1" }]);
          expect(await run(ANN, READER, "SELECT getSetting('readonly') AS r, getSetting('max_threads') AS t SETTINGS max_threads = 3")).toEqual([{ r: "1", t: "3" }]);
          expect(await run(ANN, READER, "SELECT getSetting('readonly') AS r UNION ALL SELECT 1")).toEqual([{ r: "1" }, { r: "1" }]);
          expect(await run(ANN, READER, "SELECT getSetting('readonly') AS r; ")).toEqual([{ r: "1" }]);
          expect(await run(ANN, READER, "SELECT getSetting('readonly') AS r -- trailing comment")).toEqual([{ r: "1" }]);
          // The person cannot switch it off: the last value in the clause wins.
          expect(await run(ANN, READER, "SELECT getSetting('readonly') AS r SETTINGS readonly = 0")).toEqual([{ r: "1" }]);
        }, 60_000);

        it("a read with a typed FORMAT clause cannot carry it and is refused, never sent without it", async () => {
          expect(await failure(() => run(ANN, READER, "SELECT 1 FORMAT TabSeparated"))).toContain("FORMAT clause");
        });

        it("a write in a feature that only reads is refused even for a person whose user may write", async () => {
          // What a dashboard panel, a notebook cell or a scheduled SELECT sends: the feature's read-only level.
          setAccessOverrideForTests(() => true);
          const before = await scalar("SELECT count() FROM secret.salaries");
          expect(await failure(() => run(BEN, WRITER, "INSERT INTO secret.salaries SELECT 99, 99", false, 1))).toContain("must be a read");
          expect(await failure(() => run(BEN, WRITER, "ALTER TABLE secret.salaries DELETE WHERE 1", true, 1))).toContain("must be a read");
          expect(await scalar("SELECT count() FROM secret.salaries")).toBe(before);
        }, 60_000);

        it("a person who may write nothing in CHouse is sent read-only, whatever their ClickHouse user holds", async () => {
          setAccessOverrideForTests((stage) => stage === "permission");
          const before = await scalar("SELECT count() FROM secret.salaries");
          expect(await failure(() => run(BEN, READER, "INSERT INTO secret.salaries SELECT 98, 98"))).toContain("must be a read");
          expect(await scalar("SELECT count() FROM secret.salaries")).toBe(before);
        }, 60_000);

        it("ClickHouse itself refuses a write that carries the clause (164 naming the person)", async () => {
          const bare = createClient({ url: server.url, username: "svc_personal", password: PASSWORD });
          try {
            const outcome = await failure(() => bare.command({ query: "EXECUTE AS `bob` INSERT INTO secret.salaries SELECT 97, 97\nSETTINGS readonly = 1", role: IMPERSONATE }));
            expect(outcome).toContain("164");
            // And `readonly` on the URL is refused for the whole request, which is why it is never sent there.
            const onUrl = await failure(() => bare.command({ query: "EXECUTE AS `bob` SELECT 1", role: IMPERSONATE, clickhouse_settings: { readonly: "2" } }));
            expect(onUrl).toContain("164");
          } finally {
            await bare.close();
          }
        }, 60_000);
      });

      describe.skipIf(!qualifies)("CHouse-built statements and file import", () => {
        it("text CHouse builds for a person runs as that person too", async () => {
          const ann = await executorForConnection(connectionId, personActor(ANN));
          const rows = (await (await ann.query({ query: "SELECT currentUser() AS u, getSetting('readonly') AS r", format: "JSONEachRow", clickhouse_settings: { readonly: "1" } })).json()) as Array<Record<string, unknown>>;
          expect(rows.map((row) => ({ u: row.u, r: String(row.r) }))).toEqual([{ u: "alice", r: "1" }]);
          const databases = (await (await ann.query({ query: "SHOW DATABASES", format: "JSONEachRow", clickhouse_settings: { readonly: "1" } })).json()) as Array<{ name: string }>;
          expect(databases.map((row) => row.name)).toContain("public");
          expect(databases.map((row) => row.name)).not.toContain("secret");
          expect(await failure(() => ann.command({ query: "DROP TABLE secret.salaries", clickhouse_settings: { readonly: "1" } }))).toContain("read-only request on a personal connection");
          expect(await failure(() => ann.command({ query: "DROP TABLE secret.salaries" }))).toContain("alice: Not enough privileges");
        }, 60_000);

        it("a pinned session is refused, since it could not switch user per statement", async () => {
          const ben = await executorForConnection(connectionId, personActor(BEN));
          const controller = new AbortController();
          expect(await failure(() => ben.session(controller.signal, "e2e-pinned").rows("SELECT 1"))).toContain("not available on a personal connection");
          expect(await ben.session().rows<{ u: string }>("SELECT currentUser() AS u")).toEqual([{ u: "bob" }]);
        }, 60_000);

        it("CHouse's own work names the system role and reaches no user table", async () => {
          const service = await executorForConnection(connectionId, serviceActor("collector"));
          const rows = (await (await service.query({ query: "SELECT currentUser() AS u, count() AS n FROM system.processes", format: "JSONEachRow" })).json()) as Array<Record<string, unknown>>;
          expect(rows[0]?.u).toBe("svc_personal");
          expect(await failure(() => service.query({ query: "SELECT count() FROM public.events", format: "JSONEachRow" }))).toContain("497");
        }, 60_000);

        it("a file import goes in as the person, and is refused without the INSERT grant (goal 7)", async () => {
          const rows = Array.from({ length: 400_000 }, (_, index) => ({ id: index, name: `row-${index}` }));
          const bytes = rows.reduce((total, row) => total + JSON.stringify(row).length + 1, 0);
          expect(bytes).toBeGreaterThan(5_000_000);
          const ben = await executorForConnection(connectionId, personActor(BEN));
          const inserted = await ben.insert({ table: "secret.imports", values: Readable.from(rows, { objectMode: true }), format: "JSONEachRow", query_id: "e2eimport" });
          expect(await scalar("SELECT count() FROM secret.imports")).toBe("400000");

          const ann = await executorForConnection(connectionId, personActor(ANN));
          const outcome = await failure(() => ann.insert({ table: "secret.imports", values: [{ id: 1, name: "x" }], format: "JSONEachRow" }));
          expect(outcome).toContain("497");
          expect(outcome).toContain("alice: Not enough privileges");
          expect(await scalar("SELECT count() FROM secret.imports")).toBe("400000");

          // The insert is the one request the log shows under the service login; the person is in the query id.
          await admin("SYSTEM FLUSH LOGS");
          expect(inserted.query_id).toBe(ben.queryIdFor("e2eimport"));
          expect(await scalar(`SELECT user FROM system.query_log WHERE query_id = '${inserted.query_id}' AND type = 'QueryFinish' LIMIT 1`)).toBe("svc_personal");
          expect(inserted.query_id).toContain(BEN);
        }, 180_000);

        it("pages that list tables show a person what their own ClickHouse user can see", async () => {
          resetVisibleTables();
          expect(await filterTables(ANN, false, "public", ["events", "ghost"], connectionId)).toEqual(["events"]);
          expect(await filterTables(ANN, false, "secret", ["salaries", "imports"], connectionId)).toEqual([]);
          expect(await filterTables(BEN, false, "secret", ["salaries", "imports"], connectionId)).toEqual(["salaries", "imports"]);
          expect(await filterDatabases(ANN, false, ["public", "secret"], connectionId)).toEqual(["public"]);
          expect(await checkTableAccess(ANN, false, "secret", "salaries", connectionId)).toBe(false);
          // A change is ClickHouse's to refuse, when the statement runs as the person.
          expect(await checkTableAccess(ANN, false, "secret", "salaries", connectionId, "write")).toBe(true);
          expect(await failure(() => filterTables(EVE, false, "public", ["events"], connectionId))).toContain("not linked");
        }, 60_000);
      });

      describe.skipIf(!qualifies)("a link stops when the person behind it may have changed", () => {
        it("a change to how the account signs in suspends it until a super admin confirms", async () => {
          expect(await suspendBindingsOf(ANN, "An administrator reset the account's password.", ROOT)).toBe(1);
          expect(await failure(() => run(ANN, READER, "SELECT 1"))).toContain("suspended");
          const [binding] = await listBindingsOfUser(ANN);
          // "Check again" by the person does not lift a suspension.
          expect((await recheckBinding(binding.id, ANN)).state).toBe("suspended");
          expect((await confirmBinding(binding.id, ROOT)).state).toBe("active");
          expect(await run(ANN, READER, "SELECT currentUser() AS u")).toEqual([{ u: "alice" }]);
          const audit = await rawAll(sql`SELECT action FROM rbac_audit_logs WHERE action LIKE 'binding.%' AND resource_id = ${binding.id} ORDER BY created_at`);
          expect(audit.map((row) => String(row.action))).toEqual(expect.arrayContaining(["binding.created", "binding.state_changed"]));
        }, 60_000);

        it("a user dropped and created again under the same name disables the link", async () => {
          const [binding] = await listBindingsOfUser(DAN);
          await admin("DROP USER dave");
          await admin(`CREATE USER dave IDENTIFIED BY '${PASSWORD}'`);
          await admin("GRANT SELECT ON public.* TO dave");
          // The grant is by name, so ClickHouse would still let the connection act as the new dave.
          await checkConnectionBindings(connectionId);
          const after = await getBinding(binding.id);
          expect(after?.state).toBe("disabled");
          expect(after?.reason).toContain("dropped and created again");
          expect(await failure(() => run(DAN, READER, "SELECT 1"))).toContain("disabled");
          // Only removing it and linking again helps.
          expect(await failure(() => confirmBinding(binding.id, ROOT))).toContain("cannot be confirmed");
          await removeBinding(binding.id, ROOT);
          expect((await createBinding(connectionId, DAN, "dave", ROOT)).state).toBe("active");
        }, 90_000);

        it("a user who gains a privilege that manages users is disabled at the next check", async () => {
          await admin("CREATE ROLE IF NOT EXISTS e2e_user_admin");
          await admin("GRANT ALTER USER ON *.* TO e2e_user_admin");
          await admin("GRANT e2e_user_admin TO dave");
          try {
            await checkSavedConnection(connectionId);
            const [binding] = await listBindingsOfUser(DAN);
            expect(binding.state).toBe("disabled");
            expect(binding.reason).toContain("manages users");
          } finally {
            await admin("REVOKE e2e_user_admin FROM dave");
            await admin("DROP ROLE IF EXISTS e2e_user_admin");
          }
        }, 90_000);

        it("a revoked grant sends an active link back to waiting, and a removed link refuses at once", async () => {
          await admin(`REVOKE IMPERSONATE ON alice FROM ${IMPERSONATE}`);
          try {
            // Before the next check: ClickHouse refuses, and the person is told the connection may not act as them.
            const outcome = await failure(() => run(ANN, READER, "SELECT 1"));
            expect(outcome).toContain("may not run statements as your ClickHouse user");
            await checkConnectionBindings(connectionId);
            expect((await listBindingsOfUser(ANN))[0]?.state).toBe("pending_grant");
          } finally {
            await admin(`GRANT IMPERSONATE ON alice TO ${IMPERSONATE}`);
          }
          await checkConnectionBindings(connectionId);
          expect((await listBindingsOfUser(ANN))[0]?.state).toBe("active");
          const [ben] = await listBindingsOfUser(BEN);
          await removeBinding(ben.id, ROOT);
          expect(await failure(() => run(BEN, READER, "SELECT 1"))).toContain("not linked");
          expect((await createBinding(connectionId, BEN, "bob", ROOT)).state).toBe("active");
        }, 90_000);
      });

      describe.skipIf(!qualifies)("the health check keeps deciding", () => {
        it("a failing verdict makes every request refuse, and the next passing check restores it", async () => {
          await admin(`REVOKE IMPERSONATE ON svc_personal FROM ${IMPERSONATE}`);
          try {
            expect((await checkSavedConnection(connectionId))?.ok).toBe(false);
            expect(await failure(() => run(ANN, READER, "SELECT 1"))).toContain("This connection is not available");
          } finally {
            await admin(`GRANT IMPERSONATE ON svc_personal TO ${IMPERSONATE}`);
          }
          expect((await checkSavedConnection(connectionId))?.ok).toBe(true);
          expect(await run(ANN, READER, "SELECT currentUser() AS u")).toEqual([{ u: "alice" }]);
        }, 90_000);

        it("switching back to a shared login stops the wrapping", async () => {
          const result = await switchIdentity(connectionId, { identityMode: "shared", username: "default", password: PASSWORD });
          expect({ ok: result.ok, reason: result.reason }).toEqual({ ok: true, reason: null });
          expect(await getConnectionById(connectionId)).toMatchObject({ identityMode: "shared", impersonationRole: null, systemRole: null });
          const service = new ClickHouseService(await connectionConfig(connectionId), personActor(ANN));
          expect((await service.executeQuery<{ u: string }>("SELECT currentUser() AS u")).data).toEqual([{ u: "default" }]);
          // Links stay, prepared for the next switch, and are not in use.
          expect((await listBindingsOfUser(ANN)).length).toBe(1);
        }, 60_000);
      });
    });
  }
});
