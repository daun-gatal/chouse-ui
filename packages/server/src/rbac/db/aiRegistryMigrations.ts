/**
 * ADR 0019 migrations: 1.56.0 creates the AI agent registry.
 *
 * Schema only — the built-in agents, harnesses, skills and bindings are
 * written by the startup seed sync (services/ai/registry/seedSync.ts), so a
 * migration never depends on shipped prompt text. Every step is idempotent.
 */

import { randomUUID } from 'crypto';
import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { PERMISSIONS, SYSTEM_ROLES } from '../schema/base';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { aiRegistrySchemaStatements } from './aiRegistrySchema';
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

export const AI_REGISTRY_MIGRATIONS: Migration[] = [
  {
    version: '1.56.0',
    name: 'ai_agent_registry',
    description: 'ADR 0019 — AI agent registry: agents, harnesses, skills, feature bindings, revisions and the registry version counter; per-thread chat agent (rbac_ai_chat_threads.agent_id); the ai_agents:view / ai_agents:manage permissions granted to super_admin and admin.',
    up: async (db) => {
      const dialect = getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
      for (const statement of aiRegistrySchemaStatements(dialect)) {
        await exec(db, sql.raw(statement));
      }
      await exec(db, sql`INSERT INTO ai_registry_state (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`);
      if (!(await columnExists(db, 'rbac_ai_chat_threads', 'agent_id'))) {
        await exec(db, sql`ALTER TABLE rbac_ai_chat_threads ADD COLUMN agent_id TEXT`);
      }
      const { seedPermissions } = await import('../services/seed');
      await seedPermissions();
      for (const role of [SYSTEM_ROLES.SUPER_ADMIN, SYSTEM_ROLES.ADMIN]) {
        await grantToRole(db, role, PERMISSIONS.AI_AGENTS_VIEW);
        await grantToRole(db, role, PERMISSIONS.AI_AGENTS_MANAGE);
      }
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.56.0] Created the AI agent registry (${dialect})`);
    },
    down: async () => { /* forward-only */ },
  },
];
