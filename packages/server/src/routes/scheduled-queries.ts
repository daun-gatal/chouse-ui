/**
 * Scheduled Queries routes (/api/scheduled-queries)
 *
 * CRUD + manual run + run history + overview aggregation + a builder `preview`
 * helper. Every job is user SQL gated by scheduled_queries:edit and read-only
 * validated; materialize jobs (output_mode<>'none') additionally require
 * scheduled_queries:write and a destination write-access check. The data-access
 * boundary is the connection: a user may only schedule against a connection they
 * can access (checked at create/edit). See ADR 0002 (D8, D9).
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { PERMISSIONS, AUDIT_ACTIONS, SYSTEM_ROLES } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { getUserConnections, getConnectionById } from "../rbac/services/connections";
import { validateQueryAccess } from "../middleware/dataAccess";
import { AppError } from "../types";
import { logger } from "../utils/logger";
import * as store from "../services/scheduledQueries/store";
import * as runner from "../services/scheduledQueries/runner";
import {
  outputConfigSchema,
  SQ_FREQUENCIES,
  SQ_OUTPUT_MODES,
  type ScheduledQueryRow,
} from "../services/scheduledQueries/types";
import { validateReadOnlySelect, toParseableSql } from "../services/scheduledQueries/validation";
import { validateCron, nextFireTimes } from "../services/scheduledQueries/cadence";
import { clientForConnection } from "../services/scheduledQueries/chClient";
import {
  describeSelectSchema,
  describeDestination,
  checkEngineFit,
  diffSchema,
  buildCreateTableDDL,
} from "../services/scheduledQueries/materialize";
import { buildExecutableQuery, toDateTime64Param } from "../services/scheduledQueries/validation";
import { buildLineage, clampWindowDays } from "../services/scheduledQueries/lineage";

const scheduledQueries = new Hono();

scheduledQueries.use("*", rbacAuthMiddleware);

/** Response envelope the api client unwraps (`data.data`). Mirrors alerting. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status?: 200 | 201): any {
  return c.json({ success: true, data }, status ?? 200);
}

function userId(c: Context): string | undefined {
  try {
    return getRbacUser(c).sub;
  } catch {
    return undefined;
  }
}

function isSuperAdmin(c: Context): boolean {
  try {
    return getRbacUser(c).roles.includes(SYSTEM_ROLES.SUPER_ADMIN);
  } catch {
    return false;
  }
}

function hasWritePerm(c: Context): boolean {
  try {
    return getRbacUser(c).permissions.includes(PERMISSIONS.SCHEDULED_QUERIES_WRITE);
  } catch {
    return false;
  }
}

/** Cross-owner visibility: see + act on every job, not just the user's own. */
function canViewAll(c: Context): boolean {
  if (isSuperAdmin(c)) return true;
  try {
    return getRbacUser(c).permissions.includes(PERMISSIONS.SCHEDULED_QUERIES_VIEW_ALL);
  } catch {
    return false;
  }
}

/** The owner scope to apply to list/overview queries (`null` ⇒ all owners). */
function ownerScope(c: Context): string | null {
  return canViewAll(c) ? null : (userId(c) ?? "__none__");
}

/**
 * Load a job the caller is allowed to see/act on. Without view_all the caller
 * may only touch jobs they created; a hidden job is reported as not-found so its
 * existence isn't leaked.
 */
async function loadVisibleJob(c: Context, id: string): Promise<ScheduledQueryRow> {
  const job = await store.getJob(id);
  if (!job) throw AppError.notFound("Scheduled query not found");
  if (!canViewAll(c) && job.createdBy !== userId(c)) {
    throw AppError.notFound("Scheduled query not found");
  }
  return job;
}

/** Reject if the user cannot access the connection (the data-access boundary). */
async function assertConnectionAccess(c: Context, connectionId: string): Promise<void> {
  if (isSuperAdmin(c)) return;
  const uid = userId(c);
  if (!uid) throw AppError.unauthorized("No authenticated user");
  const conns = await getUserConnections(uid);
  if (!conns.some((conn) => conn.id === connectionId)) {
    throw AppError.forbidden("You do not have access to this connection");
  }
}

/**
 * Run the SAME table/database data-access policy the interactive query route
 * enforces — so a scheduled query can't read tables the user's role isn't granted.
 * `{{…}}` tokens are stripped to a literal first so the validator can parse the SQL.
 */
async function dataAccessCheck(c: Context, query: string, connectionId: string): Promise<{ allowed: boolean; reason?: string }> {
  let roles: string[] = [];
  let permissions: string[] = [];
  try {
    const u = getRbacUser(c);
    roles = u.roles;
    permissions = u.permissions;
  } catch {
    return { allowed: false, reason: "RBAC authentication is required." };
  }
  const isAdmin = roles.includes(SYSTEM_ROLES.SUPER_ADMIN) || roles.includes(SYSTEM_ROLES.ADMIN);
  const conn = await getConnectionById(connectionId);
  const result = await validateQueryAccess(
    userId(c),
    isAdmin,
    permissions,
    toParseableSql(query),
    conn?.database ?? undefined,
    connectionId,
  );
  return { allowed: result.allowed, reason: result.reason };
}

// --- request schema ---------------------------------------------------------

const jobBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullish(),
  connectionId: z.string().min(1),
  query: z.string().min(1),
  enabled: z.boolean().default(true),
  frequency: z.enum(SQ_FREQUENCIES as unknown as [string, ...string[]]),
  hour: z.number().int().min(0).max(23).default(8),
  dayOfWeek: z.number().int().min(0).max(6).default(1),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  cronExpr: z.string().trim().nullish(),
  outputMode: z.enum(SQ_OUTPUT_MODES as unknown as [string, ...string[]]).default("none"),
  destDatabase: z.string().trim().nullish(),
  destTable: z.string().trim().nullish(),
  outputConfig: outputConfigSchema.nullish(),
  maxRows: z.number().int().min(1).max(10000).default(100),
  timeoutSecs: z.number().int().min(1).max(3600).default(60),
  useFinal: z.boolean().default(false),
  seqConsistency: z.boolean().default(false),
  maxAttempts: z.number().int().min(1).max(10).default(2),
  retentionDays: z.number().int().min(1).max(3650).default(90),
  channelIds: z.array(z.string()).default([]),
});

type JobBody = z.infer<typeof jobBodySchema>;

/** Cross-field validation shared by create + edit. Throws AppError on failure. */
function validateBody(body: JobBody, canWrite: boolean): void {
  const ro = validateReadOnlySelect(body.query);
  if (!ro.ok) throw AppError.badRequest(ro.error ?? "Invalid query");

  if (body.frequency === "cron") {
    const cron = validateCron(body.cronExpr ?? "");
    if (!cron.valid) throw AppError.badRequest(cron.error ?? "Invalid cron expression");
  }

  if (body.outputMode !== "none") {
    if (!canWrite) throw AppError.forbidden("Materialize jobs require the scheduled_queries:write permission");
    if (!body.destDatabase || !body.destTable) {
      throw AppError.badRequest("Destination database and table are required for materialize jobs");
    }
    if (body.destDatabase === "system") throw AppError.badRequest("Destination cannot be a system table");
    if (body.outputMode === "replace" && !body.outputConfig?.partitionExpr) {
      throw AppError.badRequest("replace mode requires output_config.partitionExpr");
    }
  }
}

function bodyToInput(body: JobBody): store.JobInput {
  return {
    name: body.name,
    description: body.description ?? null,
    connectionId: body.connectionId,
    query: body.query,
    enabled: body.enabled,
    frequency: body.frequency as ScheduledQueryRow["frequency"],
    hour: body.hour,
    dayOfWeek: body.dayOfWeek,
    dayOfMonth: body.dayOfMonth,
    cronExpr: body.frequency === "cron" ? (body.cronExpr ?? null) : null,
    outputMode: body.outputMode as ScheduledQueryRow["outputMode"],
    destDatabase: body.outputMode === "none" ? null : (body.destDatabase ?? null),
    destTable: body.outputMode === "none" ? null : (body.destTable ?? null),
    outputConfig: body.outputMode === "none" ? null : (body.outputConfig ?? null),
    maxRows: body.maxRows,
    timeoutSecs: body.timeoutSecs,
    useFinal: body.useFinal,
    seqConsistency: body.seqConsistency,
    maxAttempts: body.maxAttempts,
    retentionDays: body.retentionDays,
  };
}

/** Build a run filter (status / time-range / older-than-N-days) from the query. */
function runFilterFromQuery(c: Context, queryId: string): store.RunFilter {
  const status = c.req.query("status");
  const fromRaw = c.req.query("from");
  const toRaw = c.req.query("to");
  const olderThanDays = c.req.query("olderThanDays");
  const num = (v: string | undefined): number | undefined => {
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const filter: store.RunFilter = { queryId };
  if (status) filter.status = status as store.RunFilter["status"];
  const from = num(fromRaw);
  if (from != null) filter.from = from;
  const days = num(olderThanDays);
  if (days != null && days > 0) {
    // Delete/keep window: everything strictly older than (now - N days).
    filter.to = Date.now() - days * 24 * 60 * 60 * 1000;
  } else {
    const to = num(toRaw);
    if (to != null) filter.to = to;
  }
  return filter;
}

async function toJobResponse(job: ScheduledQueryRow, includeLastRun: boolean): Promise<Record<string, unknown>> {
  const channelIds = await store.getJobChannelIds(job.id);
  const base: Record<string, unknown> = { ...job, channelIds };
  if (includeLastRun) {
    const runs = await store.listRuns({ queryId: job.id, limit: 1, offset: 0 });
    base.lastRun = runs[0] ?? null;
  }
  return base;
}

// --- jobs -------------------------------------------------------------------

scheduledQueries.get("/", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_VIEW), async (c) => {
  const jobs = await store.listJobs(ownerScope(c));
  const data = await Promise.all(jobs.map((j) => toJobResponse(j, true)));
  return ok(c, { jobs: data });
});

scheduledQueries.get("/overview", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_VIEW), async (c) => {
  const windowParam = c.req.query("window") ?? "14d";
  const windowDays = Math.min(90, Math.max(1, parseInt(windowParam, 10) || 14));
  const overview = await store.getOverview(windowDays, ownerScope(c));
  return ok(c, overview);
});

scheduledQueries.post(
  "/",
  requirePermission(PERMISSIONS.SCHEDULED_QUERIES_EDIT),
  zValidator("json", jobBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    validateBody(body, hasWritePerm(c));
    await assertConnectionAccess(c, body.connectionId);
    const access = await dataAccessCheck(c, body.query, body.connectionId);
    if (!access.allowed) throw AppError.forbidden(access.reason || "Access denied to one or more tables in the query");
    const id = await store.createJob(bodyToInput(body), userId(c) ?? null);
    await store.setJobChannels(id, body.channelIds);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SCHEDULED_QUERY_CREATE, userId(c), { resourceType: "scheduled_query", resourceId: id, details: { name: body.name } });
    const job = await store.getJob(id);
    return ok(c, await toJobResponse(job!, false), 201);
  },
);

scheduledQueries.get("/:id", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_VIEW), async (c) => {
  const job = await loadVisibleJob(c, c.req.param("id"));
  return ok(c, await toJobResponse(job, true));
});

scheduledQueries.patch(
  "/:id",
  requirePermission(PERMISSIONS.SCHEDULED_QUERIES_EDIT),
  zValidator("json", jobBodySchema),
  async (c) => {
    const id = c.req.param("id");
    await loadVisibleJob(c, id);
    const body = c.req.valid("json");
    validateBody(body, hasWritePerm(c));
    await assertConnectionAccess(c, body.connectionId);
    const access = await dataAccessCheck(c, body.query, body.connectionId);
    if (!access.allowed) throw AppError.forbidden(access.reason || "Access denied to one or more tables in the query");
    await store.updateJob(id, bodyToInput(body));
    await store.setJobChannels(id, body.channelIds);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SCHEDULED_QUERY_UPDATE, userId(c), { resourceType: "scheduled_query", resourceId: id });
    const job = await store.getJob(id);
    return ok(c, await toJobResponse(job!, false));
  },
);

scheduledQueries.delete("/:id", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_DELETE), async (c) => {
  const id = c.req.param("id");
  await loadVisibleJob(c, id);
  await store.deleteJob(id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.SCHEDULED_QUERY_DELETE, userId(c), { resourceType: "scheduled_query", resourceId: id });
  return ok(c, { success: true });
});

scheduledQueries.post("/:id/run", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_RUN), async (c) => {
  const job = await loadVisibleJob(c, c.req.param("id"));
  await createAuditLogWithContext(c, AUDIT_ACTIONS.SCHEDULED_QUERY_RUN, userId(c), { resourceType: "scheduled_query", resourceId: job.id });
  const run = await runner.execute(job, { trigger: "manual", slotAt: Date.now(), attempt: 1 });
  return ok(c, { run });
});

// --- runs -------------------------------------------------------------------

scheduledQueries.get("/:id/runs", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_VIEW), async (c) => {
  const id = c.req.param("id");
  await loadVisibleJob(c, id); // 404 if the job isn't visible to this user
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const filter = runFilterFromQuery(c, id);
  const runs = await store.listRuns({ ...filter, limit, offset });
  return ok(c, { runs });
});

scheduledQueries.get("/runs/:runId", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_VIEW), async (c) => {
  const run = await store.getRun(c.req.param("runId"));
  if (!run) throw AppError.notFound("Run not found");
  await loadVisibleJob(c, run.queryId); // 404 if the parent job isn't visible
  return ok(c, { run });
});

// Delete runs for a job by status / time-range / "older than N days" — like the
// Audit Logs prune. Deleting history is a delete operation (+ ownership check).
scheduledQueries.delete("/:id/runs", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_DELETE), async (c) => {
  const id = c.req.param("id");
  await loadVisibleJob(c, id);
  const filter = runFilterFromQuery(c, id);
  const deleted = await store.deleteRuns(filter);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.SCHEDULED_QUERY_UPDATE, userId(c), {
    resourceType: "scheduled_query",
    resourceId: id,
    details: { deletedRuns: deleted },
  });
  return ok(c, { deleted });
});

// --- lineage (observed runtime) ---------------------------------------------

scheduledQueries.get("/:id/lineage", requirePermission(PERMISSIONS.SCHEDULED_QUERIES_VIEW), async (c) => {
  const focusJob = await loadVisibleJob(c, c.req.param("id"));
  const windowParam = c.req.query("window") ?? "14d";
  const windowDays = clampWindowDays(parseInt(windowParam, 10) || 14);
  // Only jobs the caller may see feed the cross-job chain (respects view_all).
  const visibleJobs = await store.listJobs(ownerScope(c));
  const graph = await buildLineage(focusJob, visibleJobs, windowDays, userId(c) ?? null);
  return ok(c, graph);
});

// --- preview (builder helper) -----------------------------------------------

scheduledQueries.post(
  "/preview",
  requirePermission(PERMISSIONS.SCHEDULED_QUERIES_EDIT),
  zValidator("json", jobBodySchema.partial({ name: true })),
  async (c) => {
    const body = c.req.valid("json") as JobBody;
    const result: Record<string, unknown> = {};

    // 1. Read-only + token validation.
    const ro = validateReadOnlySelect(body.query);
    result.readOnly = { ok: ro.ok, error: ro.error, tokens: ro.tokens };

    // 1b. Data-access policy — the same table/database checks the interactive
    //     query route enforces, so the builder can block before saving.
    if (ro.ok && body.connectionId) {
      const access = await dataAccessCheck(c, body.query, body.connectionId);
      result.dataAccess = { allowed: access.allowed, reason: access.reason };
    }

    // 2. Next fire-times.
    if (body.frequency === "cron") {
      const cron = validateCron(body.cronExpr ?? "");
      result.cron = cron;
      if (cron.valid) {
        result.nextFireTimes = nextFireTimes(
          { frequency: "cron", hour: body.hour, dayOfWeek: body.dayOfWeek, dayOfMonth: body.dayOfMonth, cronExpr: body.cronExpr ?? null },
          5,
        );
      }
    } else if (body.frequency !== "manual") {
      result.nextFireTimes = nextFireTimes(
        { frequency: body.frequency as ScheduledQueryRow["frequency"], hour: body.hour, dayOfWeek: body.dayOfWeek, dayOfMonth: body.dayOfMonth, cronExpr: null },
        5,
      );
    }

    // 3. Materialize: DESCRIBE-based schema + destination compatibility + DDL.
    if (ro.ok && body.outputMode !== "none" && body.destDatabase && body.destTable) {
      if (!hasWritePerm(c)) throw AppError.forbidden("Materialize preview requires scheduled_queries:write");
      try {
        await assertConnectionAccess(c, body.connectionId);
        // Attribute the preview's DESCRIBE / destination reads to the RBAC user
        // in query_log (not the bare ClickHouse user). A distinct `source` keeps
        // these draft reads from being mistaken for job runs by lineage.
        const client = await clientForConnection(
          body.connectionId,
          JSON.stringify({ rbac_user_id: userId(c) ?? null, source: "scheduled_query_preview" }),
        );
        const now = Date.now();
        const { sql: execSql } = buildExecutableQuery(body.query);
        const params = {
          sq_slot_start: toDateTime64Param(now - 86_400_000),
          sq_slot_end: toDateTime64Param(now),
          sq_prev_run_at: toDateTime64Param(now - 86_400_000),
        };
        const columns = await describeSelectSchema(client, execSql, params);
        const draftJob = { ...body, outputConfig: body.outputConfig ?? {} } as unknown as ScheduledQueryRow;
        const dest = await describeDestination(client, body.destDatabase, body.destTable);
        if (dest.exists) {
          const engineError = checkEngineFit(body.outputMode as ScheduledQueryRow["outputMode"], dest);
          const schemaDiff = diffSchema(dest.columns, columns);
          result.destination = {
            exists: true,
            engine: dest.engine,
            engineError,
            compatible: engineError == null && columns.every((col) => dest.columns.some((d) => d.name === col.name)),
            missingInDest: columns.filter((col) => !dest.columns.some((d) => d.name === col.name)),
            schemaDiff,
          };
        } else {
          result.destination = {
            exists: false,
            createDDL: buildCreateTableDDL(draftJob, columns),
            willCreate: Boolean(body.outputConfig?.createIfMissing),
          };
        }
        result.outputColumns = columns;
      } catch (err) {
        result.destination = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    return ok(c, result);
  },
);

logger.debug({ module: "ScheduledQueries" }, "Routes registered");

export default scheduledQueries;
