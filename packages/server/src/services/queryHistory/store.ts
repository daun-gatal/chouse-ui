import { sql } from "drizzle-orm";

import { getDatabase, getDatabaseType, type PostgresDb, type SqliteDb } from "../../rbac/db";

export type QueryHistoryStatus = "success" | "error" | "cancelled";

export interface QueryHistoryRow {
  id: string;
  query: string;
  connectionId: string | null;
  connectionName: string | null;
  executedAt: number;
  durationMs: number;
  rows: number;
  status: QueryHistoryStatus;
  error?: string;
}

async function all(statement: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(statement) as Array<Record<string, unknown>>;
  }
  const result = await (db as PostgresDb).execute(statement);
  const wrapped = result as unknown as { rows?: Array<Record<string, unknown>> };
  return Array.isArray(result) ? result as unknown as Array<Record<string, unknown>> : wrapped.rows ?? [];
}

async function run(statement: ReturnType<typeof sql>): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(statement);
    return;
  }
  await (db as PostgresDb).execute(statement);
}

function toRow(row: Record<string, unknown>): QueryHistoryRow {
  const rawStatus = String(row.status);
  const status: QueryHistoryStatus = rawStatus === "error" || rawStatus === "cancelled" ? rawStatus : "success";
  return {
    id: String(row.id),
    query: String(row.query),
    connectionId: row.connection_id == null ? null : String(row.connection_id),
    connectionName: row.connection_name == null ? null : String(row.connection_name),
    executedAt: Number(row.executed_at),
    durationMs: Number(row.duration_ms),
    rows: Number(row.row_count),
    status,
    ...(row.error == null ? {} : { error: String(row.error) }),
  };
}

export async function listQueryHistory(userId: string, limit = 100): Promise<QueryHistoryRow[]> {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const rows = await all(sql`
    SELECT id, query, connection_id, connection_name, executed_at, duration_ms, row_count, status, error
    FROM rbac_query_history
    WHERE user_id = ${userId}
    ORDER BY executed_at DESC, id DESC
    LIMIT ${boundedLimit}
  `);
  return rows.map(toRow);
}

export async function recordQueryHistory(userId: string, item: QueryHistoryRow): Promise<void> {
  if (getDatabaseType() === "sqlite") {
    await run(sql`
      INSERT OR IGNORE INTO rbac_query_history
        (id, user_id, query, connection_id, connection_name, executed_at, duration_ms, row_count, status, error, created_at)
      VALUES
        (${item.id}, ${userId}, ${item.query}, ${item.connectionId}, ${item.connectionName}, ${item.executedAt}, ${item.durationMs}, ${item.rows}, ${item.status}, ${item.error ?? null}, ${Date.now()})
    `);
  } else {
    await run(sql`
      INSERT INTO rbac_query_history
        (id, user_id, query, connection_id, connection_name, executed_at, duration_ms, row_count, status, error, created_at)
      VALUES
        (${item.id}, ${userId}, ${item.query}, ${item.connectionId}, ${item.connectionName}, ${item.executedAt}, ${item.durationMs}, ${item.rows}, ${item.status}, ${item.error ?? null}, ${Date.now()})
      ON CONFLICT (id) DO NOTHING
    `);
  }
  await run(sql`
    DELETE FROM rbac_query_history
    WHERE user_id = ${userId}
      AND id IN (
        SELECT id FROM rbac_query_history
        WHERE user_id = ${userId}
        ORDER BY executed_at DESC, id DESC
        LIMIT 1000000 OFFSET 100
      )
  `);
}

export async function deleteQueryHistoryItem(userId: string, id: string): Promise<void> {
  await run(sql`DELETE FROM rbac_query_history WHERE user_id = ${userId} AND id = ${id}`);
}

export async function clearQueryHistory(userId: string): Promise<void> {
  await run(sql`DELETE FROM rbac_query_history WHERE user_id = ${userId}`);
}
