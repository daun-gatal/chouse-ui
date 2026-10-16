/**
 * Issue #380 migrations: 1.57.0 adds the state that makes the `usage` and
 * `tables` collectors incremental, and per-run cost columns on
 * obs_collector_status. Schema only and idempotent: `IF NOT EXISTS` tables and
 * guarded column adds, so it applies cleanly on fresh, stepwise and
 * skip-version installs. The collectors fill the new tables themselves.
 */

import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { COLLECTOR_COST_COLUMNS, collectorLoadSchemaStatements } from './observeSchema';
import type { Migration } from './migrations';

type Row = Record<string, unknown>;

async function rows(db: RbacDb, statement: SQL): Promise<Row[]> {
  if (getDatabaseType() === 'sqlite') return (db as SqliteDb).all(statement) as Row[];
  const result = (await (db as PostgresDb).execute(statement)) as unknown;
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows?: Row[] }).rows ?? [];
}

async function exec(db: RbacDb, statement: SQL): Promise<void> {
  if (getDatabaseType() === 'sqlite') (db as SqliteDb).run(statement);
  else await (db as PostgresDb).execute(statement);
}

async function columnExists(db: RbacDb, table: string, column: string): Promise<boolean> {
  if (getDatabaseType() === 'sqlite') {
    const info = await rows(db, sql.raw(`PRAGMA table_info(${table})`));
    return info.some((r) => String(r.name) === column);
  }
  const found = await rows(db, sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}`);
  return found.length > 0;
}

export const COLLECTOR_LOAD_MIGRATIONS: Migration[] = [
  {
    version: '1.57.0',
    name: 'observe_collector_load',
    description: 'Issue #380 — obs_query_shape_days (daily SELECT-shape rollups) and obs_table_write_times (recent insert times) so the usage and tables collectors read only new system-log rows, plus read_rows / read_bytes / query_count on obs_collector_status for per-run cost.',
    up: async (db) => {
      const dialect = getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
      for (const statement of collectorLoadSchemaStatements(dialect)) {
        await exec(db, sql.raw(statement));
      }
      for (const column of COLLECTOR_COST_COLUMNS) {
        if (await columnExists(db, 'obs_collector_status', column.name)) continue;
        const type = column.type === 'REAL' ? (dialect === 'sqlite' ? 'REAL' : 'DOUBLE PRECISION') : (dialect === 'sqlite' ? 'INTEGER' : 'BIGINT');
        await exec(db, sql.raw(`ALTER TABLE obs_collector_status ADD COLUMN ${column.name} ${type}`));
      }
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.57.0] Added incremental collector state and per-run cost columns (${dialect})`);
    },
    down: async () => { /* forward-only */ },
  },
];
