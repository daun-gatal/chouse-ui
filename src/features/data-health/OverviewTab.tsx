import { AlertTriangle, CheckCircle2, CircleHelp, PauseCircle, Siren } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDataHealthOverview } from "./hooks";
import { DH_LABEL, HealthBadge, formatHealthTime } from "./lib";

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ElementType; tone: string }) {
  return (
    <Card className="rounded-xs border-ink-500 bg-ink-100 p-4">
      <div className="flex items-center justify-between"><p className={DH_LABEL}>{label}</p><Icon className={`h-4 w-4 ${tone}`} /></div>
      <p className={`mt-2 text-[26px] font-semibold tabular-nums ${tone}`}>{value}</p>
    </Card>
  );
}

export function OverviewTab({ onSelectPromise }: { onSelectPromise: (id: string) => void }) {
  const { data, isLoading, isError } = useDataHealthOverview();
  if (isLoading) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-24 rounded-xs" />)}</div>;
  if (isError || !data) return <Card className="rounded-xs border-red-500/30 bg-red-500/5 p-6 text-[13px] text-red-500">Data Health overview could not be loaded.</Card>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Healthy" value={data.byStatus.healthy} icon={CheckCircle2} tone="text-emerald-500" />
        <Kpi label="Degraded" value={data.byStatus.degraded} icon={AlertTriangle} tone="text-amber-500" />
        <Kpi label="Unhealthy" value={data.byStatus.unhealthy} icon={Siren} tone="text-red-500" />
        <Kpi label="Unknown" value={data.byStatus.unknown} icon={CircleHelp} tone="text-sky-500" />
        <Kpi label="Paused" value={data.byStatus.paused} icon={PauseCircle} tone="text-paper-muted" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4">
          <div className="flex items-baseline justify-between"><p className={DH_LABEL}>Needs attention</p><span className="font-mono text-[10px] text-paper-faint">{data.needsAttention.length} shown</span></div>
          {data.needsAttention.length === 0 ? (
            <div className="grid min-h-44 place-items-center text-center"><div><CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" /><p className="mt-2 text-[13px] text-paper">All evaluated promises are healthy.</p></div></div>
          ) : (
            <div className="mt-3 divide-y divide-ink-500">
              {data.needsAttention.map((promise) => (
                <button key={promise.id} type="button" onClick={() => onSelectPromise(promise.id)} className="flex w-full items-center justify-between gap-4 py-3 text-left hover:bg-ink-200/50">
                  <div className="min-w-0"><p className="truncate text-[13px] font-medium text-paper">{promise.name}</p><p className="mt-0.5 font-mono text-[10px] text-paper-muted">{promise.databaseName && promise.tableName ? `${promise.databaseName}.${promise.tableName}` : "Query dataset"} · last checked {formatHealthTime(promise.lastEvaluatedAt)}</p></div>
                  <HealthBadge state={promise.status} />
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4">
          <p className={DH_LABEL}>Operational coverage</p>
          <dl className="mt-4 space-y-4">
            <div><dt className="text-[11px] text-paper-muted">Registered datasets</dt><dd className="mt-1 text-2xl font-semibold text-paper">{data.totalPromises}</dd></div>
            <div><dt className="text-[11px] text-paper-muted">Open incidents</dt><dd className="mt-1 text-2xl font-semibold text-red-500">{data.openIncidents}</dd></div>
            <div><dt className="text-[11px] text-paper-muted">Unowned critical datasets</dt><dd className="mt-1 text-2xl font-semibold text-amber-500">{data.unownedCritical}</dd></div>
          </dl>
        </Card>
      </div>
      {data.coverageGaps.length > 0 && <Card className="rounded-xs border-brand/25 bg-brand/[0.04] p-4"><div className="flex items-baseline justify-between"><p className={DH_LABEL}>Suggested coverage</p><span className="font-mono text-[9px] uppercase text-paper-faint">Scheduled outputs without a promise</span></div><div className="mt-3 grid gap-2 md:grid-cols-2">{data.coverageGaps.map((gap) => <div key={gap.jobId} className="rounded-xs border border-ink-500 bg-ink-100 p-3"><p className="text-[11px] font-medium text-paper">{gap.databaseName}.{gap.tableName}</p><p className="mt-1 text-[10px] text-paper-muted">Produced by {gap.jobName} · {gap.outputMode}</p><p className="mt-1 text-[10px] text-paper-faint">Protect this dataset from Datasets → New promise, then use AI Coverage Advisor.</p></div>)}</div></Card>}
    </div>
  );
}
