import { Hono, Context, Next } from "hono";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { optionalRbacMiddleware } from "../middleware/dataAccess";
import { getSession } from "../services/clickhouse";
import { getUserConnections, getConnectionWithPassword } from "../rbac/services/connections";
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
  // First try ClickHouse session auth
  const sessionId = c.req.header("X-Session-ID") || getCookie(c, "ch_session");
  
  if (sessionId) {
    const sessionData = getSession(sessionId);
    if (sessionData) {
      c.set("sessionId", sessionId);
      c.set("service", sessionData.service);
      c.set("session", sessionData.session);
      await next();
      return;
    }
  }

  // If no ClickHouse session, try RBAC auth
  await optionalRbacMiddleware(c, async () => {});
  
  const rbacUserId = c.get("rbacUserId");
  
  if (rbacUserId) {
    let service: ClickHouseService | null = null;
    
    try {
      const connections = await getUserConnections(rbacUserId);
      
      if (connections.length === 0) {
        throw AppError.unauthorized("No ClickHouse connection configured. Please contact an administrator to grant you access to a ClickHouse connection.");
      }
      
      // Try to find default connection first, then any active connection
      const defaultConnection = connections.find((conn) => conn.isDefault && conn.isActive);
      const activeConnection = defaultConnection || connections.find((conn) => conn.isActive);
      
      if (!activeConnection) {
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

      // Test connection
      const isConnected = await service.ping();
      if (!isConnected) {
        await service.close();
        throw AppError.unauthorized("Failed to connect to ClickHouse server.");
      }

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
      
      try {
        await next();
      } finally {
        // Cleanup: Always close service after request completes (success or error)
        // Note: Service is used during the request, so we close it after next() completes
        if (service) {
          await service.close().catch((err) => {
            console.error('[Metrics] Failed to close service:', err);
          });
        }
      }
      return;
    } catch (error) {
      // Ensure service is closed on error
      if (service) {
        await service.close().catch((err) => {
          console.error('[Metrics] Failed to close service on error:', err);
        });
      }
      
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
 * GET /metrics/stats
 * Get system statistics
 */
metrics.get("/stats", async (c) => {
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
  const service = c.get("service");

  const merges = await service.getMergeMetrics();

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
  const service = c.get("service");

  const resources = await service.getResourceMetrics();

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

