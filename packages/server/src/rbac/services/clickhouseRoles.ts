/**
 * ClickHouse Role Management Service
 *
 * Manages native ClickHouse roles (CREATE ROLE / GRANT ... TO role). ClickHouse
 * is the source of truth: roles are read from system.roles and their privileges
 * from system.grants. Edits are diff-based — only the GRANT/REVOKE statements
 * that actually changed are issued (see clickhousePrivileges.ts).
 */

import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import type { ClickHouseService } from '../../services/clickhouse';
import {
  type CHGrant,
  type CHPrivilegeCatalogEntry,
  type SystemGrantRow,
  CH_PRIVILEGES,
  systemGrantRowsToGrants,
  buildGrantStatements,
  buildGrantDiffStatements,
  quoteIdent,
  escapeLiteral,
  clusterClause,
  isReadonlyAccessStorage,
} from './clickhousePrivileges';
import { getDatabase, getSchema } from '../db';
import { logger } from '../../utils/logger';

// Dual SQLite/PostgreSQL Drizzle instance — typed loosely like the rest of the
// RBAC services that touch the local DB.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// Map a top-level ClickHouse privilege family (the root of the parent_group
// chain) to a clean UI group label. Keeps labels consistent with the curated
// catalog and collapses the many ALTER */CREATE */… children under one heading.
const GROUP_LABELS: Record<string, string> = {
  SELECT: 'Read/Write',
  INSERT: 'Read/Write',
  OPTIMIZE: 'Read/Write',
  TRUNCATE: 'Read/Write',
  ALTER: 'Alter',
  CREATE: 'Create',
  DROP: 'Drop',
  UNDROP: 'Drop',
  SHOW: 'Show',
  DICTGET: 'Dictionaries',
  INTROSPECTION: 'Introspection',
  'ACCESS MANAGEMENT': 'Access Management',
  'NAMED COLLECTION ADMIN': 'Access Management',
  SOURCES: 'Sources',
  SYSTEM: 'System',
  'KILL QUERY': 'System',
  BACKUP: 'System',
  'TABLE ENGINE': 'System',
  ALL: 'All',
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * List the privileges this ClickHouse server actually supports, read live from
 * system.privileges. Each privilege is grouped by its top-level ancestor in the
 * parent_group chain, mapped to a clean, consistent label (so e.g. all ALTER *
 * privileges sit under "Alter"). Column support is derived from the finest
 * level. Returns the static catalog if the query fails or returns nothing.
 */
export async function listClickHousePrivileges(service: ClickHouseService): Promise<CHPrivilegeCatalogEntry[]> {
  try {
    const result = await service.executeQuery<{ privilege: string; level: string | null; parent_group: string | null }>(
      `SELECT privilege, level, parent_group FROM system.privileges ORDER BY privilege`,
    );
    const rows = result.data || [];
    if (rows.length === 0) return CH_PRIVILEGES;

    const parentOf = new Map<string, string | null>();
    for (const row of rows) {
      if (row.privilege) parentOf.set(row.privilege, row.parent_group?.trim() || null);
    }

    // Resolve a privilege to its top-level family: walk parent_group up, stopping
    // just below the ALL root (so every ALTER * sits under ALTER, not ALL).
    // Guards against cycles and parents that aren't themselves listed.
    const rootOf = (name: string): string => {
      let current = name;
      const seen = new Set<string>([current]);
      for (;;) {
        const parent = parentOf.get(current);
        if (!parent || parent.toUpperCase() === 'ALL' || seen.has(parent)) break;
        current = parent;
        seen.add(parent);
        if (!parentOf.has(parent)) break; // parent is a top-level label, not a node
      }
      return current;
    };

    const known = new Map(CH_PRIVILEGES.map((p) => [p.name, p]));
    const seen = new Set<string>();
    const entries: CHPrivilegeCatalogEntry[] = [];
    for (const row of rows) {
      const name = row.privilege;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const curated = known.get(name);
      const root = rootOf(name).toUpperCase();
      const group = curated?.group ?? GROUP_LABELS[root] ?? titleCase(rootOf(name));
      entries.push({
        name,
        group,
        supportsColumns: curated?.supportsColumns ?? row.level === 'COLUMN',
        description: curated?.description,
        parent: row.parent_group?.trim() || null,
      });
    }
    return entries;
  } catch (error) {
    logger.warn(
      { module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) },
      'Failed to read system.privileges; using static catalog',
    );
    return CH_PRIVILEGES;
  }
}

// ============================================
// Types
// ============================================

export interface ClickHouseRole {
  name: string;
  id?: string;
  storage?: string;
  grantCount?: number;
  /** Number of grantees (users + roles) this role is assigned to. */
  assignedCount?: number;
  /** True when the role is config-managed and cannot be modified via SQL. */
  readonly?: boolean;
  /** True when the role is currently disabled (its grants are stashed locally). */
  disabled?: boolean;
}

export interface ClickHouseRoleDetail {
  name: string;
  grants: CHGrant[];
}

export interface CreateRoleInput {
  name: string;
  cluster?: string;
  grants: CHGrant[];
}

export interface UpdateRoleInput {
  cluster?: string;
  grants: CHGrant[];
}

// ============================================
// Reads (ClickHouse = source of truth)
// ============================================

/**
 * List all ClickHouse roles, with best-effort privilege/assignment counts.
 * When `connectionId` is provided, roles are also flagged as `disabled` from the
 * local role-state table.
 */
export async function listClickHouseRoles(service: ClickHouseService, connectionId?: string): Promise<ClickHouseRole[]> {
  const result = await service.executeQuery<{ name: string; id?: string; storage?: string }>(
    `SELECT name, id, storage FROM system.roles ORDER BY name`,
  );
  const disabled = connectionId ? await getDisabledRoleNames(connectionId) : new Set<string>();
  const roles = (result.data || []).map((r) => ({
    name: r.name,
    id: r.id,
    storage: r.storage,
    readonly: isReadonlyAccessStorage(r.storage),
    disabled: disabled.has(r.name),
  }));

  // Best-effort privilege + assignment counts; non-fatal if they fail.
  const byGrant = new Map<string, number>();
  const byAssignment = new Map<string, number>();
  try {
    const counts = await service.executeQuery<{ role_name: string; cnt: string | number }>(
      `SELECT role_name, count() AS cnt FROM system.grants WHERE role_name IS NOT NULL GROUP BY role_name`,
    );
    for (const row of counts.data || []) byGrant.set(row.role_name, Number(row.cnt));
  } catch (error) {
    logger.warn({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Failed to load grant counts');
  }
  try {
    const counts = await service.executeQuery<{ granted_role_name: string; cnt: string | number }>(
      `SELECT granted_role_name, count() AS cnt FROM system.role_grants WHERE granted_role_name IS NOT NULL GROUP BY granted_role_name`,
    );
    for (const row of counts.data || []) byAssignment.set(row.granted_role_name, Number(row.cnt));
  } catch (error) {
    logger.warn({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Failed to load assignment counts');
  }
  return roles.map((r) => ({
    ...r,
    grantCount: byGrant.get(r.name) ?? 0,
    assignedCount: byAssignment.get(r.name) ?? 0,
  }));
}

/** Users and roles this role is currently granted to. */
export async function getRoleAssignees(
  service: ClickHouseService,
  name: string,
): Promise<{ users: string[]; roles: string[] }> {
  const result = await service.executeQuery<{ user_name: string | null; role_name: string | null }>(
    `SELECT user_name, role_name FROM system.role_grants WHERE granted_role_name = '${escapeLiteral(name)}'`,
  );
  const users: string[] = [];
  const roles: string[] = [];
  for (const row of result.data || []) {
    if (row.user_name) users.push(row.user_name);
    else if (row.role_name) roles.push(row.role_name);
  }
  return { users, roles };
}

async function roleExists(service: ClickHouseService, name: string): Promise<boolean> {
  const result = await service.executeQuery<{ cnt: string | number }>(
    `SELECT count() AS cnt FROM system.roles WHERE name = '${escapeLiteral(name)}'`,
  );
  return Number(result.data?.[0]?.cnt ?? 0) > 0;
}

/** Read the structured grant set for a role from system.grants. */
export async function getRoleGrants(service: ClickHouseService, name: string): Promise<CHGrant[]> {
  const result = await service.executeQuery<SystemGrantRow>(
    `SELECT access_type, database, table, column, is_partial_revoke, grant_option
     FROM system.grants
     WHERE role_name = '${escapeLiteral(name)}'`,
  );
  return systemGrantRowsToGrants(result.data || []);
}

/** Fetch a single role with its grants, or null if it does not exist. */
export async function getClickHouseRole(
  service: ClickHouseService,
  name: string,
): Promise<ClickHouseRoleDetail | null> {
  if (!(await roleExists(service, name))) return null;
  const grants = await getRoleGrants(service, name);
  return { name, grants };
}

// ============================================
// DDL generation
// ============================================

/** Statements to create a role and apply its initial grants. */
export function generateCreateRoleDDL(input: CreateRoleInput): string[] {
  const grantee = quoteIdent(input.name);
  const create = `CREATE ROLE IF NOT EXISTS ${grantee}${clusterClause(input.cluster)}`;
  const grants = buildGrantStatements(input.grants, { grantee, cluster: input.cluster });
  return [create, ...grants];
}

/** Diff-based statements to bring a role's grants from `current` to `desired`. */
export function generateRoleDiffDDL(
  name: string,
  current: CHGrant[],
  desired: CHGrant[],
  cluster?: string,
): string[] {
  return buildGrantDiffStatements(current, desired, { grantee: quoteIdent(name), cluster });
}

// ============================================
// Writes
// ============================================

/** ClickHouse has no multi-statement queries — execute one at a time. */
async function execAll(service: ClickHouseService, statements: string[]): Promise<void> {
  for (const statement of statements) {
    const trimmed = statement.trim();
    if (trimmed) await service.executeQuery(trimmed);
  }
}

export async function createClickHouseRole(service: ClickHouseService, input: CreateRoleInput): Promise<void> {
  await execAll(service, generateCreateRoleDDL(input));
}

export async function updateClickHouseRole(
  service: ClickHouseService,
  name: string,
  input: UpdateRoleInput,
): Promise<void> {
  const current = await getRoleGrants(service, name);
  await execAll(service, generateRoleDiffDDL(name, current, input.grants, input.cluster));
}

export async function deleteClickHouseRole(
  service: ClickHouseService,
  name: string,
  cluster?: string,
): Promise<void> {
  // Refuse to drop a role that is still granted to users/roles — dropping it
  // would silently strip access from every grantee.
  const { users, roles } = await getRoleAssignees(service, name);
  const total = users.length + roles.length;
  if (total > 0) {
    const labels = [...users.map((u) => `user "${u}"`), ...roles.map((r) => `role "${r}"`)];
    const preview = labels.slice(0, 5).join(', ') + (labels.length > 5 ? `, +${labels.length - 5} more` : '');
    throw new Error(
      `Role "${name}" is still assigned to ${total} grantee(s) (${preview}). Revoke it from them before deleting.`,
    );
  }
  await service.executeQuery(`DROP ROLE IF EXISTS ${quoteIdent(name)}${clusterClause(cluster)}`);
}

// ============================================
// Enable / Disable (reversible, backed by rbac_clickhouse_role_state)
// ============================================

/** Names of roles currently disabled for a connection. */
export async function getDisabledRoleNames(connectionId: string): Promise<Set<string>> {
  try {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    const rows = await db
      .select({ roleName: schema.clickhouseRoleState.roleName })
      .from(schema.clickhouseRoleState)
      .where(eq(schema.clickhouseRoleState.connectionId, connectionId));
    return new Set<string>(rows.map((r: { roleName: string }) => r.roleName));
  } catch (error) {
    logger.warn({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Failed to read disabled role state');
    return new Set<string>();
  }
}

async function getRoleStateRow(connectionId: string, name: string): Promise<{ id: string; savedGrants: CHGrant[] } | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = await db
    .select()
    .from(schema.clickhouseRoleState)
    .where(and(eq(schema.clickhouseRoleState.connectionId, connectionId), eq(schema.clickhouseRoleState.roleName, name)))
    .limit(1);
  if (rows.length === 0) return null;
  return { id: rows[0].id, savedGrants: (rows[0].savedGrants as CHGrant[]) || [] };
}

/**
 * Disable a role: snapshot its current grants into the role-state table, then
 * revoke them all in ClickHouse. The role keeps existing and stays assigned to
 * its users/roles, but grants nothing while disabled. Idempotent.
 */
export async function disableClickHouseRole(
  service: ClickHouseService,
  connectionId: string,
  name: string,
  cluster?: string,
  disabledBy?: string,
): Promise<void> {
  if (await getRoleStateRow(connectionId, name)) return; // already disabled
  if (!(await roleExists(service, name))) {
    throw new Error(`Role "${name}" does not exist`);
  }

  const current = await getRoleGrants(service, name);

  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db.insert(schema.clickhouseRoleState).values({
    id: randomUUID(),
    connectionId,
    roleName: name,
    savedGrants: current,
    disabledBy: disabledBy || null,
  });

  // Revoke everything the role grants.
  await execAll(service, buildGrantDiffStatements(current, [], { grantee: quoteIdent(name), cluster }));
}

/**
 * Enable a previously disabled role: re-apply the snapshotted grants and clear
 * the disabled state. No-op if the role isn't disabled.
 */
export async function enableClickHouseRole(
  service: ClickHouseService,
  connectionId: string,
  name: string,
  cluster?: string,
): Promise<void> {
  const state = await getRoleStateRow(connectionId, name);
  if (!state) return; // not disabled

  const current = await getRoleGrants(service, name);
  await execAll(service, buildGrantDiffStatements(current, state.savedGrants, { grantee: quoteIdent(name), cluster }));

  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db.delete(schema.clickhouseRoleState).where(eq(schema.clickhouseRoleState.id, state.id));
}
