/**
 * Connection kinds and the role ceiling (ADR 0033 §5, §6), super admin only.
 *
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
import { getClientIp, getRbacUser, rbacAuthMiddleware } from '../middleware';
import { AUDIT_ACTIONS } from '../schema/base';
import {
  ceilingSetupStatements,
  personalSetupStatements,
  checkIdentityChange,
  getIdentity,
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
});

const roleMapSchema = z.object({
  entries: z.array(z.object({ roleId: z.string().min(1).max(255), clickhouseRole: z.string().min(1).max(128) })).max(500),
});

const contactSchema = z.object({ accessContact: z.string().max(500).nullable() });

function requireSuperAdmin(c: Context): string {
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
  return c.json({ success: false, error: { code: 'IDENTITY_CHECK_FAILED', message: result.reason ?? 'The login did not pass the checks.', details: result } }, 422);
}

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
  const actor = requireSuperAdmin(c);
  const connection = await load(c);
  const change = c.req.valid('json');
  const result = await switchIdentity(connection.id, change);
  if (!result.ok) return refused(c, result);
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
