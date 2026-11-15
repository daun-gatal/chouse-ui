/**
 * A token that names a scope, on the server's real routes (ADR 0011). The
 * owner here is a super admin: the account for which a scope matters most,
 * because a role used to decide in its place.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { optionalRbacMiddleware } from "../../middleware/dataAccess";
import { errorHandler } from "../../middleware/error";
import api from "../../routes/index";
import { closeDatabase } from "../db";
import { runMigrations } from "../db/migrations";
import { freshDatabase, rawAll, rawRun } from "../db/migrationTestHarness";
import { PERMISSIONS } from "../schema/base";
import { createConnection, getUserConnections } from "../services/connections";
import { generateAccessToken } from "../services/jwt";
import { createPat } from "../services/personalAccessTokens";
import { getUserPermissions } from "../services/rbac";
import { withRequestScope } from "../services/tokenScope";

const OWNER = "routes-owner";
const VIEWER = "routes-viewer";
const SCOPE = [PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_VIEW];
let scoped = "";
let unscoped = "";
let session = "";
let superAdminRole = "";

const app = new Hono();
app.onError(errorHandler);
// As in the server's entry point: the holder is the outermost middleware.
app.use("*", (_c, next) => withRequestScope(() => next()));
app.get("/seen", optionalRbacMiddleware, (c) => c.json({ admin: c.get("isRbacAdmin") === true, roles: c.get("rbacRoles") ?? [] }));
app.route("/api", api);

interface Reply {
  status: number;
  body: { data?: Record<string, unknown>; error?: { message?: string } };
}

async function call(method: string, path: string, bearer: string, body?: unknown): Promise<Reply> {
  const response = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Reply["body"] };
}

const newAdmin = (name: string): Record<string, unknown> => ({ email: `${name}@t.local`, username: name, password: "Routes-pass-123!", roleIds: [superAdminRole] });

describe("a scoped token of a super admin on real routes (ADR 0011)", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET ||= "token-scope-test-secret-0123456789abcdef0123456789";
    await freshDatabase("sqlite");
    await runMigrations();
    superAdminRole = String((await rawAll(sql`SELECT id FROM rbac_roles WHERE name = 'super_admin'`))[0].id);
    const viewerRole = String((await rawAll(sql`SELECT id FROM rbac_roles WHERE name = 'viewer'`))[0].id);
    for (const [id, role] of [[OWNER, superAdminRole], [VIEWER, viewerRole]]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@t.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
      await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`ur-${id}`}, ${id}, ${role}, unixepoch())`);
    }
    scoped = (await createPat(OWNER, { name: "scoped", scopes: SCOPE })).rawToken;
    unscoped = (await createPat(OWNER, { name: "unscoped" })).rawToken;
    session = await generateAccessToken({ sub: OWNER, email: "o@t.local", username: OWNER, roles: ["super_admin"], permissions: await getUserPermissions(OWNER), sessionId: "s1" });
  }, 60_000);

  it("does not carry the administrator role, so it is not an administrator anywhere a role decides", async () => {
    const seen = async (token: string): Promise<unknown> => (await app.request("/seen", { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(await seen(scoped)).toEqual({ admin: false, roles: [] });
    expect(await seen(unscoped)).toEqual({ admin: true, roles: ["super_admin"] });
    expect(await seen(session)).toEqual({ admin: true, roles: ["super_admin"] });
  });

  it("cannot hand out the super admin role with a scope that only creates users", async () => {
    const refused = await call("POST", "/api/rbac/users", scoped, newAdmin("made-by-scoped"));
    expect(refused.status).toBe(403);
    expect(await rawAll(sql`SELECT id FROM rbac_users WHERE username = 'made-by-scoped'`)).toHaveLength(0);
    expect((await call("POST", "/api/rbac/users", unscoped, newAdmin("made-by-unscoped"))).status).toBeLessThan(300);
    expect((await call("POST", "/api/rbac/users", session, newAdmin("made-by-session"))).status).toBeLessThan(300);
  });

  it("is refused what its scope does not name, and passes what it names", async () => {
    expect((await call("GET", "/api/rbac/users", scoped)).status).toBe(200);
    expect((await call("GET", "/api/rbac/roles", scoped)).status).toBe(403);
    expect((await call("GET", "/api/rbac/roles", unscoped)).status).toBe(200);
  });

  it("is told its own permissions, not its owner's", async () => {
    for (const path of ["/api/rbac/auth/me", "/api/rbac/auth/profile"]) {
      const mine = (await call("GET", path, scoped)).body.data?.user as { permissions: string[] };
      expect([...mine.permissions].sort()).toEqual([...SCOPE].sort());
      const owners = (await call("GET", path, session)).body.data?.user as { permissions: string[] };
      expect(owners.permissions.length).toBeGreaterThan(SCOPE.length);
    }
  });

  it("still reaches every connection its owner reaches: a scope narrows permissions, not servers", async () => {
    const connection = await createConnection({ name: "routes-ch", host: "ch.invalid", port: 8123, username: "default" }, OWNER);
    expect((await getUserConnections(OWNER)).map((row) => row.id)).toContain(connection.id);
    expect(await getUserConnections(VIEWER)).toEqual([]);
  });

  it("no token links or unlinks a chat account: that takes a browser session", async () => {
    for (const token of [scoped, unscoped]) {
      expect((await call("GET", "/api/chat-identities", token)).status).toBe(200);
      const link = await call("POST", "/api/chat-identities/telegram/link-code", token, { bot: "chouse_bot" });
      expect(link.status).toBe(403);
      expect(link.body.error?.message).toContain("browser session");
      expect((await call("DELETE", "/api/chat-identities/any", token)).status).toBe(403);
    }
    // A session gets past the fence, to the route's own answer.
    expect((await call("DELETE", "/api/chat-identities/any", session)).status).toBe(404);
  });
});

afterAll(async () => {
  await closeDatabase();
});
