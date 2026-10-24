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

/**
 * 1.67.0 — memory. A user memory belongs to `owner_id` and goes with the
 * user; a connection (team) memory goes with its connection, and outlives the
 * person who proposed it (`proposed_by` is not a foreign key).
 */
const MEMORY_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_memories (
    id              TEXT PRIMARY KEY NOT NULL,
    scope           TEXT NOT NULL,
    owner_id        TEXT REFERENCES rbac_users(id) ON DELETE CASCADE,
    connection_id   TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    status          TEXT NOT NULL,
    source          TEXT NOT NULL,
    agent_slug      TEXT,
    thread_id       TEXT,
    flag            TEXT,
    proposed_by     TEXT,
    decided_by      TEXT,
    decided_at      {BIGINT},
    created_at      {BIGINT} NOT NULL,
    updated_at      {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ai_memories_owner_idx ON ai_memories (owner_id, status)`,
  `CREATE INDEX IF NOT EXISTS ai_memories_connection_idx ON ai_memories (connection_id, status)`,
  `CREATE TABLE IF NOT EXISTS ai_memory_settings (
    user_id         TEXT PRIMARY KEY NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    enabled         INTEGER NOT NULL DEFAULT 1,
    updated_at      {BIGINT} NOT NULL
  )`,
];

/**
 * 1.68.0 — auto-triage. One rule per trigger (off until someone turns it on);
 * one run per (trigger, subject), so a subject is never investigated twice.
 * `watermark` is the newest subject time a rule has looked at.
 */
const TRIAGE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_triage_rules (
    trigger             TEXT PRIMARY KEY NOT NULL,
    enabled             INTEGER NOT NULL DEFAULT 0,
    agent_id            TEXT,
    cooldown_minutes    INTEGER NOT NULL DEFAULT 60,
    daily_token_budget  {BIGINT} NOT NULL DEFAULT 200000,
    channel_ids         TEXT NOT NULL DEFAULT '[]',
    propose_as          TEXT,
    watermark           {BIGINT} NOT NULL DEFAULT 0,
    updated_by          TEXT,
    updated_at          {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS ai_triage_runs (
    id              TEXT PRIMARY KEY NOT NULL,
    trigger         TEXT NOT NULL,
    subject_id      TEXT NOT NULL,
    subject_title   TEXT NOT NULL DEFAULT '',
    connection_id   TEXT,
    status          TEXT NOT NULL,
    reason          TEXT,
    summary         TEXT,
    result          TEXT,
    notebook_id     TEXT,
    action_ids      TEXT NOT NULL DEFAULT '[]',
    tokens          {BIGINT} NOT NULL DEFAULT 0,
    cost_usd        {REAL},
    error           TEXT,
    started_at      {BIGINT} NOT NULL,
    finished_at     {BIGINT}
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_triage_runs_subject_idx ON ai_triage_runs (trigger, subject_id)`,
  `CREATE INDEX IF NOT EXISTS ai_triage_runs_started_idx ON ai_triage_runs (started_at)`,
  `CREATE INDEX IF NOT EXISTS ai_triage_runs_cooldown_idx ON ai_triage_runs (trigger, connection_id, started_at)`,
];

/**
 * 1.70.0 — agent evals. Cases belong to an agent and go with it; a run records
 * which draft it scored (`draft_hash`), so saving that exact draft can be
 * gated on it.
 */
const EVAL_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_eval_cases (
    id                TEXT PRIMARY KEY NOT NULL,
    agent_id          TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    kind              TEXT NOT NULL,
    feature_id        TEXT,
    input             TEXT NOT NULL DEFAULT '{}',
    expected_tools    TEXT NOT NULL DEFAULT '[]',
    rubric            TEXT,
    source            TEXT NOT NULL DEFAULT 'manual',
    created_by        TEXT,
    created_at        {BIGINT} NOT NULL,
    updated_at        {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ai_eval_cases_agent_idx ON ai_eval_cases (agent_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ai_eval_runs (
    id              TEXT PRIMARY KEY NOT NULL,
    agent_id        TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    draft_hash      TEXT NOT NULL,
    status          TEXT NOT NULL,
    score           {REAL},
    passed          INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    results         TEXT NOT NULL DEFAULT '[]',
    regressions     TEXT NOT NULL DEFAULT '[]',
    tokens          {BIGINT} NOT NULL DEFAULT 0,
    cost_usd        {REAL},
    error           TEXT,
    created_by      TEXT,
    started_at      {BIGINT} NOT NULL,
    finished_at     {BIGINT}
  )`,
  `CREATE INDEX IF NOT EXISTS ai_eval_runs_agent_idx ON ai_eval_runs (agent_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS ai_eval_runs_hash_idx ON ai_eval_runs (agent_id, draft_hash, status)`,
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

export function aiMemorySchemaStatements(dialect: Dialect): string[] {
  return render(MEMORY_TABLES, dialect);
}

export const AI_MEMORY_TABLE_NAMES: string[] = tableNames(MEMORY_TABLES);
export const AI_MEMORY_INDEX_NAMES: string[] = indexNames(MEMORY_TABLES);

export function aiTriageSchemaStatements(dialect: Dialect): string[] {
  return render(TRIAGE_TABLES, dialect);
}

export const AI_TRIAGE_TABLE_NAMES: string[] = tableNames(TRIAGE_TABLES);
export const AI_TRIAGE_INDEX_NAMES: string[] = indexNames(TRIAGE_TABLES);

export function aiEvalSchemaStatements(dialect: Dialect): string[] {
  return render(EVAL_TABLES, dialect);
}

export const AI_EVAL_TABLE_NAMES: string[] = tableNames(EVAL_TABLES);
export const AI_EVAL_INDEX_NAMES: string[] = indexNames(EVAL_TABLES);
