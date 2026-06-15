/**
 * fleetAlertConfig — persistence for the fleet alert delivery config.
 *
 * Previously this config (rules/thresholds + Slack/email/Google Chat webhooks)
 * lived in a JSON file on local pod disk (alert-config.json). That broke under
 * multiple replicas: a UI update only changed one pod's file, the poller pod
 * read its own stale copy, settings were lost on restart, and concurrent writes
 * raced. It now lives in a single-row table (fleet_alert_config, id=1) in the
 * shared RBAC DB so every replica reads/writes one source of truth.
 *
 * Backward compat: migration 1.36.0 imports an existing alert-config.json into
 * the seed row on first run, so upgrades keep their settings.
 *
 * The blob keeps the original file's shape (RawAlertConfig) verbatim, so the
 * route + alerter parsing code is unchanged apart from awaiting the load.
 */

import { sql } from "drizzle-orm";
import {
  getDatabase,
  getDatabaseType,
  type SqliteDb,
  type PostgresDb,
} from "../rbac/db";
import { logger } from "../utils/logger";

/** On-disk/in-DB shape — mirrors the legacy alert-config.json verbatim. */
export interface RawAlertConfig {
  enabled?: boolean;
  rules?: {
    memoryPercent?: number;
    queryMemoryGb?: number;
    longQueryMin?: number;
    partsEtaMin?: number;
  };
  slack?: { webhookUrl?: string; enabled?: boolean };
  googleChat?: { webhookUrl?: string; enabled?: boolean };
  email?: {
    user?: string;
    password?: string;
    to?: string;
    enabled?: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    from?: string;
  };
  /** When true, a new breach also fires a Chouse AI RCA to the channels. */
  aiRcaOnBreach?: boolean;
  /** AI config id for the auto-RCA scan (blank = default model). */
  aiRcaModelId?: string;
}

async function selectConfigRow(): Promise<Record<string, unknown> | undefined> {
  const db = getDatabase();
  const stmt = sql`SELECT config FROM fleet_alert_config WHERE id = 1 LIMIT 1`;
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(stmt)[0] as Record<string, unknown> | undefined;
  }
  const res = await (db as PostgresDb).execute(stmt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  const rows = (Array.isArray(anyRes) ? anyRes : anyRes.rows ?? []) as Record<string, unknown>[];
  return rows[0];
}

/**
 * Load the raw alert config from the DB. Returns {} when no row exists yet
 * (pre-migration) or the stored blob is unparseable — callers already treat an
 * empty config as "delivery off / defaults", matching the old missing-file path.
 */
export async function loadRawAlertConfig(): Promise<RawAlertConfig> {
  try {
    const row = await selectConfigRow();
    const raw = row?.config;
    if (typeof raw !== "string" || raw.length === 0) return {};
    return JSON.parse(raw) as RawAlertConfig;
  } catch (err) {
    logger.error(
      { module: "FleetAlertConfig", err: err instanceof Error ? err.message : String(err) },
      "Failed to load alert config",
    );
    return {};
  }
}

/**
 * Persist the raw alert config. The single row (id=1) is seeded by migration
 * 1.36.0; we UPDATE it. The INSERT fallback covers the unlikely case the row is
 * missing (e.g. manual DB surgery) so a save never silently no-ops.
 */
export async function saveRawAlertConfig(cfg: RawAlertConfig): Promise<void> {
  const db = getDatabase();
  const dbType = getDatabaseType();
  const json = JSON.stringify(cfg);
  const now = Date.now();

  if (dbType === "sqlite") {
    (db as SqliteDb).run(sql`
      INSERT INTO fleet_alert_config (id, config, updated_at)
      VALUES (1, ${json}, ${now})
      ON CONFLICT (id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at
    `);
  } else {
    await (db as PostgresDb).execute(sql`
      INSERT INTO fleet_alert_config (id, config, updated_at)
      VALUES (1, ${json}, ${now})
      ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = EXCLUDED.updated_at
    `);
  }
}
