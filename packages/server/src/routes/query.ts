import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { QueryRequestSchema, Session } from "../types";
import { authMiddleware } from "../middleware/auth";
import type { ClickHouseService } from "../services/clickhouse";

type Variables = {
  sessionId: string;
  service: ClickHouseService;
  session: Session;
};

const query = new Hono<{ Variables: Variables }>();

// All routes require authentication
query.use("*", authMiddleware);

/**
 * POST /query/execute
 * Execute a SQL query
 */
query.post("/execute", zValidator("json", QueryRequestSchema), async (c) => {
  const { query: sql, format } = c.req.valid("json");
  const service = c.get("service");

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
  const service = c.get("service");

  const data = await service.getIntellisenseData();

  return c.json({
    success: true,
    data,
  });
});

export default query;

