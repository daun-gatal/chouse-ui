import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { QueryRequestSchema } from "../types";
import { authMiddleware } from "../middleware/auth";
import type { ClickHouseService } from "../services/clickhouse";

const query = new Hono();

// All routes require authentication
query.use("*", authMiddleware);

/**
 * POST /query/execute
 * Execute a SQL query
 */
query.post("/execute", zValidator("json", QueryRequestSchema), async (c) => {
  const { query: sql, format } = c.req.valid("json");
  const service = c.get("service") as ClickHouseService;

  const result = await service.executeQuery(sql, format);

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * GET /query/intellisense
 * Get intellisense data (columns, functions, keywords)
 */
query.get("/intellisense", async (c) => {
  const service = c.get("service") as ClickHouseService;

  const data = await service.getIntellisenseData();

  return c.json({
    success: true,
    data,
  });
});

export default query;

