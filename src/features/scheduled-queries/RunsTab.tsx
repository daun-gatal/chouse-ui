/**
 * Scheduled Queries → Runs: a reverse-chronological run feed for a selected job,
 * filterable by status. Expanding a run shows its bounded result snapshot and the
 * substituted window params. House tokens only.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileSearch } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import type { ScheduledQueryRun, SqStatus } from "@/api/scheduledQueries";
import { useScheduledQueries, useScheduledQueryRuns, useJobOwners } from "./hooks";
import { StatusBadge, formatTime, formatDuration } from "./lib";
import { TablePagination } from "./TablePagination";

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
  const openInLogs = (queryId: string) => navigate(`/monitoring/logs?q=${encodeURIComponent(queryId)}`);
  const { options: ownerOptions } = useJobOwners(jobs, canViewAll);
  const [jobId, setJobId] = useState<string>("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [status, setStatus] = useState<SqStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const jobOptions = (jobs ?? []).filter((j) => ownerFilter === "all" || j.createdBy === ownerFilter);

  // If the selected job no longer matches the owner filter, drop to the first match.
  useEffect(() => {
    if (selectedJobId) {
      setJobId(selectedJobId);
      return;
    }
    if (jobOptions.length === 0) return;
    if (!jobId || !jobOptions.some((j) => j.id === jobId)) setJobId(jobOptions[0].id);
  }, [selectedJobId, jobOptions, jobId]);

  const { data: runs, isLoading } = useScheduledQueryRuns(jobId, status === "all" ? undefined : status, Boolean(jobId));

  useEffect(() => setPage(1), [jobId, status, pageSize]);

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
        <Select value={jobId} onValueChange={setJobId}>
          <SelectTrigger className="h-9 w-56 rounded-xs"><SelectValue placeholder="Select a job" /></SelectTrigger>
          <SelectContent>
            {jobOptions.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as SqStatus | "all")}>
          <SelectTrigger className="h-9 w-40 rounded-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Failed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
          </SelectContent>
        </Select>
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
    </div>
  );
}
