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
import { logger } from '../utils/logger';

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
  const status = await getMigrationStatus();
  logger.info(
    {
      phase: 'cli',
      command: 'status',
      appVersion: APP_VERSION,
      dbVersion: status.currentVersion || null,
      targetVersion: status.targetVersion,
      pendingMigrations: status.pendingMigrations,
      appliedMigrations: status.appliedMigrations.map((m) => ({ version: m.version, name: m.name, appliedAt: m.appliedAt.toISOString() })),
    },
    'RBAC migration status'
  );
}

async function runMigrate() {
  const firstRun = await isFirstRun();
  const result = await runMigrations();
  if (result.isFirstRun) {
    await seedDatabase();
  }
  logger.info(
    {
      phase: 'cli',
      command: 'migrate',
      firstRun,
      isFirstRun: result.isFirstRun,
      previousVersion: result.previousVersion ?? null,
      currentVersion: result.currentVersion,
      migrationsApplied: result.migrationsApplied,
      seeded: result.isFirstRun,
    },
    'RBAC migrations completed'
  );
}

async function runSeed() {
  const needs = await needsSeeding();
  await seedDatabase();
  logger.info({ phase: 'cli', command: 'seed', alreadyHadData: !needs }, 'Seeding complete');
}

async function resetDatabase() {
  const confirm = process.env.CONFIRM_RESET === 'yes';
  if (!confirm) {
    logger.warn({ phase: 'cli', command: 'reset' }, 'Reset cancelled. Set CONFIRM_RESET=yes to proceed.');
    return;
  }
  const { dropRbacTables } = await import('./db/reset');
  const { dropped, failed } = await dropRbacTables();
  logger.info({ phase: 'cli', command: 'reset', dropped: dropped.length, failed }, 'Database reset complete');
  if (failed.length > 0) process.exitCode = 1;
}

async function showVersion() {
  const current = await getCurrentVersion();
  logger.info({ phase: 'cli', command: 'version', rbacVersion: current ?? null, appVersion: APP_VERSION }, 'RBAC version');
}

function showHelp() {
  logger.info(
    { phase: 'cli', command: 'help' },
    'RBAC CLI: status | migrate | seed | reset | version | help'
  );
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'help') as Command;
  
  if (!(command in COMMANDS)) {
    logger.error({ phase: 'cli', command }, 'Unknown command');
    showHelp();
    process.exit(1);
  }

  if (command !== 'help') {
    const config = getDatabaseConfig();
    logger.info(
      { phase: 'cli', db: config.type === 'sqlite' ? config.sqlitePath : 'PostgreSQL' },
      'Database connection'
    );
    await initializeDatabase(config);
  }

  try {
    await COMMANDS[command]();
  } catch (error) {
    logger.error(
      { phase: 'cli', err: error instanceof Error ? error.message : String(error) },
      'CLI error'
    );
    process.exit(1);
  } finally {
    if (command !== 'help') {
      await closeDatabase();
    }
  }
}

main().catch((err) => {
  logger.error({ phase: 'cli', err: err instanceof Error ? err.message : String(err) }, 'CLI fatal');
  process.exit(1);
});
