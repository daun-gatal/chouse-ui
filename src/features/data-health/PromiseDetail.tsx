import { toast } from "sonner";
import { ArrowLeft, BookOpen, Clock, Pencil, Play, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { useDataHealthPromise, useDataHealthTimeline, useRunDataHealthPromise } from "./hooks";
import { DH_LABEL, DH_PRIMARY, HealthBadge, formatHealthTime, formatMetric } from "./lib";

export function PromiseDetail({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: () => void }) {
  const promiseQuery = useDataHealthPromise(id);
  const timelineQuery = useDataHealthTimeline(id);
  const runMutation = useRunDataHealthPromise();
  const canRun = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_RUN));
  const canEdit = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT));
  const promise = promiseQuery.data;
  if (promiseQuery.isLoading || !promise) return <div className="space-y-3"><Skeleton className="h-16 rounded-xs" /><Skeleton className="h-80 rounded-xs" /></div>;

  const latestByCheck = new Map<string, NonNullable<typeof timelineQuery.data>["samples"][number]>();
  for (const sample of timelineQuery.data?.samples ?? []) if (!latestByCheck.has(sample.checkKey)) latestByCheck.set(sample.checkKey, sample);
  const runNow = async () => {
    try {
      const run = await runMutation.mutateAsync(id);
      toast[run?.status === "success" ? "success" : "error"](run?.status === "success" ? "Evaluation completed" : run?.message ?? "Evaluation failed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Evaluation failed"); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-0.5" onClick={onBack} aria-label="Back to datasets"><ArrowLeft className="h-4 w-4" /></Button>
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-[18px] font-semibold text-paper">{promise.name}</h2><HealthBadge state={promise.status} /><span className="font-mono text-[9px] uppercase text-paper-faint">{promise.criticality}</span></div><p className="mt-1 font-mono text-[11px] text-paper-muted">{promise.databaseName && promise.tableName ? `${promise.databaseName}.${promise.tableName}` : "Custom query dataset"}</p>{promise.description && <p className="mt-2 max-w-2xl text-[12px] text-paper-muted">{promise.description}</p>}</div>
        </div>
        <div className="flex gap-2">{canEdit && <Button variant="outline" className="h-9 rounded-xs" onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit promise</Button>}{canRun && <Button className={DH_PRIMARY} onClick={() => void runNow()} disabled={runMutation.isPending}><Play className="h-3.5 w-3.5" /> Evaluate now</Button>}</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Last evaluated</p><p className="mt-2 text-[12px] text-paper">{formatHealthTime(promise.lastEvaluatedAt)}</p></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Last healthy</p><p className="mt-2 text-[12px] text-paper">{formatHealthTime(promise.lastHealthyAt)}</p></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Schedule</p><p className="mt-2 text-[12px] text-paper">{promise.schedule.frequency === "manual" ? "Manual" : `${promise.schedule.frequency} · ${String(promise.schedule.hour).padStart(2, "0")}:00 ${promise.timezone}`}</p></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Owner</p><p className="mt-2 truncate text-[12px] text-paper">{promise.ownerDisplayName ?? (promise.ownerId ? "Unknown user" : "Unassigned")}</p></Card>
      </div>

      <section><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" /><h3 className={DH_LABEL}>Promise checks</h3></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{promise.checks.map((check) => { const sample = latestByCheck.get(check.checkKey); return <Card key={check.checkKey} className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-medium text-paper">{check.name}</p><p className="mt-0.5 font-mono text-[9px] uppercase text-paper-faint">{check.type.replace("_", " ")} · {check.severity}</p></div>{sample ? <HealthBadge state={sample.outcome} /> : <HealthBadge state="not_evaluated" />}</div><div className="mt-4 flex items-end justify-between"><div><p className={DH_LABEL}>Observed</p><p className="mt-1 text-xl font-semibold tabular-nums text-paper">{formatMetric(sample?.observedValue ?? null, check.type)}</p></div><p className="text-right font-mono text-[10px] text-paper-muted">{sample ? `${formatMetric(sample.expectedLower, check.type)} – ${formatMetric(sample.expectedUpper, check.type)}` : "No sample"}</p></div></Card>; })}</div></section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-center gap-2"><Clock className="h-4 w-4 text-paper-muted" /><p className={DH_LABEL}>Recent evaluations</p></div><div className="mt-3 divide-y divide-ink-500">{(timelineQuery.data?.runs ?? []).slice(0, 8).map((run) => <div key={run.id} className="flex items-center justify-between gap-3 py-2"><div><p className="font-mono text-[10px] text-paper">{formatHealthTime(run.startedAt)}</p><p className="mt-0.5 text-[10px] text-paper-faint">{run.trigger} · {run.durationMs ?? "—"}ms</p></div><div className="text-right"><span className={`font-mono text-[10px] uppercase ${run.status === "success" ? "text-emerald-500" : "text-red-500"}`}>{run.status}</span>{run.conditionValue && <p className="text-[9px] text-paper-faint">data: {run.conditionValue}</p>}</div></div>)}{(timelineQuery.data?.runs.length ?? 0) === 0 && <p className="py-8 text-center text-[12px] text-paper-muted">No evaluations yet.</p>}</div></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-center justify-between"><p className={DH_LABEL}>Operational context</p>{promise.runbookUrl && <a href={promise.runbookUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"><BookOpen className="h-3.5 w-3.5" /> Open runbook</a>}</div><dl className="mt-4 space-y-3 text-[11px]"><div><dt className="text-paper-faint">Timezone</dt><dd className="mt-0.5 text-paper">{promise.timezone}</dd></div><div><dt className="text-paper-faint">Alert policy</dt><dd className="mt-0.5 text-paper">Open after {promise.breachAfter} breach(es), recover after {promise.recoverAfter} pass(es)</dd></div><div><dt className="text-paper-faint">Notification destinations</dt><dd className="mt-0.5 text-paper">{promise.channelIds.length || "None"}</dd></div><div><dt className="text-paper-faint">Retention</dt><dd className="mt-0.5 text-paper">{promise.retentionDays} days</dd></div></dl></Card>
      </div>
    </div>
  );
}
