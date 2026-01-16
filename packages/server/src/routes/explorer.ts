import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, requirePermission } from "../middleware/auth";
import { 
  optionalRbacMiddleware, 
  filterDatabases, 
  filterTables,
  checkDatabaseAccess,
  checkTableAccess 
} from "../middleware/dataAccess";
import type { ClickHouseService } from "../services/clickhouse";
import type { Session } from "../types";

type Variables = {
  sessionId: string;
  service: ClickHouseService;
  session: Session;
  rbacUserId?: string;
  rbacRoles?: string[];
  rbacPermissions?: string[];
  isRbacAdmin?: boolean;
};

const explorer = new Hono<{ Variables: Variables }>();

// All routes require authentication + optional RBAC context for data access filtering
explorer.use("*", authMiddleware);
explorer.use("*", optionalRbacMiddleware);

/**
 * GET /explorer/databases
 * Get all databases and tables (filtered by user access)
 */
explorer.get("/databases", async (c) => {
  const service = c.get("service");
  const session = c.get("session");
  const rbacUserId = c.get("rbacUserId");
  const isRbacAdmin = c.get("isRbacAdmin");
  
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
  const isRbacAdmin = c.get("isRbacAdmin");
  const connectionId = session?.rbacConnectionId;

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
  const isRbacAdmin = c.get("isRbacAdmin");
  const connectionId = session?.rbacConnectionId;

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
  requirePermission("CREATE DATABASE"),
  zValidator("json", createDatabaseSchema),
  async (c) => {
    const { name, engine, cluster } = c.req.valid("json");
    const service = c.get("service");
    const session = c.get("session");

    let query = `CREATE DATABASE IF NOT EXISTS ${name}`;
    
    if (cluster) {
      query += ` ON CLUSTER ${cluster}`;
    }
    
    if (engine) {
      query += ` ENGINE = ${engine}`;
    }

    await service.executeQuery(query);

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
  requirePermission("DROP DATABASE"),
  async (c) => {
    const { name } = c.req.param();
    const service = c.get("service");

    await service.executeQuery(`DROP DATABASE IF EXISTS ${name}`);

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
  requirePermission("CREATE TABLE"),
  zValidator("json", createTableSchema),
  async (c) => {
    const { database, name, columns, engine, orderBy, partitionBy, primaryKey, cluster } = c.req.valid("json");
    const service = c.get("service");

    const columnDefs = columns
      .map((col) => {
        let def = `${col.name} ${col.type}`;
        if (col.default) def += ` DEFAULT ${col.default}`;
        if (col.comment) def += ` COMMENT '${col.comment.replace(/'/g, "''")}'`;
        return def;
      })
      .join(",\n  ");

    let query = `CREATE TABLE IF NOT EXISTS ${database}.${name}`;
    
    if (cluster) {
      query += ` ON CLUSTER ${cluster}`;
    }
    
    query += ` (\n  ${columnDefs}\n) ENGINE = ${engine}`;
    
    if (orderBy) query += `\nORDER BY ${orderBy}`;
    if (partitionBy) query += `\nPARTITION BY ${partitionBy}`;
    if (primaryKey) query += `\nPRIMARY KEY ${primaryKey}`;

    await service.executeQuery(query);

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
  requirePermission("DROP TABLE"),
  async (c) => {
    const { database, table } = c.req.param();
    const service = c.get("service");

    await service.executeQuery(`DROP TABLE IF EXISTS ${database}.${table}`);

    return c.json({
      success: true,
      data: { message: `Table '${database}.${table}' dropped successfully` },
    });
  }
);

export default explorer;

