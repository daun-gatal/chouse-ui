/**
 * ADR 0028 — DDL for signing in to MCP with OAuth: registered agents, pending
 * sign-in requests (which also hold the one-time code), and access/refresh
 * tokens. A grant is a row in rbac_api_keys with kind = 'oauth'.
 *
 * `{BIGINT}` placeholders are rendered per dialect, as in observeSchema.ts.
 * Tables are `IF NOT EXISTS`; added columns are guarded by the migration, so
 * stepwise and skip-version upgrades land in the same state. Timestamps are
 * unix milliseconds; JSON lives in TEXT columns. Codes and tokens are stored
 * only as SHA-256 hashes.
 */

import type { Dialect } from "./observeSchema";

function render(statements: string[], dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  return statements.map((s) => s.replaceAll("{BIGINT}", bigint));
}

const MCP_OAUTH_TABLES: string[] = [
  // One row per agent that registered itself (RFC 7591). Public clients only.
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    id             TEXT PRIMARY KEY NOT NULL,
    name           TEXT NOT NULL,
    redirect_uris  TEXT NOT NULL,
    status         TEXT NOT NULL,
    client_uri     TEXT,
    software_id    TEXT,
    created_at     {BIGINT} NOT NULL,
    last_used_at   {BIGINT},
    decided_by     TEXT,
    decided_at     {BIGINT}
  )`,
  // A sign-in in progress: what the agent asked for, then the person's decision
  // and the one-time code it was given.
  `CREATE TABLE IF NOT EXISTS oauth_requests (
    id               TEXT PRIMARY KEY NOT NULL,
    client_id        TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    redirect_uri     TEXT NOT NULL,
    state            TEXT,
    code_challenge   TEXT NOT NULL,
    resource         TEXT NOT NULL,
    user_id          TEXT REFERENCES rbac_users(id) ON DELETE CASCADE,
    grant_id         TEXT,
    code_hash        TEXT,
    code_expires_at  {BIGINT},
    code_used_at     {BIGINT},
    decision         TEXT,
    expires_at       {BIGINT} NOT NULL,
    created_at       {BIGINT} NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_tokens (
    token_hash   TEXT PRIMARY KEY NOT NULL,
    grant_id     TEXT NOT NULL REFERENCES rbac_api_keys(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    expires_at   {BIGINT} NOT NULL,
    used_at      {BIGINT},
    created_at   {BIGINT} NOT NULL
  )`,
];

const MCP_OAUTH_INDEXES: string[] = [
  "CREATE UNIQUE INDEX IF NOT EXISTS oauth_requests_code_idx ON oauth_requests (code_hash)",
  "CREATE INDEX IF NOT EXISTS oauth_requests_expires_idx ON oauth_requests (expires_at)",
  "CREATE INDEX IF NOT EXISTS oauth_tokens_grant_idx ON oauth_tokens (grant_id)",
  "CREATE INDEX IF NOT EXISTS oauth_tokens_expires_idx ON oauth_tokens (expires_at)",
  "CREATE INDEX IF NOT EXISTS api_keys_oauth_client_idx ON rbac_api_keys (oauth_client_id)",
];

export const MCP_OAUTH_TABLE_NAMES = ["oauth_clients", "oauth_requests", "oauth_tokens"];
export const MCP_OAUTH_INDEX_NAMES = MCP_OAUTH_INDEXES.map((s) => /INDEX IF NOT EXISTS (\S+)/.exec(s)?.[1] ?? "");

/** 1.75.0 — columns added to rbac_api_keys: a personal token or an OAuth grant, and which agent it was granted to. */
export const API_KEY_OAUTH_COLUMNS: Array<{ name: string; type: string }> = [
  { name: "kind", type: "TEXT NOT NULL DEFAULT 'pat'" },
  { name: "oauth_client_id", type: "TEXT" },
];

export function mcpOAuthTableStatements(dialect: Dialect): string[] {
  return render(MCP_OAUTH_TABLES, dialect);
}

export function mcpOAuthIndexStatements(dialect: Dialect): string[] {
  return render(MCP_OAUTH_INDEXES, dialect);
}
