import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { setExecutorClientForTests } from "../../services/chExecutor";
import { closeDatabase } from "../db";
import { runMigrations } from "../db/migrations";
import { freshDatabase, rawAll, rawRun } from "../db/migrationTestHarness";
import { anyRoleMapped, ceilingSetupStatements, defaultRoleIsMapped, getIdentity, getRoleMap, holdsMappedRole, mappedRoleIds, roleIsMapped, setAccessContact, setRoleMap, switchIdentity } from "./connectionIdentity";
import { createConnection, getConnectionById, getConnectionWithPassword } from "./connections";

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
    function server(): void {
      setExecutorClientForTests((_id, config) => ({
        async query(args: { query: string; role?: string }) {
          const user = config?.username ?? "";
          const direct = user === "svc_direct";
          const asRole = args.role === "chouse_system";
          const text = ((): string => {
            if (user !== "svc_ceiling" && !direct) throw Object.assign(new Error(`${user}: Authentication failed`), { code: "516" });
            if (args.query.startsWith("SELECT version()")) return "26.5.7.64";
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
      for (const change of [{ host: "other-host" }, { port: 9440 }, { sslEnabled: true }]) {
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
