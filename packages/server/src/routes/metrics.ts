import { Hono, Context, Next } from "hono";
import { optionalRbacMiddleware } from "../middleware/dataAccess";
import { getSession } from "../services/clickhouse";
import { getUserConnections, getConnectionWithPassword } from "../rbac/services/connections";
import { PERMISSIONS } from "../rbac/schema/base";
import { userHasPermission, userHasAnyPermission } from "../rbac/services/rbac";
import { ClickHouseService } from "../services/clickhouse";
import type { Session } from "../types";
import { AppError } from "../types";

type Variables = {
  sessionId?: string;
  service: ClickHouseService;
  session?: Session;
  rbacUserId?: string;
  rbacRoles?: string[];
  rbacPermissions?: string[];
  isRbacAdmin?: boolean;
  rbacConnectionId?: string;
};

const metrics = new Hono<{ Variables: Variables }>();

/**
 * Hybrid auth middleware for metrics
 * Supports both ClickHouse session auth and RBAC auth
 */
async function metricsAuthMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
  // First try ClickHouse session auth (but still require RBAC)
  const sessionId = c.req.header("X-Session-ID") || getCookie(c, "ch_session");

  if (sessionId) {
    const sessionData = getSession(sessionId);
    if (sessionData) {
      // Add RBAC context to validate session ownership
      await optionalRbacMiddleware(c, async () => { });

      const rbacUserId = c.get("rbacUserId");

      // If session has rbacUserId, validate ownership
      if (sessionData.session.rbacUserId) {
        if (!rbacUserId) {
          throw AppError.unauthorized("Authentication required to verify session ownership.");
        }
        if (sessionData.session.rbacUserId !== rbacUserId) {
          throw AppError.forbidden("Session does not belong to current user. Please reconnect.");
        }
      } else {
        // Legacy session without RBAC - require RBAC authentication
        if (!rbacUserId) {
          throw AppError.unauthorized('RBAC authentication is required. Please login with RBAC credentials.');
        }
      }

      c.set("sessionId", sessionId);
      c.set("service", sessionData.service);
      c.set("session", sessionData.session);
      await next();
      return;
    }
  }

  // If no ClickHouse session, try RBAC auth
  await optionalRbacMiddleware(c, async () => { });

  const rbacUserId = c.get("rbacUserId");
  const rbacRoles = c.get("rbacRoles");
  const isSuperAdmin = rbacRoles?.includes('super_admin') || false;

  if (rbacUserId) {
    let service: ClickHouseService | null = null;

    try {
      // Super admins get all active connections, regular users get their assigned connections
      let connections: Awaited<ReturnType<typeof getUserConnections>>;
      if (isSuperAdmin) {
        const { listConnections } = await import("../rbac/services/connections");
        const result = await listConnections({ activeOnly: true });
        connections = result.connections;
      } else {
        connections = await getUserConnections(rbacUserId);
      }

      if (connections.length === 0) {
        if (isSuperAdmin) {
          throw AppError.unauthorized("No ClickHouse connections are configured in the system. Please create a connection first.");
        }
        throw AppError.unauthorized("No ClickHouse connection configured. Please contact an administrator to grant you access to a ClickHouse connection.");
      }

      // Try to find default connection first, then any active connection
      const defaultConnection = connections.find((conn) => conn.isDefault && conn.isActive);
      const activeConnection = defaultConnection || connections.find((conn) => conn.isActive);

      if (!activeConnection) {
        if (isSuperAdmin) {
          throw AppError.unauthorized("No active ClickHouse connections found. Please activate a connection or create a new one.");
        }
        throw AppError.unauthorized("No active ClickHouse connection found. Please contact an administrator to activate a connection.");
      }

      // Get connection with password
      const connection = await getConnectionWithPassword(activeConnection.id);

      if (!connection) {
        throw AppError.unauthorized("Connection not found or access denied.");
      }

      // Build connection URL
      const protocol = connection.sslEnabled ? 'https' : 'http';
      const url = `${protocol}://${connection.host}:${connection.port}`;

      // Create ClickHouse service from connection
      service = new ClickHouseService({
        url,
        username: connection.username,
        password: connection.password || "",
        database: connection.database || undefined,
      });

      // Validating connection via ping is skipped for performance.
      // If the connection is invalid, subsequent queries will fail properly.

      // Create a temporary session ID for this request
      const tempSessionId = `rbac_${rbacUserId}_${Date.now()}`;

      // Create a temporary session-like object
      const session: Session = {
        id: tempSessionId,
        connectionConfig: {
          url,
          username: connection.username,
          password: connection.password || "",
          database: connection.database || undefined,
        },
        createdAt: new Date(),
        lastUsedAt: new Date(),
        isAdmin: false, // Will be determined by ClickHouse
        permissions: [],
        version: await service.getVersion(),
        rbacConnectionId: connection.id,
      };

      const adminStatus = await service.checkIsAdmin();
      session.isAdmin = adminStatus.isAdmin;
      session.permissions = adminStatus.permissions;

      c.set("service", service);
      c.set("session", session);
      c.set("rbacConnectionId", connection.id);

      await next();
      return;
    } catch (error) {
      // Service close is handled by ClientManager, no manual close needed here
      if (error instanceof AppError) {
        throw error;
      }
      throw AppError.unauthorized("Failed to authenticate with ClickHouse. Please connect to a ClickHouse server first.");
    }
  }

  // No authentication found
  throw AppError.unauthorized("No session provided. Please login first.");
}

// Helper to get cookie value
function getCookie(c: Context, name: string): string | undefined {
  const cookies = c.req.header("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// All routes require authentication (hybrid: session or RBAC)
metrics.use("*", metricsAuthMiddleware);

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
 * GET /metrics/recent-queries
 * Get recent queries from query log
 * @param limit - Number of queries to fetch
 * @param username - Optional username to filter by (for non-admin users)
 */
metrics.get("/recent-queries", async (c) => {
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check permission (basic metrics)
  await checkMetricsPermission(rbacUserId, rbacPermissions, isRbacAdmin, false);

  const limit = parseInt(c.req.query("limit") || "10", 10);
  const username = c.req.query("username");
  const service = c.get("service");

  const queries = await service.getRecentQueries(Math.min(limit, 100), username);

  return c.json({
    success: true,
    data: queries,
  });
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

  const result = await service.executeQuery(query);

  return c.json({
    success: true,
    data: result,
  });
});

export default metrics;

