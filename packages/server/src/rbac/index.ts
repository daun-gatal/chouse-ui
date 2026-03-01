/**
 * RBAC Module
 * 
 * Role-Based Access Control system for CHouse UI.
 * 
 * Features:
 * - User management with roles and permissions
 * - JWT-based authentication
 * - Support for SQLite (development) and PostgreSQL (production)
 * - Audit logging
 * - Version-based migrations
 * 
 * Migration Strategy:
 * - First run: Creates full schema + seeds default data
 * - Upgrades: Runs only new migrations since last version
 * 
 * @example
 * ```typescript
 * import { initializeRbac, rbacRoutes } from './rbac';
 * 
 * // Initialize RBAC
 * await initializeRbac();
 * 
 * // Mount routes
 * app.route('/api/rbac', rbacRoutes);
 * ```
 */

// Schema exports
export * from './schema';
export * from './schema/base';

// Service exports
export * from './services';

// Middleware exports
export * from './middleware';

// Database exports
export { 
  initializeDatabase, 
  closeDatabase, 
  getDatabaseType,
  checkDatabaseHealth,
  runMigrations,
  getMigrationStatus,
  needsUpgrade,
  getCurrentVersion,
  isFirstRun,
  APP_VERSION,
  type DatabaseType,
  type DatabaseConfig,
  type MigrationResult,
  type MigrationStatus,
} from './db';

// Route exports
export { default as rbacRoutes } from './routes';

// ============================================
// Initialization
// ============================================

import { initializeDatabase, getDatabaseConfig } from './db';
import { runMigrations, APP_VERSION, type MigrationResult } from './db/migrations';
import { seedDatabase, needsSeeding } from './services/seed';
import { logger } from '../utils/logger';

/**
 * Initialize the RBAC system
 * 
 * This handles both fresh installations and upgrades:
 * 1. Connects to database
 * 2. Runs pending migrations (creates schema on first run)
 * 3. Seeds default data if needed (only on first run)
 * 
 * @returns Initialization result with migration details
 */
export async function initializeRbac(): Promise<{
  version: string;
  isFirstRun: boolean;
  migrationsApplied: string[];
  seeded: boolean;
}> {
  const config = getDatabaseConfig();

  logger.info({ module: "RBAC", dbType: config.type, appVersion: APP_VERSION }, "Initializing RBAC system");

  // Step 1: Initialize database connection
  await initializeDatabase(config);

  // Step 2: Run migrations (handles both first run and upgrades)
  let migrationResult: MigrationResult;
  try {
    migrationResult = await runMigrations();
  } catch (error) {
    logger.error({ module: "RBAC", err: error instanceof Error ? error.message : String(error) }, "Migration failed");
    throw error;
  }

  // Step 3: Seed database if this is a first run
  let seeded = false;
  if (migrationResult.isFirstRun) {
    logger.info({ module: "RBAC" }, "First run - seeding database with default data");
    try {
      await seedDatabase();
      seeded = true;
    } catch (error) {
      logger.error({ module: "RBAC", err: error instanceof Error ? error.message : String(error) }, "Seeding failed");
      throw error;
    }
  } else {
    if (await needsSeeding()) {
      logger.info({ module: "RBAC" }, "Database needs seeding");
      await seedDatabase();
      seeded = true;
    }
  }

  logger.info(
    {
      module: "RBAC",
      version: migrationResult.currentVersion,
      isFirstRun: migrationResult.isFirstRun,
      migrationsApplied: migrationResult.migrationsApplied,
      seeded,
    },
    "RBAC initialization complete"
  );
  
  return {
    version: migrationResult.currentVersion,
    isFirstRun: migrationResult.isFirstRun,
    migrationsApplied: migrationResult.migrationsApplied,
    seeded,
  };
}

/**
 * Shutdown the RBAC system
 */
export async function shutdownRbac(): Promise<void> {
  const { closeDatabase } = await import('./db');
  await closeDatabase();
  logger.info({ module: "RBAC" }, "RBAC system shut down");
}

/**
 * Get RBAC system information
 */
export async function getRbacInfo(): Promise<{
  version: string;
  databaseType: string;
  migrationStatus: Awaited<ReturnType<typeof import('./db/migrations').getMigrationStatus>>;
}> {
  const { getDatabaseType, getMigrationStatus } = await import('./db');
  
  return {
    version: APP_VERSION,
    databaseType: getDatabaseType(),
    migrationStatus: await getMigrationStatus(),
  };
}
