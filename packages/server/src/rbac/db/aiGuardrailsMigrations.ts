/**
 * ADR 0022 migrations: 1.62.0 adds AI guardrails.
 *
 * Schema plus permission grants, all idempotent: `IF NOT EXISTS` tables and
 * indexes, and grants that skip an existing row. There is no data to move:
 * the built-in guardrails are inserted by the registry seed sync at startup,
 * like built-in agents (ADR 0019 §8).
 */

import { randomUUID } from 'crypto';
import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES, type Permission } from '../schema/base';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { aiGuardrailsSchemaStatements } from './aiGuardrailsSchema';
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

const GUARDRAIL_PERMISSIONS: Permission[] = [
  PERMISSIONS.AI_GUARDRAILS_VIEW,
  PERMISSIONS.AI_GUARDRAILS_MANAGE,
];

export const AI_GUARDRAILS_MIGRATIONS: Migration[] = [
  {
    version: '1.62.0',
    name: 'ai_guardrails',
    description: 'ADR 0022 — AI guardrails: ai_guardrails and ai_guardrail_events; the ai_guardrails:view|manage permissions granted to the system roles that hold them by default (Admin and Super Admin).',
    up: async (db) => {
      const dialect = getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
      for (const statement of aiGuardrailsSchemaStatements(dialect)) {
        await exec(db, sql.raw(statement));
      }
      const { seedPermissions } = await import('../services/seed');
      await seedPermissions();
      for (const role of Object.values(SYSTEM_ROLES)) {
        for (const permission of GUARDRAIL_PERMISSIONS) {
          if (DEFAULT_ROLE_PERMISSIONS[role].includes(permission)) await grantToRole(db, role, permission);
        }
      }
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.62.0] Created AI guardrail tables (${dialect})`);
    },
    down: async () => { /* forward-only */ },
  },
];
