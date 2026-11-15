import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { setExecutorClientForTests } from "../../services/chExecutor/executor";
import { closeDatabase } from "../db";
import { runMigrations } from "../db/migrations";
import { freshDatabase, rawAll, rawRun } from "../db/migrationTestHarness";
import {
  bindingCounts,
  checkConnectionBindings,
  commentText,
  confirmBinding,
  createBinding,
  getBinding,
  grantScript,
  listBindingsOfConnection,
  listBindingsOfUser,
  recheckBinding,
  removeBinding,
  resetBindingsOfConnection,
  suspendBindingsOf,
  testBinding,
} from "./clickhouseBindings";
import { createConnection, getUserConnections } from "./connections";

/** A ClickHouse user as the checks see it. */
interface FakeUser {
  id: string;
  grants: string[];
  database?: string;
}

interface FakeServer {
  users: Record<string, FakeUser>;
  /** Users the impersonation role may act as. */
  impersonable: Set<string>;
  roles: Record<string, string[]>;
  down: boolean;
  asked: Array<{ role: string | undefined; query: string }>;
}

function chError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code: String(code) });
}

let server: FakeServer;

function install(): void {
  setExecutorClientForTests(() => ({
    async query(args: { query: string; role?: string; query_params?: Record<string, unknown> }) {
      server.asked.push({ role: args.role, query: args.query });
      if (server.down) throw new Error("connect ECONNREFUSED");
      const text = ((): string => {
        if (args.query.startsWith("SELECT toString(id) FROM system.users")) {
          if (args.role !== "chouse_system" && args.role !== undefined) throw chError(497, "svc: Not enough privileges");
          return server.users[String(args.query_params?.n)]?.id ?? "";
        }
        if (args.query === "SHOW GRANTS FOR chouse_impersonate") return [...server.impersonable].map((user) => `GRANT IMPERSONATE ON ${user} TO chouse_impersonate`).join("\n");
        const as = /^EXECUTE AS `(\w+)` (.+)$/.exec(args.query);
        if (!as) throw new Error(`fake server: unexpected statement ${args.query}`);
        if (args.role !== "chouse_impersonate") throw chError(497, "svc: Not enough privileges. To execute this query, it's necessary to have the grant IMPERSONATE");
        const [, name, statement] = as;
        const user = server.users[name];
        if (!user || !server.impersonable.has(name)) throw chError(497, `svc: Not enough privileges. To execute this query, it's necessary to have the grant IMPERSONATE ON ${name}. (ACCESS_DENIED)`);
        if (statement === "SELECT 1") return "1";
        if (statement === "SHOW GRANTS") return user.grants.join("\n");
        if (statement === "SELECT currentDatabase()") return user.database ?? "default";
        const forRole = /^SHOW GRANTS FOR (\w+)$/.exec(statement);
        if (forRole) return (server.roles[forRole[1]] ?? []).join("\n");
        throw new Error(`fake server: unexpected statement ${args.query}`);
      })();
      return { query_id: "q", text: async () => text, json: async () => ({ data: [] }) };
    },
  }));
}

/** True when the account's link on the connection is the one statements run with. */
const hasActiveBinding = async (userId: string, connectionId: string): Promise<boolean> =>
  (await listBindingsOfUser(userId)).some((binding) => binding.connectionId === connectionId && binding.state === "active");

describe("bindings between accounts and ClickHouse users (ADR 0033 §7.4)", () => {
  let personal = "";
  let shared = "";

  beforeAll(async () => {
    process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
    process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
    for (const id of ["ann", "ben", "cat", "root"]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@t.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
    }
    personal = (await createConnection({ name: "personal", host: "h", port: 8123, username: "svc", password: "p", sslEnabled: false })).id;
    shared = (await createConnection({ name: "shared", host: "h2", port: 8123, username: "shared_login", password: "p", sslEnabled: false })).id;
    await rawRun(sql`UPDATE rbac_clickhouse_connections SET identity_mode = 'personal', system_role = 'chouse_system', impersonation_role = 'chouse_impersonate', identity_health = 'ok', identity_checked_at = ${Date.now()} WHERE id = ${personal}`);
  });

  beforeEach(async () => {
    await rawRun(sql`DELETE FROM rbac_clickhouse_bindings`);
    server = {
      users: {
        alice: { id: "id-alice", grants: ["GRANT SELECT ON public.* TO alice"], database: "analytics" },
        bob: { id: "id-bob", grants: ["GRANT SELECT ON public.* TO bob", "GRANT team TO bob"] },
        carol: { id: "id-carol", grants: ["GRANT CREATE USER ON *.* TO carol"] },
      },
      impersonable: new Set(["alice", "bob", "carol", "svc"]),
      roles: { team: ["GRANT INSERT ON secret.* TO team"] },
      down: false,
      asked: [],
    };
    install();
  });

  afterAll(async () => {
    setExecutorClientForTests(null);
    await closeDatabase();
  });

  it("creates a link that is active once ClickHouse lets the connection act as the user", async () => {
    const binding = await createBinding(personal, "ann", " alice ", "root");
    expect(binding).toMatchObject({ userId: "ann", accountName: "ann", connectionId: personal, connectionKind: "personal", clickhouseUser: "alice", state: "active", reason: null, defaultDatabase: "analytics" });
    expect(await hasActiveBinding("ann", personal)).toBe(true);
    expect(await hasActiveBinding("ben", personal)).toBe(false);
    const stored = await rawAll(sql`SELECT clickhouse_user_id, created_by FROM rbac_clickhouse_bindings WHERE id = ${binding.id}`);
    expect(stored[0]).toMatchObject({ clickhouse_user_id: "id-alice", created_by: "root" });
    // The id is read with the system role, the tests with the impersonation role.
    expect(server.asked.find((entry) => entry.query.includes("system.users"))?.role).toBe("chouse_system");
    expect(server.asked.filter((entry) => entry.query.startsWith("EXECUTE AS")).every((entry) => entry.role === "chouse_impersonate")).toBe(true);
  });

  it("waits while the grant is missing, shows the grant to run, and becomes active on the next check", async () => {
    server.impersonable.delete("alice");
    const binding = await createBinding(personal, "ann", "alice", "root");
    expect(binding.state).toBe("pending_grant");
    expect(binding.reason).toContain("alice");
    expect((await grantScript(personal)).grants).toEqual(["GRANT IMPERSONATE ON alice TO chouse_impersonate;  -- ann"]);
    server.impersonable.add("alice");
    expect((await recheckBinding(binding.id, "ann")).state).toBe("active");
    expect((await grantScript(personal)).grants).toEqual([]);
  });

  it("follows the roles a user holds when deciding whether it may be linked", async () => {
    expect((await createBinding(personal, "ben", "bob", "root")).state).toBe("active");
    await removeBinding((await listBindingsOfUser("ben"))[0].id, "root");
    server.roles.team = ["GRANT INSERT ON secret.* TO team", "GRANT deep TO team"];
    server.roles.deep = ["GRANT ROLE ADMIN ON *.* TO deep"];
    const binding = await createBinding(personal, "ben", "bob", "root");
    expect(binding.state).toBe("disabled");
    expect(binding.reason).toContain("its role deep");
  });

  it("disables a link to a user who manages users, passes grants on, or may act as others", async () => {
    for (const grants of [
      ["GRANT CREATE USER ON *.* TO carol"],
      ["GRANT SELECT ON public.* TO carol WITH GRANT OPTION"],
      ["GRANT IMPERSONATE ON alice TO carol"],
      ["GRANT ALL ON *.* TO carol"],
      ["GRANT `odd-role` TO carol"],
    ]) {
      await rawRun(sql`DELETE FROM rbac_clickhouse_bindings`);
      server.users.carol.grants = grants;
      const binding = await createBinding(personal, "cat", "carol", "root");
      expect({ grants, state: binding.state }).toEqual({ grants, state: "disabled" });
    }
    expect(await hasActiveBinding("cat", personal)).toBe(false);
  });

  it("refuses names it will not write, the default user, a connection's own login, and a user that is not there", async () => {
    for (const name of ["a-b", "a.b", "a b", "1abc", "a`b", "", "x".repeat(129)]) {
      await expect(createBinding(personal, "ann", name, "root")).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(createBinding(personal, "ann", "default", "root")).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("default") });
    // The login of this connection and of any other.
    await expect(createBinding(personal, "ann", "svc", "root")).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("login of a connection") });
    await expect(createBinding(personal, "ann", "shared_login", "root")).rejects.toMatchObject({ statusCode: 400 });
    await expect(createBinding(personal, "ann", "nobody", "root")).rejects.toMatchObject({ statusCode: 422, code: "BINDING_USER_NOT_FOUND" });
    await expect(createBinding(personal, "ghost", "alice", "root")).rejects.toMatchObject({ statusCode: 400 });
    await expect(createBinding("no-such-connection", "ann", "alice", "root")).rejects.toMatchObject({ statusCode: 404 });
    server.down = true;
    await expect(createBinding(personal, "ann", "alice", "root")).rejects.toMatchObject({ statusCode: 422, code: "BINDING_LOOKUP_FAILED" });
    expect(await listBindingsOfConnection(personal)).toEqual([]);
  });

  it("keeps one link per account and connection, and one account per ClickHouse user", async () => {
    await createBinding(personal, "ann", "alice", "root");
    await expect(createBinding(personal, "ann", "bob", "root")).rejects.toMatchObject({ statusCode: 409 });
    await expect(createBinding(personal, "ben", "alice", "root")).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("another account") });
    expect((await listBindingsOfConnection(personal)).length).toBe(1);
  });

  it("a link on a connection that is not personal is prepared and waits", async () => {
    const binding = await createBinding(shared, "ann", "alice", "root");
    expect(binding).toMatchObject({ state: "pending_grant", connectionKind: "shared" });
    expect(binding.reason).toContain("not a personal connection yet");
    // The id was read with the shared login itself: no role is named.
    expect(server.asked.find((entry) => entry.query.includes("system.users"))?.role).toBeUndefined();
    expect(server.asked.some((entry) => entry.query.startsWith("EXECUTE AS"))).toBe(false);
    expect((await grantScript(shared)).grants).toEqual(["GRANT IMPERSONATE ON alice TO <impersonation role>;  -- ann"]);
  });

  it("disables a link to a user that later became the connection's own login", async () => {
    server.users.svc2 = { id: "id-svc2", grants: [] };
    server.impersonable.add("svc2");
    const binding = await createBinding(personal, "ann", "svc2", "root");
    expect(binding.state).toBe("active");
    await rawRun(sql`UPDATE rbac_clickhouse_connections SET username = 'svc2' WHERE id = ${personal}`);
    try {
      await checkConnectionBindings(personal);
      const after = await getBinding(binding.id);
      expect(after?.state).toBe("disabled");
      expect(after?.reason).toContain("own login");
    } finally {
      await rawRun(sql`UPDATE rbac_clickhouse_connections SET username = 'svc' WHERE id = ${personal}`);
    }
  });

  it("disables a link when the user behind the name changed or is gone", async () => {
    const binding = await createBinding(personal, "ann", "alice", "root");
    server.users.alice.id = "id-alice-recreated";
    await checkConnectionBindings(personal);
    const after = await getBinding(binding.id);
    expect(after?.state).toBe("disabled");
    expect(after?.reason).toContain("dropped and created again");
    // A disabled link is not tested again and cannot be confirmed.
    server.users.alice.id = "id-alice";
    await checkConnectionBindings(personal);
    expect((await getBinding(binding.id))?.state).toBe("disabled");
    await expect(confirmBinding(binding.id, "root")).rejects.toMatchObject({ statusCode: 400 });

    const ben = await createBinding(personal, "ben", "bob", "root");
    delete server.users.bob;
    await checkConnectionBindings(personal);
    expect((await getBinding(ben.id))?.reason).toContain("no longer exists");
  });

  it("sends an active link back to waiting when the grant is taken away, and disables one that gained a privilege", async () => {
    const ann = await createBinding(personal, "ann", "alice", "root");
    const ben = await createBinding(personal, "ben", "bob", "root");
    server.impersonable.delete("alice");
    server.users.bob.grants.push("GRANT ALTER USER ON *.* TO bob");
    await checkConnectionBindings(personal);
    expect((await getBinding(ann.id))?.state).toBe("pending_grant");
    expect((await getBinding(ben.id))?.state).toBe("disabled");
  });

  it("changes nothing when ClickHouse does not answer", async () => {
    const binding = await createBinding(personal, "ann", "alice", "root");
    server.down = true;
    await checkConnectionBindings(personal);
    expect((await recheckBinding(binding.id, "ann")).state).toBe("active");
  });

  it("suspends the links in use or waiting, and only a confirmation brings one back", async () => {
    const ann = await createBinding(personal, "ann", "alice", "root");
    server.users.carol.grants = ["GRANT CREATE USER ON *.* TO carol"];
    const cat = await createBinding(personal, "cat", "carol", "root");
    expect(await suspendBindingsOf("ann", "An administrator reset the account's password.", "root")).toBe(1);
    expect(await suspendBindingsOf("cat", "x")).toBe(0);
    expect(await suspendBindingsOf("nobody", "x")).toBe(0);
    expect((await getBinding(ann.id))).toMatchObject({ state: "suspended", reason: "An administrator reset the account's password." });
    expect((await getBinding(cat.id))?.state).toBe("disabled");
    // Neither the health check nor "check again" lifts it.
    await checkConnectionBindings(personal);
    expect((await recheckBinding(ann.id, "ann")).state).toBe("suspended");
    expect(await hasActiveBinding("ann", personal)).toBe(false);
    expect((await confirmBinding(ann.id, "root")).state).toBe("active");
    // Suspending twice is one suspension.
    await suspendBindingsOf("ann", "again");
    expect(await suspendBindingsOf("ann", "again")).toBe(0);
  });

  it("a check that started before a suspension does not write over it", async () => {
    const binding = await createBinding(personal, "ann", "alice", "root");
    // The health round holds the link as it was listed; the suspension lands while the round is still testing others.
    const listed = (await listBindingsOfConnection(personal)).find((entry) => entry.id === binding.id)!;
    await suspendBindingsOf("ann", "An administrator reset the account's password.", "root");
    expect((await testBinding(listed)).state).toBe("suspended");
    expect(await hasActiveBinding("ann", personal)).toBe(false);
  });

  it("a state written between a test's read and its write is kept", async () => {
    const binding = await createBinding(personal, "ann", "alice", "root");
    // The suspension arrives while ClickHouse is answering the test's first statement.
    const answer = server.users.alice;
    Object.defineProperty(server.users, "alice", {
      configurable: true,
      get() {
        void rawRun(sql`UPDATE rbac_clickhouse_bindings SET state = 'suspended', reason = 'reset' WHERE id = ${binding.id}`);
        return answer;
      },
    });
    try {
      await testBinding(binding);
    } finally {
      Object.defineProperty(server.users, "alice", { configurable: true, writable: true, value: answer });
    }
    expect((await getBinding(binding.id))?.state).toBe("suspended");
  });

  it("only an active link lists the connection for an account, and a policy does not admit to a personal one", async () => {
    const binding = await createBinding(personal, "ann", "alice", "root");
    expect((await getUserConnections("ann")).map((connection) => connection.id)).toEqual([personal]);
    await suspendBindingsOf("ann", "reset", "root");
    expect(await getUserConnections("ann")).toEqual([]);
    await confirmBinding(binding.id, "root");
    expect((await getUserConnections("ann")).length).toBe(1);
    expect(await getUserConnections("ben")).toEqual([]);
  });

  it("sends the links in use back to waiting when the connection is pointed at another server", async () => {
    const binding = await createBinding(personal, "ann", "alice", "root");
    await resetBindingsOfConnection(personal, "root");
    expect(await getBinding(binding.id)).toMatchObject({ state: "pending_grant", reason: "The connection was pointed at another server." });
  });

  it("writes an account's name into the grant script as comment text only", async () => {
    server.impersonable.delete("alice");
    await rawRun(sql`UPDATE rbac_users SET username = ${"ann\nDROP USER bob; --"} WHERE id = 'ann'`);
    try {
      await createBinding(personal, "ann", "alice", "root");
      const script = (await grantScript(personal)).grants;
      expect(script).toEqual(["GRANT IMPERSONATE ON alice TO chouse_impersonate;  -- ann_DROP USER bob_ --"]);
      // One statement, one line: nothing an account name holds can start another.
      expect(script.join("\n").split("\n")).toHaveLength(1);
      expect(script[0].split(";")).toHaveLength(2);
    } finally {
      await rawRun(sql`UPDATE rbac_users SET username = 'ann' WHERE id = 'ann'`);
    }
    expect(commentText("ok.name+1@example.com")).toBe("ok.name+1@example.com");
    expect(commentText("a/*b*/\r\n`c`'d'")).toBe("a__b_____c__d_");
  });

  it("lists users the role may still act as that no link uses, with the statement that takes the grant away", async () => {
    await createBinding(personal, "ann", "alice", "root");
    const script = await grantScript(personal);
    // `svc` is the login's grant on itself, which the self-test uses.
    expect(script.unbound).toEqual([
      { user: "bob", revoke: "REVOKE IMPERSONATE ON bob FROM chouse_impersonate;" },
      { user: "carol", revoke: "REVOKE IMPERSONATE ON carol FROM chouse_impersonate;" },
    ]);
    server.down = true;
    expect((await grantScript(personal)).unbound).toEqual([]);
  });

  it("audits creation, every state change and removal, and removes links with the row", async () => {
    await rawRun(sql`DELETE FROM rbac_audit_logs`);
    const binding = await createBinding(personal, "ann", "alice", "root");
    await suspendBindingsOf("ann", "reset", "root");
    await confirmBinding(binding.id, "root");
    await removeBinding(binding.id, "root");
    await expect(removeBinding(binding.id, "root")).rejects.toMatchObject({ statusCode: 404 });
    const actions = (await rawAll(sql`SELECT action FROM rbac_audit_logs WHERE resource_id = ${binding.id} ORDER BY created_at, action`)).map((row) => String(row.action));
    expect(actions.filter((action) => action === "binding.created")).toHaveLength(1);
    expect(actions.filter((action) => action === "binding.removed")).toHaveLength(1);
    // pending → active, active → suspended, suspended → pending, pending → active.
    expect(actions.filter((action) => action === "binding.state_changed")).toHaveLength(4);
    expect(await bindingCounts(personal)).toEqual({ pending_grant: 0, active: 0, suspended: 0, disabled: 0 });
  });
});
