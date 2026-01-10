import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { QueryRequestSchema, Session } from "../types";
import { authMiddleware } from "../middleware/auth";
import { optionalRbacMiddleware, validateQueryAccess } from "../middleware/dataAccess";
import type { ClickHouseService } from "../services/clickhouse";

type Variables = {
  sessionId: string;
  service: ClickHouseService;
  session: Session;
  rbacUserId?: string;
  rbacRoles?: string[];
  rbacPermissions?: string[];
  isRbacAdmin?: boolean;
};

const query = new Hono<{ Variables: Variables }>();

// All routes require authentication + optional RBAC for data access
query.use("*", authMiddleware);
query.use("*", optionalRbacMiddleware);

/**
 * POST /query/execute
 * Execute a SQL query (with access validation)
 */
query.post("/execute", zValidator("json", QueryRequestSchema), async (c) => {
  const { query: sql, format } = c.req.valid("json");
  const service = c.get("service");
  const session = c.get("session");
  const rbacUserId = c.get("rbacUserId");
  const isRbacAdmin = c.get("isRbacAdmin");
  const rbacPermissions = c.get("rbacPermissions");
  
  // Get RBAC connection ID from session for data access filtering
  const connectionId = session?.rbacConnectionId;

  // Validate access before execution
  // Advanced validation: splits multi-statement queries and validates each statement individually
  // 1. Checks role permissions for the operation type (read/write/admin) per statement
  // 2. Checks data access rules for the specific databases/tables per statement
  // This prevents security vulnerabilities like: SELECT * FROM table; DROP TABLE sensitive_data;
  const accessCheck = await validateQueryAccess(
    rbacUserId,
    isRbacAdmin,
    rbacPermissions,
    sql,
    session.connectionConfig.database,
    connectionId
  );

  if (!accessCheck.allowed) {
    const statementCount = sql.split(';').filter(s => s.trim().length > 0).length;
    console.log('[Query] Access denied:', {
      userId: rbacUserId,
      statementCount: statementCount > 1 ? statementCount : undefined,
      statementIndex: accessCheck.statementIndex,
      sql: sql.substring(0, 200),
      reason: accessCheck.reason,
    });
    return c.json({
      success: false,
      error: { 
        code: "FORBIDDEN", 
        message: accessCheck.reason || "Access denied to one or more tables in query",
        ...(accessCheck.statementIndex !== undefined && { 
          statementIndex: accessCheck.statementIndex,
          hint: statementCount > 1 ? "Multi-statement queries require all statements to pass validation" : undefined
        })
      },
    }, 403);
  }

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

