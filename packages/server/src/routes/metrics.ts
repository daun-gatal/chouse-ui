import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { ClickHouseService } from "../services/clickhouse";

const metrics = new Hono();

// All routes require authentication
metrics.use("*", authMiddleware);

/**
 * GET /metrics/stats
 * Get system statistics
 */
metrics.get("/stats", async (c) => {
  const service = c.get("service") as ClickHouseService;

  const stats = await service.getSystemStats();

  return c.json({
    success: true,
    data: stats,
  });
});

/**
 * GET /metrics/recent-queries
 * Get recent queries from query log
 */
metrics.get("/recent-queries", async (c) => {
  const limit = parseInt(c.req.query("limit") || "10", 10);
  const service = c.get("service") as ClickHouseService;

  const queries = await service.getRecentQueries(Math.min(limit, 100));

  return c.json({
    success: true,
    data: queries,
  });
});

/**
 * GET /metrics/custom
 * Execute a custom metrics query
 */
metrics.get("/custom", async (c) => {
  const query = c.req.query("query");
  const service = c.get("service") as ClickHouseService;

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

