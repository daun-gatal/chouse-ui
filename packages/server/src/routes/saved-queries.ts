import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import type { ClickHouseService } from "../services/clickhouse";

const savedQueries = new Hono();

// All routes require authentication
savedQueries.use("*", authMiddleware);

/**
 * GET /saved-queries/status
 * Check if saved queries feature is enabled
 */
savedQueries.get("/status", async (c) => {
  const service = c.get("service") as ClickHouseService;

  const isEnabled = await service.checkSavedQueriesEnabled();

  return c.json({
    success: true,
    data: { isEnabled },
  });
});

/**
 * POST /saved-queries/activate
 * Activate saved queries feature (admin only)
 */
savedQueries.post("/activate", adminMiddleware, async (c) => {
  const service = c.get("service") as ClickHouseService;

  await service.activateSavedQueries();

  return c.json({
    success: true,
    data: { message: "Saved queries activated successfully" },
  });
});

/**
 * POST /saved-queries/deactivate
 * Deactivate saved queries feature (admin only)
 */
savedQueries.post("/deactivate", adminMiddleware, async (c) => {
  const service = c.get("service") as ClickHouseService;

  await service.deactivateSavedQueries();

  return c.json({
    success: true,
    data: { message: "Saved queries deactivated successfully" },
  });
});

/**
 * GET /saved-queries
 * Get all saved queries
 */
savedQueries.get("/", async (c) => {
  const service = c.get("service") as ClickHouseService;

  const isEnabled = await service.checkSavedQueriesEnabled();
  if (!isEnabled) {
    return c.json({
      success: true,
      data: [],
    });
  }

  const queries = await service.getSavedQueries();

  return c.json({
    success: true,
    data: queries,
  });
});

/**
 * POST /saved-queries
 * Save a new query
 */
const saveQuerySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Query name is required"),
  query: z.string().min(1, "Query content is required"),
  isPublic: z.boolean().optional().default(false),
});

savedQueries.post("/", zValidator("json", saveQuerySchema), async (c) => {
  const { id, name, query, isPublic } = c.req.valid("json");
  const service = c.get("service") as ClickHouseService;

  await service.saveQuery(id, name, query, isPublic);

  return c.json({
    success: true,
    data: { message: "Query saved successfully" },
  });
});

/**
 * PUT /saved-queries/:id
 * Update a saved query
 */
const updateQuerySchema = z.object({
  name: z.string().min(1, "Query name is required"),
  query: z.string().min(1, "Query content is required"),
});

savedQueries.put("/:id", zValidator("json", updateQuerySchema), async (c) => {
  const { id } = c.req.param();
  const { name, query } = c.req.valid("json");
  const service = c.get("service") as ClickHouseService;

  await service.updateSavedQuery(id, name, query);

  return c.json({
    success: true,
    data: { message: "Query updated successfully" },
  });
});

/**
 * DELETE /saved-queries/:id
 * Delete a saved query
 */
savedQueries.delete("/:id", async (c) => {
  const { id } = c.req.param();
  const service = c.get("service") as ClickHouseService;

  await service.deleteSavedQuery(id);

  return c.json({
    success: true,
    data: { message: "Query deleted successfully" },
  });
});

export default savedQueries;

