import { afterAll, beforeAll, describe, expect, it } from "bun:test";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, initializeDatabase } = await import("../../rbac/db");
const { runMigrations } = await import("../../rbac/db/migrations");
const { run, sql } = await import("../observe/db");
const { CheckInputError, getAssessment, latestChecks, listAssessments, startAssessment } = await import("./assess");

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
});

afterAll(async () => {
  delete process.env.UPGRADE_CHECK_ENABLED;
  await closeDatabase();
});

async function seed(id: string, connectionId: string, status: string, createdAt: number, summary: Record<string, unknown> = {}): Promise<void> {
  await run(sql`INSERT INTO upgrade_assessments (id, connection_id, current_version, target_version, status, summary, created_at, finished_at)
    VALUES (${id}, ${connectionId}, '25.8.33.6', '26.8.36.3', ${status}, ${JSON.stringify({ stage: "done", mode: "exact", target: { version: "26.8.36.3", line: "26.8" }, reference: null, ...summary })}, ${createdAt}, ${status === "running" ? null : createdAt + 1})`);
}

describe("starting a check", () => {
  it("rejects a version it can't read", async () => {
    await expect(startAssessment({ connectionId: "c1", targetVersion: "latest", reference: null, actorId: null })).rejects.toBeInstanceOf(CheckInputError);
  });

  it("needs release notes on, or a connection to compare with", async () => {
    delete process.env.UPGRADE_CHECK_ENABLED;
    await expect(startAssessment({ connectionId: "c1", targetVersion: "26.8", reference: null, actorId: null })).rejects.toThrow("UPGRADE_CHECK_ENABLED");
  });

  it("returns the running check instead of starting a second one", async () => {
    await seed("running-1", "c-busy", "running", Date.now());
    process.env.UPGRADE_CHECK_ENABLED = "true";
    expect(await startAssessment({ connectionId: "c-busy", targetVersion: "26.8", reference: null, actorId: null })).toBe("running-1");
  });
});

describe("reading checks", () => {
  it("reports a check cut off by a restart as failed", async () => {
    await seed("stale-1", "c-stale", "running", Date.now() - 16 * 60 * 1000);
    const a = (await getAssessment("stale-1"))!;
    expect(a.status).toBe("failed");
    expect(a.summary.error).toContain("interrupted");
  });

  it("lists newest first without findings, and gives each connection its last finished check", async () => {
    await seed("old", "c-list", "done", 1_000, { counts: { blocker: 1, warning: 0, info: 0, note: 0 } });
    await seed("new", "c-list", "done", 2_000, { counts: { blocker: 0, warning: 2, info: 0, note: 3 }, mode: "notes" });
    await seed("failed", "c-list", "failed", 3_000);
    expect((await listAssessments("c-list")).map((a) => a.id)).toEqual(["failed", "new", "old"]);
    const latest = await latestChecks(["c-list", "c-none"]);
    expect(latest["c-list"]).toMatchObject({ id: "new", mode: "notes", counts: { blocker: 0, warning: 2, info: 0, note: 3 } });
    expect(latest["c-none"]).toBeUndefined();
  });

  it("returns null for an unknown check", async () => {
    expect(await getAssessment("missing")).toBeNull();
  });
});
