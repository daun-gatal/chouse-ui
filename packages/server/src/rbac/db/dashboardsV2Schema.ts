/**
 * ADR 0023 — DDL for dashboards v2: the panel columns of the canvas, and the
 * tables for notes, version history, snapshots and scheduled reports.
 *
 * Statements use the `{BIGINT}` placeholder of observeSchema.ts, rendered per
 * dialect, and are `IF NOT EXISTS`, so migration 1.63.0 stays idempotent on
 * stepwise and skip-version upgrades. Timestamps are unix milliseconds unless
 * named `_s`; JSON columns are TEXT holding validated JSON.
 */

import { ANNOTATION_SOURCES } from "../../services/dashboards/spec";
import type { Dialect } from "./observeSchema";

/** Columns 1.63.0 adds to existing tables: [table, column, definition]. */
export function dashboardsV2Columns(dialect: Dialect): Array<[string, string, string]> {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  // Existing dashboards show every annotation source (ADR 0023 §3); new ones always state theirs.
  const allSources = JSON.stringify(ANNOTATION_SOURCES).replaceAll("'", "''");
  return [
    ["dashboard_panels", "kind", "TEXT NOT NULL DEFAULT 'chart'"],
    ["dashboard_panels", "x", `${bigint} NOT NULL DEFAULT 0`],
    ["dashboard_panels", "y", `${bigint} NOT NULL DEFAULT 0`],
    ["dashboard_panels", "w", `${bigint} NOT NULL DEFAULT 0`],
    ["dashboard_panels", "h", `${bigint} NOT NULL DEFAULT 0`],
    ["dashboard_panels", "markdown", "TEXT NOT NULL DEFAULT ''"],
    ["dashboard_panels", "description", "TEXT NOT NULL DEFAULT ''"],
    ["dashboards", "annotations", `TEXT NOT NULL DEFAULT '${allSources}'`],
  ];
}

const V2_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS dashboard_notes (
    id             TEXT PRIMARY KEY NOT NULL,
    dashboard_id   TEXT NOT NULL,
    connection_id  TEXT NOT NULL,
    at             {BIGINT} NOT NULL,
    text           TEXT NOT NULL,
    author_id      TEXT NOT NULL,
    created_at     {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_notes_lookup_idx ON dashboard_notes (dashboard_id, connection_id, at)`,
  `CREATE TABLE IF NOT EXISTS dashboard_versions (
    dashboard_id  TEXT NOT NULL,
    version       {BIGINT} NOT NULL,
    document      TEXT NOT NULL,
    saved_by      TEXT,
    saved_at      {BIGINT} NOT NULL,
    source        TEXT NOT NULL,
    PRIMARY KEY (dashboard_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS dashboard_snapshots (
    id             TEXT PRIMARY KEY NOT NULL,
    dashboard_id   TEXT NOT NULL,
    name           TEXT NOT NULL,
    created_by     TEXT NOT NULL,
    created_at     {BIGINT} NOT NULL,
    expires_at     {BIGINT} NOT NULL,
    connection_id  TEXT NOT NULL,
    range_from_s   {BIGINT} NOT NULL,
    range_to_s     {BIGINT} NOT NULL,
    document       TEXT NOT NULL,
    results        TEXT NOT NULL,
    size_bytes     {BIGINT} NOT NULL,
    role_ids       TEXT NOT NULL DEFAULT '[]',
    incident_id    TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_snapshots_dashboard_idx ON dashboard_snapshots (dashboard_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS dashboard_snapshots_expiry_idx ON dashboard_snapshots (expires_at)`,
  `CREATE TABLE IF NOT EXISTS dashboard_reports (
    id             TEXT PRIMARY KEY NOT NULL,
    dashboard_id   TEXT NOT NULL,
    owner_id       TEXT NOT NULL,
    name           TEXT NOT NULL,
    connection_id  TEXT NOT NULL,
    schedule       TEXT NOT NULL,
    time_range     TEXT NOT NULL,
    only_if_alert  INTEGER NOT NULL DEFAULT 0,
    enabled        INTEGER NOT NULL DEFAULT 1,
    next_run_at    {BIGINT} NOT NULL,
    last_run_at    {BIGINT},
    last_status    TEXT,
    last_error     TEXT,
    created_at     {BIGINT} NOT NULL,
    updated_at     {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_reports_dashboard_idx ON dashboard_reports (dashboard_id)`,
  `CREATE INDEX IF NOT EXISTS dashboard_reports_due_idx ON dashboard_reports (enabled, next_run_at)`,
  `CREATE TABLE IF NOT EXISTS dashboard_report_channels (
    report_id   TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    PRIMARY KEY (report_id, channel_id)
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_report_channels_channel_idx ON dashboard_report_channels (channel_id)`,
];

export function dashboardsV2SchemaStatements(dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  return V2_TABLES.map((stmt) => stmt.replaceAll("{BIGINT}", bigint));
}

/** Table names created by 1.63.0, for migration checks. */
export const DASHBOARD_V2_TABLE_NAMES: string[] = V2_TABLES
  .map((stmt) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");

/** Index names created by 1.63.0, for migration checks. */
export const DASHBOARD_V2_INDEX_NAMES: string[] = V2_TABLES
  .map((stmt) => /^CREATE INDEX IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");
