/**
 * RBAC Routes Index
 * 
 * Combines all RBAC routes.
 */

import { Hono } from 'hono';
import { requestLogger } from '../../utils/logger';
import authRoutes from './auth';
import patRoutes from './personalAccessTokens';
import userRoutes from './users';
import roleRoutes from './roles';
import auditRoutes from './audit';
import connectionsRoutes from './connections';
import dataAccessRoutes from './dataAccess';
import dataAccessPoliciesRoutes from './dataAccessPolicies';
import clickhouseUsersRoutes from './clickhouseUsers';
import clickhouseRolesRoutes from './clickhouseRoles';
import userPreferencesRoutes from './userPreferences';
import aiProvidersRoutes from './aiProviders';
import aiModelsRoutes from './aiModels';
import aiConfigsRoutes from './aiConfigs';
import ssoRoutes from '../sso/routes';
import ssoAdminRoutes from './ssoAdmin';

const rbacRoutes = new Hono();

// Mount routes
rbacRoutes.route('/auth', authRoutes);
rbacRoutes.route('/pats', patRoutes);
rbacRoutes.route('/auth/sso', ssoRoutes);
rbacRoutes.route('/users', userRoutes);
rbacRoutes.route('/roles', roleRoutes);
rbacRoutes.route('/audit', auditRoutes);
rbacRoutes.route('/connections', connectionsRoutes);
rbacRoutes.route('/data-access', dataAccessRoutes);
rbacRoutes.route('/data-access-policies', dataAccessPoliciesRoutes);
rbacRoutes.route('/clickhouse-users', clickhouseUsersRoutes);
rbacRoutes.route('/clickhouse-roles', clickhouseRolesRoutes);
rbacRoutes.route('/user-preferences', userPreferencesRoutes);
rbacRoutes.route('/ai-providers', aiProvidersRoutes);
rbacRoutes.route('/ai-base-models', aiModelsRoutes);
rbacRoutes.route('/ai-models', aiConfigsRoutes);
rbacRoutes.route('/sso-admin', ssoAdminRoutes);

// Health check for RBAC system
rbacRoutes.get('/health', async (c) => {
  const { checkDatabaseHealth } = await import('../db');
  const health = await checkDatabaseHealth();
  // Public endpoint: the raw driver error can name hosts or credentials, so it
  // goes to the log, not the response.
  if (!health.healthy) {
    requestLogger(c.get('requestId')).error({ module: 'RBAC', err: health.error }, 'RBAC database health check failed');
  }

  return c.json({
    success: health.healthy,
    data: {
      status: health.healthy ? 'healthy' : 'unhealthy',
      database: health.type,
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
    requestLogger(c.get('requestId')).error(
      { module: 'RBAC', err: error instanceof Error ? error.message : String(error) },
      'RBAC status check failed'
    );
    return c.json({
      success: false,
      error: { message: 'Failed to get status' },
    }, 500);
  }
});

export default rbacRoutes;
