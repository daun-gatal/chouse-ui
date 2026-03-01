import { Hono, Context, Next } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  optionalRbacMiddleware,
  filterDatabases,
  filterTables,
  checkDatabaseAccess,
  checkTableAccess
} from "../middleware/dataAccess";
import { PERMISSIONS, AUDIT_ACTIONS } from "../rbac/schema/base";
import { userHasPermission, createAuditLogWithContext } from "../rbac/services/rbac";
import { AppError } from "../types";
import { ClickHouseService } from "../services/clickhouse";
import { getSession } from "../services/clickhouse";
import { getUserConnections, getConnectionWithPassword } from "../rbac/services/connections";
import type { Session } from "../types";
import { escapeIdentifier, escapeQualifiedIdentifier, validateColumnType, validateFormat } from "../utils/sqlIdentifier";

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

const explorer = new Hono<{ Variables: Variables }>();

// Helper to get cookie value
function getCookie(c: Context, name: string): string | undefined {
  const cookies = c.req.header("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Hybrid auth middleware for explorer routes
 * Supports both ClickHouse session auth and RBAC auth
 */
async function explorerAuthMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
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
          // If we have a session but no RBAC user, it means the RBAC token is missing/expired.
          // We return 401 so the client interprets it as an auth failure and tries to refresh/logout.
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
      });

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
explorer.use("*", explorerAuthMiddleware);

/**
 * Permission check helper for explorer routes
 * Requires RBAC authentication
 */
async function checkExplorerPermission(
  rbacUserId: string | undefined,
  rbacPermissions: string[] | undefined,
  isRbacAdmin: boolean | undefined,
  permission: string
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
  if (rbacPermissions && rbacPermissions.includes(permission)) {
    return;
  }

  // Double-check against database (in case permissions changed)
  const hasPermission = await userHasPermission(rbacUserId, permission as any);
  if (!hasPermission) {
    throw AppError.forbidden(`Permission '${permission}' required for this action`);
  }
}

/**
 * GET /explorer/databases
 * Get all databases and tables (filtered by user access)
 */
explorer.get("/databases", async (c) => {
  const service = c.get("service");
  const session = c.get("session");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");

  // Check RBAC permission for viewing databases/tables
  await checkExplorerPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.DB_VIEW
  );

  // Get the RBAC connection ID from the session (if session was created from RBAC connection)
  const connectionId = session?.rbacConnectionId;

  // Debug logging
  console.log('[Explorer] Data access context:', {
    rbacUserId,
    isRbacAdmin,
    connectionId,
    hasSession: !!session,
  });

  // For RBAC users, check if they have a connection assigned
  // If no connection is assigned, return empty array (don't show any databases)
  if (rbacUserId && !isRbacAdmin) {
    const { getUserConnections } = await import('../rbac/services/connections');
    const userConnections = await getUserConnections(rbacUserId);

    // If user has no connections assigned, return empty
    if (userConnections.length === 0) {
      console.log(`[Explorer] User ${rbacUserId} has no connections assigned - returning empty`);
      return c.json({
        success: true,
        data: [],
      });
    }

    // If connectionId is set but user doesn't have access to it, return empty
    if (connectionId && !userConnections.some(conn => conn.id === connectionId)) {
      console.log(`[Explorer] User ${rbacUserId} doesn't have access to connection ${connectionId} - returning empty`);
      return c.json({
        success: true,
        data: [],
      });
    }
  }

  // Get all databases and tables from ClickHouse
  const allDatabases = await service.getDatabasesAndTables();

  // Filter based on data access rules
  const databaseNames = allDatabases.map((db: { name: string }) => db.name);
  console.log('[Explorer] All databases:', databaseNames);
  const allowedDatabases = await filterDatabases(rbacUserId, isRbacAdmin, databaseNames, connectionId);
  console.log('[Explorer] Allowed databases:', allowedDatabases);

  // Filter the database list and their tables
  const filteredDatabases = await Promise.all(
    allDatabases
      .filter((db: { name: string }) => allowedDatabases.includes(db.name))
      .map(async (db: { name: string; children: { name: string }[] }) => {
        // Filter tables within each database
        const tableNames = db.children.map((t) => t.name);
        const allowedTables = await filterTables(rbacUserId, isRbacAdmin, db.name, tableNames, connectionId);

        return {
          ...db,
          children: db.children.filter((t) => allowedTables.includes(t.name)),
        };
      })
  );

  console.log('[Explorer] Returning databases:', filteredDatabases.map((db: any) => db.name));

  return c.json({
    success: true,
    data: filteredDatabases,
  });
});

/**
 * GET /explorer/table/:database/:table
 * Get table details (with access check)
 */
explorer.get("/table/:database/:table", async (c) => {
  const { database, table } = c.req.param();
  const service = c.get("service");
  const session = c.get("session");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");
  const connectionId = session?.rbacConnectionId;

  // Check RBAC permission for viewing tables
  await checkExplorerPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.TABLE_VIEW
  );

  // Validate identifiers
  try {
    escapeIdentifier(database);
    escapeIdentifier(table);
  } catch (error) {
    return c.json({
      success: false,
      error: { code: "INVALID_INPUT", message: `Invalid identifier: ${(error as Error).message}` },
    }, 400);
  }

  // Check access
  const hasAccess = await checkTableAccess(rbacUserId, isRbacAdmin, database, table, connectionId);
  if (!hasAccess) {
    return c.json({
      success: false,
      error: { code: "FORBIDDEN", message: `Access denied to ${database}.${table}` },
    }, 403);
  }

  const details = await service.getTableDetails(database, table);

  return c.json({
    success: true,
    data: details,
  });
});

/**
 * GET /explorer/table/:database/:table/sample
 * Get table data sample (with access check)
 */
explorer.get("/table/:database/:table/sample", async (c) => {
  const { database, table } = c.req.param();
  const limit = parseInt(c.req.query("limit") || "100", 10);
  const service = c.get("service");
  const session = c.get("session");
  const rbacUserId = c.get("rbacUserId");
  const rbacPermissions = c.get("rbacPermissions");
  const isRbacAdmin = c.get("isRbacAdmin");
  const connectionId = session?.rbacConnectionId;

  // Check RBAC permission for selecting table data
  await checkExplorerPermission(
    rbacUserId,
    rbacPermissions,
    isRbacAdmin,
    PERMISSIONS.TABLE_SELECT
  );

  // Validate identifiers
  try {
    escapeIdentifier(database);
    escapeIdentifier(table);
  } catch (error) {
    return c.json({
      success: false,
      error: { code: "INVALID_INPUT", message: `Invalid identifier: ${(error as Error).message}` },
    }, 400);
  }

  // Check access
  const hasAccess = await checkTableAccess(rbacUserId, isRbacAdmin, database, table, connectionId);
  if (!hasAccess) {
    return c.json({
      success: false,
      error: { code: "FORBIDDEN", message: `Access denied to ${database}.${table}` },
    }, 403);
  }

  const sample = await service.getTableSample(database, table, Math.min(limit, 1000));

  return c.json({
    success: true,
    data: sample,
  });
});

/**
 * POST /explorer/database
 * Create a new database
 */
const createDatabaseSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid database name"),
  engine: z.string().optional(),
  cluster: z.string().optional(),
});

explorer.post(
  "/database",
  zValidator("json", createDatabaseSchema),
  async (c) => {
    const rbacUserId = c.get("rbacUserId");
    const rbacPermissions = c.get("rbacPermissions");
    const isRbacAdmin = c.get("isRbacAdmin");

    // Check RBAC permission
    await checkExplorerPermission(
      rbacUserId,
      rbacPermissions,
      isRbacAdmin,
      PERMISSIONS.DB_CREATE
    );
    const { name, engine, cluster } = c.req.valid("json");
    const service = c.get("service");

    // Validate and escape identifiers
    let escapedName: string;
    let escapedCluster: string | undefined;
    try {
      escapedName = escapeIdentifier(name);
      if (cluster) {
        escapedCluster = escapeIdentifier(cluster);
      }
    } catch (error) {
      return c.json({
        success: false,
        error: { code: "INVALID_INPUT", message: `Invalid identifier: ${(error as Error).message}` },
      }, 400);
    }

    let query = `CREATE DATABASE IF NOT EXISTS ${escapedName}`;

    if (escapedCluster) {
      query += ` ON CLUSTER ${escapedCluster}`;
    }

    if (engine) {
      // Engine names should also be validated, but for now we'll escape it
      // Note: Engine names in ClickHouse can contain special characters, so this is a basic check
      const escapedEngine = engine.replace(/[`;]/g, '');
      query += ` ENGINE = ${escapedEngine}`;
    }

    await service.executeQuery(query);

    // Audit log
    try {
      await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_DATABASE_CREATE, rbacUserId, {
        resourceType: 'database',
        resourceId: name,
        details: { operation: 'create', database: name, engine, cluster },
        ipAddress: c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      });
    } catch (auditError) {
      console.error('[Explorer] Failed to create audit log:', auditError);
    }

    return c.json({
      success: true,
      data: { message: `Database '${name}' created successfully` },
    });
  }
);

/**
 * DELETE /explorer/database/:name
 * Drop a database
 */
explorer.delete(
  "/database/:name",
  async (c) => {
    const rbacUserId = c.get("rbacUserId");
    const rbacPermissions = c.get("rbacPermissions");
    const isRbacAdmin = c.get("isRbacAdmin");

    // Check RBAC permission
    await checkExplorerPermission(
      rbacUserId,
      rbacPermissions,
      isRbacAdmin,
      PERMISSIONS.DB_DROP
    );
    const { name } = c.req.param();
    const service = c.get("service");

    // Validate and escape identifier
    let escapedName: string;
    try {
      escapedName = escapeIdentifier(name);
    } catch (error) {
      return c.json({
        success: false,
        error: { code: "INVALID_INPUT", message: `Invalid identifier: ${(error as Error).message}` },
      }, 400);
    }

    await service.executeQuery(`DROP DATABASE IF EXISTS ${escapedName}`);

    // Audit log
    try {
      await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_DATABASE_DROP, rbacUserId, {
        resourceType: 'database',
        resourceId: name,
        details: { operation: 'drop', database: name },
        ipAddress: c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      });
    } catch (auditError) {
      console.error('[Explorer] Failed to create audit log:', auditError);
    }

    return c.json({
      success: true,
      data: { message: `Database '${name}' dropped successfully` },
    });
  }
);

/**
 * POST /explorer/table
 * Create a new table
 */
const createTableSchema = z.object({
  database: z.string().min(1),
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid table name"),
  columns: z.array(z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    default: z.string().optional(),
    comment: z.string().optional(),
  })).min(1),
  engine: z.string().default("MergeTree()"),
  orderBy: z.string().optional(),
  partitionBy: z.string().optional(),
  primaryKey: z.string().optional(),
  cluster: z.string().optional(),
});

explorer.post(
  "/table",
  zValidator("json", createTableSchema),
  async (c) => {
    const rbacUserId = c.get("rbacUserId");
    const rbacPermissions = c.get("rbacPermissions");
    const isRbacAdmin = c.get("isRbacAdmin");

    // Check RBAC permission
    await checkExplorerPermission(
      rbacUserId,
      rbacPermissions,
      isRbacAdmin,
      PERMISSIONS.TABLE_CREATE
    );
    const { database, name, columns, engine, orderBy, partitionBy, primaryKey, cluster } = c.req.valid("json");
    const service = c.get("service");

    // Validate and escape identifiers
    let escapedDatabase: string;
    let escapedName: string;
    let escapedCluster: string | undefined;
    try {
      escapedDatabase = escapeIdentifier(database);
      escapedName = escapeIdentifier(name);
      if (cluster) {
        escapedCluster = escapeIdentifier(cluster);
      }
    } catch (error) {
      return c.json({
        success: false,
        error: { code: "INVALID_INPUT", message: `Invalid identifier: ${(error as Error).message}` },
      }, 400);
    }

    // Validate and escape column definitions
    const columnDefs = columns
      .map((col) => {
        // Validate column name
        let escapedColName: string;
        try {
          escapedColName = escapeIdentifier(col.name);
        } catch (error) {
          throw new Error(`Invalid column name "${col.name}": ${(error as Error).message}`);
        }

        // Validate column type
        if (!validateColumnType(col.type)) {
          throw new Error(`Invalid column type "${col.type}" for column "${col.name}"`);
        }

        let def = `${escapedColName} ${col.type}`;

        // Escape default value (if it's a string literal)
        if (col.default) {
          // For string defaults, escape single quotes
          const escapedDefault = col.default.replace(/'/g, "''");
          def += ` DEFAULT '${escapedDefault}'`;
        }

        // Escape comment
        if (col.comment) {
          const escapedComment = col.comment.replace(/'/g, "''");
          def += ` COMMENT '${escapedComment}'`;
        }

        return def;
      })
      .join(",\n  ");

    let query = `CREATE TABLE IF NOT EXISTS ${escapedDatabase}.${escapedName}`;

    if (escapedCluster) {
      query += ` ON CLUSTER ${escapedCluster}`;
    }

    query += ` (\n  ${columnDefs}\n) ENGINE = ${engine}`;

    // Validate and escape ORDER BY, PARTITION BY, PRIMARY KEY
    if (orderBy) {
      // ORDER BY can contain multiple columns, so we need to parse and escape each
      const orderByParts = orderBy.split(',').map(s => s.trim());
      const escapedOrderBy = orderByParts.map(part => {
        try {
          return escapeIdentifier(part);
        } catch {
          // If it's not a simple identifier, it might be an expression - validate it doesn't contain SQL injection
          if (/[;`'"]/.test(part)) {
            throw new Error(`Invalid ORDER BY expression: contains dangerous characters`);
          }
          return part;
        }
      }).join(', ');
      query += `\nORDER BY ${escapedOrderBy}`;
    }

    if (partitionBy) {
      // Similar validation for PARTITION BY
      if (/[;`'"]/.test(partitionBy)) {
        return c.json({
          success: false,
          error: { code: "INVALID_INPUT", message: "Invalid PARTITION BY expression: contains dangerous characters" },
        }, 400);
      }
      query += `\nPARTITION BY ${partitionBy}`;
    }

    if (primaryKey) {
      // Similar validation for PRIMARY KEY
      if (/[;`'"]/.test(primaryKey)) {
        return c.json({
          success: false,
          error: { code: "INVALID_INPUT", message: "Invalid PRIMARY KEY expression: contains dangerous characters" },
        }, 400);
      }
      query += `\nPRIMARY KEY ${primaryKey}`;
    }

    await service.executeQuery(query);

    // Audit log
    try {
      await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_TABLE_CREATE, rbacUserId, {
        resourceType: 'table',
        resourceId: `${database}.${name}`,
        details: { operation: 'create', database, table: name, engine, columnCount: columns.length },
        ipAddress: c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      });
    } catch (auditError) {
      console.error('[Explorer] Failed to create audit log:', auditError);
    }

    return c.json({
      success: true,
      data: { message: `Table '${database}.${name}' created successfully` },
    });
  }
);

/**
 * DELETE /explorer/table/:database/:table
 * Drop a table
 */
explorer.delete(
  "/table/:database/:table",
  async (c) => {
    const rbacUserId = c.get("rbacUserId");
    const rbacPermissions = c.get("rbacPermissions");
    const isRbacAdmin = c.get("isRbacAdmin");

    // Check RBAC permission
    await checkExplorerPermission(
      rbacUserId,
      rbacPermissions,
      isRbacAdmin,
      PERMISSIONS.TABLE_DROP
    );
    const { database, table } = c.req.param();
    const service = c.get("service");

    // Validate and escape identifiers
    let escapedDatabase: string;
    let escapedTable: string;
    try {
      escapedDatabase = escapeIdentifier(database);
      escapedTable = escapeIdentifier(table);
    } catch (error) {
      return c.json({
        success: false,
        error: { code: "INVALID_INPUT", message: `Invalid identifier: ${(error as Error).message}` },
      }, 400);
    }

    await service.executeQuery(`DROP TABLE IF EXISTS ${escapedDatabase}.${escapedTable}`);

    // Audit log
    try {
      await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_TABLE_DROP, rbacUserId, {
        resourceType: 'table',
        resourceId: `${database}.${table}`,
        details: { operation: 'drop', database, table },
        ipAddress: c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      });
    } catch (auditError) {
      console.error('[Explorer] Failed to create audit log:', auditError);
    }

    return c.json({
      success: true,
      data: { message: `Table '${database}.${table}' dropped successfully` },
    });
  }
);

export default explorer;

