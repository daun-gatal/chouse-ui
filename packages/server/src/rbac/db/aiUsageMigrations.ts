/**
 * ADR 0020 migrations: 1.58.0 adds AI usage and data egress tracking; 1.59.0
 * adds the request's chat thread to databases that ran 1.58.0 before it had one.
 *
 * Schema plus one permission grant, all idempotent: `IF NOT EXISTS` tables and
 * indexes, a guarded column add, and a grant that skips an existing row. It
 * applies cleanly on fresh, stepwise and skip-version installs. The engine
 * fills the tables itself; there is no data to move.
 */

import { randomUUID } from 'crypto';
import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { PERMISSIONS, SYSTEM_ROLES } from '../schema/base';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { aiUsageSchemaStatements } from './aiUsageSchema';
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

/** Grant `permission` to the system role `roleName` unless already granted. */
async function grantToRole(db: RbacDb, roleName: string, permission: string): Promise<void> {
  const role = await rows(db, sql`SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1`);
  const perm = await rows(db, sql`SELECT id FROM rbac_permissions WHERE name = ${permission} LIMIT 1`);
  if (!role[0] || !perm[0]) return;
  const roleId = String(role[0].id);
  const permId = String(perm[0].id);
  const existing = await rows(db, sql`SELECT 1 FROM rbac_role_permissions WHERE role_id = ${roleId} AND permission_id = ${permId} LIMIT 1`);
  if (existing.length > 0) return;
  const createdAt = getDatabaseType() === 'sqlite' ? Math.floor(Date.now() / 1000) : new Date().toISOString();
  await exec(db, sql`INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at) VALUES (${randomUUID()}, ${roleId}, ${permId}, ${createdAt})`);
}

export const AI_USAGE_MIGRATIONS: Migration[] = [
  {
    version: '1.58.0',
    name: 'ai_usage_tracking',
    description: 'ADR 0020 — AI usage and data egress tracking: ai_usage_requests, ai_usage_steps and ai_usage_egress; a nullable pricing JSON column on rbac_ai_models (USD per 1M tokens); the ai_usage:view permission granted to super_admin and admin.',
    up: async (db) => {
      const dialect = getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
      for (const statement of aiUsageSchemaStatements(dialect)) {
        await exec(db, sql.raw(statement));
      }
      if (!(await columnExists(db, 'rbac_ai_models', 'pricing'))) {
        await exec(db, sql.raw(`ALTER TABLE rbac_ai_models ADD COLUMN pricing ${dialect === 'sqlite' ? 'TEXT' : 'JSONB'}`));
      }
      const { seedPermissions } = await import('../services/seed');
      await seedPermissions();
      for (const role of [SYSTEM_ROLES.SUPER_ADMIN, SYSTEM_ROLES.ADMIN]) {
        await grantToRole(db, role, PERMISSIONS.AI_USAGE_VIEW);
      }
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.58.0] Created AI usage tracking tables (${dialect})`);
    },
    down: async () => { /* forward-only */ },
  },
  {
    version: '1.59.0',
    name: 'ai_usage_thread_id',
    description: 'ADR 0020 — the chat thread of an AI request (ai_usage_requests.thread_id). 1.58.0 creates it on new databases; this adds it to databases that ran an earlier 1.58.0 without it, where every usage write failed. Guarded: a no-op when the column exists.',
    up: async (db) => {
      const dialect = getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
      if (!(await columnExists(db, 'ai_usage_requests', 'thread_id'))) {
        await exec(db, sql.raw('ALTER TABLE ai_usage_requests ADD COLUMN thread_id TEXT'));
        logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.59.0] Added ai_usage_requests.thread_id (${dialect})`);
      } else {
        logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.59.0] ai_usage_requests.thread_id already present (${dialect})`);
      }
    },
    down: async () => { /* forward-only */ },
  },
];
