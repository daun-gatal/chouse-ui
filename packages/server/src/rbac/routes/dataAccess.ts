/**
 * Data Access Rules Routes
 * 
 * API endpoints for managing database/table access rules.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createDataAccessRule,
  getDataAccessRuleById,
  listDataAccessRules,
  getRulesForRole,
  getRulesForUser,
  getUserSpecificRules,
  updateDataAccessRule,
  deleteDataAccessRule,
  setRulesForRole,
  setRulesForUser,
  checkUserAccess,
  filterDatabasesForUser,
  filterTablesForUser,
  type AccessType,
} from '../services/dataAccess';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLogWithContext } from '../services/rbac';
import { AUDIT_ACTIONS } from '../schema/base';

const dataAccessRoutes = new Hono();

// ============================================
// Validation Schemas
// ============================================

const accessTypeSchema = z.enum(['read', 'write', 'admin']);

const createRuleSchema = z.object({
  roleId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  connectionId: z.string().uuid().nullable().optional(),
  databasePattern: z.string().min(1).max(255).default('*'),
  tablePattern: z.string().min(1).max(255).default('*'),
  accessType: accessTypeSchema.default('read'),
  isAllowed: z.boolean().default(true),
  priority: z.number().int().min(-1000).max(1000).default(0),
  description: z.string().max(500).optional(),
}).refine(
  (data) => (data.roleId && !data.userId) || (!data.roleId && data.userId),
  { message: 'Either roleId or userId must be provided, but not both' }
);

const updateRuleSchema = z.object({
  connectionId: z.string().uuid().nullable().optional(),
  databasePattern: z.string().min(1).max(255).optional(),
  tablePattern: z.string().min(1).max(255).optional(),
  accessType: accessTypeSchema.optional(),
  isAllowed: z.boolean().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  description: z.string().max(500).optional(),
});

const bulkSetRulesSchema = z.object({
  roleId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  rules: z.array(z.object({
    connectionId: z.string().uuid().nullable().optional(),
    databasePattern: z.string().min(1).max(255).default('*'),
    tablePattern: z.string().min(1).max(255).default('*'),
    accessType: accessTypeSchema.default('read'),
    isAllowed: z.boolean().default(true),
    priority: z.number().int().min(-1000).max(1000).default(0),
    description: z.string().max(500).optional(),
  })),
}).refine(
  (data) => (data.roleId && !data.userId) || (!data.roleId && data.userId),
  { message: 'Either roleId or userId must be provided, but not both' }
);

const checkAccessSchema = z.object({
  database: z.string().min(1),
  table: z.string().optional(),
  accessType: accessTypeSchema.default('read'),
  connectionId: z.string().uuid().optional(),
});

const listQuerySchema = z.object({
  roleId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  connectionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================
// Routes
// ============================================

// List all data access rules
dataAccessRoutes.get(
  '/',
  rbacAuthMiddleware,
  requirePermission('roles:view'),
  zValidator('query', listQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid('query');
      const result = await listDataAccessRules({
        roleId: query.roleId,
        userId: query.userId,
        connectionId: query.connectionId,
        limit: query.limit,
        offset: query.offset,
      });

      return c.json({
        success: true,
        data: {
          rules: result.rules,
          total: result.total,
          limit: query.limit,
          offset: query.offset,
        },
      });
    } catch (error) {
      console.error('[DataAccess] List error:', error);
      return c.json({
        success: false,
        error: {
          code: 'LIST_FAILED',
          message: error instanceof Error ? error.message : 'Failed to list rules',
        },
      }, 500);
    }
  }
);

// Get rules for a specific role
dataAccessRoutes.get(
  '/role/:roleId',
  rbacAuthMiddleware,
  requirePermission('roles:view'),
  async (c) => {
    try {
      const roleId = c.req.param('roleId');
      const connectionId = c.req.query('connectionId');
      const rules = await getRulesForRole(roleId, connectionId);

      return c.json({
        success: true,
        data: rules,
      });
    } catch (error) {
      console.error('[DataAccess] Get role rules error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch rules for role',
        },
      }, 500);
    }
  }
);

// Get rule by ID
dataAccessRoutes.get(
  '/:id',
  rbacAuthMiddleware,
  requirePermission('roles:view'),
  async (c) => {
    try {
      const id = c.req.param('id');
      const rule = await getDataAccessRuleById(id);

      if (!rule) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Rule not found',
          },
        }, 404);
      }

      return c.json({
        success: true,
        data: rule,
      });
    } catch (error) {
      console.error('[DataAccess] Get rule error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch rule',
        },
      }, 500);
    }
  }
);

// Create new rule
dataAccessRoutes.post(
  '/',
  rbacAuthMiddleware,
  requirePermission('roles:update'),
  zValidator('json', createRuleSchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const input = c.req.valid('json');

      const rule = await createDataAccessRule(input, user.sub);

      // Audit log
      await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_ACCESS_CREATE, user.sub, {
        resourceType: 'data_access_rule',
        resourceId: rule.id,
        details: {
          operation: 'create',
          roleId: input.roleId,
          databasePattern: input.databasePattern,
          tablePattern: input.tablePattern,
          accessType: input.accessType,
        },
        ipAddress: getClientIp(c),
      });

      return c.json({
        success: true,
        data: rule,
      }, 201);
    } catch (error) {
      console.error('[DataAccess] Create error:', error);
      return c.json({
        success: false,
        error: {
          code: 'CREATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to create rule',
        },
      }, 500);
    }
  }
);

// Update rule
dataAccessRoutes.patch(
  '/:id',
  rbacAuthMiddleware,
  requirePermission('roles:update'),
  zValidator('json', updateRuleSchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const id = c.req.param('id');
      const input = c.req.valid('json');

      const rule = await updateDataAccessRule(id, input);

      if (!rule) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Rule not found',
          },
        }, 404);
      }

      // Audit log
      await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_ACCESS_UPDATE, user.sub, {
        resourceType: 'data_access_rule',
        resourceId: rule.id,
        details: {
          operation: 'update',
          changes: Object.keys(input),
        },
        ipAddress: getClientIp(c),
      });

      return c.json({
        success: true,
        data: rule,
      });
    } catch (error) {
      console.error('[DataAccess] Update error:', error);
      return c.json({
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to update rule',
        },
      }, 500);
    }
  }
);

// Delete rule
dataAccessRoutes.delete(
  '/:id',
  rbacAuthMiddleware,
  requirePermission('roles:update'),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const id = c.req.param('id');

      const existing = await getDataAccessRuleById(id);
      if (!existing) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Rule not found',
          },
        }, 404);
      }

      await deleteDataAccessRule(id);

      // Audit log
      await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_ACCESS_DELETE, user.sub, {
        resourceType: 'data_access_rule',
        resourceId: id,
        details: {
          operation: 'delete',
          roleId: existing.roleId,
          databasePattern: existing.databasePattern,
          tablePattern: existing.tablePattern,
        },
        ipAddress: getClientIp(c),
      });

      return c.json({
        success: true,
        data: { deleted: true },
      });
    } catch (error) {
      console.error('[DataAccess] Delete error:', error);
      return c.json({
        success: false,
        error: {
          code: 'DELETE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to delete rule',
        },
      }, 500);
    }
  }
);

// Bulk set rules for a role or user (replaces existing)
dataAccessRoutes.post(
  '/bulk',
  rbacAuthMiddleware,
  requirePermission('roles:update'),
  zValidator('json', bulkSetRulesSchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const { roleId, userId, rules } = c.req.valid('json');

      let createdRules;
      let resourceId: string;
      let operation: string;

      if (roleId) {
        createdRules = await setRulesForRole(roleId, rules, user.sub);
        resourceId = roleId;
        operation = 'bulk_set_role';
      } else if (userId) {
        createdRules = await setRulesForUser(userId, rules, user.sub);
        resourceId = userId;
        operation = 'bulk_set_user';
      } else {
        throw new Error('Either roleId or userId must be provided');
      }

      // Audit log
      await createAuditLogWithContext(c, AUDIT_ACTIONS.DATA_ACCESS_BULK_SET, user.sub, {
        resourceType: 'data_access_rule',
        resourceId,
        details: {
          operation,
          roleId,
          userId,
          ruleCount: rules.length,
        },
        ipAddress: getClientIp(c),
      });

      return c.json({
        success: true,
        data: createdRules,
      });
    } catch (error) {
      console.error('[DataAccess] Bulk set error:', error);
      return c.json({
        success: false,
        error: {
          code: 'BULK_SET_FAILED',
          message: error instanceof Error ? error.message : 'Failed to set rules',
        },
      }, 500);
    }
  }
);

// Get rules for a specific user (user-level only, not role-inherited)
dataAccessRoutes.get(
  '/user/:userId',
  rbacAuthMiddleware,
  requirePermission('users:view'),
  async (c) => {
    try {
      const userId = c.req.param('userId');
      const rules = await getUserSpecificRules(userId);

      return c.json({
        success: true,
        data: rules,
      });
    } catch (error) {
      console.error('[DataAccess] Get user rules error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch user rules',
        },
      }, 500);
    }
  }
);

// Check access for current user
dataAccessRoutes.post(
  '/check',
  rbacAuthMiddleware,
  zValidator('json', checkAccessSchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const { database, table, accessType, connectionId } = c.req.valid('json');

      const result = await checkUserAccess(
        user.sub,
        database,
        table || null,
        accessType as AccessType,
        connectionId
      );

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[DataAccess] Check access error:', error);
      return c.json({
        success: false,
        error: {
          code: 'CHECK_FAILED',
          message: 'Failed to check access',
        },
      }, 500);
    }
  }
);

// Get filtered databases for current user
dataAccessRoutes.post(
  '/filter/databases',
  rbacAuthMiddleware,
  zValidator('json', z.object({
    databases: z.array(z.string()),
    connectionId: z.string().uuid().optional(),
  })),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const isAdmin = user.roles.includes('super_admin') || user.roles.includes('admin');

      // Admins get all databases
      if (isAdmin) {
        const { databases } = c.req.valid('json');
        return c.json({
          success: true,
          data: databases,
        });
      }

      const { databases, connectionId } = c.req.valid('json');
      const filtered = await filterDatabasesForUser(user.sub, databases, connectionId);

      return c.json({
        success: true,
        data: filtered,
      });
    } catch (error) {
      console.error('[DataAccess] Filter databases error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FILTER_FAILED',
          message: 'Failed to filter databases',
        },
      }, 500);
    }
  }
);

// Get filtered tables for current user
dataAccessRoutes.post(
  '/filter/tables',
  rbacAuthMiddleware,
  zValidator('json', z.object({
    database: z.string(),
    tables: z.array(z.string()),
    connectionId: z.string().uuid().optional(),
  })),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const isAdmin = user.roles.includes('super_admin') || user.roles.includes('admin');

      // Admins get all tables
      if (isAdmin) {
        const { tables } = c.req.valid('json');
        return c.json({
          success: true,
          data: tables,
        });
      }

      const { database, tables, connectionId } = c.req.valid('json');
      const filtered = await filterTablesForUser(user.sub, database, tables, connectionId);

      return c.json({
        success: true,
        data: filtered,
      });
    } catch (error) {
      console.error('[DataAccess] Filter tables error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FILTER_FAILED',
          message: 'Failed to filter tables',
        },
      }, 500);
    }
  }
);

export default dataAccessRoutes;
