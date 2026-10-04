/**
 * Dialect-agnostic helpers for the ADR 0016 evidence store.
 *
 * Every observe module reads and writes through these so SQLite and PostgreSQL
 * stay interchangeable; statements are built with drizzle's `sql` template so
 * values are always bound parameters.
 */

import { sql, type SQL } from "drizzle-orm";

import { getDatabase, getDatabaseType, type PostgresDb, type SqliteDb } from "../../rbac/db";

export type Row = Record<string, unknown>;

export async function all(statement: SQL): Promise<Row[]> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(statement) as Row[];
  }
  const result = (await (db as PostgresDb).execute(statement)) as unknown;
  if (Array.isArray(result)) return result as Row[];
  const rows = (result as { rows?: Row[] }).rows;
  return rows ?? [];
}

export async function one(statement: SQL): Promise<Row | null> {
  const rows = await all(statement);
  return rows[0] ?? null;
}

export async function run(statement: SQL): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(statement);
    return;
  }
  await (db as PostgresDb).execute(statement);
}

/** Run a batch of statements; SQLite wraps them in one transaction for speed. */
export async function runBatch(statements: SQL[]): Promise<void> {
  if (statements.length === 0) return;
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    const sqlite = db as SqliteDb;
    sqlite.run(sql`BEGIN`);
    try {
      for (const statement of statements) sqlite.run(statement);
      sqlite.run(sql`COMMIT`);
    } catch (error) {
      sqlite.run(sql`ROLLBACK`);
      throw error;
    }
    return;
  }
  for (const statement of statements) await (db as PostgresDb).execute(statement);
}

export function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Upsert keyword differs per dialect only in the conflict clause syntax we need. */
export function isSqlite(): boolean {
  return getDatabaseType() === "sqlite";
}

export { sql };
