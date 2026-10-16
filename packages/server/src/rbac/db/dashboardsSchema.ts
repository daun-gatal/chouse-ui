/**
 * ADR 0021 — DDL for custom dashboards.
 *
 * Statements use the `{BIGINT}` / `{REAL}` placeholders of observeSchema.ts,
 * rendered per dialect. Every statement is `IF NOT EXISTS`, so migration 1.61.0
 * stays idempotent on stepwise and skip-version upgrades. Timestamps are unix
 * milliseconds; JSON columns (`variables`, `viz`) are TEXT holding validated
 * JSON, read back through the dashboards store's schemas.
 */

import type { Dialect } from "./observeSchema";

const DASHBOARD_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS dashboards (
    id               TEXT PRIMARY KEY NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    owner_id         TEXT NOT NULL,
    connection_id    TEXT,
    time_range       TEXT NOT NULL,
    refresh_seconds  {BIGINT} NOT NULL DEFAULT 0,
    variables        TEXT NOT NULL DEFAULT '[]',
    version          {BIGINT} NOT NULL DEFAULT 1,
    created_at       {BIGINT} NOT NULL,
    updated_at       {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dashboards_owner_idx ON dashboards (owner_id)`,
  `CREATE TABLE IF NOT EXISTS dashboard_panels (
    id            TEXT PRIMARY KEY NOT NULL,
    dashboard_id  TEXT NOT NULL,
    position      {BIGINT} NOT NULL,
    title         TEXT NOT NULL,
    sql           TEXT NOT NULL,
    viz           TEXT NOT NULL,
    width         {BIGINT} NOT NULL,
    height        TEXT NOT NULL,
    fleet         INTEGER NOT NULL DEFAULT 0,
    created_at    {BIGINT} NOT NULL,
    updated_at    {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_panels_dashboard_idx ON dashboard_panels (dashboard_id, position)`,
  `CREATE TABLE IF NOT EXISTS dashboard_shares (
    dashboard_id  TEXT NOT NULL,
    role_id       TEXT NOT NULL,
    can_edit      INTEGER NOT NULL DEFAULT 0,
    created_at    {BIGINT} NOT NULL,
    PRIMARY KEY (dashboard_id, role_id)
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_shares_role_idx ON dashboard_shares (role_id)`,
  `CREATE TABLE IF NOT EXISTS dashboard_pins (
    user_id       TEXT NOT NULL,
    dashboard_id  TEXT NOT NULL,
    created_at    {BIGINT} NOT NULL,
    PRIMARY KEY (user_id, dashboard_id)
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_pins_dashboard_idx ON dashboard_pins (dashboard_id)`,
  `CREATE TABLE IF NOT EXISTS dashboard_alert_state (
    rule_id       TEXT PRIMARY KEY NOT NULL,
    state         TEXT NOT NULL,
    breaches      {BIGINT} NOT NULL DEFAULT 0,
    since         {BIGINT} NOT NULL,
    last_eval_at  {BIGINT},
    last_value    {REAL},
    last_error    TEXT
  )`,
];

export function dashboardsSchemaStatements(dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  const real = dialect === "sqlite" ? "REAL" : "DOUBLE PRECISION";
  return DASHBOARD_TABLES.map((stmt) => stmt.replaceAll("{BIGINT}", bigint).replaceAll("{REAL}", real));
}

/** Table names created by 1.61.0, for migration checks. */
export const DASHBOARD_TABLE_NAMES: string[] = DASHBOARD_TABLES
  .map((stmt) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");

/** Index names created by 1.61.0, for migration checks. */
export const DASHBOARD_INDEX_NAMES: string[] = DASHBOARD_TABLES
  .map((stmt) => /^CREATE INDEX IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");
