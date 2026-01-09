#!/usr/bin/env bun
/**
 * RBAC CLI
 * 
 * Command-line interface for managing RBAC migrations and database operations.
 * 
 * Usage:
 *   bun run src/rbac/cli.ts <command>
 * 
 * Commands:
 *   status    - Show current migration status
 *   migrate   - Run pending migrations
 *   seed      - Run database seeding
 *   reset     - Reset database (DANGEROUS - drops all data)
 *   version   - Show current version
 */

import { 
  initializeDatabase, 
  closeDatabase, 
  getDatabaseConfig,
} from './db';
import {
  runMigrations,
  getMigrationStatus,
  getCurrentVersion,
  isFirstRun,
  APP_VERSION,
} from './db/migrations';
import { seedDatabase, needsSeeding } from './services/seed';

const COMMANDS = {
  status: showStatus,
  migrate: runMigrate,
  seed: runSeed,
  reset: resetDatabase,
  version: showVersion,
  help: showHelp,
};

type Command = keyof typeof COMMANDS;

async function showStatus() {
  console.log('\n📊 RBAC Migration Status\n');
  console.log('═'.repeat(50));
  
  const status = await getMigrationStatus();
  
  console.log(`App Version:     ${APP_VERSION}`);
  console.log(`DB Version:      ${status.currentVersion || 'Not initialized'}`);
  console.log(`Target Version:  ${status.targetVersion}`);
  console.log('');
  
  if (status.pendingMigrations.length > 0) {
    console.log('⚠️  Pending Migrations:');
    for (const version of status.pendingMigrations) {
      console.log(`   - ${version}`);
    }
  } else {
    console.log('✅ All migrations are up to date');
  }
  
  console.log('');
  console.log('Applied Migrations:');
  if (status.appliedMigrations.length === 0) {
    console.log('   (none)');
  } else {
    for (const migration of status.appliedMigrations) {
      console.log(`   - ${migration.version}: ${migration.name} (${migration.appliedAt.toISOString()})`);
    }
  }
  
  console.log('');
}

async function runMigrate() {
  console.log('\n🚀 Running Migrations\n');
  console.log('═'.repeat(50));
  
  const firstRun = await isFirstRun();
  if (firstRun) {
    console.log('📦 First run detected - will create schema and seed data');
  }
  
  const result = await runMigrations();
  
  console.log('');
  console.log('Migration Result:');
  console.log(`   First run:    ${result.isFirstRun}`);
  console.log(`   From version: ${result.previousVersion || 'none'}`);
  console.log(`   To version:   ${result.currentVersion}`);
  console.log(`   Applied:      ${result.migrationsApplied.length} migration(s)`);
  
  if (result.migrationsApplied.length > 0) {
    console.log('');
    console.log('Applied:');
    for (const version of result.migrationsApplied) {
      console.log(`   ✅ ${version}`);
    }
  }
  
  // Seed if first run
  if (result.isFirstRun) {
    console.log('');
    console.log('🌱 Seeding database with default data...');
    await seedDatabase();
    console.log('✅ Database seeded');
  }
  
  console.log('');
}

async function runSeed() {
  console.log('\n🌱 Seeding Database\n');
  console.log('═'.repeat(50));
  
  const needs = await needsSeeding();
  
  if (!needs) {
    console.log('ℹ️  Database already has data. Seeding will add missing records.');
  }
  
  await seedDatabase();
  
  console.log('');
  console.log('✅ Seeding complete');
  console.log('');
}

async function resetDatabase() {
  console.log('\n⚠️  DATABASE RESET\n');
  console.log('═'.repeat(50));
  console.log('');
  console.log('This will DROP ALL TABLES and data!');
  console.log('');
  
  // In a real CLI, you'd prompt for confirmation
  const confirm = process.env.CONFIRM_RESET === 'yes';
  
  if (!confirm) {
    console.log('❌ Reset cancelled. Set CONFIRM_RESET=yes to proceed.');
    console.log('');
    console.log('Example:');
    console.log('   CONFIRM_RESET=yes bun run src/rbac/cli.ts reset');
    console.log('');
    return;
  }
  
  console.log('Dropping all RBAC tables...');
  
  const { getDatabase, isSqlite } = await import('./db');
  const { sql } = await import('drizzle-orm');
  const db = getDatabase();
  
  const tables = [
    '_rbac_migrations',
    'rbac_audit_logs',
    'rbac_refresh_tokens',
    'rbac_user_roles',
    'rbac_role_permissions',
    'rbac_permissions',
    'rbac_roles',
    'rbac_users',
  ];
  
  for (const table of tables) {
    try {
      if (isSqlite()) {
        (db as any).run(sql.raw(`DROP TABLE IF EXISTS ${table}`));
      } else {
        await (db as any).execute(sql.raw(`DROP TABLE IF EXISTS ${table} CASCADE`));
      }
      console.log(`   ✅ Dropped ${table}`);
    } catch (error) {
      console.log(`   ⚠️  Could not drop ${table}: ${error}`);
    }
  }
  
  console.log('');
  console.log('✅ Database reset complete');
  console.log('');
  console.log('Run "migrate" to recreate the schema.');
  console.log('');
}

async function showVersion() {
  const current = await getCurrentVersion();
  console.log(`\nRBAC Version: ${current || 'Not initialized'}`);
  console.log(`App Version:  ${APP_VERSION}\n`);
}

function showHelp() {
  console.log(`
RBAC Database Management CLI

Usage:
  bun run src/rbac/cli.ts <command>

Commands:
  status    Show current migration status
  migrate   Run pending migrations (and seed on first run)
  seed      Run database seeding (add default roles/permissions)
  reset     Reset database (DANGEROUS - requires CONFIRM_RESET=yes)
  version   Show current database and app versions
  help      Show this help message

Environment Variables:
  RBAC_DB_TYPE        Database type: 'sqlite' (default) or 'postgres'
  RBAC_SQLITE_PATH    SQLite database path (default: ./data/rbac.db)
  RBAC_POSTGRES_URL   PostgreSQL connection URL
  RBAC_ADMIN_EMAIL    Initial admin email (default: admin@localhost)
  RBAC_ADMIN_USERNAME Initial admin username (default: admin)
  RBAC_ADMIN_PASSWORD Initial admin password (default: admin123!)

Examples:
  # Check migration status
  bun run src/rbac/cli.ts status

  # Run migrations
  bun run src/rbac/cli.ts migrate

  # Reset and recreate database
  CONFIRM_RESET=yes bun run src/rbac/cli.ts reset
  bun run src/rbac/cli.ts migrate
`);
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'help') as Command;
  
  if (!(command in COMMANDS)) {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }
  
  // Initialize database connection (except for help)
  if (command !== 'help') {
    const config = getDatabaseConfig();
    console.log(`\n📁 Database: ${config.type === 'sqlite' ? config.sqlitePath : 'PostgreSQL'}`);
    
    await initializeDatabase(config);
  }
  
  try {
    await COMMANDS[command]();
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    if (command !== 'help') {
      await closeDatabase();
    }
  }
}

main().catch(console.error);
