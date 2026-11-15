import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../rbac/db/migrationTestHarness";
import { checkedForTests } from "./checked.test-util";
import { executorOverClient, type ClientLike } from "./executor";
import type { ConnectionIdentity } from "./identity";
import { resetCreateChecks } from "./selfTest";
import { personActor, serviceActor, type ExecutorOptions } from "./types";

interface Sent {
  method: string;
  args: Record<string, unknown>;
}

const CREATE_CHECK = "EXECUTE AS `svc` CREATE DATABASE IF NOT EXISTS system";

/** Records every request. The CREATE check is refused for the missing grant, as a qualifying server does, unless `unchecked`. */
function recordingClient(unchecked = false): { client: ClientLike; sent: Sent[]; statements: () => Sent[] } {
  const sent: Sent[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    sent.push({ method, args });
    if (args.query === CREATE_CHECK && !unchecked) {
      throw Object.assign(new Error("svc: Not enough privileges. To execute this query, it's necessary to have the grant CREATE DATABASE ON system.*. (ACCESS_DENIED)"), { code: "497" });
    }
    return { query_id: String(args.query_id), response_headers: {}, json: async () => ({ data: [] }) };
  };
  const client = { query: record("query"), command: record("command"), exec: record("exec"), insert: record("insert"), ping: async () => ({ success: true }) } as unknown as ClientLike;
  return { client, sent, statements: () => sent.filter((s) => s.args.query !== CREATE_CHECK) };
}

const identity = (over: Partial<ConnectionIdentity> = {}): ConnectionIdentity => ({
  connectionId: "conn-p", mode: "personal", systemRole: "chouse_system", impersonationRole: "chouse_impersonate", health: "ok", healthReason: null, checkedAt: Date.now(), accessContact: null, ...over,
});
const options = (over: Partial<ExecutorOptions> = {}): ExecutorOptions => ({ identity: identity(), login: "svc", connectionId: "conn-p", ...over });
const settingsOf = (sent: Sent): Record<string, unknown> => sent.args.clickhouse_settings as Record<string, unknown>;

describe("the executor on a personal connection (ADR 0033 §7)", () => {
  beforeAll(async () => {
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    for (const id of ["ann", "ben", "eve"]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@t.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
    }
    await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, is_default, is_active, ssl_enabled, identity_mode, created_at, updated_at) VALUES ('conn-p', 'p', 'h', 8123, 'svc', 0, 1, 0, 'personal', unixepoch(), unixepoch())`);
    for (const [id, user, chUser] of [["l1", "ann", "alice"], ["l2", "ben", "bob"]]) {
      await rawRun(sql`INSERT INTO rbac_clickhouse_bindings (id, user_id, connection_id, clickhouse_user, clickhouse_user_id, state, created_at, updated_at) VALUES (${id}, ${user}, 'conn-p', ${chUser}, ${`id-${id}`}, 'active', 1, 1)`);
    }
  });
  beforeEach(() => resetCreateChecks());
  afterAll(async () => {
    await closeDatabase();
  });

  it("sends CHouse-built text as the person's own user, with the impersonation role", async () => {
    const { client, statements } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ann"), options());
    await executor.query({ query: "SHOW DATABASES", format: "JSON" });
    await executor.command({ query: "DROP TABLE secret.t;" });
    await executor.exec({ query: "SELECT 1" });
    expect(statements().map((s) => [s.method, s.args.query, s.args.role])).toEqual([
      ["query", "EXECUTE AS `alice` SHOW DATABASES", "chouse_impersonate"],
      ["command", "EXECUTE AS `alice` DROP TABLE secret.t", "chouse_impersonate"],
      ["exec", "EXECUTE AS `alice` SELECT 1", "chouse_impersonate"],
    ]);
    for (const s of statements()) expect(String(s.args.query_id).startsWith("chouse:p:ann:")).toBe(true);
  });

  it("never puts readonly on the URL: it goes into the statement, or the request is refused", async () => {
    const { client, statements } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ann"), options({ defaults: { readonly: "2" } }));
    await executor.query({ query: "SELECT 1", format: "JSON" });
    await executor.query({ query: "SHOW TABLES", format: "JSON", clickhouse_settings: { readonly: "1", max_execution_time: 5 } });
    expect(statements().map((s) => s.args.query)).toEqual(["EXECUTE AS `alice` SELECT 1\nSETTINGS readonly = 1", "EXECUTE AS `alice` SHOW TABLES"]);
    for (const s of statements()) expect("readonly" in settingsOf(s)).toBe(false);
    expect(settingsOf(statements()[1]).max_execution_time).toBe(5);
    await expect(executor.command({ query: "DROP TABLE t" })).rejects.toThrow("read-only request on a personal connection");
    expect(statements()).toHaveLength(2);
  });

  it("checks that the server still refuses an unchecked CREATE, once a minute, before anything runs as a person", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ann"), options());
    await executor.query({ query: "SELECT 1" });
    await executor.query({ query: "SELECT 2" });
    const checks = sent.filter((s) => s.args.query === CREATE_CHECK);
    expect(checks).toHaveLength(1);
    expect(sent[0]).toBe(checks[0]);
    expect(checks[0].args.role).toBe("chouse_impersonate");
    expect(String(checks[0].args.query_id).startsWith("chouse:s:health-check:")).toBe(true);
  });

  it("refuses everything on a build that runs CREATE unchecked, and sends nothing as the person", async () => {
    const { client, statements } = recordingClient(true);
    const executor = executorOverClient(() => client, personActor("ann"), options());
    await expect(executor.query({ query: "SELECT 1" })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE", statusCode: 503 });
    await expect(executor.insert({ table: "t", values: [], format: "JSONEachRow" })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
    expect(statements()).toHaveLength(0);
  });

  it("refuses when the handle does not know the connection's login", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ann"), options({ login: undefined }));
    await expect(executor.query({ query: "SELECT 1" })).rejects.toThrow("needs its login");
    expect(sent).toHaveLength(0);
  });

  it("sends a checked statement as the text ClickHouse confirmed, read-only whenever it can be", async () => {
    const { client, statements } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ann"), options());
    const read = checkedForTests({ sql: "SELECT 1", accountId: "ann", connectionId: "conn-p", isRead: true, mayWrite: true, impersonated: { user: "alice", sql: "EXECUTE AS `alice` SELECT 1", readOnlySql: "EXECUTE AS `alice` SELECT 1\nSETTINGS readonly = 1" } });
    const write = checkedForTests({ sql: "DROP TABLE t", accountId: "ann", connectionId: "conn-p", isRead: false, mayWrite: true, impersonated: { user: "alice", sql: "EXECUTE AS `alice` DROP TABLE t", readOnlySql: null } });
    await executor.queryChecked(read, { format: "JSON", clickhouse_settings: { readonly: "0" } as never });
    await executor.commandChecked(write);
    expect(statements().map((s) => s.args.query)).toEqual(["EXECUTE AS `alice` SELECT 1\nSETTINGS readonly = 1", "EXECUTE AS `alice` DROP TABLE t"]);
    for (const s of statements()) {
      expect("readonly" in settingsOf(s)).toBe(false);
      expect(s.args.role).toBe("chouse_impersonate");
    }
  });

  it("refuses a statement that must be a read and cannot be sent as one", async () => {
    const { client, statements } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ann"), options());
    const impersonated = { user: "alice", sql: "EXECUTE AS `alice` INSERT INTO t SELECT 1", readOnlySql: null };
    // A read-only feature (a dashboard panel), and a person who may write nothing.
    await expect(executor.commandChecked(checkedForTests({ sql: "INSERT INTO t SELECT 1", accountId: "ann", connectionId: "conn-p", isRead: false, mayWrite: true, impersonated }), { readOnlyFeature: 1 })).rejects.toMatchObject({ code: "READ_ONLY", statusCode: 403 });
    await expect(executor.commandChecked(checkedForTests({ sql: "INSERT INTO t SELECT 1", accountId: "ann", connectionId: "conn-p", isRead: false, mayWrite: false, impersonated }))).rejects.toMatchObject({ code: "READ_ONLY" });
    // A read whose read-only text ClickHouse did not confirm (a typed FORMAT clause).
    await expect(executor.queryChecked(checkedForTests({ sql: "SELECT 1 FORMAT CSV", accountId: "ann", connectionId: "conn-p", isRead: true, mayWrite: true, impersonated: { user: "alice", sql: "x", readOnlySql: null } }))).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(statements()).toHaveLength(0);
  });

  it("refuses a statement checked for another user, one that was never wrapped, and a wrapped one on another kind", async () => {
    const { client, statements } = recordingClient();
    const ann = executorOverClient(() => client, personActor("ann"), options());
    const forBob = { user: "bob", sql: "EXECUTE AS `bob` SELECT 1", readOnlySql: "EXECUTE AS `bob` SELECT 1" };
    // ann's link pointed at bob when the statement was checked, and at alice now.
    await expect(ann.queryChecked(checkedForTests({ sql: "SELECT 1", accountId: "ann", connectionId: "conn-p", isRead: true, mayWrite: true, impersonated: forBob }))).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    await expect(ann.queryChecked(checkedForTests({ sql: "SELECT 1", accountId: "ann", connectionId: "conn-p", isRead: true, mayWrite: true }))).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    const shared = executorOverClient(() => client, personActor("ann"), { connectionId: "conn-p" });
    await expect(shared.queryChecked(checkedForTests({ sql: "SELECT 1", accountId: "ann", connectionId: "conn-p", isRead: true, mayWrite: true, impersonated: forBob }))).rejects.toThrow("only be sent on one");
    expect(statements()).toHaveLength(0);
  });

  it("imports rows through a session of two requests: switch user with the role, then insert with no role", async () => {
    const { client, statements } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ben"), options());
    await executor.insert({ table: "secret.t", values: [{ a: 1 }], format: "JSONEachRow", query_id: "imp1", clickhouse_settings: { readonly: "1" } as never });
    const [open, insert] = statements();
    expect(statements()).toHaveLength(2);
    expect([open.method, open.args.query, open.args.role]).toEqual(["command", "EXECUTE AS `bob`", "chouse_impersonate"]);
    expect(settingsOf(open).session_timeout).toBe("60");
    expect(String(open.args.session_id)).toMatch(/^chouse-import-[0-9a-f]{32}$/);
    expect(insert.method).toBe("insert");
    expect(insert.args.session_id).toBe(open.args.session_id);
    expect("role" in insert.args).toBe(false);
    expect(settingsOf(insert).session_check).toBe(1);
    expect("readonly" in settingsOf(insert)).toBe(false);
    expect(insert.args.query_id).toBe("chouse:p:ben:imp1");
    expect(insert.args.table).toBe("secret.t");
  });

  it("uses a new session for every import, and never takes one from the call", async () => {
    const { client, statements } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ben"), options());
    await executor.insert({ table: "t", values: [], format: "JSONEachRow", session_id: "mine" } as never);
    await executor.insert({ table: "t", values: [], format: "JSONEachRow" });
    const ids = statements().filter((s) => s.method === "insert").map((s) => s.args.session_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids).not.toContain("mine");
  });

  it("refuses a pinned session, and wraps each statement of an unpinned sequence", async () => {
    const { client, statements } = recordingClient();
    const executor = executorOverClient(() => client, personActor("ben"), options());
    await expect(executor.session(undefined, "pinned-1").rows("SELECT 1")).rejects.toMatchObject({ code: "UNAVAILABLE_ON_CONNECTION", statusCode: 400 });
    await expect(executor.session(undefined, "pinned-1").command("CREATE TABLE t (a Int8) ENGINE = Memory")).rejects.toMatchObject({ code: "UNAVAILABLE_ON_CONNECTION" });
    expect(statements()).toHaveLength(0);
    await executor.session().rows("SELECT 1");
    expect(statements().map((s) => [s.args.query, s.args.session_id])).toEqual([["EXECUTE AS `bob` SELECT 1", undefined]]);
  });

  it("CHouse's own work names the system role and is not wrapped, checked or run as anyone", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, serviceActor("collector"), options());
    await executor.query({ query: "SELECT 1 FROM system.parts", clickhouse_settings: { readonly: "1" } });
    await executor.session(undefined, "pinned-ok").rows("SELECT 1");
    expect(sent.map((s) => [s.args.query, s.args.role])).toEqual([["SELECT 1 FROM system.parts", "chouse_system"], ["SELECT 1", "chouse_system"]]);
    expect(settingsOf(sent[0]).readonly).toBe("1");
  });

  it("refuses an account with no link before anything is sent", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, personActor("eve"), options());
    await expect(executor.query({ query: "SELECT 1" })).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    await expect(executor.insert({ table: "t", values: [], format: "JSONEachRow" })).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    expect(sent).toHaveLength(0);
  });

  it("a login check on a personal connection sends exactly what it was told to, with no wrapping", async () => {
    const { client, sent } = recordingClient();
    const executor = executorOverClient(() => client, serviceActor("health-check"), options({ roleOverride: "chouse_impersonate" }));
    await executor.query({ query: "EXECUTE AS `alice` SELECT 1" });
    expect(sent.map((s) => [s.args.query, s.args.role])).toEqual([["EXECUTE AS `alice` SELECT 1", "chouse_impersonate"]]);
  });
});
