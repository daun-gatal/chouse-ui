import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../rbac/db/migrationTestHarness";
import * as scheduledStore from "../scheduledQueries/store";
import type { DataHealthCheckDefinition } from "./types";
import { currentDataHealthJob, processUpstreamFailure } from "./execution";
import * as store from "./store";

const jobInput: scheduledStore.JobInput = {
  name: "Orders health",
  description: null,
  connectionId: "connection-1",
  query: "SELECT count() AS rows FROM orders",
  enabled: true,
  frequency: "daily",
  hour: 8,
  dayOfWeek: 1,
  dayOfMonth: 1,
  cronExpr: null,
  timezone: "Asia/Jakarta",
  outputMode: "none",
  destDatabase: null,
  destTable: null,
  outputConfig: null,
  maxRows: 20,
  timeoutSecs: 60,
  useFinal: false,
  seqConsistency: false,
  maxAttempts: 2,
  retentionDays: 90,
};

const checks: DataHealthCheckDefinition[] = [
  { checkKey: "rows", name: "Rows", type: "row_count", severity: "critical", enabled: true, config: { min: 100 } },
];

function promiseInput(scheduledQueryId: string, upstreamJobId: string | null = null): store.CreatePromiseMetadataInput {
  return {
    scheduledQueryId,
    upstreamJobId,
    name: "Orders promise",
    description: null,
    connectionId: "connection-1",
    sourceType: "table",
    databaseName: "analytics",
    tableName: "orders",
    sourceQuery: null,
    eventTimeColumn: "created_at",
    eventTimeType: "DateTime",
    eventTimeEncoding: "native",
    eventTimeTimezone: null,
    eventTimeFormat: "best_effort",
    rowFilter: null,
    ownerId: null,
    criticality: "standard",
    timezone: "UTC",
    runbookUrl: null,
    enabled: true,
    graceSecs: 0,
    breachAfter: 1,
    recoverAfter: 2,
    retentionDays: 90,
    schemaSnapshot: null,
    createdBy: null,
  };
}

beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
});

afterEach(async () => {
  await closeDatabase();
});

describe("Data Health store", () => {
  it("persists a promise, validated checks, and scalar samples", async () => {
    const now = Date.now();
    await rawRun(sql`
      INSERT INTO rbac_users (id, email, username, password_hash, display_name, is_active, created_at, updated_at)
      VALUES ('owner-1', 'owner@example.com', 'owner', 'test', 'Owner Display Name', 1, ${now}, ${now})
    `);
    const jobId = await scheduledStore.createJob(jobInput, "owner-1", "data_health_check");
    const promiseId = await store.createPromiseMetadata({
      scheduledQueryId: jobId,
      upstreamJobId: null,
      name: "Orders promise",
      description: null,
      connectionId: "connection-1",
      sourceType: "table",
      databaseName: "analytics",
      tableName: "orders",
      sourceQuery: null,
      eventTimeColumn: "created_at",
      eventTimeType: "DateTime",
      eventTimeEncoding: "native",
      eventTimeTimezone: null,
      eventTimeFormat: "best_effort",
      rowFilter: null,
      ownerId: "owner-1",
      criticality: "critical",
      timezone: "Asia/Jakarta",
      runbookUrl: null,
      enabled: true,
      graceSecs: 300,
      breachAfter: 1,
      recoverAfter: 2,
      retentionDays: 90,
      schemaSnapshot: [{ name: "created_at", type: "DateTime" }],
      createdBy: "owner-1",
    });
    await store.replaceChecks(promiseId, checks);
    const currentJob = await scheduledStore.getJob(jobId);
    if (!currentJob) throw new Error("Scheduled job was not created");
    expect((await currentDataHealthJob(currentJob)).query).toContain("countIf(`created_at` >= {{slot_start}}");
    await store.insertEvaluations(promiseId, "run-1", 1_000, [{
      checkKey: "rows",
      type: "row_count",
      severity: "critical",
      outcome: "breach",
      observedValue: 50,
      expectedLower: 100,
      expectedUpper: null,
      message: "Too few rows",
    }]);
    await store.updatePromiseEvaluation(promiseId, "unhealthy", 1_100);

    const promise = await store.getPromise(promiseId);
    expect(promise?.status).toBe("unhealthy");
    expect(promise?.ownerDisplayName).toBe("Owner Display Name");
    expect(promise).toMatchObject({
      eventTimeType: "DateTime",
      eventTimeEncoding: "native",
      eventTimeTimezone: null,
      eventTimeFormat: "best_effort",
    });
    expect(await store.getChecks(promiseId)).toEqual(checks);
    expect((await store.listSamples(promiseId))[0].observedValue).toBe(50);
    expect((await store.latestSampleForCheck(promiseId, "rows"))?.slotAt).toBe(1_000);
    expect(await store.latestSampleForCheck(promiseId, "missing")).toBeNull();
    expect(await store.metricHistory(promiseId)).toEqual({ rows: [50] });
    await store.replaceChecks(promiseId, [{ ...checks[0], name: "Rows in delivery window" }]);
    expect((await store.listSamples(promiseId))[0].observedValue).toBe(50);
    expect((await store.getChecks(promiseId))[0].name).toBe("Rows in delivery window");

    await store.updatePromiseEvaluation(promiseId, "healthy", 1_200);
    expect((await store.getPromise(promiseId))?.lastHealthyAt).toBe(1_200);
    await store.updatePromiseEvaluation(promiseId, "unknown", 1_300);
    expect((await store.getPromise(promiseId))?.lastHealthyAt).toBe(1_200);
  });

  it("round-trips upstream_job_id and lists promises chained to an upstream job", async () => {
    const upstreamId = await scheduledStore.createJob({ ...jobInput, name: "Producer", outputMode: "append", destDatabase: "analytics", destTable: "orders" }, "owner-1");
    const backingA = await scheduledStore.createJob({ ...jobInput, frequency: "event" }, "owner-1", "data_health_check");
    const backingB = await scheduledStore.createJob(jobInput, "owner-1", "data_health_check");

    // Regression: `event` must survive the store's read-mapping guard — a "daily"
    // fallback would silently put the backing job on a cron cadence.
    expect((await scheduledStore.getJob(backingA))?.frequency).toBe("event");

    const chained = await store.createPromiseMetadata(promiseInput(backingA, upstreamId));
    await store.createPromiseMetadata(promiseInput(backingB));

    expect((await store.getPromise(chained))?.upstreamJobId).toBe(upstreamId);
    expect((await store.listPromisesByUpstreamJobId(upstreamId)).map((promise) => promise.id)).toEqual([chained]);
    expect(await store.listPromisesByUpstreamJobId("missing-job")).toEqual([]);

    // Detaching via update clears the link.
    await store.updatePromiseMetadata(chained, promiseInput(backingA, null));
    expect((await store.getPromise(chained))?.upstreamJobId).toBeNull();
    expect(await store.listPromisesByUpstreamJobId(upstreamId)).toEqual([]);
  });

  it("marks chained promises unknown and opens one execution incident when the upstream fails", async () => {
    const now = Date.now();
    const upstreamId = await scheduledStore.createJob({ ...jobInput, name: "Producer", outputMode: "append", destDatabase: "analytics", destTable: "orders" }, "owner-1");
    const backingId = await scheduledStore.createJob({ ...jobInput, frequency: "event" }, "owner-1", "data_health_check");
    const promiseId = await store.createPromiseMetadata(promiseInput(backingId, upstreamId));
    const disabledBackingId = await scheduledStore.createJob({ ...jobInput, frequency: "event" }, "owner-1", "data_health_check");
    const disabledPromiseId = await store.createPromiseMetadata({ ...promiseInput(disabledBackingId, upstreamId), enabled: false });

    await rawRun(sql`INSERT INTO notification_channels (id, name, type, enabled, created_at, updated_at) VALUES ('chan-1', 'Chan', 'webhook', 1, ${now}, ${now})`);
    await scheduledStore.setJobChannels(backingId, ["chan-1"]);
    const upstream = await scheduledStore.getJob(upstreamId);
    if (!upstream) throw new Error("Upstream job was not created");
    await scheduledStore.insertRun({ id: "up-run-1", queryId: upstreamId, trigger: "scheduled", slotAt: now, attempt: 1, runnerId: "test", deadline: now + 1000, startedAt: now });

    await processUpstreamFailure(upstream, "up-run-1", "boom");

    expect((await store.getPromise(promiseId))?.status).toBe("unknown");
    const incidents = await store.listIncidents(promiseId);
    expect(incidents.length).toBe(1);
    expect(incidents[0]).toMatchObject({ kind: "execution", status: "open" });
    expect(incidents[0].summary).toContain('upstream pipeline "Producer" failed: boom');
    const outbox = await scheduledStore.listClaimableOutbox(10);
    expect(outbox.length).toBe(1);
    expect(JSON.parse(outbox[0].payload) as { title: string }).toMatchObject({ title: expect.stringContaining("upstream failed") });

    // A repeat failure keeps the same incident and does not re-alert.
    await scheduledStore.insertRun({ id: "up-run-2", queryId: upstreamId, trigger: "scheduled", slotAt: now + 1, attempt: 1, runnerId: "test", deadline: now + 1000, startedAt: now });
    await processUpstreamFailure(upstream, "up-run-2", "boom again");
    expect((await store.listIncidents(promiseId)).length).toBe(1);
    expect((await scheduledStore.listClaimableOutbox(10)).length).toBe(1);

    // Disabled promises are left untouched.
    expect((await store.getPromise(disabledPromiseId))?.status).toBe("unknown"); // creation default, unchanged
    expect((await store.listIncidents(disabledPromiseId)).length).toBe(0);
  });

  it("keeps generated health jobs out of normal Scheduled Queries lists and overview", async () => {
    await scheduledStore.createJob({ ...jobInput, name: "Visible SQL" }, "owner-1");
    await scheduledStore.createJob(jobInput, "owner-1", "data_health_check");

    expect((await scheduledStore.listJobs()).map((job) => job.name)).toEqual(["Visible SQL"]);
    expect((await scheduledStore.listEnabledJobs()).length).toBe(2);
    expect((await scheduledStore.getOverview(14)).kpis.totalJobs).toBe(1);
  });

  it("groups continuing breaches into one incident and recovers with hysteresis", async () => {
    const jobId = await scheduledStore.createJob(jobInput, "owner-1", "data_health_check");
    const promiseId = await store.createPromiseMetadata({
      scheduledQueryId: jobId,
      upstreamJobId: null,
      name: "Orders promise",
      description: null,
      connectionId: "connection-1",
      sourceType: "table",
      databaseName: "analytics",
      tableName: "orders",
      sourceQuery: null,
      eventTimeColumn: "created_at",
      eventTimeType: "DateTime",
      eventTimeEncoding: "native",
      eventTimeTimezone: null,
      eventTimeFormat: "best_effort",
      rowFilter: null,
      ownerId: "owner-1",
      criticality: "critical",
      timezone: "UTC",
      runbookUrl: null,
      enabled: true,
      graceSecs: 0,
      breachAfter: 1,
      recoverAfter: 2,
      retentionDays: 90,
      schemaSnapshot: null,
      createdBy: "owner-1",
    });
    await store.replaceChecks(promiseId, checks);
    const promise = await store.getPromise(promiseId);
    if (!promise) throw new Error("Promise was not created");

    const evaluation = (outcome: "pass" | "breach", value: number) => [{
      checkKey: "rows",
      type: "row_count" as const,
      severity: "critical" as const,
      outcome,
      observedValue: value,
      expectedLower: 100,
      expectedUpper: null,
      message: outcome,
    }];
    await store.insertEvaluations(promiseId, "run-bad-1", 1_000, evaluation("breach", 50));
    const opened = await store.transitionDataIncident(promise, "unhealthy", "run-bad-1", "Too few rows");
    expect(opened.type).toBe("opened");
    if (!opened.incident) throw new Error("Incident was not opened");

    await store.insertEvaluations(promiseId, "run-bad-2", 2_000, evaluation("breach", 40));
    expect((await store.transitionDataIncident(promise, "unhealthy", "run-bad-2", "Still low")).type).toBe("none");
    expect((await store.listIncidents(promiseId)).length).toBe(1);

    const acknowledged = await store.acknowledgeIncident(opened.incident.id, "operator-1");
    expect(acknowledged?.status).toBe("acknowledged");
    await store.insertEvaluations(promiseId, "run-good-1", 3_000, evaluation("pass", 120));
    expect((await store.transitionDataIncident(promise, "healthy", "run-good-1", "Healthy")).type).toBe("none");
    await store.insertEvaluations(promiseId, "run-good-2", 4_000, evaluation("pass", 130));
    expect((await store.transitionDataIncident(promise, "healthy", "run-good-2", "Healthy")).type).toBe("recovered");
    expect((await store.listIncidents(promiseId))[0].status).toBe("recovered");

    const executionOpened = await store.transitionExecutionIncident(promise, true, "run-error-1", "Monitor timed out");
    expect(executionOpened.type).toBe("opened");
    expect(executionOpened.incident?.kind).toBe("execution");
    expect((await store.transitionExecutionIncident(promise, true, "run-error-2", "Still unavailable")).type).toBe("none");
    expect((await store.transitionExecutionIncident(promise, false, "run-recovered", "Monitor recovered")).type).toBe("recovered");
    const events = await store.listIncidentEventsForPromise(promiseId);
    expect(events.some((event) => event.type === "opened" && event.runId === "run-error-1")).toBe(true);
    expect(events.some((event) => event.type === "recovered" && event.runId === "run-recovered")).toBe(true);
  });
});
