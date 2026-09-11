import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import {
  createPat,
  hashPatToken,
  listPats,
  revokePat,
  rotatePat,
  touchPatLastUsed,
  verifyPatToken,
  PAT_PREFIX,
} from "./personalAccessTokens";
import { getUserPermissions } from "./rbac";
import { PERMISSIONS } from "../schema/base";
import { AppError } from "../../types";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, getDatabase, getSchema, initializeDatabase } = await import("../db");
const { runMigrations } = await import("../db/migrations");

const READ = PERMISSIONS.TABLE_SELECT;
const WRITE = PERMISSIONS.TABLE_INSERT;

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
});

afterAll(async () => {
  await closeDatabase();
});

interface TestIdentity {
  userId: string;
  roleId: string;
}

async function seedIdentity(permissions: string[]): Promise<TestIdentity> {
  const db = getDatabase() as any;
  const schema = getSchema();
  const userId = randomUUID();
  const roleId = randomUUID();

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@test.local`,
    username: `pat-user-${userId.slice(0, 8)}`,
    passwordHash: "not-used-by-pat-test",
  });
  await db.insert(schema.roles).values({
    id: roleId,
    name: `pat-role-${roleId.slice(0, 8)}`,
    displayName: "PAT Test Role",
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
  await db.insert(schema.userRoles).values({
    id: randomUUID(),
    userId,
    roleId,
  });
  return { userId, roleId };
}

async function setActive(userId: string, active: boolean): Promise<void> {
  const db = getDatabase() as any;
  const schema = getSchema();
  await db.update(schema.users).set({ isActive: active }).where(eq(schema.users.id, userId));
}

async function stripRole(userId: string, roleId: string): Promise<void> {
  const db = getDatabase() as any;
  const schema = getSchema();
  const { and } = await import("drizzle-orm");
  await db
    .delete(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.roleId, roleId)));
}

function sha256(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

describe("personal access tokens", () => {
  it("creates a token with the ch_pat_ prefix and stores only its hash", async () => {
    const { userId } = await seedIdentity([READ]);
    const created = await createPat(userId, { name: "ci-token" });

    expect(created.rawToken.startsWith(PAT_PREFIX)).toBe(true);
    expect(created.name).toBe("ci-token");
    expect(created.keyPrefix).toBe(created.rawToken.slice(PAT_PREFIX.length, PAT_PREFIX.length + 8));
    expect(created.expiresAt).toBeNull();

    const db = getDatabase() as any;
    const schema = getSchema();
    const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.keyHash, sha256(created.rawToken)));
    expect(rows.length).toBe(1);
    expect(rows[0].keyHash).not.toContain(created.rawToken);
  });

  it("lists metadata without hashes or secrets", async () => {
    const { userId } = await seedIdentity([READ]);
    const created = await createPat(userId, { name: "list-me" });

    const tokens = await listPats(userId);
    expect(tokens.length).toBe(1);
    expect(tokens[0]).toMatchObject({ id: created.id, name: "list-me" });
    expect(tokens[0]).not.toHaveProperty("rawToken");
    expect(tokens[0]).not.toHaveProperty("keyHash");
  });

  it("verifies a token against live owner permissions", async () => {
    const { userId } = await seedIdentity([READ, WRITE]);
    const created = await createPat(userId, { name: "full" });

    const verified = await verifyPatToken(created.rawToken);
    expect(verified.userId).toBe(userId);
    expect(verified.patId).toBe(created.id);
    expect(verified.permissions).toContain(READ);
    expect(verified.permissions).toContain(WRITE);
  });

  it("intersects scopes with live permissions", async () => {
    const { userId } = await seedIdentity([READ, WRITE]);
    const created = await createPat(userId, { name: "read-only", scopes: [READ] });

    const verified = await verifyPatToken(created.rawToken);
    expect(verified.permissions).toEqual([READ]);
  });

  it("rejects scopes outside the owner's permissions", async () => {
    const { userId } = await seedIdentity([READ]);
    await expect(createPat(userId, { name: "escalate", scopes: [WRITE] })).rejects.toThrow(AppError);
  });

  it("rejects unknown scope names", async () => {
    const { userId } = await seedIdentity([READ]);
    await expect(createPat(userId, { name: "bogus", scopes: ["nope:missing"] })).rejects.toThrow(AppError);
  });

  it("rejects bad names and past expiries", async () => {
    const { userId } = await seedIdentity([READ]);
    await expect(createPat(userId, { name: "  " })).rejects.toThrow(AppError);
    await expect(createPat(userId, { name: "x".repeat(65) })).rejects.toThrow(AppError);
    await expect(
      createPat(userId, { name: "old", expiresAt: new Date(Date.now() - 1000) })
    ).rejects.toThrow(AppError);
    await expect(createPat(userId, { name: "bad-date", expiresAt: "not-a-date" })).rejects.toThrow(
      AppError
    );
  });

  it("accepts a future expiry and then rejects the token after it passes", async () => {
    const { userId } = await seedIdentity([READ]);
    const created = await createPat(userId, {
      name: "short",
      expiresAt: new Date(Date.now() + 50),
    });
    expect(created.expiresAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(verifyPatToken(created.rawToken)).rejects.toThrow(AppError);
  });

  it("revokes tokens idempotently and rejects them afterwards", async () => {
    const { userId } = await seedIdentity([READ]);
    const created = await createPat(userId, { name: "doomed" });

    const first = await revokePat(userId, created.id);
    expect(first?.revokedAt).not.toBeNull();
    const second = await revokePat(userId, created.id);
    expect(second?.revokedAt).not.toBeNull();

    await expect(verifyPatToken(created.rawToken)).rejects.toThrow(AppError);
  });

  it("does not let users revoke each other's tokens", async () => {
    const { userId: owner } = await seedIdentity([READ]);
    const { userId: stranger } = await seedIdentity([READ]);
    const created = await createPat(owner, { name: "mine" });

    expect(await revokePat(stranger, created.id)).toBeNull();
    // Owner's token still verifies.
    await expect(verifyPatToken(created.rawToken)).resolves.toMatchObject({ userId: owner });
  });

  it("rejects non-PAT strings and unknown secrets with one message", async () => {
    await expect(verifyPatToken("eyJhbGciOiJIUzI1NiJ9.payload.sig")).rejects.toThrow(
      "Invalid personal access token"
    );
    await expect(verifyPatToken(`${PAT_PREFIX}does-not-exist`)).rejects.toThrow(
      "Invalid personal access token"
    );
  });

  it("shrinks effective permissions when the owner is demoted (live derivation)", async () => {
    const { userId, roleId } = await seedIdentity([READ, WRITE]);
    const created = await createPat(userId, { name: "live" });
    expect((await verifyPatToken(created.rawToken)).permissions).toHaveLength(2);

    await stripRole(userId, roleId);
    expect(await getUserPermissions(userId)).toEqual([]);
    await expect(verifyPatToken(created.rawToken)).resolves.toMatchObject({ permissions: [] });
  });

  it("rejects tokens of deactivated users", async () => {
    const { userId } = await seedIdentity([READ]);
    const created = await createPat(userId, { name: "frozen" });

    await setActive(userId, false);
    await expect(verifyPatToken(created.rawToken)).rejects.toThrow(
      "Invalid personal access token"
    );
    await setActive(userId, true);
  });

  it("records last use without ever failing", async () => {
    const { userId } = await seedIdentity([READ]);
    const created = await createPat(userId, { name: "tracked" });

    await touchPatLastUsed(created.id);
    const tokens = await listPats(userId);
    expect(tokens[0].lastUsedAt).not.toBeNull();

    await expect(touchPatLastUsed("missing-id")).resolves.toBeUndefined();
  });

  it("hashes deterministically with SHA-256", () => {
    expect(hashPatToken("abc")).toBe(sha256("abc"));
  });

  it("hides revoked tokens from the list", async () => {
    const { userId } = await seedIdentity([READ]);
    const kept = await createPat(userId, { name: "kept" });
    const gone = await createPat(userId, { name: "gone" });

    await revokePat(userId, gone.id);

    const tokens = await listPats(userId);
    expect(tokens.map((t) => t.id)).toEqual([kept.id]);
  });

  it("rotates a token with identical settings and kills the old secret", async () => {
    const { userId } = await seedIdentity([READ, WRITE]);
    const original = await createPat(userId, {
      name: "rotating",
      scopes: [READ],
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const rotated = await rotatePat(userId, original.id);
    expect(rotated).not.toBeNull();
    expect(rotated?.id).not.toBe(original.id);
    expect(rotated?.name).toBe("rotating");
    expect(rotated?.scopes).toEqual([READ]);
    expect(rotated?.expiresAt?.getTime()).toBe(original.expiresAt?.getTime());
    expect(rotated?.rawToken.startsWith(PAT_PREFIX)).toBe(true);

    // Old secret is dead, replacement verifies with the same effective perms.
    await expect(verifyPatToken(original.rawToken)).rejects.toThrow(AppError);
    const verified = await verifyPatToken(rotated?.rawToken as string);
    expect(verified.patId).toBe(rotated?.id);
    expect(verified.permissions).toEqual([READ]);

    // The revoked predecessor is hidden from the list.
    const tokens = await listPats(userId);
    expect(tokens.map((t) => t.id)).toContain(rotated?.id);
    expect(tokens.map((t) => t.id)).not.toContain(original.id);
  });

  it("refuses to rotate foreign or already-revoked tokens", async () => {
    const { userId: owner } = await seedIdentity([READ]);
    const { userId: stranger } = await seedIdentity([READ]);
    const created = await createPat(owner, { name: "theirs" });

    expect(await rotatePat(stranger, created.id)).toBeNull();

    await revokePat(owner, created.id);
    await expect(rotatePat(owner, created.id)).rejects.toThrow(AppError);
  });
});
