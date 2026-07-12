import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bell,
  Code2,
  Database,
  History,
  Lock,
  Network,
  Pencil,
  Play,
  Power,
  ShieldCheck,
  Sparkles,
  RotateCcw,
} from "lucide-react";

import { assessScheduledQuery, planScheduledRecovery, type RecoveryAssessment, type ScheduledQueryAssessment } from "@/api/dataOpsAi";
import { recoverScheduledQuery, type ScheduledQuery, type ScheduledRecoveryResult } from "@/api/scheduledQueries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatClickHouseSQL } from "@/lib/formatSql";
import { useAuthStore, useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { AiInsightDialog, AssessmentView, OperationalBriefCard } from "@/features/dataops-ai";
import { useJobOwners, useRunScheduledQuery, useScheduledQueryRuns, useUpdateScheduledQuery } from "./hooks";
import { JobWizard } from "./JobWizard";
import { LineageTab } from "./LineageTab";
import { formatDuration, formatRelative, scheduleLabel, scheduledQueryToInput, SQ_BTN_PRIMARY, SQ_LABEL, StatusBadge } from "./lib";
import { RunsTab } from "./RunsTab";

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="rounded-xs border-ink-500 bg-ink-100 p-4">
      <p className={SQ_LABEL}>{label}</p>
      <p className="mt-2 truncate text-[12px] text-paper" title={value}>{value}</p>
      {detail && <p className="mt-1 truncate font-mono text-[10px] text-paper-faint">{detail}</p>}
    </Card>
  );
}

interface JobDetailProps {
  job: ScheduledQuery;
  jobs: ScheduledQuery[];
  onBack: () => void;
}

export function JobDetail({ job, jobs, onBack }: JobDetailProps) {
  const { hasPermission } = useRbacStore();
  const canEdit = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_EDIT);
  const canRun = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_RUN);
  const canViewAll = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_VIEW_ALL);
  const canUseAi = hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE);
  const activeConnectionId = useAuthStore((state) => state.activeConnectionId);
  const activeConnectionName = useAuthStore((state) => state.activeConnectionName);
  // The list is scoped to the active connection, so a visible job is always on
  // it — show the human-readable name, falling back to the id defensively.
  const connectionLabel = job.connectionId === activeConnectionId && activeConnectionName ? activeConnectionName : job.connectionId;
  const runMutation = useRunScheduledQuery();
  const updateMutation = useUpdateScheduledQuery();
  const { data: runs = [] } = useScheduledQueryRuns(job.id);
  const { nameOf: ownerName } = useJobOwners(jobs, canViewAll);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflight, setPreflight] = useState<ScheduledQueryAssessment>();
  const [preflightError, setPreflightError] = useState<string>();
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryFrom, setRecoveryFrom] = useState(() => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 16));
  const [recoveryTo, setRecoveryTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [recovery, setRecovery] = useState<{ assessment: RecoveryAssessment; preview: ScheduledRecoveryResult }>();
  const [recoveryError, setRecoveryError] = useState<string>();
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  const successfulRuns = useMemo(() => runs.filter((run) => run.status === "success").length, [runs]);
  const completedRuns = useMemo(() => runs.filter((run) => run.status !== "running").length, [runs]);
  const successRate = completedRuns > 0 ? `${Math.round((successfulRuns / completedRuns) * 100)}%` : "—";
  const formattedQuery = useMemo(() => formatClickHouseSQL(job.query), [job.query]);

  const runNow = async () => {
    try {
      const result = await runMutation.mutateAsync(job.id);
      const status = result.run?.status ?? "running";
      toast[status === "success" ? "success" : status === "failed" || status === "error" ? "error" : "info"](`Run finished: ${status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Run failed");
    }
  };

  const toggleEnabled = async () => {
    try {
      await updateMutation.mutateAsync({ id: job.id, input: scheduledQueryToInput(job, { enabled: !job.enabled }) });
      toast.success(job.enabled ? "Job disabled" : "Job enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    }
  };

  const runPreflight = async () => {
    setPreflightOpen(true);
    setPreflightLoading(true);
    setPreflightError(undefined);
    try {
      setPreflight(await assessScheduledQuery({
        name: job.name,
        connectionId: job.connectionId,
        query: job.query,
        frequency: job.frequency,
        timezone: job.timezone,
        outputMode: job.outputMode,
        destDatabase: job.destDatabase,
        destTable: job.destTable,
        timeoutSecs: job.timeoutSecs,
        maxAttempts: job.maxAttempts,
      }));
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : "Preflight review failed");
    } finally {
      setPreflightLoading(false);
    }
  };

  const planRecovery = async () => {
    const from = new Date(recoveryFrom).getTime();
    const to = new Date(recoveryTo).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      setRecoveryError("Choose a valid recovery time range.");
      return;
    }
    setRecoveryLoading(true);
    setRecoveryError(undefined);
    try {
      const [assessment, preview] = await Promise.all([
        planScheduledRecovery(job.id, from, to),
        recoverScheduledQuery(job.id, { from, to }),
      ]);
      setRecovery({ assessment, preview });
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : "Recovery planning failed");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const executeRecovery = async () => {
    const from = new Date(recoveryFrom).getTime();
    const to = new Date(recoveryTo).getTime();
    setRecoveryLoading(true);
    try {
      const result = await recoverScheduledQuery(job.id, { from, to, execute: true, confirm: true });
      setRecovery((current) => current ? { ...current, preview: result } : current);
      toast.success(`Recovery completed ${result.runs?.length ?? 0} run(s)`);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : "Recovery execution failed");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const destination = job.outputMode === "none"
    ? "Read-only result"
    : `${job.destDatabase ?? "?"}.${job.destTable ?? "?"}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={onBack} aria-label="Back to jobs">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[18px] font-semibold text-paper">{job.name}</h2>
              {job.lastRun && <StatusBadge status={job.lastRun.status} />}
              <span className={`font-mono text-[9px] uppercase tracking-[0.14em] ${job.enabled ? "text-emerald-500" : "text-paper-faint"}`}>
                {job.enabled ? "enabled" : "disabled"}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-paper-muted">{scheduleLabel(job)}</p>
            {job.description && <p className="mt-2 max-w-2xl text-[12px] text-paper-muted">{job.description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUseAi && (
            <Button variant="outline" className="h-9 rounded-xs" onClick={() => void runPreflight()}>
              <Sparkles className="mr-2 h-3.5 w-3.5" /> AI preflight
            </Button>
          )}
          {canRun && canUseAi && job.frequency !== "manual" && (
            <Button variant="outline" className="h-9 rounded-xs" onClick={() => setRecoveryOpen(true)}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" /> Recovery planner
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" className="h-9 rounded-xs" onClick={() => void toggleEnabled()} disabled={updateMutation.isPending}>
              <Power className="mr-2 h-3.5 w-3.5" /> {job.enabled ? "Disable" : "Enable"}
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" className="h-9 rounded-xs" onClick={() => setWizardOpen(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit job
            </Button>
          )}
          {canRun && (
            <Button className={SQ_BTN_PRIMARY} onClick={() => void runNow()} disabled={runMutation.isPending}>
              <Play className="h-3.5 w-3.5" /> Run now
            </Button>
          )}
        </div>
      </div>

      <OperationalBriefCard kind="scheduled-query" id={job.id} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Last run"
          value={formatRelative(job.lastRun?.startedAt)}
          detail={job.lastRun ? `${formatDuration(job.lastRun.durationMs)} · ${new Date(job.lastRun.startedAt).toLocaleString(undefined, { timeZone: job.timezone, timeZoneName: "short" })}` : "No runs yet"}
        />
        <MetricCard label="Success rate" value={successRate} detail={`${completedRuns} completed run(s) loaded`} />
        <MetricCard label="Schedule" value={scheduleLabel(job)} detail={job.timezone} />
        <MetricCard label="Owner" value={canViewAll ? ownerName(job.createdBy) : job.createdBy ? "You" : "—"} detail={`Created ${formatRelative(job.createdAt)}`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.75fr)]">
        <Card className="min-w-0 rounded-xs border-ink-500 bg-ink-100 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-brand" />
                <h3 className={SQ_LABEL}>Query definition</h3>
                <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">
                  <Lock className="h-2.5 w-2.5" /> Read-only display
                </span>
              </div>
              <p className="mt-1 text-[10px] text-paper-muted">Formatted for readability. Use Edit job to change the query.</p>
            </div>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre rounded-xs border border-ink-500 bg-ink-50 p-3 font-mono text-[11px] leading-5 text-paper">{formattedQuery}</pre>
        </Card>

        <Card className="rounded-xs border-ink-500 bg-ink-100 p-4">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand" />
            <h3 className={SQ_LABEL}>Delivery &amp; reliability</h3>
          </div>
          <dl className="space-y-3 text-[11px]">
            <div><dt className="text-paper-faint">Connection</dt><dd className="mt-0.5 truncate font-mono text-paper" title={connectionLabel}>{connectionLabel}</dd></div>
            <div><dt className="text-paper-faint">Output</dt><dd className="mt-0.5 text-paper"><span className="uppercase">{job.outputMode}</span> · {destination}</dd></div>
            <div><dt className="text-paper-faint">Execution limits</dt><dd className="mt-0.5 text-paper">{job.timeoutSecs}s timeout · {job.maxRows.toLocaleString()} max rows · {job.maxAttempts} attempt(s)</dd></div>
            <div><dt className="text-paper-faint">Read consistency</dt><dd className="mt-0.5 text-paper">{job.useFinal ? "FINAL enabled" : "Standard reads"} · {job.seqConsistency ? "sequential consistency" : "default consistency"}</dd></div>
            <div className="flex items-start gap-2"><Bell className="mt-0.5 h-3.5 w-3.5 text-paper-faint" /><div><dt className="text-paper-faint">Failure notifications</dt><dd className="mt-0.5 text-paper">{job.channelIds.length ? `${job.channelIds.length} destination(s)` : "None configured"}</dd></div></div>
            <div className="flex items-start gap-2"><Database className="mt-0.5 h-3.5 w-3.5 text-paper-faint" /><div><dt className="text-paper-faint">Run retention</dt><dd className="mt-0.5 text-paper">{job.retentionDays} days</dd></div></div>
          </dl>
        </Card>
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><Network className="h-4 w-4 text-brand" /><h3 className={SQ_LABEL}>Runtime lineage</h3></div>
            <p className="mt-1 text-[11px] text-paper-muted">Observed upstream reads and downstream writes for this job.</p>
          </div>
        </div>
        <LineageTab selectedJobId={job.id} embedded />
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><History className="h-4 w-4 text-brand" /><h3 className={SQ_LABEL}>Run history</h3></div>
            <p className="mt-1 text-[11px] text-paper-muted">Inspect attempts, result snapshots, query logs, and retention from this job.</p>
          </div>
        </div>
        <RunsTab selectedJobId={job.id} embedded />
      </section>

      {wizardOpen && <JobWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} job={job} />}
      <AiInsightDialog open={preflightOpen} onOpenChange={setPreflightOpen} title="Scheduled Query preflight" description="Read-only review of correctness, cost, schedule, destination, and recovery risks." loading={preflightLoading} error={preflightError}>{preflight && <AssessmentView result={preflight} />}</AiInsightDialog>
      <AiInsightDialog open={recoveryOpen} onOpenChange={setRecoveryOpen} title="Historical recovery planner" description="Preview missed deterministic slots before any historical runs execute." loading={recoveryLoading} error={recoveryError}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div><p className="font-mono text-[9px] uppercase text-paper-faint">From</p><Input type="datetime-local" value={recoveryFrom} onChange={(event) => setRecoveryFrom(event.target.value)} className="mt-1" /></div><div><p className="font-mono text-[9px] uppercase text-paper-faint">To</p><Input type="datetime-local" value={recoveryTo} onChange={(event) => setRecoveryTo(event.target.value)} className="mt-1" /></div></div>
          <Button variant="outline" className="rounded-xs" onClick={() => void planRecovery()}>Preview recovery</Button>
          {recovery && <><AssessmentView result={recovery.assessment} /><div className="rounded-xs border border-ink-500 p-3"><p className="text-[11px] text-paper">{recovery.preview.runnable} missing slot(s) ready to run</p><p className="mt-1 text-[10px] text-paper-muted">{recovery.preview.plan.filter((slot) => slot.alreadySucceeded).length} slot(s) already succeeded and will be skipped.</p>{recovery.preview.warnings.map((warning) => <p key={warning} className="mt-1 text-[10px] text-amber-500">{warning}</p>)}</div>{recovery.preview.runnable > 0 && recovery.preview.runnable <= 30 && <Button className={SQ_BTN_PRIMARY} onClick={() => void executeRecovery()}>Confirm and run {recovery.preview.runnable} slot(s)</Button>}</>}
        </div>
      </AiInsightDialog>
    </div>
  );
}
