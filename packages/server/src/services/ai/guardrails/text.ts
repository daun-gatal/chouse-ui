/**
 * Text matching and redaction for guardrails (ADR 0022 §2).
 *
 * Finders return spans with the placeholder token to use; `redactSpans`
 * rewrites them with a strategy. JSON tool results are walked value by value,
 * so redaction keeps them valid JSON and never rewrites keys.
 */

import { createHash } from "crypto";

import { detectorById, type Span } from "./detectors";
import { MAX_SCANNED_VALUE_BYTES, type ColumnsConfig, type InjectionConfig, type KeywordsConfig, type PatternConfig } from "./kinds";
import type { RedactStrategy } from "./types";

export interface Found {
  span: Span;
  token: string;
}

export type Finder = (text: string) => Found[];

export class GuardrailInputTooLarge extends Error {}

function checkSize(text: string): void {
  if (text.length > MAX_SCANNED_VALUE_BYTES) throw new GuardrailInputTooLarge(`A value of ${text.length} characters is larger than the ${MAX_SCANNED_VALUE_BYTES}-character scan limit`);
}

function regexSpans(re: RegExp, text: string, token: string): Found[] {
  const found: Found[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    found.push({ span: [m.index, m.index + m[0].length], token });
  }
  re.lastIndex = 0;
  return found;
}

export function tokenFor(label: string): string {
  return label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "MATCH";
}

export function patternFinder(config: PatternConfig): Finder {
  const detectors = config.detectors.map((id) => detectorById(id)).filter((d) => d !== undefined);
  const custom = config.patterns.map((p) => ({ re: new RegExp(p.regex, p.caseInsensitive ? "giu" : "gu"), token: tokenFor(p.label) }));
  return (text) => {
    checkSize(text);
    return [
      ...detectors.flatMap((d) => d.find(text).map((span) => ({ span, token: d.token }))),
      ...custom.flatMap((p) => regexSpans(p.re, text, p.token)),
    ];
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function keywordsFinder(config: KeywordsConfig): Finder {
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${config.terms.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  return (text) => {
    checkSize(text);
    return regexSpans(re, text, "REDACTED");
  };
}

/** Phrases that read as instructions to the model rather than data. */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|system)\s+(?:instructions?|prompts?|messages?|rules?|context)\b/i,
  /\byou\s+are\s+now\s+(?:a|an|the|in)\b/i,
  /\b(?:new|updated|real)\s+(?:system\s+)?instructions?\s*:/i,
  /\b(?:reveal|print|show|repeat)\s+(?:your|the)\s+(?:system\s+prompt|instructions|hidden\s+prompt)\b/i,
  /<\/?\s*(?:system|assistant|instructions?|im_start|im_end)\s*>/i,
  /\[\s*(?:system|inst)\s*\]/i,
  /\bdo\s+not\s+(?:tell|inform)\s+the\s+user\b/i,
];

export function injectionCounter(config: InjectionConfig): (text: string) => number {
  const extra = config.extraPhrases.map((p) => new RegExp(escapeRegex(p), "i"));
  const all = [...INJECTION_PATTERNS, ...extra];
  return (text) => {
    checkSize(text);
    return all.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  };
}

function globRegex(glob: string): RegExp {
  return new RegExp(`^${glob.split("*").map((part) => part.split("?").map(escapeRegex).join(".")).join(".*")}$`, "i");
}

/**
 * Results rarely say which table a column came from, so a qualified entry such
 * as "users.email" also matches a bare "email" column.
 */
export function columnMatcher(config: ColumnsConfig): (column: string) => boolean {
  const res = config.columns.flatMap((c) => {
    const last = c.split(".").pop() ?? c;
    return last === c ? [globRegex(c)] : [globRegex(c), globRegex(last)];
  });
  return (column) => res.some((re) => re.test(column));
}

/** Merge overlapping spans, keeping the earliest and longest. */
function normalize(found: Found[]): Found[] {
  const sorted = [...found].sort((a, b) => a.span[0] - b.span[0] || b.span[1] - a.span[1]);
  const out: Found[] = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    if (last && f.span[0] < last.span[1]) continue;
    out.push(f);
  }
  return out;
}

export function redactValue(value: string, token: string, strategy: RedactStrategy, salt: string): string {
  if (strategy === "mask") return value.length <= 4 ? "•••" : `${value.slice(0, 2)}•••`;
  if (strategy === "hash") return `[${token}:${createHash("sha256").update(salt).update(value).digest("hex").slice(0, 8)}]`;
  return `[${token}]`;
}

export function findAll(finder: Finder, text: string): Found[] {
  return normalize(finder(text));
}

export function redactSpans(text: string, found: Found[], strategy: RedactStrategy, salt: string): string {
  let out = "";
  let at = 0;
  for (const f of found) {
    out += text.slice(at, f.span[0]) + redactValue(text.slice(f.span[0], f.span[1]), f.token, strategy, salt);
    at = f.span[1];
  }
  return out + text.slice(at);
}

/** Apply `fn` to every string value (not key) of a JSON value; returns a new value. */
export function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]));
  }
  return value;
}

function columnNames(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  const names = list.map((c) => (typeof c === "string" ? c : c && typeof c === "object" && "name" in c && typeof c.name === "string" ? c.name : null));
  return names.every((n): n is string => n !== null) ? names : null;
}

function scalarText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Replace the values of matching columns: object keys at any depth, and
 * positions in row arrays whose sibling `columns`/`meta` lists the names.
 * Returns the new value and how many values were replaced.
 */
export function maskColumns(value: unknown, matches: (column: string) => boolean, replace: (text: string, column: string) => string): { value: unknown; count: number } {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const entries = Object.entries(v);
    const names = columnNames((v as Record<string, unknown>).columns) ?? columnNames((v as Record<string, unknown>).meta);
    const hidden = names ? names.map((n) => matches(n)) : [];
    return Object.fromEntries(entries.map(([key, item]) => {
      if (item !== null && matches(key) && typeof item !== "object") {
        count++;
        return [key, replace(scalarText(item), key)];
      }
      if (names && hidden.some(Boolean) && Array.isArray(item) && item.every(Array.isArray)) {
        return [key, (item as unknown[][]).map((row) => row.map((cell, i) => {
          if (!hidden[i] || cell === null || typeof cell === "object") return walk(cell);
          count++;
          return replace(scalarText(cell), names[i]);
        }))];
      }
      return [key, walk(item)];
    }));
  };
  return { value: walk(value), count };
}

/** Truncate the longest row lists to `maxRows`; returns rows dropped. */
export function capRows(value: unknown, maxRows: number): { value: unknown; dropped: number } {
  let dropped = 0;
  const walk = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v)) {
      const rowsLike = v.length > maxRows && v.every((item) => item !== null && typeof item === "object");
      if (rowsLike || (top && v.length > maxRows)) {
        dropped += v.length - maxRows;
        return v.slice(0, maxRows).map((item) => walk(item, false));
      }
      return v.map((item) => walk(item, false));
    }
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, walk(item, false)]));
    return v;
  };
  return { value: walk(value, true), dropped };
}
