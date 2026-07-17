import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, Clock, Pencil, Play, RotateCcw, ShieldCheck, Sparkles, SlidersHorizontal, Network, FlaskConical, Search } from "lucide-react";

import { backtestDataHealthPromise, diagnoseDataHealthCheck, recoverDataHealthPromise, rerunDataHealthRun, type DataHealthBacktestResult, type DataHealthDiagnosticResult, type DataHealthRecoveryResult, type DataHealthRun, type DataHealthState } from "@/api/dataHealth";
import { correlateHealthIncidents, diagnoseHealthIncident, tuneHealthPromise, type DataOpsInvestigation, type HealthIncidentCorrelation, type HealthPromiseTuning } from "@/api/dataOpsAi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AiInsightDialog, CorrelationView, InvestigationView, OperationalBriefCard, TuningView } from "@/features/dataops-ai";
import { useDataOpsModelId } from "@/hooks";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { useDataHealthPromise, useDataHealthTimeline, useRunDataHealthPromise } from "./hooks";
import { DH_LABEL, DH_PRIMARY, HealthBadge, formatHealthTime, formatMetric, formatSchedule, isDateOnlyColumnType } from "./lib";

function isHealthState(value: string): value is DataHealthState {
  return ["healthy", "degraded", "unhealthy", "unknown", "paused"].includes(value);
}

interface HealthRunSnapshot {
  columns?: Array<{ name: string; type: string }>;
  rows?: Array<Record<string, unknown>>;
  window?: Record<string, string>;
}

/** "2026-07-17 12:25:00.000" → "2026-07-17 12:25:00". */
function trimWindowValue(value: string): string {
  return value.replace(/\.\d{3}$/, "");
}

/** Compact one-line window: repeats the date on the end only when it differs. */
function formatWindowRange(start: string, end: string): string {
  const from = trimWindowValue(start);
  const to = trimWindowValue(end);
  const sameDay = from.slice(0, 10) === to.slice(0, 10);
  return `${from} → ${sameDay ? to.slice(11) : to} UTC`;
}

/**
 * The single verdict shown for an evaluation. A run has two dimensions —
 * whether the monitor EXECUTED and what it FOUND — but showing both reads as a
 * contradiction ("success" next to "unhealthy"). The data verdict is the one
 * that matters when the check ran; execution surfaces only when it failed.
 */
function RunVerdict({ run }: { run: DataHealthRun }) {
  if (run.status === "running") return <span className="font-mono text-[10px] uppercase text-paper-muted">running…</span>;
  if (run.status === "success") {
    if (run.conditionValue && isHealthState(run.conditionValue)) {
      return <span title="Data verdict for this slot"><HealthBadge state={run.conditionValue} /></span>;
    }
    return <span className="font-mono text-[10px] uppercase text-emerald-500">evaluated</span>;
  }
  return (
    <span title={run.message ?? "The monitor could not execute; data health is unknown for this slot"} className="rounded-xs border border-red-400/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-red-500">
      monitor failed
    </span>
  );
}

/** One evaluation in the run history — expandable to its window, observed metrics, and error. */
function HealthRunRow({ run, canRun, onRerun }: { run: DataHealthRun; canRun: boolean; onRerun: () => void }) {
  const [open, setOpen] = useState(false);
  let snap: HealthRunSnapshot = {};
  try {
    snap = run.resultJson ? (JSON.parse(run.resultJson) as HealthRunSnapshot) : {};
  } catch {
    snap = {};
  }
  const metrics = snap.rows?.[0];
  const failed = run.status === "error" || run.status === "failed";
  return (
    <div className={`rounded-xs border border-ink-500 bg-ink-200/40 ${failed ? "border-l-2 border-l-red-500" : ""}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex flex-1 items-center justify-between gap-3 text-left">
          <div>
            <p className="font-mono text-[10px] text-paper">slot {formatHealthTime(run.slotAt)}</p>
            <p className="mt-0.5 text-[10px] text-paper-faint">{run.trigger}{(run.attempt ?? 1) > 1 ? ` · attempt ${run.attempt}` : ""} · ran {formatHealthTime(run.startedAt)}</p>
          </div>
          <div className="flex items-center gap-2">
            <RunVerdict run={run} />
            <span className="font-mono text-[10px] text-paper-muted">{run.durationMs != null ? `${run.durationMs}ms` : "—"}</span>
          </div>
        </button>
        {canRun && run.status !== "running" && (
          <button type="button" onClick={onRerun} title="Clear & rerun this evaluation over the same window" className="flex shrink-0 items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted hover:border-brand hover:text-paper">
            <RotateCcw className="h-3 w-3" /> Rerun
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-1.5 border-t border-ink-500 px-2.5 py-2">
          {/* On success the metric chips carry the findings; the summary message would duplicate them. */}
          {failed && run.message && <p className="text-[11px] text-red-600">{run.message}</p>}
          {snap.window?.slot_start && snap.window.slot_end && (
            <p className="font-mono text-[10px] text-paper-muted">
              window <span className="text-paper">{formatWindowRange(snap.window.slot_start, snap.window.slot_end)}</span>
              {snap.window.prev_run_at && snap.window.prev_run_at !== snap.window.slot_start && (
                <> · since last success <span className="text-paper">{trimWindowValue(snap.window.prev_run_at)}</span></>
              )}
            </p>
          )}
          {metrics && (() => {
            const entries = Object.entries(metrics);
            const observed = entries.filter(([, value]) => value != null);
            const missing = entries.length - observed.length;
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                {observed.map(([name, value]) => (
                  <span key={name} className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">{name.replace(/_/g, " ")} <span className="text-paper">{String(value)}</span></span>
                ))}
                {missing > 0 && <span className="text-[10px] text-paper-faint">{missing} metric{missing > 1 ? "s" : ""} not evaluated</span>}
              </div>
            );
          })()}
          {!(failed && run.message) && !snap.window && !metrics && <p className="text-[11px] text-paper-muted">No details recorded for this run.</p>}
        </div>
      )}
    </div>
  );
}

export function PromiseDetail({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: () => void }) {
  const promiseQuery = useDataHealthPromise(id);
  const timelineQuery = useDataHealthTimeline(id);
  const runMutation = useRunDataHealthPromise();
  const canRun = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_RUN));
  const canEdit = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT));
  const canUseAi = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE));
  const modelId = useDataOpsModelId();
  const promise = promiseQuery.data;
  const [dialog, setDialog] = useState<"investigate" | "tune" | "correlate" | "backtest" | "diagnostic" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [investigation, setInvestigation] = useState<DataOpsInvestigation>();
  const [tuning, setTuning] = useState<HealthPromiseTuning>();
  const [correlation, setCorrelation] = useState<HealthIncidentCorrelation>();
  const [backtest, setBacktest] = useState<DataHealthBacktestResult>();
  const [diagnostic, setDiagnostic] = useState<DataHealthDiagnosticResult>();
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunFrom, setRerunFrom] = useState(() => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 16));
  const [rerunTo, setRerunTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [rerunPlan, setRerunPlan] = useState<DataHealthRecoveryResult>();
  const [rerunError, setRerunError] = useState<string>();
  const [rerunLoading, setRerunLoading] = useState(false);
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
        setInvestigation(await diagnoseHealthIncident(id, activeIncident?.id, { modelId }));
      } else if (kind === "tune") {
        setTuning(await tuneHealthPromise(id, { modelId }));
      } else if (kind === "correlate") {
        setCorrelation(await correlateHealthIncidents(id, { modelId }));
      } else {
        setBacktest(await backtestDataHealthPromise(id, 14));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data Health analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const planRerun = async () => {
    const from = new Date(rerunFrom).getTime();
    const to = new Date(rerunTo).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      setRerunError("Choose a valid rerun time range.");
      return;
    }
    setRerunLoading(true);
    setRerunError(undefined);
    try {
      setRerunPlan(await recoverDataHealthPromise(id, { from, to }));
    } catch (caught) {
      setRerunError(caught instanceof Error ? caught.message : "Rerun planning failed");
    } finally {
      setRerunLoading(false);
    }
  };

  const executeRerun = async () => {
    const from = new Date(rerunFrom).getTime();
    const to = new Date(rerunTo).getTime();
    setRerunLoading(true);
    try {
      const result = await recoverDataHealthPromise(id, { from, to, execute: true, confirm: true });
      setRerunPlan(result);
      const runs = result.runs ?? [];
      const failed = runs.filter((run) => run.status === "error" || run.status === "failed").length;
      if (failed > 0) toast.warning(`Re-evaluated ${runs.length} slot(s); ${failed} failed`);
      else toast.success(`Re-evaluated ${runs.length} slot(s)`);
      await Promise.all([promiseQuery.refetch(), timelineQuery.refetch()]);
    } catch (caught) {
      setRerunError(caught instanceof Error ? caught.message : "Rerun execution failed");
    } finally {
      setRerunLoading(false);
    }
  };

  const rerunSingleRun = async (runId: string) => {
    try {
      const run = await rerunDataHealthRun(id, runId);
      if (run?.status === "success") toast.success(`Slot re-evaluated: ${run.conditionValue ?? "done"}`);
      else toast.error(run?.message ?? "Rerun failed");
      await Promise.all([promiseQuery.refetch(), timelineQuery.refetch()]);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Rerun failed");
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
        <div className="flex flex-wrap gap-2">{canUseAi && <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runInsight("investigate")}><Sparkles className="mr-2 h-3.5 w-3.5" /> Investigate</Button>}{canUseAi && <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runInsight("tune")}><SlidersHorizontal className="mr-2 h-3.5 w-3.5" /> Tune</Button>}{canUseAi && <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runInsight("correlate")}><Network className="mr-2 h-3.5 w-3.5" /> Correlate</Button>}{canRun && <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runInsight("backtest")}><FlaskConical className="mr-2 h-3.5 w-3.5" /> Backtest</Button>}{canRun && <Button variant="outline" className="h-9 rounded-xs" onClick={() => setRerunOpen(true)}><RotateCcw className="mr-2 h-3.5 w-3.5" /> Rerun range</Button>}{canEdit && <Button variant="outline" className="h-9 rounded-xs" onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit promise</Button>}{canRun && <Button className={DH_PRIMARY} onClick={() => void runNow()} disabled={runMutation.isPending}><Play className="h-3.5 w-3.5" /> Evaluate now</Button>}</div>
      </div>

      <OperationalBriefCard kind="data-health" id={id} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Last evaluated</p><p className="mt-2 text-[12px] text-paper">{formatHealthTime(promise.lastEvaluatedAt)}</p></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Last healthy</p><p className="mt-2 text-[12px] text-paper">{formatHealthTime(promise.lastHealthyAt)}</p></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Schedule</p><p className="mt-2 text-[12px] text-paper">{promise.upstream ? `After “${promise.upstream.name}” succeeds` : formatSchedule(promise.schedule, promise.timezone)}</p>{promise.upstream && !promise.upstream.enabled && <p className="mt-1 text-[10px] text-amber-500">Upstream job is disabled — evaluations are paused until it is re-enabled.</p>}</Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Owner</p><p className="mt-2 truncate text-[12px] text-paper">{promise.ownerDisplayName ?? (promise.ownerId ? "Unknown user" : "Unassigned")}</p></Card>
      </div>
      {promise.eventTimeColumn && (promise.eventTimeEncoding !== "native" || isDateOnlyColumnType(promise.eventTimeType)) && <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Event-time source format</p><p className="mt-2 font-mono text-[11px] text-paper">{promise.eventTimeColumn} · {promise.eventTimeEncoding.replaceAll("_", " ")}{promise.eventTimeEncoding === "string" || isDateOnlyColumnType(promise.eventTimeType) ? ` · ${promise.eventTimeTimezone ?? "timezone missing"}` : ""}</p><p className="mt-1 text-[10px] text-paper-muted">{isDateOnlyColumnType(promise.eventTimeType) ? "UTC slot boundaries are mapped to calendar dates in the saved timezone." : "The source value is converted to an instant before comparison with UTC evaluation slots."}</p></Card>}
      <section><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" /><h3 className={DH_LABEL}>Promise checks</h3></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{promise.checks.map((check) => { const sample = latestByCheck.get(check.checkKey); const diagnosable = ["freshness", "completeness", "uniqueness", "validity"].includes(check.type); return <Card key={check.checkKey} className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-medium text-paper">{check.name}</p><p className="mt-0.5 font-mono text-[9px] uppercase text-paper-faint">{check.type.replace("_", " ")} · {check.severity}</p></div>{sample ? <HealthBadge state={sample.outcome} /> : <HealthBadge state="not_evaluated" />}</div><div className="mt-4 flex items-end justify-between"><div><p className={DH_LABEL}>Observed</p><p className="mt-1 text-xl font-semibold tabular-nums text-paper">{formatMetric(sample?.observedValue ?? null, check.type)}</p></div><p className="text-right font-mono text-[10px] text-paper-muted">{sample ? `${formatMetric(sample.expectedLower, check.type)} – ${formatMetric(sample.expectedUpper, check.type)}` : "No sample"}</p></div>{diagnosable && <Button variant="ghost" size="sm" className="mt-3 h-7 rounded-xs" onClick={() => void inspectCheck(check.checkKey, sample?.slotAt)}><Search className="mr-1.5 h-3 w-3" /> Inspect evidence</Button>}</Card>; })}</div></section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-center gap-2"><Clock className="h-4 w-4 text-paper-muted" /><p className={DH_LABEL}>Run history</p></div><div className="mt-3 space-y-1.5">{(timelineQuery.data?.runs ?? []).slice(0, 10).map((run) => <HealthRunRow key={run.id} run={run} canRun={canRun} onRerun={() => void rerunSingleRun(run.id)} />)}{(timelineQuery.data?.runs.length ?? 0) === 0 && <p className="py-8 text-center text-[12px] text-paper-muted">No evaluations yet.</p>}</div></Card>
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><div className="flex items-center justify-between"><p className={DH_LABEL}>Operational context</p>{promise.runbookUrl && <a href={promise.runbookUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"><BookOpen className="h-3.5 w-3.5" /> Open runbook</a>}</div><dl className="mt-4 space-y-3 text-[11px]"><div><dt className="text-paper-faint">Evaluation timezone</dt><dd className="mt-0.5 text-paper">UTC</dd></div><div><dt className="text-paper-faint">Alert policy</dt><dd className="mt-0.5 text-paper">Open after {promise.breachAfter} breach(es), recover after {promise.recoverAfter} pass(es)</dd></div><div><dt className="text-paper-faint">Notification destinations</dt><dd className="mt-0.5 text-paper">{promise.channelIds.length || "None"}</dd></div><div><dt className="text-paper-faint">Retention</dt><dd className="mt-0.5 text-paper">{promise.retentionDays} days</dd></div></dl></Card>
      </div>
      {(timelineQuery.data?.events.length ?? 0) > 0 && <Card className="rounded-xs border-ink-500 bg-ink-100 p-4"><p className={DH_LABEL}>Incident timeline</p><div className="mt-3 divide-y divide-ink-500">{timelineQuery.data?.events.slice(0, 12).map((event) => <div key={event.id} className="flex items-center justify-between gap-3 py-2"><div><p className="text-[11px] capitalize text-paper">{event.type.replace("_", " ")}</p><p className="mt-0.5 font-mono text-[9px] text-paper-faint">incident {event.incidentId.slice(0, 8)}{event.runId ? ` · run ${event.runId.slice(0, 8)}` : ""}</p></div><p className="font-mono text-[10px] text-paper-muted">{formatHealthTime(event.createdAt)}</p></div>)}</div></Card>}

      <AiInsightDialog open={dialog === "investigate"} onOpenChange={(open) => !open && setDialog(null)} title="Data Health incident investigation" description="Separates monitoring failures from unhealthy data and ranks evidence-backed causes." loading={loading} error={error}>{investigation && <InvestigationView result={investigation} />}</AiInsightDialog>
      <AiInsightDialog open={dialog === "tune"} onOpenChange={(open) => !open && setDialog(null)} title="Promise noise tuning" description="Recommendations are advisory and never change the promise automatically." loading={loading} error={error}>{tuning && <TuningView result={tuning} />}</AiInsightDialog>
      <AiInsightDialog open={dialog === "correlate"} onOpenChange={(open) => !open && setDialog(null)} title="Related incident analysis" description="Looks for credible shared timing and execution evidence across visible datasets." loading={loading} error={error}>{correlation && <CorrelationView result={correlation} />}</AiInsightDialog>
      <AiInsightDialog open={dialog === "backtest"} onOpenChange={(open) => !open && setDialog(null)} title="Historical promise backtest" description="Replays metric checks over up to 14 bounded historical windows without opening incidents; structural checks are reported as unknown." loading={loading} error={error}>{backtest && <div className="space-y-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Object.entries(backtest.summary).map(([key, value]) => <div key={key} className="rounded-xs border border-ink-500 p-2"><p className="font-mono text-[9px] uppercase text-paper-faint">{key}</p><p className="mt-1 text-[13px] text-paper">{value}</p></div>)}</div><div className="space-y-1">{backtest.slots.map((slot) => <div key={slot.slotAt} className="flex items-center justify-between rounded-xs border border-ink-500 px-3 py-2"><span className="font-mono text-[10px] text-paper-muted">{new Date(slot.slotAt).toLocaleString()}</span><HealthBadge state={slot.state} /></div>)}</div></div>}</AiInsightDialog>
      <AiInsightDialog open={rerunOpen} onOpenChange={setRerunOpen} title="Clear & rerun a time range" description="Re-evaluates each slot in the range and replaces its recorded samples. Only the newest slot can change current status or incidents; historical slots are corrected silently." loading={rerunLoading} error={rerunError}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div><p className="font-mono text-[9px] uppercase text-paper-faint">From</p><Input type="datetime-local" value={rerunFrom} onChange={(event) => setRerunFrom(event.target.value)} className="mt-1" /></div><div><p className="font-mono text-[9px] uppercase text-paper-faint">To</p><Input type="datetime-local" value={rerunTo} onChange={(event) => setRerunTo(event.target.value)} className="mt-1" /></div></div>
          <Button variant="outline" className="rounded-xs" onClick={() => void planRerun()}>Preview rerun</Button>
          {rerunPlan && (
            <>
              <div className="rounded-xs border border-ink-500 p-3">
                <p className="text-[11px] text-paper">{rerunPlan.runnable} slot(s) will be re-evaluated</p>
                <p className="mt-1 text-[10px] text-paper-muted">{rerunPlan.plan.filter((slot) => slot.hasSamples).length} slot(s) already have samples and will be replaced.</p>
                {rerunPlan.warnings.map((warning) => <p key={warning} className="mt-1 text-[10px] text-amber-500">{warning}</p>)}
                {rerunPlan.runnable === 0 && <p className="mt-1 text-[10px] text-paper-muted">No slots to rerun in this range.</p>}
              </div>
              {rerunPlan.runs && (() => {
                const failed = rerunPlan.runs.filter((run) => run.status === "error" || run.status === "failed").length;
                return failed > 0
                  ? <p className="text-[11px] text-amber-500">Re-evaluated {rerunPlan.runs.length} slot(s); {failed} failed — see the run timeline for errors.</p>
                  : <p className="text-[11px] text-emerald-500">Re-evaluated {rerunPlan.runs.length} slot(s).</p>;
              })()}
              {rerunPlan.runnable > 0 && rerunPlan.runnable <= 30 && <Button className={DH_PRIMARY} onClick={() => void executeRerun()} disabled={rerunLoading}>Confirm and rerun {rerunPlan.runnable} slot(s)</Button>}
              {rerunPlan.runnable > 30 && <p className="text-[10px] text-amber-500">At most 30 slots can be executed per request — narrow the range.</p>}
            </>
          )}
        </div>
      </AiInsightDialog>
      <AiInsightDialog open={dialog === "diagnostic"} onOpenChange={(open) => !open && setDialog(null)} title="Bounded check evidence" description="Rows are queried live under your current access, limited to 50, and are not persisted in the AI result." loading={loading} error={error}>{diagnostic && (diagnostic.supported ? diagnostic.rows.length > 0 ? <div className="overflow-x-auto rounded-xs border border-ink-500"><table className="w-full text-left text-[10px]"><thead><tr>{diagnostic.columns.map((column) => <th key={column.name} className="px-2 py-2 font-mono uppercase text-paper-faint">{column.name}</th>)}</tr></thead><tbody>{diagnostic.rows.map((row, index) => <tr key={index} className="border-t border-ink-500">{diagnostic.columns.map((column) => <td key={column.name} className="max-w-64 truncate px-2 py-2 text-paper">{String(row[column.name] ?? "")}</td>)}</tr>)}</tbody></table></div> : <p className="text-[11px] text-paper-muted">No row-level evidence was found in this evaluation window ({formatHealthTime(diagnostic.slotStart)} – {formatHealthTime(diagnostic.slotEnd)}). Completeness, uniqueness, and validity diagnostics only return violating rows; freshness returns recent rows.</p> : <p className="text-[11px] text-paper-muted">This aggregate check has no meaningful row-level diagnostic. Use its metric history and incident investigation instead.</p>)}</AiInsightDialog>
    </div>
  );
}
