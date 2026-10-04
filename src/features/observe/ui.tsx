/**
 * Small presentational pieces shared by every Data Observability screen,
 * built from the same tokens and card anatomy as Data Health.
 */

import type { ElementType, ReactElement, ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DH_LABEL } from "@/features/data-health/lib";
import { TONE_CLASS, TONE_TEXT, type Tone } from "./lib";

export const OBS_LABEL = DH_LABEL;

export function StatusPill({ tone, children, dot = true, className }: { tone: Tone; children: ReactNode; dot?: boolean; className?: string }): ReactElement {
  return (
    <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap rounded-xs font-mono text-[9px] uppercase tracking-[0.12em]", TONE_CLASS[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </Badge>
  );
}

export function Kpi({ label, value, meta, tone, icon: Icon }: { label: string; value: ReactNode; meta?: ReactNode; tone?: Tone; icon?: ElementType }): ReactElement {
  return (
    <Card className="min-w-0 rounded-xs border-ink-500 bg-ink-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className={OBS_LABEL}>{label}</p>
        {Icon && <Icon className={cn("h-4 w-4", tone ? TONE_TEXT[tone] : "text-paper-faint")} aria-hidden />}
      </div>
      <p className={cn("mt-2 truncate text-[24px] font-semibold tabular-nums tracking-tight", tone ? TONE_TEXT[tone] : "text-paper")}>{value}</p>
      {meta !== undefined && <p className="mt-0.5 truncate text-[11px] text-paper-muted">{meta}</p>}
    </Card>
  );
}

export function Panel({ title, meta, actions, children, className, bodyClassName }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }): ReactElement {
  return (
    <Card className={cn("min-w-0 rounded-xs border-ink-500 bg-ink-100 p-4", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[13px] font-semibold text-paper">{title}</h2>
          {meta !== undefined && <span className="text-[11px] text-paper-muted">{meta}</span>}
        </div>
        {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}

export function EmptyState({ title, body, icon: Icon = Inbox, action }: { title: string; body?: ReactNode; icon?: ElementType; action?: ReactNode }): ReactElement {
  return (
    <div className="grid min-h-40 place-items-center px-4 py-8 text-center">
      <div className="max-w-md">
        <Icon className="mx-auto h-6 w-6 text-paper-faint" aria-hidden />
        <p className="mt-2 text-[13px] text-paper">{title}</p>
        {body !== undefined && <p className="mt-1 text-[11px] text-paper-muted">{body}</p>}
        {action !== undefined && <div className="mt-3 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ title, error }: { title: string; error?: unknown }): ReactElement {
  const message = error instanceof Error ? error.message : undefined;
  return (
    <Card role="alert" className="rounded-xs border-red-500/30 bg-red-500/5 p-6 text-[13px] text-red-500">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p>{title}</p>
          {message && <p className="mt-1 text-[11px] text-red-500/80">{message}</p>}
        </div>
      </div>
    </Card>
  );
}

export function LoadingGrid({ count = 4, className }: { count?: number; className?: string }): ReactElement {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)} aria-busy="true">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className="h-24 rounded-xs" />)}
    </div>
  );
}

/** Inline sparkline; uses currentColor so the caller's text tone colors it. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }): ReactElement {
  const w = 96;
  const h = 24;
  if (values.length < 2) return <span className={cn("inline-block h-6 w-24 text-paper-faint", className)} aria-label={label ?? "No samples"}>—</span>;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={cn("text-paper-muted", className)} role="img" aria-label={label ?? "Trend"}>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}

/** A horizontal ratio bar (coverage, usage shares). */
export function RatioBar({ ratio, tone = "brand", label }: { ratio: number; tone?: Tone; label: string }): ReactElement {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="h-2 w-full overflow-hidden rounded-xs bg-ink-300" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className={cn("h-full", tone === "brand" ? "bg-brand" : tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-red-500" : "bg-paper-faint")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <span className={cn("font-mono text-[11px]", className)}>{children}</span>;
}

/** Table scaffold matching the existing data-health tables. */
export function DataTable({ head, children, label }: { head: string[]; children: ReactNode; label: string }): ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]" aria-label={label}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap border-b border-ink-500 px-2.5 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-paper-faint">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-ink-500/60 [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-middle">{children}</tbody>
      </table>
    </div>
  );
}
