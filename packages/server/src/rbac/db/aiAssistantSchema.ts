/**
 * ADR 0025 — DDL for AI write tiers, MCP token policies and watches, one group
 * per migration.
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

/** 1.71.0 — columns added to ai_actions: how each write was checked, where it came from, and how to undo it. */
export const AI_ACTION_TIER_COLUMNS: Array<{ name: string; type: string }> = [
  { name: "tier", type: "TEXT" },
  { name: "origin", type: "TEXT" },
  { name: "token_id", type: "TEXT" },
  { name: "undo", type: "TEXT" },
  { name: "undo_expires_at", type: "{BIGINT}" },
  { name: "undone_at", type: "{BIGINT}" },
  { name: "undone_by", type: "TEXT" },
  // The paused tool call a chat approval answers, so a resumed run matches each decision to its call.
  { name: "tool_call_id", type: "TEXT" },
];

/** 1.71.0 — "allow for this thread / for an hour" on T2 tools (chat only). */
const GRANT_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_action_grants (
    id          TEXT PRIMARY KEY NOT NULL,
    user_id     TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    tool        TEXT NOT NULL,
    scope       TEXT NOT NULL,
    thread_id   TEXT,
    expires_at  {BIGINT} NOT NULL,
    created_at  {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ai_action_grants_user_idx ON ai_action_grants (user_id, tool, expires_at)`,
  `CREATE INDEX IF NOT EXISTS ai_actions_status_user_idx ON ai_actions (status, user_id)`,
];

export const AI_ACTION_GRANT_TABLE_NAMES = ["ai_action_grants"];
export const AI_ACTION_GRANT_INDEX_NAMES = ["ai_action_grants_user_idx", "ai_actions_status_user_idx"];

export function aiActionTierColumnType(type: string, dialect: Dialect): string {
  return render([type], dialect)[0];
}

export function aiActionGrantSchemaStatements(dialect: Dialect): string[] {
  return render(GRANT_TABLES, dialect);
}
