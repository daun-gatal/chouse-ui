/**
 * Saved Queries Routes
 * 
 * API endpoints for managing saved SQL queries.
 * Queries are stored in the RBAC metadata database, scoped by user.
 * Queries can optionally be associated with a connection for filtering.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import type { ClickHouseService } from "../services/clickhouse";
import type { Session } from "../types";
import {
  getSavedQueries,
  getSavedQueryById,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
  getQueryConnectionNames,
} from "../rbac/services/savedQueries";

type Variables = {
  sessionId: string;
  service: ClickHouseService;
  session: Session;
};

const savedQueriesRouter = new Hono<{ Variables: Variables }>();

// All routes require authentication
savedQueriesRouter.use("*", authMiddleware);

// ============================================
// Schemas
// ============================================

const getQueriesSchema = z.object({
  connectionId: z.string().optional(), // Optional - filter by connection or get all
});

const createQuerySchema = z.object({
  connectionId: z.string().optional().nullable(), // Optional - null means shared across all connections
  connectionName: z.string().optional().nullable(), // Display name for the connection
  name: z.string().min(1, "Query name is required"),
  query: z.string().min(1, "Query content is required"),
  description: z.string().optional(),
  isPublic: z.boolean().optional().default(false),
});

const updateQuerySchema = z.object({
  name: z.string().min(1, "Query name is required").optional(),
  query: z.string().min(1, "Query content is required").optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
  connectionId: z.string().optional().nullable(),
  connectionName: z.string().optional().nullable(),
});

// ============================================
// Routes
// ============================================

/**
 * GET /saved-queries
 * Get all saved queries for the current user
 * Query params: connectionId (optional - filter by connection)
 */
savedQueriesRouter.get("/", zValidator("query", getQueriesSchema), async (c) => {
  const { connectionId } = c.req.valid("query");
  const session = c.get("session");

  if (!session.rbacUserId) {
    return c.json({
      success: false,
      error: { message: "User not authenticated with RBAC" },
    }, 401);
  }

  try {
    const queries = await getSavedQueries(session.rbacUserId, connectionId);

    return c.json({
      success: true,
      data: queries,
    });
  } catch (error) {
    console.error("[SavedQueries] Failed to fetch queries:", error);
    return c.json({
      success: false,
      error: { message: "Failed to fetch saved queries" },
    }, 500);
  }
});

/**
 * GET /saved-queries/connections
 * Get unique connection names from user's saved queries
 * Used for the connection filter dropdown
 */
savedQueriesRouter.get("/connections", async (c) => {
  const session = c.get("session");

  if (!session.rbacUserId) {
    return c.json({
      success: false,
      error: { message: "User not authenticated with RBAC" },
    }, 401);
  }

  try {
    const connectionNames = await getQueryConnectionNames(session.rbacUserId);

    return c.json({
      success: true,
      data: connectionNames,
    });
  } catch (error) {
    console.error("[SavedQueries] Failed to fetch connection names:", error);
    return c.json({
      success: false,
      error: { message: "Failed to fetch connection names" },
    }, 500);
  }
});

/**
 * GET /saved-queries/:id
 * Get a single saved query by ID
 */
savedQueriesRouter.get("/:id", async (c) => {
  const { id } = c.req.param();
  const session = c.get("session");

  if (!session.rbacUserId) {
    return c.json({
      success: false,
      error: { message: "User not authenticated with RBAC" },
    }, 401);
  }

  try {
    const query = await getSavedQueryById(id, session.rbacUserId);

    if (!query) {
      return c.json({
        success: false,
        error: { message: "Query not found" },
      }, 404);
    }

    return c.json({
      success: true,
      data: query,
    });
  } catch (error) {
    console.error("[SavedQueries] Failed to fetch query:", error);
    return c.json({
      success: false,
      error: { message: "Failed to fetch saved query" },
    }, 500);
  }
});

/**
 * POST /saved-queries
 * Create a new saved query
 * connectionId is optional - null means shared across all connections
 */
savedQueriesRouter.post("/", zValidator("json", createQuerySchema), async (c) => {
  const { connectionId, connectionName, name, query, description, isPublic } = c.req.valid("json");
  const session = c.get("session");

  if (!session.rbacUserId) {
    return c.json({
      success: false,
      error: { message: "User not authenticated with RBAC" },
    }, 401);
  }

  try {
    const savedQuery = await createSavedQuery(session.rbacUserId, {
      connectionId: connectionId ?? null,
      connectionName: connectionName ?? null,
      name,
      query,
      description,
      isPublic,
    });

    return c.json({
      success: true,
      data: savedQuery,
    });
  } catch (error) {
    console.error("[SavedQueries] Failed to create query:", error);
    return c.json({
      success: false,
      error: { message: "Failed to save query" },
    }, 500);
  }
});

/**
 * PUT /saved-queries/:id
 * Update an existing saved query
 */
savedQueriesRouter.put("/:id", zValidator("json", updateQuerySchema), async (c) => {
  const { id } = c.req.param();
  const input = c.req.valid("json");
  const session = c.get("session");

  if (!session.rbacUserId) {
    return c.json({
      success: false,
      error: { message: "User not authenticated with RBAC" },
    }, 401);
  }

  try {
    const updated = await updateSavedQuery(id, session.rbacUserId, input);

    if (!updated) {
      return c.json({
        success: false,
        error: { message: "Query not found or you don't have permission to update it" },
      }, 404);
    }

    return c.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("[SavedQueries] Failed to update query:", error);
    return c.json({
      success: false,
      error: { message: "Failed to update query" },
    }, 500);
  }
});

/**
 * DELETE /saved-queries/:id
 * Delete a saved query
 */
savedQueriesRouter.delete("/:id", async (c) => {
  const { id } = c.req.param();
  const session = c.get("session");

  if (!session.rbacUserId) {
    return c.json({
      success: false,
      error: { message: "User not authenticated with RBAC" },
    }, 401);
  }

  try {
    const deleted = await deleteSavedQuery(id, session.rbacUserId);

    if (!deleted) {
      return c.json({
        success: false,
        error: { message: "Query not found or you don't have permission to delete it" },
      }, 404);
    }

    return c.json({
      success: true,
      data: { message: "Query deleted successfully" },
    });
  } catch (error) {
    console.error("[SavedQueries] Failed to delete query:", error);
    return c.json({
      success: false,
      error: { message: "Failed to delete query" },
    }, 500);
  }
});

export default savedQueriesRouter;
