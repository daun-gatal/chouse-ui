/**
 * ADR 0026 — DDL for the shared notify layer: the message log, linked chat
 * accounts, linking codes, and the columns that make alert history filterable.
 *
 * `{BIGINT}` placeholders are rendered per dialect, as in observeSchema.ts.
 * Tables are `IF NOT EXISTS`; added columns are guarded by the migration, so
 * stepwise and skip-version upgrades land in the same state. Timestamps are
 * unix milliseconds; JSON lives in TEXT columns.
 */

import type { Dialect } from "./observeSchema";

function render(statements: string[], dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  return statements.map((s) => s.replaceAll("{BIGINT}", bigint));
}

const NOTIFY_TABLES: string[] = [
  // One row per message sent to one channel. The unique key is the claim that
  // keeps two replicas from sending the same message.
  `CREATE TABLE IF NOT EXISTS channel_messages (
    id            TEXT PRIMARY KEY NOT NULL,
    channel_id    TEXT NOT NULL,
    feature       TEXT NOT NULL,
    subject_id    TEXT NOT NULL,
    kind          TEXT NOT NULL,
    state         TEXT NOT NULL,
    platform_ref  TEXT,
    buttons       TEXT,
    message       TEXT,
    error         TEXT,
    created_at    {BIGINT} NOT NULL,
    updated_at    {BIGINT} NOT NULL,
    closed_at     {BIGINT}
  )`,
  `CREATE TABLE IF NOT EXISTS chat_identities (
    id            TEXT PRIMARY KEY NOT NULL,
    user_id       TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    platform      TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    display_name  TEXT,
    created_at    {BIGINT} NOT NULL
  )`,
  // Only the hash of a code is kept: the code itself travels once, in the link.
  `CREATE TABLE IF NOT EXISTS chat_link_codes (
    code_hash     TEXT PRIMARY KEY NOT NULL,
    user_id       TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    platform      TEXT NOT NULL,
    expires_at    {BIGINT} NOT NULL,
    used_at       {BIGINT},
    created_at    {BIGINT} NOT NULL
  )`,
];

const NOTIFY_INDEXES: string[] = [
  "CREATE UNIQUE INDEX IF NOT EXISTS channel_messages_claim_idx ON channel_messages (channel_id, feature, subject_id, kind)",
  "CREATE INDEX IF NOT EXISTS channel_messages_subject_idx ON channel_messages (feature, subject_id)",
  "CREATE INDEX IF NOT EXISTS channel_messages_channel_idx ON channel_messages (channel_id, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS chat_identities_external_idx ON chat_identities (platform, external_id)",
  "CREATE INDEX IF NOT EXISTS chat_identities_user_idx ON chat_identities (user_id)",
  "CREATE INDEX IF NOT EXISTS chat_link_codes_user_idx ON chat_link_codes (user_id)",
  "CREATE INDEX IF NOT EXISTS alert_events_source_idx ON alert_events (source, fired_at)",
];

export const NOTIFY_TABLE_NAMES = ["channel_messages", "chat_identities", "chat_link_codes"];
export const NOTIFY_INDEX_NAMES = NOTIFY_INDEXES.map((s) => /INDEX IF NOT EXISTS (\S+)/.exec(s)?.[1] ?? "");

/** 1.74.0 — columns added to alert_events so history can be filtered by source, channel and outcome. */
export const ALERT_EVENT_COLUMNS: Array<{ name: string; type: string }> = [
  { name: "source", type: "TEXT" },
  { name: "channel_ids", type: "TEXT" },
  { name: "delivery_failed", type: "INTEGER NOT NULL DEFAULT 0" },
];

export function notifyTableStatements(dialect: Dialect): string[] {
  return render(NOTIFY_TABLES, dialect);
}

export function notifyIndexStatements(dialect: Dialect): string[] {
  return render(NOTIFY_INDEXES, dialect);
}
