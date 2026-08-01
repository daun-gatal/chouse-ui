import { Hono, Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { AppError } from "../types";
import { validateQueryAccess } from "../middleware/dataAccess";
import { ClickHouseService } from "../services/clickhouse";
import {
  connectionContextMiddleware,
  type ConnectionContextVariables,
} from "../middleware/connectionContext";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { userHasPermission } from "../rbac/services/rbac";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { getClientIp } from "../rbac/middleware/rbacAuth";
import { requestLogger } from "../utils/logger";

export type Variables = ConnectionContextVariables;

const query = new Hono<{ Variables: Variables }>();

/**
 * Kept as a named export because /api/ai reuses it. It is now a thin alias for
 * the shared per-request connection context (ADR 0010).
 */
export const queryAuthMiddleware = connectionContextMiddleware;

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
  queryId?: string,
  maxResultRows?: number
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

  const result = await service.executeQuery(sql, format, queryId, maxResultRows);

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
      requestLogger(c.get("requestId")).error(
        { module: "Query", operationType, err: error instanceof Error ? error.message : String(error) },
        "Failed to create audit log"
      );
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
  /**
   * User-configured row cap.  0 = unlimited.  Absent = use server default.
   * Validated server-side: must be 0 (unlimited) or in [100, 100_000].
   */
  maxResultRows: z.number().int().min(0).max(100_000).optional(),
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
  const { query: sql, format, queryId, maxResultRows } = c.req.valid("json");
  const rbacUserId = c.get("rbacUserId");

  // Basic validation that we got a query
  if (!sql || !sql.trim()) {
    throw AppError.badRequest('Query is required');
  }

  // Determine query type for audit logging
  // Note: Detailed validation happens in executeQueryWithValidation -> validateQueryAccess
  const queryType = sql.trim().split(/\s+/)[0].toUpperCase();

  return executeQueryWithValidation(c, sql, format, queryType, queryId, maxResultRows);
});

/**
 * POST /query/execute-stream
 * Same as /execute but streams results as NDJSON so the browser can start
 * rendering rows before the full result set is transferred.
 *
 * Response format: application/x-ndjson, one JSON line per event:
 *   {"t":"m","names":[...],"types":[...],"qid":"..."}  ← meta (first)
 *   [value, value, ...]                                 ← compact row arrays
 *   {"t":"e","stats":{elapsed,rows_read,bytes_read},"rows":N}  ← end
 *   {"t":"err","message":"..."}                         ← error (last, if any)
 */
query.post("/execute-stream", zValidator("json", QueryRequestSchemaWithType), async (c) => {
  const { query: sql, queryId, maxResultRows } = c.req.valid("json");

  if (!sql || !sql.trim()) {
    throw AppError.badRequest("Query is required");
  }

  const service = c.get("service");
  const session = c.get("session");
  const rbacUserId = c.get("rbacUserId");
  const isRbacAdmin = c.get("isRbacAdmin");
  const rbacPermissions = c.get("rbacPermissions");
  const connectionId = session?.rbacConnectionId || c.get("rbacConnectionId");
  const defaultDatabase = session?.connectionConfig?.database;

  // RBAC access check — same as /execute
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
    }, 403);
  }

  // Audit log (best-effort, mirrors /execute)
  const logQueryId = queryId || `query_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  if (rbacUserId) {
    createAuditLogWithContext(c, AUDIT_ACTIONS.CH_QUERY_EXECUTE, rbacUserId, {
      resourceType: "query",
      resourceId: logQueryId,
      details: {
        operationType: sql.trim().split(/\s+/)[0].toUpperCase(),
        query: sql.substring(0, 500),
        queryLength: sql.length,
        format: "stream",
        connectionId,
        timestamp: Date.now(),
      },
      ipAddress: getClientIp(c),
      status: "success",
    }).catch((err: unknown) => {
      requestLogger(c.get("requestId")).error(
        { module: "Query", err: err instanceof Error ? err.message : String(err) },
        "Failed to create audit log for stream"
      );
    });
  }

  // Stream NDJSON directly to the browser
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const line of service.streamQueryRows(sql, logQueryId, maxResultRows)) {
          controller.enqueue(encoder.encode(line + "\n"));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        controller.enqueue(encoder.encode(JSON.stringify({ t: "err", message: msg }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no", // disable nginx/proxy buffering
    },
  });
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

  // Audit log (best-effort, mirrors /execute)
  if (rbacUserId) {
    createAuditLogWithContext(c, AUDIT_ACTIONS.CH_QUERY_EXPLAIN, rbacUserId, {
      resourceType: "query",
      details: {
        explainType,
        query: sql.substring(0, 500),
        queryLength: sql.length,
        connectionId: c.get("rbacConnectionId"),
        timestamp: Date.now(),
      },
      ipAddress: getClientIp(c),
      status: "success",
    }).catch((err: unknown) => {
      requestLogger(c.get("requestId")).error(
        { module: "Query", err: err instanceof Error ? err.message : String(err) },
        "Failed to create audit log for explain"
      );
    });
  }

  return c.json({
    success: true,
    data: plan,
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
// Mount Nested Routers
// ============================================

query.route("/table", tableRouter);
query.route("/database", databaseRouter);

export default query;

