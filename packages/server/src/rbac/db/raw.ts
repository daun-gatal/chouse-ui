/**
 * Dialect-agnostic raw statement helpers.
 *
 * Drizzle's SQLite and PostgreSQL drivers disagree on both the call shape
 * (sync `.all()`/`.run()` vs async `.execute()`) and the result shape (array vs
 * `{ rows }`). Several subsystems that keep shared state in the RBAC database
 * — the fleet poller lease, the DB rate-limit store — each grew a private copy
 * of that normalisation. These are the shared versions, used by the ADR 0010
 * stores so the branching lives in one place.
 */
import type { SQL } from "drizzle-orm";
import { getDatabase, getDatabaseType, type SqliteDb, type PostgresDb } from "./index";

/** Run a statement and return its rows. */
export async function rawAll(query: SQL): Promise<Array<Record<string, unknown>>> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(query) as Array<Record<string, unknown>>;
  }
  const result = await (db as PostgresDb).execute(query);
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return ((result as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
}

/** Run a statement that returns nothing. */
export async function rawRun(query: SQL): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(query);
    return;
  }
  await (db as PostgresDb).execute(query);
}

/** Coerce a driver-returned numeric (Postgres BIGINT arrives as a string) to a number. */
export function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
