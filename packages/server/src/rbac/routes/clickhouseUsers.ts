/**
 * ClickHouse Users Routes
 * 
 * API endpoints for managing ClickHouse database users (not RBAC users).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  listClickHouseUsers,
  getClickHouseUser,
  getUserGrants,
  createClickHouseUser,
  updateClickHouseUser,
  deleteClickHouseUser,
  generateUserDDL,
  generateUpdateUserDDL,
  syncUnregisteredUsers,
  type CreateClickHouseUserInput,
  type UpdateClickHouseUserInput,
} from '../services/clickhouseUsers';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLogWithContext } from '../services/rbac';
import { validatePasswordStrength } from '../services/password';
import { AUDIT_ACTIONS } from '../schema/base';
import { getSession } from '../../services/clickhouse';
import { AppError } from '../../types';
import type { ClickHouseUserRole } from '../services/clickhouseUsers';
import { logger, requestLogger } from '../../utils/logger';

const clickhouseUsersRoutes = new Hono();

// ============================================
// Validation Schemas
// ============================================

const createUserSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(8).optional(),
  role: z.enum(['developer', 'analyst', 'viewer']),
  allowedDatabases: z.array(z.string()).optional(),
  allowedTables: z.array(z.object({
    database: z.string(),
    table: z.string(),
  })).optional(),
  hostIp: z.string().optional(),
  hostNames: z.string().optional(),
  cluster: z.string().optional(),
  authType: z.string().optional(),
}).refine((data) => {
  // If authType is not 'no_password', password is required
  if (data.authType !== 'no_password' && !data.password) {
    return false;
  }
  return true;
}, {
  message: 'Password is required when authType is not no_password',
  path: ['password'],
});

const updateUserSchema = z.object({
  password: z.union([
    z.string().min(8),
    z.literal('')
  ]).optional(),
  role: z.enum(['developer', 'analyst', 'viewer']),
  allowedDatabases: z.array(z.string()),
  allowedTables: z.array(z.object({
    database: z.string(),
    table: z.string(),
  })),
  hostIp: z.union([z.string(), z.literal('')]).optional(),
  hostNames: z.union([z.string(), z.literal('')]).optional(),
  cluster: z.union([z.string(), z.literal('')]).optional(),
});

// ============================================
// Helper: Get ClickHouse Service from Session
// ============================================

function getClickHouseService(c: any) {
  const sessionId = c.req.header('X-Session-ID');
  if (!sessionId) {
    throw new Error('No active ClickHouse session. Please connect to a ClickHouse server first.');
  }
  
  const sessionData = getSession(sessionId);
  if (!sessionData) {
    throw new Error('ClickHouse session not found. Please reconnect.');
  }
  
  return sessionData.service;
}

function getConnectionId(c: any): string | undefined {
  const sessionId = c.req.header('X-Session-ID');
  if (!sessionId) {
    return undefined;
  }
  
  const sessionData = getSession(sessionId);
  return sessionData?.session?.rbacConnectionId;
}

function isSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('session') || message.includes('Session') || message.includes('connect');
}

function handleError(error: unknown, defaultCode: string, defaultMessage: string) {
  const errorMessage = error instanceof Error ? error.message : defaultMessage;
  const isSession = isSessionError(error);
  
  return {
    code: isSession ? 'NO_SESSION' : defaultCode,
    message: errorMessage,
    statusCode: (isSession ? 400 : 500) as 400 | 500,
  };
}

// ============================================
// Routes
// ============================================

// Get available clusters
clickhouseUsersRoutes.get(
  '/clusters',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:view'),
  async (c) => {
    try {
      const service = getClickHouseService(c);
      const result = await service.executeQuery<{ cluster: string }>(
        `SELECT DISTINCT cluster FROM system.clusters ORDER BY cluster`
      );
      
      const clusters = (result.data || []).map(row => row.cluster);
      
      return c.json({
        success: true,
        data: clusters,
      });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Get clusters error');
      const errorInfo = handleError(error, 'CLUSTERS_FETCH_FAILED', 'Failed to fetch clusters');
      return c.json({
        success: false,
        error: {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      }, errorInfo.statusCode);
    }
  }
);

// List all ClickHouse users
clickhouseUsersRoutes.get(
  '/',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:view'),
  async (c) => {
    try {
      const service = getClickHouseService(c);
      const connectionId = getConnectionId(c);
      const users = await listClickHouseUsers(service, connectionId);
      
      return c.json({
        success: true,
        data: users,
      });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'List error');
      const errorInfo = handleError(error, 'LIST_FAILED', 'Failed to list ClickHouse users');
      return c.json({
        success: false,
        error: {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      }, errorInfo.statusCode);
    }
  }
);

// Get ClickHouse user by name
clickhouseUsersRoutes.get(
  '/:username',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:view'),
  async (c) => {
    try {
      const service = getClickHouseService(c);
      const username = decodeURIComponent(c.req.param('username'));
      const connectionId = getConnectionId(c);
      const user = await getClickHouseUser(service, username, connectionId);
      
      if (!user) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'ClickHouse user not found',
          },
        }, 404);
      }
      
      // If metadata wasn't loaded, try to get grants as fallback
      if (!user.role && !user.allowedDatabases && !user.allowedTables) {
        const grants = await getUserGrants(service, username).catch(() => ({
          allowedDatabases: [],
          allowedTables: [],
          role: null,
        }));
        
        return c.json({
          success: true,
          data: {
            ...user,
            ...grants,
          },
        });
      }
      
      return c.json({
        success: true,
        data: user,
      });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Get error');
      const errorInfo = handleError(error, 'FETCH_FAILED', 'Failed to fetch ClickHouse user');
      return c.json({
        success: false,
        error: {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      }, errorInfo.statusCode);
    }
  }
);

// Generate DDL for creating a user (preview only, doesn't execute)
clickhouseUsersRoutes.post(
  '/generate-ddl',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:create'),
  async (c) => {
    try {
      const body = await c.req.json();
      const parseResult = createUserSchema.safeParse(body);
      if (!parseResult.success) {
        return c.json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: parseResult.error.errors,
          },
        }, 400);
      }
      const input = parseResult.data;
      const ddl = generateUserDDL(input);
      
      return c.json({
        success: true,
        data: ddl,
      });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Generate DDL error');
      return c.json({
        success: false,
        error: {
          code: 'DDL_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Failed to generate DDL',
        },
      }, 500);
    }
  }
);

// Create ClickHouse user
clickhouseUsersRoutes.post(
  '/',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:create'),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const service = getClickHouseService(c);
      const body = await c.req.json();
      const parseResult = createUserSchema.safeParse(body);
      if (!parseResult.success) {
        return c.json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: parseResult.error.errors,
          },
        }, 400);
      }
      const input = parseResult.data;
      
      // Validate username format
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.username)) {
        return c.json({
          success: false,
          error: {
            code: 'INVALID_USERNAME',
            message: 'Username must start with a letter or underscore and contain only letters, numbers, and underscores',
          },
        }, 400);
      }
      
      // Validate password strength if password is provided and authType is not 'no_password'
      if (input.password && input.authType !== 'no_password') {
        const strength = validatePasswordStrength(input.password);
        if (!strength.valid) {
          return c.json({
            success: false,
            error: {
              code: 'WEAK_PASSWORD',
              message: 'Password does not meet security requirements',
              details: strength.errors,
            },
          }, 400);
        }
      }
      
      const connectionId = getConnectionId(c);
      await createClickHouseUser(service, input, connectionId, user.sub);
      
      // Log audit event
      await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_USER_CREATE, user.sub, {
        resourceType: 'clickhouse_user',
        resourceId: input.username,
        details: {
          username: input.username,
          role: input.role,
          allowedDatabases: input.allowedDatabases,
          allowedTables: input.allowedTables,
        },
        ipAddress: getClientIp(c),
      });
      
      return c.json({
        success: true,
        data: { username: input.username },
      }, 201);
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Create error');
      const errorInfo = handleError(error, 'CREATE_FAILED', 'Failed to create ClickHouse user');
      return c.json({
        success: false,
        error: {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      }, errorInfo.statusCode);
    }
  }
);

// Generate DDL for updating a user (preview only)
clickhouseUsersRoutes.post(
  '/:username/generate-ddl',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:update'),
  async (c) => {
    try {
      const username = decodeURIComponent(c.req.param('username'));
      const body = await c.req.json();
      const parseResult = updateUserSchema.safeParse(body);
      if (!parseResult.success) {
        requestLogger(c.get('requestId')).error(
          { module: 'ClickHouse Users', errors: parseResult.error.errors },
          'Generate DDL validation error'
        );
        return c.json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: parseResult.error.errors,
          },
        }, 400);
      }
      const input = parseResult.data;
      const service = getClickHouseService(c);
      const connectionId = getConnectionId(c);
      
      // Try to get current grants from metadata first, fallback to parsing grants
      let currentGrants: { allowedDatabases?: string[]; allowedTables?: Array<{ database: string; table: string }>; role?: ClickHouseUserRole | null; authType?: string } | undefined;
      
      if (connectionId) {
        try {
          const { getUserMetadata } = await import('../services/clickhouseUsers');
          const metadata = await getUserMetadata(connectionId, username);
          if (metadata) {
            currentGrants = {
              role: metadata.role,
              allowedDatabases: metadata.allowedDatabases,
              allowedTables: metadata.allowedTables,
              authType: metadata.authType || undefined, // Include authType so it can be used in DDL generation
            };
          }
        } catch (error) {
          requestLogger(c.get('requestId')).warn(
            { module: 'ClickHouse Users', username, err: error instanceof Error ? error.message : String(error) },
            'Failed to load metadata, falling back to grants parsing'
          );
        }
      }
      
      // Fallback to parsing grants if metadata not available
      if (!currentGrants) {
        currentGrants = await getUserGrants(service, username).catch(() => ({
          allowedDatabases: [],
          allowedTables: [],
          role: null,
        }));
      }
      
      const ddl = generateUpdateUserDDL(username, input, currentGrants);
      
      return c.json({
        success: true,
        data: ddl,
      });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Generate update DDL error');
      return c.json({
        success: false,
        error: {
          code: 'DDL_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Failed to generate update DDL',
        },
      }, 500);
    }
  }
);

// Update ClickHouse user
clickhouseUsersRoutes.patch(
  '/:username',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:update'),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const service = getClickHouseService(c);
      const username = decodeURIComponent(c.req.param('username'));
      const body = await c.req.json();
      logger.debug({ module: 'ClickHouse Users' }, 'Update request received');
      const parseResult = updateUserSchema.safeParse(body);
      if (!parseResult.success) {
        requestLogger(c.get('requestId')).error(
          { module: 'ClickHouse Users', errors: parseResult.error.errors },
          'Update validation error'
        );
        return c.json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: parseResult.error.errors,
          },
        }, 400);
      }
      const input = parseResult.data;

      const connectionId = getConnectionId(c);
      
      // Try to get current grants from metadata first, fallback to parsing grants
      let currentGrants: { allowedDatabases?: string[]; allowedTables?: Array<{ database: string; table: string }>; role?: ClickHouseUserRole | null; authType?: string } | undefined;
      
      if (connectionId) {
        try {
          const { getUserMetadata } = await import('../services/clickhouseUsers');
          const metadata = await getUserMetadata(connectionId, username);
          if (metadata) {
            currentGrants = {
              role: metadata.role,
              allowedDatabases: metadata.allowedDatabases,
              allowedTables: metadata.allowedTables,
              authType: metadata.authType || undefined, // Include authType so it can be used in DDL generation
            };
          }
        } catch (error) {
          requestLogger(c.get('requestId')).warn(
            { module: 'ClickHouse Users', username, err: error instanceof Error ? error.message : String(error) },
            'Failed to load metadata, falling back to grants parsing'
          );
        }
      }
      
      // Fallback to parsing grants if metadata not available
      if (!currentGrants) {
        currentGrants = await getUserGrants(service, username).catch(() => ({
          allowedDatabases: [],
          allowedTables: [],
          role: null,
        }));
      }
      
      await updateClickHouseUser(service, username, input, connectionId, currentGrants);
      
      // Log audit event
      await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_USER_UPDATE, user.sub, {
        resourceType: 'clickhouse_user',
        resourceId: username,
        details: {
          username,
          changes: Object.keys(input),
        },
        ipAddress: getClientIp(c),
      });
      
      return c.json({
        success: true,
        data: { username },
      });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Update error');
      const errorInfo = handleError(error, 'UPDATE_FAILED', 'Failed to update ClickHouse user');
      return c.json({
        success: false,
        error: {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      }, errorInfo.statusCode);
    }
  }
);

// Delete ClickHouse user
clickhouseUsersRoutes.delete(
  '/:username',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:delete'),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const service = getClickHouseService(c);
      const username = decodeURIComponent(c.req.param('username'));
      const connectionId = getConnectionId(c);
      
      await deleteClickHouseUser(service, username, connectionId);
      
      // Log audit event
      await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_USER_DELETE, user.sub, {
        resourceType: 'clickhouse_user',
        resourceId: username,
        details: {
          username,
        },
        ipAddress: getClientIp(c),
      });
      
      return c.json({
        success: true,
        data: { deleted: true },
      });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Delete error');
      const errorInfo = handleError(error, 'DELETE_FAILED', 'Failed to delete ClickHouse user');
      return c.json({
        success: false,
        error: {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      }, errorInfo.statusCode);
    }
  }
);

// Sync unregistered ClickHouse users to metadata
clickhouseUsersRoutes.post(
  '/sync',
  rbacAuthMiddleware,
  requirePermission('clickhouse:users:create'),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const service = getClickHouseService(c);
      const connectionId = getConnectionId(c);
      
      if (!connectionId) {
        return c.json({
          success: false,
          error: {
            code: 'NO_CONNECTION',
            message: 'No active ClickHouse connection',
          },
        }, 400);
      }
      
      const result = await syncUnregisteredUsers(service, connectionId, user.sub);
      
      // Log audit event
      await createAuditLogWithContext(c, AUDIT_ACTIONS.CH_USER_SYNC, user.sub, {
        resourceType: 'clickhouse_users',
        resourceId: connectionId,
        details: {
          synced: result.synced,
          errors: result.errors.length,
        },
        ipAddress: getClientIp(c),
      });
      
      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'ClickHouse Users', err: error instanceof Error ? error.message : String(error) }, 'Sync error');
      const errorInfo = handleError(error, 'SYNC_FAILED', 'Failed to sync unregistered users');
      return c.json({
        success: false,
        error: {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      }, errorInfo.statusCode);
    }
  }
);

export default clickhouseUsersRoutes;
