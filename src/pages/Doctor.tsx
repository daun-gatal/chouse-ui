/**
 * Doctor — ChouseD, the AI fleet doctor, as a first-class page.
 *
 * Master-detail: a history rail of past scans (persisted in the DB) on the left,
 * the selected report rendered richly on the right. Each report has its own URL
 * (/doctor/:reportId) so it's shareable and deep-linkable. "Run health check"
 * kicks off an agentic, read-only scan; the new report is saved, selected, and
 * dropped at the top of the history.
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Stethoscope, Loader2, Sparkles, AlertCircle, Server, Check, ChevronDown, Trash2, ListChecks, X, CalendarClock, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useFleetConnections } from "@/hooks/useFleetMetrics";
import {
  fetchDoctorEnabled,
  fetchDoctorModels,
  runDoctorScan,
  fetchDoctorReports,
  fetchDoctorReport,
  deleteDoctorReports,
  deleteAllDoctorReports,
} from "@/api/fleet";
import DoctorReportView from "@/features/fleet/components/DoctorReportView";
import DoctorHistoryList from "@/features/fleet/components/DoctorHistoryList";
import DoctorScheduleDialog from "@/features/fleet/components/DoctorScheduleDialog";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";

const INVESTIGATION_STEPS = [
  "Reading the fleet overview",
  "Drilling into nodes (read-only)",
  "Checking the last 6h of heavy queries",
  "Writing the root-cause report",
];

function InvestigatingPanel({ model }: { model?: string }) {
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <span className="relative grid h-16 w-16 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-brand/20" aria-hidden />
        <span className="grid h-16 w-16 place-items-center rounded-full border border-ink-500 bg-ink-200 text-brand">
          <Stethoscope className="h-7 w-7" aria-hidden />
        </span>
      </span>
      <div>
        <p className="flex items-center justify-center gap-2 text-[14px] font-medium text-paper">
          <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
          Chouse AI is investigating your fleet…
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          ~10–30s{model ? ` · ${model}` : ""}
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {INVESTIGATION_STEPS.map((step, i) => (
          <li
            key={i}
            className="flex items-center gap-2 font-mono text-[11px] text-paper-muted"
            style={{ animation: `pulse 2s ease-in-out ${i * 0.25}s infinite` }}
          >
            <span className="h-1 w-1 rounded-full bg-brand" aria-hidden />
            {step}
          </li>
        ))}
      </ul>
    </div>
  );
}

const WINDOW_OPTIONS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "3d", hours: 72 },
];

/** Investigation window (lookback) selector — segmented button group. */
function WindowSelect({
  hours,
  onChange,
  disabled,
}: {
  hours: number;
  onChange: (h: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-xs border border-ink-500"
      role="radiogroup"
      aria-label="Investigation window"
      title="How far back to look"
    >
      {WINDOW_OPTIONS.map((opt, idx) => {
        const selected = hours === opt.hours;
        return (
          <button
            key={opt.hours}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.hours)}
            className={cn(
              "h-9 px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
              "disabled:opacity-50",
              idx > 0 && "border-l border-ink-500",
              selected
                ? "bg-brand text-ink-50"
                : "bg-ink-100 text-paper-muted hover:bg-ink-200 hover:text-paper",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select node scope (popover of checkboxes). null selection = all nodes. */
function ScopePicker({
  nodes,
  selected,
  allSelected,
  onAll,
  onToggle,
  disabled,
}: {
  nodes: { id: string; name: string }[];
  selected: string[] | null;
  allSelected: boolean;
  onAll: () => void;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const effective = new Set(selected ?? nodes.map((n) => n.id));
  const label = allSelected ? "All nodes" : `${effective.size}/${nodes.length} nodes`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2.5 text-paper-muted transition-colors hover:bg-ink-300 hover:text-paper disabled:opacity-50"
          title="Which nodes to scan"
        >
          <Server className="h-3.5 w-3.5" aria-hidden />
          <span className="font-mono text-[11px] uppercase tracking-[0.1em]">{label}</span>
          <ChevronDown className="h-3 w-3 text-paper-faint" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 rounded-xs border border-ink-500 bg-ink-100 p-1">
        <ScopeRow checked={allSelected} label="All nodes" onClick={onAll} bold />
        <div className="my-1 h-px bg-ink-500" aria-hidden />
        <div className="max-h-60 overflow-y-auto">
          {nodes.map((n) => (
            <ScopeRow key={n.id} checked={effective.has(n.id)} label={n.name} onClick={() => onToggle(n.id)} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScopeRow({
  checked,
  label,
  onClick,
  bold,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
  bold?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-[12px] text-paper-muted transition-colors hover:bg-ink-200"
    >
      <span
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded-xs border transition-colors",
          checked ? "border-brand bg-brand text-ink-50" : "border-ink-500",
        )}
      >
        {checked && <Check className="h-3 w-3" aria-hidden />}
      </span>
      <span className={cn("truncate", bold && "font-medium text-paper")}>{label}</span>
    </button>
  );
}

/** Pending-scan entry pinned to the top of the history rail — blinking dot while it runs. */
function RunningCard({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div className="px-2 pt-2">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "group relative w-full rounded-xs border px-2.5 py-2 text-left transition-colors",
          active ? "border-brand/50 bg-ink-200" : "border-ink-500/60 hover:bg-ink-200/50",
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-brand" aria-hidden />
        )}
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-brand">Running…</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-paper-muted">
          Chouse AI is investigating…
        </p>
      </button>
    </div>
  );
}

export default function Doctor() {
  const { reportId } = useParams<{ reportId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useRbacStore();
  // doctor:view gates the page (route); doctor:run gates *generating* a report
  // (manual scan + scheduling). A view-only user browses history but can't run.
  const canRun = hasPermission(RBAC_PERMISSIONS.DOCTOR_RUN);
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[] | null>(null); // null = all nodes
  const [hours, setHours] = useState(6);
  // While a scan runs, this tracks whether the user is watching the live progress
  // or has clicked away to read another report (so the scan never blocks browsing).
  const [viewingRunning, setViewingRunning] = useState(false);
  // History bulk-delete selection.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const connectionsQuery = useFleetConnections();
  const nodes = (connectionsQuery.data ?? [])
    .filter((c) => c.isActive)
    .map((c) => ({ id: c.id, name: c.name }));

  // Scope: null (or full set) = all nodes → send undefined so the backend stays
  // in sync even if the fleet changes; a real subset is sent explicitly.
  const allNodesSelected =
    selectedNodeIds === null || (nodes.length > 0 && selectedNodeIds.length === nodes.length);
  const scopeEmpty = selectedNodeIds !== null && selectedNodeIds.length === 0;
  const scopeIds = allNodesSelected || scopeEmpty ? undefined : selectedNodeIds ?? undefined;

  const toggleNode = (id: string) => {
    const base = new Set(selectedNodeIds ?? nodes.map((n) => n.id));
    if (base.has(id)) base.delete(id);
    else base.add(id);
    setSelectedNodeIds(base.size === nodes.length ? null : [...base]);
  };

  const enabledQuery = useQuery({
    queryKey: ["fleet", "doctor", "enabled"],
    queryFn: fetchDoctorEnabled,
    staleTime: 60_000,
  });
  const enabled = enabledQuery.data?.enabled;

  const modelsQuery = useQuery({
    queryKey: ["fleet", "doctor", "models"],
    queryFn: fetchDoctorModels,
    enabled: enabled !== false,
    staleTime: 60_000,
  });
  const models = modelsQuery.data ?? [];
  const resolvedModelId = selectedModelId ?? models.find((m) => m.isDefault)?.id ?? models[0]?.id;

  const reportsQuery = useQuery({
    queryKey: ["fleet", "doctor", "reports"],
    queryFn: fetchDoctorReports,
    enabled: enabled !== false,
    staleTime: 30_000,
  });
  const reports = reportsQuery.data ?? [];

  const reportQuery = useQuery({
    queryKey: ["fleet", "doctor", "report", reportId],
    queryFn: () => fetchDoctorReport(reportId!),
    enabled: !!reportId && enabled !== false,
  });

  const scan = useMutation({
    mutationFn: () => runDoctorScan({ modelId: resolvedModelId, connectionIds: scopeIds, hours }),
    onSuccess: (report) => {
      queryClient.setQueryData(["fleet", "doctor", "report", report.id], report);
      queryClient.invalidateQueries({ queryKey: ["fleet", "doctor", "reports"] });
      setViewingRunning(false);
      navigate(`/doctor/${report.id}`);
    },
    onError: (e) => {
      setViewingRunning(false);
      toast.error(e instanceof Error ? e.message : "Scan failed");
    },
  });

  const del = useMutation({
    mutationFn: (vars: { ids?: string[]; all?: boolean }) =>
      vars.all ? deleteAllDoctorReports() : deleteDoctorReports(vars.ids ?? []),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["fleet", "doctor", "reports"] });
      toast.success(vars.all ? "History cleared" : `Deleted ${vars.ids?.length ?? 0} report(s)`);
      setSelectMode(false);
      setSelectedIds(new Set());
      // If the open report was among the deleted, fall back to the latest/empty.
      if (vars.all || (reportId && vars.ids?.includes(reportId))) {
        navigate("/doctor", { replace: true });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // No report selected but history exists → jump to the newest.
  useEffect(() => {
    if (!reportId && !scan.isPending && reports.length > 0) {
      navigate(`/doctor/${reports[0].id}`, { replace: true });
    }
  }, [reportId, reports, scan.isPending, navigate]);

  const showPicker = canRun && enabled !== false && models.length > 1;
  const canScan = canRun && enabled !== false && !scan.isPending && !scopeEmpty;

  // Clicking a report stops "watching the run" so the panel shows that report,
  // even while a scan is still in flight.
  const handleSelect = (id: string) => {
    setViewingRunning(false);
    navigate(`/doctor/${id}`);
  };
  const startScan = () => {
    setViewingRunning(true);
    scan.mutate();
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50">
      {/* Header */}
      <header className="flex-none border-b border-ink-500 px-6 pb-4 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-brand">
              <Stethoscope className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="flex flex-col gap-0">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                Chouse AI · read-only
              </span>
              <div className="flex items-baseline gap-2">
                <h1 className="text-[18px] font-semibold leading-tight tracking-tight text-paper">
                  Fleet Doctor
                </h1>
                {reports.length > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-paper-muted">
                    {reports.length}{" "}
                    <span className="text-paper-dim">{reports.length === 1 ? "report" : "reports"}</span>
                  </span>
                )}
                {!canRun && (
                  <span
                    className="inline-flex items-center gap-1 self-center rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-muted"
                    title="You can view reports but not run scans (needs Run Chouse AI Doctor Scan)"
                  >
                    <ShieldOff className="h-2.5 w-2.5" aria-hidden /> View only
                  </span>
                )}
              </div>
            </div>
          </div>

          {enabled !== false && canRun && (
            <div className="flex flex-wrap items-center gap-2">
              {nodes.length > 1 && (
                <ScopePicker
                  nodes={nodes}
                  selected={selectedNodeIds}
                  allSelected={allNodesSelected}
                  onAll={() => setSelectedNodeIds(null)}
                  onToggle={toggleNode}
                  disabled={scan.isPending}
                />
              )}
              <WindowSelect hours={hours} onChange={setHours} disabled={scan.isPending} />
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted transition-colors hover:bg-ink-300 hover:text-paper"
                title="Scheduled scans (daily / weekly / monthly)"
              >
                <CalendarClock className="h-4 w-4" aria-hidden />
              </button>
              {showPicker && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={scan.isPending}
                      className="inline-flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-100 px-2 py-1 font-mono text-[11px] text-paper transition-colors hover:border-ink-700 hover:bg-ink-300 max-w-[180px] disabled:opacity-50"
                    >
                      <span className="truncate">
                        {models.find((m) => m.id === resolvedModelId)?.label ?? "Select model"}
                      </span>
                      <ChevronDown className="h-3 w-3 shrink-0 text-paper-dim" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[240px] rounded-md border-ink-500 bg-ink-100 p-0">
                    <div className="border-b border-ink-500 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                      AI Models
                    </div>
                    <div className="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto p-1">
                      {models.map((m) => {
                        const isCurrent = resolvedModelId === m.id;
                        return (
                          <DropdownMenuItem
                            key={m.id}
                            onClick={() => setSelectedModelId(m.id)}
                            className={cn(
                              "flex cursor-pointer items-start gap-2.5 rounded-xs px-3 py-2 transition-colors hover:bg-ink-200",
                              isCurrent && "bg-ink-200",
                            )}
                          >
                            <div className="mt-0.5 flex-shrink-0">
                              <div className={cn(
                                "grid h-3.5 w-3.5 place-items-center rounded-full border",
                                isCurrent ? "border-brand" : "border-ink-700",
                              )}>
                                {isCurrent && <div className="h-1.5 w-1.5 rounded-full bg-brand" />}
                              </div>
                            </div>
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span className={cn(
                                "truncate text-[13px] font-medium",
                                isCurrent ? "text-paper" : "text-paper-muted",
                              )}>
                                {m.label}
                              </span>
                              <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                {m.provider || m.model}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        );
                      })}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                onClick={startScan}
                disabled={!canScan}
                className="h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                {scan.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Investigating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" /> {reportId ? "Re-scan" : "Run health check"}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Body: history rail + detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* History rail (md+) */}
        {enabled !== false && (
          <aside className="hidden w-64 flex-none flex-col border-r border-ink-500 md:flex">
            <div className="flex-none border-b border-ink-500 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                  {selectMode ? `${selectedIds.size} selected` : "History"}
                </span>
                {reports.length > 0 &&
                  (selectMode ? (
                    <button
                      type="button"
                      onClick={exitSelect}
                      className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint transition-colors hover:text-paper"
                    >
                      <X className="h-3 w-3" aria-hidden /> Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSelectMode(true)}
                      className="grid h-6 w-6 place-items-center rounded-xs text-paper-faint transition-colors hover:bg-ink-200 hover:text-paper"
                      title="Select reports to delete"
                    >
                      <ListChecks className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ))}
              </div>
              {selectMode && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => del.mutate({ ids: [...selectedIds] })}
                    disabled={selectedIds.size === 0 || del.isPending}
                    className="inline-flex h-7 items-center gap-1 rounded-xs border border-red-500/40 px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden /> Delete ({selectedIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete all ${reports.length} reports? This can't be undone.`)) {
                        del.mutate({ all: true });
                      }
                    }}
                    disabled={del.isPending}
                    className="inline-flex h-7 items-center rounded-xs border border-ink-500 px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-paper-muted transition-colors hover:bg-ink-200 hover:text-paper disabled:opacity-40"
                  >
                    All
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {scan.isPending && (
                <RunningCard active={viewingRunning} onClick={() => setViewingRunning(true)} />
              )}
              <DoctorHistoryList
                reports={reports}
                activeId={viewingRunning ? undefined : reportId}
                onSelect={handleSelect}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            </div>
          </aside>
        )}

        {/* Detail */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Mobile history switcher */}
          {enabled !== false && (reports.length > 0 || scan.isPending) && (
            <select
              value={viewingRunning ? "__running__" : reportId ?? ""}
              onChange={(e) => {
                if (e.target.value === "__running__") setViewingRunning(true);
                else handleSelect(e.target.value);
              }}
              className="mb-4 h-9 w-full rounded-xs border border-ink-500 bg-ink-200 px-2 text-[12px] text-paper focus:border-brand focus:outline-none md:hidden"
            >
              {scan.isPending && <option value="__running__">⟳ Investigating…</option>}
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.summary ? r.summary.slice(0, 60) : "Health report"}
                </option>
              ))}
            </select>
          )}

          <div className="mx-auto max-w-3xl">
            {enabled === false ? (
              <p className="rounded-xs border border-ink-500 bg-ink-200 px-4 py-3 text-[12px] text-paper-muted">
                No AI provider configured. Set one up in{" "}
                <strong className="text-paper">Settings → AI</strong> (any OpenAI / Anthropic /
                OpenAI-compatible — including a local model) to use Chouse AI.
              </p>
            ) : scan.isPending && viewingRunning ? (
              <InvestigatingPanel model={models.find((m) => m.id === resolvedModelId)?.model} />
            ) : reportId && reportQuery.data ? (
              <DoctorReportView report={reportQuery.data} />
            ) : reportId && reportQuery.isLoading ? (
              <div className="flex flex-col items-center gap-3 py-16 text-paper-muted">
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em]">Loading report…</span>
              </div>
            ) : reportId && reportQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <AlertCircle className="h-7 w-7 text-amber-500" aria-hidden />
                <p className="text-[13px] text-paper-muted">
                  This report couldn't be found — it may have aged out of the history.
                </p>
                <Button
                  variant="ghost"
                  onClick={() => navigate("/doctor", { replace: true })}
                  className="h-8 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em]"
                >
                  Back to latest
                </Button>
              </div>
            ) : (
              /* Empty state — no reports yet */
              <div className="flex flex-col items-center gap-5 py-16 text-center">
                <span className="grid h-16 w-16 place-items-center rounded-full border border-ink-500 bg-ink-200 text-paper-muted">
                  <Stethoscope className="h-7 w-7" aria-hidden />
                </span>
                <div>
                  <h2 className="text-[16px] font-semibold text-paper">No health checks yet</h2>
                  <p className="mx-auto mt-1 max-w-sm text-[13px] text-paper-muted">
                    Chouse AI scans every node, drills in with read-only diagnostics, and writes a
                    root-cause report with recommendations. It can only observe — never change anything.
                  </p>
                </div>
                {canRun ? (
                  <Button
                    onClick={startScan}
                    disabled={!canScan}
                    className="h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Run your first health check
                  </Button>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                      <ShieldOff className="h-3 w-3" aria-hidden /> View only
                    </span>
                    <p className="max-w-sm text-[12px] text-paper-muted">
                      You can view reports but not run scans. Ask an administrator to grant{" "}
                      <strong className="text-paper">Run Chouse AI Doctor Scan</strong>{" "}
                      <span className="whitespace-nowrap text-paper-faint">(Admin → Roles)</span>.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      <DoctorScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
    </div>
  );
}
