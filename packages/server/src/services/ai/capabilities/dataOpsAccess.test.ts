import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { closeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import { freshDatabase } from "../../../rbac/db/migrationTestHarness";
import { PERMISSIONS } from "../../../rbac/schema/base";
import * as healthStore from "../../dataHealth/store";
import * as scheduledStore from "../../scheduledQueries/store";
import {
  assessScheduledQueryCapability,
  draftScheduledQueryCapability,
  recommendHealthPromiseCapability,
  summarizeDataHealthCapability,
  summarizeScheduledQueryCapability,
} from "./dataOps";

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

describe("DataOps AI connection guards", () => {
  // These capabilities run schema/query tools on the SESSION's connection, so
  // they must refuse to reason over a resource pinned to a different one.
  const assessInput = {
    name: "job",
    connectionId: "connection-1",
    query: "SELECT 1",
    frequency: "daily" as const,
    timezone: "UTC",
    outputMode: "none" as const,
    timeoutSecs: 60,
    maxAttempts: 2,
  };

  it("rejects an AI preflight when the session is on a different connection", async () => {
    const ctx = { userId: "owner-1", permissions: [PERMISSIONS.SCHEDULED_QUERIES_EDIT], connectionId: "connection-2" };
    expect(() => assessScheduledQueryCapability.prepare(assessInput, ctx)).toThrow("Select the job's connection");
    const prepared = assessScheduledQueryCapability.prepare(assessInput, { ...ctx, connectionId: "connection-1" });
    expect(prepared.connectionId).toBe("connection-1");
  });

  it("rejects an AI draft when the session is on a different connection", () => {
    const input = { intent: "count yesterday's orders", connectionId: "connection-1", timezone: "UTC" };
    const ctx = { userId: "owner-1", permissions: [PERMISSIONS.SCHEDULED_QUERIES_EDIT], connectionId: "connection-2" };
    expect(() => draftScheduledQueryCapability.prepare(input, ctx)).toThrow("Select the target connection");
    expect(draftScheduledQueryCapability.prepare(input, { ...ctx, connectionId: "connection-1" }).connectionId).toBe("connection-1");
  });

  it("rejects a health recommendation when the session is on a different connection", () => {
    const input = { connectionId: "connection-1", database: "analytics", table: "orders", criticality: "standard" as const, existingChecks: [] };
    const ctx = { userId: "owner-1", permissions: [PERMISSIONS.DATA_HEALTH_EDIT], connectionId: "connection-2" };
    expect(() => recommendHealthPromiseCapability.prepare(input, ctx)).toThrow("Select the dataset connection");
    expect(recommendHealthPromiseCapability.prepare(input, { ...ctx, connectionId: "connection-1" }).connectionId).toBe("connection-1");
  });
});
