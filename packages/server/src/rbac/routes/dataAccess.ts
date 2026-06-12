/**
 * Data Access Routes
 *
 * Runtime access checks and resource filtering for the current user. Management
 * of data access rules now lives in data access policies (see
 * `dataAccessPolicies.ts` route + service).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  checkUserAccess,
  filterDatabasesForUser,
  filterTablesForUser,
  type AccessType,
} from '../services/dataAccess';
import { rbacAuthMiddleware, getRbacUser } from '../middleware';
import { requestLogger } from '../../utils/logger';

const dataAccessRoutes = new Hono();

// ============================================
// Validation Schemas
// ============================================

const accessTypeSchema = z.enum(['read', 'write', 'admin']);

const checkAccessSchema = z.object({
  database: z.string().min(1),
  table: z.string().optional(),
  accessType: accessTypeSchema.default('read'),
  connectionId: z.string().uuid().optional(),
});

// ============================================
// Routes
// ============================================

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

      return c.json({ success: true, data: result });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'DataAccess', err: error instanceof Error ? error.message : String(error) }, 'Check access error');
      return c.json({
        success: false,
        error: { code: 'CHECK_FAILED', message: 'Failed to check access' },
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
      const { databases, connectionId } = c.req.valid('json');

      // Admins get all databases
      if (isAdmin) {
        return c.json({ success: true, data: databases });
      }

      const filtered = await filterDatabasesForUser(user.sub, databases, connectionId);
      return c.json({ success: true, data: filtered });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'DataAccess', err: error instanceof Error ? error.message : String(error) }, 'Filter databases error');
      return c.json({
        success: false,
        error: { code: 'FILTER_FAILED', message: 'Failed to filter databases' },
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
      const { database, tables, connectionId } = c.req.valid('json');

      // Admins get all tables
      if (isAdmin) {
        return c.json({ success: true, data: tables });
      }

      const filtered = await filterTablesForUser(user.sub, database, tables, connectionId);
      return c.json({ success: true, data: filtered });
    } catch (error) {
      requestLogger(c.get('requestId')).error({ module: 'DataAccess', err: error instanceof Error ? error.message : String(error) }, 'Filter tables error');
      return c.json({
        success: false,
        error: { code: 'FILTER_FAILED', message: 'Failed to filter tables' },
      }, 500);
    }
  }
);

export default dataAccessRoutes;
