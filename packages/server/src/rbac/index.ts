/**
 * RBAC Module
 * 
 * Role-Based Access Control system for ClickHouse Studio.
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
  
  console.log('[RBAC] ========================================');
  console.log('[RBAC] Initializing RBAC system...');
  console.log(`[RBAC] Database type: ${config.type}`);
  console.log(`[RBAC] App version: ${APP_VERSION}`);
  console.log('[RBAC] ========================================');
  
  // Step 1: Initialize database connection
  await initializeDatabase(config);
  
  // Step 2: Run migrations (handles both first run and upgrades)
  let migrationResult: MigrationResult;
  try {
    migrationResult = await runMigrations();
  } catch (error) {
    console.error('[RBAC] Migration failed:', error);
    throw error;
  }
  
  // Step 3: Seed database if this is a first run
  let seeded = false;
  if (migrationResult.isFirstRun) {
    console.log('[RBAC] First run - seeding database with default data...');
    try {
      await seedDatabase();
      seeded = true;
    } catch (error) {
      console.error('[RBAC] Seeding failed:', error);
      throw error;
    }
  } else {
    // Check if seeding is needed (e.g., roles table is empty)
    if (await needsSeeding()) {
      console.log('[RBAC] Database needs seeding...');
      await seedDatabase();
      seeded = true;
    }
  }
  
  // Log summary
  console.log('[RBAC] ========================================');
  console.log('[RBAC] Initialization complete!');
  console.log(`[RBAC] Version: ${migrationResult.currentVersion}`);
  console.log(`[RBAC] First run: ${migrationResult.isFirstRun}`);
  console.log(`[RBAC] Migrations applied: ${migrationResult.migrationsApplied.length > 0 ? migrationResult.migrationsApplied.join(', ') : 'none'}`);
  console.log(`[RBAC] Data seeded: ${seeded}`);
  console.log('[RBAC] ========================================');
  
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
  console.log('[RBAC] RBAC system shut down');
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
