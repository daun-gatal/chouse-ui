/**
 * The dashboard view bar (ADR 0021 §3, §12): variables, time range and
 * auto-refresh. The connection is the dock's active one, as on every page. Variable options come from the dashboard (static) or its
 * options query, run as the viewer; a value from a link that is not among the
 * options is still shown and selected.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, RefreshCw } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { variableOptions } from "@/api/dashboards";
import { RELATIVE_RANGE_KEYS, REFRESH_SECONDS, type RefreshSeconds, type RelativeRange, type Variable } from "@/lib/viz/spec";
import { FIELD } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores";

import type { ViewState } from "../urlState";

const RANGE_LABELS: Record<RelativeRange, string> = {
  "15m": "Last 15 minutes", "1h": "Last hour", "3h": "Last 3 hours", "6h": "Last 6 hours", "12h": "Last 12 hours",
  "24h": "Last 24 hours", "2d": "Last 2 days", "7d": "Last 7 days", "30d": "Last 30 days",
};

export function refreshLabel(seconds: RefreshSeconds): string {
  if (seconds === 0) return "Off";
  return seconds < 60 ? `${seconds}s` : `${seconds / 60}m`;
}

const ABSOLUTE = "__absolute__";
// Radix Select items cannot have an empty value; an empty variable value maps to this.
const EMPTY = "__empty__";

function VariableSelect({ dashboardId, variable, value, onChange }: { dashboardId: string; variable: Variable; value: string; onChange: (value: string) => void }): React.ReactElement {
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const options = useQuery({
    queryKey: ["dashboards", "options", dashboardId, variable.name, variable.options, connectionId],
    queryFn: () => variableOptions(dashboardId, variable.name),
    enabled: variable.options.source === "query",
    retry: false,
  });
  const values = variable.options.source === "static" ? variable.options.values : options.data?.values ?? [];
  const all = values.includes(value) ? values : [value, ...values];
  return (
    <label className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">{variable.label}</span>
      <Select value={value === "" ? EMPTY : value} onValueChange={(v) => onChange(v === EMPTY ? "" : v)}>
        <SelectTrigger className={cn(FIELD, "min-w-28")} aria-label={variable.label}><SelectValue /></SelectTrigger>
        <SelectContent>
          {all.map((v) => <SelectItem key={v === "" ? EMPTY : v} value={v === "" ? EMPTY : v}>{v === "" ? "(empty)" : v}</SelectItem>)}
        </SelectContent>
      </Select>
      {options.isError && <span className="text-[11px] text-red-300" role="alert">{options.error.message}</span>}
    </label>
  );
}

interface Props {
  dashboardId: string;
  variables: Variable[];
  view: ViewState;
  refreshSeconds: RefreshSeconds;
  onViewChange: (view: ViewState) => void;
  onRefreshChange: (seconds: RefreshSeconds) => void;
}

export function ViewControls({ dashboardId, variables, view, refreshSeconds, onViewChange, onRefreshChange }: Props): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-ink-500 px-4 py-2 text-xs" data-testid="view-controls">
      {variables.map((v) => (
        <VariableSelect
          key={v.name}
          dashboardId={dashboardId}
          variable={v}
          value={view.values[v.name] ?? v.default}
          onChange={(value) => onViewChange({ ...view, values: { ...view.values, [v.name]: value } })}
        />
      ))}
      <span className="flex-1" />
      <label className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
        <Select
          value={view.range.kind === "relative" ? view.range.value : ABSOLUTE}
          onValueChange={(v) => { if (v !== ABSOLUTE) onViewChange({ ...view, range: { kind: "relative", value: v as RelativeRange } }); }}
        >
          <SelectTrigger className={cn(FIELD, "min-w-36")} aria-label="Time range"><SelectValue /></SelectTrigger>
          <SelectContent>
            {view.range.kind === "absolute" && (
              <SelectItem value={ABSOLUTE}>{new Date(view.range.from * 1000).toLocaleString()} – {new Date(view.range.to * 1000).toLocaleString()}</SelectItem>
            )}
            {RELATIVE_RANGE_KEYS.map((r) => <SelectItem key={r} value={r}>{RANGE_LABELS[r]}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-1.5">
        <RefreshCw className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
        <Select value={String(refreshSeconds)} onValueChange={(v) => onRefreshChange(Number(v) as RefreshSeconds)}>
          <SelectTrigger className={cn(FIELD, "w-20")} aria-label="Auto-refresh"><SelectValue /></SelectTrigger>
          <SelectContent>{REFRESH_SECONDS.map((s) => <SelectItem key={s} value={String(s)}>{refreshLabel(s)}</SelectItem>)}</SelectContent>
        </Select>
      </label>
    </div>
  );
}
