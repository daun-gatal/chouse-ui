import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DataHealthCheck, DataHealthOutcome, DataHealthState } from "@/api/dataHealth";

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
