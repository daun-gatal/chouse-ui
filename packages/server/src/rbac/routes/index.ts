/**
 * RBAC Routes Index
 * 
 * Combines all RBAC routes.
 */

import { Hono } from 'hono';
import authRoutes from './auth';
import userRoutes from './users';
import roleRoutes from './roles';
import auditRoutes from './audit';
import connectionsRoutes from './connections';
import dataAccessRoutes from './dataAccess';
import clickhouseUsersRoutes from './clickhouseUsers';

const rbacRoutes = new Hono();

// Mount routes
rbacRoutes.route('/auth', authRoutes);
rbacRoutes.route('/users', userRoutes);
rbacRoutes.route('/roles', roleRoutes);
rbacRoutes.route('/audit', auditRoutes);
rbacRoutes.route('/connections', connectionsRoutes);
rbacRoutes.route('/data-access', dataAccessRoutes);
rbacRoutes.route('/clickhouse-users', clickhouseUsersRoutes);

// Health check for RBAC system
rbacRoutes.get('/health', async (c) => {
  const { checkDatabaseHealth } = await import('../db');
  const health = await checkDatabaseHealth();
  
  return c.json({
    success: health.healthy,
    data: {
      status: health.healthy ? 'healthy' : 'unhealthy',
      database: health.type,
      error: health.error,
    },
  }, health.healthy ? 200 : 503);
});

// System status with version and migration info
rbacRoutes.get('/status', async (c) => {
  try {
    const { checkDatabaseHealth, getMigrationStatus, APP_VERSION } = await import('../db');
    
    const [health, migrations] = await Promise.all([
      checkDatabaseHealth(),
      getMigrationStatus(),
    ]);
    
    return c.json({
      success: true,
      data: {
        version: APP_VERSION,
        database: {
          type: health.type,
          healthy: health.healthy,
          error: health.error,
        },
        migrations: {
          currentVersion: migrations.currentVersion,
          targetVersion: migrations.targetVersion,
          pendingCount: migrations.pendingMigrations.length,
          pending: migrations.pendingMigrations,
          appliedCount: migrations.appliedMigrations.length,
          lastApplied: migrations.appliedMigrations.length > 0 
            ? migrations.appliedMigrations[migrations.appliedMigrations.length - 1]
            : null,
        },
      },
    });
  } catch (error) {
    return c.json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to get status',
      },
    }, 500);
  }
});

export default rbacRoutes;
