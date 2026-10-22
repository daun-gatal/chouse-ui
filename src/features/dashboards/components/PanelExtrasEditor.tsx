/**
 * A chart panel's drill-down links and expected-range band (ADR 0023 §6, §8),
 * in the panel editor. Links to another dashboard pick it from the dashboards
 * the editor can view, and set its variables from a column of the clicked
 * datum or a fixed value. The server checks every link again on save.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getDashboard, listDashboards } from "@/api/dashboards";
import { MAX_BASELINE_WEEKS, MAX_LINKS, MIN_BASELINE_WEEKS, TIME_SERIES_TYPES, type Link, type LinkValue, type Variable, type VizSpec } from "@/lib/viz/spec";
import { BTN_ICON, BTN_INLINE, FIELD, FIELD_LABEL } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";

const FIXED = "__fixed__";

/** Columns a link may read: on a chart its x, series and measures; on a table, any column the result has. */
export function linkableColumns(viz: VizSpec, resultColumns: string[]): string[] {
  if (viz.type === "table") return resultColumns;
  if (viz.type === "stat") return [];
  return [...new Set([viz.x, viz.series, ...viz.y].filter((c): c is string => c !== null))];
}

function ValuePicker({ value, columns, onChange, label }: { value: LinkValue; columns: string[]; onChange: (value: LinkValue) => void; label: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1">
      <Select value={value.from === "column" ? value.column : FIXED} onValueChange={(v) => onChange(v === FIXED ? { from: "value", value: value.from === "value" ? value.value : "" } : { from: "column", column: v })}>
        <SelectTrigger className={cn(FIELD, "w-36")} aria-label={`${label} from`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {columns.map((c) => <SelectItem key={c} value={c}>column {c}</SelectItem>)}
          <SelectItem value={FIXED}>a fixed value</SelectItem>
        </SelectContent>
      </Select>
      {value.from === "value" && <Input className={cn(FIELD, "w-32 font-mono")} value={value.value} onChange={(e) => onChange({ from: "value", value: e.target.value })} aria-label={`${label} value`} maxLength={500} />}
    </span>
  );
}

function DashboardLinkFields({ link, columns, onChange }: { link: Extract<Link, { kind: "dashboard" }>; columns: string[]; onChange: (link: Link) => void }): React.ReactElement {
  const dashboards = useQuery({ queryKey: ["dashboards", "list"], queryFn: listDashboards });
  const target = useQuery({ queryKey: ["dashboards", "detail", link.dashboardId], queryFn: () => getDashboard(link.dashboardId), enabled: link.dashboardId !== "", retry: false });
  const variables = target.data?.dashboard.variables ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <Select value={link.dashboardId || undefined} onValueChange={(dashboardId) => onChange({ ...link, dashboardId, values: {} })}>
        <SelectTrigger className={cn(FIELD, "w-72")} aria-label="Target dashboard"><SelectValue placeholder="Pick a dashboard" /></SelectTrigger>
        <SelectContent>{(dashboards.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}</SelectContent>
      </Select>
      {target.isError && <span className="text-[11px] text-red-300" role="alert">{target.error.message}</span>}
      {variables.map((v) => {
        const value = link.values[v.name];
        return (
          <label key={v.name} className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={value !== undefined}
              onCheckedChange={(c) => {
                const next = { ...link.values };
                if (c === true) next[v.name] = columns[0] ? { from: "column", column: columns[0] } : { from: "value", value: "" };
                else delete next[v.name];
                onChange({ ...link, values: next });
              }}
              aria-label={`Set ${v.label}`}
            />
            <span className="w-28 truncate">Set {v.label}</span>
            {value && <ValuePicker value={value} columns={columns} label={v.label} onChange={(nv) => onChange({ ...link, values: { ...link.values, [v.name]: nv } })} />}
          </label>
        );
      })}
    </div>
  );
}

function newLink(kind: Link["kind"], columns: string[], variables: Variable[]): Link {
  const first: LinkValue = columns[0] ? { from: "column", column: columns[0] } : { from: "value", value: "" };
  if (kind === "dashboard") return { kind, label: "Open details", dashboardId: "", values: {} };
  if (kind === "filter") return { kind, label: "Filter by this", variable: variables[0]?.name ?? "", column: columns[0] ?? "" };
  return { kind, label: "Open in Explorer", database: { from: "value", value: "default" }, table: first };
}

interface Props {
  viz: VizSpec;
  /** The result's columns, when a preview has run. */
  resultColumns: string[];
  variables: Variable[];
  fleet: boolean;
  onChange: (viz: VizSpec) => void;
}

export function PanelExtrasEditor({ viz, resultColumns, variables, fleet, onChange }: Props): React.ReactElement {
  const columns = linkableColumns(viz, resultColumns);
  const setLink = (i: number, link: Link): void => onChange({ ...viz, links: viz.links.map((l, j) => (j === i ? link : l)) });
  const bandable = TIME_SERIES_TYPES.has(viz.type) && viz.y.length === 1 && viz.series === null && !fleet;
  return (
    <div className="flex flex-col gap-3 rounded-xs border border-ink-500 p-3" data-testid="panel-extras">
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-xs text-paper-muted">
          <Checkbox
            checked={viz.baseline !== null}
            disabled={!bandable && viz.baseline === null}
            onCheckedChange={(c) => onChange({ ...viz, baseline: c === true ? { weeks: 4 } : null })}
            aria-label="Expected-range band"
          />
          Draw the expected range from the past
          <Select value={String(viz.baseline?.weeks ?? 4)} onValueChange={(w) => onChange({ ...viz, baseline: { weeks: Number(w) } })} disabled={viz.baseline === null}>
            <SelectTrigger className={cn(FIELD, "w-20")} aria-label="Weeks"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: MAX_BASELINE_WEEKS - MIN_BASELINE_WEEKS + 1 }, (_, i) => MIN_BASELINE_WEEKS + i).map((w) => <SelectItem key={w} value={String(w)}>{w}</SelectItem>)}
            </SelectContent>
          </Select>
          weeks
        </label>
        {!bandable && <span className="pl-6 text-[11px] text-paper-faint">A band needs a line or area chart with one measure, no split by series, on one connection.</span>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={FIELD_LABEL}>Drill-down links ({viz.links.length}/{MAX_LINKS})</span>
          <span className="flex gap-1">
            <Button variant="outline" className={BTN_INLINE} disabled={viz.links.length >= MAX_LINKS} onClick={() => onChange({ ...viz, links: [...viz.links, newLink("dashboard", columns, variables)] })}><Plus className="mr-1 h-3 w-3" /> Dashboard</Button>
            <Button variant="outline" className={BTN_INLINE} disabled={viz.links.length >= MAX_LINKS || variables.length === 0 || columns.length === 0} onClick={() => onChange({ ...viz, links: [...viz.links, newLink("filter", columns, variables)] })}><Plus className="mr-1 h-3 w-3" /> Filter</Button>
            <Button variant="outline" className={BTN_INLINE} disabled={viz.links.length >= MAX_LINKS} onClick={() => onChange({ ...viz, links: [...viz.links, newLink("explorer", columns, variables)] })}><Plus className="mr-1 h-3 w-3" /> Explorer</Button>
          </span>
        </div>
        {viz.links.length === 0 && <p className="text-[11px] text-paper-faint">Clicking a bar, a point or a row offers these links.{viz.type === "stat" ? " A stat panel's links can only use fixed values." : ""}</p>}
        {viz.links.map((link, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-xs border border-ink-500/70 p-2" data-testid="link-row">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">{link.kind}</span>
              <Input className={cn(FIELD, "w-48")} value={link.label} maxLength={80} onChange={(e) => setLink(i, { ...link, label: e.target.value })} aria-label="Link label" />
              <span className="flex-1" />
              <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Remove ${link.label}`} onClick={() => onChange({ ...viz, links: viz.links.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            {link.kind === "dashboard" && <DashboardLinkFields link={link} columns={columns} onChange={(next) => setLink(i, next)} />}
            {link.kind === "filter" && (
              <div className="flex items-center gap-2 text-xs">
                <span>Set</span>
                <Select value={link.variable || undefined} onValueChange={(variable) => setLink(i, { ...link, variable })}>
                  <SelectTrigger className={cn(FIELD, "w-36")} aria-label="Variable"><SelectValue placeholder="Variable" /></SelectTrigger>
                  <SelectContent>{variables.map((v) => <SelectItem key={v.name} value={v.name}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
                <span>to the clicked</span>
                <Select value={link.column || undefined} onValueChange={(column) => setLink(i, { ...link, column })}>
                  <SelectTrigger className={cn(FIELD, "w-36")} aria-label="Column"><SelectValue placeholder="Column" /></SelectTrigger>
                  <SelectContent>{columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {link.kind === "explorer" && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span>Database</span>
                <ValuePicker value={link.database} columns={columns} label="Database" onChange={(database) => setLink(i, { ...link, database })} />
                <span>Table</span>
                <ValuePicker value={link.table} columns={columns} label="Table" onChange={(table) => setLink(i, { ...link, table })} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
