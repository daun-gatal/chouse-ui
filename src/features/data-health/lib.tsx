import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DataHealthCheck, DataHealthEventTimeEncoding, DataHealthOutcome, DataHealthSchedule, DataHealthState } from "@/api/dataHealth";

export const DH_LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint";
export const DH_PRIMARY = "h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50";

export function stateTone(state: DataHealthState | DataHealthOutcome): string {
  switch (state) {
    case "healthy":
    case "pass":
      return "border-emerald-400/40 bg-emerald-500/10 text-emerald-500";
    case "degraded":
    case "learning":
      return "border-amber-400/40 bg-amber-500/10 text-amber-500";
    case "unhealthy":
    case "breach":
      return "border-red-400/40 bg-red-500/10 text-red-500";
    case "unknown":
    case "not_evaluated":
      return "border-sky-400/40 bg-sky-500/10 text-sky-500";
    case "paused":
    default:
      return "border-ink-500 bg-ink-200 text-paper-muted";
  }
}

export function HealthBadge({ state }: { state: DataHealthState | DataHealthOutcome }) {
  return <Badge variant="outline" className={cn("rounded-xs font-mono text-[9px] uppercase tracking-[0.12em]", stateTone(state))}>{state.replace("_", " ")}</Badge>;
}

export function formatHealthTime(value: number | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

interface ColumnWithType {
  name: string;
  type: string;
}

const TEMPORAL_TYPE = /(^|[^A-Za-z0-9_])(DateTime64|DateTime|Date32|Date)(?=[^A-Za-z0-9_]|$)/;
const INTEGER_TYPE = /(^|[^A-Za-z0-9_])U?Int(?:8|16|32|64|128|256)(?=[^A-Za-z0-9_]|$)/;
const STRING_TYPE = /(^|[^A-Za-z0-9_])(FixedString|String)(?=[^A-Za-z0-9_]|$)/;
const EVENT_TIME_NAMES = [
  "event_time",
  "event_timestamp",
  "event_ts",
  "occurred_at",
  "timestamp",
  "ts",
  "created_at",
  "updated_at",
  "datetime",
  "event_date",
  "date",
];

export function isTemporalColumnType(type: string): boolean {
  return TEMPORAL_TYPE.test(type);
}

export function isDateOnlyColumnType(type: string | null | undefined): boolean {
  return Boolean(type && /(^|[^A-Za-z0-9_])(Date32|Date)(?=[^A-Za-z0-9_]|$)/.test(type) && !type.includes("DateTime"));
}

export type EventTimeSupport = "native" | "unix" | "string" | "unsupported";

export function eventTimeSupport(type: string): EventTimeSupport {
  if (isTemporalColumnType(type)) return "native";
  if (INTEGER_TYPE.test(type)) return "unix";
  if (STRING_TYPE.test(type)) return "string";
  return "unsupported";
}

export function isSupportedEventTimeColumnType(type: string): boolean {
  return eventTimeSupport(type) !== "unsupported";
}

export function suggestEventTimeEncoding(column: ColumnWithType): DataHealthEventTimeEncoding {
  const support = eventTimeSupport(column.type);
  if (support === "native") return "native";
  if (support === "string") return "string";
  const name = column.name.toLowerCase();
  if (/(?:^|_)ns$|nano/.test(name)) return "unix_nanoseconds";
  if (/(?:^|_)us$|micro/.test(name)) return "unix_microseconds";
  if (/(?:^|_)ms$|milli/.test(name)) return "unix_milliseconds";
  return support === "unix" ? "unix_seconds" : "auto";
}

export function detectEventTimeColumn(columns: ColumnWithType[]): string {
  const supported = columns.filter((column) => eventTimeSupport(column.type) !== "unsupported");
  for (const preferredName of EVENT_TIME_NAMES) {
    const match = supported.find((column) => column.name.toLowerCase() === preferredName);
    if (match) return match.name;
  }
  const temporal = supported.filter((column) => isTemporalColumnType(column.type));
  return temporal.find((column) => column.type.includes("DateTime64"))?.name
    ?? temporal.find((column) => column.type.includes("DateTime"))?.name
    ?? temporal[0]?.name
    ?? "";
}

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatSchedule(schedule: DataHealthSchedule, timezone: string): string {
  const hour = String(schedule.hour).padStart(2, "0");
  switch (schedule.frequency) {
    case "manual":
      return "Manual";
    case "event":
      return "After upstream run";
    case "cron":
      return `cron · ${schedule.cronExpr ?? "—"} ${timezone}`;
    case "daily":
      return `daily · ${hour}:00 ${timezone}`;
    case "weekly":
      return `weekly · ${DAYS_OF_WEEK[schedule.dayOfWeek] ?? "?"} ${hour}:00 ${timezone}`;
    case "monthly":
      return `monthly · day ${schedule.dayOfMonth} ${hour}:00 ${timezone}`;
  }
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const days = Math.floor(rounded / 86_400);
  const hours = Math.floor((rounded % 86_400) / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainder = rounded % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : remainder > 0 ? ` ${remainder}s` : ""}`;
  if (minutes > 0) return `${minutes}m${remainder > 0 ? ` ${remainder}s` : ""}`;
  return `${remainder}s`;
}

export function formatMetric(value: number | null, checkType?: DataHealthCheck["type"]): string {
  if (value == null) return "—";
  if (checkType === "freshness") return formatDuration(value);
  if (Math.abs(value) < 1 && value !== 0) return `${(value * 100).toFixed(2)}%`;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
