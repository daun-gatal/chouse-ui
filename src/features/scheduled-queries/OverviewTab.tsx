/**
 * Scheduled Queries → Overview: a real summary of the feature — health KPIs,
 * cadence / output-mode / last-run breakdowns, what runs next, and the top
 * failing jobs. Read-only aggregation over existing tables (GET /overview).
 */

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useScheduledQueriesOverview } from "./hooks";
import { formatRelative, formatDuration, SQ_LABEL } from "./lib";

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <Card className="rounded-xs border-ink-500 bg-ink-100 p-4">
      <p className={SQ_LABEL}>{label}</p>
      <p className={cn("mt-1 text-[24px] font-semibold tabular-nums leading-none", tone ?? "text-paper")}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-paper-muted">{sub}</p>}
    </Card>
  );
}

function Breakdown({ title, entries }: { title: string; entries: Array<[string, number]> }) {
  // Bars are filled as a share of the TOTAL (so they sum to 100%), not relative
  // to the largest bucket — otherwise the biggest type always looks "full".
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const shown = entries.filter(([, n]) => n > 0);
  return (
    <Card className="rounded-xs border-ink-500 bg-ink-100 p-4">
      <div className="flex items-baseline justify-between">
        <p className={SQ_LABEL}>{title}</p>
        <span className="font-mono text-[10px] text-paper-faint">{total} total</span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-[12px] text-paper-muted">—</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map(([k, n]) => (
            <li key={k} className="flex items-center gap-3">
              <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-paper-muted">{k}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-xs bg-ink-300">
                <span className="block h-full bg-brand/70" style={{ width: `${total > 0 ? (n / total) * 100 : 0}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-[12px] tabular-nums text-paper">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OverviewTab({ onSelectJob }: { onSelectJob: (id: string) => void }) {
  const { data, isLoading } = useScheduledQueriesOverview(14);

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xs" />)}
      </div>
    );
  }

  const k = data.kpis;

  return (
    <div className="space-y-6">
      {/* Health KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total jobs" value={k.totalJobs} sub={`${k.enabledJobs} enabled · ${k.disabledJobs} disabled`} />
        <Kpi label="Failing" value={k.failing} tone={k.failing > 0 ? "text-red-600" : "text-paper"} sub={`${k.healthy} healthy · ${k.neverRun} never run`} />
        <Kpi label="Success rate (14d)" value={`${k.successRateWindow}%`} tone={k.successRateWindow >= 95 ? "text-emerald-600" : k.successRateWindow >= 80 ? "text-amber-600" : "text-red-600"} sub={`${k.runsWindow} runs`} />
        <Kpi label="Runs (24h)" value={k.runsLast24h} sub={`avg ${formatDuration(k.avgDurationMs)}`} />
      </div>

      {/* Secondary summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Materialize jobs" value={k.materializeJobs} sub="write back to ClickHouse" />
        <Kpi label="With failure alerts" value={k.alertingJobs} sub="linked to channels" />
        <Kpi label="Read-only jobs" value={k.totalJobs - k.materializeJobs} />
        <Kpi label="Running now" value={data.byLastStatus.running} tone={data.byLastStatus.running > 0 ? "text-brand" : "text-paper"} />
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Breakdown title="By cadence" entries={Object.entries(data.byCadence)} />
        <Breakdown title="By output mode" entries={Object.entries(data.byOutputMode)} />
        <Breakdown
          title="By last run"
          entries={[
            ["healthy", data.byLastStatus.success],
            ["failing", data.byLastStatus.failing],
            ["running", data.byLastStatus.running],
            ["never", data.byLastStatus.never],
          ]}
        />
      </div>

      {/* Upcoming + Top failing — fixed equal height, scroll internally. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="flex h-72 flex-col rounded-xs border-ink-500 bg-ink-100 p-4">
          <p className={SQ_LABEL}>Upcoming runs</p>
          {data.upcoming.length === 0 ? (
            <p className="mt-3 text-[12px] text-paper-muted">Nothing scheduled.</p>
          ) : (
            <ul className="mt-2 min-h-0 flex-1 divide-y divide-ink-500 overflow-y-auto">
              {data.upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between py-2">
                  <button type="button" onClick={() => onSelectJob(u.id)} className="truncate text-left text-[12px] text-paper hover:underline">{u.name}</button>
                  <span className="shrink-0 font-mono text-[11px] text-paper-muted">{formatRelative(u.nextRunAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex h-72 flex-col rounded-xs border-ink-500 bg-ink-100 p-4">
          <p className={SQ_LABEL}>Top failing jobs</p>
          {data.topFailing.length === 0 ? (
            <p className="mt-3 text-[12px] text-paper-muted">No failing jobs. 🎉</p>
          ) : (
            <ul className="mt-2 min-h-0 flex-1 divide-y divide-ink-500 overflow-y-auto">
              {data.topFailing.map((j) => (
                <li key={j.id} className="py-2">
                  <button type="button" onClick={() => onSelectJob(j.id)} className="flex w-full items-center justify-between text-left">
                    <span className="truncate text-[12px] text-paper">{j.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-red-600">{j.failureStreak} in a row</span>
                  </button>
                  {j.lastMessage && <p className="mt-0.5 truncate font-mono text-[10px] text-paper-faint">{j.lastMessage}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
