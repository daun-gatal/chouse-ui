import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import { toTokenPayload, verifyBearer } from "./patAuth";
import { createPat, PAT_PREFIX } from "./personalAccessTokens";
import { generateAccessToken } from "./jwt";
import { PERMISSIONS } from "../schema/base";
import { rbacAuthMiddleware, requireJwtSession } from "../middleware/rbacAuth";
import { optionalRbacMiddleware } from "../../middleware/dataAccess";
import { AppError } from "../../types";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, getDatabase, getSchema, initializeDatabase } = await import("../db");
const { runMigrations } = await import("../db/migrations");

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
});

afterAll(async () => {
  await closeDatabase();
});

async function seedUserWithPermissions(permissions: string[]): Promise<string> {
  const db = getDatabase() as any;
  const schema = getSchema();
  const userId = randomUUID();
  const roleId = randomUUID();

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@test.local`,
    username: `bearer-user-${userId.slice(0, 8)}`,
    passwordHash: "not-used-by-bearer-test",
  });
  await db.insert(schema.roles).values({
    id: roleId,
    name: `bearer-role-${roleId.slice(0, 8)}`,
    displayName: "Bearer Test Role",
  });
  for (const name of permissions) {
    const existing = await db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.name, name))
      .limit(1);
    const permId = existing.length > 0 ? existing[0].id : randomUUID();
    if (existing.length === 0) {
      await db.insert(schema.permissions).values({
        id: permId,
        name,
        displayName: name,
        category: "test",
      });
    }
    await db.insert(schema.rolePermissions).values({
      id: randomUUID(),
      roleId,
      permissionId: permId,
    });
  }
  await db.insert(schema.userRoles).values({ id: randomUUID(), userId, roleId });
  return userId;
}

function mockHonoContext(authHeader: string | undefined): {
  context: any;
  sets: Map<string, unknown>;
} {
  const sets = new Map<string, unknown>();
  const context = {
    req: { header: (_name: string) => authHeader },
    set: (key: string, value: unknown) => {
      sets.set(key, value);
    },
    get: (key: string) => sets.get(key),
  };
  return { context, sets };
}

describe("verifyBearer", () => {
  it("verifies JWTs exactly as before (jwt auth method)", async () => {
    const accessToken = await generateAccessToken({
      sub: "user-1",
      email: "user-1@test.local",
      username: "user-1",
      roles: ["viewer"],
      permissions: [PERMISSIONS.TABLE_SELECT],
      sessionId: "session-1",
    });

    const identity = await verifyBearer(accessToken);
    expect(identity.authMethod).toBe("jwt");
    expect(identity.userId).toBe("user-1");
    expect(identity.sessionId).toBe("session-1");
    expect(identity.patId).toBeUndefined();
  });

  it("verifies PATs against live permissions (pat auth method)", async () => {
    const userId = await seedUserWithPermissions([PERMISSIONS.TABLE_SELECT]);
    const created = await createPat(userId, { name: "bearer-pat" });

    const identity = await verifyBearer(created.rawToken);
    expect(identity.authMethod).toBe("pat");
    expect(identity.userId).toBe(userId);
    expect(identity.sessionId).toBe(`pat:${created.id}`);
    expect(identity.patId).toBe(created.id);
    expect(identity.permissions).toContain(PERMISSIONS.TABLE_SELECT);
  });

  it("rejects unknown PAT secrets", async () => {
    await expect(verifyBearer(`${PAT_PREFIX}unknown-secret`)).rejects.toThrow(AppError);
  });

  it("builds a JWT-shaped context payload preserving identity", async () => {
    const userId = await seedUserWithPermissions([PERMISSIONS.TABLE_SELECT]);
    const created = await createPat(userId, { name: "payload-pat" });
    const identity = await verifyBearer(created.rawToken);

    const payload = toTokenPayload(identity);
    expect(payload).toMatchObject({
      sub: userId,
      sessionId: `pat:${created.id}`,
      type: "access",
    });
    expect(payload.permissions).toContain(PERMISSIONS.TABLE_SELECT);
  });
});

describe("middleware PAT wiring", () => {
  it("rbacAuthMiddleware authenticates PATs and marks the session", async () => {
    const userId = await seedUserWithPermissions([PERMISSIONS.TABLE_SELECT]);
    const created = await createPat(userId, { name: "mw-pat" });
    const { context, sets } = mockHonoContext(`Bearer ${created.rawToken}`);
    const next = mock(async () => {});

    await rbacAuthMiddleware(context, next);

    expect(next).toHaveBeenCalled();
    expect(sets.get("rbacUserId")).toBe(userId);
    expect(sets.get("authMethod")).toBe("pat");
    expect(sets.get("patId")).toBe(created.id);
  });

  it("optionalRbacMiddleware populates RBAC context from PATs", async () => {
    const userId = await seedUserWithPermissions([PERMISSIONS.TABLE_SELECT]);
    const created = await createPat(userId, { name: "optional-pat" });
    const { context, sets } = mockHonoContext(`Bearer ${created.rawToken}`);
    const next = mock(async () => {});

    await optionalRbacMiddleware(context, next);

    expect(next).toHaveBeenCalled();
    expect(sets.get("rbacUserId")).toBe(userId);
    expect(sets.get("rbacPermissions")).toContain(PERMISSIONS.TABLE_SELECT);
  });

  it("requireJwtSession fences PATs but passes JWT sessions", () => {
    const patContext = { get: (_key: string) => "pat" };
    expect(() => requireJwtSession(patContext as any)).toThrow(AppError);

    const jwtContext = { get: (_key: string) => "jwt" };
    expect(() => requireJwtSession(jwtContext as any)).not.toThrow();

    const legacyContext = { get: (_key: string) => undefined };
    expect(() => requireJwtSession(legacyContext as any)).not.toThrow();
  });
});
