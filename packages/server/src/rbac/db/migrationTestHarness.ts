/**
 * Migration Test Harness
 *
 * Shared utilities for testing RBAC migrations against BOTH dialects:
 *   - SQLite  (in-memory, always available)
 *   - PostgreSQL (a throwaway Docker container; Docker is REQUIRED)
 *
 * This file is intentionally NOT a *.test.ts so the isolated test runner does
 * not execute it directly. See `migrations.test.ts` for usage and
 * `.rules`/CLAUDE.md for the mandatory testing policy.
 */

import { sql } from "drizzle-orm";
import {
  initializeDatabase,
  closeDatabase,
  getDatabase,
  getDatabaseType,
  type SqliteDb,
  type PostgresDb,
} from "./index";

export type Dialect = "sqlite" | "postgres";

// ============================================
// Raw query execution (dialect-agnostic)
// ============================================

export async function rawAll(query: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(query) as Array<Record<string, unknown>>;
  }
  const res = await (db as PostgresDb).execute(query);
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
}

export async function rawRun(query: ReturnType<typeof sql>): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(query);
  } else {
    await (db as PostgresDb).execute(query);
  }
}

// ============================================
// Schema / data assertions
// ============================================

export async function tableExists(name: string): Promise<boolean> {
  if (getDatabaseType() === "sqlite") {
    const rows = await rawAll(sql`SELECT name FROM sqlite_master WHERE type='table' AND name=${name}`);
    return rows.length > 0;
  }
  const rows = await rawAll(sql`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${name}`);
  return rows.length > 0;
}

export async function columnExists(table: string, column: string): Promise<boolean> {
  if (getDatabaseType() === "sqlite") {
    // PRAGMA cannot be parameterized; table names here come from our own code.
    const rows = await rawAll(sql.raw(`PRAGMA table_info(${table})`));
    return rows.some((r) => r.name === column);
  }
  const rows = await rawAll(sql`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} AND column_name=${column}`);
  return rows.length > 0;
}

export async function indexExists(name: string): Promise<boolean> {
  if (getDatabaseType() === "sqlite") {
    const rows = await rawAll(sql`SELECT 1 FROM sqlite_master WHERE type='index' AND name=${name}`);
    return rows.length > 0;
  }
  const rows = await rawAll(sql`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=${name}`);
  return rows.length > 0;
}

export async function permissionExists(name: string): Promise<boolean> {
  const rows = await rawAll(sql`SELECT 1 FROM rbac_permissions WHERE name=${name}`);
  return rows.length > 0;
}

export async function roleHasPermission(roleName: string, permissionName: string): Promise<boolean> {
  const rows = await rawAll(sql`
    SELECT 1 FROM rbac_role_permissions rp
    JOIN rbac_roles r ON r.id = rp.role_id
    JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE r.name = ${roleName} AND p.name = ${permissionName}
    LIMIT 1
  `);
  return rows.length > 0;
}

export async function roleExists(name: string): Promise<boolean> {
  const rows = await rawAll(sql`SELECT 1 FROM rbac_roles WHERE name=${name}`);
  return rows.length > 0;
}

export async function rowCount(table: string): Promise<number> {
  const rows = await rawAll(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`));
  return Number((rows[0]?.c as number | string) ?? 0);
}

export async function migrationRecorded(version: string): Promise<boolean> {
  const rows = await rawAll(sql`SELECT 1 FROM _rbac_migrations WHERE version=${version}`);
  return rows.length > 0;
}

// ============================================
// Postgres Docker lifecycle (Docker REQUIRED)
// ============================================

export interface PostgresContainer {
  containerId: string;
  /** Build a connection URL for a given database name in the container. */
  url: (database: string) => string;
  stop: () => void;
}

function runDocker(args: string[], opts: { allowFail?: boolean } = {}): string {
  const proc = Bun.spawnSync(["docker", ...args]);
  const stdout = proc.stdout ? new TextDecoder().decode(proc.stdout).trim() : "";
  const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr).trim() : "";
  if (proc.exitCode !== 0 && !opts.allowFail) {
    throw new Error(`docker ${args.join(" ")} failed (exit ${proc.exitCode}): ${stderr || stdout}`);
  }
  return stdout;
}

export function assertDockerAvailable(): void {
  const proc = Bun.spawnSync(["docker", "info"]);
  if (proc.exitCode !== 0) {
    throw new Error(
      "Docker is required to run the PostgreSQL migration tests. " +
      "Install/start Docker, or run `scripts/test-migrations.sh`. " +
      "(This requirement is mandatory — see CLAUDE.md.)"
    );
  }
}

/**
 * Start a disposable PostgreSQL container and wait until it accepts connections.
 * Hard-fails if Docker is unavailable.
 */
export async function startPostgresContainer(): Promise<PostgresContainer> {
  assertDockerAvailable();

  const port = 20000 + Math.floor(Math.random() * 20000);
  const password = "testpass";
  const user = "testuser";

  const containerId = runDocker([
    "run", "-d", "--rm",
    "-e", `POSTGRES_PASSWORD=${password}`,
    "-e", `POSTGRES_USER=${user}`,
    "-e", "POSTGRES_DB=postgres",
    "-p", `${port}:5432`,
    "postgres:16-alpine",
  ]);

  const stop = () => {
    runDocker(["rm", "-f", containerId], { allowFail: true });
  };

  // Wait for readiness via pg_isready inside the container.
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    const check = Bun.spawnSync(["docker", "exec", containerId, "pg_isready", "-U", user]);
    const out = check.stdout ? new TextDecoder().decode(check.stdout) : "";
    if (check.exitCode === 0 && out.includes("accepting connections")) {
      ready = true;
      break;
    }
    Bun.sleepSync(500);
  }
  if (!ready) {
    stop();
    throw new Error("PostgreSQL container did not become ready within 60s");
  }

  return {
    containerId,
    url: (database: string) => `postgres://${user}:${password}@127.0.0.1:${port}/${database}`,
    stop,
  };
}

// ============================================
// Fresh database per test
// ============================================

let pgDbCounter = 0;

/**
 * (Re)initialize a FRESH, empty database for the given dialect. For Postgres a
 * brand-new database is created inside the container per call; for SQLite a new
 * in-memory database is opened. Sets the env the migration code reads for dialect
 * detection.
 */
export async function freshDatabase(dialect: Dialect, pg?: PostgresContainer): Promise<void> {
  await closeDatabase();

  if (dialect === "sqlite") {
    process.env.RBAC_DB_TYPE = "sqlite";
    process.env.RBAC_SQLITE_PATH = ":memory:";
    delete process.env.RBAC_POSTGRES_URL;
    await initializeDatabase();
    return;
  }

  if (!pg) throw new Error("Postgres dialect requires a running container");
  pgDbCounter += 1;
  const dbName = `mig_test_${Date.now()}_${pgDbCounter}`;
  process.env.RBAC_DB_TYPE = "postgres";
  process.env.RBAC_POSTGRES_URL = pg.url(dbName);
  delete process.env.RBAC_SQLITE_PATH;
  // initializeDatabase() creates the database if it does not exist.
  await initializeDatabase();
}
