/**
 * Scheduled Queries → Runs: a reverse-chronological run feed for a selected job,
 * filterable by status. Expanding a run shows its bounded result snapshot and the
 * substituted window params. House tokens only.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FileSearch, Calendar as CalendarIcon, Trash2 } from "lucide-react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import type { RunQuery, ScheduledQueryRun, SqStatus } from "@/api/scheduledQueries";
import { useScheduledQueries, useScheduledQueryRuns, useJobOwners, useDeleteRuns } from "./hooks";
import { StatusBadge, formatTime, formatDuration } from "./lib";
import { TablePagination } from "./TablePagination";
import { JobCombobox } from "./JobCombobox";

interface SnapshotShape {
  columns?: Array<{ name: string; type: string }>;
  rows?: Array<Record<string, unknown>>;
  window?: Record<string, string>;
  mode?: string;
  dest?: string;
  writtenRows?: number | null;
}

function RunSnapshot({ run }: { run: ScheduledQueryRun }) {
  let snap: SnapshotShape = {};
  try {
    snap = run.resultJson ? (JSON.parse(run.resultJson) as SnapshotShape) : {};
  } catch {
    snap = {};
  }
  return (
    <div className="space-y-3 border-t border-ink-500 px-3 py-3">
      {run.message && <p className="text-[11px] text-red-600">{run.message}</p>}
      {snap.window && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-paper-muted">
          {Object.entries(snap.window).map(([k, v]) => (
            <span key={k}>{k}=<span className="text-paper">{v}</span></span>
          ))}
        </div>
      )}
      {snap.dest && (
        <p className="font-mono text-[11px] text-paper-muted">
          {snap.mode} → {snap.dest} · wrote {snap.writtenRows ?? "?"} rows
        </p>
      )}
      {snap.columns && snap.rows && snap.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xs border border-ink-500">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-ink-50">
              <tr>
                {snap.columns.map((c) => (
                  <th key={c.name} className="px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-paper-faint">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snap.rows.slice(0, 50).map((row, i) => (
                <tr key={i} className="border-t border-ink-500">
                  {snap.columns!.map((c) => (
                    <td key={c.name} className="px-2 py-1 font-mono text-paper">{String(row[c.name] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        run.status !== "error" && <p className="text-[11px] text-paper-muted">No row snapshot.</p>
      )}
    </div>
  );
}

export function RunsTab({ selectedJobId }: { selectedJobId?: string }) {
  const { data: jobs } = useScheduledQueries();
  const navigate = useNavigate();
  const { hasPermission } = useRbacStore();
  const canViewLogs = hasPermission(RBAC_PERMISSIONS.LOGS_VIEW);
  const canViewAll = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_VIEW_ALL);
  const canDelete = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_DELETE);
  const openInLogs = (queryId: string) => navigate(`/monitoring/logs?q=${encodeURIComponent(queryId)}`);
  const { options: ownerOptions } = useJobOwners(jobs, canViewAll);
  const deleteRunsMut = useDeleteRuns();
  const [jobId, setJobId] = useState<string>("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [status, setStatus] = useState<SqStatus | "all">("all");
  const [dateRange, setDateRange] = useState<{ start?: Date; end?: Date }>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<string>("filters");

  const jobOptions = (jobs ?? []).filter((j) => ownerFilter === "all" || j.createdBy === ownerFilter);
  const selectedJob = jobOptions.find((j) => j.id === jobId);

  // If the selected job no longer matches the owner filter, drop to the first match.
  useEffect(() => {
    if (selectedJobId) {
      setJobId(selectedJobId);
      return;
    }
    if (jobOptions.length === 0) return;
    if (!jobId || !jobOptions.some((j) => j.id === jobId)) setJobId(jobOptions[0].id);
  }, [selectedJobId, jobOptions, jobId]);

  const from = dateRange.start ? startOfDay(dateRange.start).getTime() : undefined;
  const to = dateRange.end ? endOfDay(dateRange.end).getTime() : undefined;

  const { data: runs, isLoading } = useScheduledQueryRuns(
    jobId,
    { status: status === "all" ? undefined : status, from, to },
    Boolean(jobId),
  );

  useEffect(() => setPage(1), [jobId, status, from, to, pageSize]);

  const handleDelete = async () => {
    const opts: RunQuery =
      deleteScope === "filters"
        ? { status: status === "all" ? undefined : status, from, to }
        : deleteScope === "all"
          ? {}
          : { olderThanDays: Number(deleteScope) };
    try {
      const deleted = await deleteRunsMut.mutateAsync({ id: jobId, opts });
      toast.success(`Deleted ${deleted} run(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteOpen(false);
    }
  };

  const dateLabel = useMemo(() => {
    if (!dateRange.start) return "Date range";
    if (dateRange.end && format(dateRange.start, "MMM d") !== format(dateRange.end, "MMM d"))
      return `${format(dateRange.start, "MMM d")} – ${format(dateRange.end, "MMM d, yyyy")}`;
    return format(dateRange.start, "MMM d, yyyy");
  }, [dateRange]);

  const total = runs?.length ?? 0;
  const pageRuns = (runs ?? []).slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canViewAll && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-[170px] rounded-xs"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {ownerOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <JobCombobox jobs={jobOptions} value={jobId} onChange={setJobId} />
        <Select value={status} onValueChange={(v) => setStatus(v as SqStatus | "all")}>
          <SelectTrigger className="h-9 w-40 rounded-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Failed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-200">
              <CalendarIcon className="h-3.5 w-3.5 text-paper-dim" />
              {dateLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto rounded-xs border border-ink-500 bg-ink-100 p-0" align="start">
            <div className="flex">
              <div className="flex w-36 flex-col gap-1 border-r border-ink-500 bg-ink-200 p-3">
                <p className="mb-1 px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-dim">Presets</p>
                {[
                  { label: "Last 7 days", v: () => ({ start: subDays(new Date(), 7), end: new Date() }) },
                  { label: "Last 30 days", v: () => ({ start: subDays(new Date(), 30), end: new Date() }) },
                  { label: "Last 90 days", v: () => ({ start: subDays(new Date(), 90), end: new Date() }) },
                ].map((p) => (
                  <Button key={p.label} variant="ghost" size="sm" className="h-8 w-full justify-start rounded-xs font-mono text-[11px] uppercase tracking-[0.12em] text-paper-muted hover:bg-ink-100 hover:text-paper" onClick={() => setDateRange(p.v())}>
                    {p.label}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" className="mt-1 h-8 w-full justify-start rounded-xs font-mono text-[11px] uppercase tracking-[0.12em] text-red-500 hover:text-red-700 dark:text-red-400" onClick={() => setDateRange({})}>
                  Clear
                </Button>
              </div>
              <div className="p-3">
                <Calendar
                  mode="range"
                  selected={{ from: dateRange.start, to: dateRange.end }}
                  onSelect={(r) => setDateRange({ start: r?.from, end: r?.to })}
                  initialFocus
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {canDelete && jobId && (
          <Button variant="outline" className="h-9 gap-2 rounded-xs border-ink-500 px-3 text-red-600 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete runs
          </Button>
        )}
      </div>

      {!jobId ? (
        <p className="text-[12px] text-paper-muted">Select a job to view its runs.</p>
      ) : isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xs" />)}</div>
      ) : total === 0 ? (
        <p className="text-[12px] text-paper-muted">No runs yet.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {pageRuns.map((run) => (
              <Card
                key={run.id}
                className={cn(
                  "rounded-xs border-ink-500 bg-ink-100",
                  (run.status === "failed" || run.status === "error") && "border-l-2 border-l-red-500",
                )}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                    className="flex flex-1 items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge status={run.status} />
                      <span className="text-[12px] text-paper">{formatTime(run.startedAt)}</span>
                      <span className="font-mono text-[10px] text-paper-faint">
                        {run.trigger}
                        {run.attempt > 1 ? ` · attempt ${run.attempt}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[10px] text-paper-muted">
                      {run.writtenRows != null ? <span>{run.writtenRows} written</span> : run.rowCount != null && <span>{run.rowCount} rows</span>}
                      <span>{formatDuration(run.durationMs)}</span>
                    </div>
                  </button>
                  {canViewLogs ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openInLogs(run.id); }}
                      title={`Open query_id ${run.id} in Query Logs`}
                      className="flex shrink-0 items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted hover:border-brand hover:text-paper"
                    >
                      <FileSearch className="h-3 w-3" />
                      {run.id.slice(0, 8)}
                    </button>
                  ) : (
                    <span title={run.id} className="shrink-0 font-mono text-[10px] text-paper-faint">{run.id.slice(0, 8)}</span>
                  )}
                </div>
                {expanded === run.id && <RunSnapshot run={run} />}
              </Card>
            ))}
          </div>
          <TablePagination page={page} total={total} pageSize={pageSize} rowLabel="runs" onPageChange={setPage} onPageSizeChange={setPageSize} />
        </>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete runs for "{selectedJob?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete run history (and any pending notifications). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Scope</p>
            <Select value={deleteScope} onValueChange={setDeleteScope}>
              <SelectTrigger className="h-9 rounded-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="filters">
                  Matching current filters{status !== "all" ? ` · ${status}` : ""}{dateRange.start ? ` · ${dateLabel}` : ""}
                </SelectItem>
                <SelectItem value="7">Older than 7 days</SelectItem>
                <SelectItem value="30">Older than 30 days</SelectItem>
                <SelectItem value="90">Older than 90 days</SelectItem>
                <SelectItem value="all">All runs for this job</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteRunsMut.isPending} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
