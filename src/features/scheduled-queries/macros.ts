/**
 * Frontend mirror of the `{{…}}` window-macro grammar used to compile a query
 * for the builder's test-run (substituting a concrete sample window). The
 * authoritative grammar lives server-side in
 * packages/server/src/services/scheduledQueries/validation.ts — keep them in sync.
 *
 * Grammar:  <base> ( <±> <n> <unit> )* ( | <fn> )?
 *   base: slot_start | slot_end | prev_run_at
 *   unit: y|mo|w|d|h|m|s (or full words)
 *   fn:   date|datetime|year|month|day|hour|minute|second|yyyymm|yyyymmdd|
 *         start_of_day|start_of_hour|start_of_month|start_of_week|unix
 */

const BASE_TOKENS = ["slot_start", "slot_end", "prev_run_at"] as const;
type BaseToken = (typeof BASE_TOKENS)[number];

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

interface MacroParse {
  base: BaseToken;
  offsets: Array<{ op: "+" | "-"; n: number; unit: string }>;
  fn?: string;
}

function parseMacro(inner: string): MacroParse | null {
  let s = inner.trim();
  let fn: string | undefined;
  const pipeIdx = s.indexOf("|");
  if (pipeIdx >= 0) {
    fn = FN_SQL[s.slice(pipeIdx + 1).trim().toLowerCase()];
    if (!fn) return null;
    s = s.slice(0, pipeIdx).trim();
  }
  const head = s.match(/^([a-z_]+)/i);
  if (!head) return null;
  const base = head[1].toLowerCase();
  if (!(BASE_TOKENS as readonly string[]).includes(base)) return null;
  s = s.slice(head[1].length).trim();
  const offsets: MacroParse["offsets"] = [];
  const offRe = /^([+-])\s*(\d+)\s*([a-z]+)\s*/i;
  while (s.length > 0) {
    const om = s.match(offRe);
    if (!om) return null;
    const unit = UNIT_SQL[om[3].toLowerCase()];
    if (!unit) return null;
    offsets.push({ op: om[1] as "+" | "-", n: parseInt(om[2], 10), unit });
    s = s.slice(om[0].length).trim();
  }
  return { base: base as BaseToken, offsets, fn };
}

function macroToSql(p: MacroParse, baseExpr: string): string {
  let expr = baseExpr;
  for (const o of p.offsets) expr = `(${expr} ${o.op} INTERVAL ${o.n} ${o.unit})`;
  if (p.fn) expr = `${p.fn}(${expr})`;
  return expr;
}

function dt64(ms: number): string {
  const iso = new Date(ms).toISOString().replace("T", " ").replace("Z", "");
  return `toDateTime64('${iso}', 3, 'UTC')`;
}

/**
 * Compile `{{…}}` macros to ClickHouse SQL with a concrete sample window so the
 * query is runnable in the builder. Invalid macros are left verbatim (so the
 * resulting ClickHouse error surfaces them).
 */
export function substituteMacros(query: string, window: { slotStartMs: number; slotEndMs: number; prevRunAtMs: number }): string {
  const baseExpr: Record<BaseToken, string> = {
    slot_start: dt64(window.slotStartMs),
    slot_end: dt64(window.slotEndMs),
    prev_run_at: dt64(window.prevRunAtMs),
  };
  return query.replace(MACRO_RE, (full, inner: string) => {
    const parsed = parseMacro(inner);
    return parsed ? macroToSql(parsed, baseExpr[parsed.base]) : full;
  });
}

export interface SampleWindow {
  slotStartMs: number;
  slotEndMs: number;
  prevRunAtMs: number;
}

/** Default sample window for previews — the last 24 hours (same as test-run). */
export function sampleWindow(now = Date.now()): SampleWindow {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  return { slotStartMs: dayAgo, slotEndMs: now, prevRunAtMs: dayAgo };
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Evaluate a parsed macro to its resolved value (UTC) for the preview. */
function formatValue(d: Date, fn?: string): string {
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  const date = `${y}-${p2(mo)}-${p2(day)}`;
  const time = `${p2(h)}:${p2(mi)}:${p2(s)}`;
  switch (fn) {
    case undefined: return `${date} ${time}.${String(d.getUTCMilliseconds()).padStart(3, "0")}`;
    case "toDate": return date;
    case "toDateTime": return `${date} ${time}`;
    case "toYear": return String(y);
    case "toMonth": return String(mo);
    case "toDayOfMonth": return String(day);
    case "toHour": return String(h);
    case "toMinute": return String(mi);
    case "toSecond": return String(s);
    case "toYYYYMM": return `${y}${p2(mo)}`;
    case "toYYYYMMDD": return `${y}${p2(mo)}${p2(day)}`;
    case "toStartOfDay": return `${date} 00:00:00`;
    case "toStartOfHour": return `${date} ${p2(h)}:00:00`;
    case "toStartOfMonth": return `${y}-${p2(mo)}-01 00:00:00`;
    case "toStartOfWeek": {
      const sunday = new Date(d.getTime() - d.getUTCDay() * 86400000);
      return `${sunday.getUTCFullYear()}-${p2(sunday.getUTCMonth() + 1)}-${p2(sunday.getUTCDate())} 00:00:00`;
    }
    case "toUnixTimestamp": return String(Math.floor(d.getTime() / 1000));
    default: return `${date} ${time}`;
  }
}

/** Resolve a single `{{…}}` macro to its sample value, or null if invalid. */
export function evalMacro(macroText: string, window: SampleWindow): string | null {
  const inner = macroText.replace(/^\{\{/, "").replace(/\}\}$/, "");
  const parsed = parseMacro(inner);
  if (!parsed) return null;
  const baseMs: Record<BaseToken, number> = {
    slot_start: window.slotStartMs,
    slot_end: window.slotEndMs,
    prev_run_at: window.prevRunAtMs,
  };
  let d = new Date(baseMs[parsed.base]);
  for (const o of parsed.offsets) {
    const k = o.op === "+" ? o.n : -o.n;
    switch (o.unit) {
      case "YEAR": d.setUTCFullYear(d.getUTCFullYear() + k); break;
      case "MONTH": d.setUTCMonth(d.getUTCMonth() + k); break;
      case "WEEK": d = new Date(d.getTime() + k * 7 * 86400000); break;
      case "DAY": d = new Date(d.getTime() + k * 86400000); break;
      case "HOUR": d = new Date(d.getTime() + k * 3600000); break;
      case "MINUTE": d = new Date(d.getTime() + k * 60000); break;
      case "SECOND": d = new Date(d.getTime() + k * 1000); break;
    }
  }
  return formatValue(d, parsed.fn);
}

/** Distinct `{{…}}` macros in a query, each resolved to its sample value. */
export function previewMacros(query: string, window: SampleWindow = sampleWindow()): Array<{ macro: string; value: string }> {
  const seen = new Set<string>();
  const out: Array<{ macro: string; value: string }> = [];
  for (const m of query.matchAll(MACRO_RE)) {
    const macro = `{{${m[1].trim()}}}`;
    if (seen.has(macro)) continue;
    seen.add(macro);
    const value = evalMacro(macro, window);
    if (value !== null) out.push({ macro, value });
  }
  return out;
}
