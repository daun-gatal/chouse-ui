/**
 * Data Access Policies Routes
 *
 * CRUD for named, reusable data access policies and their attachment to roles.
 * Policies group database/table pattern rules and are scoped to connections.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createPolicy,
  getPolicyById,
  listPolicies,
  updatePolicy,
  deletePolicy,
  getPoliciesForRole,
  getRolesForPolicy,
  setPoliciesForRole,
} from '../services/dataAccessPolicies';
import { listConnectionDatabases, listConnectionTables } from '../services/connections';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLogWithContext } from '../services/rbac';
import { AUDIT_ACTIONS, DATA_RELATED_PERMISSIONS, DEFAULT_DATA_ACCESS_RULE_PERMISSIONS, PERMISSIONS } from '../schema/base';
import { AppError } from '../../types';
import { requestLogger } from '../../utils/logger';

const policyRoutes = new Hono();

// ============================================
// Validation Schemas
// ============================================

const ruleSchema = z.object({
  // null = applies to all connections
  connectionId: z.string().uuid().nullable().optional(),
  databasePattern: z.string().min(1).max(255).default('*'),
  tablePattern: z.string().min(1).max(255).default('*'),
  permissions: z.array(z.enum(DATA_RELATED_PERMISSIONS)).min(1).default(Array.from(DEFAULT_DATA_ACCESS_RULE_PERMISSIONS)),
  isAllowed: z.boolean().default(true),
  priority: z.number().int().min(-1000).max(1000).default(0),
  description: z.string().max(500).nullable().optional(),
});

const createPolicySchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(500).nullable().optional(),
  rules: z.array(ruleSchema).min(1, 'A policy must have at least one rule'),
});

const updatePolicySchema = z.object({
  name: z.string().min(2).max(255).optional(),
  description: z.string().max(500).nullable().optional(),
  rules: z.array(ruleSchema).min(1, 'A policy must have at least one rule').optional(),
});

const setRolePoliciesSchema = z.object({
  policyIds: z.array(z.string().uuid()),
});

// ============================================
// Routes
// ============================================

// Browse databases on a connection (for building policies)
policyRoutes.get('/schema/:connectionId/databases', rbacAuthMiddleware, requirePermission(PERMISSIONS.DATA_ACCESS_VIEW), async (c) => {
  try {
    const databases = await listConnectionDatabases(c.req.param('connectionId'));
    return c.json({ success: true, data: databases });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'List databases error');
    return c.json({ success: false, error: { code: 'SCHEMA_FAILED', message: error instanceof Error ? error.message : 'Failed to list databases' } }, 500);
  }
});

// Browse tables in a database on a connection (lazy, per-database)
policyRoutes.get('/schema/:connectionId/tables', rbacAuthMiddleware, requirePermission(PERMISSIONS.DATA_ACCESS_VIEW), async (c) => {
  try {
    const database = c.req.query('database');
    if (!database) throw AppError.badRequest('database query parameter is required');
    const tables = await listConnectionTables(c.req.param('connectionId'), database);
    return c.json({ success: true, data: tables });
  } catch (error) {
    if (error instanceof AppError) throw error;
    requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'List tables error');
    return c.json({ success: false, error: { code: 'SCHEMA_FAILED', message: error instanceof Error ? error.message : 'Failed to list tables' } }, 500);
  }
});

// List all policies
policyRoutes.get('/', rbacAuthMiddleware, requirePermission(PERMISSIONS.DATA_ACCESS_VIEW), async (c) => {
  try {
    const policies = await listPolicies();
    return c.json({ success: true, data: policies });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'List error');
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: 'Failed to list policies' } }, 500);
  }
});

// Get policies attached to a role
policyRoutes.get('/role/:roleId', rbacAuthMiddleware, requirePermission(PERMISSIONS.DATA_ACCESS_VIEW), async (c) => {
  try {
    const policies = await getPoliciesForRole(c.req.param('roleId'));
    return c.json({ success: true, data: policies });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'Get role policies error');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch role policies' } }, 500);
  }
});

// Replace the set of policies attached to a role
policyRoutes.post(
  '/role/:roleId',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.DATA_ACCESS_ASSIGN),
  zValidator('json', setRolePoliciesSchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const roleId = c.req.param('roleId');
      const { policyIds } = c.req.valid('json');

      await setPoliciesForRole(roleId, policyIds);

      await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_ACCESS_ASSIGN, user.sub, {
        resourceType: 'role',
        resourceId: roleId,
        details: { operation: 'set_role_policies', policyCount: policyIds.length },
        ipAddress: getClientIp(c),
      });

      const policies = await getPoliciesForRole(roleId);
      return c.json({ success: true, data: policies });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'Set role policies error');
      return c.json({ success: false, error: { code: 'ASSIGN_FAILED', message: 'Failed to set role policies' } }, 500);
    }
  }
);

// Get roles that use a policy
policyRoutes.get('/:id/roles', rbacAuthMiddleware, requirePermission(PERMISSIONS.DATA_ACCESS_VIEW), async (c) => {
  try {
    const roleIds = await getRolesForPolicy(c.req.param('id'));
    return c.json({ success: true, data: roleIds });
  } catch (error) {
    requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'Get policy roles error');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch policy roles' } }, 500);
  }
});

// Get policy by id
policyRoutes.get('/:id', rbacAuthMiddleware, requirePermission(PERMISSIONS.DATA_ACCESS_VIEW), async (c) => {
  try {
    const policy = await getPolicyById(c.req.param('id'));
    if (!policy) throw AppError.notFound('Policy not found');
    return c.json({ success: true, data: policy });
  } catch (error) {
    if (error instanceof AppError) throw error;
    requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'Get policy error');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch policy' } }, 500);
  }
});

// Create policy
policyRoutes.post(
  '/',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.DATA_ACCESS_CREATE),
  zValidator('json', createPolicySchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const input = c.req.valid('json');

      const policy = await createPolicy(input, user.sub);

      await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_ACCESS_CREATE, user.sub, {
        resourceType: 'data_access_policy',
        resourceId: policy.id,
        details: { operation: 'create', name: policy.name, ruleCount: policy.rules.length },
        ipAddress: getClientIp(c),
      });

      return c.json({ success: true, data: policy }, 201);
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'Create error');
      const message = error instanceof Error && error.message.includes('UNIQUE') ? 'Policy name already exists' : 'Failed to create policy';
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message } }, 500);
    }
  }
);

// Update policy
policyRoutes.patch(
  '/:id',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.DATA_ACCESS_UPDATE),
  zValidator('json', updatePolicySchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const id = c.req.param('id');
      const input = c.req.valid('json');

      const policy = await updatePolicy(id, input);
      if (!policy) throw AppError.notFound('Policy not found');

      await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_ACCESS_UPDATE, user.sub, {
        resourceType: 'data_access_policy',
        resourceId: id,
        details: { operation: 'update', changes: Object.keys(input) },
        ipAddress: getClientIp(c),
      });

      return c.json({ success: true, data: policy });
    } catch (error) {
      if (error instanceof AppError) throw error;
      requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'Update error');
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update policy' } }, 500);
    }
  }
);

// Delete policy
policyRoutes.delete('/:id', rbacAuthMiddleware, requirePermission(PERMISSIONS.DATA_ACCESS_DELETE), async (c) => {
  try {
    const user = getRbacUser(c);
    const id = c.req.param('id');

    const existing = await getPolicyById(id);
    if (!existing) throw AppError.notFound('Policy not found');
    if (existing.isSystem) throw AppError.forbidden('Cannot delete a system policy');
    if (existing.roleIds.length > 0) {
      throw AppError.badRequest(
        `Cannot delete a policy attached to ${existing.roleIds.length} role(s). Detach it first.`
      );
    }

    await deletePolicy(id);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_ACCESS_DELETE, user.sub, {
      resourceType: 'data_access_policy',
      resourceId: id,
      details: { operation: 'delete', name: existing.name },
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true, data: { deleted: true } });
  } catch (error) {
    if (error instanceof AppError) throw error;
    requestLogger(c.get('requestId')).error({ module: 'DataAccessPolicies', err: error instanceof Error ? error.message : String(error) }, 'Delete error');
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete policy' } }, 500);
  }
});

export default policyRoutes;
