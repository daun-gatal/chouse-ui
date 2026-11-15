/**
 * ADR 0033 migrations (every statement gets a ClickHouse identity). Forward
 * only and idempotent: a column is added only when it is missing, and a
 * backfill fills only what is empty.
 */

import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
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

async function hasColumn(db: RbacDb, table: string, column: string): Promise<boolean> {
  const found = getDatabaseType() === 'sqlite'
    ? await rows(db, sql`SELECT 1 FROM pragma_table_info(${table}) WHERE name = ${column}`)
    : await rows(db, sql`SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column}`);
  return found.length > 0;
}

export const CONNECTION_IDENTITY_MIGRATIONS: Migration[] = [
  {
    version: '1.76.0',
    name: 'scheduled_query_owner',
    description: 'ADR 0033 — scheduled_queries gains owner_id: the account a job runs as. It starts as the account that created the job. From now on, saving a change to what a job does makes the saver its owner; created_by keeps recording who created it.',
    up: async (db) => {
      if (!(await hasColumn(db, 'scheduled_queries', 'owner_id'))) {
        await exec(db, sql`ALTER TABLE scheduled_queries ADD COLUMN owner_id TEXT`);
      }
      // Not tied to the column being new: if a start-up died between the two
      // statements, the next one must still fill the column, or every job
      // would stop for lack of an owner. It only fills what is empty, so an
      // owner that changed is never overwritten.
      await exec(db, sql`UPDATE scheduled_queries SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL`);
      logger.info({ module: 'RBAC', phase: 'migration' }, '[Migration 1.76.0] Added scheduled_queries.owner_id and filled it from created_by');
    },
    down: async () => { /* forward-only */ },
  },
];
