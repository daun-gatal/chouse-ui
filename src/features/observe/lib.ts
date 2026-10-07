/**
 * Pure formatting and vocabulary helpers for the Data Observability screens.
 */

import type { Criticality, PipelineKind, PipelineStatus, RcaLayer, TrustState } from "@/api/observe";

export type Tone = "ok" | "warn" | "bad" | "info" | "muted" | "brand";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-400/40 bg-emerald-500/10 text-emerald-500",
  warn: "border-amber-400/40 bg-amber-500/10 text-amber-500",
  bad: "border-red-400/40 bg-red-500/10 text-red-500",
  info: "border-sky-400/40 bg-sky-500/10 text-sky-500",
  muted: "border-ink-500 bg-ink-200 text-paper-muted",
  brand: "border-brand/40 bg-brand/10 text-brand",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  bad: "text-red-500",
  info: "text-sky-500",
  muted: "text-paper-muted",
  brand: "text-brand",
};

export const TRUST_TONE: Record<TrustState, Tone> = {
  trusted: "ok",
  degraded: "warn",
  stale: "bad",
  learning: "info",
  unknown: "muted",
};

export const PIPELINE_STATUS: Record<PipelineStatus, { label: string; tone: Tone; description: string }> = {
  healthy: { label: "Healthy", tone: "ok", description: "Progressing within its learned cadence" },
  lagging: { label: "Lagging", tone: "warn", description: "Behind its source, still progressing" },
  stalled: { label: "Stalled", tone: "bad", description: "No progress and no visible error" },
  retrying: { label: "Retrying", tone: "bad", description: "Repeating the same work without committing" },
  failing: { label: "Failing", tone: "bad", description: "Errors on every attempt" },
  stopped: { label: "Stopped", tone: "warn", description: "No success within its expected cadence" },
  inefficient: { label: "Inefficient", tone: "warn", description: "Healthy but creating merge pressure" },
  paused: { label: "Paused", tone: "muted", description: "Switched off on purpose (disabled job, stopped view); not expected to run" },
  unsupported_on_version: { label: "Not on this version", tone: "muted", description: "The server version does not expose this source" },
};

export const PIPELINE_KIND_LABEL: Record<PipelineKind, string> = {
  materialized_view: "Materialized view",
  refreshable_view: "Refreshable view",
  queue_engine: "Queue engine",
  object_storage_queue: "Object storage queue",
  database_replication: "Database replication",
  distributed: "Distributed insert",
  dictionary: "Dictionary",
  async_insert: "Async insert",
  writer: "Writer",
  external_table: "External table",
  scheduled_job: "Scheduled job",
};

export const LAYER_LABEL: Record<RcaLayer, string> = {
  data: "Data",
  transform: "Transform",
  ingestion: "Ingestion",
  external: "External",
  engine: "Engine",
};

export const CRITICALITY_ORDER: Criticality[] = ["critical", "important", "standard"];

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  let n = Math.abs(value);
  let unit = 0;
  while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  const sign = value < 0 ? "−" : "";
  return `${sign}${n >= 100 || unit === 0 ? Math.round(n) : n.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`;
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** "3m ago" relative to `now` (ms). */
export function formatAgo(at: number | null | undefined, now: number = Date.now()): string {
  if (!at) return "never";
  const delta = (now - at) / 1000;
  if (delta < 0) return `in ${formatDuration(-delta)}`;
  if (delta < 45) return "just now";
  return `${formatDuration(delta)} ago`;
}

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** `table:db.t` → `db.t`; `kafka_topic:orders` → `orders`. */
export function nodeLabel(nodeId: string | null | undefined): string {
  if (!nodeId) return "—";
  const colon = nodeId.indexOf(":");
  return colon >= 0 ? nodeId.slice(colon + 1) : nodeId;
}

export function nodeKind(nodeId: string | null | undefined): string {
  if (!nodeId) return "";
  const colon = nodeId.indexOf(":");
  return colon >= 0 ? nodeId.slice(0, colon) : "";
}

export function humanize(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function severityTone(severity: string): Tone {
  return severity === "critical" ? "bad" : severity === "warning" ? "warn" : "info";
}

/** Percent change of `current` against `baseline`; null when the baseline is empty. */
export function relativeChange(current: number, baseline: number | null | undefined): number | null {
  if (!baseline) return null;
  return (current - baseline) / baseline;
}

export interface ColumnDrift {
  column: string;
  metric: "p50" | "p95" | "null ratio" | "distinct";
  baseline: number | null;
  current: number | null;
  /** current / baseline for p50/p95/distinct; absolute change for the null ratio. */
  change: number | null;
  drifted: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type ProfilePoint = { at: number; nullRatio: number | null; distinct: number | null; p50: number | null; p95: number | null };

/**
 * Latest column profile against the median of the earlier ones (sampled
 * aggregates, 14 days). A numeric statistic drifts when it moves more than
 * `tolerance`× either way; the null ratio drifts on a 5-point absolute change.
 */
export function columnDrift(drift: Record<string, ProfilePoint[]>, tolerance = 3): ColumnDrift[] {
  const out: ColumnDrift[] = [];
  for (const [column, raw] of Object.entries(drift)) {
    const points = [...raw].sort((a, b) => a.at - b.at);
    if (points.length === 0) continue;
    const latest = points[points.length - 1];
    const history = points.slice(0, -1);
    const pick = (key: "p50" | "p95" | "distinct"): void => {
      const current = latest[key];
      if (current === null) return;
      const baseline = median(history.map((p) => p[key]).filter((v): v is number => v !== null));
      const change = baseline ? current / baseline : null;
      out.push({ column, metric: key, baseline, current, change, drifted: change !== null && (change > tolerance || change < 1 / tolerance) });
    };
    pick("p50");
    pick("p95");
    if (latest.nullRatio !== null) {
      const baseline = median(history.map((p) => p.nullRatio).filter((v): v is number => v !== null));
      const change = baseline === null ? null : latest.nullRatio - baseline;
      out.push({ column, metric: "null ratio", baseline, current: latest.nullRatio, change, drifted: change !== null && Math.abs(change) >= 0.05 });
    }
    pick("distinct");
  }
  return out.sort((a, b) => Number(b.drifted) - Number(a.drifted) || a.column.localeCompare(b.column));
}

function isTrustState(state: string): state is TrustState {
  return Object.prototype.hasOwnProperty.call(TRUST_TONE, state);
}

/** Tone of a trust state that arrives untyped (context health, lineage nodes). */
export function trustTone(state: string | null | undefined): Tone {
  return state && isTrustState(state) ? TRUST_TONE[state] : "muted";
}
