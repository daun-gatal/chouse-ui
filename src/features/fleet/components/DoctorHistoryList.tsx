/**
 * DoctorHistoryList — the left rail of past Chouse AI scans, newest first.
 * Each row: status dot + verdict summary + relative time/model. The active
 * report is highlighted with a brand marker. In select mode, rows show a
 * checkbox and clicking toggles selection (for bulk delete) instead of opening.
 */

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FleetDoctorReportSummary } from "@/api/fleet";
import { DOCTOR_STATUS, timeAgo } from "./doctorShared";

export default function DoctorHistoryList({
  reports,
  activeId,
  onSelect,
  selectMode = false,
  selectedIds,
  onToggleSelect,
  className,
}: {
  reports: FleetDoctorReportSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  className?: string;
}) {
  if (reports.length === 0) {
    return (
      <div className={cn("px-3 py-6 text-center", className)}>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">No scans yet</p>
      </div>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-0.5 p-2", className)}>
      {reports.map((r) => {
        const s = r.status ? DOCTOR_STATUS[r.status] : null;
        const isSelected = selectMode && (selectedIds?.has(r.id) ?? false);
        const isActive = !selectMode && r.id === activeId;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => (selectMode ? onToggleSelect?.(r.id) : onSelect(r.id))}
              aria-current={isActive ? "true" : undefined}
              aria-pressed={selectMode ? isSelected : undefined}
              className={cn(
                "group relative w-full rounded-xs border px-2.5 py-2 text-left transition-colors",
                isActive || isSelected
                  ? "border-ink-600 bg-ink-200"
                  : "border-transparent hover:border-ink-500 hover:bg-ink-200/50",
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-brand" aria-hidden />
              )}
              <div className="flex items-center gap-2">
                {selectMode && (
                  <span
                    className={cn(
                      "grid h-4 w-4 shrink-0 place-items-center rounded-xs border transition-colors",
                      isSelected ? "border-brand bg-brand text-ink-50" : "border-ink-500",
                    )}
                    aria-hidden
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </span>
                )}
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", s?.dot ?? "bg-ink-600")}
                  aria-hidden
                />
                <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">
                  {timeAgo(r.createdAt)}
                </span>
                {r.trigger === "auto" && (
                  <span className="rounded-xs border border-brand/40 px-1 font-mono text-[8px] uppercase tracking-[0.1em] text-brand">
                    auto
                  </span>
                )}
                {r.trigger === "scheduled" && (
                  <span className="rounded-xs border border-ink-500 px-1 font-mono text-[8px] uppercase tracking-[0.1em] text-paper-dim">
                    sched
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-paper-dim">
                  {r.nodeCount}n
                </span>
              </div>
              <p
                className={cn(
                  "mt-1 line-clamp-2 text-[12px] leading-snug",
                  isActive ? "text-paper" : "text-paper-muted",
                )}
              >
                {r.summary || "Health report"}
              </p>
              {r.model && (
                <p className="mt-1 truncate font-mono text-[9px] text-paper-faint">{r.model}</p>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
