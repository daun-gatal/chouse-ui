import { Hono, Context, Next } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { Session, AppError } from "../types";
import { optionalRbacMiddleware, validateQueryAccess } from "../middleware/dataAccess";
import { getSession } from "../services/clickhouse";
import { getUserConnections, getConnectionWithPassword } from "../rbac/services/connections";
import { ClickHouseService } from "../services/clickhouse";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { userHasPermission } from "../rbac/services/rbac";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { getClientIp } from "../rbac/middleware/rbacAuth";
import { analyzeQuery } from "../services/queryAnalyzer";
import { debugQuery, checkQueryOptimization } from "../services/aiOptimizer";

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

const query = new Hono<{ Variables: Variables }>();

// Helper to get cookie value
function getCookie(c: Context, name: string): string | undefined {
  const cookies = c.req.header("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Hybrid auth middleware for query routes
 * Supports both ClickHouse session auth and RBAC auth
 */
async function queryAuthMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
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
      }, { rbacUserId });

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

// All routes require authentication (hybrid: session or RBAC)
query.use("*", queryAuthMiddleware);

// ============================================
// Helper Functions
// ============================================

/**
 * Check if SQL statement matches expected type
 */
function validateSqlType(sql: string, expectedTypes: string[]): boolean {
  const normalized = sql.trim().toUpperCase();
  return expectedTypes.some(type => normalized.startsWith(type));
}

/**
 * Detect if CREATE statement is for database or table
 */
function detectCreateTarget(sql: string): 'database' | 'table' | 'view' | 'other' {
  const normalized = sql.trim().toUpperCase();

  // CREATE DATABASE
  if (normalized.match(/^CREATE\s+(OR\s+REPLACE\s+)?DATABASE/i)) {
    return 'database';
  }

  // CREATE TABLE
  if (normalized.match(/^CREATE\s+(OR\s+REPLACE\s+)?TABLE/i)) {
    return 'table';
  }

  // CREATE VIEW
  if (normalized.match(/^CREATE\s+(OR\s+REPLACE\s+)?VIEW/i)) {
    return 'view';
  }

  // Other CREATE statements (INDEX, FUNCTION, etc.)
  return 'other';
}

/**
 * Detect if DROP statement is for database or table
 */
function detectDropTarget(sql: string): 'database' | 'table' | 'view' | 'other' {
  const normalized = sql.trim().toUpperCase();

  // DROP DATABASE
  if (normalized.match(/^DROP\s+(DATABASE|SCHEMA)/i)) {
    return 'database';
  }

  // DROP TABLE
  if (normalized.match(/^DROP\s+TABLE/i)) {
    return 'table';
  }

  // DROP VIEW
  if (normalized.match(/^DROP\s+VIEW/i)) {
    return 'view';
  }

  // Other DROP statements (INDEX, FUNCTION, etc.)
  return 'other';
}

/**
 * Check permission for database or table operation
 * No fallback permissions - strict enforcement of specific permissions
 */
async function checkDbOrTablePermission(
  rbacUserId: string | undefined,
  rbacPermissions: string[] | undefined,
  isRbacAdmin: boolean | undefined,
  operation: 'create' | 'drop' | 'alter',
  target: 'database' | 'table' | 'view' | 'other'
): Promise<void> {
  if (!rbacUserId) {
    throw AppError.unauthorized('RBAC authentication is required. Please login with RBAC credentials.');
  }

  if (isRbacAdmin) {
    return;
  }

  let requiredPermission: string;

  if (target === 'database') {
    if (operation === 'create') {
      requiredPermission = PERMISSIONS.DB_CREATE;
    } else if (operation === 'drop') {
      requiredPermission = PERMISSIONS.DB_DROP;
    } else {
      // ALTER DATABASE - use DB_CREATE as it's a DDL operation
      requiredPermission = PERMISSIONS.DB_CREATE;
    }
  } else if (target === 'table' || target === 'view') {
    if (operation === 'create') {
      requiredPermission = PERMISSIONS.TABLE_CREATE;
    } else if (operation === 'drop') {
      requiredPermission = PERMISSIONS.TABLE_DROP;
    } else {
      // ALTER TABLE/VIEW
      requiredPermission = PERMISSIONS.TABLE_ALTER;
    }
  } else {
    // Other operations (INDEX, FUNCTION, etc.) - require specific permission
    // For now, we'll require TABLE_ALTER as these are typically table-related
    // If needed, we can add more specific permissions later
    requiredPermission = PERMISSIONS.TABLE_ALTER;
  }

  // Check if user has the required permission
  if (rbacPermissions && rbacPermissions.includes(requiredPermission)) {
    return;
  }

  // Double-check against database (no fallback - strict enforcement)
  const hasPermission = await userHasPermission(rbacUserId, requiredPermission as any);
  if (!hasPermission) {
    throw AppError.forbidden(`Permission '${requiredPermission}' required for ${operation.toUpperCase()} ${target.toUpperCase()} operations`);
  }
}

/**
 * Permission check helper for query routes
 */
async function checkQueryPermission(
  rbacUserId: string | undefined,
  rbacPermissions: string[] | undefined,
  isRbacAdmin: boolean | undefined,
  requiredPermission: string
): Promise<void> {
  // RBAC user is required
  if (!rbacUserId) {
    throw AppError.unauthorized('RBAC authentication is required. Please login with RBAC credentials.');
  }

  // Admins have all permissions
  if (isRbacAdmin) {
    return;
  }

  // Check if user has the required permission
  if (rbacPermissions && rbacPermissions.includes(requiredPermission)) {
    return;
  }

  // Double-check against database (in case permissions changed)
  const hasPermission = await userHasPermission(rbacUserId, requiredPermission as any);
  if (!hasPermission) {
    throw AppError.forbidden(`Permission '${requiredPermission}' required for this action`);
  }
}

/**
 * Execute query with validation and audit logging
 */
async function executeQueryWithValidation(
  c: Context<{ Variables: Variables }>,
  sql: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated',
  operationType: string,
  queryId?: string
) {
  const service = c.get("service");
  const session = c.get("session");
  const rbacUserId = c.get("rbacUserId");
  const isRbacAdmin = c.get("isRbacAdmin");
  const rbacPermissions = c.get("rbacPermissions");
  const connectionId = session?.rbacConnectionId || c.get("rbacConnectionId");
  const defaultDatabase = session?.connectionConfig?.database;

  // Validate access before execution
  const accessCheck = await validateQueryAccess(
    rbacUserId,
    isRbacAdmin,
    rbacPermissions,
    sql,
    defaultDatabase,
    connectionId
  );

  if (!accessCheck.allowed) {
    const statementCount = sql.split(';').filter(s => s.trim().length > 0).length;
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

  const result = await service.executeQuery(sql, format, queryId);

  // Create audit log for query execution
  if (rbacUserId) {
    try {
      const logQueryId = queryId || `query_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      await createAuditLogWithContext(c, 
        AUDIT_ACTIONS.CH_QUERY_EXECUTE,
        rbacUserId,
        {
          resourceType: 'query',
          resourceId: logQueryId,
          details: {
            operationType,
            query: sql.substring(0, 500),
            queryLength: sql.length,
            format,
            connectionId,
            timestamp: Date.now(),
          },
          ipAddress: getClientIp(c),
          status: 'success',
        }
      );
    } catch (error) {
      console.error(`[Query/${operationType}] Failed to create audit log:`, error instanceof Error ? error.message : String(error));
    }
  }

  return c.json({
    success: true,
    data: result,
  });
}

// ============================================
// Schema Definitions
// ============================================

const QueryRequestSchemaWithType = z.object({
  query: z.string().min(1, "Query is required"),
  format: z.enum(["JSON", "JSONEachRow", "CSV", "TabSeparated"]).optional().default("JSON"),
  queryId: z.string().optional(),
});

const ExplainRequestSchema = z.object({
  query: z.string().min(1, "Query is required"),
  type: z.enum(["plan", "ast", "syntax", "pipeline", "estimate"]).optional().default("plan"),
});

/**
 * POST /query/execute
 * Generic endpoint for executing any SQL query
 * Validates access based on command type (SELECT, INSERT, CREATE, etc.)
 */
query.post("/execute", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");

  // Basic validation that we got a query
  if (!sql || !sql.trim()) {
    throw AppError.badRequest('Query is required');
  }

  // Determine query type for audit logging
  // Note: Detailed validation happens in executeQueryWithValidation -> validateQueryAccess
  const queryType = sql.trim().split(/\s+/)[0].toUpperCase();

  return executeQueryWithValidation(c, sql, format, queryType, queryId);
});

/**
 * POST /query/explain
 * Get Visual Explain Plan for a query
 * Supports multiple explain types: plan, ast, syntax, pipeline, estimate
 */
query.post("/explain", zValidator("json", ExplainRequestSchema), async (c) => {
  const { query: sql, type: explainType } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's a SELECT or compatible query
  // EXPLAIN only makes sense for queries that read data
  if (!validateSqlType(sql, ['SELECT', 'WITH'])) {
    throw AppError.badRequest('Explain plan is only available for SELECT or WITH queries.');
  }

  // Validate access for the underlying query
  // We check if the user has permission to execute the query they want to explain
  const accessCheck = await validateQueryAccess(
    rbacUserId,
    isRbacAdmin,
    rbacPermissions,
    sql,
    c.get("session")?.connectionConfig?.database,
    c.get("rbacConnectionId")
  );

  if (!accessCheck.allowed) {
    throw AppError.forbidden(accessCheck.reason || "Access denied to one or more tables in query");
  }

  const service = c.get("service");
  const plan = await service.getExplainPlan(sql, explainType);

  return c.json({
    success: true,
    data: plan,
  });
});

/**
 * POST /query/analyze
 * Analyze query complexity and get performance recommendations
 */
const AnalyzeRequestSchema = z.object({
  query: z.string().min(1, "Query is required"),
});

query.post("/analyze", zValidator("json", AnalyzeRequestSchema), async (c) => {
  const { query: sql } = c.req.valid("json");

  // Validate it's a SELECT or compatible query
  if (!validateSqlType(sql, ['SELECT', 'WITH'])) {
    throw AppError.badRequest('Query analysis is only available for SELECT or WITH queries.');
  }

  const analysis = analyzeQuery(sql);

  return c.json({
    success: true,
    data: analysis,
  });
});

/**
 * POST /query/debug
 * Debug a failed query using AI
 */
const DebugRequestSchema = z.object({
  query: z.string().min(1, "Query is required"),
  error: z.string().min(1, "Error message is required"),
  modelId: z.string().optional(),
});

query.post("/debug", zValidator("json", DebugRequestSchema), async (c) => {
  const { query: sql, error, modelId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check if AI Optimizer is enabled globally
  if (process.env.AI_OPTIMIZER_ENABLED !== 'true') {
    throw AppError.badRequest("AI Optimizer is not enabled on this server.");
  }

  // Check if user has permission to use AI features
  await checkQueryPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.AI_OPTIMIZE
  );

  // Validate it's a SELECT or compatible query
  // Debugging only makes sense for queries that are safe to run/analyze
  const result = await debugQuery(sql, error, [], undefined, modelId);

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * POST /query/check-optimization
 * Lightweight background check to see if optimization is worth pursuing
 */
const CheckOptimizationRequestSchema = z.object({
  query: z.string().min(1, "Query is required"),
  modelId: z.string().optional(),
});

query.post("/check-optimization", zValidator("json", CheckOptimizationRequestSchema), async (c) => {
  const { query: sql, modelId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check if AI Optimizer is enabled globally
  if (process.env.AI_OPTIMIZER_ENABLED !== 'true') {
    // Return success but with false result to handle gracefully
    return c.json({
      success: true,
      data: { canOptimize: false, reason: "AI Optimizer disabled" }
    });
  }

  // Check if user has permission
  await checkQueryPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.AI_OPTIMIZE
  );

  // NOTE: In a real implementation, we might want to fetch table schemas here 
  // similar to how full optimize works, but for speed we might skip it or keep it minimal.
  // The service supports passing table details. For now, we pass empty array or 
  // implementing schema fetching would be better.
  // Given we are inside a route that has access to 'service', we *could* fetch schemas.
  // But let's keep it fast for now as the prompt might discern just from SQL structure 
  // (e.g. SELECT * without LIMIT).

  const result = await checkQueryOptimization(sql, [], modelId);

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
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // RBAC user is required
  if (!rbacUserId) {
    throw AppError.unauthorized('RBAC authentication is required. Please login with RBAC credentials.');
  }

  // Check generic query permission (needed for intellisense)
  // We use QUERY_EXECUTE (read) as a baseline requirement
  if (!isRbacAdmin) {
    const hasPermission = rbacPermissions?.includes(PERMISSIONS.QUERY_EXECUTE) || false;
    if (!hasPermission) {
      // Double-check against database
      const hasDbPermission = await userHasPermission(rbacUserId, PERMISSIONS.QUERY_EXECUTE);
      if (!hasDbPermission) {
        throw AppError.forbidden(`Permission '${PERMISSIONS.QUERY_EXECUTE}' required for this action`);
      }
    }
  }

  const service = c.get("service");

  const data = await service.getIntellisenseData();

  return c.json({
    success: true,
    data,
  });
});

// ============================================
// Nested Routers for Table and Database Operations
// ============================================

const tableRouter = new Hono<{ Variables: Variables }>();
const databaseRouter = new Hono<{ Variables: Variables }>();

// ============================================
// Table Operations Routes
// ============================================

/**
 * POST /query/table/select
 * Execute SELECT queries from tables (read-only)
 * Permission: QUERY_EXECUTE or TABLE_SELECT
 */
tableRouter.post("/select", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually a SELECT query
  if (!validateSqlType(sql, ['SELECT', 'WITH'])) {
    throw AppError.badRequest('This endpoint only accepts SELECT queries. Please use the appropriate endpoint for your query type.');
  }

  // Check permission (QUERY_EXECUTE or TABLE_SELECT)
  const hasQueryExecute = rbacPermissions?.includes(PERMISSIONS.QUERY_EXECUTE) || false;
  const hasTableSelect = rbacPermissions?.includes(PERMISSIONS.TABLE_SELECT) || false;

  if (!isRbacAdmin && !hasQueryExecute && !hasTableSelect) {
    // Check against database
    const hasQueryPerm = await userHasPermission(rbacUserId!, PERMISSIONS.QUERY_EXECUTE);
    const hasSelectPerm = await userHasPermission(rbacUserId!, PERMISSIONS.TABLE_SELECT);

    if (!hasQueryPerm && !hasSelectPerm) {
      throw AppError.forbidden(`Permission '${PERMISSIONS.QUERY_EXECUTE}' or '${PERMISSIONS.TABLE_SELECT}' required for SELECT queries`);
    }
  }

  return executeQueryWithValidation(c, sql, format, 'SELECT', queryId);
});

/**
 * POST /query/table/insert
 * Execute INSERT statements into tables
 * Permission: TABLE_INSERT (strict - no fallback)
 */
tableRouter.post("/insert", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually an INSERT query
  if (!validateSqlType(sql, ['INSERT'])) {
    throw AppError.badRequest('This endpoint only accepts INSERT statements. Please use the appropriate endpoint for your query type.');
  }

  // Check permission (strict - no fallback)
  await checkQueryPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.TABLE_INSERT
  );

  return executeQueryWithValidation(c, sql, format, 'INSERT', queryId);
});

/**
 * POST /query/table/update
 * Execute UPDATE statements on tables
 * Permission: TABLE_UPDATE (strict - no fallback)
 */
tableRouter.post("/update", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually an UPDATE query
  if (!validateSqlType(sql, ['UPDATE'])) {
    throw AppError.badRequest('This endpoint only accepts UPDATE statements. Please use the appropriate endpoint for your query type.');
  }

  // Check permission (strict - no fallback)
  await checkQueryPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.TABLE_UPDATE
  );

  return executeQueryWithValidation(c, sql, format, 'UPDATE', queryId);
});

/**
 * POST /query/table/delete
 * Execute DELETE statements from tables
 * Permission: TABLE_DELETE (strict - no fallback)
 */
tableRouter.post("/delete", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually a DELETE query
  if (!validateSqlType(sql, ['DELETE'])) {
    throw AppError.badRequest('This endpoint only accepts DELETE statements. Please use the appropriate endpoint for your query type.');
  }

  // Check permission (strict - no fallback)
  await checkQueryPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.TABLE_DELETE
  );

  return executeQueryWithValidation(c, sql, format, 'DELETE', queryId);
});

/**
 * POST /query/table/create
 * Execute CREATE TABLE statements (DDL)
 * Permission: TABLE_CREATE (strict - no fallback)
 * Note: CREATE TABLE also has a specific route in /api/explorer/table
 */
tableRouter.post("/create", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually a CREATE TABLE query
  if (!validateSqlType(sql, ['CREATE'])) {
    throw AppError.badRequest('This endpoint only accepts CREATE statements. Please use the appropriate endpoint for your query type.');
  }

  // Validate it's CREATE TABLE (not CREATE DATABASE)
  const target = detectCreateTarget(sql);
  if (target !== 'table' && target !== 'view') {
    throw AppError.badRequest(`This endpoint only accepts CREATE TABLE/VIEW statements. Use /query/database/create for CREATE DATABASE.`);
  }

  // Check permission
  await checkDbOrTablePermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    'create',
    target
  );

  return executeQueryWithValidation(c, sql, format, `CREATE_${target.toUpperCase()}`, queryId);
});

/**
 * POST /query/table/drop
 * Execute DROP TABLE statements (DDL)
 * Permission: TABLE_DROP (strict - no fallback)
 * Note: DROP TABLE also has a specific route in /api/explorer/table/:database/:table
 */
tableRouter.post("/drop", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually a DROP query
  if (!validateSqlType(sql, ['DROP'])) {
    throw AppError.badRequest('This endpoint only accepts DROP statements. Please use the appropriate endpoint for your query type.');
  }

  // Validate it's DROP TABLE (not DROP DATABASE)
  const target = detectDropTarget(sql);
  if (target !== 'table' && target !== 'view') {
    throw AppError.badRequest(`This endpoint only accepts DROP TABLE/VIEW statements. Use /query/database/drop for DROP DATABASE.`);
  }

  // Check permission
  await checkDbOrTablePermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    'drop',
    target
  );

  return executeQueryWithValidation(c, sql, format, `DROP_${target.toUpperCase()}`, queryId);
});

/**
 * POST /query/table/alter
 * Execute ALTER TABLE statements (DDL)
 * Permission: TABLE_ALTER (strict - no fallback)
 */
tableRouter.post("/alter", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually an ALTER query
  if (!validateSqlType(sql, ['ALTER'])) {
    throw AppError.badRequest('This endpoint only accepts ALTER statements. Please use the appropriate endpoint for your query type.');
  }

  // Validate it's ALTER TABLE/VIEW (not ALTER DATABASE)
  const normalized = sql.trim().toUpperCase();
  let target: 'database' | 'table' | 'view' | 'other' = 'table';

  if (normalized.match(/^ALTER\s+(DATABASE|SCHEMA)/i)) {
    throw AppError.badRequest('This endpoint only accepts ALTER TABLE/VIEW statements. Use /query/database/alter for ALTER DATABASE.');
  } else if (normalized.match(/^ALTER\s+TABLE/i)) {
    target = 'table';
  } else if (normalized.match(/^ALTER\s+VIEW/i)) {
    target = 'view';
  } else {
    target = 'other';
  }

  // Check permission
  await checkDbOrTablePermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    'alter',
    target
  );

  return executeQueryWithValidation(c, sql, format, `ALTER_${target.toUpperCase()}`, queryId);
});

/**
 * POST /query/table/truncate
 * Execute TRUNCATE TABLE statements (DDL)
 * Permission: TABLE_DELETE (strict - no fallback)
 */
tableRouter.post("/truncate", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually a TRUNCATE query
  if (!validateSqlType(sql, ['TRUNCATE'])) {
    throw AppError.badRequest('This endpoint only accepts TRUNCATE statements. Please use the appropriate endpoint for your query type.');
  }

  // Check permission (TRUNCATE requires TABLE_DELETE - no fallback)
  await checkQueryPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.TABLE_DELETE
  );

  return executeQueryWithValidation(c, sql, format, 'TRUNCATE', queryId);
});

// ============================================
// Database Operations Routes
// ============================================

/**
 * POST /query/database/create
 * Execute CREATE DATABASE statements (DDL)
 * Permission: DB_CREATE (strict - no fallback)
 * Note: CREATE DATABASE also has a specific route in /api/explorer/database
 */
databaseRouter.post("/create", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format, queryId } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually a CREATE query
  if (!validateSqlType(sql, ['CREATE'])) {
    throw AppError.badRequest('This endpoint only accepts CREATE statements. Please use the appropriate endpoint for your query type.');
  }

  // Validate it's CREATE DATABASE (not CREATE TABLE)
  const target = detectCreateTarget(sql);
  if (target !== 'database') {
    throw AppError.badRequest(`This endpoint only accepts CREATE DATABASE statements. Use /query/table/create for CREATE TABLE/VIEW.`);
  }

  // Check permission
  await checkDbOrTablePermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    'create',
    target
  );

  return executeQueryWithValidation(c, sql, format, 'CREATE_DATABASE', queryId);
});

/**
 * POST /query/database/drop
 * Execute DROP DATABASE statements (DDL)
 * Permission: DB_DROP (strict - no fallback)
 * Note: DROP DATABASE also has a specific route in /api/explorer/database/:name
 */
databaseRouter.post("/drop", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually a DROP query
  if (!validateSqlType(sql, ['DROP'])) {
    throw AppError.badRequest('This endpoint only accepts DROP statements. Please use the appropriate endpoint for your query type.');
  }

  // Validate it's DROP DATABASE (not DROP TABLE)
  const target = detectDropTarget(sql);
  if (target !== 'database') {
    throw AppError.badRequest(`This endpoint only accepts DROP DATABASE statements. Use /query/table/drop for DROP TABLE/VIEW.`);
  }

  // Check permission
  await checkDbOrTablePermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    'drop',
    target
  );

  return executeQueryWithValidation(c, sql, format, 'DROP_DATABASE');
});

/**
 * POST /query/database/alter
 * Execute ALTER DATABASE statements (DDL)
 * Permission: DB_CREATE (strict - no fallback)
 */
databaseRouter.post("/alter", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually an ALTER query
  if (!validateSqlType(sql, ['ALTER'])) {
    throw AppError.badRequest('This endpoint only accepts ALTER statements. Please use the appropriate endpoint for your query type.');
  }

  // Validate it's ALTER DATABASE (not ALTER TABLE)
  const normalized = sql.trim().toUpperCase();
  if (!normalized.match(/^ALTER\s+(DATABASE|SCHEMA)/i)) {
    throw AppError.badRequest('This endpoint only accepts ALTER DATABASE statements. Use /query/table/alter for ALTER TABLE/VIEW.');
  }

  // Check permission
  await checkDbOrTablePermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    'alter',
    'database'
  );

  return executeQueryWithValidation(c, sql, format, 'ALTER_DATABASE');
});

// ============================================
// System/Utility Routes (at root level)
// ============================================

/**
 * POST /query/show
 * Execute SHOW queries (read-only system queries)
 * Permission: QUERY_EXECUTE or DB_VIEW / TABLE_VIEW
 */
query.post("/show", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's actually a SHOW query
  if (!validateSqlType(sql, ['SHOW'])) {
    throw AppError.badRequest('This endpoint only accepts SHOW queries. Please use the appropriate endpoint for your query type.');
  }

  // Check permission (QUERY_EXECUTE or view permissions)
  const hasQueryExecute = rbacPermissions?.includes(PERMISSIONS.QUERY_EXECUTE) || false;
  const hasDbView = rbacPermissions?.includes(PERMISSIONS.DB_VIEW) || false;
  const hasTableView = rbacPermissions?.includes(PERMISSIONS.TABLE_VIEW) || false;

  if (!isRbacAdmin && !hasQueryExecute && !hasDbView && !hasTableView) {
    const hasQueryPerm = await userHasPermission(rbacUserId!, PERMISSIONS.QUERY_EXECUTE);
    const hasDbPerm = await userHasPermission(rbacUserId!, PERMISSIONS.DB_VIEW);
    const hasTablePerm = await userHasPermission(rbacUserId!, PERMISSIONS.TABLE_VIEW);

    if (!hasQueryPerm && !hasDbPerm && !hasTablePerm) {
      throw AppError.forbidden(`Permission '${PERMISSIONS.QUERY_EXECUTE}', '${PERMISSIONS.DB_VIEW}', or '${PERMISSIONS.TABLE_VIEW}' required for SHOW queries`);
    }
  }

  return executeQueryWithValidation(c, sql, format, 'SHOW');
});

/**
 * POST /query/system
 * Execute system queries (read-only system information)
 * Permission: QUERY_EXECUTE
 */
query.post("/system", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, format } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Validate it's a system query (SHOW, SELECT from system tables, DESCRIBE)
  const normalized = sql.trim().toUpperCase();
  const isSystemQuery = normalized.startsWith('SHOW') ||
    normalized.startsWith('SELECT') ||
    normalized.startsWith('DESCRIBE') ||
    normalized.startsWith('DESC');

  if (!isSystemQuery) {
    throw AppError.badRequest('This endpoint only accepts system queries (SHOW, SELECT from system tables, DESCRIBE). Please use the appropriate endpoint for your query type.');
  }

  // Check permission
  await checkQueryPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.QUERY_EXECUTE
  );

  return executeQueryWithValidation(c, sql, format, 'SYSTEM');
});

// ============================================
// AI Query Optimizer
// ============================================

const OptimizeQuerySchema = z.object({
  query: z.string().min(1, "Query is required"),
  database: z.string().optional(),
  additionalPrompt: z.string().optional(),
  modelId: z.string().optional(),
});

query.post("/optimize", zValidator("json", OptimizeQuerySchema), async (c) => {
  const { query: sql, database, additionalPrompt, modelId } = c.req.valid("json");
  const service = c.get("service");
  const session = c.get("session");
  const rbacUserId = c.get("rbacUserId");
  const isRbacAdmin = c.get("isRbacAdmin");
  const rbacPermissions = c.get("rbacPermissions");
  const connectionId = session?.rbacConnectionId || c.get("rbacConnectionId");
  const defaultDatabase = database || session?.connectionConfig?.database;

  try {
    // Import AI optimizer service
    const { optimizeQuery, isOptimizerEnabled } = await import("../services/aiOptimizer");

    // Check if optimizer is enabled
    if (!(await isOptimizerEnabled())) {
      return c.json({
        success: false,
        error: {
          code: "FEATURE_DISABLED",
          message: "AI optimizer is not enabled. Please contact your administrator.",
        },
      }, 503 as any);
    }

    // Check AI optimizer permission
    await checkQueryPermission(
      rbacUserId,
      rbacPermissions,
      isRbacAdmin,
      PERMISSIONS.AI_OPTIMIZE
    );

    // Validate query type - only allow SELECT and WITH queries
    const trimmedQuery = sql.trim().toUpperCase();
    if (!trimmedQuery.startsWith("SELECT") && !trimmedQuery.startsWith("WITH")) {
      return c.json({
        success: false,
        error: {
          code: "INVALID_QUERY_TYPE",
          message: "AI optimizer only supports SELECT and WITH queries (read-only operations)",
        },
      }, 400 as any);
    }

    // Validate table access
    const accessCheck = await validateQueryAccess(
      rbacUserId,
      isRbacAdmin,
      rbacPermissions,
      sql,
      defaultDatabase,
      connectionId
    );

    if (!accessCheck.allowed) {
      return c.json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: accessCheck.reason || "Access denied to one or more tables in query",
        },
      }, 403 as any);
    }

    // Extract table names
    // @ts-ignore
    const { extractTablesFromQuery, extractTablesFromExplainEstimate } = await import("../middleware/dataAccess");
    let usedTables: { database: string; table: string }[] = [];

    // Try to get used tables from EXPLAIN ESTIMATE first as it's more accurate for views and underlying tables
    try {
      const explainEstimate = await service.getExplainPlan(sql, 'estimate');
      if (explainEstimate && explainEstimate.estimate) {
        usedTables = extractTablesFromExplainEstimate(explainEstimate.estimate);
      }
    } catch (error) {
      // If the error is a syntax error or missing identifier, abort optimization and report it to the user
      // This prevents confusion where the user sees a 500 error later
      const errorMessage = (error instanceof Error ? error.message : String(error)).toUpperCase();
      const isUserError = errorMessage.includes("UNKNOWN_IDENTIFIER") ||
        errorMessage.includes("SYNTAX_ERROR") ||
        errorMessage.includes("SYNTAX ERROR") ||
        errorMessage.includes("CANNOT BE RESOLVED") ||
        errorMessage.includes("UNKNOWN TABLE"); // ClickHouse user errors

      if (isUserError) {
        return c.json({
          success: false,
          error: {
            code: "INVALID_QUERY",
            message: `Optimization stopped: Your query contains errors. ${error instanceof Error ? error.message : String(error)}`,
          },
        }, 400 as any);
      }

      console.warn('Failed to get explain estimate for table extraction:', error);
    }

    // Fallback to regex-based extraction if estimate failed or returned nothing
    if (usedTables.length === 0) {
      const tables = extractTablesFromQuery(sql);
      usedTables = tables
        .filter((t): t is { database?: string; table: string } => !!t.table)
        .map(t => ({
          database: t.database || defaultDatabase || 'default',
          table: t.table
        }));
    }

    // Deduplicate tables
    const uniqueTables = new Map<string, { database: string; table: string }>();
    usedTables.forEach(t => {
      const db = t.database || defaultDatabase || 'default';
      if (t.table) {
        uniqueTables.set(`${db}.${t.table}`, { database: db, table: t.table });
      }
    });

    const tableDetails = await Promise.all(
      Array.from(uniqueTables.values()).map(async (tableRef) => {
        return service.getTableDetails(tableRef.database, tableRef.table).catch(() => null);
      })
    ).then(results => results.filter((r): r is Awaited<ReturnType<typeof service.getTableDetails>> => r !== null));

    // Call AI optimizer
    const result = await optimizeQuery(sql, tableDetails, additionalPrompt, modelId);

    // Create audit log
    if (rbacUserId) {
      try {
        await createAuditLogWithContext(c, 
          AUDIT_ACTIONS.CH_QUERY_EXECUTE,
          rbacUserId,
          {
            details: {
              action: 'ai_optimize',
              query: sql.substring(0, 1000),
              database: defaultDatabase,
              connectionId,
            },
            status: 'success',
          }
        );
      } catch (auditError) {
        console.error('[Query] Failed to create audit log:', auditError);
      }
    }

    return c.json({
      success: true,
      data: {
        originalQuery: result.originalQuery,
        optimizedQuery: result.optimizedQuery,
        explanation: result.explanation,
        summary: result.summary,
        tips: result.tips,
        warnings: accessCheck.warnings,
      },
    });
  } catch (error) {
    // Log error for debugging
    console.error('[Query] Optimization failed:', error instanceof Error ? error.message : String(error));

    // Create audit log for failure
    if (rbacUserId) {
      try {
        await createAuditLogWithContext(c, 
          AUDIT_ACTIONS.CH_QUERY_EXECUTE,
          rbacUserId,
          {
            details: {
              action: 'ai_optimize',
              query: sql.substring(0, 1000),
              database: defaultDatabase,
              connectionId,
            },
            status: 'failure',
            errorMessage: error instanceof Error ? error.message : String(error),
          }
        );
      } catch (auditError) {
        console.error('[Query] Failed to create audit log:', auditError);
      }
    }

    if (error instanceof AppError) {
      return c.json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      }, error.statusCode as any);
    }

    return c.json({
      success: false,
      error: {
        code: "OPTIMIZATION_FAILED",
        message: error instanceof Error ? error.message : "Failed to optimize query. Please try again or contact your administrator.",
      },
    }, 500 as 500);
  }
});

// ============================================
// Mount Nested Routers
// ============================================

query.route("/table", tableRouter);
query.route("/database", databaseRouter);

export default query;

