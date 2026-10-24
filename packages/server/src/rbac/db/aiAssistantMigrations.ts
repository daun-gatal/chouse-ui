/**
 * ADR 0025 migrations (AI write tiers, MCP token policies, watches). Each is
 * idempotent (`IF NOT EXISTS`, guarded column adds), so stepwise and
 * skip-version upgrades land in the same state.
 */

import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { AI_ACTION_TIER_COLUMNS, aiActionGrantSchemaStatements, aiActionTierColumnType, mcpTokenPolicySchemaStatements } from './aiAssistantSchema';
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

export const AI_ASSISTANT_MIGRATIONS: Migration[] = [
  {
    version: '1.71.0',
    name: 'ai_action_tiers',
    description: 'ADR 0025 — write tiers: ai_actions records the tier, origin, token and undo snapshot of every AI write; ai_action_grants holds "allow for this thread / for an hour" on T2 tools. Existing actions keep a null tier (they predate tiers).',
    up: async (db) => {
      for (const column of AI_ACTION_TIER_COLUMNS) {
        if (await hasColumn(db, 'ai_actions', column.name)) continue;
        await exec(db, sql.raw(`ALTER TABLE ai_actions ADD COLUMN ${column.name} ${aiActionTierColumnType(column.type, dialect())}`));
      }
      for (const statement of aiActionGrantSchemaStatements(dialect())) {
        await exec(db, sql.raw(statement));
      }
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.71.0] Added write tiers and undo to AI actions (${dialect()})`);
    },
    down: async () => { /* forward-only */ },
  },
  {
    version: '1.72.0',
    name: 'mcp_token_policies',
    description: 'ADR 0025 — per-token MCP write policy (mcp_token_policies): the toolkits a personal access token gets as MCP write tools and how each tier is handled. Tokens without a row use the defaults (Data & Query; T1 runs, T2 asks, T3 needs a second approver).',
    up: async (db) => {
      for (const statement of mcpTokenPolicySchemaStatements(dialect())) {
        await exec(db, sql.raw(statement));
      }
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.72.0] Created MCP token policies (${dialect()})`);
    },
    down: async () => { /* forward-only */ },
  },
];
