/**
 * ADR 0024 migrations (AI platform v2). One migration per phase; each is
 * idempotent (`IF NOT EXISTS`, guarded grants), so stepwise and skip-version
 * upgrades land in the same state.
 */

import { randomUUID } from 'crypto';
import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES, type Permission } from '../schema/base';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { aiActionsSchemaStatements, aiMemorySchemaStatements, aiRuntimeSchemaStatements } from './aiPlatformSchema';
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

/** Seed the permission rows, then grant each to the system roles that hold it by default. */
async function grantDefaults(db: RbacDb, permissions: Permission[]): Promise<void> {
  const { seedPermissions } = await import('../services/seed');
  await seedPermissions();
  for (const role of Object.values(SYSTEM_ROLES)) {
    for (const permission of permissions) {
      if (DEFAULT_ROLE_PERMISSIONS[role].includes(permission)) await grantToRole(db, role, permission);
    }
  }
}

function dialect(): 'sqlite' | 'postgres' {
  return getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
}

export const AI_PLATFORM_MIGRATIONS: Migration[] = [
  {
    version: '1.65.0',
    name: 'ai_runtime',
    description: 'ADR 0024 phase 1 — durable chat runs (ai_chat_runs), LangGraph checkpoints (ai_checkpoints, ai_checkpoint_writes) and AI budgets (ai_budgets); the ai_budgets:manage permission for Admin and Super Admin.',
    up: async (db) => {
      for (const statement of aiRuntimeSchemaStatements(dialect())) {
        await exec(db, sql.raw(statement));
      }
      await grantDefaults(db, [PERMISSIONS.AI_BUDGETS_MANAGE]);
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.65.0] Created AI runtime tables (${dialect()})`);
    },
    down: async () => { /* forward-only */ },
  },
  {
    version: '1.66.0',
    name: 'ai_actions',
    description: 'ADR 0024 phase 2 — approved actions (ai_actions); the ai:act permission for Admin, Developer and Super Admin.',
    up: async (db) => {
      for (const statement of aiActionsSchemaStatements(dialect())) {
        await exec(db, sql.raw(statement));
      }
      await grantDefaults(db, [PERMISSIONS.AI_ACT]);
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.66.0] Created AI action tables (${dialect()})`);
    },
    down: async () => { /* forward-only */ },
  },
  {
    version: '1.67.0',
    name: 'ai_memories',
    description: 'ADR 0024 phase 3 — memory (ai_memories, ai_memory_settings); the ai_memories:manage permission for Admin and Super Admin.',
    up: async (db) => {
      for (const statement of aiMemorySchemaStatements(dialect())) {
        await exec(db, sql.raw(statement));
      }
      await grantDefaults(db, [PERMISSIONS.AI_MEMORIES_MANAGE]);
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.67.0] Created AI memory tables (${dialect()})`);
    },
    down: async () => { /* forward-only */ },
  },
];
