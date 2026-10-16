/**
 * ADR 0020 — DDL for AI usage and data egress tracking.
 *
 * Statements use `{BIGINT}` / `{REAL}` placeholders rendered per dialect, the
 * same way as observeSchema.ts. Every statement is `IF NOT EXISTS`, so
 * migration 1.58.0 stays idempotent on stepwise and skip-version upgrades.
 * Timestamps are unix milliseconds. Cost columns are NULL when no step of the
 * request had a price, never 0, so "unpriced" and "free" stay distinguishable.
 */

import type { Dialect } from "./observeSchema";

const AI_USAGE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_usage_requests (
    id                  TEXT PRIMARY KEY NOT NULL,
    started_at          {BIGINT} NOT NULL,
    duration_ms         {BIGINT} NOT NULL DEFAULT 0,
    user_id             TEXT,
    connection_id       TEXT,
    thread_id           TEXT,
    feature_id          TEXT NOT NULL,
    agent_id            TEXT,
    agent_slug          TEXT,
    agent_name          TEXT,
    source              TEXT NOT NULL,
    status              TEXT NOT NULL,
    error               TEXT,
    llm_calls           {BIGINT} NOT NULL DEFAULT 0,
    tool_calls          {BIGINT} NOT NULL DEFAULT 0,
    input_tokens        {BIGINT} NOT NULL DEFAULT 0,
    output_tokens       {BIGINT} NOT NULL DEFAULT 0,
    cache_read_tokens   {BIGINT} NOT NULL DEFAULT 0,
    cache_write_tokens  {BIGINT} NOT NULL DEFAULT 0,
    incomplete_calls    {BIGINT} NOT NULL DEFAULT 0,
    unpriced_calls      {BIGINT} NOT NULL DEFAULT 0,
    cost_usd            {REAL},
    ch_queries          {BIGINT} NOT NULL DEFAULT 0,
    ch_read_rows        {BIGINT} NOT NULL DEFAULT 0,
    ch_read_bytes       {BIGINT} NOT NULL DEFAULT 0,
    egress_rows         {BIGINT} NOT NULL DEFAULT 0,
    egress_bytes        {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS ai_usage_requests_started_idx ON ai_usage_requests (started_at)`,
  `CREATE INDEX IF NOT EXISTS ai_usage_requests_user_idx ON ai_usage_requests (user_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS ai_usage_steps (
    id                  TEXT PRIMARY KEY NOT NULL,
    request_id          TEXT NOT NULL,
    seq                 {BIGINT} NOT NULL,
    kind                TEXT NOT NULL,
    agent_path          TEXT,
    name                TEXT NOT NULL,
    model_config_id     TEXT,
    provider_type       TEXT,
    model_id            TEXT,
    started_at          {BIGINT} NOT NULL,
    duration_ms         {BIGINT} NOT NULL DEFAULT 0,
    status              TEXT NOT NULL,
    usage_reported      INTEGER NOT NULL DEFAULT 0,
    input_tokens        {BIGINT} NOT NULL DEFAULT 0,
    output_tokens       {BIGINT} NOT NULL DEFAULT 0,
    cache_read_tokens   {BIGINT} NOT NULL DEFAULT 0,
    cache_write_tokens  {BIGINT} NOT NULL DEFAULT 0,
    cost_usd            {REAL},
    price_source        TEXT NOT NULL DEFAULT 'none',
    ch_queries          {BIGINT} NOT NULL DEFAULT 0,
    ch_read_rows        {BIGINT} NOT NULL DEFAULT 0,
    ch_read_bytes       {BIGINT} NOT NULL DEFAULT 0,
    result_bytes        {BIGINT} NOT NULL DEFAULT 0,
    detail              TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS ai_usage_steps_request_idx ON ai_usage_steps (request_id, seq)`,
  `CREATE TABLE IF NOT EXISTS ai_usage_egress (
    id             TEXT PRIMARY KEY NOT NULL,
    request_id     TEXT NOT NULL,
    step_id        TEXT NOT NULL,
    started_at     {BIGINT} NOT NULL,
    user_id        TEXT,
    connection_id  TEXT,
    provider_type  TEXT,
    model_id       TEXT,
    kind           TEXT NOT NULL,
    source         TEXT NOT NULL,
    columns        TEXT NOT NULL DEFAULT '[]',
    row_count      {BIGINT} NOT NULL DEFAULT 0,
    bytes          {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS ai_usage_egress_started_idx ON ai_usage_egress (started_at)`,
  `CREATE INDEX IF NOT EXISTS ai_usage_egress_request_idx ON ai_usage_egress (request_id)`,
  `CREATE INDEX IF NOT EXISTS ai_usage_egress_user_idx ON ai_usage_egress (user_id, started_at)`,
];

export function aiUsageSchemaStatements(dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  const real = dialect === "sqlite" ? "REAL" : "DOUBLE PRECISION";
  return AI_USAGE_TABLES.map((stmt) => stmt.replaceAll("{BIGINT}", bigint).replaceAll("{REAL}", real));
}

/** Table names created by 1.58.0, for migration checks. */
export const AI_USAGE_TABLE_NAMES: string[] = AI_USAGE_TABLES
  .map((stmt) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");

/** Index names created by 1.58.0, for migration checks. */
export const AI_USAGE_INDEX_NAMES: string[] = AI_USAGE_TABLES
  .map((stmt) => /^CREATE INDEX IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");
