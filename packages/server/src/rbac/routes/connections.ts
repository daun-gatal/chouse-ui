/**
 * ClickHouse Connections Routes
 * 
 * API endpoints for managing ClickHouse server connections.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'crypto';
import {
  createConnection,
  getConnectionById,
  getConnectionWithPassword,
  listConnections,
  updateConnection,
  deleteConnection,
  testConnection,
  testSavedConnection,
  getDefaultConnection,
  getUserConnections,
  getConnectionUsers,
  grantConnectionAccess,
  revokeConnectionAccess,
} from '../services/connections';
import { rbacAuthMiddleware, requirePermission, getRbacUser, getClientIp } from '../middleware';
import { createAuditLog } from '../services/rbac';
import { AUDIT_ACTIONS, PERMISSIONS } from '../schema/base';
import { ClickHouseService, createSession, destroySession, getSession } from '../../services/clickhouse';
import type { ConnectionConfig } from '../../types';

const connectionsRoutes = new Hono();

// ============================================
// Validation Schemas
// ============================================

const createConnectionSchema = z.object({
  name: z.string().min(1).max(255),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(8123),
  username: z.string().min(1).max(255),
  password: z.string().optional(),
  database: z.string().max(255).optional(),
  sslEnabled: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

const updateConnectionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(255).optional(),
  password: z.string().optional(),
  database: z.string().max(255).optional().nullable(),
  sslEnabled: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const testConnectionSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(8123),
  username: z.string().min(1).max(255),
  password: z.string().optional(),
  database: z.string().max(255).optional(),
  sslEnabled: z.boolean().default(false),
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  activeOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================
// Routes
// ============================================

// List all connections (requires connections:view permission)
connectionsRoutes.get(
  '/',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.CONNECTIONS_VIEW),
  zValidator('query', listQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid('query');
      const result = await listConnections({
        search: query.search,
        activeOnly: query.activeOnly,
        limit: query.limit,
        offset: query.offset,
      });

      return c.json({
        success: true,
        data: {
          connections: result.connections,
          total: result.total,
          limit: query.limit,
          offset: query.offset,
        },
      });
    } catch (error) {
      console.error('[Connections] List error:', error);
      return c.json({
        success: false,
        error: {
          code: 'LIST_FAILED',
          message: error instanceof Error ? error.message : 'Failed to list connections',
        },
      }, 500);
    }
  }
);

// Get current user's accessible connections
connectionsRoutes.get(
  '/my',
  rbacAuthMiddleware,
  async (c) => {
    try {
      const user = getRbacUser(c);
      const isSuperAdmin = user.roles.includes('super_admin');
      const isBasicAdmin = user.roles.includes('admin') && !isSuperAdmin;

      // Super admins get all active connections
      if (isSuperAdmin) {
        const result = await listConnections({ activeOnly: true });
        return c.json({
          success: true,
          data: result.connections,
        });
      }

      // Basic admins and regular users get their accessible connections (or default if none assigned)
      const connections = await getUserConnections(user.sub);
      return c.json({
        success: true,
        data: connections,
      });
    } catch (error) {
      console.error('[Connections] My connections error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch your connections',
        },
      }, 500);
    }
  }
);

// Get default connection
connectionsRoutes.get(
  '/default',
  rbacAuthMiddleware,
  async (c) => {
    try {
      const connection = await getDefaultConnection();

      if (!connection) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'No default connection configured',
          },
        }, 404);
      }

      return c.json({
        success: true,
        data: connection,
      });
    } catch (error) {
      console.error('[Connections] Get default error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch default connection',
        },
      }, 500);
    }
  }
);

// Get connection by ID
connectionsRoutes.get(
  '/:id',
  rbacAuthMiddleware,
  requirePermission('settings:view'),
  async (c) => {
    try {
      const id = c.req.param('id');
      const connection = await getConnectionById(id);

      if (!connection) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Connection not found',
          },
        }, 404);
      }

      return c.json({
        success: true,
        data: connection,
      });
    } catch (error) {
      console.error('[Connections] Get by ID error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch connection',
        },
      }, 500);
    }
  }
);

// Create new connection (requires connections:edit permission)
connectionsRoutes.post(
  '/',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.CONNECTIONS_EDIT),
  zValidator('json', createConnectionSchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const input = c.req.valid('json');

      const connection = await createConnection(input, user.sub);

      // Log audit event
      await createAuditLog(AUDIT_ACTIONS.SETTINGS_UPDATE, user.sub, {
        resourceType: 'connection',
        resourceId: connection.id,
        details: {
          operation: 'create',
          connectionName: connection.name,
          host: connection.host,
        },
        ipAddress: getClientIp(c),
        userAgent: c.req.header('User-Agent'),
      });

      return c.json({
        success: true,
        data: connection,
      }, 201);
    } catch (error) {
      console.error('[Connections] Create error:', error);
      return c.json({
        success: false,
        error: {
          code: 'CREATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to create connection',
        },
      }, 500);
    }
  }
);

// Update connection (requires connections:edit permission)
connectionsRoutes.patch(
  '/:id',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.CONNECTIONS_EDIT),
  zValidator('json', updateConnectionSchema),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const id = c.req.param('id');
      const input = c.req.valid('json');

      const connection = await updateConnection(id, input);

      if (!connection) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Connection not found',
          },
        }, 404);
      }

      // Log audit event
      await createAuditLog(AUDIT_ACTIONS.SETTINGS_UPDATE, user.sub, {
        resourceType: 'connection',
        resourceId: connection.id,
        details: {
          operation: 'update',
          connectionName: connection.name,
          changes: Object.keys(input),
        },
        ipAddress: getClientIp(c),
        userAgent: c.req.header('User-Agent'),
      });

      return c.json({
        success: true,
        data: connection,
      });
    } catch (error) {
      console.error('[Connections] Update error:', error);
      return c.json({
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to update connection',
        },
      }, 500);
    }
  }
);

// Delete connection (requires connections:delete permission)
connectionsRoutes.delete(
  '/:id',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.CONNECTIONS_DELETE),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const id = c.req.param('id');

      // Get connection info before deleting (for audit log)
      const existing = await getConnectionById(id);
      if (!existing) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Connection not found',
          },
        }, 404);
      }

      const deleted = await deleteConnection(id);

      if (!deleted) {
        return c.json({
          success: false,
          error: {
            code: 'DELETE_FAILED',
            message: 'Failed to delete connection',
          },
        }, 500);
      }

      // Log audit event
      await createAuditLog(AUDIT_ACTIONS.SETTINGS_UPDATE, user.sub, {
        resourceType: 'connection',
        resourceId: id,
        details: {
          operation: 'delete',
          connectionName: existing.name,
          host: existing.host,
        },
        ipAddress: getClientIp(c),
        userAgent: c.req.header('User-Agent'),
      });

      return c.json({
        success: true,
        data: { deleted: true },
      });
    } catch (error) {
      console.error('[Connections] Delete error:', error);
      return c.json({
        success: false,
        error: {
          code: 'DELETE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to delete connection',
        },
      }, 500);
    }
  }
);

// Test connection (without saving)
connectionsRoutes.post(
  '/test',
  rbacAuthMiddleware,
  requirePermission('settings:view'),
  zValidator('json', testConnectionSchema),
  async (c) => {
    try {
      const input = c.req.valid('json');
      const result = await testConnection({
        name: 'test',
        ...input,
      });

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[Connections] Test error:', error);
      return c.json({
        success: false,
        error: {
          code: 'TEST_FAILED',
          message: error instanceof Error ? error.message : 'Connection test failed',
        },
      }, 500);
    }
  }
);

// Test saved connection (requires connections:view permission)
connectionsRoutes.post(
  '/:id/test',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.CONNECTIONS_VIEW),
  async (c) => {
    try {
      const id = c.req.param('id');
      const result = await testSavedConnection(id);

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[Connections] Test saved error:', error);
      return c.json({
        success: false,
        error: {
          code: 'TEST_FAILED',
          message: error instanceof Error ? error.message : 'Connection test failed',
        },
      }, 500);
    }
  }
);

// Connect to a saved connection (creates ClickHouse session)
connectionsRoutes.post(
  '/:id/connect',
  rbacAuthMiddleware,
  async (c) => {
    try {
      const user = getRbacUser(c);
      const id = c.req.param('id');
      const isSuperAdmin = user.roles.includes('super_admin');

      // Verify user has access to this connection
      // Super admins have access to all connections, but basic admins need explicit access
      if (!isSuperAdmin) {
        const userConns = await getUserConnections(user.sub);
        const hasAccess = userConns.some(conn => conn.id === id);
        if (!hasAccess) {
          return c.json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have access to this connection',
            },
          }, 403);
        }
      }

      // Get connection with decrypted password
      const connection = await getConnectionWithPassword(id);
      if (!connection) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Connection not found',
          },
        }, 404);
      }

      // Check if connection is active
      if (!connection.isActive) {
        return c.json({
          success: false,
          error: {
            code: 'INACTIVE',
            message: 'This connection is not active',
          },
        }, 400);
      }

      // Build connection URL
      const protocol = connection.sslEnabled ? 'https' : 'http';
      const url = `${protocol}://${connection.host}:${connection.port}`;

      // Build connection config
      const config: ConnectionConfig = {
        url,
        username: connection.username,
        password: connection.password || '',
        database: connection.database || undefined,
      };

      // Create ClickHouse service to test connection
      const testService = new ClickHouseService(config);

      // Test connection first
      const isConnected = await testService.ping();
      if (!isConnected) {
        return c.json({
          success: false,
          error: {
            code: 'CONNECTION_FAILED',
            message: 'Failed to connect to ClickHouse server',
          },
        }, 503);
      }

      // Get version and admin status
      const [version, adminStatus] = await Promise.all([
        testService.getVersion(),
        testService.checkIsAdmin(),
      ]);

      // Create session with RBAC connection ID and user ID
      const sessionId = randomUUID();
      createSession(sessionId, config, {
        createdAt: new Date(),
        lastUsedAt: new Date(),
        isAdmin: adminStatus.isAdmin,
        permissions: adminStatus.permissions,
        version,
        rbacConnectionId: connection.id, // Store which RBAC connection this session uses
        rbacUserId: user.sub, // Store which RBAC user owns this session
      });

      // Log audit event
      await createAuditLog(AUDIT_ACTIONS.SETTINGS_UPDATE, user.sub, {
        resourceType: 'connection',
        resourceId: connection.id,
        details: {
          operation: 'connect',
          connectionName: connection.name,
          host: connection.host,
        },
        ipAddress: getClientIp(c),
        userAgent: c.req.header('User-Agent'),
      });

      return c.json({
        success: true,
        data: {
          sessionId,
          connectionId: connection.id,
          connectionName: connection.name,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          database: connection.database,
          isAdmin: adminStatus.isAdmin,
          permissions: adminStatus.permissions,
          version,
        },
      });

    } catch (error) {
      console.error('[Connections] Connect error:', error);
      return c.json({
        success: false,
        error: {
          code: 'CONNECT_FAILED',
          message: error instanceof Error ? error.message : 'Failed to connect to ClickHouse',
        },
      }, 500);
    }
  }
);

// Disconnect from ClickHouse (destroy session)
connectionsRoutes.post(
  '/disconnect',
  rbacAuthMiddleware,
  async (c) => {
    try {
      const sessionId = c.req.header('X-Session-ID');

      if (sessionId) {
        await destroySession(sessionId);
      }

      return c.json({
        success: true,
        data: { disconnected: true },
      });
    } catch (error) {
      console.error('[Connections] Disconnect error:', error);
      return c.json({
        success: false,
        error: {
          code: 'DISCONNECT_FAILED',
          message: 'Failed to disconnect',
        },
      }, 500);
    }
  }
);

// Get current ClickHouse session status
connectionsRoutes.get(
  '/session',
  rbacAuthMiddleware,
  async (c) => {
    try {
      const sessionId = c.req.header('X-Session-ID');

      if (!sessionId) {
        return c.json({
          success: true,
          data: { connected: false },
        });
      }

      const sessionData = getSession(sessionId);

      if (!sessionData) {
        return c.json({
          success: true,
          data: { connected: false },
        });
      }

      return c.json({
        success: true,
        data: {
          connected: true,
          sessionId,
          username: sessionData.session.connectionConfig.username,
          isAdmin: sessionData.session.isAdmin,
          permissions: sessionData.session.permissions,
          version: sessionData.session.version,
        },
      });
    } catch (error) {
      console.error('[Connections] Session status error:', error);
      return c.json({
        success: false,
        error: {
          code: 'SESSION_CHECK_FAILED',
          message: 'Failed to check session status',
        },
      }, 500);
    }
  }
);

// Grant user access to connection (requires connections:edit permission)
connectionsRoutes.post(
  '/:id/access/:userId',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.CONNECTIONS_EDIT),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const connectionId = c.req.param('id');
      const targetUserId = c.req.param('userId');

      await grantConnectionAccess(targetUserId, connectionId);

      // Log audit event
      await createAuditLog(AUDIT_ACTIONS.USER_UPDATE, user.sub, {
        resourceType: 'user_connection',
        resourceId: `${targetUserId}:${connectionId}`,
        details: {
          operation: 'grant_access',
          targetUserId,
          connectionId,
        },
        ipAddress: getClientIp(c),
        userAgent: c.req.header('User-Agent'),
      });

      return c.json({
        success: true,
        data: { granted: true },
      });
    } catch (error) {
      console.error('[Connections] Grant access error:', error);
      return c.json({
        success: false,
        error: {
          code: 'GRANT_FAILED',
          message: 'Failed to grant connection access',
        },
      }, 500);
    }
  }
);

// Revoke user access to connection (requires connections:delete permission)
connectionsRoutes.delete(
  '/:id/access/:userId',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.CONNECTIONS_DELETE),
  async (c) => {
    try {
      const user = getRbacUser(c);
      const connectionId = c.req.param('id');
      const targetUserId = c.req.param('userId');

      await revokeConnectionAccess(targetUserId, connectionId);

      // Log audit event
      await createAuditLog(AUDIT_ACTIONS.USER_UPDATE, user.sub, {
        resourceType: 'user_connection',
        resourceId: `${targetUserId}:${connectionId}`,
        details: {
          operation: 'revoke_access',
          targetUserId,
          connectionId,
        },
        ipAddress: getClientIp(c),
        userAgent: c.req.header('User-Agent'),
      });

      return c.json({
        success: true,
        data: { revoked: true },
      });
    } catch (error) {
      console.error('[Connections] Revoke access error:', error);
      return c.json({
        success: false,
        error: {
          code: 'REVOKE_FAILED',
          message: 'Failed to revoke connection access',
        },
      }, 500);
    }
  }
);

// Get users with access to a connection (requires connections:view permission)
connectionsRoutes.get(
  '/:id/users',
  rbacAuthMiddleware,
  requirePermission(PERMISSIONS.CONNECTIONS_VIEW),
  async (c) => {
    try {
      const connectionId = c.req.param('id');

      // Verify connection exists
      const connection = await getConnectionById(connectionId);
      if (!connection) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Connection not found',
          },
        }, 404);
      }

      const users = await getConnectionUsers(connectionId);

      return c.json({
        success: true,
        data: users,
      });
    } catch (error) {
      console.error('[Connections] Get users error:', error);
      return c.json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: error instanceof Error ? error.message : 'Failed to fetch users',
        },
      }, 500);
    }
  }
);

export default connectionsRoutes;
