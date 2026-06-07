/**
 * DoctorScheduleDialog — configure recurring Chouse AI scans (daily / weekly /
 * monthly). The scan runs server-side, is saved to the report history, and
 * (optionally) delivered to the alert channels. Times are UTC.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useFleetConnections } from "@/hooks/useFleetMetrics";
import {
  fetchDoctorSchedule,
  updateDoctorSchedule,
  fetchDoctorModels,
} from "@/api/fleet";

const labelCls = "font-mono text-[9px] uppercase tracking-[0.14em] text-paper-dim";
const selectCls =
  "h-9 rounded-xs border border-ink-500 bg-ink-200 px-2 text-[12px] text-paper focus:border-brand focus:outline-none disabled:opacity-50";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
// The scan window is tied to the cadence: each run covers exactly one period back.
const FREQ_WINDOW_HOURS: Record<(typeof FREQUENCIES)[number], number> = {
  daily: 24,
  weekly: 168,
  monthly: 720,
};
const FREQ_WINDOW_LABEL: Record<(typeof FREQUENCIES)[number], string> = {
  daily: "last 24h",
  weekly: "last 7 days",
  monthly: "last 30 days",
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        checked ? "bg-brand" : "bg-ink-400",
      )}
    >
      <span
        className={cn(
          "h-3 w-3 rounded-full bg-ink-50 shadow-sm transition-transform",
          checked ? "translate-x-3" : "translate-x-0",
        )}
        aria-hidden
      />
    </button>
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
      className="flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-[12px] text-paper-muted transition-colors hover:bg-ink-300"
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

export default function DoctorScheduleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["fleet", "doctor", "schedule"],
    queryFn: fetchDoctorSchedule,
    enabled: open,
  });
  const modelsQuery = useQuery({
    queryKey: ["fleet", "doctor", "models"],
    queryFn: fetchDoctorModels,
    enabled: open,
  });
  const models = modelsQuery.data ?? [];

  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [hour, setHour] = useState(8);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [modelId, setModelId] = useState<string>();
  const [deliver, setDeliver] = useState(true);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[] | null>(null); // null = all
  const resolvedModelId = modelId ?? models.find((m) => m.isDefault)?.id ?? models[0]?.id;
  // Window is derived from the cadence (daily=24h, weekly=7d, monthly=30d).
  const derivedHours = FREQ_WINDOW_HOURS[frequency];

  const connectionsQuery = useFleetConnections();
  const nodes = (connectionsQuery.data ?? [])
    .filter((c) => c.isActive)
    .map((c) => ({ id: c.id, name: c.name }));
  const allNodesSelected =
    selectedNodeIds === null || (nodes.length > 0 && selectedNodeIds.length === nodes.length);
  const effectiveNodes = new Set(selectedNodeIds ?? nodes.map((n) => n.id));
  const scopeIds = allNodesSelected ? undefined : selectedNodeIds ?? undefined;
  const toggleNode = (id: string) => {
    const base = new Set(selectedNodeIds ?? nodes.map((n) => n.id));
    if (base.has(id)) base.delete(id);
    else base.add(id);
    setSelectedNodeIds(base.size === nodes.length ? null : [...base]);
  };

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setFrequency(data.frequency);
    setHour(data.hour);
    setDayOfWeek(data.dayOfWeek);
    setDayOfMonth(data.dayOfMonth);
    setModelId(data.modelId ?? undefined);
    setDeliver(data.deliver);
    setSelectedNodeIds(data.connectionIds && data.connectionIds.length ? data.connectionIds : null);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      updateDoctorSchedule({
        enabled,
        frequency,
        hour,
        dayOfWeek,
        dayOfMonth,
        modelId: resolvedModelId,
        hours: derivedHours,
        deliver,
        connectionIds: scopeIds,
      }),
    onSuccess: () => {
      toast.success("Schedule saved");
      qc.invalidateQueries({ queryKey: ["fleet", "doctor", "schedule"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const hh = `${String(hour).padStart(2, "0")}:00 UTC`;
  const win = FREQ_WINDOW_LABEL[frequency];
  const cadenceText =
    frequency === "daily"
      ? `Every day at ${hh} · scans ${win}`
      : frequency === "weekly"
        ? `Every ${DOW[dayOfWeek]} at ${hh} · scans ${win}`
        : `Day ${dayOfMonth} of each month at ${hh} · scans ${win}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-brand">
              <CalendarClock className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[16px] font-semibold tracking-tight">Scheduled scans</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                Chouse AI · recurring
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="text-paper-muted">
            Run a fleet health scan automatically and save it to history. Runs server-side — no
            browser needed.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-paper-dim" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Master enable */}
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className="flex w-full items-center justify-between rounded-xs border border-ink-500 bg-ink-200 px-4 py-3"
            >
              <span className="flex flex-col text-left">
                <span className="text-[13px] font-medium text-paper">Schedule enabled</span>
                {enabled && <span className="mt-0.5 font-mono text-[10px] text-paper-faint">{cadenceText}</span>}
              </span>
              <span
                className={cn(
                  "inline-flex h-4 w-7 items-center rounded-full px-0.5 transition-colors",
                  enabled ? "bg-brand" : "bg-ink-400",
                )}
              >
                <span
                  className={cn(
                    "h-3 w-3 rounded-full bg-ink-50 transition-transform",
                    enabled ? "translate-x-3" : "translate-x-0",
                  )}
                />
              </span>
            </button>

            <div className={cn("space-y-4 transition-opacity", !enabled && "opacity-40")}>
              {/* Frequency */}
              <div className="space-y-1.5">
                <div className={labelCls}>Frequency</div>
                <div className="grid grid-cols-3 gap-2">
                  {FREQUENCIES.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className={cn(
                        "h-9 rounded-xs border text-[12px] capitalize transition-colors",
                        frequency === f
                          ? "border-brand bg-brand/10 text-paper"
                          : "border-ink-500 bg-ink-200 text-paper-muted hover:text-paper",
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time + day */}
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Run at (UTC)</span>
                  <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={selectCls}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>

                {frequency === "weekly" && (
                  <label className="flex flex-col gap-1">
                    <span className={labelCls}>Day of week</span>
                    <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} className={selectCls}>
                      {DOW.map((d, i) => (
                        <option key={i} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {frequency === "monthly" && (
                  <label className="flex flex-col gap-1">
                    <span className={labelCls}>Day of month</span>
                    <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className={selectCls}>
                      {Array.from({ length: 28 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {/* Window (auto from cadence) + model */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className={labelCls}>Scan window</span>
                  <div
                    className="flex h-9 items-center rounded-xs border border-ink-500 bg-ink-100 px-2 text-[12px] text-paper-muted"
                    title="Tied to the cadence — daily=24h, weekly=7d, monthly=30d"
                  >
                    {win}
                  </div>
                </div>
                {models.length > 1 && (
                  <div className="flex flex-col gap-1">
                    <span className={labelCls}>Model</span>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-100 px-2 py-1 font-mono text-[11px] text-paper transition-colors hover:border-ink-700 hover:bg-ink-300 max-w-[180px]"
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
                                onClick={() => setModelId(m.id)}
                                className={cn(
                                  "flex cursor-pointer items-start gap-2.5 rounded-xs px-3 py-2 transition-colors hover:bg-ink-200",
                                  isCurrent && "bg-ink-200",
                                )}
                              >
                                <div className="mt-0.5 flex-shrink-0">
                                  <div
                                    className={cn(
                                      "grid h-3.5 w-3.5 place-items-center rounded-full border",
                                      isCurrent ? "border-brand" : "border-ink-700",
                                    )}
                                  >
                                    {isCurrent && <div className="h-1.5 w-1.5 rounded-full bg-brand" />}
                                  </div>
                                </div>
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span
                                    className={cn(
                                      "truncate text-[13px] font-medium",
                                      isCurrent ? "text-paper" : "text-paper-muted",
                                    )}
                                  >
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
                  </div>
                )}
              </div>

              {/* Nodes */}
              {nodes.length > 1 && (
                <div className="space-y-1.5">
                  <div className={labelCls}>
                    Nodes · {allNodesSelected ? "all" : `${effectiveNodes.size}/${nodes.length}`}
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded-xs border border-ink-500 bg-ink-200 p-1">
                    <ScopeRow
                      checked={allNodesSelected}
                      label="All nodes"
                      onClick={() => setSelectedNodeIds(null)}
                      bold
                    />
                    <div className="my-1 h-px bg-ink-500" aria-hidden />
                    {nodes.map((n) => (
                      <ScopeRow
                        key={n.id}
                        checked={effectiveNodes.has(n.id)}
                        label={n.name}
                        onClick={() => toggleNode(n.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Deliver */}
              <div className="flex items-center justify-between rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
                <span className="flex flex-col">
                  <span className="text-[13px] font-medium text-paper">Send to Slack / email</span>
                  <span className="font-mono text-[10px] text-paper-faint">Uses the alert delivery channels</span>
                </span>
                <Switch checked={deliver} onChange={setDeliver} label="Deliver scheduled report" />
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-ink-500 pt-4">
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save schedule
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
