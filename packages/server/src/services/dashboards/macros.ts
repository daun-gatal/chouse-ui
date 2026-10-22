/**
 * Dashboard macros (ADR 0021 §3): `{{from}}`, `{{to}}`, `{{interval_s}}` and
 * `{{var.NAME}}`, compiled to NATIVE ClickHouse query parameters — never
 * concatenated into the SQL.
 *
 * Compiling produces two texts from one scan:
 *   - `sql` + `params`, which ClickHouse runs;
 *   - `validationSql`, with literals in place of the parameters and the chosen
 *     identifier values inlined, which the read-only and data-access validators
 *     read (they cannot read `{name:Type}`). Identifier values are checked
 *     against IDENTIFIER_RE first, so inlining them cannot change the statement.
 *
 * A multi-value variable (ADR 0023 §7) compiles to an `Array(String)`
 * parameter, used as `col IN {{var.NAME}}` or `has({{var.NAME}}, col)`.
 *
 * A macro inside a quoted string, a quoted identifier or a comment is an
 * error, not a literal.
 */

import { IDENTIFIER_RE, RELATIVE_RANGES, type TimeRange, type Variable, type VariableValue } from "./spec";

export type Macro =
  | { kind: "from" }
  | { kind: "to" }
  | { kind: "interval" }
  | { kind: "var"; name: string };

export interface MacroToken {
  start: number;
  end: number;
  macro: Macro;
}

export type ScanResult = { ok: true; tokens: MacroToken[] } | { ok: false; error: string };

function parseInner(inner: string): Macro | null {
  const text = inner.trim();
  if (text === "from") return { kind: "from" };
  if (text === "to") return { kind: "to" };
  if (text === "interval_s") return { kind: "interval" };
  const match = /^var\.([a-z][a-z0-9_]{0,39})$/.exec(text);
  return match ? { kind: "var", name: match[1] } : null;
}

/** Find every `{{…}}` macro outside strings, quoted identifiers and comments. */
export function scanMacros(sql: string): ScanResult {
  const tokens: MacroToken[] = [];
  let i = 0;
  let quote: "'" | '"' | "`" | null = null;
  let comment: "line" | "block" | null = null;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (comment === "line") {
      if (ch === "\n") comment = null;
      else if (ch === "{" && next === "{") return { ok: false, error: "A macro cannot be inside a comment" };
      i += 1;
      continue;
    }
    if (comment === "block") {
      if (ch === "*" && next === "/") { comment = null; i += 2; continue; }
      if (ch === "{" && next === "{") return { ok: false, error: "A macro cannot be inside a comment" };
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) {
        if (next === quote) { i += 2; continue; }
        quote = null;
        i += 1;
        continue;
      }
      if (ch === "{" && next === "{") {
        return { ok: false, error: quote === "'" ? "A macro cannot be inside a quoted string; write {{from}}, not '{{from}}'" : "A macro cannot be inside a quoted identifier" };
      }
      i += 1;
      continue;
    }
    if (ch === "-" && next === "-") { comment = "line"; i += 2; continue; }
    if (ch === "/" && next === "*") { comment = "block"; i += 2; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; i += 1; continue; }
    if (ch === "{" && next === "{") {
      const close = sql.indexOf("}}", i + 2);
      if (close < 0) return { ok: false, error: "A macro is not closed with }}" };
      const inner = sql.slice(i + 2, close);
      const macro = parseInner(inner);
      if (!macro) return { ok: false, error: `Unknown macro {{${inner.trim()}}}: use {{from}}, {{to}}, {{interval_s}} or {{var.NAME}}` };
      tokens.push({ start: i, end: close + 2, macro });
      i = close + 2;
      continue;
    }
    i += 1;
  }
  if (quote) return { ok: false, error: "A quoted string or identifier is not closed" };
  if (comment === "block") return { ok: false, error: "A block comment is not closed" };
  return { ok: true, tokens };
}

/** Variable names a panel's SQL refers to, in first-seen order. */
export function referencedVariables(tokens: MacroToken[]): string[] {
  const names: string[] = [];
  for (const { macro } of tokens) {
    if (macro.kind === "var" && !names.includes(macro.name)) names.push(macro.name);
  }
  return names;
}

// ============================================
// Time window
// ============================================

/** Bucket sizes `{{interval_s}}` picks from, in seconds. */
export const INTERVAL_STEPS = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800, 3_600, 7_200, 10_800, 21_600, 43_200, 86_400] as const;
/** About this many buckets over the range. */
const TARGET_POINTS = 120;
/**
 * Relative ranges end at "now" rounded down to this many seconds, so viewers
 * opening the same dashboard within one window render the same query and share
 * one cached result (§4).
 */
export const RELATIVE_ALIGN_SECONDS = 30;

export interface Window {
  from: number;
  to: number;
  intervalSeconds: number;
}

export function intervalFor(rangeSeconds: number): number {
  const wanted = rangeSeconds / TARGET_POINTS;
  return INTERVAL_STEPS.find((step) => step >= wanted) ?? INTERVAL_STEPS[INTERVAL_STEPS.length - 1];
}

/** Resolve a time range to unix seconds, at `nowMs`. */
export function resolveWindow(range: TimeRange, nowMs: number): Window {
  if (range.kind === "absolute") {
    return { from: range.from, to: range.to, intervalSeconds: intervalFor(range.to - range.from) };
  }
  const seconds = RELATIVE_RANGES[range.value];
  const to = Math.floor(nowMs / 1000 / RELATIVE_ALIGN_SECONDS) * RELATIVE_ALIGN_SECONDS;
  return { from: to - seconds, to, intervalSeconds: intervalFor(seconds) };
}

// ============================================
// Compile
// ============================================

export type ParamValue = string | number | string[];

export interface Compiled {
  sql: string;
  params: Record<string, ParamValue>;
  validationSql: string;
}

export type CompileResult = { ok: true; compiled: Compiled } | { ok: false; error: string };

/**
 * Compile `sql` for `window`, with `values` chosen for the dashboard's
 * `variables`. Fails on a malformed or unknown macro, a variable the dashboard
 * does not declare, a missing value, a value of the wrong shape for its
 * variable (a list for a single-value one, or the reverse), an empty list, or
 * an identifier value that is not an identifier.
 */
export function compileSql(sql: string, variables: Variable[], values: Record<string, VariableValue>, window: Window): CompileResult {
  const scan = scanMacros(sql);
  if (!scan.ok) return scan;
  const byName = new Map(variables.map((v) => [v.name, v]));
  const params: Record<string, ParamValue> = {};
  let out = "";
  let validation = "";
  let cursor = 0;
  for (const { start, end, macro } of scan.tokens) {
    out += sql.slice(cursor, start);
    validation += sql.slice(cursor, start);
    cursor = end;
    if (macro.kind === "from" || macro.kind === "to") {
      const name = macro.kind === "from" ? "chouse_from" : "chouse_to";
      params[name] = macro.kind === "from" ? window.from : window.to;
      out += `{${name}:DateTime}`;
      validation += "now()";
      continue;
    }
    if (macro.kind === "interval") {
      params.chouse_interval_s = window.intervalSeconds;
      out += "{chouse_interval_s:UInt32}";
      validation += String(window.intervalSeconds);
      continue;
    }
    const variable = byName.get(macro.name);
    if (!variable) return { ok: false, error: `{{var.${macro.name}}} is not a variable of this dashboard` };
    const value = values[macro.name];
    if (value === undefined) return { ok: false, error: `Variable ${variable.label} has no value` };
    const param = `v_${macro.name}`;
    if (variable.kind === "multi") {
      if (!Array.isArray(value)) return { ok: false, error: `Variable ${variable.label} takes a list of values` };
      if (value.length === 0) return { ok: false, error: `Pick at least one value for ${variable.label}` };
      params[param] = value;
      out += `{${param}:Array(String)}`;
      validation += "('')";
      continue;
    }
    if (Array.isArray(value)) return { ok: false, error: `Variable ${variable.label} takes one value, not a list` };
    if (variable.kind === "identifier") {
      if (!IDENTIFIER_RE.test(value)) return { ok: false, error: `Variable ${variable.label} must be an identifier (letters, digits and _), got "${value}"` };
      params[param] = value;
      out += `{${param}:Identifier}`;
      // Backticked so a keyword such as `default` still parses as a name.
      validation += `\`${value}\``;
    } else {
      params[param] = value;
      out += `{${param}:String}`;
      validation += "''";
    }
  }
  out += sql.slice(cursor);
  validation += sql.slice(cursor);
  return { ok: true, compiled: { sql: out, params, validationSql: validation } };
}

/** Each variable's default value, for checks that need some value per variable. */
export function defaultValues(variables: Variable[]): Record<string, VariableValue> {
  return Object.fromEntries(variables.map((v) => [v.name, v.default]));
}
