import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { setExecutorClientForTests } from "../../services/chExecutor";
import { closeDatabase } from "../db";
import { runMigrations } from "../db/migrations";
import { freshDatabase, rawAll, rawRun } from "../db/migrationTestHarness";
import { anyRoleMapped, ceilingSetupStatements, checkIdentityChange, connectionKindSupport, connectionReadiness, createConnectionWithIdentity, defaultRoleIsMapped, getIdentity, getRoleMap, holdsMappedRole, mappedRoleIds, roleIsMapped, setAccessContact, setRoleMap, switchIdentity } from "./connectionIdentity";
import { createConnection, getConnectionById, getConnectionWithPassword, updateConnection } from "./connections";

let connectionId = "";

describe("connection identity (ADR 0033 §5, §6)", () => {
  beforeAll(async () => {
    process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
    process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    for (const id of ["a", "b"]) {
      await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, created_at, updated_at) VALUES (${`role-${id}`}, ${`t_role_${id}`}, ${id}, 0, unixepoch(), unixepoch())`);
    }
    connectionId = (await createConnection({ name: "c1", host: "h", port: 8123, username: "old_shared", password: "old-pw", sslEnabled: false })).id;
  });
  afterEach(() => setExecutorClientForTests(null));
  afterAll(async () => {
    await closeDatabase();
  });

  it("a new connection is shared, with no system role and no verdict", async () => {
    const connection = (await getConnectionById(connectionId))!;
    expect(await getIdentity(connection)).toEqual({
      identityMode: "shared", username: "old_shared", systemRole: null, impersonationRole: null, accessContact: null, health: null, healthReason: null, checkedAt: null, serverVersion: null, roleMap: [],
    });
  });

  describe("the role map", () => {
    it("replaces the whole map and reads it back with the role names", async () => {
      await setRoleMap(connectionId, [{ roleId: "role-a", clickhouseRole: "analyst_ro" }, { roleId: "role-b", clickhouseRole: "finance_rw" }], "admin-1");
      expect(await getRoleMap(connectionId)).toEqual([
        { roleId: "role-a", roleName: "t_role_a", clickhouseRole: "analyst_ro" },
        { roleId: "role-b", roleName: "t_role_b", clickhouseRole: "finance_rw" },
      ]);
      expect(await roleIsMapped("role-a")).toBe(true);
      expect(await mappedRoleIds(["role-a", "role-x", "role-a"])).toEqual(["role-a"]);

      await setRoleMap(connectionId, [{ roleId: "role-b", clickhouseRole: "finance_ro" }], "admin-1");
      expect((await getRoleMap(connectionId)).map((entry) => entry.clickhouseRole)).toEqual(["finance_ro"]);
      expect(await roleIsMapped("role-a")).toBe(false);
    });

    it("knows which accounts hold a mapped role, and whether the default role is one", async () => {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES ('holder', 'h@t.local', 'holder', 'x', 1, unixepoch(), unixepoch()), ('other', 'o@t.local', 'other', 'x', 1, unixepoch(), unixepoch())`);
      await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES ('h-b', 'holder', 'role-b', unixepoch()), ('o-a', 'other', 'role-a', unixepoch())`);
      expect(await anyRoleMapped()).toBe(true);
      expect(await holdsMappedRole("holder")).toBe(true);
      expect(await holdsMappedRole("other")).toBe(false);
      expect(await holdsMappedRole("nobody")).toBe(false);
      expect(await defaultRoleIsMapped()).toBe(false);
      await rawRun(sql`UPDATE rbac_roles SET is_default = 1 WHERE id = 'role-b'`);
      expect(await defaultRoleIsMapped()).toBe(true);
      await rawRun(sql`UPDATE rbac_roles SET is_default = 0 WHERE id = 'role-b'`);
    });

    it("refuses a ClickHouse role name it would not put on a request, a duplicate, and an unknown role, changing nothing", async () => {
      const before = await getRoleMap(connectionId);
      for (const entries of [
        [{ roleId: "role-a", clickhouseRole: "a b" }],
        [{ roleId: "role-a", clickhouseRole: "x`; DROP ROLE y" }],
        [{ roleId: "role-a", clickhouseRole: "" }],
        [{ roleId: "role-a", clickhouseRole: "r1" }, { roleId: "role-a", clickhouseRole: "r2" }],
        [{ roleId: "role-gone", clickhouseRole: "r1" }],
      ]) {
        await expect(setRoleMap(connectionId, entries, "admin-1")).rejects.toMatchObject({ statusCode: 400 });
      }
      expect(await getRoleMap(connectionId)).toEqual(before);
    });

    it("goes with its connection and with its CHouse role", async () => {
      const other = (await createConnection({ name: "c2", host: "h2", port: 8123, username: "u", sslEnabled: false })).id;
      await setRoleMap(other, [{ roleId: "role-a", clickhouseRole: "r" }], "admin-1");
      await rawRun(sql`PRAGMA foreign_keys = ON`);
      await rawRun(sql`DELETE FROM rbac_clickhouse_connections WHERE id = ${other}`);
      expect(await rawAll(sql`SELECT 1 FROM rbac_connection_role_map WHERE connection_id = ${other}`)).toEqual([]);
    });
  });

  describe("the switch", () => {
    const SYSTEM = ["GRANT SHOW, KILL QUERY ON *.* TO chouse_system", "GRANT SELECT ON system.* TO chouse_system"];
    /** A ClickHouse that knows one empty login, `svc_ceiling`, and one login with a direct grant, `svc_direct`. */
    const asked: string[] = [];
    /** Runs once, the next time a check asks the server its version: stands in for a save made meanwhile. */
    let onVersion: (() => Promise<void>) | null = null;
    function server(takesRole = true, version = "26.5.7.64"): void {
      asked.length = 0;
      setExecutorClientForTests((_id, config) => ({
        async query(args: { query: string; role?: string }) {
          asked.push(args.query);
          if (args.query.startsWith("SELECT version()") && onVersion) {
            const hook = onVersion;
            onVersion = null;
            await hook();
          }
          // A server older than 24.4 answers any role on a request this way.
          if (!takesRole && args.role !== undefined) throw Object.assign(new Error("Setting role is neither a builtin setting nor started with the prefix 'SQL_' registered for user-defined settings. (UNKNOWN_SETTING)"), { code: "115" });
          if (args.query.startsWith("EXPLAIN AST EXECUTE AS")) throw Object.assign(new Error("Syntax error: failed at position 21 ('AS')"), { code: "62" });
          const user = config?.username ?? "";
          const direct = user === "svc_direct";
          const asRole = args.role === "chouse_system";
          const text = ((): string => {
            if (user !== "svc_ceiling" && user !== "old_shared" && !direct) throw Object.assign(new Error(`${user}: Authentication failed`), { code: "516" });
            if (args.query.startsWith("SELECT version()")) return version;
            // As on a server without SHOW GRANTS FINAL: the privilege check then reads the roles itself.
            if (args.query === "SHOW GRANTS FINAL") throw Object.assign(new Error("Syntax error: failed at position 13 ('FINAL')"), { code: "62", type: "SYNTAX_ERROR" });
            if (args.query === "SHOW GRANTS") return direct ? "GRANT SELECT ON *.* TO svc_direct\nGRANT chouse_system TO svc_direct" : "GRANT chouse_system TO svc_ceiling";
            if (args.query === "SELECT arrayJoin(currentRoles())") return "";
            if (args.query === "SHOW GRANTS FOR chouse_system" || args.query === "SHOW GRANTS FOR `chouse_system`") return SYSTEM.join("\n");
            if (args.query === "SELECT role_name FROM system.enabled_roles") return asRole ? "chouse_system" : "";
            if (args.query.startsWith("SELECT concat(database")) return "";
            if (/^SELECT 1 FROM system\.\w+ LIMIT 1$/.test(args.query)) {
              if (asRole) return "1";
              throw Object.assign(new Error("Not enough privileges (ACCESS_DENIED)"), { code: "497" });
            }
            if (/^SELECT \* FROM system\.\w+ LIMIT 0$/.test(args.query) && !asRole) throw Object.assign(new Error("Not enough privileges. (ACCESS_DENIED)"), { code: "497", type: "ACCESS_DENIED" });
            return "";
          })();
          return { query_id: "q", text: async () => text, json: async () => (args.query.startsWith("SELECT version()") ? [{ version: "26.5.7.64" }] : []) };
        },
        async ping() {
          return { success: true };
        },
        async close() {},
      }));
    }

    it("is refused with one reason when the server cannot run the kind, before any other check", async () => {
      server(false, "24.3.18.7");
      const ceiling = await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "pw", systemRole: "chouse_system" });
      expect(ceiling).toMatchObject({ ok: false, unsupported: true, reason: "ClickHouse 24.3.18.7 does not take a ClickHouse role on a request. The role ceiling needs ClickHouse 24.4 or newer." });
      expect(ceiling.verdict).toMatchObject({ ok: false, serverVersion: "24.3.18.7", checks: [{ id: "version", ok: false }] });
      expect(ceiling.support?.kinds.map((kind) => [kind.kind, kind.state])).toEqual([["shared", "available"], ["shared_ceiling", "unavailable"], ["personal", "unavailable"]]);
      // Only the three probe statements were sent: no grants were read for a kind that cannot work.
      expect(asked.sort()).toEqual(["EXPLAIN AST EXECUTE AS chouse_probe_no_such_user SELECT 1", "SELECT 1", "SELECT version()"]);
      expect(await getConnectionById(connectionId)).toMatchObject({ identityMode: "shared", username: "old_shared" });

      // A server with roles but no EXECUTE AS: the role ceiling may go on, personal may not.
      server(true, "25.10.7.6");
      const personal = await checkIdentityChange(connectionId, { identityMode: "personal", username: "svc_ceiling", password: "pw", systemRole: "chouse_system", impersonationRole: "chouse_impersonate" });
      expect(personal.result).toMatchObject({ ok: false, unsupported: true });
      expect(personal.result.reason).toContain("ClickHouse 25.10.7.6 has no EXECUTE AS statement");
      const ceilingOk = await checkIdentityChange(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "pw", systemRole: "chouse_system" });
      expect(ceilingOk.result.unsupported).toBeUndefined();
      expect(ceilingOk.result.support?.serverVersion).toBe("25.10.7.6");
    });

    it("tells which kinds a saved connection's server can run, asked with its stored login", async () => {
      server(false, "24.3.18.7");
      const support = await connectionKindSupport(connectionId);
      expect(support.serverVersion).toBe("24.3.18.7");
      expect(support.kinds.find((kind) => kind.kind === "shared_ceiling")?.state).toBe("unavailable");
      await expect(connectionKindSupport("no-such-connection")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("is refused while the new login holds a direct grant, and nothing is written", async () => {
      server();
      const result = await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_direct", password: "pw", systemRole: "chouse_system" });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("direct grant");
      expect(await getConnectionById(connectionId)).toMatchObject({ identityMode: "shared", username: "old_shared", systemRole: null });
    });

    it("needs a password for a new user, a system role for a ceiling, and a known kind", async () => {
      server();
      await expect(switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system" })).rejects.toMatchObject({ statusCode: 400 });
      await expect(switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "pw" })).rejects.toMatchObject({ statusCode: 400 });
      await expect(switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "pw", systemRole: "bad name" })).rejects.toMatchObject({ statusCode: 400 });
      await expect(switchIdentity(connectionId, { identityMode: "personal", username: "svc_ceiling", password: "pw", systemRole: "chouse_system" })).rejects.toMatchObject({ statusCode: 400 });
      await expect(switchIdentity("no-such", { identityMode: "shared", username: "x", password: "pw" })).rejects.toMatchObject({ statusCode: 404 });
      expect((await getConnectionById(connectionId))?.identityMode).toBe("shared");
    });

    it("stores the kind, the login, the role and a fresh verdict in one write when every check passes", async () => {
      server();
      const result = await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "new-pw", systemRole: "chouse_system", accessContact: "  data-platform@example.test  " });
      expect({ ok: result.ok, reason: result.reason }).toEqual({ ok: true, reason: null });
      expect(result.privileges?.kind).toBe("shared_ceiling");
      const saved = (await getConnectionWithPassword(connectionId))!;
      expect(saved).toMatchObject({ identityMode: "shared_ceiling", username: "svc_ceiling", password: "new-pw", systemRole: "chouse_system", accessContact: "data-platform@example.test", identityHealth: "ok", identityServerVersion: "26.5.7.64" });
      expect(saved.identityCheckedAt).toBeGreaterThan(Date.now() - 5000);
    });

    it("asks for the password again when the server changes, so the stored one is never sent elsewhere", async () => {
      server();
      for (const change of [{ host: "other-host" }, { port: 9440 }]) {
        await expect(switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system", ...change })).rejects.toMatchObject({ statusCode: 400 });
      }
      expect((await getConnectionById(connectionId))?.host).toBe("h");
    });

    it("keeps the stored password when the user does not change", async () => {
      server();
      const result = await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system" });
      expect(result.ok).toBe(true);
      expect((await getConnectionWithPassword(connectionId))?.password).toBe("new-pw");
    });

    it("keeps the stored password when TLS is turned on, and asks for it when TLS is turned off (ADR 0034)", async () => {
      server();
      expect((await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system", sslEnabled: true })).ok).toBe(true);
      expect((await getConnectionWithPassword(connectionId))).toMatchObject({ sslEnabled: true, password: "new-pw" });
      await expect(switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system", sslEnabled: false })).rejects.toMatchObject({ statusCode: 400 });
      expect((await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "new-pw", systemRole: "chouse_system", sslEnabled: false })).ok).toBe(true);
    });

    it("changes the default database with the login, keeps it when absent, and clears it when empty (ADR 0034)", async () => {
      server();
      await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system", database: "analytics" });
      expect((await getConnectionById(connectionId))?.database).toBe("analytics");
      await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system" });
      expect((await getConnectionById(connectionId))?.database).toBe("analytics");
      await switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system", database: "" });
      expect((await getConnectionById(connectionId))?.database).toBeNull();
    });

    it("writes nothing when the row changed while the checks ran, and says so (ADR 0034)", async () => {
      server();
      onVersion = async () => {
        await rawRun(sql`UPDATE rbac_clickhouse_connections SET username = 'svc_direct', updated_at = ${Math.floor(Date.now() / 1000) + 7} WHERE id = ${connectionId}`);
      };
      await expect(switchIdentity(connectionId, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "new-pw", systemRole: "chouse_system", database: "raced" })).rejects.toMatchObject({ code: "CONNECTION_CHANGED", statusCode: 409 });
      const row = (await getConnectionById(connectionId))!;
      expect(row.username).toBe("svc_direct");
      expect(row.database).not.toBe("raced");
      await rawRun(sql`UPDATE rbac_clickhouse_connections SET username = 'svc_ceiling' WHERE id = ${connectionId}`);
    });

    it("creates a role-ceiling connection in one write, with its kind, roles and a fresh verdict (ADR 0034)", async () => {
      server();
      const { result, connection } = await createConnectionWithIdentity({ name: "made-ceiling", host: "h3", port: 8123, identityMode: "shared_ceiling", username: "svc_ceiling", password: "c-pw", systemRole: "chouse_system", accessContact: "#data", database: "sales" }, "holder");
      expect(result.ok).toBe(true);
      expect(connection).toMatchObject({ name: "made-ceiling", identityMode: "shared_ceiling", systemRole: "chouse_system", accessContact: "#data", identityHealth: "ok", database: "sales", createdBy: "holder" });
      expect((await getConnectionWithPassword(connection!.id))?.password).toBe("c-pw");
      await expect(createConnectionWithIdentity({ name: "again", host: "h3", port: 8123, identityMode: "shared_ceiling", username: "svc_ceiling", password: "c-pw", systemRole: "chouse_system" }, "holder")).rejects.toMatchObject({ code: "CONNECTION_EXISTS", statusCode: 409 });
    });

    it("creates nothing when a check fails, without a password, or for a shared login (ADR 0034)", async () => {
      server();
      const { result, connection } = await createConnectionWithIdentity({ name: "made-direct", host: "h4", port: 8123, identityMode: "shared_ceiling", username: "svc_direct", password: "pw", systemRole: "chouse_system" }, "holder");
      expect(result.ok).toBe(false);
      expect(connection).toBeNull();
      await expect(createConnectionWithIdentity({ name: "no-pw", host: "h4", port: 8123, identityMode: "shared_ceiling", username: "svc_ceiling", systemRole: "chouse_system" }, "holder")).rejects.toMatchObject({ statusCode: 400 });
      await expect(createConnectionWithIdentity({ name: "shared", host: "h4", port: 8123, identityMode: "shared", username: "svc_ceiling", password: "pw" }, "holder")).rejects.toMatchObject({ statusCode: 400 });
      expect(await rawAll(sql`SELECT 1 FROM rbac_clickhouse_connections WHERE host = 'h4'`)).toEqual([]);
    });

    it("checks a login for a connection not created yet, reading no row (ADR 0034)", async () => {
      server();
      const { result, resolved } = await checkIdentityChange(null, { identityMode: "shared_ceiling", username: "svc_ceiling", password: "pw", systemRole: "chouse_system", host: "h5", port: 9000 });
      expect(result.ok).toBe(true);
      expect(resolved).toMatchObject({ host: "h5", port: 9000, sslEnabled: false, database: null });
    });

    it("says who can query: nobody before a mapping, then some, and refusing when the login fails (ADR 0034)", async () => {
      const row = (await getConnectionById(connectionId))!;
      await setRoleMap(connectionId, [], "admin-1");
      expect((await connectionReadiness([row])).get(connectionId)).toMatchObject({ state: "none", roles: { mapped: 0 } });
      await setRoleMap(connectionId, [{ roleId: "role-b", clickhouseRole: "finance_ro" }], "admin-1");
      expect((await connectionReadiness([row])).get(connectionId)).toMatchObject({ state: "partial", roles: { mapped: 1, peopleRefused: 1 } });
      expect((await connectionReadiness([{ ...row, identityHealth: "failing" }])).get(connectionId)?.state).toBe("refusing");
      // A shared login is ready exactly when some policy a role holds reaches it (here only the seeded ones).
      const shared = (await connectionReadiness([{ ...row, identityMode: "shared" }])).get(connectionId);
      expect(shared?.state).toBe(shared && shared.policies > 0 ? "ready" : "none");
    });

    it("refuses a second create of the same login and kind made while the first was still checking (review)", async () => {
      server();
      onVersion = async () => {
        await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, is_default, is_active, ssl_enabled, created_at, updated_at, identity_mode)
          VALUES ('raced-create', 'raced', 'h6', 8123, 'svc_ceiling', 0, 1, 0, unixepoch(), unixepoch(), 'shared_ceiling')`);
      };
      await expect(createConnectionWithIdentity({ name: "late", host: "h6", port: 8123, identityMode: "shared_ceiling", username: "svc_ceiling", password: "pw", systemRole: "chouse_system" }, "holder")).rejects.toMatchObject({ code: "CONNECTION_EXISTS" });
      expect(await rawAll(sql`SELECT id FROM rbac_clickhouse_connections WHERE host = 'h6'`)).toEqual([{ id: "raced-create" }]);
      await rawRun(sql`DELETE FROM rbac_clickhouse_connections WHERE id = 'raced-create'`);
    });

    it("keeps the default when a login change made with the default flag is refused or succeeds (review)", async () => {
      const a = (await createConnection({ name: "def-a", host: "ha", port: 8123, username: "ua", password: "p", sslEnabled: false })).id;
      const b = (await createConnection({ name: "def-b", host: "hb", port: 8123, username: "ub", password: "p", sslEnabled: false })).id;
      await updateConnection(a, { isDefault: true });
      const rowA = (await getConnectionById(a))!;
      // Saving the default row again, with a login change and the flag, is no conflict and keeps it the default.
      await updateConnection(a, { host: "ha2", isDefault: true }, { identityMode: rowA.identityMode, username: rowA.username, updatedAt: rowA.updatedAt });
      expect((await getConnectionById(a))?.isDefault).toBe(true);
      // A conditional write that is refused does not clear the old default.
      const rowB = (await getConnectionById(b))!;
      await expect(updateConnection(b, { host: "hb2", isDefault: true }, { identityMode: rowB.identityMode, username: "someone-else", updatedAt: rowB.updatedAt })).rejects.toMatchObject({ code: "CONNECTION_CHANGED" });
      expect((await getConnectionById(a))?.isDefault).toBe(true);
      expect((await getConnectionById(b))?.isDefault).toBe(false);
      await updateConnection(b, { isDefault: true });
      expect((await getConnectionById(a))?.isDefault).toBe(false);
      expect((await getConnectionById(b))?.isDefault).toBe(true);
      await rawRun(sql`DELETE FROM rbac_clickhouse_connections WHERE id IN (${a}, ${b})`);
    });

    it("counts a policy held by a role that applies to every connection, and not one no role holds (review)", async () => {
      const row = (await getConnectionById(connectionId))!;
      const shared = { ...row, identityMode: "shared" };
      const base = (await connectionReadiness([shared])).get(connectionId)?.policies ?? 0;
      await rawRun(sql`INSERT INTO rbac_data_access_policies (id, name, created_at, updated_at) VALUES ('pol-all', 'all', unixepoch(), unixepoch())`);
      await rawRun(sql`INSERT INTO rbac_data_access_policy_rules (id, policy_id, connection_id, database_pattern, table_pattern, is_allowed, priority, created_at, updated_at) VALUES ('rule-all', 'pol-all', NULL, '*', '*', 1, 0, unixepoch(), unixepoch())`);
      expect((await connectionReadiness([shared])).get(connectionId)?.policies).toBe(base);
      await rawRun(sql`INSERT INTO rbac_role_data_access_policies (id, role_id, policy_id, created_at) VALUES ('rp-all', 'role-a', 'pol-all', unixepoch())`);
      expect((await connectionReadiness([shared])).get(connectionId)).toEqual({ state: "ready", policies: base + 1 });
    });

    it("sets the access contact on its own, and refuses one that is too long", async () => {
      await setAccessContact(connectionId, "ask #data");
      expect((await getConnectionById(connectionId))?.accessContact).toBe("ask #data");
      await setAccessContact(connectionId, "   ");
      expect((await getConnectionById(connectionId))?.accessContact).toBeNull();
      await expect(setAccessContact(connectionId, "x".repeat(501))).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  it("writes setup statements that leave the login empty", () => {
    const statements = ceilingSetupStatements("svc_new", "chouse_system", ["analyst_ro", "chouse_system"]);
    expect(statements).toContain("GRANT chouse_system, analyst_ro TO svc_new;");
    expect(statements.at(-1)).toBe("ALTER USER svc_new DEFAULT ROLE NONE;");
    expect(statements.some((line) => /^GRANT .* ON .* TO svc_new/.test(line))).toBe(false);
  });
});
