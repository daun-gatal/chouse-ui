/**
 * RBAC Audit Log Routes
 * 
 * Handles audit log viewing and export.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getAuditLogs, deleteAuditLogs, createAuditLog } from '../services/rbac';
import { PERMISSIONS, AUDIT_ACTIONS } from '../schema/base';
import { requirePermission, requireAnyPermission, rbacAuthMiddleware } from '../middleware/rbacAuth';
import { AppError } from '../../types';

const auditRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const ListAuditLogsSchema = z.object({
  page: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  userId: z.string().optional(),
  action: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// ============================================
// Routes
// ============================================

/**
 * GET /rbac/audit
 * List audit logs with pagination and filters
 * 
 * Permission rules:
 * - Users with AUDIT_VIEW permission can view all audit logs
 * - Users without AUDIT_VIEW permission can only view their own audit logs (when userId matches their own ID)
 */
auditRoutes.get('/', zValidator('query', ListAuditLogsSchema), async (c) => {
  // First ensure user is authenticated
  await rbacAuthMiddleware(c, async () => { });

  const userId = c.get('rbacUserId');
  const permissions = c.get('rbacPermissions');
  const hasAuditView = permissions.includes(PERMISSIONS.AUDIT_VIEW);

  const query = c.req.valid('query');

  // If user doesn't have AUDIT_VIEW permission, they can only view their own logs
  let effectiveUserId = query.userId;
  if (!hasAuditView) {
    // Check if they're trying to view another user's logs without permission
    if (query.userId && query.userId !== userId) {
      // Trying to view another user's logs without permission
      throw AppError.forbidden(`Permission '${PERMISSIONS.AUDIT_VIEW}' required to view other users' audit logs`);
    }
    // Force userId to be the current user's ID
    effectiveUserId = userId;
  }

  // Validate userId format if provided
  if (effectiveUserId && typeof effectiveUserId !== 'string') {
    throw AppError.badRequest('Invalid userId format');
  }

  let result;
  try {
    result = await getAuditLogs({
      page: query.page || 1,
      limit: query.limit || 50,
      userId: effectiveUserId,
      action: query.action,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  } catch (error) {
    console.error('[Audit] Failed to fetch audit logs:', error);
    throw AppError.internal('Failed to fetch audit logs');
  }

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * GET /rbac/audit/actions
 * Get list of available audit actions
 */
auditRoutes.get('/actions', requirePermission(PERMISSIONS.AUDIT_VIEW), async (c) => {
  const actions = Object.values(AUDIT_ACTIONS);

  // Group actions by category
  const groupedActions: Record<string, string[]> = {};
  for (const action of actions) {
    const category = action.split('.')[0];
    if (!groupedActions[category]) {
      groupedActions[category] = [];
    }
    groupedActions[category].push(action);
  }

  return c.json({
    success: true,
    data: {
      actions,
      groupedActions,
    },
  });
});

/**
 * GET /rbac/audit/export
 * Export audit logs as CSV
 */
auditRoutes.get('/export', requirePermission(PERMISSIONS.AUDIT_EXPORT), zValidator('query', ListAuditLogsSchema), async (c) => {
  const query = c.req.valid('query');

  // Get all logs for export (with higher limit)
  const result = await getAuditLogs({
    page: 1,
    limit: 10000, // Export limit
    userId: query.userId,
    action: query.action,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
  });

  // Convert to CSV
  const headers = ['ID', 'User ID', 'Username (Snapshot)', 'Email (Snapshot)', 'Display Name (Snapshot)', 'Action', 'Resource Type', 'Resource ID', 'Status', 'IP Address', 'Created At'];
  const rows = result.logs.map(log => [
    log.id,
    log.userId || '',
    log.usernameSnapshot || '',
    log.emailSnapshot || '',
    log.displayNameSnapshot || '',
    log.action,
    log.resourceType || '',
    log.resourceId || '',
    log.status,
    log.ipAddress || '',
    new Date(log.createdAt).toISOString(),
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);

  return c.body(csv);
});

/**
 * GET /rbac/audit/stats
 * Get audit log statistics
 */
auditRoutes.get('/stats', requirePermission(PERMISSIONS.AUDIT_VIEW), async (c) => {
  // Get logs for the last 24 hours for stats
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await getAuditLogs({
    page: 1,
    limit: 10000,
    startDate: oneDayAgo,
  });

  // Calculate stats
  const stats = {
    totalEvents: result.total,
    last24Hours: result.logs.length,
    byAction: {} as Record<string, number>,
    byStatus: { success: 0, failure: 0 } as Record<string, number>,
    byHour: {} as Record<string, number>,
  };

  for (const log of result.logs) {
    // By action
    stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;

    // By status
    stats.byStatus[log.status] = (stats.byStatus[log.status] || 0) + 1;

    // By hour
    const hour = new Date(log.createdAt).getHours().toString().padStart(2, '0') + ':00';
    stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
  }

  return c.json({
    success: true,
    data: { stats },
  });
});

/**
 * DELETE /rbac/audit
 * Delete audit logs with filters
 */
auditRoutes.delete('/', requirePermission(PERMISSIONS.AUDIT_DELETE), zValidator('query', ListAuditLogsSchema), async (c) => {
  const query = c.req.valid('query');
  const userId = c.get('rbacUserId');

  try {
    const result = await deleteAuditLogs({
      userId: query.userId,
      action: query.action,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });

    // Log the deletion action
    await createAuditLog(
      AUDIT_ACTIONS.AUDIT_LOG_DELETE,
      userId,
      {
        resourceType: 'audit_log',
        details: {
          deletedCount: result.deletedCount,
          filters: query,
        },
        status: 'success',
      }
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[Audit] Failed to delete audit logs:', error);
    throw AppError.internal('Failed to delete audit logs');
  }
});

export default auditRoutes;
