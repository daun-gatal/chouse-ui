/**
 * Scheduled reports, the pure parts (ADR 0023 §13): when a schedule runs next in
 * its own time zone, and the text digest a run sends. Dependency-free (zod only)
 * so the route schemas and the tests import it without the database.
 */

import { z } from "zod";

import { RELATIVE_RANGE_KEYS, TIME_SERIES_TYPES, type ChartType, type Unit } from "./spec";

export const REPORT_KINDS = ["daily", "weekly"] as const;

/** True when the runtime knows the IANA zone. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const reportScheduleSchema = z.object({
  kind: z.enum(REPORT_KINDS),
  /** 0 = Sunday … 6 = Saturday; weekly only. */
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timezone: z.string().min(1).max(64),
}).strict().superRefine((s, ctx) => {
  if (s.kind === "weekly" && s.dayOfWeek === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A weekly report needs a day of the week" });
  if (s.kind === "daily" && s.dayOfWeek !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A daily report has no day of the week" });
  if (!isTimeZone(s.timezone)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown time zone "${s.timezone}"` });
});
export type ReportSchedule = z.infer<typeof reportScheduleSchema>;

export const reportRangeSchema = z.enum(RELATIVE_RANGE_KEYS);

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(ms: number, zone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** How far the zone is ahead of UTC at `ms`. */
function offsetMs(ms: number, zone: string): number {
  const p = zonedParts(ms, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time in a zone. A time skipped by a DST jump
 * lands after the jump; a repeated one takes its first occurrence.
 */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(guess, zone);
  const second = guess - offsetMs(first, zone);
  const shows = (ms: number): boolean => {
    const p = zonedParts(ms, zone);
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
  };
  const exact = [first, second].filter(shows);
  // No instant shows a skipped time; the later candidate is the same distance past the jump.
  return exact.length > 0 ? Math.min(...exact) : Math.max(first, second);
}

/** The first run strictly after `afterMs`. */
export function nextRunAt(schedule: ReportSchedule, afterMs: number): number {
  const today = zonedParts(afterMs, schedule.timezone);
  for (let i = 0; i <= 8; i++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    if (schedule.kind === "weekly" && date.getUTCDay() !== schedule.dayOfWeek) continue;
    const at = zonedToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), schedule.hour, schedule.minute, schedule.timezone);
    if (at > afterMs) return at;
  }
  // Unreachable for a valid schedule: a week always holds the next occurrence.
  throw new Error("No next run within 8 days");
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function scheduleText(s: ReportSchedule): string {
  const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  return s.kind === "daily" ? `Daily at ${time} ${s.timezone}` : `${DAYS[s.dayOfWeek ?? 0]}s at ${time} ${s.timezone}`;
}

// ============================================
// The digest
// ============================================

/** Longer messages are refused or cut by chat webhooks; the link carries the rest. */
export const MAX_DIGEST_CHARS = 3_800;
const TABLE_ROWS = 5;

export interface DigestData {
  columns: Array<{ name: string }>;
  rows: Array<Record<string, unknown>>;
}

export type DigestPanel =
  | { title: string; type: ChartType; unit: Unit; x: string | null; y: string[]; ok: true; connections: Array<{ name: string | null; data: DigestData }>; failed: Array<{ name: string; error: string }> }
  | { title: string; ok: false; error: string };

export interface DigestInput {
  reportName: string;
  dashboardTitle: string;
  from: number;
  to: number;
  timezone: string;
  panels: DigestPanel[];
  firedAlerts: string[];
  link: string;
}

const BINARY = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function formatNumber(value: number, unit: Unit): string {
  if (!Number.isFinite(value)) return String(value);
  const plain = (n: number): string => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  switch (unit) {
    case "bytes": {
      let n = Math.abs(value);
      let i = 0;
      while (n >= 1024 && i < BINARY.length - 1) { n /= 1024; i++; }
      return `${value < 0 ? "-" : ""}${plain(Math.round(n * 10) / 10)} ${BINARY[i]}`;
    }
    case "ms": return `${plain(value)} ms`;
    case "s": return `${plain(value)} s`;
    case "us": return `${plain(value)} µs`;
    case "percent": return `${plain(value)}%`;
    case "per_s": return `${plain(value)}/s`;
    case "rows": return `${plain(value)} rows`;
    default: return plain(value);
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function seriesLines(panel: Extract<DigestPanel, { ok: true }>, data: DigestData): string[] {
  return panel.y.map((column) => {
    const values = data.rows.map((r) => toNumber(r[column])).filter((n): n is number => n !== null);
    if (values.length === 0) return `${column}: no numeric values`;
    const sum = values.reduce((a, b) => a + b, 0);
    const f = (n: number): string => formatNumber(n, panel.unit);
    return `${column}: min ${f(Math.min(...values))} · avg ${f(sum / values.length)} · max ${f(Math.max(...values))} · last ${f(values[values.length - 1])}`;
  });
}

function panelLines(panel: DigestPanel): string[] {
  if (!panel.ok) return [`*${panel.title}* — error: ${panel.error}`];
  const out: string[] = [];
  for (const conn of panel.connections) {
    const prefix = conn.name ? `${conn.name}: ` : "";
    const data = conn.data;
    if (data.rows.length === 0) {
      out.push(`${prefix}no rows`);
    } else if (panel.type === "stat") {
      const column = panel.y[0] ?? data.columns[0]?.name ?? "";
      const value = toNumber(data.rows[data.rows.length - 1][column]);
      out.push(`${prefix}${value === null ? cell(data.rows[data.rows.length - 1][column]) : formatNumber(value, panel.unit)}`);
    } else if (panel.x !== null && TIME_SERIES_TYPES.has(panel.type)) {
      out.push(...seriesLines(panel, data).map((l) => `${prefix}${l}`));
    } else {
      const names = data.columns.map((c) => c.name);
      out.push(...data.rows.slice(0, TABLE_ROWS).map((r) => `${prefix}${names.map((n) => `${n}=${cell(r[n])}`).join(", ")}`));
      if (data.rows.length > TABLE_ROWS) out.push(`${prefix}… ${data.rows.length - TABLE_ROWS} more rows`);
    }
  }
  out.push(...panel.failed.map((f) => `${f.name}: error — ${f.error}`));
  if (panel.type === "stat" && out.length === 1) return [`*${panel.title}*: ${out[0]}`];
  return [`*${panel.title}*`, ...out.map((l) => `  ${l}`)];
}

function rangeText(from: number, to: number, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: zone, dateStyle: "medium", timeStyle: "short" });
  return `${fmt.format(new Date(from * 1000))} – ${fmt.format(new Date(to * 1000))} (${zone})`;
}

/** The report's message: the panels in order, the alerts that fired, and the link — always, even when cut short. */
export function buildDigest(input: DigestInput): { title: string; text: string } {
  const title = `📊 ${input.reportName}`;
  const head = `${input.dashboardTitle} · ${rangeText(input.from, input.to, input.timezone)}`;
  const alerts = input.firedAlerts.length === 0 ? "No panel alerts fired." : `Alerts fired: ${input.firedAlerts.join(", ")}`;
  const tail = `${alerts}\nOpen: ${input.link}`;
  const blocks = input.panels.map((p) => panelLines(p).join("\n"));
  const budget = MAX_DIGEST_CHARS - head.length - tail.length - 80;
  const kept: string[] = [];
  let used = 0;
  for (const block of blocks) {
    if (used + block.length + 2 > budget) break;
    kept.push(block);
    used += block.length + 2;
  }
  const omitted = blocks.length - kept.length;
  const more = omitted > 0 ? [`… ${omitted} more panel${omitted === 1 ? "" : "s"} — open the dashboard for ${omitted === 1 ? "it" : "them"}.`] : [];
  return { title, text: [head, ...kept, ...more, tail].join("\n\n") };
}
