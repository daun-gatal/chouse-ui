import { Hono, Context } from "hono";
import { PERMISSIONS } from "../rbac/schema/base";
import { userHasPermission, userHasAnyPermission } from "../rbac/services/rbac";
import {
  connectionContextMiddleware,
  type ConnectionContextVariables,
} from "../middleware/connectionContext";
import { accessDeniedError, validateQueryAccess } from "../middleware/dataAccess";
import { listQueryHistory } from "../services/queryHistory/store";
import { AppError, type RecentQuery } from "../types";

type Variables = ConnectionContextVariables;

const metrics = new Hono<{ Variables: Variables }>();

// Every route resolves its ClickHouse connection per request (ADR 0010).
metrics.use("*", connectionContextMiddleware);

/**
 * Permission check helper for metrics routes
 * Works with hybrid auth (ClickHouse session + RBAC)
 */
async function checkMetricsPermission(
  rbacUserId: string | undefined,
  rbacPermissions: string[] | undefined,
  isRbacAdmin: boolean | undefined,
  requireAdvanced: boolean = false
): Promise<void> {
  // RBAC user is required
  if (!rbacUserId) {
    throw AppError.unauthorized('RBAC authentication is required. Please login with RBAC credentials.');
  }

  // Admins have all permissions
  if (isRbacAdmin) {
    return;
  }

  // Check for basic metrics permission
  const hasBasic = rbacPermissions?.includes(PERMISSIONS.METRICS_VIEW) || false;
  const hasAdvanced = rbacPermissions?.includes(PERMISSIONS.METRICS_VIEW_ADVANCED) || false;

  if (requireAdvanced) {
    // Advanced metrics require METRICS_VIEW_ADVANCED or METRICS_VIEW
    if (!hasAdvanced && !hasBasic) {
      // Double-check against database
      const hasAny = await userHasAnyPermission(rbacUserId, [
        PERMISSIONS.METRICS_VIEW_ADVANCED,
        PERMISSIONS.METRICS_VIEW,
      ]);
      if (!hasAny) {
        throw AppError.forbidden(
          `Permission '${PERMISSIONS.METRICS_VIEW_ADVANCED}' or '${PERMISSIONS.METRICS_VIEW}' required for this action`
        );
      }
    }
  } else {
    // Basic metrics require METRICS_VIEW
    if (!hasBasic) {
      // Double-check against database
      const hasPermission = await userHasPermission(rbacUserId, PERMISSIONS.METRICS_VIEW);
      if (!hasPermission) {
        throw AppError.forbidden(`Permission '${PERMISSIONS.METRICS_VIEW}' required for this action`);
      }
    }
  }
}

/**
 * GET /metrics/stats
 * Get system statistics
 */
metrics.get("/stats", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const service = c.get("service");

  const stats = await service.getSystemStats();

  return c.json({
    success: true,
    data: stats,
  });
});

/**
 * Other people's query text is shown only to users who may see all query
 * history: the rule of `routes/observe/access.ts:canSeeAllQueryText`, read
 * from the variables `optionalRbacMiddleware` sets for this router.
 */
function canSeeAllQueryText(c: Context<{ Variables: Variables }>): boolean {
  if (c.get("isRbacAdmin")) return true;
  return (c.get("rbacPermissions") ?? []).includes(PERMISSIONS.QUERY_HISTORY_VIEW_ALL);
}

/** `limit` query value as an integer in 1..100 (default 10). */
function recentLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(100, Math.max(1, parsed));
}

/**
 * GET /metrics/recent-queries
 * The newest queries on this connection, scoped on the server (#422):
 * - admins and `query:history:view:all` get `system.query_log` (everyone's);
 * - holders of `query:history:view` get only the queries they ran in
 *   CHouse UI on this connection, from their own query history;
 * - anyone else gets an empty list, so Home still renders.
 * `username` (a ClickHouse user) can only narrow the result, never widen it.
 */
metrics.get("/recent-queries", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const limit = recentLimit(c.req.query("limit"));
  const username = c.req.query("username") || undefined;

  if (canSeeAllQueryText(c)) {
    const queries = await c.get("service").getRecentQueries(limit, username);
    return c.json({ success: true, data: queries });
  }

  // Every query a user runs here goes out as the connection's ClickHouse user,
  // so asking for a different ClickHouse user can only match nothing.
  const session = c.get("session");
  const connectionId = session?.rbacConnectionId ?? c.get("rbacConnectionId");
  const canSeeOwn = (rbacPermissions ?? []).includes(PERMISSIONS.QUERY_HISTORY_VIEW);
  if (!canSeeOwn || !rbacUserId || !connectionId || (username && username !== session?.connectionConfig.username)) {
    return c.json({ success: true, data: [] });
  }
  const history = await listQueryHistory(rbacUserId, 100);
  const queries: RecentQuery[] = history
    .filter((item) => item.connectionId === connectionId)
    .slice(0, limit)
    .map((item) => ({
      query: item.query,
      duration: item.durationMs,
      status: item.status === "success" ? "Success" : "Error",
      time: new Date(item.executedAt).toISOString(),
    }));
  return c.json({ success: true, data: queries });
});

/**
 * GET /metrics/production
 * Get all production-grade metrics in one optimized call
 * @param interval - Time interval in minutes (default: 60)
 */
metrics.get("/production", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (advanced metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, true);

  const interval = parseInt(c.req.query("interval") || "60", 10);
  const service = c.get("service");

  const productionMetrics = await service.getProductionMetrics(Math.min(interval, 1440));

  return c.json({
    success: true,
    data: productionMetrics,
  });
});

/**
 * GET /metrics/latency
 * Get query latency percentiles
 * @param interval - Time interval in minutes (default: 60)
 */
metrics.get("/latency", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (advanced metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, true);

  const interval = parseInt(c.req.query("interval") || "60", 10);
  const service = c.get("service");

  const latency = await service.getQueryLatencyMetrics(Math.min(interval, 1440));

  return c.json({
    success: true,
    data: latency,
  });
});

/**
 * GET /metrics/disks
 * Get disk space usage metrics
 */
metrics.get("/disks", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const service = c.get("service");

  const disks = await service.getDiskMetrics();

  return c.json({
    success: true,
    data: disks,
  });
});

/**
 * GET /metrics/merges
 * Get merge and mutation metrics
 */
metrics.get("/merges", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const interval = parseInt(c.req.query("interval") || "60", 10);
  const service = c.get("service");

  const merges = await service.getMergeMetrics(Math.min(interval, 1440));

  return c.json({
    success: true,
    data: merges,
  });
});

/**
 * GET /metrics/replication
 * Get replication status for replicated tables
 */
metrics.get("/replication", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const service = c.get("service");

  const replication = await service.getReplicationMetrics();

  return c.json({
    success: true,
    data: replication,
  });
});

/**
 * GET /metrics/cache
 * Get cache hit ratio metrics
 */
metrics.get("/cache", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const service = c.get("service");

  const cache = await service.getCacheMetrics();

  return c.json({
    success: true,
    data: cache,
  });
});

/**
 * GET /metrics/resources
 * Get resource usage metrics (CPU, memory, threads)
 */
metrics.get("/resources", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const interval = parseInt(c.req.query("interval") || "60", 10);
  const service = c.get("service");

  const resources = await service.getResourceMetrics(Math.min(interval, 1440));

  return c.json({
    success: true,
    data: resources,
  });
});

/**
 * GET /metrics/errors
 * Get error breakdown by exception type
 * @param interval - Time interval in minutes (default: 60)
 */
metrics.get("/errors", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const interval = parseInt(c.req.query("interval") || "60", 10);
  const service = c.get("service");

  const errors = await service.getErrorMetrics(Math.min(interval, 1440));

  return c.json({
    success: true,
    data: errors,
  });
});

/**
 * GET /metrics/insert-throughput
 * Get insert throughput time series
 * @param interval - Time interval in minutes (default: 60)
 */
metrics.get("/insert-throughput", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const interval = parseInt(c.req.query("interval") || "60", 10);
  const service = c.get("service");

  const throughput = await service.getInsertThroughput(Math.min(interval, 1440));

  return c.json({
    success: true,
    data: throughput,
  });
});

/**
 * GET /metrics/parts-pressure
 * Per-table parts pressure: live part counts, worst-partition vs threshold, and
 * the insert-vs-merge race with a projected eta until "too many parts".
 * @param interval - Rate window in minutes (default: 10)
 */
metrics.get("/parts-pressure", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Advanced metrics: parts pressure exposes per-table operational internals.
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, true);

  const interval = parseInt(c.req.query("interval") || "10", 10);
  const service = c.get("service");

  const partsPressure = await service.getPartsPressure(Math.min(interval, 1440));

  return c.json({
    success: true,
    data: partsPressure,
  });
});

/**
 * POST /metrics/ddl/simulate
 * Read-only impact estimate for an ALTER … UPDATE/DELETE mutation. Parses the
 * statement (strict allowlist — only UPDATE/DELETE) and runs SELECT/metadata
 * queries to estimate affected rows, parts/bytes rewritten, duration, and disk.
 * NEVER executes the mutation.
 * Body: { statement: string }
 */
metrics.post("/ddl/simulate", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Advanced metrics: estimating mutation cost is an operational concern.
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, true);

  const body = await c.req.json().catch(() => ({}));
  const statement = typeof body?.statement === "string" ? body.statement : "";

  const { parseMutationStatement } = await import("../services/ddlSimulator");
  const parsed = parseMutationStatement(statement);
  if (!parsed.ok) {
    throw AppError.badRequest(parsed.error);
  }

  const service = c.get("service");
  const estimate = await service.getDdlImpact(parsed.value, service.defaultDatabase);

  return c.json({
    success: true,
    data: estimate,
  });
});

/**
 * GET /metrics/top-tables
 * Get top tables by size
 * @param limit - Number of tables to return (default: 10)
 */
metrics.get("/top-tables", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const limit = parseInt(c.req.query("limit") || "10", 10);
  const service = c.get("service");

  const tables = await service.getTopTablesBySize(Math.min(limit, 50));

  return c.json({
    success: true,
    data: tables,
  });
});

/**
 * GET /metrics/custom
 * Execute a custom metrics query
 */
metrics.get("/custom", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (advanced metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, true);

  const query = c.req.query("query");
  const service = c.get("service");

  if (!query) {
    return c.json({
      success: false,
      error: { code: "BAD_REQUEST", message: "Query parameter is required" },
    }, 400);
  }

  // Only allow SELECT queries for metrics
  if (!query.trim().toUpperCase().startsWith("SELECT")) {
    return c.json({
      success: false,
      error: { code: "BAD_REQUEST", message: "Only SELECT queries are allowed for metrics" },
    }, 400);
  }

  // The same data access rules as the SQL editor (ADR 0030): ClickHouse parses
  // exactly this text, and every table it reads must be allowed for this user.
  const access = await validateQueryAccess({
    userId: rbacUserId,
    isAdmin: isRbacAdmin,
    permissions: rbacPermissions,
    sql: query,
    connectionId: c.get("session")?.rbacConnectionId ?? c.get("rbacConnectionId"),
  });
  if (!access.allowed) throw accessDeniedError(access);
  if (access.statementType && access.statementType !== "select") {
    throw AppError.badRequest("Only SELECT queries are allowed for metrics");
  }

  const result = await service.executeQuery(query);

  return c.json({
    success: true,
    data: result,
  });
});

export default metrics;

