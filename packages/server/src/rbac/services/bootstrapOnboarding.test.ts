import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import type { SqliteDb } from "../db";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, getDatabase, initializeDatabase } = await import("../db");
const { runMigrations } = await import("../db/migrations");
const schema = await import("../schema/sqlite");
const { eq, sql } = await import("drizzle-orm");
const { completeBootstrapOnboarding, updateUserPassword } = await import("./rbac");

const USER_ID = "bootstrap-metadata-user";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function setBootstrapMetadata(requiresPasswordChange: boolean): Promise<void> {
  const db = getDatabase() as SqliteDb;
  await db.update(schema.users)
    .set({
      metadata: {
        onboardingBootstrap: {
          status: "pending",
          requiresPasswordChange,
          createdAt: "2026-01-01T00:00:00.000Z",
          installationId: "install-1",
        },
        preferencesWrittenElsewhere: { revision: 3 },
        raceMarker: "pending",
      },
    })
    .where(eq(schema.users.id, USER_ID));
}

async function readMetadata(): Promise<Record<string, unknown>> {
  const db = getDatabase() as SqliteDb;
  const [row] = await db.select({ metadata: schema.users.metadata })
    .from(schema.users)
    .where(eq(schema.users.id, USER_ID))
    .limit(1);
  if (!row || !isRecord(row.metadata)) throw new Error("Expected user metadata");
  return row.metadata;
}

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });

  const db = getDatabase() as SqliteDb;
  await db.insert(schema.users).values({
    id: USER_ID,
    email: "bootstrap-metadata@test.local",
    username: "bootstrap-metadata",
    passwordHash: "original-hash",
    displayName: "Bootstrap Metadata",
    isActive: true,
    isSystemUser: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

beforeEach(async () => {
  const db = getDatabase() as SqliteDb;
  await db.run(sql`DROP TRIGGER IF EXISTS bootstrap_metadata_race`);
  await db.run(sql`PRAGMA recursive_triggers = OFF`);
  await setBootstrapMetadata(false);
});

afterAll(async () => {
  await closeDatabase();
});

describe("bootstrap onboarding metadata", () => {
  it("preserves unrelated metadata when password change clears the bootstrap requirement", async () => {
    await setBootstrapMetadata(true);

    await updateUserPassword(USER_ID, "NewPassword123!");

    const metadata = await readMetadata();
    expect(metadata.preferencesWrittenElsewhere).toEqual({ revision: 3 });
    expect(metadata.onboardingBootstrap).toMatchObject({
      status: "pending",
      requiresPasswordChange: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      installationId: "install-1",
    });
  });

  it("retries a conflicting metadata write and preserves the concurrent fields", async () => {
    const db = getDatabase() as SqliteDb;
    await db.run(sql.raw(`
      CREATE TRIGGER bootstrap_metadata_race
      BEFORE UPDATE OF metadata ON rbac_users
      FOR EACH ROW
      WHEN json_extract(OLD.metadata, '$.raceMarker') = 'pending'
      BEGIN
        UPDATE rbac_users
        SET metadata = json_set(
          OLD.metadata,
          '$.raceMarker', 'won',
          '$.concurrentWriter', json('{"saved":true}')
        )
        WHERE id = OLD.id;
        SELECT RAISE(IGNORE);
      END
    `));

    await completeBootstrapOnboarding(USER_ID);

    const metadata = await readMetadata();
    expect(metadata.raceMarker).toBe("won");
    expect(metadata.concurrentWriter).toEqual({ saved: true });
    expect(metadata.preferencesWrittenElsewhere).toEqual({ revision: 3 });
    expect(metadata.onboardingBootstrap).toMatchObject({
      status: "complete",
      requiresPasswordChange: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      installationId: "install-1",
    });

    const bootstrap = metadata.onboardingBootstrap;
    if (!isRecord(bootstrap)) throw new Error("Expected bootstrap metadata");
    expect(typeof bootstrap.completedAt).toBe("string");
  });

  it("does not revert a concurrent completion while changing the password", async () => {
    await setBootstrapMetadata(true);
    const db = getDatabase() as SqliteDb;
    await db.run(sql.raw(`
      CREATE TRIGGER bootstrap_metadata_race
      BEFORE UPDATE OF metadata ON rbac_users
      FOR EACH ROW
      WHEN json_extract(OLD.metadata, '$.onboardingBootstrap.status') = 'pending'
      BEGIN
        UPDATE rbac_users
        SET metadata = json_set(
          OLD.metadata,
          '$.onboardingBootstrap.status', 'complete',
          '$.onboardingBootstrap.requiresPasswordChange', json('false'),
          '$.onboardingBootstrap.completedAt', '2026-01-02T00:00:00.000Z'
        )
        WHERE id = OLD.id;
        SELECT RAISE(IGNORE);
      END
    `));

    await updateUserPassword(USER_ID, "AnotherPassword123!");

    const metadata = await readMetadata();
    expect(metadata.onboardingBootstrap).toMatchObject({
      status: "complete",
      requiresPasswordChange: false,
      completedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("does not complete setup while the seeded password is still required", async () => {
    await setBootstrapMetadata(true);

    await expect(completeBootstrapOnboarding(USER_ID)).rejects.toThrow(
      "Change the bootstrap administrator password",
    );

    const metadata = await readMetadata();
    expect(metadata.onboardingBootstrap).toMatchObject({
      status: "pending",
      requiresPasswordChange: true,
    });
  });
});
