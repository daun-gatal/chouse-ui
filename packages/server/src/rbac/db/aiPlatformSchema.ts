/**
 * ADR 0024 — DDL for AI platform v2, one group per migration.
 *
 * `{BIGINT}` and `{REAL}` placeholders are rendered per dialect, as in
 * observeSchema.ts. Every statement is `IF NOT EXISTS`, so each migration stays
 * idempotent on stepwise and skip-version upgrades. Timestamps are unix
 * milliseconds. JSON lives in TEXT columns, as elsewhere in the RBAC database.
 */

import type { Dialect } from "./observeSchema";

/** 1.65.0 — chat runs, LangGraph checkpoints and budgets. */
const RUNTIME_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_chat_runs (
    id                TEXT PRIMARY KEY NOT NULL,
    thread_id         TEXT NOT NULL,
    user_id           TEXT NOT NULL,
    agent_id          TEXT,
    connection_id     TEXT,
    status            TEXT NOT NULL,
    steps             TEXT NOT NULL DEFAULT '[]',
    pending           TEXT,
    result            TEXT,
    error             TEXT,
    cancel_requested  INTEGER NOT NULL DEFAULT 0,
    holder            TEXT,
    heartbeat_at      {BIGINT} NOT NULL DEFAULT 0,
    created_at        {BIGINT} NOT NULL,
    updated_at        {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ai_chat_runs_thread_idx ON ai_chat_runs (thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ai_chat_runs_status_idx ON ai_chat_runs (status, heartbeat_at)`,
  `CREATE TABLE IF NOT EXISTS ai_checkpoints (
    thread_id             TEXT NOT NULL,
    checkpoint_ns         TEXT NOT NULL DEFAULT '',
    checkpoint_id         TEXT NOT NULL,
    parent_checkpoint_id  TEXT,
    type                  TEXT,
    checkpoint            TEXT NOT NULL,
    metadata              TEXT NOT NULL,
    created_at            {BIGINT} NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_checkpoint_writes (
    thread_id      TEXT NOT NULL,
    checkpoint_ns  TEXT NOT NULL DEFAULT '',
    checkpoint_id  TEXT NOT NULL,
    task_id        TEXT NOT NULL,
    idx            {BIGINT} NOT NULL,
    channel        TEXT NOT NULL,
    type           TEXT,
    value          TEXT,
    task_path      TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_budgets (
    id                        TEXT PRIMARY KEY NOT NULL,
    name                      TEXT NOT NULL,
    feature_id                TEXT,
    applies_to                TEXT NOT NULL DEFAULT 'all',
    user_id                   TEXT,
    period                    TEXT NOT NULL DEFAULT 'day',
    limit_tokens              {BIGINT},
    limit_cost_usd            {REAL},
    on_exhaust                TEXT NOT NULL DEFAULT 'stop',
    fallback_model_config_id  TEXT,
    enabled                   INTEGER NOT NULL DEFAULT 1,
    created_by                TEXT,
    created_at                {BIGINT} NOT NULL,
    updated_at                {BIGINT} NOT NULL
  )`,
];

/** 1.66.0 — approved actions: every write an agent proposed, and what became of it. */
const ACTION_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_actions (
    id              TEXT PRIMARY KEY NOT NULL,
    source          TEXT NOT NULL,
    run_id          TEXT,
    interrupt_id    TEXT,
    thread_id       TEXT,
    user_id         TEXT NOT NULL,
    connection_id   TEXT,
    agent_path      TEXT,
    tool            TEXT NOT NULL,
    args            TEXT NOT NULL DEFAULT '{}',
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL,
    result          TEXT,
    error           TEXT,
    decided_by      TEXT,
    decided_at      {BIGINT},
    expires_at      {BIGINT} NOT NULL,
    created_at      {BIGINT} NOT NULL,
    updated_at      {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ai_actions_status_idx ON ai_actions (status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS ai_actions_user_idx ON ai_actions (user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ai_actions_run_idx ON ai_actions (run_id)`,
];

function render(statements: string[], dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  const real = dialect === "sqlite" ? "REAL" : "DOUBLE PRECISION";
  return statements.map((stmt) => stmt.replaceAll("{BIGINT}", bigint).replaceAll("{REAL}", real));
}

function tableNames(statements: string[]): string[] {
  return statements
    .map((stmt) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
    .filter((name): name is string => typeof name === "string");
}

function indexNames(statements: string[]): string[] {
  return statements
    .map((stmt) => /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
    .filter((name): name is string => typeof name === "string");
}

export function aiRuntimeSchemaStatements(dialect: Dialect): string[] {
  return render(RUNTIME_TABLES, dialect);
}

export const AI_RUNTIME_TABLE_NAMES: string[] = tableNames(RUNTIME_TABLES);
export const AI_RUNTIME_INDEX_NAMES: string[] = indexNames(RUNTIME_TABLES);

export function aiActionsSchemaStatements(dialect: Dialect): string[] {
  return render(ACTION_TABLES, dialect);
}

export const AI_ACTION_TABLE_NAMES: string[] = tableNames(ACTION_TABLES);
export const AI_ACTION_INDEX_NAMES: string[] = indexNames(ACTION_TABLES);
