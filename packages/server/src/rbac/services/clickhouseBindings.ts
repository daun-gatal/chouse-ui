/**
 * Bindings (ADR 0033 §7.4): which ClickHouse user an account's statements run
 * as on a `personal` connection. One row per account and connection, and one
 * account per ClickHouse user on a connection.
 *
 *   pending_grant  created; ClickHouse has not yet let the connection act as the user
 *   active         the account's statements run as the user
 *   suspended      how the account signs in changed and its holder did not do it
 *   disabled       the user behind the name changed, is gone, or holds a privilege
 *                  no bound user may hold; only removing it and creating a new one helps
 *
 * Only a super admin creates, confirms or removes a binding: it decides whose
 * ClickHouse grants an account gets. CHouse stores no ClickHouse password for
 * a bound user; the ClickHouse administrator allows the binding with a grant
 * CHouse cannot run itself.
 */

import { randomUUID } from 'node:crypto';

import { all, run, sql, str, strOrNull, numOrNull, type Row } from '../../services/observe/db';
import { connectionConfig, executorForConfig } from '../../services/chExecutor/executor';
import { clickhouseErrorCode } from '../../services/chExecutor/errors';
import { forbiddenGrant, impersonationTarget, parseGrantLine } from '../../services/chExecutor/health';
import { isBindableUserName, isRoleName } from '../../services/chExecutor/identity';
import { wrapperFor } from '../../services/chExecutor/impersonate';
import { serviceActor, type ChExecutor } from '../../services/chExecutor/types';
import { resetVisibleTables } from '../../services/chExecutor/visibleTables';
import { AppError, type ConnectionConfig } from '../../types';
import { logger } from '../../utils/logger';
import { escapeIdentifier } from '../../utils/sqlIdentifier';
import { AUDIT_ACTIONS } from '../schema/base';

export const BINDING_STATES = ['pending_grant', 'active', 'suspended', 'disabled'] as const;
export type BindingState = (typeof BINDING_STATES)[number];

export interface BindingView {
  id: string;
  userId: string;
  /** The CHouse account, for a super admin's list. */
  accountName: string | null;
  accountEmail: string | null;
  connectionId: string;
  connectionName: string | null;
  /** The connection's kind: a binding on a connection that is not `personal` is prepared, not in use. */
  connectionKind: string | null;
  clickhouseUser: string;
  defaultDatabase: string | null;
  state: BindingState;
  reason: string | null;
  checkedAt: number | null;
  createdAt: number | null;
}

const ACCESS_DENIED = 497;
const CHECK_SECONDS = 15;

function toState(value: unknown): BindingState {
  const state = str(value);
  // A value this version does not know is treated as the state nothing runs in.
  return (BINDING_STATES as readonly string[]).includes(state) ? (state as BindingState) : 'disabled';
}

function toView(row: Row): BindingView {
  return {
    id: str(row.id),
    userId: str(row.user_id),
    accountName: strOrNull(row.account_name),
    accountEmail: strOrNull(row.account_email),
    connectionId: str(row.connection_id),
    connectionName: strOrNull(row.connection_name),
    connectionKind: strOrNull(row.connection_kind),
    clickhouseUser: str(row.clickhouse_user),
    defaultDatabase: strOrNull(row.default_database),
    state: toState(row.state),
    reason: strOrNull(row.reason),
    checkedAt: numOrNull(row.checked_at),
    createdAt: numOrNull(row.created_at),
  };
}

const SELECT_VIEW = sql`
  SELECT b.id AS id, b.user_id AS user_id, u.username AS account_name, u.email AS account_email,
         b.connection_id AS connection_id, c.name AS connection_name, c.identity_mode AS connection_kind,
         b.clickhouse_user AS clickhouse_user, b.default_database AS default_database, b.state AS state,
         b.reason AS reason, b.checked_at AS checked_at, b.created_at AS created_at
  FROM rbac_clickhouse_bindings b
  JOIN rbac_users u ON u.id = b.user_id
  JOIN rbac_clickhouse_connections c ON c.id = b.connection_id`;

export async function listBindingsOfConnection(connectionId: string): Promise<BindingView[]> {
  return (await all(sql`${SELECT_VIEW} WHERE b.connection_id = ${connectionId} ORDER BY u.username`)).map(toView);
}

export async function listBindingsOfUser(userId: string): Promise<BindingView[]> {
  return (await all(sql`${SELECT_VIEW} WHERE b.user_id = ${userId} ORDER BY c.name`)).map(toView);
}

export async function getBinding(id: string): Promise<BindingView | null> {
  const rows = await all(sql`${SELECT_VIEW} WHERE b.id = ${id}`);
  return rows.length > 0 ? toView(rows[0]) : null;
}

async function audit(action: string, actorId: string | undefined, binding: { id: string; userId: string; connectionId: string; clickhouseUser: string }, details: Record<string, unknown>): Promise<void> {
  try {
    const { createAuditLog } = await import('./rbac');
    await createAuditLog(action as never, actorId, {
      resourceType: 'clickhouse_binding',
      resourceId: binding.id,
      details: { connectionId: binding.connectionId, accountId: binding.userId, clickhouseUser: binding.clickhouseUser, ...details },
    });
  } catch (error) {
    logger.warn({ module: 'Bindings', err: error instanceof Error ? error.message : String(error) }, 'Could not write the audit entry for a binding change');
  }
}

/** Store a state. Every change is audited; `actorId` is absent when CHouse's own check made it. */
async function setState(binding: BindingView, state: BindingState, reason: string | null, actorId?: string, extra: { defaultDatabase?: string | null } = {}): Promise<void> {
  const now = Date.now();
  const defaultDatabase = extra.defaultDatabase === undefined ? binding.defaultDatabase : extra.defaultDatabase;
  // Only from the state the decision was made on: a check that started before a suspension must not write over it.
  await run(sql`
    UPDATE rbac_clickhouse_bindings
    SET state = ${state}, reason = ${reason ? reason.slice(0, 500) : null}, default_database = ${defaultDatabase}, checked_at = ${now}, updated_at = ${now}
    WHERE id = ${binding.id} AND state = ${binding.state}`);
  resetVisibleTables();
  const stored = await all(sql`SELECT state FROM rbac_clickhouse_bindings WHERE id = ${binding.id}`);
  if (stored.length === 0 || str(stored[0].state) !== state) return;
  if (state !== binding.state) {
    await audit(AUDIT_ACTIONS.BINDING_STATE_CHANGED, actorId, binding, { from: binding.state, to: state, reason });
  }
}

/** The remediation login stored for a connection, or null when it has none. Any other failure is thrown: it must not read as "none". */
async function remediationLoginOf(connectionId: string): Promise<string | null> {
  try {
    return (await connectionConfig(connectionId, 'remediation')).username;
  } catch (error) {
    if (error instanceof Error && /has no remediation login/.test(error.message)) return null;
    throw error;
  }
}

interface Probe {
  /** Reads with the system role (or, on a `shared` connection, the login itself). */
  system: ChExecutor;
  /** Sends with the impersonation role; null when the connection has none yet. */
  impersonating: ChExecutor | null;
  login: string;
}

async function probeFor(connectionId: string): Promise<Probe> {
  const config: ConnectionConfig = await connectionConfig(connectionId);
  const identity = config.identity;
  const bare: ConnectionConfig = { ...config, identity: undefined };
  const handle = (role: string | null): ChExecutor =>
    executorForConfig(bare, serviceActor('health-check'), { roleOverride: role, context: { source: 'binding_check' } }).onServiceLane();
  const shared = !identity || identity.mode === 'shared';
  return {
    system: handle(shared ? null : identity.systemRole),
    impersonating: identity && identity.mode === 'personal' && isRoleName(identity.impersonationRole) ? handle(identity.impersonationRole) : null,
    login: config.username,
  };
}

async function lines(client: ChExecutor, query: string, params?: Record<string, unknown>): Promise<string[]> {
  const result = await client.query({ query, query_params: params, format: 'TabSeparatedRaw', abort_signal: AbortSignal.timeout(CHECK_SECONDS * 1000), clickhouse_settings: { max_execution_time: CHECK_SECONDS } });
  return (await result.text()).split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0].trim().slice(0, 240);
}

/** The id ClickHouse gave the user with this name, or null when there is none. */
async function userIdByName(probe: Probe, name: string): Promise<string | null> {
  const found = await lines(probe.system, 'SELECT toString(id) FROM system.users WHERE name = {n:String}', { n: name });
  return found[0] ?? null;
}

/**
 * Why a user may not be bound, from its own grants read as that user, or null.
 * A bound user must not be able to manage users, pass grants on, or act as
 * someone else: an account could otherwise widen what its binding gives it.
 * The roles it holds are followed, since a role can hold the same.
 */
async function excludedByGrants(probe: Probe & { impersonating: ChExecutor }, user: string): Promise<string | null> {
  const wrapper = wrapperFor(user);
  const seen = new Set<string>();
  const queue: Array<string | null> = [null];
  while (queue.length > 0) {
    const role = queue.shift() ?? null;
    if (role !== null) {
      if (seen.has(role)) continue;
      seen.add(role);
      if (seen.size > 200) return 'it reaches more than 200 roles, too many to check';
    }
    for (const raw of await lines(probe.impersonating, role === null ? `${wrapper}SHOW GRANTS` : `${wrapper}SHOW GRANTS FOR ${role}`)) {
      const grant = parseGrantLine(raw);
      const problem = forbiddenGrant(grant);
      if (problem) return `${role === null ? 'it' : `its role ${role}`} holds ${problem}`;
      for (const nested of grant.roles) {
        if (!isRoleName(nested)) return 'it holds a role whose name CHouse cannot check (letters, digits and underscores only)';
        queue.push(nested);
      }
    }
  }
  return null;
}

/**
 * Run a binding's checks against ClickHouse and store the state they give.
 * A check that could not run (the server did not answer) changes nothing: only
 * what ClickHouse actually said moves a binding. Suspended and disabled
 * bindings are not tested; a person's action moves those.
 */
export async function testBinding(given: BindingView, actorId?: string): Promise<BindingView> {
  // The row as it is now: a round that listed its bindings minutes ago must not act on a state that changed since.
  const binding = await getBinding(given.id);
  if (!binding) return given;
  if (binding.state === 'suspended' || binding.state === 'disabled') return binding;
  let probe: Probe;
  try {
    probe = await probeFor(binding.connectionId);
  } catch (error) {
    logger.warn({ module: 'Bindings', bindingId: binding.id, err: firstLine(error) }, 'Binding check could not start');
    return binding;
  }
  try {
    const stored = await all(sql`SELECT clickhouse_user_id FROM rbac_clickhouse_bindings WHERE id = ${binding.id}`);
    const storedId = stored.length > 0 ? str(stored[0].clickhouse_user_id) : '';
    const currentId = await userIdByName(probe, binding.clickhouseUser);
    if (currentId === null) {
      await setState(binding, 'disabled', `The ClickHouse user ${binding.clickhouseUser} no longer exists.`, actorId);
      return (await getBinding(binding.id)) ?? binding;
    }
    if (currentId !== storedId) {
      // The grant is by name and survives a drop and recreate, so the id is what shows a different user behind the name.
      await setState(binding, 'disabled', `The ClickHouse user ${binding.clickhouseUser} was dropped and created again since this link was made, so it may be a different person's.`, actorId);
      return (await getBinding(binding.id)) ?? binding;
    }
    if (binding.clickhouseUser === probe.login || binding.clickhouseUser === (await remediationLoginOf(binding.connectionId))) {
      // Linked while the connection had another login: the connection's own login is never a person's identity.
      await setState(binding, 'disabled', `${binding.clickhouseUser} is now one of this connection's own logins, so it cannot be linked to an account.`, actorId);
      return (await getBinding(binding.id)) ?? binding;
    }
    if (!probe.impersonating) {
      const waiting = 'The connection is not a personal connection yet.';
      if (binding.state !== 'pending_grant' || binding.reason !== waiting) await setState(binding, 'pending_grant', waiting, actorId);
      return (await getBinding(binding.id)) ?? binding;
    }
    const impersonating = { ...probe, impersonating: probe.impersonating };
    try {
      await lines(probe.impersonating, `${wrapperFor(binding.clickhouseUser)}SELECT 1`);
    } catch (error) {
      if (clickhouseErrorCode(error) !== ACCESS_DENIED) throw error;
      await setState(binding, 'pending_grant', `Waiting for a ClickHouse administrator to run the grant for ${binding.clickhouseUser}.`, actorId);
      return (await getBinding(binding.id)) ?? binding;
    }
    const excluded = await excludedByGrants(impersonating, binding.clickhouseUser);
    if (excluded) {
      await setState(binding, 'disabled', `The ClickHouse user ${binding.clickhouseUser} cannot be linked: ${excluded}.`, actorId);
      return (await getBinding(binding.id)) ?? binding;
    }
    const database = (await lines(probe.impersonating, `${wrapperFor(binding.clickhouseUser)}SELECT currentDatabase()`))[0] ?? 'default';
    await setState(binding, 'active', null, actorId, { defaultDatabase: database });
  } catch (error) {
    logger.warn({ module: 'Bindings', bindingId: binding.id, err: firstLine(error) }, 'Binding check could not finish');
  }
  return (await getBinding(binding.id)) ?? binding;
}

/**
 * Create a binding: a super admin picks an account and names a ClickHouse
 * user. CHouse reads that user's id by name and stores it, so a later user of
 * the same name is not taken for this one.
 */
export async function createBinding(connectionId: string, userId: string, clickhouseUser: string, actorId: string): Promise<BindingView> {
  const name = clickhouseUser.trim();
  if (!isBindableUserName(name)) {
    throw AppError.badRequest('A ClickHouse user can be linked when its name is made of letters, digits and underscores, and does not start with a digit.');
  }
  if (name === 'default') throw AppError.badRequest('The ClickHouse user default cannot be linked to an account.');
  const connection = await all(sql`SELECT id FROM rbac_clickhouse_connections WHERE id = ${connectionId}`);
  if (connection.length === 0) throw AppError.notFound('Connection not found');
  const account = await all(sql`SELECT id FROM rbac_users WHERE id = ${userId}`);
  if (account.length === 0) throw AppError.badRequest('The account no longer exists.');
  // A connection's own login must never be a person's identity: it is how CHouse itself reaches ClickHouse.
  const logins = await all(sql`SELECT 1 AS one FROM rbac_clickhouse_connections WHERE username = ${name}`);
  if (logins.length > 0) throw AppError.badRequest(`${name} is the login of a connection, so it cannot be linked to an account.`);
  // A remediation login is another of CHouse's own identities, on whichever connection it is stored.
  for (const row of await all(sql`SELECT id FROM rbac_clickhouse_connections`)) {
    if ((await remediationLoginOf(str(row.id))) === name) throw AppError.badRequest(`${name} is a connection's remediation login, so it cannot be linked to an account.`);
  }
  const taken = await all(sql`SELECT 1 AS one FROM rbac_clickhouse_bindings WHERE connection_id = ${connectionId} AND user_id = ${userId}`);
  if (taken.length > 0) throw AppError.conflict('This account already has a link on this connection. Remove it first.');

  let userIdInClickHouse: string | null;
  try {
    userIdInClickHouse = await userIdByName(await probeFor(connectionId), name);
  } catch (error) {
    throw new AppError(`CHouse could not look up the ClickHouse user: ${firstLine(error)}`, 'BINDING_LOOKUP_FAILED', 'validation', 422);
  }
  if (userIdInClickHouse === null) {
    throw new AppError(`There is no ClickHouse user named ${name} on this connection, or the connection's system role may not read system.users.`, 'BINDING_USER_NOT_FOUND', 'validation', 422);
  }
  const same = await all(sql`SELECT 1 AS one FROM rbac_clickhouse_bindings WHERE connection_id = ${connectionId} AND clickhouse_user_id = ${userIdInClickHouse}`);
  if (same.length > 0) throw AppError.conflict(`${name} is already linked to another account on this connection. One ClickHouse user belongs to one account.`);

  const id = randomUUID();
  const now = Date.now();
  await run(sql`
    INSERT INTO rbac_clickhouse_bindings (id, user_id, connection_id, clickhouse_user, clickhouse_user_id, default_database, state, reason, created_by, created_at, updated_at, checked_at)
    VALUES (${id}, ${userId}, ${connectionId}, ${name}, ${userIdInClickHouse}, ${null}, 'pending_grant', ${null}, ${actorId}, ${now}, ${now}, ${null})`);
  const created = await getBinding(id);
  if (!created) throw AppError.internal('The link was not stored');
  await audit(AUDIT_ACTIONS.BINDING_CREATED, actorId, created, {});
  return testBinding(created, actorId);
}

/** A super admin confirms a suspended binding again: it goes back to waiting for ClickHouse, then is tested. */
export async function confirmBinding(id: string, actorId: string): Promise<BindingView> {
  const binding = await getBinding(id);
  if (!binding) throw AppError.notFound('Link not found');
  if (binding.state === 'disabled') throw AppError.badRequest('A disabled link cannot be confirmed. Remove it and create a new one.');
  if (binding.state !== 'suspended') return testBinding(binding, actorId);
  await setState(binding, 'pending_grant', null, actorId);
  return testBinding({ ...binding, state: 'pending_grant', reason: null }, actorId);
}

/** "Check again": run the checks now. Does nothing for a suspended or disabled binding. */
export async function recheckBinding(id: string, actorId: string): Promise<BindingView> {
  const binding = await getBinding(id);
  if (!binding) throw AppError.notFound('Link not found');
  return testBinding(binding, actorId);
}

export async function removeBinding(id: string, actorId: string): Promise<void> {
  const binding = await getBinding(id);
  if (!binding) throw AppError.notFound('Link not found');
  await run(sql`DELETE FROM rbac_clickhouse_bindings WHERE id = ${id}`);
  resetVisibleTables();
  await audit(AUDIT_ACTIONS.BINDING_REMOVED, actorId, binding, { state: binding.state });
}

/**
 * Suspend every binding of an account that is in use or waiting. Called when
 * something changed how the account signs in and its holder did not do it: a
 * password reset or an email change by someone else, an identity link added
 * or removed, a reactivation. Whoever now signs in may not be the person the
 * binding was made for, so a super admin confirms it again.
 */
export async function suspendBindingsOf(userId: string, reason: string, actorId?: string): Promise<number> {
  const rows = (await all(sql`${SELECT_VIEW} WHERE b.user_id = ${userId} AND b.state IN ('active', 'pending_grant')`)).map(toView);
  for (const binding of rows) await setState(binding, 'suspended', reason, actorId);
  return rows.length;
}

/**
 * After a connection was pointed at another server: its links were made for
 * users of the old one, so every link in use goes back to waiting until the
 * checks pass against the new server.
 */
export async function resetBindingsOfConnection(connectionId: string, actorId?: string): Promise<void> {
  for (const binding of await listBindingsOfConnection(connectionId)) {
    if (binding.state === 'active') await setState(binding, 'pending_grant', 'The connection was pointed at another server.', actorId);
  }
}

/** The health timer's round for one personal connection: every binding that is in use or waiting. */
export async function checkConnectionBindings(connectionId: string): Promise<void> {
  for (const binding of await listBindingsOfConnection(connectionId)) {
    if (binding.state === 'active' || binding.state === 'pending_grant') await testBinding(binding);
  }
}

/**
 * An account name as the text of a SQL line comment. The script is handed to
 * a ClickHouse administrator to run, and an account name is free text: a line
 * break in one would end the comment and start a statement of its author's.
 */
export function commentText(value: string): string {
  return value.replace(/[^A-Za-z0-9._@+ -]/g, '_').slice(0, 80);
}

export interface GrantScript {
  /** Statements for the ClickHouse administrator: one grant per binding that waits for it. */
  grants: string[];
  /** Users the impersonation role may act as that no binding uses, with the statement that takes the grant away. A warning. */
  unbound: Array<{ user: string; revoke: string }>;
}

/**
 * What to hand to the ClickHouse administrator for a connection. `role` is
 * the impersonation role, or a placeholder while the connection has none.
 */
export async function grantScript(connectionId: string): Promise<GrantScript> {
  const bindings = await listBindingsOfConnection(connectionId);
  const rows = await all(sql`SELECT impersonation_role, identity_mode, username FROM rbac_clickhouse_connections WHERE id = ${connectionId}`);
  const stored = rows.length > 0 ? strOrNull(rows[0].impersonation_role) : null;
  const role = isRoleName(stored) ? stored : '<impersonation role>';
  const grants = bindings
    .filter((binding) => binding.state === 'pending_grant')
    .map((binding) => `GRANT IMPERSONATE ON ${binding.clickhouseUser} TO ${role};  -- ${commentText(binding.accountName ?? binding.userId)}`);
  const unbound: GrantScript['unbound'] = [];
  if (rows.length > 0 && str(rows[0].identity_mode) === 'personal' && isRoleName(stored)) {
    try {
      const probe = await probeFor(connectionId);
      if (probe.impersonating) {
        const bound = new Set(bindings.map((binding) => binding.clickhouseUser));
        for (const raw of await lines(probe.impersonating, `SHOW GRANTS FOR ${stored}`)) {
          const target = impersonationTarget(parseGrantLine(raw));
          // The login's grant on itself is what the self-test uses.
          if ('user' in target && target.user !== probe.login && !bound.has(target.user)) {
            unbound.push({ user: target.user, revoke: `REVOKE IMPERSONATE ON ${isRoleName(target.user) ? target.user : escapeIdentifier(target.user)} FROM ${stored};` });
          }
        }
      }
    } catch (error) {
      logger.warn({ module: 'Bindings', connectionId, err: firstLine(error) }, 'Could not list the impersonation role\'s grants');
    }
  }
  return { grants, unbound };
}

/** How many accounts could use the connection if it were personal now, for the report shown before a switch. */
export async function bindingCounts(connectionId: string): Promise<Record<BindingState, number>> {
  const counts: Record<BindingState, number> = { pending_grant: 0, active: 0, suspended: 0, disabled: 0 };
  for (const binding of await listBindingsOfConnection(connectionId)) counts[binding.state] += 1;
  return counts;
}
