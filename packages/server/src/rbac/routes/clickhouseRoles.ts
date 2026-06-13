/**
 * ClickHouse Roles Routes
 *
 * API endpoints for managing native ClickHouse roles (CREATE ROLE, GRANT ...
 * TO role). ClickHouse is the source of truth (system.roles / system.grants).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  listClickHouseRoles,
  getClickHouseRole,
  getRoleGrants,
  createClickHouseRole,
  updateClickHouseRole,
  deleteClickHouseRole,
  disableClickHouseRole,
  enableClickHouseRole,
  generateCreateRoleDDL,
  generateRoleDiffDDL,
  listClickHousePrivileges,
} from '../services/clickhouseRoles';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLogWithContext } from '../services/rbac';
import { AUDIT_ACTIONS } from '../schema/base';
import { requestLogger } from '../../utils/logger';
import { getClickHouseService, getConnectionId, handleError, grantsSchema } from './clickhouseShared';

const clickhouseRolesRoutes = new Hono();

const roleNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Role name must start with a letter or underscore and contain only letters, numbers, and underscores');

const createRoleSchema = z.object({
  name: roleNameSchema,
  cluster: z.string().optional(),
  grants: grantsSchema,
});

const updateRoleSchema = z.object({
  cluster: z.string().optional(),
  grants: grantsSchema,
});

// Privilege catalog — read live from system.privileges (falls back to the
// curated static catalog if the server query fails).
clickhouseRolesRoutes.get('/privileges', rbacAuthMiddleware, requirePermission('clickhouse:roles:view'), async (c) => {
  try {
    const service = getClickHouseService(c);
    const privileges = await listClickHousePrivileges(service);
    return c.json({ success: true, data: privileges });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Privileges error');
    const info = handleError(error, 'PRIVILEGES_FETCH_FAILED', 'Failed to fetch privileges');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// List roles.
clickhouseRolesRoutes.get('/', rbacAuthMiddleware, requirePermission('clickhouse:roles:view'), async (c) => {
  try {
    const service = getClickHouseService(c);
    const roles = await listClickHouseRoles(service, getConnectionId(c));
    return c.json({ success: true, data: roles });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'List error');
    const info = handleError(error, 'LIST_FAILED', 'Failed to list ClickHouse roles');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Get one role with grants.
clickhouseRolesRoutes.get('/:name', rbacAuthMiddleware, requirePermission('clickhouse:roles:view'), async (c) => {
  try {
    const service = getClickHouseService(c);
    const name = decodeURIComponent(c.req.param('name'));
    const role = await getClickHouseRole(service, name);
    if (!role) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'ClickHouse role not found' } }, 404);
    }
    return c.json({ success: true, data: role });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Get error');
    const info = handleError(error, 'FETCH_FAILED', 'Failed to fetch ClickHouse role');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Preview create DDL.
clickhouseRolesRoutes.post('/generate-ddl', rbacAuthMiddleware, requirePermission('clickhouse:roles:create'), async (c) => {
  try {
    const parsed = createRoleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }
    const ddl = generateCreateRoleDDL(parsed.data);
    return c.json({ success: true, data: { statements: ddl, fullDDL: ddl.map((s) => `${s};`).join('\n') } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Generate DDL error');
    return c.json({ success: false, error: { code: 'DDL_GENERATION_FAILED', message: error instanceof Error ? error.message : 'Failed to generate DDL' } }, 500);
  }
});

// Create role.
clickhouseRolesRoutes.post('/', rbacAuthMiddleware, requirePermission('clickhouse:roles:create'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const parsed = createRoleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }
    const input = parsed.data;

    await createClickHouseRole(service, input);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_ROLE_CREATE, user.sub, {
      resourceType: 'clickhouse_role',
      resourceId: input.name,
      details: { name: input.name, grants: input.grants.length },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { name: input.name } }, 201);
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Create error');
    const info = handleError(error, 'CREATE_FAILED', 'Failed to create ClickHouse role');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Preview update DDL (diff).
clickhouseRolesRoutes.post('/:name/generate-ddl', rbacAuthMiddleware, requirePermission('clickhouse:roles:update'), async (c) => {
  try {
    const name = decodeURIComponent(c.req.param('name'));
    const parsed = updateRoleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }
    const service = getClickHouseService(c);
    const current = await getRoleGrants(service, name);
    const ddl = generateRoleDiffDDL(name, current, parsed.data.grants, parsed.data.cluster);
    return c.json({ success: true, data: { statements: ddl, fullDDL: ddl.map((s) => `${s};`).join('\n') } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Generate update DDL error');
    return c.json({ success: false, error: { code: 'DDL_GENERATION_FAILED', message: error instanceof Error ? error.message : 'Failed to generate update DDL' } }, 500);
  }
});

// Update role.
clickhouseRolesRoutes.patch('/:name', rbacAuthMiddleware, requirePermission('clickhouse:roles:update'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const name = decodeURIComponent(c.req.param('name'));
    const parsed = updateRoleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }

    await updateClickHouseRole(service, name, parsed.data);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_ROLE_UPDATE, user.sub, {
      resourceType: 'clickhouse_role',
      resourceId: name,
      details: { name, grants: parsed.data.grants.length },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { name } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Update error');
    const info = handleError(error, 'UPDATE_FAILED', 'Failed to update ClickHouse role');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Delete role.
clickhouseRolesRoutes.delete('/:name', rbacAuthMiddleware, requirePermission('clickhouse:roles:delete'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const name = decodeURIComponent(c.req.param('name'));
    const cluster = c.req.query('cluster') || undefined;

    await deleteClickHouseRole(service, name, cluster);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_ROLE_DELETE, user.sub, {
      resourceType: 'clickhouse_role',
      resourceId: name,
      details: { name },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { deleted: true } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Delete error');
    const info = handleError(error, 'DELETE_FAILED', 'Failed to delete ClickHouse role');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

function requireConnection(c: import('hono').Context): string {
  const connectionId = getConnectionId(c);
  if (!connectionId) {
    throw new Error('No associated ClickHouse connection for this session — reconnect from a saved connection.');
  }
  return connectionId;
}

// Disable a role (reversible).
clickhouseRolesRoutes.post('/:name/disable', rbacAuthMiddleware, requirePermission('clickhouse:roles:update'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const name = decodeURIComponent(c.req.param('name'));
    const cluster = c.req.query('cluster') || undefined;

    await disableClickHouseRole(service, requireConnection(c), name, cluster, user.sub);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_ROLE_DISABLE, user.sub, {
      resourceType: 'clickhouse_role',
      resourceId: name,
      details: { name },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { name, disabled: true } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Disable error');
    const info = handleError(error, 'DISABLE_FAILED', 'Failed to disable ClickHouse role');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Enable a previously disabled role.
clickhouseRolesRoutes.post('/:name/enable', rbacAuthMiddleware, requirePermission('clickhouse:roles:update'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const name = decodeURIComponent(c.req.param('name'));
    const cluster = c.req.query('cluster') || undefined;

    await enableClickHouseRole(service, requireConnection(c), name, cluster);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_ROLE_ENABLE, user.sub, {
      resourceType: 'clickhouse_role',
      resourceId: name,
      details: { name },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { name, disabled: false } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Roles', err: error instanceof Error ? error.message : String(error) }, 'Enable error');
    const info = handleError(error, 'ENABLE_FAILED', 'Failed to enable ClickHouse role');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

export default clickhouseRolesRoutes;
