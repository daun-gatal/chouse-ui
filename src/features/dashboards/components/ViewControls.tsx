/**
 * The dashboard view bar (ADR 0021 §3, §12, ADR 0023 §5, §7, §8): variables,
 * time range, compare, annotation sources and auto-refresh. The connection is
 * the dock's active one, as on every page. Variable options come from the
 * dashboard (static) or its options query, run as the viewer; a value from a
 * link that is not among the options is still shown and selected. A
 * multi-value variable picks any number of values; All selects every option
 * and sends them explicitly — an empty selection is an error, not "everything".
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock, GitCompare, MapPin, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { variableOptions, type AnnotationSourceResult } from "@/api/dashboards";
import { RELATIVE_RANGE_KEYS, REFRESH_SECONDS, type AnnotationSource, type RefreshSeconds, type RelativeRange, type Variable } from "@/lib/viz/spec";
import { BTN_INLINE, FIELD } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores";

import { COMPARE_OPTIONS, type CompareKey, type ViewState } from "../urlState";
import { ANNOTATION_LABELS } from "../overlays";

const RANGE_LABELS: Record<RelativeRange, string> = {
  "15m": "Last 15 minutes", "1h": "Last hour", "3h": "Last 3 hours", "6h": "Last 6 hours", "12h": "Last 12 hours",
  "24h": "Last 24 hours", "2d": "Last 2 days", "7d": "Last 7 days", "30d": "Last 30 days",
};

const COMPARE_LABELS: Record<CompareKey, string> = { "1d": "1 day ago", "7d": "1 week ago" };

export function refreshLabel(seconds: RefreshSeconds): string {
  if (seconds === 0) return "Off";
  return seconds < 60 ? `${seconds}s` : `${seconds / 60}m`;
}

const ABSOLUTE = "__absolute__";
const NO_COMPARE = "__none__";
// Radix Select items cannot have an empty value; an empty variable value maps to this.
const EMPTY = "__empty__";

function useOptions(dashboardId: string, variable: Variable): { values: string[]; error: string | null; loading: boolean } {
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const options = useQuery({
    queryKey: ["dashboards", "options", dashboardId, variable.name, variable.options, connectionId],
    queryFn: () => variableOptions(dashboardId, variable.name),
    enabled: variable.options.source === "query",
    retry: false,
  });
  return {
    values: variable.options.source === "static" ? variable.options.values : options.data?.values ?? [],
    error: options.isError ? options.error.message : null,
    loading: variable.options.source === "query" && options.isPending,
  };
}

function VariableSelect({ dashboardId, variable, value, onChange }: { dashboardId: string; variable: Variable; value: string; onChange: (value: string) => void }): React.ReactElement {
  const { values, error } = useOptions(dashboardId, variable);
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
      {error && <span className="text-[11px] text-red-300" role="alert">{error}</span>}
    </label>
  );
}

/** What a multi-value picker's button says. */
export function multiSummary(selected: string[], options: string[]): string {
  if (selected.length === 0) return "None";
  if (options.length > 0 && selected.length === options.length && options.every((o) => selected.includes(o))) return `All (${options.length})`;
  if (selected.length <= 2) return selected.join(", ");
  return `${selected.slice(0, 2).join(", ")} +${selected.length - 2}`;
}

function MultiSelect({ dashboardId, variable, value, onChange }: { dashboardId: string; variable: Variable; value: string[]; onChange: (value: string[]) => void }): React.ReactElement {
  const { values, error, loading } = useOptions(dashboardId, variable);
  // Values from a link that are not options stay listed, so they can be unticked.
  const all = [...values, ...value.filter((v) => !values.includes(v))];
  const toggle = (option: string, on: boolean): void => onChange(on ? all.filter((o) => o === option || value.includes(o)) : value.filter((v) => v !== option));
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">{variable.label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn(FIELD, "flex h-8 min-w-28 items-center gap-2 border px-2 text-left", value.length === 0 && "border-red-500/60")} aria-label={variable.label}>
            <span className="min-w-0 flex-1 truncate">{multiSummary(value, values)}</span>
            <ChevronDown className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <div className="mb-1 flex gap-1.5">
            <Button variant="outline" className={BTN_INLINE} onClick={() => onChange(values)} disabled={values.length === 0}>All</Button>
            <Button variant="outline" className={BTN_INLINE} onClick={() => onChange([])}>Clear</Button>
          </div>
          {loading && <p className="px-1 py-2 text-xs text-paper-faint">Loading options…</p>}
          <div className="max-h-64 overflow-y-auto" role="group" aria-label={`${variable.label} values`}>
            {all.map((option) => (
              <label key={option} className="flex items-center gap-2 rounded-xs px-1 py-1 text-xs hover:bg-ink-200">
                <Checkbox checked={value.includes(option)} onCheckedChange={(c) => toggle(option, c === true)} aria-label={option === "" ? "(empty)" : option} />
                <span className="truncate font-mono">{option === "" ? "(empty)" : option}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value.length === 0 && <span className="text-[11px] text-red-300" role="alert">Pick at least one</span>}
      {error && <span className="text-[11px] text-red-300" role="alert">{error}</span>}
    </div>
  );
}

function AnnotationToggles({ shown, hidden, results, onChange }: { shown: AnnotationSource[]; hidden: AnnotationSource[]; results: AnnotationSourceResult[]; onChange: (hidden: AnnotationSource[]) => void }): React.ReactElement | null {
  if (shown.length === 0) return null;
  const failed = results.filter((r) => !r.ok);
  const visible = shown.filter((s) => !hidden.includes(s));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(FIELD, "flex h-8 items-center gap-1.5 border px-2", failed.length > 0 && "border-amber-500/60")} aria-label="Annotations">
          <MapPin className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
          <span>Annotations {visible.length}/{shown.length}</span>
          {failed.length > 0 && <span className="rounded-full bg-amber-950/60 px-1.5 font-mono text-[9px] text-amber-300">{failed.length} unavailable</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        {shown.map((source) => {
          const result = results.find((r) => r.source === source);
          return (
            <div key={source} className="flex flex-col gap-0.5 px-1 py-1">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={!hidden.includes(source)}
                  onCheckedChange={(c) => onChange(c === true ? hidden.filter((h) => h !== source) : [...hidden, source])}
                  aria-label={ANNOTATION_LABELS[source]}
                />
                <span className="flex-1">{ANNOTATION_LABELS[source]}</span>
                {result?.ok && <span className="font-mono text-[10px] text-paper-faint">{result.events.length}{result.truncated ? "+" : ""}</span>}
              </label>
              {result && !result.ok && <span className="pl-6 text-[11px] text-amber-300" role="status">{result.error}</span>}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

interface Props {
  dashboardId: string;
  variables: Variable[];
  /** The annotation sources the dashboard shows. */
  annotations: AnnotationSource[];
  annotationResults: AnnotationSourceResult[];
  view: ViewState;
  refreshSeconds: RefreshSeconds;
  onViewChange: (view: ViewState) => void;
  onRefreshChange: (seconds: RefreshSeconds) => void;
}

export function ViewControls({ dashboardId, variables, annotations, annotationResults, view, refreshSeconds, onViewChange, onRefreshChange }: Props): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-ink-500 px-4 py-2 text-xs" data-testid="view-controls">
      {variables.map((v) => {
        const current = view.values[v.name] ?? v.default;
        if (v.kind === "multi") {
          return (
            <MultiSelect
              key={v.name}
              dashboardId={dashboardId}
              variable={v}
              value={Array.isArray(current) ? current : [current]}
              onChange={(value) => onViewChange({ ...view, values: { ...view.values, [v.name]: value } })}
            />
          );
        }
        return (
          <VariableSelect
            key={v.name}
            dashboardId={dashboardId}
            variable={v}
            value={Array.isArray(current) ? current[0] ?? "" : current}
            onChange={(value) => onViewChange({ ...view, values: { ...view.values, [v.name]: value } })}
          />
        );
      })}
      <span className="flex-1" />
      <AnnotationToggles shown={annotations} hidden={view.hidden} results={annotationResults} onChange={(hidden) => onViewChange({ ...view, hidden })} />
      <label className="flex items-center gap-1.5">
        <GitCompare className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
        <Select value={view.compare ?? NO_COMPARE} onValueChange={(v) => onViewChange({ ...view, compare: v === NO_COMPARE ? null : (v as CompareKey) })}>
          <SelectTrigger className={cn(FIELD, "min-w-32")} aria-label="Compare with"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_COMPARE}>No compare</SelectItem>
            {(Object.keys(COMPARE_OPTIONS) as CompareKey[]).map((k) => <SelectItem key={k} value={k}>Compare: {COMPARE_LABELS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
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

