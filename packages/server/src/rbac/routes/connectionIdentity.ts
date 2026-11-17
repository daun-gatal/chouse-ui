/**
 * Connection kinds and the role ceiling (ADR 0033 §5, §6), super admin only.
 *
 *   POST /connections/identity                create a role-ceiling or personal connection (ADR 0034)
 *   POST /connections/identity/check          the same checks for a connection not created yet; saves nothing
 *   GET  /connections/:id/identity            kind, role names, health, role map, setup statements
 *   POST /connections/:id/identity/check      run the checks against a login; saves nothing
 *   PUT  /connections/:id/identity            the switch: kind, login and role names in one write
 *   PUT  /connections/:id/identity/contact    the access contact only
 *   GET  /connections/:id/identity/role-map
 *   PUT  /connections/:id/identity/role-map
 *   POST /connections/:id/identity/recheck    run the stored login's checks now
 *
 * Only a super admin may use these: the kind and the role map decide what
 * ClickHouse lets every account do, so an admin could otherwise widen their
 * own access.
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

import { checkSavedConnection } from '../../services/chExecutor/health';
import { AppError, requireParam } from '../../types';
import { getClientIp, getRbacUser, rbacAuthMiddleware, refuseScopedToken, requireJwtSession } from '../middleware';
import { AUDIT_ACTIONS, type AuditAction } from '../schema/base';
import {
  callerIdentities,
  ceilingSetupStatements,
  personalSetupStatements,
  checkIdentityChange,
  connectionKindSupport,
  getIdentity,
  createConnectionWithIdentity,
  getRoleMap,
  setAccessContact,
  setRoleMap,
  switchIdentity,
  type IdentityCheckResult,
} from '../services/connectionIdentity';
import { getConnectionById, type ConnectionResponse } from '../services/connections';
import { createAuditLogWithContext } from '../services/rbac';

const connectionIdentityRoutes = new Hono();

const changeSchema = z.object({
  identityMode: z.string().min(1).max(40),
  username: z.string().min(1).max(255),
  password: z.string().max(1000).optional(),
  systemRole: z.string().max(128).nullish(),
  impersonationRole: z.string().max(128).nullish(),
  accessContact: z.string().max(500).nullish(),
  host: z.string().min(1).max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  sslEnabled: z.boolean().optional(),
  database: z.string().max(255).nullish(),
});

/** A connection created with its kind: the login fields plus a name. Strict, so a typo is refused, not ignored. */
const createSchema = changeSchema.extend({
  name: z.string().min(1).max(255),
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  sslEnabled: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const roleMapSchema = z.object({
  entries: z.array(z.object({ roleId: z.string().min(1).max(255), clickhouseRole: z.string().min(1).max(128) })).max(500),
});

const contactSchema = z.object({ accessContact: z.string().max(500).nullable() });

function requireSuperAdmin(c: Context): string {
  // The role is all that gates these routes; a token that names a scope does not carry it, and is told so.
  refuseScopedToken(c);
  const user = getRbacUser(c);
  if (!user.roles.includes('super_admin')) {
    throw AppError.forbidden('Only a super admin can change how a connection reaches ClickHouse.');
  }
  return user.sub;
}

async function load(c: Context): Promise<ConnectionResponse> {
  const connection = await getConnectionById(requireParam(c, 'id'));
  if (!connection) throw AppError.notFound('Connection not found');
  return connection;
}

/** What a refused check or switch returns: the checks, so the form can show which one failed. */
function refused(c: Context, result: IdentityCheckResult): Response {
  // A server that cannot run the kind at all is its own answer: no change to the login would help.
  const code = result.unsupported ? 'KIND_UNSUPPORTED_ON_SERVER' : 'IDENTITY_CHECK_FAILED';
  return c.json({ success: false, error: { code, message: result.reason ?? 'The login did not pass the checks.', details: result } }, 422);
}

/** A refused create or switch is recorded too: who tried which login for which kind, and the check that failed. Never the password. */
async function auditRefusal(c: Context, actor: string, action: AuditAction, resourceId: string | undefined, details: Record<string, unknown>, result: IdentityCheckResult): Promise<void> {
  const failed = result.verdict.checks.find((check) => !check.ok);
  await createAuditLogWithContext(c, action, actor, {
    resourceType: 'connection',
    resourceId,
    details: { ...details, failedCheck: failed?.id ?? (result.privileges && !result.privileges.ok ? 'privileges' : 'connect'), reason: result.reason?.slice(0, 300) ?? null },
    ipAddress: getClientIp(c),
    status: 'failure',
  });
}

/**
 * Create a connection that is role-ceiling or personal from the start. The
 * same checks as a switch run first; on success one insert writes the row
 * with its kind and verdict. Registered before `/:id/identity`.
 */
connectionIdentityRoutes.post('/identity', rbacAuthMiddleware, zValidator('json', createSchema), async (c) => {
  // It stores a ClickHouse password and decides whose grants every statement runs with: a browser session only.
  requireJwtSession(c);
  const actor = requireSuperAdmin(c);
  const input = c.req.valid('json');
  const summary = { name: input.name, host: input.host, port: input.port, identityMode: input.identityMode, username: input.username, systemRole: input.systemRole ?? null, impersonationRole: input.impersonationRole ?? null };
  const { result, connection } = await createConnectionWithIdentity(input, actor);
  if (!connection) {
    await auditRefusal(c, actor, AUDIT_ACTIONS.CONNECTION_CREATE, undefined, summary, result);
    return refused(c, result);
  }
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CONNECTION_CREATE, actor, {
    resourceType: 'connection',
    resourceId: connection.id,
    details: { operation: 'create', connectionName: connection.name, ...summary, serverVersion: result.verdict.serverVersion },
    ipAddress: getClientIp(c),
    status: 'success',
  });
  return c.json({ success: true, data: { connection, check: result } }, 201);
});

/** The checks of POST /identity for a connection not created yet. Saves nothing. */
connectionIdentityRoutes.post('/identity/check', rbacAuthMiddleware, zValidator('json', changeSchema), async (c) => {
  requireSuperAdmin(c);
  const { result } = await checkIdentityChange(null, c.req.valid('json'));
  return c.json({ success: true, data: result });
});

/**
 * Which ClickHouse identity the caller's own statements carry on each
 * connection, and whether it is usable now. For anyone signed in: it says
 * nothing about a connection the caller cannot use or holds no link on, and
 * nothing about other accounts. Registered before `/:id/identity`.
 */
connectionIdentityRoutes.get('/identity/mine', rbacAuthMiddleware, async (c) => {
  const user = getRbacUser(c);
  const identities = await callerIdentities(user.sub, user.roles.includes('super_admin'));
  return c.json({ success: true, data: { identities } });
});

connectionIdentityRoutes.get('/:id/identity', rbacAuthMiddleware, async (c) => {
  requireSuperAdmin(c);
  const connection = await load(c);
  const identity = await getIdentity(connection);
  const systemRole = identity.systemRole ?? 'chouse_system';
  return c.json({
    success: true,
    data: {
      ...identity,
      setupStatements: ceilingSetupStatements('<new_user>', systemRole, identity.roleMap.map((entry) => entry.clickhouseRole)),
      personalSetupStatements: personalSetupStatements('<new_user>', systemRole, identity.impersonationRole ?? 'chouse_impersonate'),
      // Which kinds this connection's server can run, so the form can block one before a login is prepared for it.
      support: await connectionKindSupport(connection.id),
    },
  });
});

connectionIdentityRoutes.post('/:id/identity/check', rbacAuthMiddleware, zValidator('json', changeSchema), async (c) => {
  requireSuperAdmin(c);
  const connection = await load(c);
  const { result } = await checkIdentityChange(connection.id, c.req.valid('json'));
  return c.json({ success: true, data: result });
});

connectionIdentityRoutes.put('/:id/identity', rbacAuthMiddleware, zValidator('json', changeSchema), async (c) => {
  // It stores a ClickHouse password and decides whose grants every statement runs with: a browser session only.
  requireJwtSession(c);
  const actor = requireSuperAdmin(c);
  const connection = await load(c);
  const change = c.req.valid('json');
  const result = await switchIdentity(connection.id, change);
  if (!result.ok) {
    await auditRefusal(c, actor, AUDIT_ACTIONS.CONNECTION_IDENTITY_SWITCHED, connection.id, { name: connection.name, from: connection.identityMode, to: change.identityMode, username: change.username }, result);
    return refused(c, result);
  }
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CONNECTION_IDENTITY_SWITCHED, actor, {
    resourceType: 'connection',
    resourceId: connection.id,
    details: {
      name: connection.name,
      from: { identityMode: connection.identityMode, username: connection.username, systemRole: connection.systemRole, impersonationRole: connection.impersonationRole },
      to: {
        identityMode: change.identityMode,
        username: change.username,
        systemRole: change.identityMode === 'shared' ? null : change.systemRole ?? null,
        impersonationRole: change.identityMode === 'personal' ? change.impersonationRole ?? null : null,
      },
    },
    ipAddress: getClientIp(c),
    status: 'success',
  });
  const saved = await load(c);
  return c.json({ success: true, data: { identity: await getIdentity(saved), check: result } });
});

connectionIdentityRoutes.put('/:id/identity/contact', rbacAuthMiddleware, zValidator('json', contactSchema), async (c) => {
  const actor = requireSuperAdmin(c);
  const connection = await load(c);
  await setAccessContact(connection.id, c.req.valid('json').accessContact);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CONNECTION_UPDATE, actor, {
    resourceType: 'connection',
    resourceId: connection.id,
    details: { name: connection.name, changedFields: ['accessContact'] },
    ipAddress: getClientIp(c),
    status: 'success',
  });
  return c.json({ success: true, data: await getIdentity(await load(c)) });
});

connectionIdentityRoutes.get('/:id/identity/role-map', rbacAuthMiddleware, async (c) => {
  requireSuperAdmin(c);
  const connection = await load(c);
  return c.json({ success: true, data: { entries: await getRoleMap(connection.id) } });
});

connectionIdentityRoutes.put('/:id/identity/role-map', rbacAuthMiddleware, zValidator('json', roleMapSchema), async (c) => {
  // The map decides which ClickHouse role every holder of a CHouse role gets: a browser session only.
  requireJwtSession(c);
  const actor = requireSuperAdmin(c);
  const connection = await load(c);
  const before = await getRoleMap(connection.id);
  const entries = await setRoleMap(connection.id, c.req.valid('json').entries, actor);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CONNECTION_ROLE_MAP_CHANGED, actor, {
    resourceType: 'connection',
    resourceId: connection.id,
    details: {
      name: connection.name,
      before: before.map((entry) => ({ role: entry.roleName, clickhouseRole: entry.clickhouseRole })),
      after: entries.map((entry) => ({ role: entry.roleName, clickhouseRole: entry.clickhouseRole })),
    },
    ipAddress: getClientIp(c),
    status: 'success',
  });
  return c.json({ success: true, data: { entries } });
});

connectionIdentityRoutes.post('/:id/identity/recheck', rbacAuthMiddleware, async (c) => {
  requireSuperAdmin(c);
  const connection = await load(c);
  const verdict = await checkSavedConnection(connection.id);
  return c.json({ success: true, data: { verdict, identity: await getIdentity(await load(c)) } });
});

export default connectionIdentityRoutes;
