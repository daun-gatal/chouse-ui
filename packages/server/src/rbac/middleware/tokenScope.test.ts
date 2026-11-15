/**
 * A token is held to its scope on every way a route asks for a permission
 * (ADR 0011). Real database, real tokens, real middleware: nothing here is
 * stubbed, because the gap this guards against lived between the middleware
 * and the permission lookup it falls back to.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { checkTableAccess, filterDatabases, filterTables, optionalRbacMiddleware, validateQueryAccess } from "../../middleware/dataAccess";
import { AppError } from "../../types";
import { closeDatabase } from "../db";
import { runMigrations } from "../db/migrations";
import { freshDatabase, rawAll, rawRun } from "../db/migrationTestHarness";
import { PERMISSIONS } from "../schema/base";
import { generateAccessToken } from "../services/jwt";
import { createPat } from "../services/personalAccessTokens";
import { getUserPermissions, userHasAllPermissions, userHasAnyPermission, userHasPermission } from "../services/rbac";
import { runWithTokenScope, tokenPermissionsFor, withRequestScope } from "../services/tokenScope";
import { getRbacUser, optionalRbacAuthMiddleware, rbacAuthMiddleware, refuseScopedToken, requireAllPermissions, requireAnyPermission, requirePermission } from "./rbacAuth";

const OWNER = "scope-owner";
let scoped = "";
let unscoped = "";
let session = "";
let staleSession = "";

const app = new Hono();
app.onError((error, c) => (error instanceof AppError ? c.json({ code: error.code, message: error.message }, error.statusCode as 400) : c.json({ message: String(error) }, 500)));
// As the server does: one holder per request, opened before anything else.
app.use("*", (_c, next) => withRequestScope(() => next()));
app.get("/one", requirePermission(PERMISSIONS.USERS_VIEW), (c) => c.json({ ok: true }));
// The way several routers authenticate: they run the middleware with an empty continuation and carry on after it.
app.get("/wrapped", async (c) => {
  await rbacAuthMiddleware(c, async () => {});
  return (await userHasPermission(getRbacUser(c).sub, PERMISSIONS.USERS_VIEW)) ? c.json({ ok: true }) : c.json({ code: "FORBIDDEN" }, 403);
});
app.get("/wrapped-optional", async (c) => {
  await optionalRbacMiddleware(c, async () => {});
  const userId = c.get("rbacUserId");
  return userId && (await userHasPermission(userId, PERMISSIONS.USERS_VIEW)) ? c.json({ ok: true }) : c.json({ code: "FORBIDDEN" }, 403);
});
app.get("/held", requirePermission(PERMISSIONS.TABLE_SELECT), (c) => c.json({ ok: true }));
app.get("/any", requireAnyPermission([PERMISSIONS.USERS_VIEW, PERMISSIONS.ROLES_VIEW]), (c) => c.json({ ok: true }));
app.get("/all", requireAllPermissions([PERMISSIONS.TABLE_SELECT, PERMISSIONS.USERS_VIEW]), (c) => c.json({ ok: true }));
// The hand-written form many routes use: the credential's list, else the database by account id.
app.get("/inline", rbacAuthMiddleware, async (c) => {
  const allowed = (c.get("rbacPermissions") ?? []).includes(PERMISSIONS.USERS_VIEW) || (await userHasPermission(getRbacUser(c).sub, PERMISSIONS.USERS_VIEW));
  return allowed ? c.json({ ok: true }) : c.json({ code: "FORBIDDEN" }, 403);
});
app.get("/inline-optional", optionalRbacMiddleware, async (c) => {
  const userId = c.get("rbacUserId");
  return userId && (await userHasAnyPermission(userId, [PERMISSIONS.USERS_VIEW])) ? c.json({ ok: true }) : c.json({ code: "FORBIDDEN" }, 403);
});
app.get("/inline-optional-auth", optionalRbacAuthMiddleware, async (c) => {
  const userId = c.get("rbacUserId");
  return userId && (await userHasAllPermissions(userId, [PERMISSIONS.USERS_VIEW])) ? c.json({ ok: true }) : c.json({ code: "FORBIDDEN" }, 403);
});
// A route gated by a role alone.
app.get("/role-only", rbacAuthMiddleware, (c) => {
  refuseScopedToken(c);
  return getRbacUser(c).roles.includes("super_admin") ? c.json({ ok: true }) : c.json({ code: "FORBIDDEN" }, 403);
});
// Another account's permissions are never answered from this token.
app.get("/about-other", rbacAuthMiddleware, async (c) => c.json({ other: await userHasPermission("scope-other", PERMISSIONS.USERS_VIEW) }));

const call = (path: string, token: string): Promise<Response> => Promise.resolve(app.request(path, { headers: { Authorization: `Bearer ${token}` } }));
const statuses = async (token: string): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const path of ["/one", "/held", "/any", "/all", "/inline", "/inline-optional", "/inline-optional-auth", "/role-only", "/wrapped", "/wrapped-optional"]) out[path] = (await call(path, token)).status;
  return out;
};

describe("a token is held to its scope (ADR 0011)", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET ||= "token-scope-test-secret-0123456789abcdef0123456789";
    await freshDatabase("sqlite");
    await runMigrations();
    const role = await rawAll(sql`SELECT id FROM rbac_roles WHERE name = 'super_admin'`);
    for (const id of [OWNER, "scope-other"]) {
      await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@t.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
      await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`ur-${id}`}, ${id}, ${String(role[0].id)}, unixepoch())`);
    }
    scoped = (await createPat(OWNER, { name: "scoped", scopes: [PERMISSIONS.TABLE_SELECT] })).rawToken;
    unscoped = (await createPat(OWNER, { name: "unscoped" })).rawToken;
    const all = await getUserPermissions(OWNER);
    session = await generateAccessToken({ sub: OWNER, email: "o@t.local", username: OWNER, roles: ["super_admin"], permissions: all, sessionId: "s1" });
    // Signed in before a permission was granted: the snapshot in the session lacks it.
    staleSession = await generateAccessToken({ sub: OWNER, email: "o@t.local", username: OWNER, roles: ["super_admin"], permissions: [PERMISSIONS.TABLE_SELECT], sessionId: "s2" });
  }, 60_000);

  it("a token scoped to one permission passes only what that permission gates", async () => {
    expect(await statuses(scoped)).toEqual({ "/one": 403, "/held": 200, "/any": 403, "/all": 403, "/inline": 403, "/inline-optional": 403, "/inline-optional-auth": 403, "/role-only": 403, "/wrapped": 403, "/wrapped-optional": 403 });
  });

  it("a token without a scope inherits everything its owner may do", async () => {
    expect(Object.values(await statuses(unscoped)).every((status) => status === 200)).toBe(true);
  });

  it("a browser session is unchanged, and still sees a permission granted after it signed in", async () => {
    expect(Object.values(await statuses(session)).every((status) => status === 200)).toBe(true);
    expect(Object.values(await statuses(staleSession)).every((status) => status === 200)).toBe(true);
  });

  it("the refusal names the permission, and the role-only route says it is outside the token's scope", async () => {
    expect(await (await call("/one", scoped)).json()).toMatchObject({ message: "Permission 'users:view' required for this action" });
    expect((await (await call("/role-only", scoped)).json()).message).toContain("not within this token's scope");
  });

  it("a question about another account is answered from that account, not from the token", async () => {
    expect(await (await call("/about-other", scoped)).json()).toEqual({ other: true });
  });

  it("a session that follows a token in the same holder clears the token's scope", async () => {
    await withRequestScope(async () => {
      const mixed = new Hono();
      mixed.get("/x", async (c) => {
        await rbacAuthMiddleware(c, async () => {});
        return c.json({ allowed: await userHasPermission(OWNER, PERMISSIONS.USERS_VIEW) });
      });
      expect(await (await mixed.request("/x", { headers: { Authorization: `Bearer ${scoped}` } })).json()).toEqual({ allowed: false });
      expect(await (await mixed.request("/x", { headers: { Authorization: `Bearer ${staleSession}` } })).json()).toEqual({ allowed: true });
    });
  });

  it("the scope ends with the request, and never leaks between two requests running at once", async () => {
    const results = await Promise.all([call("/inline", scoped), call("/inline", unscoped), call("/inline", scoped), call("/inline", session)]);
    expect(results.map((response) => response.status)).toEqual([403, 200, 403, 200]);
    expect(tokenPermissionsFor(OWNER)).toBeNull();
    expect(await userHasPermission(OWNER, PERMISSIONS.USERS_VIEW)).toBe(true);
  });

  it("inside a token's scope every permission lookup by account id answers from the token's list", async () => {
    await runWithTokenScope(OWNER, [PERMISSIONS.TABLE_SELECT], async () => {
      expect(await userHasPermission(OWNER, PERMISSIONS.TABLE_SELECT)).toBe(true);
      expect(await userHasPermission(OWNER, PERMISSIONS.USERS_VIEW)).toBe(false);
      expect(await userHasAnyPermission(OWNER, [PERMISSIONS.USERS_VIEW, PERMISSIONS.ROLES_VIEW])).toBe(false);
      expect(await userHasAllPermissions(OWNER, [PERMISSIONS.TABLE_SELECT, PERMISSIONS.USERS_VIEW])).toBe(false);
      // The owner's full list is still what a new token's scope is validated against.
      expect((await getUserPermissions(OWNER)).includes(PERMISSIONS.USERS_VIEW)).toBe(true);
    });
  });

  it("a scope that names a permission the owner has lost carries nothing", async () => {
    const role = await rawAll(sql`SELECT id FROM rbac_roles WHERE name = 'viewer'`);
    await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES ('scope-viewer', 'v@t.local', 'scope-viewer', 'x', 1, unixepoch(), unixepoch())`);
    await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES ('ur-viewer', 'scope-viewer', ${String(role[0].id)}, unixepoch())`);
    const viewerPermissions = await getUserPermissions("scope-viewer");
    expect(viewerPermissions).not.toContain(PERMISSIONS.USERS_VIEW);
    const token = (await createPat("scope-viewer", { name: "full" })).rawToken;
    expect((await call("/one", token)).status).toBe(403);
  });
});

describe("a scoped token of an administrator in the SQL access check", () => {
  // Printouts as ClickHouse gives them for the two statements.
  const SELECT = ["SelectWithUnionQuery (children 1)", " ExpressionList (children 1)", "  SelectQuery (children 2)", "   ExpressionList (children 1)", "    Asterisk", "   TablesInSelectQuery (children 1)", "    TablesInSelectQueryElement (children 1)", "     TableExpression (children 1)", "      TableIdentifier shop.orders"];
  const DROP = ["DropQuery shop orders (children 2)", " Identifier shop", " Identifier orders"];
  const parser = (lines: string[]) => ({ explainAst: async () => ({ ok: true as const, lines }), defaultDatabase: async () => "default" });
  const check = (statement: string, lines: string[], permissions: string[]) =>
    validateQueryAccess({ userId: OWNER, isAdmin: true, permissions, sql: statement, connectionId: undefined, parser: parser(lines) });
  const asToken = <T>(permissions: string[], narrowed: boolean, fn: () => Promise<T>): Promise<T> => runWithTokenScope(OWNER, permissions, fn, { narrowed, adminOwner: true });

  it("needs the permission for the statement's kind, like anyone else", async () => {
    const scope = [PERMISSIONS.TABLE_SELECT];
    await asToken(scope, true, async () => {
      expect(await check("SELECT * FROM shop.orders", SELECT, scope)).toMatchObject({ allowed: true, statementType: "select" });
      expect(await check("DROP TABLE shop.orders", DROP, scope)).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
    });
  });

  it("is still not restricted by data access rules, which never applied to its owner", async () => {
    // The owner has no data access policy at all; a non-admin would be refused the table.
    await asToken([PERMISSIONS.TABLE_SELECT], true, async () => {
      expect((await check("SELECT * FROM shop.orders", SELECT, [PERMISSIONS.TABLE_SELECT])).allowed).toBe(true);
      expect(await checkTableAccess(OWNER, false, "shop", "orders")).toBe(true);
      expect(await filterTables(OWNER, false, "shop", ["orders", "customers"])).toEqual(["orders", "customers"]);
      expect(await filterDatabases(OWNER, false, ["shop", "system"])).toEqual(["shop", "system"]);
    });
  });

  it("a read it may run cannot write: the statement is marked for a read-only send", async () => {
    await asToken([PERMISSIONS.TABLE_SELECT], true, async () => {
      expect((await check("SELECT * FROM shop.orders", SELECT, [PERMISSIONS.TABLE_SELECT])).statement?.mayWrite).toBe(false);
    });
  });

  it("an administrator's token without a scope, a session, and a job running for its owner keep the administrator's path", async () => {
    await asToken([PERMISSIONS.TABLE_SELECT], false, async () => {
      expect((await check("DROP TABLE shop.orders", DROP, [])).allowed).toBe(true);
    });
    expect((await check("DROP TABLE shop.orders", DROP, [])).allowed).toBe(true);
  });

  it("a scoped token of someone who is not an administrator gets no exemption from the rules", async () => {
    await runWithTokenScope("scope-viewer", [PERMISSIONS.TABLE_SELECT], async () => {
      expect(await checkTableAccess("scope-viewer", false, "shop", "orders")).toBe(false);
    }, { narrowed: true, adminOwner: false });
  });
});

afterAll(async () => {
  await closeDatabase();
});
