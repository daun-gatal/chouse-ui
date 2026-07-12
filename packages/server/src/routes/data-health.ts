import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { validateQueryAccess } from "../middleware/dataAccess";
import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS, SYSTEM_ROLES } from "../rbac/schema/base";
import { getConnectionById, getUserConnections } from "../rbac/services/connections";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { compileDataHealthQuery } from "../services/dataHealth/compiler";
import { backtestDataHealth, buildFailingRowsQuery, runFailingRowsDiagnostic } from "../services/dataHealth/diagnostics";
import * as healthStore from "../services/dataHealth/store";
import { dataHealthCheckDefinitionSchema } from "../services/dataHealth/types";
import { isValidTimeZone, nextFireTimes, validateCron } from "../services/scheduledQueries/cadence";
import * as runner from "../services/scheduledQueries/runner";
import * as scheduledStore from "../services/scheduledQueries/store";
import { SQ_FREQUENCIES } from "../services/scheduledQueries/types";
import { toParseableSql } from "../services/scheduledQueries/validation";
import { clientForConnection } from "../services/scheduledQueries/chClient";
import { AppError, requireParam } from "../types";

const dataHealth = new Hono();
dataHealth.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status?: 200 | 201): any {
  return c.json({ success: true, data }, status ?? 200);
}

function currentUser(c: Context): ReturnType<typeof getRbacUser> {
  return getRbacUser(c);
}

function canViewAll(c: Context): boolean {
  const user = currentUser(c);
  return user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN) || user.permissions.includes(PERMISSIONS.DATA_HEALTH_VIEW_ALL);
}

async function assertConnectionAccess(c: Context, connectionId: string): Promise<void> {
  const user = currentUser(c);
  if (user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN)) return;
  const connections = await getUserConnections(user.sub);
  if (!connections.some((connection) => connection.id === connectionId)) {
    throw AppError.forbidden("You do not have access to this connection");
  }
}

async function assertQueryAccess(c: Context, query: string, connectionId: string): Promise<void> {
  const user = currentUser(c);
  const connection = await getConnectionById(connectionId);
  const isAdmin = user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN) || user.roles.includes(SYSTEM_ROLES.ADMIN);
  const result = await validateQueryAccess(
    user.sub,
    isAdmin,
    user.permissions,
    toParseableSql(query),
    connection?.database ?? undefined,
    connectionId,
  );
  if (!result.allowed) throw AppError.forbidden(result.reason ?? "Access denied to the monitored dataset");
}

const promiseBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullish(),
  connectionId: z.string().min(1),
  source: z.discriminatedUnion("sourceType", [
    z.object({
      sourceType: z.literal("table"),
      databaseName: z.string().trim().min(1).max(64),
      tableName: z.string().trim().min(1).max(64),
      eventTimeColumn: z.string().trim().min(1).max(64).optional(),
      rowFilter: z.string().trim().max(2000).nullish(),
    }),
    z.object({
      sourceType: z.literal("query"),
      sourceQuery: z.string().trim().min(1).max(100_000),
      eventTimeColumn: z.string().trim().min(1).max(64).optional(),
      rowFilter: z.string().trim().max(2000).nullish(),
    }),
  ]),
  ownerId: z.string().nullish(),
  criticality: z.enum(["standard", "important", "critical"]).default("standard"),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  runbookUrl: z.string().url().max(2000).nullish(),
  enabled: z.boolean().default(true),
  frequency: z.enum(SQ_FREQUENCIES as unknown as [string, ...string[]]),
  hour: z.number().int().min(0).max(23).default(8),
  dayOfWeek: z.number().int().min(0).max(6).default(1),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  cronExpr: z.string().trim().nullish(),
  graceSecs: z.number().int().min(0).max(7 * 24 * 60 * 60).default(0),
  breachAfter: z.number().int().min(1).max(20).default(2),
  recoverAfter: z.number().int().min(1).max(20).default(2),
  retentionDays: z.number().int().min(1).max(3650).default(90),
  timeoutSecs: z.number().int().min(1).max(3600).default(60),
  channelIds: z.array(z.string()).default([]),
  checks: z.array(dataHealthCheckDefinitionSchema).min(1).max(100),
  runNow: z.boolean().default(true),
});

type PromiseBody = z.infer<typeof promiseBodySchema>;

function validatePromiseBody(body: PromiseBody): void {
  if (!isValidTimeZone(body.timezone)) throw AppError.badRequest("Invalid IANA timezone");
  if (body.frequency === "cron") {
    const cron = validateCron(body.cronExpr ?? "", body.timezone);
    if (!cron.valid) throw AppError.badRequest(cron.error ?? "Invalid cron expression");
  }
}

function compile(body: PromiseBody): ReturnType<typeof compileDataHealthQuery> {
  return compileDataHealthQuery({
    sourceType: body.source.sourceType,
    databaseName: body.source.sourceType === "table" ? body.source.databaseName : undefined,
    tableName: body.source.sourceType === "table" ? body.source.tableName : undefined,
    sourceQuery: body.source.sourceType === "query" ? body.source.sourceQuery : undefined,
    eventTimeColumn: body.source.eventTimeColumn,
    rowFilter: body.source.rowFilter ?? undefined,
  }, body.checks);
}

function metadataInput(body: PromiseBody, scheduledQueryId: string, ownerId: string, createdBy: string, schemaSnapshot: Array<{ name: string; type: string }> | null = null): healthStore.CreatePromiseMetadataInput {
  return {
    scheduledQueryId,
    name: body.name,
    description: body.description ?? null,
    connectionId: body.connectionId,
    sourceType: body.source.sourceType,
    databaseName: body.source.sourceType === "table" ? body.source.databaseName : null,
    tableName: body.source.sourceType === "table" ? body.source.tableName : null,
    sourceQuery: body.source.sourceType === "query" ? body.source.sourceQuery : null,
    eventTimeColumn: body.source.eventTimeColumn ?? null,
    rowFilter: body.source.rowFilter ?? null,
    ownerId,
    criticality: body.criticality,
    timezone: body.timezone,
    runbookUrl: body.runbookUrl ?? null,
    enabled: body.enabled,
    graceSecs: body.graceSecs,
    breachAfter: body.breachAfter,
    recoverAfter: body.recoverAfter,
    retentionDays: body.retentionDays,
    schemaSnapshot,
    createdBy,
  };
}

function jobInput(body: PromiseBody, query: string): scheduledStore.JobInput {
  return {
    name: `[Data Health] ${body.name}`,
    description: body.description ?? null,
    connectionId: body.connectionId,
    query,
    enabled: body.enabled,
    frequency: body.frequency,
    hour: body.hour,
    dayOfWeek: body.dayOfWeek,
    dayOfMonth: body.dayOfMonth,
    cronExpr: body.frequency === "cron" ? body.cronExpr ?? null : null,
    timezone: body.timezone,
    outputMode: "none",
    destDatabase: null,
    destTable: null,
    outputConfig: null,
    maxRows: 1,
    timeoutSecs: body.timeoutSecs,
    useFinal: false,
    seqConsistency: false,
    maxAttempts: 2,
    retentionDays: body.retentionDays,
  };
}

async function promiseResponse(promise: NonNullable<Awaited<ReturnType<typeof healthStore.getPromise>>>): Promise<Record<string, unknown>> {
  const [checks, job, channelIds] = await Promise.all([
    healthStore.getChecks(promise.id),
    scheduledStore.getJob(promise.scheduledQueryId),
    scheduledStore.getJobChannelIds(promise.scheduledQueryId),
  ]);
  if (!job || job.kind !== "data_health_check") throw AppError.internal("Data Health execution job is missing");
  return {
    ...promise,
    checks,
    schedule: {
      frequency: job.frequency,
      hour: job.hour,
      dayOfWeek: job.dayOfWeek,
      dayOfMonth: job.dayOfMonth,
      cronExpr: job.cronExpr,
      timeoutSecs: job.timeoutSecs,
    },
    channelIds,
  };
}

async function loadVisiblePromise(c: Context, id: string): Promise<NonNullable<Awaited<ReturnType<typeof healthStore.getPromise>>>> {
  const promise = await healthStore.getPromise(id);
  if (!promise) throw AppError.notFound("Data Health promise not found");
  if (!canViewAll(c) && promise.ownerId !== currentUser(c).sub && promise.createdBy !== currentUser(c).sub) {
    throw AppError.notFound("Data Health promise not found");
  }
  return promise;
}

dataHealth.get("/", requirePermission(PERMISSIONS.DATA_HEALTH_VIEW), async (c) => {
  const promises = await healthStore.listPromises(canViewAll(c) ? null : currentUser(c).sub);
  return ok(c, { promises: await Promise.all(promises.map(promiseResponse)) });
});

dataHealth.get("/overview", requirePermission(PERMISSIONS.DATA_HEALTH_VIEW), async (c) => {
  const promises = await healthStore.listPromises(canViewAll(c) ? null : currentUser(c).sub);
  const scheduledJobs = await scheduledStore.listJobs(canViewAll(c) ? null : currentUser(c).sub);
  const incidents = canViewAll(c)
    ? await healthStore.listIncidents()
    : (await Promise.all(promises.map((promise) => healthStore.listIncidents(promise.id)))).flat();
  const byStatus = { healthy: 0, degraded: 0, unhealthy: 0, unknown: 0, paused: 0 };
  for (const promise of promises) byStatus[promise.status]++;
  const protectedTables = new Set(promises.flatMap((promise) => promise.databaseName && promise.tableName ? [`${promise.databaseName}.${promise.tableName}`] : []));
  const coverageGaps = scheduledJobs.flatMap((job) => {
    const { destDatabase, destTable } = job;
    if (job.outputMode === "none" || !destDatabase || !destTable || protectedTables.has(`${destDatabase}.${destTable}`)) return [];
    return [{ jobId: job.id, jobName: job.name, databaseName: destDatabase, tableName: destTable, outputMode: job.outputMode }];
  }).slice(0, 20);
  return ok(c, {
    totalPromises: promises.length,
    byStatus,
    openIncidents: incidents.filter((incident) => incident.status !== "recovered").length,
    unownedCritical: promises.filter((promise) => promise.criticality === "critical" && !promise.ownerId).length,
    needsAttention: promises.filter((promise) => promise.status === "degraded" || promise.status === "unhealthy" || promise.status === "unknown")
      .sort((a, b) => (b.lastEvaluatedAt ?? 0) - (a.lastEvaluatedAt ?? 0))
      .slice(0, 10),
    coverageGaps,
  });
});

dataHealth.post(
  "/preview",
  requirePermission(PERMISSIONS.DATA_HEALTH_EDIT),
  zValidator("json", promiseBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    validatePromiseBody(body);
    const compiled = compile(body);
    await assertConnectionAccess(c, body.connectionId);
    await assertQueryAccess(c, compiled.sql, body.connectionId);
    const fireTimes = body.frequency === "manual" ? [] : nextFireTimes({
      frequency: body.frequency,
      hour: body.hour,
      dayOfWeek: body.dayOfWeek,
      dayOfMonth: body.dayOfMonth,
      cronExpr: body.frequency === "cron" ? body.cronExpr ?? null : null,
      timezone: body.timezone,
    }, 5);
    return ok(c, { compiledSql: compiled.sql, metricCheckKeys: compiled.metricCheckKeys, schemaCheckKeys: compiled.schemaCheckKeys, nextFireTimes: fireTimes });
  },
);

dataHealth.post(
  "/",
  requirePermission(PERMISSIONS.DATA_HEALTH_EDIT),
  zValidator("json", promiseBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    validatePromiseBody(body);
    const compiled = compile(body);
    await assertConnectionAccess(c, body.connectionId);
    await assertQueryAccess(c, compiled.sql, body.connectionId);
    const user = currentUser(c);
    const ownerId = canViewAll(c) ? body.ownerId ?? user.sub : user.sub;
    const jobId = await scheduledStore.createJob(jobInput(body, compiled.sql), ownerId, "data_health_check");

    let promiseId: string;
    try {
      promiseId = await healthStore.createPromiseMetadata(metadataInput(body, jobId, ownerId, user.sub));
      await healthStore.replaceChecks(promiseId, body.checks);
      await scheduledStore.setJobChannels(jobId, body.channelIds);
    } catch (error) {
      await scheduledStore.deleteJob(jobId);
      throw error;
    }

    await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_HEALTH_PROMISE_CREATE, user.sub, { resourceType: "data_health_promise", resourceId: promiseId, details: { name: body.name } });
    const promise = await healthStore.getPromise(promiseId);
    if (!promise) throw AppError.internal("Created Data Health promise could not be loaded");
    const initialJob = await scheduledStore.getJob(jobId);
    if (!initialJob) throw AppError.internal("Created Data Health execution job could not be loaded");
    const initialRun = body.runNow ? await runner.execute(initialJob, { trigger: "manual", slotAt: Date.now(), attempt: 1 }) : null;
    return ok(c, { promise: await promiseResponse(promise), initialRun }, 201);
  },
);

dataHealth.get("/incidents", requirePermission(PERMISSIONS.DATA_HEALTH_VIEW), async (c) => {
  if (canViewAll(c)) return ok(c, { incidents: await healthStore.listIncidents() });
  const promises = await healthStore.listPromises(currentUser(c).sub);
  const nested = await Promise.all(promises.map((promise) => healthStore.listIncidents(promise.id)));
  return ok(c, { incidents: nested.flat().sort((a, b) => b.lastEventAt - a.lastEventAt) });
});

dataHealth.post(
  "/:id/backtest",
  requirePermission(PERMISSIONS.DATA_HEALTH_RUN),
  zValidator("json", z.object({ slots: z.number().int().min(1).max(30).default(14) })),
  async (c) => {
    const promise = await loadVisiblePromise(c, requireParam(c, "id"));
    const [checks, job] = await Promise.all([
      healthStore.getChecks(promise.id),
      scheduledStore.getJob(promise.scheduledQueryId),
    ]);
    if (!job || job.kind !== "data_health_check") throw AppError.internal("Data Health execution job is missing");
    const compiled = compileDataHealthQuery({
      sourceType: promise.sourceType,
      databaseName: promise.databaseName ?? undefined,
      tableName: promise.tableName ?? undefined,
      sourceQuery: promise.sourceQuery ?? undefined,
      eventTimeColumn: promise.eventTimeColumn ?? undefined,
      rowFilter: promise.rowFilter ?? undefined,
    }, checks);
    await assertConnectionAccess(c, promise.connectionId);
    await assertQueryAccess(c, compiled.sql, promise.connectionId);
    const client = await clientForConnection(promise.connectionId, JSON.stringify({ rbac_user_id: currentUser(c).sub, source: "data_health_backtest", promise_id: promise.id }));
    return ok(c, await backtestDataHealth(client, job, compiled.sql, checks, c.req.valid("json").slots));
  },
);

dataHealth.post(
  "/:id/diagnostics",
  requirePermission(PERMISSIONS.DATA_HEALTH_VIEW),
  zValidator("json", z.object({ checkKey: z.string().min(1).max(64), slotAt: z.number().int().optional(), limit: z.number().int().min(1).max(100).default(50) })),
  async (c) => {
    const promise = await loadVisiblePromise(c, requireParam(c, "id"));
    const [checks, job] = await Promise.all([
      healthStore.getChecks(promise.id),
      scheduledStore.getJob(promise.scheduledQueryId),
    ]);
    if (!job || job.kind !== "data_health_check") throw AppError.internal("Data Health execution job is missing");
    const body = c.req.valid("json");
    const check = checks.find((candidate) => candidate.checkKey === body.checkKey);
    if (!check) throw AppError.notFound("Data Health check not found");
    const query = buildFailingRowsQuery(promise, check, body.limit);
    if (query) await assertQueryAccess(c, query, promise.connectionId);
    await assertConnectionAccess(c, promise.connectionId);
    const client = await clientForConnection(promise.connectionId, JSON.stringify({ rbac_user_id: currentUser(c).sub, source: "data_health_diagnostic", promise_id: promise.id }));
    const slotAt = body.slotAt ?? promise.lastEvaluatedAt ?? Date.now();
    return ok(c, await runFailingRowsDiagnostic(client, promise, job, check, slotAt, body.limit));
  },
);

dataHealth.post("/incidents/:id/acknowledge", requirePermission(PERMISSIONS.DATA_HEALTH_EDIT), async (c) => {
  const id = requireParam(c, "id");
  const incident = await healthStore.getIncident(id);
  if (!incident) throw AppError.notFound("Data Health incident not found");
  await loadVisiblePromise(c, incident.promiseId);
  const updated = await healthStore.acknowledgeIncident(id, currentUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_HEALTH_INCIDENT_ACKNOWLEDGE, currentUser(c).sub, { resourceType: "data_health_incident", resourceId: id });
  return ok(c, { incident: updated });
});

dataHealth.post(
  "/incidents/:id/snooze",
  requirePermission(PERMISSIONS.DATA_HEALTH_EDIT),
  zValidator("json", z.object({ until: z.number().int() })),
  async (c) => {
    const id = requireParam(c, "id");
    const incident = await healthStore.getIncident(id);
    if (!incident) throw AppError.notFound("Data Health incident not found");
    await loadVisiblePromise(c, incident.promiseId);
    const until = c.req.valid("json").until;
    if (until < Date.now() + 60_000) throw AppError.badRequest("Snooze time must be at least one minute in the future");
    const updated = await healthStore.snoozeIncident(id, currentUser(c).sub, until);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_HEALTH_INCIDENT_SNOOZE, currentUser(c).sub, { resourceType: "data_health_incident", resourceId: id });
    return ok(c, { incident: updated });
  },
);

dataHealth.get("/:id", requirePermission(PERMISSIONS.DATA_HEALTH_VIEW), async (c) => {
  const promise = await loadVisiblePromise(c, requireParam(c, "id"));
  return ok(c, await promiseResponse(promise));
});

dataHealth.get("/:id/timeline", requirePermission(PERMISSIONS.DATA_HEALTH_VIEW), async (c) => {
  const promise = await loadVisiblePromise(c, requireParam(c, "id"));
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 200)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const [samples, incidents, events, runs] = await Promise.all([
    healthStore.listSamples(promise.id, limit, offset),
    healthStore.listIncidents(promise.id, limit, offset),
    healthStore.listIncidentEventsForPromise(promise.id, limit),
    scheduledStore.listRuns({ queryId: promise.scheduledQueryId, limit, offset }),
  ]);
  return ok(c, { samples, incidents, events, runs });
});

dataHealth.patch(
  "/:id",
  requirePermission(PERMISSIONS.DATA_HEALTH_EDIT),
  zValidator("json", promiseBodySchema),
  async (c) => {
    const promise = await loadVisiblePromise(c, requireParam(c, "id"));
    const body = c.req.valid("json");
    validatePromiseBody(body);
    const compiled = compile(body);
    await assertConnectionAccess(c, body.connectionId);
    await assertQueryAccess(c, compiled.sql, body.connectionId);
    const existingJob = await scheduledStore.getJob(promise.scheduledQueryId);
    if (!existingJob || existingJob.kind !== "data_health_check") throw AppError.internal("Data Health execution job is missing");
    const oldChecks = await healthStore.getChecks(promise.id);
    const oldChannels = await scheduledStore.getJobChannelIds(existingJob.id);
    const user = currentUser(c);
    const ownerId = canViewAll(c) ? body.ownerId ?? promise.ownerId ?? user.sub : promise.ownerId ?? user.sub;
    try {
      await scheduledStore.updateJob(existingJob.id, jobInput(body, compiled.sql));
      await healthStore.updatePromiseMetadata(promise.id, metadataInput(body, existingJob.id, ownerId, promise.createdBy ?? user.sub, promise.schemaSnapshot));
      await healthStore.replaceChecks(promise.id, body.checks);
      await scheduledStore.setJobChannels(existingJob.id, body.channelIds);
    } catch (error) {
      await scheduledStore.updateJob(existingJob.id, {
        name: existingJob.name,
        description: existingJob.description,
        connectionId: existingJob.connectionId,
        query: existingJob.query,
        enabled: existingJob.enabled,
        frequency: existingJob.frequency,
        hour: existingJob.hour,
        dayOfWeek: existingJob.dayOfWeek,
        dayOfMonth: existingJob.dayOfMonth,
        cronExpr: existingJob.cronExpr,
        timezone: existingJob.timezone,
        outputMode: existingJob.outputMode,
        destDatabase: existingJob.destDatabase,
        destTable: existingJob.destTable,
        outputConfig: existingJob.outputConfig,
        maxRows: existingJob.maxRows,
        timeoutSecs: existingJob.timeoutSecs,
        useFinal: existingJob.useFinal,
        seqConsistency: existingJob.seqConsistency,
        maxAttempts: existingJob.maxAttempts,
        retentionDays: existingJob.retentionDays,
      });
      await healthStore.updatePromiseMetadata(promise.id, {
        scheduledQueryId: promise.scheduledQueryId,
        name: promise.name,
        description: promise.description,
        connectionId: promise.connectionId,
        sourceType: promise.sourceType,
        databaseName: promise.databaseName,
        tableName: promise.tableName,
        sourceQuery: promise.sourceQuery,
        eventTimeColumn: promise.eventTimeColumn,
        rowFilter: promise.rowFilter,
        ownerId: promise.ownerId,
        criticality: promise.criticality,
        timezone: promise.timezone,
        runbookUrl: promise.runbookUrl,
        enabled: promise.enabled,
        graceSecs: promise.graceSecs,
        breachAfter: promise.breachAfter,
        recoverAfter: promise.recoverAfter,
        retentionDays: promise.retentionDays,
        schemaSnapshot: promise.schemaSnapshot,
        createdBy: promise.createdBy,
      });
      await healthStore.replaceChecks(promise.id, oldChecks);
      await scheduledStore.setJobChannels(existingJob.id, oldChannels);
      throw error;
    }
    const changedFields = [
      promise.name !== body.name ? "name" : null,
      promise.sourceType !== body.source.sourceType ? "source" : null,
      promise.criticality !== body.criticality ? "criticality" : null,
      promise.timezone !== body.timezone ? "schedule" : null,
      promise.breachAfter !== body.breachAfter || promise.recoverAfter !== body.recoverAfter || promise.graceSecs !== body.graceSecs ? "incident_policy" : null,
      oldChecks.length !== body.checks.length || JSON.stringify(oldChecks) !== JSON.stringify(body.checks) ? "checks" : null,
      promise.enabled !== body.enabled ? "enabled" : null,
    ].filter((field): field is string => field !== null);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_HEALTH_PROMISE_UPDATE, user.sub, { resourceType: "data_health_promise", resourceId: promise.id, details: { changedFields, previousUpdatedAt: promise.updatedAt } });
    const updated = await healthStore.getPromise(promise.id);
    if (!updated) throw AppError.internal("Updated Data Health promise could not be loaded");
    return ok(c, await promiseResponse(updated));
  },
);

dataHealth.post("/:id/run", requirePermission(PERMISSIONS.DATA_HEALTH_RUN), async (c) => {
  const promise = await loadVisiblePromise(c, requireParam(c, "id"));
  const job = await scheduledStore.getJob(promise.scheduledQueryId);
  if (!job || job.kind !== "data_health_check") throw AppError.internal("Data Health execution job is missing");
  const run = await runner.execute(job, { trigger: "manual", slotAt: Date.now(), attempt: 1 });
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_HEALTH_PROMISE_RUN, currentUser(c).sub, { resourceType: "data_health_promise", resourceId: promise.id });
  return ok(c, { run });
});

dataHealth.delete("/:id", requirePermission(PERMISSIONS.DATA_HEALTH_DELETE), async (c) => {
  const promise = await loadVisiblePromise(c, requireParam(c, "id"));
  await scheduledStore.deleteJob(promise.scheduledQueryId);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_HEALTH_PROMISE_DELETE, currentUser(c).sub, { resourceType: "data_health_promise", resourceId: promise.id });
  return ok(c, { success: true });
});

export default dataHealth;
