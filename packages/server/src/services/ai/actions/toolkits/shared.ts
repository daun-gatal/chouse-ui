/**
 * Helpers shared by the action toolkits (ADR 0025 §2).
 */

import { z } from "zod";

import { CHART_TYPES } from "../../../dashboards/spec";
import type { ActionContext } from "../types";

export const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
export const quote = (value: string, max = 80): string => `"${value.length > max ? `${value.slice(0, max)}…` : value}"`;
export const seg = (value: unknown): string => encodeURIComponent(str(value));

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function idOf(value: unknown): string | null {
  const direct = record(value).id;
  if (typeof direct === "string") return direct;
  const nested = record(record(value).dashboard).id;
  return typeof nested === "string" ? nested : null;
}

/** Only the keys the model actually sent, for partial updates. */
export function given(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
}

export function needConnection(ctx: ActionContext): string {
  if (!ctx.connectionId) throw new Error("Pick a ClickHouse connection first: this action runs on the active connection.");
  return ctx.connectionId;
}

/** The cadences scheduled queries and promises accept; hourly and finer is a cron expression. */
export const FREQUENCIES = ["daily", "weekly", "monthly", "cron"] as const;

export function scheduleText(args: Record<string, unknown>): string {
  const hour = typeof args.hour === "number" ? `${String(args.hour).padStart(2, "0")}:00` : "08:00";
  const tz = str(args.timezone, "UTC");
  switch (args.frequency) {
    case "daily": return `daily at ${hour} ${tz}`;
    case "weekly": return `weekly on day ${typeof args.dayOfWeek === "number" ? args.dayOfWeek : 1} at ${hour} ${tz}`;
    case "monthly": return `monthly on day ${typeof args.dayOfMonth === "number" ? args.dayOfMonth : 1} at ${hour} ${tz}`;
    case "cron": return `on cron ${quote(str(args.cronExpr))}`;
    default: return "on a schedule";
  }
}

export const scheduleFields = {
  frequency: z.enum(FREQUENCIES).describe("How often it runs; for hourly or finer use cron with cronExpr (e.g. \"0 * * * *\")"),
  hour: z.number().int().min(0).max(23).optional().describe("Hour of day (daily, weekly, monthly)"),
  dayOfWeek: z.number().int().min(0).max(6).optional().describe("0 = Sunday (weekly)"),
  dayOfMonth: z.number().int().min(1).max(28).optional().describe("Day of month (monthly)"),
  cronExpr: z.string().optional().describe("Cron expression (frequency cron)"),
  timezone: z.string().optional().describe("IANA timezone, default UTC"),
};

/** The same schedule fields, all optional, for edits. */
export const optionalScheduleFields = {
  frequency: scheduleFields.frequency.optional(),
  hour: scheduleFields.hour,
  dayOfWeek: scheduleFields.dayOfWeek,
  dayOfMonth: scheduleFields.dayOfMonth,
  cronExpr: scheduleFields.cronExpr,
  timezone: scheduleFields.timezone,
};

export const SCHEDULE_KEYS = ["frequency", "hour", "dayOfWeek", "dayOfMonth", "cronExpr", "timezone"] as const;

export function scheduleBody(args: Record<string, unknown>): Record<string, unknown> {
  return {
    frequency: args.frequency,
    ...(typeof args.hour === "number" ? { hour: args.hour } : {}),
    ...(typeof args.dayOfWeek === "number" ? { dayOfWeek: args.dayOfWeek } : {}),
    ...(typeof args.dayOfMonth === "number" ? { dayOfMonth: args.dayOfMonth } : {}),
    ...(typeof args.cronExpr === "string" ? { cronExpr: args.cronExpr } : {}),
  };
}

export const panelSchema = z.object({
  title: z.string().min(1).max(200),
  sql: z.string().min(1).describe("Read-only SELECT; may use {{from}} / {{to}} time-range macros"),
  chart: z.enum(CHART_TYPES).describe("Chart type; table shows every column"),
  x: z.string().optional().describe("x column (not for stat or table)"),
  y: z.array(z.string()).max(8).optional().describe("y columns (stat: exactly one; table and histogram: none)"),
});

/** One panel of a dashboard document, from a panel the model described. */
export function panelDocument(raw: unknown): Record<string, unknown> {
  const p = record(raw);
  const type = str(p.chart, "table");
  const y = Array.isArray(p.y) ? p.y.filter((c): c is string => typeof c === "string") : [];
  return {
    id: null,
    title: str(p.title, "Panel"),
    sql: str(p.sql),
    viz: {
      version: 1,
      type,
      x: typeof p.x === "string" && p.x ? p.x : null,
      y,
      series: null,
      unit: "none",
      decimals: null,
      thresholds: [],
      colorScheme: "violet",
      reduce: type === "stat" ? "last" : null,
    },
    width: type === "table" ? 12 : 6,
    height: "m",
    fleet: false,
  };
}

/** A format 1 dashboard document (the route converts it), laid out two panels per row. */
export function dashboardDocument(args: Record<string, unknown>, connectionId: string): Record<string, unknown> {
  const panels = Array.isArray(args.panels) ? args.panels : [];
  return {
    title: str(args.title),
    description: str(args.description),
    timeRange: str(args.timeRange, "24h"),
    refreshSeconds: 0,
    connectionScope: { kind: "only", connectionIds: [connectionId] },
    variables: [],
    panels: panels.map(panelDocument),
  };
}
