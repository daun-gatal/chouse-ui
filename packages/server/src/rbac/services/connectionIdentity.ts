/**
 * Connection kinds and the role ceiling (ADR 0033 §5, §6): reading a
 * connection's kind, switching it, and the map from CHouse roles to ClickHouse
 * roles.
 *
 * A switch replaces the login, it does not rewrite it: the ClickHouse
 * administrator prepares a different ClickHouse user for the new kind, CHouse
 * checks that user, and one write stores the kind, the login and the role
 * names together. The previous login keeps working until that write.
 */

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

import { all, run, runBatch, sql, str, num } from '../../services/observe/db';
import { identityOfConnection, isKnownMode, isRoleName, personActor } from '../../services/chExecutor';
import { requestIdentity } from '../../services/chExecutor/identity';
import { runIdentityChecks, writeVerdict, type IdentityVerdict } from '../../services/chExecutor/health';
import { probeKindSupport, supportOf, type ServerSupport } from '../../services/chExecutor/kindSupport';
import { resetCreateChecks } from '../../services/chExecutor/selfTest';
import type { PrivilegeReport } from '../../services/connectionPrivileges';
import { AppError } from '../../types';
import { getDatabase, getSchema } from '../db';
import { encryptPassword, getConnectionById, getConnectionWithPassword, getUserConnections, listConnections, testConnection, type ConnectionResponse } from './connections';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface RoleMapEntry {
  roleId: string;
  roleName: string;
  clickhouseRole: string;
}

export interface IdentityView {
  identityMode: string;
  username: string;
  systemRole: string | null;
  impersonationRole: string | null;
  accessContact: string | null;
  health: string | null;
  healthReason: string | null;
  checkedAt: number | null;
  serverVersion: string | null;
  roleMap: RoleMapEntry[];
}

export interface IdentityChange {
  identityMode: string;
  username: string;
  /** Empty or absent keeps the stored password, which is only allowed when the username does not change. */
  password?: string;
  systemRole?: string | null;
  /** For `personal`: the ClickHouse role that holds the IMPERSONATE grants. */
  impersonationRole?: string | null;
  accessContact?: string | null;
  host?: string;
  port?: number;
  sslEnabled?: boolean;
}

export interface IdentityCheckResult {
  ok: boolean;
  verdict: IdentityVerdict;
  /** The ADR 0027 privilege check with the catalog for the kind; absent when the login could not be checked that far. */
  privileges?: PrivilegeReport;
  /** Why the login cannot be used, in one line; null when `ok`. */
  reason: string | null;
  /** True when the server itself cannot run the kind (its version lacks what the kind needs): no login would pass. */
  unsupported?: boolean;
  /** Which kinds the server the login is on can run. */
  support?: ServerSupport;
}

export async function getRoleMap(connectionId: string): Promise<RoleMapEntry[]> {
  const rows = await all(sql`
    SELECT m.role_id AS role_id, r.name AS role_name, m.clickhouse_role AS clickhouse_role
    FROM rbac_connection_role_map m JOIN rbac_roles r ON r.id = m.role_id
    WHERE m.connection_id = ${connectionId} ORDER BY r.name`);
  return rows.map((row) => ({ roleId: str(row.role_id), roleName: str(row.role_name), clickhouseRole: str(row.clickhouse_role) }));
}

/** True when a CHouse role is mapped to a ClickHouse role on any connection. Only a super admin may assign such a role (§6). */
export async function roleIsMapped(roleId: string): Promise<boolean> {
  const rows = await all(sql`SELECT COUNT(*) AS n FROM rbac_connection_role_map WHERE role_id = ${roleId}`);
  return num(rows[0]?.n) > 0;
}

/** True when any CHouse role is mapped on any connection. */
export async function anyRoleMapped(): Promise<boolean> {
  const rows = await all(sql`SELECT COUNT(*) AS n FROM rbac_connection_role_map`);
  return num(rows[0]?.n) > 0;
}

/** True when the account's role is mapped to a ClickHouse role on some connection. */
export async function holdsMappedRole(userId: string): Promise<boolean> {
  const rows = await all(sql`
    SELECT COUNT(*) AS n FROM rbac_user_roles ur JOIN rbac_connection_role_map m ON m.role_id = ur.role_id WHERE ur.user_id = ${userId}`);
  return num(rows[0]?.n) > 0;
}

/** True when the role given to an account created with no role is mapped. */
export async function defaultRoleIsMapped(): Promise<boolean> {
  const rows = await all(sql`
    SELECT COUNT(*) AS n FROM rbac_roles r JOIN rbac_connection_role_map m ON m.role_id = r.id WHERE r.is_default`);
  return num(rows[0]?.n) > 0;
}

/** The mapped roles among `roleIds`. */
export async function mappedRoleIds(roleIds: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const roleId of new Set(roleIds)) if (await roleIsMapped(roleId)) found.push(roleId);
  return found;
}

/**
 * Replace a connection's role map. Each CHouse role maps to at most one
 * ClickHouse role; a role left out loses its mapping, and its holders are
 * refused on the connection from their next request.
 */
export async function setRoleMap(connectionId: string, entries: ReadonlyArray<{ roleId: string; clickhouseRole: string }>, actorId: string): Promise<RoleMapEntry[]> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isRoleName(entry.clickhouseRole)) throw AppError.badRequest(`"${String(entry.clickhouseRole).slice(0, 60)}" is not a ClickHouse role name CHouse can use: letters, digits and underscores, not starting with a digit.`);
    if (seen.has(entry.roleId)) throw AppError.badRequest('A role can be mapped to one ClickHouse role only.');
    seen.add(entry.roleId);
  }
  if (seen.size > 0) {
    const known = new Set((await all(sql`SELECT id FROM rbac_roles`)).map((row) => str(row.id)));
    for (const roleId of seen) if (!known.has(roleId)) throw AppError.badRequest('One of the roles no longer exists.');
  }
  const now = Date.now();
  await runBatch([
    sql`DELETE FROM rbac_connection_role_map WHERE connection_id = ${connectionId}`,
    ...entries.map((entry) => sql`
      INSERT INTO rbac_connection_role_map (id, connection_id, role_id, clickhouse_role, created_by, created_at, updated_at)
      VALUES (${randomUUID()}, ${connectionId}, ${entry.roleId}, ${entry.clickhouseRole}, ${actorId}, ${now}, ${now})`),
  ]);
  return getRoleMap(connectionId);
}

export async function getIdentity(connection: ConnectionResponse): Promise<IdentityView> {
  return {
    identityMode: connection.identityMode,
    username: connection.username,
    systemRole: connection.systemRole,
    impersonationRole: connection.impersonationRole,
    accessContact: connection.accessContact,
    health: connection.identityHealth,
    healthReason: connection.identityHealthReason,
    checkedAt: connection.identityCheckedAt,
    serverVersion: connection.identityServerVersion,
    roleMap: await getRoleMap(connection.id),
  };
}

/** Why an account's statements would be refused on a connection, or `ready`. */
export type AccessState =
  | 'ready'
  /** A role-ceiling connection has no one ClickHouse role for the account: its role is not mapped, or it holds no role or several. */
  | 'no_usable_role'
  | 'no_link'
  | 'pending_grant'
  | 'suspended'
  | 'disabled'
  | 'connection_unavailable';

/** Which ClickHouse identity an account's statements carry on one connection. */
export interface CallerIdentity {
  connectionId: string;
  connectionName: string;
  /** `shared`, `shared_ceiling`, `personal`, or a kind this version does not know. */
  kind: string;
  /** What ClickHouse sees: the connection's login, the role named on each request, or the account's own user. Null when there is none. */
  runsAs: { type: 'login' | 'role' | 'user'; name: string } | null;
  state: AccessState;
  /** What the person is told when a statement is refused; null when `ready`. */
  detail: string | null;
  /** Statement forms this connection refuses for everyone, in words. Empty unless the kind has some. */
  limits: string[];
}

/** What a personal connection refuses for everyone, so a script or an agent need not find out one refusal at a time. */
export const PERSONAL_LIMITS: readonly string[] = [
  'Every statement is sent on its own: SET and USE are refused. Put settings in the statement\'s SETTINGS clause and qualify table names.',
  'INSERT with rows in the statement (VALUES or FORMAT data) is refused. Use INSERT ... SELECT or a file import.',
  'A FORMAT clause in the statement is refused: the caller chooses the output format.',
  'Only SELECT, SHOW, DESCRIBE, EXISTS, CHECK, EXPLAIN, INSERT ... SELECT, ALTER, UPDATE, DELETE, CREATE, DROP, TRUNCATE and KILL run. SYSTEM, GRANT, OPTIMIZE and RENAME are refused.',
  'Data access policies do not decide what a statement reaches here: the ClickHouse user\'s own grants do.',
];

const BINDING_STATES: ReadonlySet<string> = new Set(['pending_grant', 'suspended', 'disabled']);

/**
 * The identity one account's statements carry on one connection. It asks the
 * same function the executor asks before every request (`requestIdentity`),
 * so the answer cannot drift from what a statement would get.
 */
export async function callerIdentityOn(connection: ConnectionResponse, userId: string): Promise<CallerIdentity> {
  const identity = identityOfConnection(connection);
  const base = { connectionId: connection.id, connectionName: connection.name, kind: identity.mode, limits: identity.mode === 'personal' ? [...PERSONAL_LIMITS] : [] };
  if (identity.mode === 'shared') {
    return { ...base, runsAs: { type: 'login', name: connection.username }, state: 'ready', detail: null };
  }
  try {
    const resolved = await requestIdentity(identity, personActor(userId));
    if (resolved.executeAs) return { ...base, runsAs: { type: 'user', name: resolved.executeAs.user }, state: 'ready', detail: null };
    return { ...base, runsAs: resolved.role ? { type: 'role', name: resolved.role } : null, state: 'ready', detail: null };
  } catch (error) {
    if (!(error instanceof AppError) || (error.code !== 'IDENTITY_UNAVAILABLE' && error.code !== 'CONNECTION_UNAVAILABLE')) throw error;
    if (error.code === 'CONNECTION_UNAVAILABLE') return { ...base, runsAs: null, state: 'connection_unavailable', detail: error.message };
    if (identity.mode !== 'personal') return { ...base, runsAs: null, state: 'no_usable_role', detail: error.message };
    const rows = await all(sql`SELECT clickhouse_user, state FROM rbac_clickhouse_bindings WHERE user_id = ${userId} AND connection_id = ${connection.id}`);
    if (rows.length === 0) return { ...base, runsAs: null, state: 'no_link', detail: error.message };
    const stored = str(rows[0].state);
    // A state this version does not know runs nothing, like a disabled link.
    const state: AccessState = BINDING_STATES.has(stored) ? (stored as AccessState) : 'disabled';
    return { ...base, runsAs: { type: 'user', name: str(rows[0].clickhouse_user) }, state, detail: error.message };
  }
}

/**
 * The same for every connection the account can use, plus every personal
 * connection it holds a link on in any state: a person whose link is waiting
 * or suspended is not admitted to the connection, but should see why.
 */
export async function callerIdentities(userId: string, isSuperAdmin: boolean): Promise<CallerIdentity[]> {
  const usable = isSuperAdmin ? (await listConnections({ activeOnly: true })).connections : await getUserConnections(userId);
  const byId = new Map(usable.map((connection) => [connection.id, connection]));
  if (!isSuperAdmin) {
    for (const row of await all(sql`SELECT connection_id FROM rbac_clickhouse_bindings WHERE user_id = ${userId}`)) {
      const id = str(row.connection_id);
      if (byId.has(id)) continue;
      const linked = await getConnectionById(id);
      if (linked && linked.isActive && linked.identityMode === 'personal') byId.set(id, linked);
    }
  }
  const out: CallerIdentity[] = [];
  for (const connection of [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))) out.push(await callerIdentityOn(connection, userId));
  return out;
}

/**
 * The statements a ClickHouse administrator runs to prepare a login for a
 * `shared_ceiling` connection. Names are placeholders the administrator edits;
 * nothing here is sent to ClickHouse by CHouse.
 */
export function ceilingSetupStatements(username: string, systemRole: string, mapped: readonly string[]): string[] {
  const roles = [systemRole, ...mapped.filter((role) => role !== systemRole)];
  return [
    `CREATE ROLE IF NOT EXISTS ${systemRole};`,
    `GRANT SELECT ON system.* TO ${systemRole};`,
    `GRANT SHOW ON *.* TO ${systemRole};`,
    `GRANT KILL QUERY ON *.* TO ${systemRole};`,
    ...mapped.filter((role) => role !== systemRole).flatMap((role) => [
      `CREATE ROLE IF NOT EXISTS ${role};`,
      `-- GRANT SELECT ON <database>.* TO ${role};   -- the data this CHouse role may reach`,
      `-- GRANT SELECT ON system.* TO ${role};       -- optional: lets its people use the Monitoring pages`,
    ]),
    `CREATE USER IF NOT EXISTS ${username} IDENTIFIED BY '<password>';`,
    `GRANT ${roles.join(', ')} TO ${username};`,
    `ALTER USER ${username} DEFAULT ROLE NONE;`,
  ];
}

/**
 * The statements a ClickHouse administrator runs to prepare a login for a
 * `personal` connection. The login holds two roles and nothing else: one for
 * CHouse's own reads of system tables, one that may run statements as the
 * linked users. Nothing here is sent to ClickHouse by CHouse.
 */
export function personalSetupStatements(username: string, systemRole: string, impersonationRole: string): string[] {
  return [
    `CREATE ROLE IF NOT EXISTS ${systemRole};`,
    `GRANT SELECT ON system.* TO ${systemRole};`,
    `GRANT SHOW ON *.* TO ${systemRole};`,
    `GRANT KILL QUERY ON *.* TO ${systemRole};`,
    `CREATE ROLE IF NOT EXISTS ${impersonationRole};`,
    `CREATE USER IF NOT EXISTS ${username} IDENTIFIED BY '<password>';`,
    `GRANT IMPERSONATE ON ${username} TO ${impersonationRole};   -- lets CHouse test the server; the login itself holds no grant`,
    `-- GRANT IMPERSONATE ON <user> TO ${impersonationRole};     -- one line per linked ClickHouse user (Admin › Connections shows them)`,
    `GRANT ${systemRole}, ${impersonationRole} TO ${username};`,
    `ALTER USER ${username} DEFAULT ROLE NONE;`,
  ];
}

interface ResolvedChange {
  impersonationRole: string | null;
  mode: string;
  host: string;
  port: number;
  sslEnabled: boolean;
  username: string;
  password: string;
  systemRole: string | null;
  accessContact: string | null;
  database: string | null;
}

async function resolveChange(connectionId: string, change: IdentityChange): Promise<ResolvedChange> {
  const current = await getConnectionWithPassword(connectionId);
  if (!current) throw AppError.notFound('Connection not found');
  if (!isKnownMode(change.identityMode)) throw AppError.badRequest(`Unknown connection kind "${String(change.identityMode).slice(0, 40)}".`);
  const username = change.username.trim();
  if (!username) throw AppError.badRequest('A ClickHouse user is required.');
  let password = change.password ?? '';
  if (!password) {
    if (username !== current.username) throw AppError.badRequest('Enter the password of the new ClickHouse user.');
    // The stored password is for the stored server: never send it to another host, or over plain HTTP after TLS.
    const sameServer = (change.host ?? current.host) === current.host && (change.port ?? current.port) === current.port && (change.sslEnabled ?? current.sslEnabled) === current.sslEnabled;
    if (!sameServer) throw AppError.badRequest('Enter the password again when the host, port or TLS setting changes.');
    password = current.password || '';
  }
  const systemRole = change.identityMode === 'shared' ? null : (change.systemRole ?? '').trim() || null;
  if (change.identityMode !== 'shared' && !isRoleName(systemRole)) {
    throw AppError.badRequest('A system role is required: the ClickHouse role CHouse names for its own work. Letters, digits and underscores.');
  }
  const impersonationRole = change.identityMode === 'personal' ? (change.impersonationRole ?? '').trim() || null : null;
  if (change.identityMode === 'personal') {
    if (!isRoleName(impersonationRole)) {
      throw AppError.badRequest('An impersonation role is required: the ClickHouse role that may run statements as the linked users. Letters, digits and underscores.');
    }
    if (impersonationRole === systemRole) throw AppError.badRequest('The impersonation role and the system role must be two roles.');
  }
  const accessContact = change.accessContact === undefined ? current.accessContact : (change.accessContact ?? '').trim() || null;
  if (accessContact && accessContact.length > 500) throw AppError.badRequest('The access contact is at most 500 characters.');
  return {
    mode: change.identityMode,
    host: change.host ?? current.host,
    port: change.port ?? current.port,
    sslEnabled: change.sslEnabled ?? current.sslEnabled,
    username,
    password,
    systemRole,
    impersonationRole,
    accessContact,
    database: current.database,
  };
}

/**
 * Which kinds the server of a saved connection can run, asked with its stored
 * login. Shown before a switch, so a kind the server cannot run is blocked
 * before anyone prepares a login for it.
 */
export async function connectionKindSupport(connectionId: string): Promise<ServerSupport> {
  const connection = await getConnectionWithPassword(connectionId);
  if (!connection) throw AppError.notFound('Connection not found');
  const url = `${connection.sslEnabled ? 'https' : 'http'}://${connection.host}:${connection.port}`;
  return probeKindSupport({ url, username: connection.username, password: connection.password || '', database: connection.database || undefined });
}

/** Check a login for a kind without saving anything: the identity checks, then the privilege check for that kind. */
export async function checkIdentityChange(connectionId: string, change: IdentityChange): Promise<{ result: IdentityCheckResult; resolved: ResolvedChange }> {
  const resolved = await resolveChange(connectionId, change);
  const url = `${resolved.sslEnabled ? 'https' : 'http'}://${resolved.host}:${resolved.port}`;
  // First, whether this server can run the kind at all. A server that cannot is refused with that one reason,
  // not with a list of failed checks that each fail for it.
  const support = await probeKindSupport({ url, username: resolved.username, password: resolved.password, database: resolved.database || undefined });
  const kind = supportOf(support, resolved.mode);
  if (kind && kind.state === 'unavailable') {
    const verdict: IdentityVerdict = {
      ok: false,
      reason: kind.reason,
      checks: [{ id: 'version', label: 'The server can run this kind of connection', ok: false, detail: kind.reason }],
      serverVersion: support.serverVersion,
    };
    return { result: { ok: false, verdict, reason: kind.reason, unsupported: true, support }, resolved };
  }
  const verdict = await runIdentityChecks({
    config: { url, username: resolved.username, password: resolved.password, database: resolved.database || undefined },
    mode: resolved.mode,
    systemRole: resolved.systemRole,
    impersonationRole: resolved.impersonationRole,
    host: resolved.host,
    port: resolved.port,
    connectionId,
  });
  if (!verdict.ok) return { result: { ok: false, verdict, reason: verdict.reason, support }, resolved };
  const tested = await testConnection(
    { name: 'identity-check', host: resolved.host, port: resolved.port, username: resolved.username, password: resolved.password, database: resolved.database, sslEnabled: resolved.sslEnabled },
    resolved.mode !== 'shared' && resolved.systemRole ? { kind: resolved.mode, systemRole: resolved.systemRole } : undefined,
  );
  if (!tested.success) return { result: { ok: false, verdict, reason: tested.error || 'Could not connect to ClickHouse.', support }, resolved };
  if (tested.privileges && !tested.privileges.ok) {
    const holder = resolved.mode === 'shared' ? resolved.username : resolved.systemRole;
    return { result: { ok: false, verdict, privileges: tested.privileges, reason: `${holder} is missing ${tested.privileges.missingCount} privilege${tested.privileges.missingCount === 1 ? '' : 's'} CHouse needs.` }, resolved };
  }
  return { result: { ok: true, verdict, privileges: tested.privileges, reason: null, support }, resolved };
}

/**
 * Switch a connection's kind, or replace the login of a connection that is
 * not `shared`. Refused unless every check passes. One write stores the kind,
 * the login and the role names; pooled clients are keyed by login, so the next
 * request opens a client for the new one.
 */
export async function switchIdentity(connectionId: string, change: IdentityChange): Promise<IdentityCheckResult> {
  const { result, resolved } = await checkIdentityChange(connectionId, change);
  if (!result.ok) return result;
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const before = await getConnectionWithPassword(connectionId);
  const movedServer = !before || before.host !== resolved.host || before.port !== resolved.port;
  await db.update(schema.clickhouseConnections)
    .set({
      identityMode: resolved.mode,
      host: resolved.host,
      port: resolved.port,
      sslEnabled: resolved.sslEnabled,
      username: resolved.username,
      passwordEncrypted: resolved.password ? encryptPassword(resolved.password) : null,
      systemRole: resolved.systemRole,
      impersonationRole: resolved.impersonationRole,
      accessContact: resolved.accessContact,
      identityHealth: null,
      identityHealthReason: null,
      identityCheckedAt: null,
      identityServerVersion: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.clickhouseConnections.id, connectionId));
  if (resolved.mode !== 'shared') await writeVerdict(connectionId, resolved.username, result.verdict);
  resetCreateChecks();
  const { checkConnectionBindings, resetBindingsOfConnection } = await import('./clickhouseBindings');
  // A user of the same name on another server is another user: no link stays in use across a move.
  if (movedServer) await resetBindingsOfConnection(connectionId);
  if (resolved.mode === 'personal') {
    // Links prepared while the connection was another kind can be tested now. A test that cannot run changes nothing.
    await checkConnectionBindings(connectionId).catch(() => undefined);
  }
  return result;
}

/** Set only the access contact, which is not part of the login. */
export async function setAccessContact(connectionId: string, accessContact: string | null): Promise<void> {
  const value = (accessContact ?? '').trim() || null;
  if (value && value.length > 500) throw AppError.badRequest('The access contact is at most 500 characters.');
  await run(sql`UPDATE rbac_clickhouse_connections SET access_contact = ${value} WHERE id = ${connectionId}`);
}
