import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase } from "../../rbac/db/migrationTestHarness";
import * as store from "./store";

function jobInput(name: string, connectionId: string): store.JobInput {
  return {
    name,
    description: null,
    connectionId,
    query: "SELECT 1",
    enabled: true,
    frequency: "daily",
    hour: 8,
    dayOfWeek: 1,
    dayOfMonth: 1,
    cronExpr: null,
    timezone: "UTC",
    outputMode: "none",
    destDatabase: null,
    destTable: null,
    outputConfig: null,
    maxRows: 100,
    timeoutSecs: 60,
    useFinal: false,
    seqConsistency: false,
    maxAttempts: 2,
    retentionDays: 30,
  };
}

beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
});

afterEach(async () => {
  await closeDatabase();
});

describe("scheduled queries overview connection scope", () => {
  it("reads Data Health schedules as UTC even when legacy metadata stored another timezone", async () => {
    const input = jobInput("health", "connection-1");
    input.timezone = "Asia/Jakarta";
    const id = await store.createJob(input, "owner-1", "data_health_check");

    expect((await store.getJob(id))?.timezone).toBe("UTC");
  });

  it("lists distinct successful slots in a range, ascending and bounded", async () => {
    const id = await store.createJob(jobInput("producer", "connection-1"), "owner-1");
    const seed = async (runId: string, slotAt: number, status: "success" | "error"): Promise<void> => {
      await store.insertRun({ id: runId, queryId: id, trigger: "scheduled", slotAt, attempt: 1, runnerId: "test", deadline: slotAt + 1_000, startedAt: slotAt });
      await store.finalizeRun(runId, { status, rowCount: null, truncated: false, writtenRows: null, resultJson: null, conditionValue: null, conditionMet: null, durationMs: 1, message: null, notified: false, finishedAt: slotAt + 1 });
    };
    await seed("r1", 1_000, "success");
    await seed("r2", 2_000, "error");
    await seed("r3", 3_000, "success");
    await seed("r3-retry", 3_000, "success"); // duplicate slot collapses
    await seed("r4", 9_000, "success"); // outside the range

    expect(await store.listSuccessfulSlotsBetween(id, 0, 5_000)).toEqual([1_000, 3_000]);
    expect(await store.listSuccessfulSlotsBetween(id, 3_000, 9_000)).toEqual([3_000, 9_000]);
    expect(await store.listSuccessfulSlotsBetween(id, 0, 9_000, 2)).toEqual([1_000, 3_000]);
    expect(await store.listSuccessfulSlotsBetween("missing", 0, 9_000)).toEqual([]);
  });

  it("counts only the requested connection's jobs when a scope is given", async () => {
    await store.createJob(jobInput("job-a", "connection-1"), "owner-1");
    await store.createJob(jobInput("job-b", "connection-2"), "owner-1");

    const unscoped = await store.getOverview(14, null);
    expect(unscoped.kpis.totalJobs).toBe(2);

    const scoped = await store.getOverview(14, null, "connection-1");
    expect(scoped.kpis.totalJobs).toBe(1);

    const empty = await store.getOverview(14, null, "connection-3");
    expect(empty.kpis.totalJobs).toBe(0);
  });
});
