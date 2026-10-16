/**
 * Display helpers for AI Governance › AI activity (ADR 0020).
 */

import { formatProviderType, PROVIDER_TYPES, type ProviderType } from "@/constants/aiProviders";
import type { AiRequestStatus, AiStepStatus, AiUsageRequest } from "@/api/aiUsage";

/** The windows the tab offers; the server clamps to its retention. */
export const USAGE_WINDOWS = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

/** USD, or "–" when unknown (no price). Never shows a priced, non-zero cost as $0.00. */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
}

/** 950 · 22.9k · 3.2M tokens. */
export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value));
}

/** A request's token total; "≥" when some call reported no usage, so the count is a lower bound. */
export function requestTokens(request: Pick<AiUsageRequest, "inputTokens" | "outputTokens" | "incompleteCalls">): string {
  const total = formatTokens(request.inputTokens + request.outputTokens);
  return request.incompleteCalls > 0 ? `≥ ${total}` : total;
}

/** A request's cost: "–" when nothing was priced; "≥" when only part of it was. */
export function requestCost(request: Pick<AiUsageRequest, "costUsd" | "unpricedCalls" | "incompleteCalls">): string {
  if (request.costUsd === null) return "–";
  const partial = request.unpricedCalls > 0 || request.incompleteCalls > 0;
  return partial ? `≥ ${formatUsd(request.costUsd)}` : formatUsd(request.costUsd);
}

function isProviderType(value: string): value is ProviderType {
  return (PROVIDER_TYPES as readonly string[]).includes(value);
}

export function providerLabel(type: string | null | undefined): string {
  if (!type) return "Unknown provider";
  return isProviderType(type) ? formatProviderType(type) : type;
}

/** `optimize-query` → "Optimize query"; `chat` → "Chat". */
export function featureLabel(featureId: string): string {
  const words = featureId.replace(/[-_]+/g, " ").trim();
  if (!words) return "AI feature";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const SOURCE_LABEL = { chat: "Chat", feature: "Feature", background: "Background" } as const;

/** "1 row", "3 rows". */
export function plural(n: number, word: string, formatted: string = String(n)): string {
  return `${formatted} ${word}${n === 1 ? "" : "s"}`;
}

/** Where a request came from: "Chat", or "Feature · Optimize query" (the feature only when it adds something). */
export function requestOrigin(source: keyof typeof SOURCE_LABEL | string, featureId: string): string {
  const label = source in SOURCE_LABEL ? SOURCE_LABEL[source as keyof typeof SOURCE_LABEL] : source;
  const feature = featureLabel(featureId);
  return feature === label ? label : `${label} · ${feature}`;
}

export const REQUEST_STATUS: Record<AiRequestStatus, { label: string; tone: "ok" | "warn" | "bad" }> = {
  ok: { label: "OK", tone: "ok" },
  timeout: { label: "Timed out", tone: "warn" },
  error: { label: "Error", tone: "bad" },
};

export const STEP_STATUS: Record<AiStepStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  ok: { label: "OK", tone: "ok" },
  incomplete: { label: "No usage reported", tone: "warn" },
  duplicate: { label: "Repeat skipped", tone: "muted" },
  error: { label: "Error", tone: "bad" },
};

const LOGS_MARGIN_HOURS = 0.25;

/** Query logs filtered to one query, opened on a window around when it ran. */
export function queryLogsLink(queryId: string, ranAt: number): string {
  const params = new URLSearchParams({ q: queryId, at: String(Math.round(ranAt)) });
  return `/monitoring/logs?${params.toString()}`;
}

/**
 * The "last N hours" window Query logs opens for an `at` deep link: the
 * smallest whole number of hours that still covers when the query ran, plus a
 * margin. A relative window is evaluated by ClickHouse against its own clock,
 * so it holds when the browser and the server are in different time zones
 * (a custom from/to range would be read in the server's zone). Null when `at`
 * is not a valid past time.
 */
export function logsHoursCovering(at: string | null, now: number = Date.now()): number | null {
  if (!at) return null;
  const ms = Number(at);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const ageHours = Math.max(0, now - ms) / 3_600_000;
  return Math.max(1, Math.ceil(ageHours + LOGS_MARGIN_HOURS));
}

/** Share of input tokens served from cache, as a whole percent; null with no input. */
export function cachedShare(inputTokens: number, cacheReadTokens: number): number | null {
  if (inputTokens <= 0) return null;
  return Math.round((cacheReadTokens / inputTokens) * 100);
}
