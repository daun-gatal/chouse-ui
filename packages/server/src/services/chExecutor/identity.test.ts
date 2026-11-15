import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../rbac/db/migrationTestHarness";
import {
  healthRefusal,
  identityCacheKey,
  identityOfConnection,
  isBindableUserName,
  isRoleName,
  requestIdentity,
  requestRole,
  VERDICT_MAX_AGE_MS,
  type ConnectionIdentity,
} from "./identity";
import { personActor, serviceActor } from "./types";

const NOW = 1_800_000_000_000;
const ceiling = (over: Partial<ConnectionIdentity> = {}): ConnectionIdentity => ({
  connectionId: "conn-1", mode: "shared_ceiling", systemRole: "chouse_system", health: "ok", healthReason: null, checkedAt: NOW - 60_000, accessContact: null, impersonationRole: null, ...over,
});

describe("request identity (ADR 0033 §5, §6)", () => {
  beforeAll(async () => {
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    for (const id of ["analyst", "finance", "unmapped"]) {
      await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, created_at, updated_at) VALUES (${`role-${id}`}, ${`t_${id}`}, ${id}, 0, unixepoch(), unixepoch())`);
    }
    for (const id of ["ann", "bob", "none", "loose"]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@t.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
    }
    const give = (user: string, role: string) => rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`${user}-${role}`}, ${user}, ${`role-${role}`}, unixepoch())`);
    await give("ann", "analyst");
    await give("bob", "finance");
    // The database allows one role per account (rbac_user_roles.user_id is unique), which is what the ceiling relies on.
    await expect(give("ann", "finance")).rejects.toThrow();
    await give("loose", "unmapped");
    await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, is_default, is_active, ssl_enabled, created_at, updated_at) VALUES ('conn-1', 'c1', 'h', 8123, 'svc', 0, 1, 0, unixepoch(), unixepoch()), ('conn-2', 'c2', 'h', 8123, 'svc2', 0, 1, 0, unixepoch(), unixepoch())`);
    const map = (connection: string, role: string, ch: string) => rawRun(sql`INSERT INTO rbac_connection_role_map (id, connection_id, role_id, clickhouse_role, created_at, updated_at) VALUES (${`${connection}-${role}`}, ${connection}, ${`role-${role}`}, ${ch}, 1, 1)`);
    await map("conn-1", "analyst", "analyst_ro");
    await map("conn-1", "finance", "finance_rw");
    await map("conn-2", "analyst", "other_role");
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it("names no role on a shared connection, and on a config that has no saved connection", async () => {
    expect(await requestRole(undefined, personActor("ann"), NOW)).toBeUndefined();
    expect(await requestRole(ceiling({ mode: "shared", health: null, checkedAt: null }), personActor("nobody"), NOW)).toBeUndefined();
    expect(await requestRole(ceiling({ mode: "shared" }), serviceActor("collector"), NOW)).toBeUndefined();
  });

  it("names the ClickHouse role mapped to the person's CHouse role on that connection", async () => {
    expect(await requestRole(ceiling(), personActor("ann"), NOW)).toBe("analyst_ro");
    expect(await requestRole(ceiling(), personActor("bob"), NOW)).toBe("finance_rw");
    expect(await requestRole(ceiling({ connectionId: "conn-2" }), personActor("ann"), NOW)).toBe("other_role");
  });

  it("names the system role for CHouse's own work", async () => {
    expect(await requestRole(ceiling(), serviceActor("collector"), NOW)).toBe("chouse_system");
    expect(await requestRole(ceiling(), serviceActor("stop-query", "ann"), NOW)).toBe("chouse_system");
  });

  it("refuses an account with no role, or whose role is not mapped here", async () => {
    await expect(requestRole(ceiling(), personActor("none"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", statusCode: 403 });
    await expect(requestRole(ceiling(), personActor("loose"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    // Mapped on conn-1 only.
    await expect(requestRole(ceiling({ connectionId: "conn-2" }), personActor("bob"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    await expect(requestRole(ceiling(), personActor("no-such-account"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
  });

  it("stops on the next request when the role or the mapping is removed", async () => {
    await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES ('temp', 'temp@t.local', 'temp', 'x', 1, unixepoch(), unixepoch())`);
    await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES ('temp-analyst', 'temp', 'role-analyst', unixepoch())`);
    expect(await requestRole(ceiling(), personActor("temp"), NOW)).toBe("analyst_ro");
    await rawRun(sql`DELETE FROM rbac_user_roles WHERE id = 'temp-analyst'`);
    await expect(requestRole(ceiling(), personActor("temp"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
  });

  it("refuses a stored role name it would not put on a request", async () => {
    await rawRun(sql`UPDATE rbac_connection_role_map SET clickhouse_role = 'a b; DROP' WHERE id = 'conn-2-analyst'`);
    await expect(requestRole(ceiling({ connectionId: "conn-2" }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    await rawRun(sql`UPDATE rbac_connection_role_map SET clickhouse_role = 'other_role' WHERE id = 'conn-2-analyst'`);
  });

  describe("health", () => {
    it("refuses everyone on a failing verdict, with the stored reason", async () => {
      const failing = ceiling({ health: "failing", healthReason: "svc holds a direct grant" });
      for (const actor of [personActor("ann"), serviceActor("collector")]) {
        await expect(requestRole(failing, actor, NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE", statusCode: 503 });
      }
      // The stored reason can name grants and other connections: it is for the super admin, not for everyone.
      expect(healthRefusal(failing, NOW)?.message).not.toContain("direct grant");
      expect(healthRefusal(failing, NOW)?.message).toContain("super admin");
    });

    it("refuses when no check has run, and when the verdict is older than 15 minutes", async () => {
      await expect(requestRole(ceiling({ health: null, checkedAt: null }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
      await expect(requestRole(ceiling({ checkedAt: NOW - VERDICT_MAX_AGE_MS - 1 }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
      expect(await requestRole(ceiling({ checkedAt: NOW - VERDICT_MAX_AGE_MS }), personActor("ann"), NOW)).toBe("analyst_ro");
    });

    it("refuses a kind this build does not know, and a ceiling with no system role", async () => {
      await expect(requestRole(ceiling({ mode: "personal" }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
      await expect(requestRole(ceiling({ mode: "" }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
      await expect(requestRole(ceiling({ systemRole: null }), serviceActor("collector"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
    });

    it("adds the access contact to a refusal", async () => {
      const withContact = ceiling({ accessContact: "data-platform@example.test" });
      await expect(requestRole(withContact, personActor("none"), NOW)).rejects.toThrow("data-platform@example.test");
      expect(healthRefusal({ ...withContact, health: "failing" }, NOW)?.message).toContain("data-platform@example.test");
    });
  });

  it("keys caches on the kind and the role, and refuses instead of keying for someone with no role", async () => {
    expect(await identityCacheKey(undefined, personActor("ann"))).toBe("shared");
    const fresh = ceiling({ checkedAt: Date.now() });
    expect(await identityCacheKey(fresh, personActor("ann"))).toBe("shared_ceiling:analyst_ro");
    expect(await identityCacheKey(fresh, personActor("bob"))).toBe("shared_ceiling:finance_rw");
    await expect(identityCacheKey(fresh, personActor("none"))).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
  });

  it("reads a connection row, and takes an object with no kind as shared", () => {
    expect(identityOfConnection({ id: "c", identityMode: "shared_ceiling", systemRole: "sys", identityHealth: "ok", identityHealthReason: null, identityCheckedAt: 5, accessContact: "x" }))
      .toEqual({ connectionId: "c", mode: "shared_ceiling", systemRole: "sys", health: "ok", healthReason: null, checkedAt: 5, accessContact: "x", impersonationRole: null });
    expect(identityOfConnection({ id: "c" }).mode).toBe("shared");
  });

  describe("a personal connection (§7)", () => {
    const personal = (over: Partial<ConnectionIdentity> = {}): ConnectionIdentity => ceiling({ mode: "personal", impersonationRole: "chouse_impersonate", ...over });
    const link = (id: string, user: string, chUser: string, state: string, connection = "conn-1") =>
      rawRun(sql`INSERT INTO rbac_clickhouse_bindings (id, user_id, connection_id, clickhouse_user, clickhouse_user_id, default_database, state, created_at, updated_at) VALUES (${id}, ${user}, ${connection}, ${chUser}, ${`id-${id}`}, 'analytics', ${state}, 1, 1)`);

    beforeAll(async () => {
      await link("l-ann", "ann", "alice", "active");
      await link("l-bob", "bob", "bob_ch", "pending_grant");
      await link("l-loose", "loose", "lou", "suspended");
      await link("l-ann-2", "ann", "other", "disabled", "conn-2");
    });

    it("a person's request names the impersonation role and runs as their bound user", async () => {
      expect(await requestIdentity(personal(), personActor("ann"), NOW)).toEqual({ role: "chouse_impersonate", executeAs: { user: "alice", defaultDatabase: "analytics" } });
      expect(await requestRole(personal(), personActor("ann"), NOW)).toBe("chouse_impersonate");
    });

    it("CHouse's own work names the system role and runs as nobody else", async () => {
      expect(await requestIdentity(personal(), serviceActor("collector"), NOW)).toEqual({ role: "chouse_system" });
    });

    it("refuses an account with no link, and says which state a link that is not active is in", async () => {
      await expect(requestIdentity(personal(), personActor("none"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", statusCode: 403, message: expect.stringContaining("not linked") });
      await expect(requestIdentity(personal(), personActor("bob"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", message: expect.stringContaining("waiting for a ClickHouse administrator") });
      await expect(requestIdentity(personal(), personActor("loose"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", message: expect.stringContaining("suspended") });
      await expect(requestIdentity(personal({ connectionId: "conn-2" }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", message: expect.stringContaining("disabled") });
    });

    it("refuses a state this version does not know, and a stored user name it cannot write", async () => {
      await rawRun(sql`UPDATE rbac_clickhouse_bindings SET state = 'frozen' WHERE id = 'l-ann'`);
      await expect(requestIdentity(personal(), personActor("ann"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
      await rawRun(sql`UPDATE rbac_clickhouse_bindings SET state = 'active', clickhouse_user = 'al\`ice' WHERE id = 'l-ann'`);
      await expect(requestIdentity(personal(), personActor("ann"), NOW)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", message: expect.stringContaining("cannot run as") });
      await rawRun(sql`UPDATE rbac_clickhouse_bindings SET clickhouse_user = 'alice' WHERE id = 'l-ann'`);
    });

    it("refuses everyone without an impersonation role, a system role or a passing verdict", async () => {
      await expect(requestIdentity(personal({ impersonationRole: null }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE", statusCode: 503 });
      await expect(requestIdentity(personal({ impersonationRole: "bad role" }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
      await expect(requestIdentity(personal({ systemRole: null }), serviceActor("collector"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
      await expect(requestIdentity(personal({ health: "failing" }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
      await expect(requestIdentity(personal({ checkedAt: NOW - VERDICT_MAX_AGE_MS - 1 }), personActor("ann"), NOW)).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
    });

    it("keys a cached result by the bound user, so two people never share rows", async () => {
      await rawRun(sql`UPDATE rbac_clickhouse_bindings SET state = 'active' WHERE id = 'l-bob'`);
      const fresh = (): ConnectionIdentity => personal({ checkedAt: Date.now() });
      expect(await identityCacheKey(fresh(), personActor("ann"))).toBe("personal:user:alice");
      expect(await identityCacheKey(fresh(), personActor("bob"))).toBe("personal:user:bob_ch");
      expect(await identityCacheKey(fresh(), serviceActor("collector"))).toBe("personal:chouse_system");
    });

    it("accepts only user names made of letters, digits and underscores", () => {
      for (const ok of ["alice", "_svc", "User_1"]) expect(isBindableUserName(ok)).toBe(true);
      for (const bad of ["", "1x", "a.b", "a@b", "a-b", "a b", "a`b", "x".repeat(129), null, undefined]) expect(isBindableUserName(bad)).toBe(false);
    });
  });

  it("accepts only plain role names", () => {
    for (const ok of ["analyst_ro", "_x", "A1"]) expect(isRoleName(ok)).toBe(true);
    for (const bad of ["", "1abc", "a-b", "a b", "a`b", "a,b", "x".repeat(129), null, undefined, 5]) expect(isRoleName(bad)).toBe(false);
  });
});

describe("the executor names the role", () => {
  beforeEach(() => undefined);

  it("puts the resolved role on every kind of request, and none on a shared connection", async () => {
    const { executorOverClient } = await import("./executor");
    const sent: Array<Record<string, unknown>> = [];
    const record = async (args: Record<string, unknown>) => {
      sent.push(args);
      return { query_id: String(args.query_id), json: async () => ({ data: [] }) };
    };
    const client = { query: record, command: record, exec: record, insert: record, ping: async () => ({ success: true }) } as never;
    const system = executorOverClient(() => client, serviceActor("collector"), { identity: ceiling({ checkedAt: Date.now() }) });
    await system.query({ query: "SELECT 1" });
    await system.command({ query: "SYSTEM FLUSH LOGS" });
    await system.exec({ query: "SELECT 1" });
    await system.insert({ table: "t", values: [], format: "JSONEachRow" });
    await system.session(undefined, "s1").rows("SELECT 1");
    await system.session(undefined, "s1").command("SELECT 1");
    expect(sent.map((args) => args.role)).toEqual(["chouse_system", "chouse_system", "chouse_system", "chouse_system", "chouse_system", "chouse_system"]);

    sent.length = 0;
    await executorOverClient(() => client, serviceActor("collector"), {}).query({ query: "SELECT 1" });
    expect("role" in sent[0]).toBe(false);
  });

  it("sends nothing when the request has no identity, and a call cannot pass a role itself", async () => {
    const { executorOverClient } = await import("./executor");
    const sent: Array<Record<string, unknown>> = [];
    const record = async (args: Record<string, unknown>) => {
      sent.push(args);
      return { query_id: "q", json: async () => ({ data: [] }) };
    };
    const client = { query: record, command: record, exec: record, insert: record, ping: async () => ({ success: true }) } as never;
    const failing = executorOverClient(() => client, serviceActor("collector"), { identity: ceiling({ health: "failing", checkedAt: Date.now() }) });
    await expect(failing.query({ query: "SELECT 1" })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
    expect(sent).toHaveLength(0);

    const system = executorOverClient(() => client, serviceActor("collector"), { identity: ceiling({ checkedAt: Date.now() }) });
    await system.query({ query: "SELECT 1", role: "finance_rw", clickhouse_settings: { role: "finance_rw", max_threads: 1 } } as never);
    expect(sent[0].role).toBe("chouse_system");
    // Not through a setting either: the client would write it into the URL.
    expect(sent[0].clickhouse_settings).toMatchObject({ max_threads: 1 });
    expect("role" in (sent[0].clickhouse_settings as object)).toBe(false);
  });

  it("lets only the identity checks send a bare request or name a role under test, even on a refusing connection", async () => {
    const { executorOverClient } = await import("./executor");
    const sent: Array<Record<string, unknown>> = [];
    const record = async (args: Record<string, unknown>) => {
      sent.push(args);
      return { query_id: "q", json: async () => ({ data: [] }) };
    };
    const client = { query: record, command: record, exec: record, insert: record, ping: async () => ({ success: true }) } as never;
    const failing = ceiling({ health: "failing" });
    await executorOverClient(() => client, serviceActor("health-check"), { identity: failing, roleOverride: null }).query({ query: "SHOW GRANTS" });
    await executorOverClient(() => client, serviceActor("health-check"), { identity: failing, roleOverride: "analyst_ro" }).query({ query: "SHOW GRANTS FOR analyst_ro" });
    expect("role" in sent[0]).toBe(false);
    expect(sent[1].role).toBe("analyst_ro");
  });
});
