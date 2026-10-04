/**
 * ADR 0016 migrations: 1.53.0 (additive), 1.54.0 (data), 1.55.0 (destructive).
 *
 * Kept in their own module so the large evidence-store DDL stays readable;
 * appended to MIGRATIONS in migrations.ts. Every step is idempotent and the
 * destructive drop lives in its own later migration, so a failed transform in
 * 1.54.0 can never reach it.
 */

import { randomUUID } from 'crypto';
import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { DEFAULT_ROLE_PERMISSIONS, OBSERVE_PERMISSIONS_ALL, PERMISSIONS, SYSTEM_ROLES, type SystemRole } from '../schema/base';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { observeSchemaStatements } from './observeSchema';
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

async function tableExists(db: RbacDb, table: string): Promise<boolean> {
  const found = getDatabaseType() === 'sqlite'
    ? await rows(db, sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`)
    : await rows(db, sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ${table}`);
  return found.length > 0;
}

async function permissionId(db: RbacDb, name: string): Promise<string | null> {
  const found = await rows(db, sql`SELECT id FROM rbac_permissions WHERE name = ${name} LIMIT 1`);
  return found[0] ? String(found[0].id) : null;
}

/** Grant `permission` to `roleId` unless already granted (idempotent). */
async function grant(db: RbacDb, roleId: string, permission: string): Promise<boolean> {
  const permId = await permissionId(db, permission);
  if (!permId) throw new Error(`Permission ${permission} is not seeded`);
  const existing = await rows(db, sql`SELECT 1 FROM rbac_role_permissions WHERE role_id = ${roleId} AND permission_id = ${permId} LIMIT 1`);
  if (existing.length > 0) return false;
  const createdAt = getDatabaseType() === 'sqlite' ? Math.floor(Date.now() / 1000) : new Date().toISOString();
  await exec(db, sql`INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at) VALUES (${randomUUID()}, ${roleId}, ${permId}, ${createdAt})`);
  return true;
}

async function rolesWithPermission(db: RbacDb, permission: string): Promise<string[]> {
  const found = await rows(db, sql`
    SELECT DISTINCT rp.role_id FROM rbac_role_permissions rp JOIN rbac_permissions p ON p.id = rp.permission_id WHERE p.name = ${permission}`);
  return found.map((r) => String(r.role_id));
}

export const OBSERVE_MIGRATIONS: Migration[] = [
  {
    version: '1.53.0',
    name: 'data_observability_platform',
    description: 'ADR 0016 — evidence store for the Data Observability Platform (catalog, lineage, pipelines, baselines, usage, performance, capacity, incidents/RCA, remediation, notebooks, context, agents, upgrades), the new permissions, and their default grants on system roles.',
    up: async (db) => {
      const dialect = getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
      for (const statement of observeSchemaStatements(dialect)) {
        await exec(db, sql.raw(statement));
      }
      const { seedPermissions } = await import('../services/seed');
      await seedPermissions();
      // Default grants for the new permissions on system roles (custom roles: see 1.54.0).
      for (const role of Object.values(SYSTEM_ROLES) as SystemRole[]) {
        const found = await rows(db, sql`SELECT id FROM rbac_roles WHERE name = ${role} LIMIT 1`);
        if (found.length === 0) continue;
        const roleId = String(found[0].id);
        for (const permission of DEFAULT_ROLE_PERMISSIONS[role].filter((p) => OBSERVE_PERMISSIONS_ALL.includes(p))) {
          await grant(db, roleId, permission);
        }
      }
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.53.0] Created the ADR 0016 evidence store and permissions (${dialect})`);
    },
    down: async () => { /* forward-only */ },
  },
  {
    version: '1.54.0',
    name: 'data_observability_data',
    description: 'ADR 0016 — carry existing state into the new platform: the fleet poller lease becomes the `observe:fleet` collector lease, every Doctor report gets a notebook, and roles that could see Data Health or Scheduled Queries (or run the Doctor) get the matching observe / remediation permissions. Idempotent.',
    up: async (db) => {
      // 1. Fleet poller lease → collector lease, so a rolling upgrade keeps one holder.
      if (await tableExists(db, 'fleet_poller_lease')) {
        const lease = await rows(db, sql`SELECT holder, acquired_at, expires_at FROM fleet_poller_lease WHERE id = 1`);
        if (lease[0] && String(lease[0].holder ?? '') !== '') {
          await exec(db, sql`
            INSERT INTO obs_leases (lease_key, holder, acquired_at, expires_at)
            VALUES ('observe:fleet', ${String(lease[0].holder)}, ${Number(lease[0].acquired_at ?? 0)}, ${Number(lease[0].expires_at ?? 0)})
            ON CONFLICT (lease_key) DO NOTHING
          `);
        }
      }

      // 2. Doctor reports → notebooks (deterministic ids make re-runs no-ops).
      let converted = 0;
      if (await tableExists(db, 'doctor_reports')) {
        const reports = await rows(db, sql`SELECT id, created_at, created_by, status, summary, model, trigger_source FROM doctor_reports`);
        for (const report of reports) {
          const reportId = String(report.id);
          const createdAt = Number(report.created_at ?? Date.now());
          const notebookId = `nb-doctor-${reportId}`;
          const before = await rows(db, sql`SELECT id FROM notebooks WHERE id = ${notebookId}`);
          if (before.length > 0) continue;
          const title = String(report.summary ?? '').trim().slice(0, 200) || 'Doctor report';
          await exec(db, sql`
            INSERT INTO notebooks (id, title, owner_id, attached_kind, attached_ref, connection_id, created_at, updated_at)
            VALUES (${notebookId}, ${title}, ${report.created_by === null || report.created_by === undefined ? null : String(report.created_by)}, 'doctor_report', ${reportId}, NULL, ${createdAt}, ${createdAt})
            ON CONFLICT (id) DO NOTHING
          `);
          const content = JSON.stringify({ status: report.status ?? null, summary: report.summary ?? null, model: report.model ?? null, reportId, trigger: report.trigger_source ?? 'manual' });
          await exec(db, sql`
            INSERT INTO notebook_cells (id, notebook_id, position, kind, author_kind, author_id, content, created_at, updated_at)
            VALUES (${`cell-doctor-${reportId}-0`}, ${notebookId}, 0, 'ai_finding', 'ai', NULL, ${content}, ${createdAt}, ${createdAt})
            ON CONFLICT (id) DO NOTHING
          `);
          converted++;
        }
      }

      // 3. Permission mapping for every role, including custom ones.
      let granted = 0;
      const observeViewers = new Set([
        ...(await rolesWithPermission(db, PERMISSIONS.DATA_HEALTH_VIEW)),
        ...(await rolesWithPermission(db, PERMISSIONS.SCHEDULED_QUERIES_VIEW)),
      ]);
      for (const roleId of observeViewers) if (await grant(db, roleId, PERMISSIONS.OBSERVE_VIEW)) granted++;
      for (const roleId of await rolesWithPermission(db, PERMISSIONS.DOCTOR_RUN)) if (await grant(db, roleId, PERMISSIONS.REMEDIATION_PROPOSE)) granted++;

      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.54.0] Converted ${converted} Doctor reports to notebooks; ${granted} permission grants mapped`);
    },
    down: async () => { /* forward-only */ },
  },
  {
    version: '1.55.0',
    name: 'drop_fleet_poller_lease',
    description: 'ADR 0016 — drop the fleet poller lease table; the `observe:fleet` collector lease (obs_leases) replaced it in 1.54.0. Kept separate from the data migration so a failed transform never reaches a drop.',
    up: async (db) => {
      await exec(db, sql`DROP TABLE IF EXISTS fleet_poller_lease`);
      logger.info({ module: 'RBAC', phase: 'migration' }, '[Migration 1.55.0] Dropped fleet_poller_lease');
    },
    down: async () => { /* forward-only */ },
  },
];
