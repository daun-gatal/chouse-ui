/**
 * Value formatting per viz-spec unit (ADR 0021 §2): axis ticks, tooltips,
 * stat values and table cells all read the same way.
 */

import type { Unit } from "./spec";

function compact(n: number, decimals: number | null): string {
  const abs = Math.abs(n);
  const fixed = (v: number, suffix: string): string => `${Number(v.toFixed(decimals ?? 1))}${suffix}`;
  if (abs >= 1e12) return fixed(n / 1e12, "T");
  if (abs >= 1e9) return fixed(n / 1e9, "B");
  if (abs >= 1e6) return fixed(n / 1e6, "M");
  if (abs >= 1e3) return fixed(n / 1e3, "K");
  return String(Number(n.toFixed(decimals ?? 2)));
}

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

function bytes(n: number, decimals: number | null): string {
  let value = Math.abs(n);
  let i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const sign = n < 0 ? "-" : "";
  return `${sign}${Number(value.toFixed(i === 0 ? 0 : decimals ?? 1))} ${BYTE_UNITS[i]}`;
}

function duration(seconds: number, decimals: number | null): string {
  const abs = Math.abs(seconds);
  const d = decimals ?? 1;
  if (abs < 1e-3) return `${Number((seconds * 1e6).toFixed(d))} µs`;
  if (abs < 1) return `${Number((seconds * 1e3).toFixed(d))} ms`;
  if (abs < 60) return `${Number(seconds.toFixed(d))} s`;
  if (abs < 3_600) return `${Number((seconds / 60).toFixed(d))} min`;
  if (abs < 86_400) return `${Number((seconds / 3_600).toFixed(d))} h`;
  return `${Number((seconds / 86_400).toFixed(d))} d`;
}

/** The value as a number, or null for anything that is not a finite number (or numeric string). */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Format `value` in `unit`. Non-numbers are shown as they are. */
export function formatValue(value: unknown, unit: Unit, decimals: number | null = null): string {
  const n = toNumber(value);
  if (n === null) return value === null || value === undefined ? "—" : String(value);
  switch (unit) {
    case "none":
    case "count":
    case "rows":
      return compact(n, decimals);
    case "per_s":
      return `${compact(n, decimals)}/s`;
    case "percent":
      return `${Number(n.toFixed(decimals ?? 1))}%`;
    case "bytes":
      return bytes(n, decimals);
    case "ms":
      return duration(n / 1e3, decimals);
    case "us":
      return duration(n / 1e6, decimals);
    case "s":
      return duration(n, decimals);
  }
}

export const UNIT_LABELS: Record<Unit, string> = {
  none: "None",
  count: "Count",
  rows: "Rows",
  per_s: "Per second",
  percent: "Percent",
  bytes: "Bytes",
  ms: "Milliseconds",
  us: "Microseconds",
  s: "Seconds",
};
