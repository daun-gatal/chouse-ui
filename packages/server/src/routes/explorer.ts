import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, requirePermission } from "../middleware/auth";
import type { ClickHouseService } from "../services/clickhouse";

const explorer = new Hono();

// All routes require authentication
explorer.use("*", authMiddleware);

/**
 * GET /explorer/databases
 * Get all databases and tables
 */
explorer.get("/databases", async (c) => {
  const service = c.get("service") as ClickHouseService;

  const databases = await service.getDatabasesAndTables();

  return c.json({
    success: true,
    data: databases,
  });
});

/**
 * GET /explorer/table/:database/:table
 * Get table details
 */
explorer.get("/table/:database/:table", async (c) => {
  const { database, table } = c.req.param();
  const service = c.get("service") as ClickHouseService;

  const details = await service.getTableDetails(database, table);

  return c.json({
    success: true,
    data: details,
  });
});

/**
 * GET /explorer/table/:database/:table/sample
 * Get table data sample
 */
explorer.get("/table/:database/:table/sample", async (c) => {
  const { database, table } = c.req.param();
  const limit = parseInt(c.req.query("limit") || "100", 10);
  const service = c.get("service") as ClickHouseService;

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
    const service = c.get("service") as ClickHouseService;
    const session = c.get("session") as import("../types").Session;

    let query = `CREATE DATABASE IF NOT EXISTS ${name}`;
    
    if (cluster && session.connectionConfig.database) {
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
    const service = c.get("service") as ClickHouseService;

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
    const service = c.get("service") as ClickHouseService;

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
    const service = c.get("service") as ClickHouseService;

    await service.executeQuery(`DROP TABLE IF EXISTS ${database}.${table}`);

    return c.json({
      success: true,
      data: { message: `Table '${database}.${table}' dropped successfully` },
    });
  }
);

export default explorer;

