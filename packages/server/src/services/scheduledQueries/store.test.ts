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
