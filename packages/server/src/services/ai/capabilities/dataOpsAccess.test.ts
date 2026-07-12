import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { closeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import { freshDatabase } from "../../../rbac/db/migrationTestHarness";
import { PERMISSIONS } from "../../../rbac/schema/base";
import * as healthStore from "../../dataHealth/store";
import * as scheduledStore from "../../scheduledQueries/store";
import { summarizeDataHealthCapability, summarizeScheduledQueryCapability } from "./dataOps";

const jobInput: scheduledStore.JobInput = {
  name: "Owner-only job",
  description: null,
  connectionId: "connection-1",
  query: "SELECT count() FROM analytics.orders",
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

beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
});

afterEach(async () => {
  await closeDatabase();
});

describe("DataOps AI object authorization", () => {
  it("does not expose another owner's Scheduled Query as AI evidence", async () => {
    const jobId = await scheduledStore.createJob(jobInput, "owner-1");
    const permissions = [PERMISSIONS.AI_OPTIMIZE, PERMISSIONS.SCHEDULED_QUERIES_VIEW];

    await expect(summarizeScheduledQueryCapability.prepare({ jobId }, {
      userId: "owner-2",
      permissions,
    })).rejects.toThrow("Scheduled query not found");

    const evidence = await summarizeScheduledQueryCapability.prepare({ jobId }, {
      userId: "owner-1",
      permissions,
    });
    expect(evidence.job.id).toBe(jobId);
  });

  it("does not expose another owner's Data Health promise as AI evidence", async () => {
    const scheduledQueryId = await scheduledStore.createJob(jobInput, "owner-1", "data_health_check");
    const promiseId = await healthStore.createPromiseMetadata({
      scheduledQueryId,
      name: "Orders promise",
      description: null,
      connectionId: "connection-1",
      sourceType: "table",
      databaseName: "analytics",
      tableName: "orders",
      sourceQuery: null,
      eventTimeColumn: null,
      rowFilter: null,
      ownerId: "owner-1",
      criticality: "important",
      timezone: "UTC",
      runbookUrl: null,
      enabled: true,
      graceSecs: 0,
      breachAfter: 1,
      recoverAfter: 1,
      retentionDays: 30,
      schemaSnapshot: null,
      createdBy: "owner-1",
    });
    const permissions = [PERMISSIONS.AI_OPTIMIZE, PERMISSIONS.DATA_HEALTH_VIEW];

    await expect(summarizeDataHealthCapability.prepare({ promiseId }, {
      userId: "owner-2",
      permissions,
    })).rejects.toThrow("Data Health promise not found");

    const evidence = await summarizeDataHealthCapability.prepare({ promiseId }, {
      userId: "owner-1",
      permissions,
    });
    expect(evidence.promise.id).toBe(promiseId);
  });
});
