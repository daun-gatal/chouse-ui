/**
 * Read-only SELECT validation + `{{…}}` window-template handling for Scheduled
 * Queries. The source is validated SELECT-only (D3) at create/edit AND re-checked
 * before every run; tokens are rewritten to NATIVE ClickHouse query parameters
 * (never string-concatenated) at execution time (D3b).
 */

import { splitSqlStatements, parseStatement } from "../../middleware/sqlParser";

/** The only recognized window placeholders; unknown tokens fail closed. */
export const KNOWN_TOKENS = ["slot_start", "slot_end", "prev_run_at"] as const;
export type KnownToken = (typeof KNOWN_TOKENS)[number];

const TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export interface ValidationResult {
  ok: boolean;
  error?: string;
  /** Tokens referenced by the query, in first-seen order. */
  tokens: KnownToken[];
}

/** Distinct `{{…}}` token names referenced by the query. */
export function extractTokenNames(query: string): string[] {
  const names = new Set<string>();
  for (const m of query.matchAll(TOKEN_RE)) names.add(m[1]);
  return [...names];
}

/**
 * Validate the source is a single read-only SELECT and only references known
 * window tokens. Tokens are replaced with a benign literal before parsing so the
 * AST parser (which cannot read `{{…}}`) sees valid SQL.
 */
export function validateReadOnlySelect(query: string): ValidationResult {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "Query is empty", tokens: [] };

  // Fail closed on any unknown token.
  const referenced = extractTokenNames(trimmed);
  const unknown = referenced.filter((t) => !(KNOWN_TOKENS as readonly string[]).includes(t));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown template token(s): ${unknown.map((t) => `{{${t}}}`).join(", ")}`, tokens: [] };
  }

  // Replace tokens with a literal so the parser accepts the structure.
  const parseable = trimmed.replace(TOKEN_RE, "0");

  const statements = splitSqlStatements(parseable).filter((s) => s.trim().length > 0);
  if (statements.length === 0) return { ok: false, error: "Query is empty", tokens: [] };
  if (statements.length > 1) {
    return { ok: false, error: "Only a single SELECT statement is allowed", tokens: [] };
  }

  const parsed = parseStatement(statements[0]);
  if (parsed.type !== "select") {
    return { ok: false, error: "Only read-only SELECT queries can be scheduled", tokens: [] };
  }

  return { ok: true, tokens: referenced as KnownToken[] };
}

/**
 * Replace `{{…}}` tokens with a benign literal so an AST/data-access validator
 * (which can't read `{{…}}`) sees parseable SQL. Table references are unaffected.
 */
export function toParseableSql(query: string): string {
  return query.replace(TOKEN_RE, "0");
}

/** Native ClickHouse param name for a token (e.g. `slot_start` → `sq_slot_start`). */
export function paramNameFor(token: string): string {
  return `sq_${token}`;
}

/**
 * Rewrite `{{name}}` tokens to native `{sq_name:DateTime64(3, 'UTC')}` params.
 * Returns the executable SQL and the set of referenced param names so the runner
 * can bind exactly those values via `query_params`.
 */
export function buildExecutableQuery(query: string): { sql: string; params: string[] } {
  const params = new Set<string>();
  const rewritten = query.replace(TOKEN_RE, (_full, name: string) => {
    const param = paramNameFor(name);
    params.add(param);
    return `{${param}:DateTime64(3, 'UTC')}`;
  });
  return { sql: rewritten, params: [...params] };
}

/** Render a UTC millisecond instant as a `DateTime64(3,'UTC')` literal value. */
export function toDateTime64Param(ms: number): string {
  // `YYYY-MM-DD HH:MM:SS.mmm` in UTC — the form ClickHouse parses for DateTime64.
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}
