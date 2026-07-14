import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "crypto";

import * as service from "./userPreferences";

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

async function createTestUser(): Promise<string> {
  const id = randomUUID();
  const db = getDatabase();
  const schema = getSchema();
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.local`,
    username: `user-${id}`,
    passwordHash: "not-used-by-service-test",
  });
  return id;
}

describe("user preference onboarding helpers", () => {
  it("normalizes corrupt or obsolete onboarding data safely", () => {
    expect(service.normalizeOnboardingProgress(null)).toEqual({
      formatRevision: 1,
      welcomeSeen: false,
      completedChapterIds: [],
      dismissedChapterIds: [],
      lastStepIndex: 0,
    });

    expect(service.normalizeOnboardingProgress({
      formatRevision: 99,
      welcomeSeen: true,
      completedChapterIds: ["shell", 4, "explorer"],
      dismissedChapterIds: "invalid",
      lastStepIndex: -8,
      lastChapterId: "monitoring",
      lastStepId: "monitoring.metrics.cpu",
    })).toEqual({
      formatRevision: 1,
      welcomeSeen: true,
      completedChapterIds: ["shell", "explorer"],
      dismissedChapterIds: [],
      lastStepIndex: 0,
      lastChapterId: "monitoring",
      lastStepId: "monitoring.metrics.cpu",
    });
  });

  it("applies the API bounds and completed-wins rule to stored data", () => {
    const identifierAtLimit = "x".repeat(100);
    expect(service.normalizeOnboardingProgress({
      completedChapterIds: ["fleet", "fleet", "", "x".repeat(101), identifierAtLimit],
      dismissedChapterIds: ["fleet", "monitoring", "", "x".repeat(101)],
      lastChapterId: "x".repeat(101),
      lastStepId: identifierAtLimit,
      lastStepIndex: 1001,
      completedAt: "not-a-timestamp",
    })).toEqual({
      formatRevision: 1,
      welcomeSeen: false,
      completedChapterIds: ["fleet", identifierAtLimit],
      dismissedChapterIds: ["monitoring"],
      lastStepId: identifierAtLimit,
      lastStepIndex: 0,
    });

    expect(service.normalizeOnboardingProgress({
      lastStepIndex: 1000,
      completedAt: "2026-07-15T04:05:06.000Z",
    })).toMatchObject({
      lastStepIndex: 1000,
      completedAt: "2026-07-15T04:05:06.000Z",
    });
  });

  it("bounds stored chapter lists", () => {
    const values = Array.from({ length: 160 }, (_, index) => `chapter-${index}`);
    expect(service.normalizeOnboardingProgress({
      completedChapterIds: values,
    }).completedChapterIds).toHaveLength(128);
  });

  it("merges stale chapter arrays monotonically", () => {
    expect(service.mergeOnboardingProgress({
      completedChapterIds: ["fleet"],
      dismissedChapterIds: ["admin", "doctor"],
    }, {
      completedChapterIds: ["monitoring", "doctor"],
      dismissedChapterIds: ["fleet", "explorer"],
    })).toMatchObject({
      completedChapterIds: ["fleet", "monitoring", "doctor"],
      dismissedChapterIds: ["admin", "explorer"],
    });
  });
});

describe("user preference onboarding persistence", () => {
  it("preserves omitted onboarding fields and unrelated workspace keys", async () => {
    const userId = await createTestUser();
    await service.updateUserPreferences(userId, {
      workspacePreferences: {
        dock: { mode: "sidebar" },
        logsPage: { pageSize: 100 },
      },
    });
    await service.updateUserOnboardingProgress(userId, {
      welcomeSeen: true,
      completedChapterIds: ["shell"],
    });

    const saved = await service.updateUserOnboardingProgress(userId, {
      lastChapterId: "monitoring",
      lastStepId: "monitoring.metrics.cpu",
      lastStepIndex: 4,
    });
    await service.updateUserPreferences(userId, {
      workspacePreferences: {
        dock: { mode: "floating" },
        onboarding: {
          welcomeSeen: false,
          completedChapterIds: [],
        },
      },
    });
    const afterGenericWrite = await service.getUserOnboardingProgress(userId);
    const preferences = await service.getUserPreferences(userId);

    expect(saved).toMatchObject({
      welcomeSeen: true,
      completedChapterIds: ["shell"],
      lastChapterId: "monitoring",
      lastStepId: "monitoring.metrics.cpu",
      lastStepIndex: 4,
    });
    expect(afterGenericWrite).toEqual(saved);
    expect(preferences.workspacePreferences).toMatchObject({
      dock: { mode: "floating" },
      logsPage: { pageSize: 100 },
    });
  });

  it("serializes concurrent first writes when no preference row exists", async () => {
    const userId = await createTestUser();
    await Promise.all([
      service.updateUserOnboardingProgress(userId, { welcomeSeen: true }),
      service.updateUserOnboardingProgress(userId, {
        completedChapterIds: ["fleet"],
      }),
      service.updateUserOnboardingProgress(userId, {
        dismissedChapterIds: ["admin"],
      }),
    ]);

    expect(await service.getUserOnboardingProgress(userId)).toMatchObject({
      welcomeSeen: true,
      completedChapterIds: ["fleet"],
      dismissedChapterIds: ["admin"],
    });
  });

  it("retries real SQLite CAS conflicts without losing cross-tab progress", async () => {
    const userId = await createTestUser();
    await service.updateUserPreferences(userId, {
      workspacePreferences: { dock: { mode: "floating" } },
    });

    const [results] = await Promise.all([
      Promise.all([
        service.updateUserOnboardingProgress(userId, {
          completedChapterIds: ["fleet"],
          dismissedChapterIds: [],
        }),
        service.updateUserOnboardingProgress(userId, {
          completedChapterIds: ["monitoring"],
          dismissedChapterIds: ["admin"],
        }),
        service.updateUserOnboardingProgress(userId, {
          lastChapterId: "explorer",
          lastStepId: "explorer.tables",
          lastStepIndex: 3,
        }),
      ]),
      service.updateUserPreferences(userId, {
        workspacePreferences: {
          logsPage: { pageSize: 50 },
          onboarding: { completedChapterIds: [] },
        },
      }),
    ]);

    const saved = await service.getUserOnboardingProgress(userId);
    const preferences = await service.getUserPreferences(userId);
    expect(saved.completedChapterIds).toEqual(["fleet", "monitoring"]);
    expect(saved.dismissedChapterIds).toEqual(["admin"]);
    expect(saved).toMatchObject({
      lastChapterId: "explorer",
      lastStepId: "explorer.tables",
      lastStepIndex: 3,
    });
    expect(results.some((progress) => (
      progress.completedChapterIds.includes("fleet")
      && progress.completedChapterIds.includes("monitoring")
    ))).toBe(true);
    expect(preferences.workspacePreferences).toMatchObject({
      dock: { mode: "floating" },
      logsPage: { pageSize: 50 },
    });
  });

  it("lets completion remove a dismissal while retaining other tabs' outcomes", async () => {
    const userId = await createTestUser();
    await service.updateUserOnboardingProgress(userId, {
      dismissedChapterIds: ["fleet", "admin"],
    });

    const saved = await service.updateUserOnboardingProgress(userId, {
      completedChapterIds: ["fleet"],
      dismissedChapterIds: ["admin"],
    });

    expect(saved.completedChapterIds).toEqual(["fleet"]);
    expect(saved.dismissedChapterIds).toEqual(["admin"]);
  });
});
