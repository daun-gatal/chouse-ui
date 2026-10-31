/**
 * ADR 0028 migrations (sign in to MCP with OAuth). Idempotent: tables and
 * indexes are `IF NOT EXISTS` and column adds are guarded. Existing personal
 * access tokens get kind = 'pat' from the column default.
 */

import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { API_KEY_OAUTH_COLUMNS, mcpOAuthIndexStatements, mcpOAuthTableStatements } from './mcpOAuthSchema';
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

function dialect(): 'sqlite' | 'postgres' {
  return getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
}

export const MCP_OAUTH_MIGRATIONS: Migration[] = [
  {
    version: '1.75.0',
    name: 'mcp_oauth',
    description: 'ADR 0028 — sign in to MCP with OAuth: oauth_clients (agents that registered themselves), oauth_requests (sign-ins in progress and their one-time codes) and oauth_tokens (hashed access and refresh tokens). rbac_api_keys gains kind (pat or oauth) and oauth_client_id; every existing token stays a personal access token.',
    up: async (db) => {
      for (const column of API_KEY_OAUTH_COLUMNS) {
        if (await hasColumn(db, 'rbac_api_keys', column.name)) continue;
        await exec(db, sql.raw(`ALTER TABLE rbac_api_keys ADD COLUMN ${column.name} ${column.type}`));
      }
      for (const statement of mcpOAuthTableStatements(dialect())) await exec(db, sql.raw(statement));
      for (const statement of mcpOAuthIndexStatements(dialect())) await exec(db, sql.raw(statement));
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.75.0] Created the MCP OAuth tables and marked existing tokens as personal access tokens (${dialect()})`);
    },
    down: async () => { /* forward-only */ },
  },
];
