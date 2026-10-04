/**
 * Row leases in `obs_leases` (ADR 0016 §1). One holder per key at a time,
 * across every pod sharing the RBAC database; a dead holder's lease expires.
 * The claim is a single conditional UPSERT, so two racing pods cannot both win
 * (SQLite serialises writes; PostgreSQL re-checks the WHERE under a row lock).
 */

import { all, run, sql } from "./db";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function acquireLease(key: string, holder: string, ttlSeconds: number): Promise<boolean> {
  const now = nowSeconds();
  const expires = now + ttlSeconds;
  await run(sql`
    INSERT INTO obs_leases (lease_key, holder, acquired_at, expires_at)
    VALUES (${key}, ${holder}, ${now}, ${expires})
    ON CONFLICT (lease_key) DO UPDATE SET holder = ${holder}, acquired_at = ${now}, expires_at = ${expires}
    WHERE obs_leases.holder = ${holder} OR obs_leases.expires_at < ${now}
  `);
  const rows = await all(sql`SELECT holder FROM obs_leases WHERE lease_key = ${key}`);
  return rows[0]?.holder === holder;
}

export async function releaseLease(key: string, holder: string): Promise<void> {
  await run(sql`UPDATE obs_leases SET holder = '', acquired_at = 0, expires_at = 0 WHERE lease_key = ${key} AND holder = ${holder}`);
}

export async function releaseAll(holder: string): Promise<void> {
  await run(sql`UPDATE obs_leases SET holder = '', acquired_at = 0, expires_at = 0 WHERE holder = ${holder}`);
}
