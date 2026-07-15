/**
 * Scheduled Queries → Jobs: a filterable, paginated job list.
 * Filter by enabled/disabled, last-run state, and a name search; Run-now / Edit /
 * Disable / Delete row actions; "+ New job" opens the builder wizard.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Play, Pencil, Trash2, Plus, Power, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useOnboardingGuideActive } from "@/features/onboarding";
import { PromiseWizard, type PromiseWizardDraft } from "@/features/data-health";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import type { ScheduledQuery } from "@/api/scheduledQueries";
import { useScheduledQueries, useDeleteScheduledQuery, useRunScheduledQuery, useUpdateScheduledQuery, useJobOwners } from "./hooks";
import { JobWizard } from "./JobWizard";
import { JobDetail } from "./JobDetail";
import { StatusBadge, scheduleLabel, formatRelative, scheduledQueryToInput, SQ_BTN_PRIMARY, SQ_LABEL } from "./lib";
import { TablePagination } from "./TablePagination";

const statusRank: Record<string, number> = { error: 0, failed: 1, running: 2, success: 3 };

type EnabledFilter = "all" | "enabled" | "disabled";
type StateFilter = "all" | "success" | "failing" | "running" | "never";

function lastState(job: ScheduledQuery): StateFilter {
  const s = job.lastRun?.status;
  if (!s) return "never";
  if (s === "running") return "running";
  if (s === "error" || s === "failed") return "failing";
  return "success";
}

export function JobsTab({ selectedJobId, onSelectedJobChange }: { selectedJobId?: string; onSelectedJobChange: (id?: string) => void }) {
  const { hasPermission } = useRbacStore();
  const canEdit = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_EDIT);
  const canDelete = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_DELETE);
  const canRun = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_RUN);
  const canViewAll = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_VIEW_ALL);
  const guideActive = useOnboardingGuideActive();

  const { data: jobs, isLoading } = useScheduledQueries();
  const { options: ownerOptions, nameOf: ownerName } = useJobOwners(jobs, canViewAll);
  const deleteMut = useDeleteScheduledQuery();
  const runMut = useRunScheduledQuery();
  const updateMut = useUpdateScheduledQuery();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledQuery | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<ScheduledQuery | undefined>();
  const [protectDraft, setProtectDraft] = useState<PromiseWizardDraft | undefined>();
  const canProtect = hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT);

  // ADR 0006 — after creating a materializing job, offer to protect its output
  // table with an event-triggered Data Health promise, pre-linked to the job.
  const offerProtection = (created: ScheduledQuery): void => {
    if (!canProtect || created.outputMode === "none" || !created.destDatabase || !created.destTable) return;
    setProtectDraft({ databaseName: created.destDatabase, tableName: created.destTable, upstreamJobId: created.id });
  };

  // Filters.
  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

  // Pagination.
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...(jobs ?? [])]
      .filter((j) => (enabledFilter === "all" ? true : enabledFilter === "enabled" ? j.enabled : !j.enabled))
      .filter((j) => (stateFilter === "all" ? true : lastState(j) === stateFilter))
      .filter((j) => (ownerFilter === "all" ? true : j.createdBy === ownerFilter))
      .filter((j) => (term ? j.name.toLowerCase().includes(term) || (j.description ?? "").toLowerCase().includes(term) : true))
      .sort((a, b) => {
        const ra = statusRank[a.lastRun?.status ?? "success"] ?? 3;
        const rb = statusRank[b.lastRun?.status ?? "success"] ?? 3;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
  }, [jobs, search, enabledFilter, stateFilter, ownerFilter]);

  // Reset to page 1 whenever filters change.
  useEffect(() => setPage(1), [search, enabledFilter, stateFilter, ownerFilter, pageSize]);

  const total = filtered.length;
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedJob = jobs?.find((job) => job.id === selectedJobId);

  const openNewJob = (): void => {
    setEditing(undefined);
    setWizardOpen(true);
  };

  const handleRun = async (job: ScheduledQuery) => {
    try {
      const res = await runMut.mutateAsync(job.id);
      const status = res.run?.status ?? "running";
      toast[status === "success" ? "success" : status === "error" || status === "failed" ? "error" : "info"](`Run finished: ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    }
  };

  const handleToggle = async (job: ScheduledQuery) => {
    try {
      await updateMut.mutateAsync({ id: job.id, input: scheduledQueryToInput(job, { enabled: !job.enabled }) });
      toast.success(job.enabled ? "Job disabled" : "Job enabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      toast.success("Job deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteTarget(undefined);
    }
  };

  if (selectedJob) {
    return (
      <div className="space-y-4">
        {/* Guide anchor only: the "create" step must resolve even while a job
            detail replaces the list view. Hidden outside contextual guides. */}
        {canEdit && guideActive && (
          <div className="flex justify-end">
            <Button
              data-onboarding-id="dataops-scheduled-create"
              className={SQ_BTN_PRIMARY}
              onClick={openNewJob}
            >
              <Plus className="h-3.5 w-3.5" /> New job
            </Button>
          </div>
        )}
        <JobDetail job={selectedJob} jobs={jobs ?? []} onBack={() => onSelectedJobChange(undefined)} />
        {wizardOpen && <JobWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={offerProtection} />}
        <PromiseWizard open={Boolean(protectDraft)} onOpenChange={(open) => !open && setProtectDraft(undefined)} initialDraft={protectDraft} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-faint" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs by name…"
            className="h-9 rounded-xs pl-8"
          />
        </div>
        <Select value={enabledFilter} onValueChange={(v) => setEnabledFilter(v as EnabledFilter)}>
          <SelectTrigger className="h-9 w-[140px] rounded-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="enabled">Enabled</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as StateFilter)}>
          <SelectTrigger className="h-9 w-[150px] rounded-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any last run</SelectItem>
            <SelectItem value="success">Healthy</SelectItem>
            <SelectItem value="failing">Failing</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="never">Never run</SelectItem>
          </SelectContent>
        </Select>
        {canViewAll && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-[170px] rounded-xs"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {ownerOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {canEdit && (
          <Button
            data-onboarding-id="dataops-scheduled-create"
            className={SQ_BTN_PRIMARY}
            onClick={openNewJob}
          >
            <Plus className="h-3.5 w-3.5" /> New job
          </Button>
        )}
      </div>

      <p className={SQ_LABEL}>{total} of {jobs?.length ?? 0} job(s)</p>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xs" />)}</div>
      ) : total === 0 ? (
        <Card className="rounded-xs border-ink-500 bg-ink-100 p-8 text-center">
          <p className="text-[13px] text-paper-muted">{(jobs?.length ?? 0) === 0 ? "No scheduled queries yet." : "No jobs match your filters."}</p>
          {canEdit && (jobs?.length ?? 0) === 0 && (
            <Button className={cn(SQ_BTN_PRIMARY, "mt-3 inline-flex")} onClick={() => setWizardOpen(true)}><Plus className="h-3.5 w-3.5" /> Create one</Button>
          )}
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {pageItems.map((job) => (
              <Card key={job.id} className="flex items-center justify-between gap-4 rounded-xs border-ink-500 bg-ink-100 p-3">
                <button type="button" onClick={() => onSelectedJobChange(job.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-paper">{job.name}</span>
                    {job.lastRun && <StatusBadge status={job.lastRun.status} />}
                    {!job.enabled && <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">disabled</span>}
                    {canViewAll && <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">{ownerName(job.createdBy)}</span>}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-paper-muted">
                    {scheduleLabel(job)} · last run {formatRelative(job.lastRun?.startedAt)}
                  </p>
                </button>
                <div className="flex flex-shrink-0 items-center gap-1">
                  {canRun && (
                    <Button variant="ghost" size="icon" title="Run now" onClick={() => handleRun(job)} disabled={runMut.isPending}>
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canEdit && (
                    <>
                      <Button variant="ghost" size="icon" title={job.enabled ? "Disable" : "Enable"} onClick={() => handleToggle(job)}>
                        <Power className={job.enabled ? "h-3.5 w-3.5 text-emerald-600" : "h-3.5 w-3.5 text-paper-faint"} />
                      </Button>
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => { setEditing(job); setWizardOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(job)}>
                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
          <TablePagination page={page} total={total} pageSize={pageSize} rowLabel="jobs" onPageChange={setPage} onPageSizeChange={setPageSize} />
        </>
      )}

      {wizardOpen && <JobWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} job={editing} onCreated={offerProtection} />}
      <PromiseWizard open={Boolean(protectDraft)} onOpenChange={(open) => !open && setProtectDraft(undefined)} initialDraft={protectDraft} />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(undefined)}>
        <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scheduled query?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" and its run history will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
