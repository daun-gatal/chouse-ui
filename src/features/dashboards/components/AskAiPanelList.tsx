/**
 * Dashboards › Ask AI › panel list: the draft's panels by section, each with
 * its tick box, status and chart type; a section's box ticks all of it. A
 * blocked panel cannot be ticked and says why in text — nothing here needs
 * hover, so it works the same on touch.
 */

import React from "react";
import { ChartArea, ChartBar, ChartColumnBig, ChartLine, ChartPie, ChartScatter, ChevronRight, CircleAlert, CircleCheck, CircleX, Hash, ListChecks, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BTN_GHOST } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";
import type { DraftPanelStatus } from "@/api/dashboards";
import type { ChartType } from "@/lib/viz/spec";

import { canInclude, groupBySection, statusCounts, type ReviewPanel } from "../askAi";
import { REVIEW_LAYER } from "./askAiLayer";

export type StatusFilter = "all" | DraftPanelStatus;

export const STATUS = {
  ok: { icon: CircleCheck, label: "Checked", className: "text-emerald-300" },
  attention: { icon: CircleAlert, label: "Check this", className: "text-amber-300" },
  blocked: { icon: CircleX, label: "Blocked", className: "text-red-400" },
} as const;

export function chartIcon(type: ChartType | null): React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> {
  switch (type) {
    case "line": case "multi_line": return ChartLine;
    case "area": case "stacked_area": return ChartArea;
    case "bar": case "grouped_bar": case "stacked_bar": case "histogram": return ChartColumnBig;
    case "horizontal_bar": case "funnel": return ChartBar;
    case "pie": case "donut": case "treemap": case "radar": return ChartPie;
    case "scatter": case "heatmap": return ChartScatter;
    case "stat": return Hash;
    case "table": return Table2;
    default: return CircleX;
  }
}

interface Props {
  panels: ReviewPanel[];
  filter: StatusFilter;
  onFilter: (filter: StatusFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInclude: (ids: string[], include: boolean) => void;
  onOnlyChecked: () => void;
  /** An AI request or a save is running: nothing can change. */
  locked: boolean;
}

export function AskAiPanelList({ panels, filter, onFilter, selectedId, onSelect, onInclude, onOnlyChecked, locked }: Props): React.ReactElement {
  const counts = statusCounts(panels);
  const shown = filter === "all" ? panels : panels.filter((p) => p.draft.status === filter);
  const groups = groupBySection(shown);
  const all = panels.filter((p) => canInclude(p.draft)).map((p) => p.id);
  const filters: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: "all", label: "All", count: panels.length },
    { key: "ok", label: "Checked", count: counts.ok },
    { key: "attention", label: "Check this", count: counts.attention },
    { key: "blocked", label: "Blocked", count: counts.blocked },
  ];

  return (
    <div className="flex flex-col" data-testid="draft-panel-list">
      <div className="flex flex-wrap items-center gap-1 border-b border-ink-500 px-3 py-2">
        {filters.filter((f) => f.key === "all" || f.count > 0).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "min-h-8 rounded-xs border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em]",
              filter === f.key ? "border-paper-dim bg-ink-200 text-paper" : "border-ink-500 text-paper-dim hover:text-paper",
            )}
          >
            {f.label} {f.count}
          </button>
        ))}
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className={cn(BTN_GHOST, "min-h-8")} disabled={locked || all.length === 0}><ListChecks className="h-3.5 w-3.5" aria-hidden /> Select</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={REVIEW_LAYER.nested}>
            <DropdownMenuItem onClick={() => onInclude(all, true)}>All</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onInclude(all, false)}>None</DropdownMenuItem>
            <DropdownMenuItem onClick={onOnlyChecked}>Only checked ✓</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {groups.length === 0 && <p className="px-3 py-6 text-center text-xs text-paper-faint">No panels match this filter.</p>}
      {groups.map((group) => {
        const includable = group.panels.filter((p) => canInclude(p.draft));
        const on = includable.filter((p) => p.include).length;
        const label = group.section ?? "Top of the dashboard";
        return (
          <section key={group.section ?? "\u0000top"} aria-label={label} className="border-b border-ink-500/60">
            <div className="flex min-h-11 items-center gap-2 px-3">
              <Checkbox
                checked={on === 0 ? false : on === includable.length ? true : "indeterminate"}
                disabled={locked || includable.length === 0}
                onCheckedChange={(c) => onInclude(includable.map((p) => p.id), c === true)}
                aria-label={`Include all of ${label}`}
                className="h-5 w-5"
              />
              <h3 className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{label}</h3>
              <span className="font-mono text-[10px] text-paper-faint">{on}/{group.panels.length}</span>
            </div>
            <ul>
              {group.panels.map((p) => {
                const status = STATUS[p.draft.status];
                const StatusIcon = status.icon;
                const ChartIcon = chartIcon(p.draft.panel?.viz.type ?? null);
                return (
                  <li key={p.id} className={cn("flex min-h-11 items-start gap-2 px-3 py-1.5", selectedId === p.id && "bg-ink-200")} data-testid="draft-panel">
                    <span className="flex h-8 items-center">
                      <Checkbox
                        checked={p.include}
                        disabled={locked || !canInclude(p.draft)}
                        onCheckedChange={(c) => onInclude([p.id], c === true)}
                        aria-label={`Include ${p.draft.title}`}
                        className="h-5 w-5"
                      />
                    </span>
                    <button type="button" onClick={() => onSelect(p.id)} className="flex min-h-8 min-w-0 flex-1 flex-col justify-center text-left" aria-label={`Show details of ${p.draft.title}`}>
                      <span className="flex w-full items-center gap-2">
                        <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", status.className)} aria-label={status.label} />
                        <ChartIcon className="h-3.5 w-3.5 shrink-0 text-paper-faint" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-paper">{p.draft.title}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-paper-faint" aria-hidden />
                      </span>
                      {p.draft.status === "blocked" && p.draft.reasons[0] && <span className="mt-0.5 line-clamp-2 text-[11px] text-red-300">{p.draft.reasons[0]}</span>}
                      {p.draft.status === "attention" && p.draft.lint[0] && <span className="mt-0.5 line-clamp-2 text-[11px] text-amber-200/90">{p.draft.lint[0].message}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
