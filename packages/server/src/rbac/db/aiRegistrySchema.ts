/**
 * ADR 0019 — DDL for the AI agent registry (agents, harnesses, skills, feature
 * bindings, revisions).
 *
 * Statements use `{BIGINT}` placeholders rendered per dialect, the same way as
 * observeSchema.ts. Every statement is `IF NOT EXISTS`, so migration 1.56.0
 * stays idempotent on stepwise and skip-version upgrades. Timestamps are unix
 * milliseconds. An agent's tools, skills and subagents are JSON columns on its
 * own row: a save is one atomic row write, which matters because migrations
 * and store writes are not transaction-wrapped across tables.
 */

import type { Dialect } from "./observeSchema";

const AI_REGISTRY_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_harnesses (
    id                         TEXT PRIMARY KEY NOT NULL,
    slug                       TEXT NOT NULL,
    name                       TEXT NOT NULL,
    description                TEXT NOT NULL DEFAULT '',
    excluded_tools             TEXT NOT NULL DEFAULT '[]',
    general_purpose            TEXT NOT NULL DEFAULT '{"enabled":false}',
    prompt_suffix              TEXT,
    tool_description_overrides TEXT NOT NULL DEFAULT '{}',
    is_system                  INTEGER NOT NULL DEFAULT 0,
    seed_hash                  TEXT,
    customized                 INTEGER NOT NULL DEFAULT 0,
    version                    {BIGINT} NOT NULL DEFAULT 1,
    created_by                 TEXT,
    created_at                 {BIGINT} NOT NULL DEFAULT 0,
    updated_at                 {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_harnesses_slug_idx ON ai_harnesses (slug)`,
  `CREATE TABLE IF NOT EXISTS ai_skills (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    dir_path    TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    skill_md    TEXT NOT NULL,
    files       TEXT NOT NULL DEFAULT '{}',
    enabled     INTEGER NOT NULL DEFAULT 1,
    is_system   INTEGER NOT NULL DEFAULT 0,
    seed_hash   TEXT,
    customized  INTEGER NOT NULL DEFAULT 0,
    version     {BIGINT} NOT NULL DEFAULT 1,
    created_by  TEXT,
    created_at  {BIGINT} NOT NULL DEFAULT 0,
    updated_at  {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_skills_name_idx ON ai_skills (name)`,
  `CREATE TABLE IF NOT EXISTS ai_agents (
    id                   TEXT PRIMARY KEY NOT NULL,
    slug                 TEXT NOT NULL,
    name                 TEXT NOT NULL,
    description          TEXT NOT NULL DEFAULT '',
    kind                 TEXT NOT NULL DEFAULT 'agent',
    system_prompt        TEXT NOT NULL DEFAULT '',
    task_template        TEXT,
    model_config_id      TEXT,
    harness_id           TEXT NOT NULL,
    tuning               TEXT NOT NULL DEFAULT '{}',
    required_permissions TEXT NOT NULL DEFAULT '[]',
    tools                TEXT NOT NULL DEFAULT '[]',
    skills               TEXT NOT NULL DEFAULT '[]',
    subagents            TEXT NOT NULL DEFAULT '[]',
    enabled              INTEGER NOT NULL DEFAULT 1,
    is_system            INTEGER NOT NULL DEFAULT 0,
    seed_hash            TEXT,
    customized           INTEGER NOT NULL DEFAULT 0,
    version              {BIGINT} NOT NULL DEFAULT 1,
    created_by           TEXT,
    created_at           {BIGINT} NOT NULL DEFAULT 0,
    updated_at           {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_slug_idx ON ai_agents (slug)`,
  `CREATE TABLE IF NOT EXISTS ai_feature_bindings (
    feature_id TEXT PRIMARY KEY NOT NULL,
    agent_id   TEXT NOT NULL,
    updated_by TEXT,
    updated_at {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS ai_registry_revisions (
    id         TEXT PRIMARY KEY NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    version    {BIGINT} NOT NULL,
    action     TEXT NOT NULL,
    snapshot   TEXT NOT NULL,
    actor      TEXT,
    created_at {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS ai_registry_revisions_entity_idx ON ai_registry_revisions (entity, entity_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ai_registry_state (
    id      INTEGER PRIMARY KEY NOT NULL,
    version {BIGINT} NOT NULL DEFAULT 0
  )`,
];

/** Render the statements for one dialect. */
export function aiRegistrySchemaStatements(dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  return AI_REGISTRY_TABLES.map((stmt) => stmt.replaceAll("{BIGINT}", bigint));
}

/** Table names created by 1.56.0, for migration checks. */
export const AI_REGISTRY_TABLE_NAMES: string[] = AI_REGISTRY_TABLES
  .map((stmt) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");
