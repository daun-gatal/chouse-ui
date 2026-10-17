/**
 * Edits a viz spec against a result's columns (ADR 0021 §2): chart type, axes,
 * split by series, unit, decimals, stat reduce, thresholds and colors. Every
 * change produces a complete spec; problems with it are listed, not fixed.
 */

import React from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { humanizeAxisName } from "@/components/common/AiChartUtils";
import type { ResultColumn } from "@/lib/viz/resolve";
import {
  CHART_TYPES,
  COLOR_SCHEMES,
  MAX_Y_COLUMNS,
  REDUCERS,
  THRESHOLD_TYPES,
  UNITS,
  vizSpecProblems,
  type ChartType,
  type VizSpec,
} from "@/lib/viz/spec";
import { UNIT_LABELS } from "@/lib/viz/units";
import { BTN_ICON, BTN_INLINE, FIELD, FIELD_LABEL } from "@/components/charts/controlStyles";

const NONE = "__none__";


/** Fields a chart type uses, so switching type keeps the spec drawable. */
export function retype(spec: VizSpec, type: ChartType, columns: ResultColumn[]): VizSpec {
  const firstOther = (exclude: string[]): string | null => columns.find((c) => !exclude.includes(c.name))?.name ?? null;
  const candidate = firstOther(spec.x ? [spec.x] : []);
  const y = spec.y.length > 0 ? spec.y : candidate ? [candidate] : [];
  const thresholds = THRESHOLD_TYPES.has(type) ? spec.thresholds : [];
  switch (type) {
    case "table":
      return { ...spec, type, x: null, y: [], series: null, reduce: null, thresholds };
    case "stat":
      return { ...spec, type, x: null, y: y.slice(0, 1), series: null, reduce: spec.reduce ?? "last", thresholds };
    case "histogram":
      return { ...spec, type, x: spec.x ?? y[0] ?? null, y: [], series: null, reduce: null, thresholds };
    case "pie":
    case "donut":
    case "treemap":
    case "funnel":
    case "scatter":
      return { ...spec, type, x: spec.x ?? firstOther(y), y: y.slice(0, 1), series: null, reduce: null, thresholds };
    default:
      return { ...spec, type, x: spec.x ?? firstOther(y), y, series: y.length === 1 ? spec.series : null, reduce: null, thresholds };
  }
}

interface Props {
  spec: VizSpec;
  columns: ResultColumn[];
  onChange: (spec: VizSpec) => void;
  /** Hide the problems list (the caller shows it). */
  hideProblems?: boolean;
}

export function VizSpecEditor({ spec, columns, onChange, hideProblems = false }: Props): React.ReactElement {
  const problems = vizSpecProblems(spec);
  const names = columns.map((c) => c.name);
  const usesX = spec.type !== "stat" && spec.type !== "table";
  const usesY = spec.type !== "histogram" && spec.type !== "table";
  const multiY = !["stat", "pie", "donut", "treemap", "funnel", "scatter"].includes(spec.type);
  const canSplit = ["bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "multi_line", "area", "stacked_area", "radar", "heatmap"].includes(spec.type);

  const toggleY = (name: string): void => {
    if (spec.y.includes(name)) {
      onChange({ ...spec, y: spec.y.filter((n) => n !== name), series: spec.y.length === 2 ? spec.series : null });
      return;
    }
    const y = multiY ? [...spec.y, name].slice(0, MAX_Y_COLUMNS) : [name];
    onChange({ ...spec, y, series: y.length === 1 ? spec.series : null });
  };

  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="viz-spec-editor">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Chart</span>
          <Select value={spec.type} onValueChange={(v) => onChange(retype(spec, v as ChartType, columns))}>
            <SelectTrigger className={cn(FIELD, "w-40")} aria-label="Chart type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHART_TYPES.map((t) => <SelectItem key={t} value={t}>{humanizeAxisName(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {usesX && (
          <div className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>X</span>
            <Select value={spec.x ?? NONE} onValueChange={(v) => onChange({ ...spec, x: v === NONE ? null : v, y: spec.y.filter((n) => n !== v) })}>
              <SelectTrigger className={cn(FIELD, "w-44")} aria-label="X column"><SelectValue placeholder="Pick a column" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {canSplit && (
          <div className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Split by</span>
            <Select value={spec.series ?? NONE} onValueChange={(v) => onChange({ ...spec, series: v === NONE ? null : v })}>
              <SelectTrigger className={cn(FIELD, "w-40")} aria-label="Split by series"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {names.filter((n) => n !== spec.x && !spec.y.includes(n)).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Unit</span>
          <Select value={spec.unit} onValueChange={(v) => onChange({ ...spec, unit: v as VizSpec["unit"] })}>
            <SelectTrigger className={cn(FIELD, "w-36")} aria-label="Unit"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => <SelectItem key={u} value={u}>{UNIT_LABELS[u]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Decimals</span>
          <Select value={spec.decimals === null ? NONE : String(spec.decimals)} onValueChange={(v) => onChange({ ...spec, decimals: v === NONE ? null : Number(v) })}>
            <SelectTrigger className={cn(FIELD, "w-24")} aria-label="Decimals"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Auto</SelectItem>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {spec.type === "stat" && (
          <div className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Reduce</span>
            <Select value={spec.reduce ?? NONE} onValueChange={(v) => onChange({ ...spec, reduce: v === NONE ? null : (v as VizSpec["reduce"]) })}>
              <SelectTrigger className={cn(FIELD, "w-28")} aria-label="Reduce"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REDUCERS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Colors</span>
          <Select value={spec.colorScheme} onValueChange={(v) => onChange({ ...spec, colorScheme: v as VizSpec["colorScheme"] })}>
            <SelectTrigger className={cn(FIELD, "w-28")} aria-label="Colors"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COLOR_SCHEMES.map((c) => <SelectItem key={c} value={c}>{humanizeAxisName(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {usesY && (
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>{multiY ? "Y (pick one or more)" : "Y"}</span>
          <div className="flex flex-wrap gap-1.5">
            {names.filter((n) => n !== spec.x && n !== spec.series).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={spec.y.includes(n)}
                onClick={() => toggleY(n)}
                className={cn(
                  "rounded-xs border px-2 py-0.5 font-mono text-[11px]",
                  spec.y.includes(n) ? "border-brand bg-brand/15 text-paper" : "border-ink-500 text-paper-dim hover:text-paper",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {THRESHOLD_TYPES.has(spec.type) && (
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Thresholds</span>
          <div className="flex flex-wrap items-center gap-2">
            {spec.thresholds.map((t, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input
                  type="number"
                  className={cn(FIELD, "h-7 w-24")}
                  aria-label={`Threshold ${i + 1} value`}
                  value={Number.isFinite(t.value) ? t.value : ""}
                  onChange={(e) => {
                    const value = e.target.valueAsNumber;
                    if (!Number.isFinite(value)) return;
                    onChange({ ...spec, thresholds: spec.thresholds.map((x, j) => (j === i ? { ...x, value } : x)) });
                  }}
                />
                <Select value={t.severity} onValueChange={(v) => onChange({ ...spec, thresholds: spec.thresholds.map((x, j) => (j === i ? { ...x, severity: v as typeof t.severity } : x)) })}>
                  <SelectTrigger className={cn(FIELD, "w-28")} aria-label={`Threshold ${i + 1} severity`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Remove threshold ${i + 1}`} onClick={() => onChange({ ...spec, thresholds: spec.thresholds.filter((_, j) => j !== i) })}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {spec.thresholds.length < 4 && (
              <Button variant="outline" className={BTN_INLINE} onClick={() => onChange({ ...spec, thresholds: [...spec.thresholds, { value: 0, severity: "warning" }] })}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add threshold
              </Button>
            )}
          </div>
        </div>
      )}

      {!hideProblems && problems.length > 0 && (
        <ul className="list-disc pl-5 text-[11px] text-amber-300" data-testid="viz-problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}
