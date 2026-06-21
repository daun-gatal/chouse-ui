/**
 * Read-only SELECT validation + `{{…}}` window-macro handling for Scheduled
 * Queries. The source is validated SELECT-only (D3) at create/edit AND re-checked
 * before every run; macros are rewritten to NATIVE ClickHouse query parameters
 * (never string-concatenated) at execution time (D3b).
 *
 * Macro grammar, inside `{{ … }}`:
 *   <base> ( <±> <n> <unit> )* ( | <fn> )?
 *   base : slot_start | slot_end | prev_run_at
 *   unit : y|mo|w|d|h|m|s  (or year(s)/month(s)/week(s)/day(s)/hour(s)/minute(s)/second(s))
 *   fn   : date|datetime|year|month|day|hour|minute|second|yyyymm|yyyymmdd|
 *          start_of_day|start_of_hour|start_of_month|start_of_week|unix
 * Examples: {{slot_start}}, {{slot_start - 1d}}, {{slot_end + 2h}},
 *           {{slot_start | yyyymmdd}}, {{slot_end - 1mo | date}}
 *
 * NOTE: the frontend test-run mirrors this grammar in
 * src/features/scheduled-queries/macros.ts — keep them in sync.
 */

import { splitSqlStatements, parseStatement } from "../../middleware/sqlParser";

export const BASE_TOKENS = ["slot_start", "slot_end", "prev_run_at"] as const;
export type KnownToken = (typeof BASE_TOKENS)[number];
/** Back-compat alias. */
export const KNOWN_TOKENS = BASE_TOKENS;

/** Whole-macro matcher (no nested braces inside a macro). */
const MACRO_RE = /\{\{([^}]*)\}\}/g;

const UNIT_SQL: Record<string, string> = {
  y: "YEAR", year: "YEAR", years: "YEAR",
  mo: "MONTH", month: "MONTH", months: "MONTH",
  w: "WEEK", week: "WEEK", weeks: "WEEK",
  d: "DAY", day: "DAY", days: "DAY",
  h: "HOUR", hour: "HOUR", hours: "HOUR",
  m: "MINUTE", min: "MINUTE", minute: "MINUTE", minutes: "MINUTE",
  s: "SECOND", sec: "SECOND", second: "SECOND", seconds: "SECOND",
};

const FN_SQL: Record<string, string> = {
  date: "toDate", datetime: "toDateTime",
  year: "toYear", month: "toMonth", day: "toDayOfMonth",
  hour: "toHour", minute: "toMinute", second: "toSecond",
  yyyymm: "toYYYYMM", yyyymmdd: "toYYYYMMDD",
  start_of_day: "toStartOfDay", start_of_hour: "toStartOfHour",
  start_of_month: "toStartOfMonth", start_of_week: "toStartOfWeek",
  unix: "toUnixTimestamp",
};

export interface MacroParse {
  base: KnownToken;
  offsets: Array<{ op: "+" | "-"; n: number; unit: string }>;
  fn?: string;
}

/** Parse a macro's inner text. Returns the parse, or an error string. */
export function parseMacro(inner: string): MacroParse | { error: string } {
  let s = inner.trim();

  let fn: string | undefined;
  const pipeIdx = s.indexOf("|");
  if (pipeIdx >= 0) {
    const fnRaw = s.slice(pipeIdx + 1).trim().toLowerCase();
    fn = FN_SQL[fnRaw];
    if (!fn) return { error: `unknown format "${fnRaw}"` };
    s = s.slice(0, pipeIdx).trim();
  }

  const head = s.match(/^([a-z_]+)/i);
  if (!head) return { error: "missing base token (slot_start | slot_end | prev_run_at)" };
  const base = head[1].toLowerCase();
  if (!(BASE_TOKENS as readonly string[]).includes(base)) return { error: `unknown token "${base}"` };
  s = s.slice(head[1].length).trim();

  const offsets: MacroParse["offsets"] = [];
  const offRe = /^([+-])\s*(\d+)\s*([a-z]+)\s*/i;
  while (s.length > 0) {
    const om = s.match(offRe);
    if (!om) return { error: `invalid offset near "${s}"` };
    const unit = UNIT_SQL[om[3].toLowerCase()];
    if (!unit) return { error: `unknown unit "${om[3]}"` };
    offsets.push({ op: om[1] as "+" | "-", n: parseInt(om[2], 10), unit });
    s = s.slice(om[0].length).trim();
  }

  return { base: base as KnownToken, offsets, fn };
}

/** Compile a parsed macro to a ClickHouse expression over `baseExpr`. */
export function macroToSql(p: MacroParse, baseExpr: string): string {
  let expr = baseExpr;
  for (const o of p.offsets) expr = `(${expr} ${o.op} INTERVAL ${o.n} ${o.unit})`;
  if (p.fn) expr = `${p.fn}(${expr})`;
  return expr;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  /** Distinct base tokens referenced by the query, in first-seen order. */
  tokens: KnownToken[];
}

/** Distinct base tokens referenced by valid macros in the query. */
export function extractTokenNames(query: string): string[] {
  const names = new Set<string>();
  for (const m of query.matchAll(MACRO_RE)) {
    const parsed = parseMacro(m[1]);
    if (!("error" in parsed)) names.add(parsed.base);
  }
  return [...names];
}

/**
 * Validate the source is a single read-only SELECT and every `{{…}}` macro is
 * well-formed. Macros are replaced with a benign literal before parsing so the
 * AST parser (which cannot read `{{…}}`) sees valid SQL.
 */
export function validateReadOnlySelect(query: string): ValidationResult {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "Query is empty", tokens: [] };

  // Fail closed on any malformed macro.
  for (const m of trimmed.matchAll(MACRO_RE)) {
    const parsed = parseMacro(m[1]);
    if ("error" in parsed) {
      return { ok: false, error: `Invalid template macro {{${m[1].trim()}}}: ${parsed.error}`, tokens: [] };
    }
  }

  const parseable = toParseableSql(trimmed);
  const statements = splitSqlStatements(parseable).filter((s) => s.trim().length > 0);
  if (statements.length === 0) return { ok: false, error: "Query is empty", tokens: [] };
  if (statements.length > 1) {
    return { ok: false, error: "Only a single SELECT statement is allowed", tokens: [] };
  }

  const parsed = parseStatement(statements[0]);
  if (parsed.type !== "select") {
    return { ok: false, error: "Only read-only SELECT queries can be scheduled", tokens: [] };
  }

  return { ok: true, tokens: extractTokenNames(trimmed) as KnownToken[] };
}

/**
 * Replace `{{…}}` macros with a benign literal so an AST/data-access validator
 * (which can't read `{{…}}`) sees parseable SQL. Table references are unaffected.
 */
export function toParseableSql(query: string): string {
  return query.replace(MACRO_RE, "0");
}

/** Native ClickHouse param name for a base token (`slot_start` → `sq_slot_start`). */
export function paramNameFor(token: string): string {
  return `sq_${token}`;
}

/**
 * Rewrite `{{…}}` macros to ClickHouse expressions over native
 * `{sq_name:DateTime64(3,'UTC')}` params. Returns the executable SQL and the set
 * of referenced base param names. Unparseable macros are left verbatim (already
 * rejected by validateReadOnlySelect).
 */
export function buildExecutableQuery(query: string): { sql: string; params: string[] } {
  const params = new Set<string>();
  const rewritten = query.replace(MACRO_RE, (full, inner: string) => {
    const parsed = parseMacro(inner);
    if ("error" in parsed) return full;
    const param = paramNameFor(parsed.base);
    params.add(param);
    return macroToSql(parsed, `{${param}:DateTime64(3, 'UTC')}`);
  });
  return { sql: rewritten, params: [...params] };
}

/** Render a UTC millisecond instant as a `DateTime64(3,'UTC')` literal value. */
export function toDateTime64Param(ms: number): string {
  // `YYYY-MM-DD HH:MM:SS.mmm` in UTC — the form ClickHouse parses for DateTime64.
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}
