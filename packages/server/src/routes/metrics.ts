import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { ClickHouseService } from "../services/clickhouse";
import type { Session } from "../types";

type Variables = {
  sessionId: string;
  service: ClickHouseService;
  session: Session;
};

const metrics = new Hono<{ Variables: Variables }>();

// All routes require authentication
metrics.use("*", authMiddleware);

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

