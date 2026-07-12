import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, Clock, Pencil, Play, ShieldCheck, Sparkles, SlidersHorizontal, Network, FlaskConical, Search } from "lucide-react";

import { backtestDataHealthPromise, diagnoseDataHealthCheck, type DataHealthBacktestResult, type DataHealthDiagnosticResult } from "@/api/dataHealth";
import { correlateHealthIncidents, diagnoseHealthIncident, tuneHealthPromise, type DataOpsInvestigation, type HealthIncidentCorrelation, type HealthPromiseTuning } from "@/api/dataOpsAi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AiInsightDialog, CorrelationView, InvestigationView, OperationalBriefCard, TuningView } from "@/features/dataops-ai";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { useDataHealthPromise, useDataHealthTimeline, useRunDataHealthPromise } from "./hooks";
import { DH_LABEL, DH_PRIMARY, HealthBadge, formatHealthTime, formatMetric, formatSchedule, isDateOnlyColumnType } from "./lib";

export function PromiseDetail({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: () => void }) {
  const promiseQuery = useDataHealthPromise(id);
  const timelineQuery = useDataHealthTimeline(id);
  const runMutation = useRunDataHealthPromise();
  const canRun = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_RUN));
  const canEdit = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT));
  const canUseAi = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE));
  const promise = promiseQuery.data;
  const [dialog, setDialog] = useState<"investigate" | "tune" | "correlate" | "backtest" | "diagnostic" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [investigation, setInvestigation] = useState<DataOpsInvestigation>();
  const [tuning, setTuning] = useState<HealthPromiseTuning>();
  const [correlation, setCorrelation] = useState<HealthIncidentCorrelation>();
  const [backtest, setBacktest] = useState<DataHealthBacktestResult>();
  const [diagnostic, setDiagnostic] = useState<DataHealthDiagnosticResult>();
  if (promiseQuery.isLoading || !promise) return <div className="space-y-3"><Skeleton className="h-16 rounded-xs" /><Skeleton className="h-80 rounded-xs" /></div>;

  const latestByCheck = new Map<string, NonNullable<typeof timelineQuery.data>["samples"][number]>();
  for (const sample of timelineQuery.data?.samples ?? []) if (!latestByCheck.has(sample.checkKey)) latestByCheck.set(sample.checkKey, sample);
  const runNow = async () => {
    try {
      const run = await runMutation.mutateAsync(id);
      toast[run?.status === "success" ? "success" : "error"](run?.status === "success" ? "Evaluation completed" : run?.message ?? "Evaluation failed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Evaluation failed"); }
  };

  const runInsight = async (kind: "investigate" | "tune" | "correlate" | "backtest") => {
    setDialog(kind);
    setLoading(true);
    setError(undefined);
    try {
      if (kind === "investigate") {
        const activeIncident = timelineQuery.data?.incidents.find((incident) => incident.status !== "recovered");
        setInvestigation(await diagnoseHealthIncident(id, activeIncident?.id));
      } else if (kind === "tune") {
        setTuning(await tuneHealthPromise(id));
      } else if (kind === "correlate") {
        setCorrelation(await correlateHealthIncidents(id));
      } else {
        setBacktest(await backtestDataHealthPromise(id, 14));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data Health analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const inspectCheck = async (checkKey: string, slotAt?: number) => {
    setDialog("diagnostic");
    setLoading(true);
    setError(undefined);
    try {
      setDiagnostic(await diagnoseDataHealthCheck(id, checkKey, slotAt));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Diagnostic query failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-0.5" onClick={onBack} aria-label="Back to datasets"><ArrowLeft className="h-4 w-4" /></Button>
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-[18px] font-semibold text-paper">{promise.name}</h2><HealthBadge state={promise.status} /><span className="font-mono text-[9px] uppercase text-paper-faint">{promise.criticality}</span></div><p className="mt-1 font-mono text-[11px] text-paper-muted">{promise.databaseName && promise.tableName ? `${promise.databaseName}.${promise.tableName}` : "Custom query dataset"}</p>{promise.description && <p className="mt-2 max-w-2xl text-[12px] text-paper-muted">{promise.description}</p>}</div>
        </div>
        <div className="flex flex-wrap gap-2">{canUseAi && <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runInsight("investigate")}><Sparkles className="mr-2 h-3.5 w-3.5" /> Investigate</Button>}{canUseAi && <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runInsight("tune")}><SlidersHorizontal className="mr-2 h-3.5 w-3.5" /> Tune</Button>}{canUseAi && <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runInsight("correlate")}><Network className="mr-2 h-3.5 w-3.5" /> Correlate</Button>}{canRun && <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runInsight("backtest")}><FlaskConical className="mr-2 h-3.5 w-3.5" /> Backtest</Button>}{canEdit && <Button variant="outline" className="h-9 rounded-xs" onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit promise</Button>}{canRun && <Button className={DH_PRIMARY} onClick={() => void runNow()} disabled={runMutation.isPending}><Play className="h-3.5 w-3.5" /> Evaluate now</Button>}</div>
      </div>

      <OperationalBriefCard kind="data-health" id={id} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Last evaluated</p><p className="mt-2 text-[12px] text-paper">{formatHealthTime(promise.lastEvaluatedAt)}</p></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Last healthy</p><p className="mt-2 text-[12px] text-paper">{formatHealthTime(promise.lastHealthyAt)}</p></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Schedule</p><p className="mt-2 text-[12px] text-paper">{formatSchedule(promise.schedule, promise.timezone)}</p></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Owner</p><p className="mt-2 truncate text-[12px] text-paper">{promise.ownerDisplayName ?? (promise.ownerId ? "Unknown user" : "Unassigned")}</p></Card>
      </div>
      {promise.eventTimeColumn && (promise.eventTimeEncoding !== "native" || isDateOnlyColumnType(promise.eventTimeType)) && <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Event-time source format</p><p className="mt-2 font-mono text-[11px] text-paper">{promise.eventTimeColumn} · {promise.eventTimeEncoding.replaceAll("_", " ")}{promise.eventTimeEncoding === "string" || isDateOnlyColumnType(promise.eventTimeType) ? ` · ${promise.eventTimeTimezone ?? "timezone missing"}` : ""}</p><p className="mt-1 text-[10px] text-paper-muted">{isDateOnlyColumnType(promise.eventTimeType) ? "UTC slot boundaries are mapped to calendar dates in the saved timezone." : "The source value is converted to an instant before comparison with UTC evaluation slots."}</p></Card>}
      <section><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" /><h3 className={DH_LABEL}>Promise checks</h3></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{promise.checks.map((check) => { const sample = latestByCheck.get(check.checkKey); const diagnosable = ["freshness", "completeness", "uniqueness", "validity"].includes(check.type); return <Card key={check.checkKey} className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-medium text-paper">{check.name}</p><p className="mt-0.5 font-mono text-[9px] uppercase text-paper-faint">{check.type.replace("_", " ")} · {check.severity}</p></div>{sample ? <HealthBadge state={sample.outcome} /> : <HealthBadge state="not_evaluated" />}</div><div className="mt-4 flex items-end justify-between"><div><p className={DH_LABEL}>Observed</p><p className="mt-1 text-xl font-semibold tabular-nums text-paper">{formatMetric(sample?.observedValue ?? null, check.type)}</p></div><p className="text-right font-mono text-[10px] text-paper-muted">{sample ? `${formatMetric(sample.expectedLower, check.type)} – ${formatMetric(sample.expectedUpper, check.type)}` : "No sample"}</p></div>{diagnosable && <Button variant="ghost" size="sm" className="mt-3 h-7 rounded-xs" onClick={() => void inspectCheck(check.checkKey, sample?.slotAt)}><Search className="mr-1.5 h-3 w-3" /> Inspect evidence</Button>}</Card>; })}</div></section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-center gap-2"><Clock className="h-4 w-4 text-paper-muted" /><p className={DH_LABEL}>Recent evaluations</p></div><div className="mt-3 divide-y divide-ink-500">{(timelineQuery.data?.runs ?? []).slice(0, 8).map((run) => <div key={run.id} className="flex items-center justify-between gap-3 py-2"><div><p className="font-mono text-[10px] text-paper">{formatHealthTime(run.startedAt)}</p><p className="mt-0.5 text-[10px] text-paper-faint">{run.trigger} · {run.durationMs ?? "—"}ms</p></div><div className="text-right"><span className={`font-mono text-[10px] uppercase ${run.status === "success" ? "text-emerald-500" : "text-red-500"}`}>{run.status}</span>{run.conditionValue && <p className="text-[9px] text-paper-faint">data: {run.conditionValue}</p>}</div></div>)}{(timelineQuery.data?.runs.length ?? 0) === 0 && <p className="py-8 text-center text-[12px] text-paper-muted">No evaluations yet.</p>}</div></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-center justify-between"><p className={DH_LABEL}>Operational context</p>{promise.runbookUrl && <a href={promise.runbookUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"><BookOpen className="h-3.5 w-3.5" /> Open runbook</a>}</div><dl className="mt-4 space-y-3 text-[11px]"><div><dt className="text-paper-faint">Evaluation timezone</dt><dd className="mt-0.5 text-paper">UTC</dd></div><div><dt className="text-paper-faint">Alert policy</dt><dd className="mt-0.5 text-paper">Open after {promise.breachAfter} breach(es), recover after {promise.recoverAfter} pass(es)</dd></div><div><dt className="text-paper-faint">Notification destinations</dt><dd className="mt-0.5 text-paper">{promise.channelIds.length || "None"}</dd></div><div><dt className="text-paper-faint">Retention</dt><dd className="mt-0.5 text-paper">{promise.retentionDays} days</dd></div></dl></Card>
      </div>
      {(timelineQuery.data?.events.length ?? 0) > 0 && <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Incident timeline</p><div className="mt-3 divide-y divide-ink-500">{timelineQuery.data?.events.slice(0, 12).map((event) => <div key={event.id} className="flex items-center justify-between gap-3 py-2"><div><p className="text-[11px] capitalize text-paper">{event.type.replace("_", " ")}</p><p className="mt-0.5 font-mono text-[9px] text-paper-faint">incident {event.incidentId.slice(0, 8)}{event.runId ? ` · run ${event.runId.slice(0, 8)}` : ""}</p></div><p className="font-mono text-[10px] text-paper-muted">{formatHealthTime(event.createdAt)}</p></div>)}</div></Card>}

      <AiInsightDialog open={dialog === "investigate"} onOpenChange={(open) => !open && setDialog(null)} title="Data Health incident investigation" description="Separates monitoring failures from unhealthy data and ranks evidence-backed causes." loading={loading} error={error}>{investigation && <InvestigationView result={investigation} />}</AiInsightDialog>
      <AiInsightDialog open={dialog === "tune"} onOpenChange={(open) => !open && setDialog(null)} title="Promise noise tuning" description="Recommendations are advisory and never change the promise automatically." loading={loading} error={error}>{tuning && <TuningView result={tuning} />}</AiInsightDialog>
      <AiInsightDialog open={dialog === "correlate"} onOpenChange={(open) => !open && setDialog(null)} title="Related incident analysis" description="Looks for credible shared timing and execution evidence across visible datasets." loading={loading} error={error}>{correlation && <CorrelationView result={correlation} />}</AiInsightDialog>
      <AiInsightDialog open={dialog === "backtest"} onOpenChange={(open) => !open && setDialog(null)} title="Historical promise backtest" description="Replays metric checks over up to 14 bounded historical windows without opening incidents; structural checks are reported as unknown." loading={loading} error={error}>{backtest && <div className="space-y-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Object.entries(backtest.summary).map(([key, value]) => <div key={key} className="rounded-xs border border-ink-500 p-2"><p className="font-mono text-[9px] uppercase text-paper-faint">{key}</p><p className="mt-1 text-[13px] text-paper">{value}</p></div>)}</div><div className="space-y-1">{backtest.slots.map((slot) => <div key={slot.slotAt} className="flex items-center justify-between rounded-xs border border-ink-500 px-3 py-2"><span className="font-mono text-[10px] text-paper-muted">{new Date(slot.slotAt).toLocaleString()}</span><HealthBadge state={slot.state} /></div>)}</div></div>}</AiInsightDialog>
      <AiInsightDialog open={dialog === "diagnostic"} onOpenChange={(open) => !open && setDialog(null)} title="Bounded check evidence" description="Rows are queried live under your current access, limited to 50, and are not persisted in the AI result." loading={loading} error={error}>{diagnostic && (diagnostic.supported ? diagnostic.rows.length > 0 ? <div className="overflow-x-auto rounded-xs border border-ink-500"><table className="w-full text-left text-[10px]"><thead><tr>{diagnostic.columns.map((column) => <th key={column.name} className="px-2 py-2 font-mono uppercase text-paper-faint">{column.name}</th>)}</tr></thead><tbody>{diagnostic.rows.map((row, index) => <tr key={index} className="border-t border-ink-500">{diagnostic.columns.map((column) => <td key={column.name} className="max-w-64 truncate px-2 py-2 text-paper">{String(row[column.name] ?? "")}</td>)}</tr>)}</tbody></table></div> : <p className="text-[11px] text-paper-muted">No row-level evidence was found in this evaluation window ({formatHealthTime(diagnostic.slotStart)} – {formatHealthTime(diagnostic.slotEnd)}). Completeness, uniqueness, and validity diagnostics only return violating rows; freshness returns recent rows.</p> : <p className="text-[11px] text-paper-muted">This aggregate check has no meaningful row-level diagnostic. Use its metric history and incident investigation instead.</p>)}</AiInsightDialog>
    </div>
  );
}
