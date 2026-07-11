/**
 * Small presentational helpers for the Scheduled Queries feature — status
 * badges, schedule labels, and time formatting. House tokens only (D10b).
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ScheduledQuery, SqStatus } from "@/api/scheduledQueries";

/** Shared house-style classes so the feature matches Monitoring / alerting. */
export const SQ_PANEL = "rounded-md border border-ink-500 bg-ink-100";
export const SQ_CARD = "rounded-xs border border-ink-500 bg-ink-100";
export const SQ_BTN_PRIMARY =
  "h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50";
export const SQ_BTN_GHOST =
  "h-9 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper";
export const SQ_LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint";

export function statusTone(status: SqStatus): string {
  switch (status) {
    case "success":
      return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "failed":
      return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
    case "error":
      return "border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300";
    case "running":
    default:
      return "border-ink-500 bg-ink-200 text-paper-muted";
  }
}

export function StatusBadge({ status }: { status: SqStatus }) {
  return (
    <Badge variant="outline" className={cn("rounded-xs font-mono text-[10px] uppercase tracking-[0.12em]", statusTone(status))}>
      {status}
    </Badge>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function scheduleLabel(job: ScheduledQuery): string {
  const h = String(job.hour).padStart(2, "0");
  switch (job.frequency) {
    case "manual":
      return "Manual only";
    case "cron":
      return `Cron: ${job.cronExpr ?? "—"} (${job.timezone})`;
    case "daily":
      return `Daily at ${h}:00 ${job.timezone}`;
    case "weekly":
      return `Weekly ${DOW[job.dayOfWeek] ?? "?"} at ${h}:00 ${job.timezone}`;
    case "monthly":
      return `Monthly day ${job.dayOfMonth} at ${h}:00 ${job.timezone}`;
    default:
      return job.frequency;
  }
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function formatRelative(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  if (min < 1) return diff >= 0 ? "just now" : "soon";
  if (min < 60) return diff >= 0 ? `${min}m ago` : `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return diff >= 0 ? `${hr}h ago` : `in ${hr}h`;
  const d = Math.round(hr / 24);
  return diff >= 0 ? `${d}d ago` : `in ${d}d`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
