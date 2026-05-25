/**
 * Shared bits for the ChouseD doctor surfaces (report view + history rail):
 * the status colour map and small formatters. Kept framework-free (no JSX) so
 * both components import the same source of truth.
 */

import type { DoctorStatus } from "@/api/fleet";

export interface StatusMeta {
  dot: string;
  text: string;
  border: string;
  bg: string;
  label: string;
}

export const DOCTOR_STATUS: Record<DoctorStatus, StatusMeta> = {
  healthy: {
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-300 dark:border-emerald-500/40",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    label: "Healthy",
  },
  warning: {
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-300 dark:border-amber-500/40",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    label: "Warning",
  },
  critical: {
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
    border: "border-red-300 dark:border-red-500/40",
    bg: "bg-red-50 dark:bg-red-950/30",
    label: "Critical",
  },
};

/** Severity rank for sorting nodes worst-first. */
export const STATUS_RANK: Record<DoctorStatus, number> = { critical: 0, warning: 1, healthy: 2 };

/** "just now" / "5m ago" / "3h ago" / "2d ago" / date. */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Wall-clock scan duration: "850ms" / "22.1s" / "1m 4s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Human bytes: "29.4 GB". */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Full timestamp for the report footer. */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
