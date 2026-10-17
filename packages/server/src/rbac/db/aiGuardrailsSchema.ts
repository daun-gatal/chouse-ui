/**
 * ADR 0022 — DDL for AI guardrails and their trigger events.
 *
 * `{BIGINT}` placeholders are rendered per dialect, as in observeSchema.ts.
 * Every statement is `IF NOT EXISTS`, so migration 1.62.0 stays idempotent on
 * stepwise and skip-version upgrades. Timestamps are unix milliseconds. A
 * guardrail's config, stages and scope are JSON columns on its own row, so a
 * save is one atomic row write. Events never hold the matched values.
 */

import type { Dialect } from "./observeSchema";

const AI_GUARDRAIL_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_guardrails (
    id          TEXT PRIMARY KEY NOT NULL,
    slug        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind        TEXT NOT NULL,
    config      TEXT NOT NULL DEFAULT '{}',
    stages      TEXT NOT NULL DEFAULT '[]',
    action      TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'enforce',
    scope       TEXT NOT NULL DEFAULT '{"agents":"all","features":"all","mcp":false}',
    position    {BIGINT} NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1,
    is_system   INTEGER NOT NULL DEFAULT 0,
    seed_hash   TEXT,
    customized  INTEGER NOT NULL DEFAULT 0,
    version     {BIGINT} NOT NULL DEFAULT 1,
    created_by  TEXT,
    created_at  {BIGINT} NOT NULL DEFAULT 0,
    updated_at  {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_guardrails_slug_idx ON ai_guardrails (slug)`,
  `CREATE TABLE IF NOT EXISTS ai_guardrail_events (
    id             TEXT PRIMARY KEY NOT NULL,
    created_at     {BIGINT} NOT NULL,
    guardrail_id   TEXT NOT NULL,
    guardrail_name TEXT NOT NULL,
    kind           TEXT NOT NULL,
    stage          TEXT NOT NULL,
    action         TEXT NOT NULL,
    mode           TEXT NOT NULL,
    match_count    {BIGINT} NOT NULL DEFAULT 0,
    source         TEXT NOT NULL,
    user_id        TEXT,
    request_id     TEXT,
    step_id        TEXT,
    agent_path     TEXT,
    tool           TEXT,
    reason         TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS ai_guardrail_events_created_idx ON ai_guardrail_events (created_at)`,
  `CREATE INDEX IF NOT EXISTS ai_guardrail_events_guardrail_idx ON ai_guardrail_events (guardrail_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ai_guardrail_events_request_idx ON ai_guardrail_events (request_id)`,
];

/** Render the statements for one dialect. */
export function aiGuardrailsSchemaStatements(dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  return AI_GUARDRAIL_TABLES.map((stmt) => stmt.replaceAll("{BIGINT}", bigint));
}

/** Table names created by 1.62.0, for migration checks. */
export const AI_GUARDRAIL_TABLE_NAMES: string[] = AI_GUARDRAIL_TABLES
  .map((stmt) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");
