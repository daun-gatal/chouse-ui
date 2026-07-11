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
} from "lucide-react";

import type { ScheduledQuery } from "@/api/scheduledQueries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatClickHouseSQL } from "@/lib/formatSql";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { useJobOwners, useRunScheduledQuery, useScheduledQueryRuns, useUpdateScheduledQuery } from "./hooks";
import { JobWizard } from "./JobWizard";
import { LineageTab } from "./LineageTab";
import { formatDuration, formatRelative, formatTime, scheduleLabel, scheduledQueryToInput, SQ_BTN_PRIMARY, SQ_LABEL, StatusBadge } from "./lib";
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
  const runMutation = useRunScheduledQuery();
  const updateMutation = useUpdateScheduledQuery();
  const { data: runs = [] } = useScheduledQueryRuns(job.id);
  const { nameOf: ownerName } = useJobOwners(jobs, canViewAll);
  const [wizardOpen, setWizardOpen] = useState(false);

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Last run"
          value={formatRelative(job.lastRun?.startedAt)}
          detail={job.lastRun ? `${formatDuration(job.lastRun.durationMs)} · ${formatTime(job.lastRun.startedAt)}` : "No runs yet"}
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
            <div><dt className="text-paper-faint">Connection</dt><dd className="mt-0.5 truncate font-mono text-paper" title={job.connectionId}>{job.connectionId}</dd></div>
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
    </div>
  );
}
