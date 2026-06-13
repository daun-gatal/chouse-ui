/**
 * ClickHouse Users Routes
 *
 * API endpoints for managing native ClickHouse database users: creation, role
 * assignment, default roles, optional direct grants, and the "extract to role"
 * migration helper. ClickHouse is the source of truth (system.users etc).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  listClickHouseUsers,
  getClickHouseUser,
  getCurrentUserState,
  createClickHouseUser,
  updateClickHouseUser,
  deleteClickHouseUser,
  extractRoleFromUser,
  generateUserDDL,
  generateUpdateUserDDL,
} from '../services/clickhouseUsers';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLogWithContext } from '../services/rbac';
import { validatePasswordStrength } from '../services/password';
import { AUDIT_ACTIONS } from '../schema/base';
import { requestLogger } from '../../utils/logger';
import { getClickHouseService, handleError, grantsSchema, defaultRolesSchema } from './clickhouseShared';

const clickhouseUsersRoutes = new Hono();

// ============================================
// Validation Schemas
// ============================================

const usernameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Username must start with a letter or underscore and contain only letters, numbers, and underscores');

const createUserSchema = z
  .object({
    username: usernameSchema,
    authType: z.string().optional(),
    password: z.string().min(8).optional(),
    hostIp: z.string().optional(),
    hostNames: z.string().optional(),
    cluster: z.string().optional(),
    roles: z.array(z.string()).optional(),
    defaultRoles: defaultRolesSchema.optional(),
    directGrants: grantsSchema.optional(),
  })
  .refine((data) => data.authType === 'no_password' || !!data.password, {
    message: 'Password is required when authType is not no_password',
    path: ['password'],
  });

const updateUserSchema = z.object({
  password: z.union([z.string().min(8), z.literal('')]).optional(),
  hostIp: z.string().optional(),
  hostNames: z.string().optional(),
  cluster: z.string().optional(),
  roles: z.array(z.string()).optional(),
  defaultRoles: defaultRolesSchema.optional(),
  directGrants: grantsSchema.optional(),
});

const extractRoleSchema = z.object({
  roleName: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Role name must start with a letter or underscore and contain only letters, numbers, and underscores'),
  cluster: z.string().optional(),
});

// ============================================
// Routes
// ============================================

// Available clusters (used by both users + roles UIs).
clickhouseUsersRoutes.get('/clusters', rbacAuthMiddleware, requirePermission('clickhouse:users:view'), async (c) => {
  try {
    const service = getClickHouseService(c);
    const result = await service.executeQuery<{ cluster: string }>(
      `SELECT DISTINCT cluster FROM system.clusters ORDER BY cluster`,
    );
    return c.json({ success: true, data: (result.data || []).map((r) => r.cluster) });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Get clusters error');
    const info = handleError(error, 'CLUSTERS_FETCH_FAILED', 'Failed to fetch clusters');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// List users.
clickhouseUsersRoutes.get('/', rbacAuthMiddleware, requirePermission('clickhouse:users:view'), async (c) => {
  try {
    const service = getClickHouseService(c);
    const users = await listClickHouseUsers(service);
    return c.json({ success: true, data: users });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'List error');
    const info = handleError(error, 'LIST_FAILED', 'Failed to list ClickHouse users');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Get one user (roles + default roles + direct grants).
clickhouseUsersRoutes.get('/:username', rbacAuthMiddleware, requirePermission('clickhouse:users:view'), async (c) => {
  try {
    const service = getClickHouseService(c);
    const username = decodeURIComponent(c.req.param('username'));
    const user = await getClickHouseUser(service, username);
    if (!user) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'ClickHouse user not found' } }, 404);
    }
    return c.json({ success: true, data: user });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Get error');
    const info = handleError(error, 'FETCH_FAILED', 'Failed to fetch ClickHouse user');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Preview create DDL.
clickhouseUsersRoutes.post('/generate-ddl', rbacAuthMiddleware, requirePermission('clickhouse:users:create'), async (c) => {
  try {
    const parsed = createUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }
    return c.json({ success: true, data: generateUserDDL(parsed.data) });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Generate DDL error');
    return c.json({ success: false, error: { code: 'DDL_GENERATION_FAILED', message: error instanceof Error ? error.message : 'Failed to generate DDL' } }, 500);
  }
});

// Create user.
clickhouseUsersRoutes.post('/', rbacAuthMiddleware, requirePermission('clickhouse:users:create'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const parsed = createUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }
    const input = parsed.data;

    // A role is mandatory on creation — users get access only through roles.
    if (!input.roles || input.roles.length === 0) {
      return c.json({ success: false, error: { code: 'ROLE_REQUIRED', message: 'At least one role is required to create a user' } }, 400);
    }

    if (input.password && input.authType !== 'no_password') {
      const strength = validatePasswordStrength(input.password);
      if (!strength.valid) {
        return c.json({ success: false, error: { code: 'WEAK_PASSWORD', message: 'Password does not meet security requirements', details: strength.errors } }, 400);
      }
    }

    await createClickHouseUser(service, input);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_USER_CREATE, user.sub, {
      resourceType: 'clickhouse_user',
      resourceId: input.username,
      details: { username: input.username, roles: input.roles, directGrants: input.directGrants?.length ?? 0 },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { username: input.username } }, 201);
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Create error');
    const info = handleError(error, 'CREATE_FAILED', 'Failed to create ClickHouse user');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Preview update DDL.
clickhouseUsersRoutes.post('/:username/generate-ddl', rbacAuthMiddleware, requirePermission('clickhouse:users:update'), async (c) => {
  try {
    const username = decodeURIComponent(c.req.param('username'));
    const parsed = updateUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }
    const service = getClickHouseService(c);
    const current = await getCurrentUserState(service, username);
    return c.json({ success: true, data: generateUpdateUserDDL(username, parsed.data, current) });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Generate update DDL error');
    return c.json({ success: false, error: { code: 'DDL_GENERATION_FAILED', message: error instanceof Error ? error.message : 'Failed to generate update DDL' } }, 500);
  }
});

// Update user.
clickhouseUsersRoutes.patch('/:username', rbacAuthMiddleware, requirePermission('clickhouse:users:update'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const username = decodeURIComponent(c.req.param('username'));
    const parsed = updateUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }
    const input = parsed.data;

    if (input.password) {
      const strength = validatePasswordStrength(input.password);
      if (!strength.valid) {
        return c.json({ success: false, error: { code: 'WEAK_PASSWORD', message: 'Password does not meet security requirements', details: strength.errors } }, 400);
      }
    }

    const current = await getCurrentUserState(service, username);
    await updateClickHouseUser(service, username, input, current);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_USER_UPDATE, user.sub, {
      resourceType: 'clickhouse_user',
      resourceId: username,
      details: { username, changes: Object.keys(input) },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { username } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Update error');
    const info = handleError(error, 'UPDATE_FAILED', 'Failed to update ClickHouse user');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Extract a user's direct grants into a reusable role.
clickhouseUsersRoutes.post('/:username/extract-role', rbacAuthMiddleware, requirePermission('clickhouse:roles:create'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const username = decodeURIComponent(c.req.param('username'));
    const parsed = extractRoleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: parsed.error.errors } }, 400);
    }

    await extractRoleFromUser(service, username, parsed.data.roleName, parsed.data.cluster);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_USER_EXTRACT_ROLE, user.sub, {
      resourceType: 'clickhouse_user',
      resourceId: username,
      details: { username, roleName: parsed.data.roleName },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { roleName: parsed.data.roleName } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Extract role error');
    const info = handleError(error, 'EXTRACT_ROLE_FAILED', 'Failed to extract role from user');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

// Delete user.
clickhouseUsersRoutes.delete('/:username', rbacAuthMiddleware, requirePermission('clickhouse:users:delete'), async (c) => {
  try {
    const user = getRbacUser(c);
    const service = getClickHouseService(c);
    const username = decodeURIComponent(c.req.param('username'));
    const cluster = c.req.query('cluster') || undefined;

    await deleteClickHouseUser(service, username, cluster);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_USER_DELETE, user.sub, {
      resourceType: 'clickhouse_user',
      resourceId: username,
      details: { username },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { deleted: true } });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Delete error');
    const info = handleError(error, 'DELETE_FAILED', 'Failed to delete ClickHouse user');
    return c.json({ success: false, error: { code: info.code, message: info.message } }, info.statusCode);
  }
});

export default clickhouseUsersRoutes;
