/**
 * ClickHouse User Management Service
 *
 * Manages native ClickHouse database users. ClickHouse is the source of truth:
 * users are read from system.users, their role assignments from
 * system.role_grants and any direct privileges from system.grants.
 *
 * Users are primarily granted access by assigning native roles (see
 * clickhouseRoles.ts); direct per-user grants are supported as an advanced
 * option. Edits are diff-based — only the GRANT/REVOKE statements that actually
 * changed are issued (see clickhousePrivileges.ts).
 */

import type { ClickHouseService } from '../../services/clickhouse';
import {
  type CHGrant,
  type SystemGrantRow,
  systemGrantRowsToGrants,
  buildGrantStatements,
  buildGrantDiffStatements,
  quoteIdent,
  escapeLiteral,
  clusterClause,
  isReadonlyAccessStorage,
} from './clickhousePrivileges';
import { generateCreateRoleDDL } from './clickhouseRoles';

// ============================================
// Types
// ============================================

/** Default-role selection: an explicit list, or all granted roles. */
export type DefaultRoles = string[] | 'ALL';

export interface ClickHouseUser {
  name: string;
  host_ip?: string;
  host_names?: string;
  default_roles_all?: number;
  default_roles_list?: string;
  auth_type?: string;
  roles?: string[];
  /** Access storage (e.g. 'local directory', 'users.xml'). */
  storage?: string;
  /** True when the user is config-managed and cannot be modified via SQL. */
  readonly?: boolean;
}

export interface ClickHouseUserDetail extends ClickHouseUser {
  roles: string[];
  defaultRoles: DefaultRoles;
  directGrants: CHGrant[];
}

export interface CreateClickHouseUserInput {
  username: string;
  authType?: string; // default: sha256_password
  password?: string; // required unless authType === 'no_password'
  hostIp?: string;
  hostNames?: string;
  cluster?: string;
  roles?: string[];
  defaultRoles?: DefaultRoles;
  directGrants?: CHGrant[];
}

export interface UpdateClickHouseUserInput {
  password?: string;
  authType?: string;
  hostIp?: string;
  hostNames?: string;
  cluster?: string;
  roles?: string[];
  defaultRoles?: DefaultRoles;
  directGrants?: CHGrant[];
}

/** Current ClickHouse-side state of a user, used as the base for diffing. */
export interface CurrentUserState {
  roles: string[];
  defaultRoles: DefaultRoles;
  directGrants: CHGrant[];
  authType?: string;
}

export interface ClickHouseUserDDL {
  createUser: string;
  grantStatements: string[];
  fullDDL: string;
}

// ============================================
// Auth / host helpers
// ============================================

const AUTH_TYPES = new Set([
  'no_password',
  'plaintext_password',
  'sha256_password',
  'double_sha1_password',
  'bcrypt_password',
]);

const DEFAULT_AUTH_TYPE = 'sha256_password';

function assertValidAuthType(authType: string): void {
  if (!AUTH_TYPES.has(authType)) {
    throw new Error(`Unsupported authentication type: ${authType}`);
  }
}

function buildAuthClause(authType: string, password?: string): string {
  assertValidAuthType(authType);
  if (authType === 'no_password') {
    return ' IDENTIFIED WITH no_password';
  }
  return ` IDENTIFIED WITH ${authType} BY '${escapeLiteral(password ?? '')}'`;
}

/** Build the authoritative ` HOST ...` clause. Empty/omitted host means HOST ANY. */
function buildHostClause(hostIp?: string, hostNames?: string): string {
  const parts: string[] = [];
  if (hostIp && hostIp.trim()) parts.push(`IP '${escapeLiteral(hostIp.trim())}'`);
  if (hostNames && hostNames.trim()) parts.push(`NAME '${escapeLiteral(hostNames.trim())}'`);
  return parts.length > 0 ? ` HOST ${parts.join(', ')}` : ' HOST ANY';
}

// ============================================
// Role-assignment helpers
// ============================================

function grantRolesStatement(roles: string[], username: string, cluster?: string): string | null {
  if (roles.length === 0) return null;
  return `GRANT${clusterClause(cluster)} ${roles.map(quoteIdent).join(', ')} TO ${quoteIdent(username)}`;
}

function revokeRolesStatement(roles: string[], username: string, cluster?: string): string | null {
  if (roles.length === 0) return null;
  return `REVOKE${clusterClause(cluster)} ${roles.map(quoteIdent).join(', ')} FROM ${quoteIdent(username)}`;
}

function defaultRoleStatement(defaultRoles: DefaultRoles, username: string, cluster?: string): string {
  let spec: string;
  if (defaultRoles === 'ALL') {
    spec = 'ALL';
  } else if (defaultRoles.length === 0) {
    spec = 'NONE';
  } else {
    spec = defaultRoles.map(quoteIdent).join(', ');
  }
  return `ALTER USER ${quoteIdent(username)}${clusterClause(cluster)} DEFAULT ROLE ${spec}`;
}

// ============================================
// DDL generation
// ============================================

/** Generate DDL for creating a user, assigning roles, setting defaults and direct grants. */
export function generateUserDDL(input: CreateClickHouseUserInput): ClickHouseUserDDL {
  const username = input.username;
  const authType = input.authType || DEFAULT_AUTH_TYPE;
  const cluster = input.cluster;
  const roles = input.roles ?? [];
  const directGrants = input.directGrants ?? [];

  const createUser =
    `CREATE USER IF NOT EXISTS ${quoteIdent(username)}${clusterClause(cluster)}` +
    `${buildAuthClause(authType, input.password)}` +
    `${buildHostClause(input.hostIp, input.hostNames)}`;

  const grantStatements: string[] = [];

  const grantRoles = grantRolesStatement(roles, username, cluster);
  if (grantRoles) grantStatements.push(grantRoles);

  // Only set default roles when roles are assigned (otherwise NONE is implicit).
  if (roles.length > 0) {
    grantStatements.push(defaultRoleStatement(input.defaultRoles ?? 'ALL', username, cluster));
  }

  grantStatements.push(...buildGrantStatements(directGrants, { grantee: quoteIdent(username), cluster }));

  const fullDDL = [createUser, ...grantStatements].map((s) => `${s};`).join('\n');
  return { createUser: `${createUser};`, grantStatements: grantStatements.map((s) => `${s};`), fullDDL };
}

/** Generate diff-based DDL for updating a user against its current state. */
export function generateUpdateUserDDL(
  username: string,
  input: UpdateClickHouseUserInput,
  current: CurrentUserState,
): ClickHouseUserDDL {
  const cluster = input.cluster;
  const statements: string[] = [];

  // Password change (auth type is not changed on update; reuse the current one).
  if (input.password) {
    const authType = current.authType || DEFAULT_AUTH_TYPE;
    if (authType !== 'no_password') {
      statements.push(
        `ALTER USER ${quoteIdent(username)}${clusterClause(cluster)}${buildAuthClause(authType, input.password)}`,
      );
    }
  }

  // Host change (authoritative replace).
  if (input.hostIp !== undefined || input.hostNames !== undefined) {
    statements.push(
      `ALTER USER ${quoteIdent(username)}${clusterClause(cluster)}${buildHostClause(input.hostIp, input.hostNames)}`,
    );
  }

  // Role assignment diff.
  if (input.roles !== undefined) {
    const desired = new Set(input.roles);
    const currentSet = new Set(current.roles);
    const toRevoke = current.roles.filter((r) => !desired.has(r));
    const toGrant = input.roles.filter((r) => !currentSet.has(r));
    const revoke = revokeRolesStatement(toRevoke, username, cluster);
    const grant = grantRolesStatement(toGrant, username, cluster);
    if (revoke) statements.push(revoke);
    if (grant) statements.push(grant);
  }

  // Default roles (issued after grants so referenced roles exist).
  if (input.defaultRoles !== undefined) {
    statements.push(defaultRoleStatement(input.defaultRoles, username, cluster));
  }

  // Direct grant diff.
  if (input.directGrants !== undefined) {
    statements.push(
      ...buildGrantDiffStatements(current.directGrants, input.directGrants, { grantee: quoteIdent(username), cluster }),
    );
  }

  const fullDDL = statements.map((s) => `${s};`).join('\n');
  return { createUser: statements[0] ? `${statements[0]};` : '', grantStatements: statements.slice(1).map((s) => `${s};`), fullDDL };
}

// ============================================
// Reads (ClickHouse = source of truth)
// ============================================

function firstOfArray(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0] || undefined;
  return value || undefined;
}

/** List all ClickHouse users, enriched with their granted role names (best effort). */
export async function listClickHouseUsers(service: ClickHouseService): Promise<ClickHouseUser[]> {
  const result = await service.executeQuery<ClickHouseUser & { host_ip?: string | string[]; host_names?: string | string[] }>(
    `SELECT name, host_ip, host_names, default_roles_all, default_roles_list, auth_type, storage
     FROM system.users
     ORDER BY name`,
  );
  const users = (result.data || []).map((u) => ({
    ...u,
    host_ip: firstOfArray(u.host_ip),
    host_names: firstOfArray(u.host_names),
    readonly: isReadonlyAccessStorage(u.storage),
  }));

  try {
    const roleRows = await service.executeQuery<{ user_name: string; roles: string[] }>(
      `SELECT user_name, groupArray(granted_role_name) AS roles
       FROM system.role_grants
       WHERE user_name IS NOT NULL
       GROUP BY user_name`,
    );
    const byUser = new Map<string, string[]>((roleRows.data || []).map((r) => [r.user_name, r.roles]));
    return users.map((u) => ({ ...u, roles: byUser.get(u.name) ?? [] }));
  } catch {
    return users.map((u) => ({ ...u, roles: [] }));
  }
}

/** Roles granted to a user, plus the user's default-role configuration. */
export async function getUserRoles(
  service: ClickHouseService,
  username: string,
): Promise<{ roles: string[]; defaultRoles: DefaultRoles }> {
  const escaped = escapeLiteral(username);
  const roleRows = await service.executeQuery<{ granted_role_name: string }>(
    `SELECT granted_role_name FROM system.role_grants WHERE user_name = '${escaped}'`,
  );
  const roles = (roleRows.data || []).map((r) => r.granted_role_name);

  const userRow = await service.executeQuery<{ default_roles_all: number | boolean; default_roles_list: string[] }>(
    `SELECT default_roles_all, default_roles_list FROM system.users WHERE name = '${escaped}' LIMIT 1`,
  );
  const row = userRow.data?.[0];
  const allDefault = row?.default_roles_all === 1 || row?.default_roles_all === true;
  const defaultRoles: DefaultRoles = allDefault ? 'ALL' : row?.default_roles_list ?? [];
  return { roles, defaultRoles };
}

/** Direct (non-role) privileges granted to a user. */
export async function getUserDirectGrants(service: ClickHouseService, username: string): Promise<CHGrant[]> {
  const result = await service.executeQuery<SystemGrantRow>(
    `SELECT access_type, database, table, column, is_partial_revoke, grant_option
     FROM system.grants
     WHERE user_name = '${escapeLiteral(username)}'`,
  );
  return systemGrantRowsToGrants(result.data || []);
}

/** Fetch a user with roles, default roles and direct grants, or null if missing. */
export async function getClickHouseUser(
  service: ClickHouseService,
  username: string,
): Promise<ClickHouseUserDetail | null> {
  const result = await service.executeQuery<ClickHouseUser & { host_ip?: string | string[]; host_names?: string | string[] }>(
    `SELECT name, host_ip, host_names, default_roles_all, default_roles_list, auth_type, storage
     FROM system.users
     WHERE name = '${escapeLiteral(username)}'
     LIMIT 1`,
  );
  const user = result.data?.[0];
  if (!user) return null;

  const { roles, defaultRoles } = await getUserRoles(service, username);
  const directGrants = await getUserDirectGrants(service, username);

  return {
    ...user,
    host_ip: firstOfArray(user.host_ip),
    host_names: firstOfArray(user.host_names),
    readonly: isReadonlyAccessStorage(user.storage),
    roles,
    defaultRoles,
    directGrants,
  };
}

/** Read the current diff-base state of a user (roles, defaults, direct grants, auth type). */
export async function getCurrentUserState(service: ClickHouseService, username: string): Promise<CurrentUserState> {
  const detail = await getClickHouseUser(service, username);
  if (!detail) {
    return { roles: [], defaultRoles: [], directGrants: [], authType: undefined };
  }
  return {
    roles: detail.roles,
    defaultRoles: detail.defaultRoles,
    directGrants: detail.directGrants,
    authType: detail.auth_type,
  };
}

// ============================================
// Writes
// ============================================

async function execAll(service: ClickHouseService, statements: string[]): Promise<void> {
  for (const raw of statements) {
    const statement = raw.trim().replace(/;$/, '').trim();
    if (statement) await service.executeQuery(statement);
  }
}

export async function createClickHouseUser(service: ClickHouseService, input: CreateClickHouseUserInput): Promise<void> {
  const ddl = generateUserDDL(input);
  await execAll(service, [ddl.createUser, ...ddl.grantStatements]);
}

export async function updateClickHouseUser(
  service: ClickHouseService,
  username: string,
  input: UpdateClickHouseUserInput,
  current?: CurrentUserState,
): Promise<void> {
  const base = current ?? (await getCurrentUserState(service, username));
  const ddl = generateUpdateUserDDL(username, input, base);
  await execAll(service, [ddl.createUser, ...ddl.grantStatements]);
}

export async function deleteClickHouseUser(
  service: ClickHouseService,
  username: string,
  cluster?: string,
): Promise<void> {
  await service.executeQuery(`DROP USER IF EXISTS ${quoteIdent(username)}${clusterClause(cluster)}`);
}

/** Whether a user is config-managed (e.g. users.xml) and thus not modifiable via SQL. */
async function isUserReadonly(service: ClickHouseService, username: string): Promise<boolean> {
  const result = await service.executeQuery<{ storage?: string }>(
    `SELECT storage FROM system.users WHERE name = '${escapeLiteral(username)}' LIMIT 1`,
  );
  return isReadonlyAccessStorage(result.data?.[0]?.storage);
}

/**
 * Capture a read-only (config-managed, e.g. users.xml) user's grants into a
 * reusable native role. Such a user can't be modified via SQL, so this only
 * materializes its grants into a new role — the user is left exactly as-is.
 *
 * Writable (SQL-managed) users are intentionally not supported: assign roles to
 * them directly instead.
 *
 * @throws Error when the user is writable, or has no direct grants to extract.
 */
export async function extractRoleFromUser(
  service: ClickHouseService,
  username: string,
  roleName: string,
  cluster?: string,
): Promise<void> {
  if (!(await isUserReadonly(service, username))) {
    throw new Error(
      `Extract to role is only available for read-only (config-managed) users. '${username}' is SQL-managed — assign roles to it directly instead.`,
    );
  }

  const directGrants = await getUserDirectGrants(service, username);
  if (directGrants.length === 0) {
    throw new Error('User has no direct grants to extract');
  }

  await execAll(service, generateCreateRoleDDL({ name: roleName, cluster, grants: directGrants }));
}
