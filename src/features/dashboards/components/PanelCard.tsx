/**
 * Dashboard panels (ADR 0021 §4, §6, ADR 0023 §1). A chart panel runs its
 * query for the current view, refreshes on the dashboard's interval while the
 * tab is visible, and draws the result in the space its canvas cell gives it.
 * Errors are shown with the server's reason; a failed run is not retried
 * behind the user's back. A fleet panel draws one series per connection and
 * lists each connection that failed.
 *
 * Text panels render Markdown with react-markdown, which never renders raw
 * HTML; links open in a new tab. Headings title a section of the canvas.
 */

import React, { useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, GitCompare, GripVertical, Pencil, RefreshCw, Trash2, Waves, Zap } from "lucide-react";

import { PanelMessage, PanelVisual } from "@/components/charts/PanelVisual";
import type { PanelOverlays } from "@/components/common/AiChartRenderer";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getBaseline, runPanel, type AnnotationEvent, type ChartPanelInput, type HeadingPanelInput, type LintFinding, type PanelRunResult, type SnapshotResult, type TextPanelInput } from "@/api/dashboards";
import { mergeFleet, type ResolvedChart, type ResultData } from "@/lib/viz/resolve";
import { TIME_SERIES_TYPES, type VizSpec } from "@/lib/viz/spec";
import { formatValue } from "@/lib/viz/units";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores";
import { BTN_ICON } from "@/components/charts/controlStyles";

import { BAND_HI, BAND_LO, chartTime, markersFor, mergeBand, mergeCompare } from "../overlays";
import { COMPARE_OPTIONS, type ViewState } from "../urlState";

/** A time range on a chart, in UTC milliseconds. */
export interface TimeSpan {
  fromMs: number;
  toMs: number;
}

/** Why a chart cannot be compared with an earlier window (null when it can; server: compareProblem). */
export function compareProblem(panel: Pick<ChartPanelInput, "fleet" | "viz">): string | null {
  if (panel.fleet) return "Compare runs on one connection; this panel runs across the fleet";
  if (!TIME_SERIES_TYPES.has(panel.viz.type)) return "Compare needs a line or area chart";
  if (panel.viz.series !== null) return "Compare needs a chart without a split by series";
  return null;
}

/** The class the canvas uses as each panel's drag handle. */
export const DRAG_HANDLE_CLASS = "panel-drag-handle";

/** Pixels a chart card spends on its header, padding and footer. */
const CHART_CHROME_PX = 40 + 24 + 18;

function DragHandle({ title }: { title: string }): React.ReactElement {
  return (
    <span className={cn(DRAG_HANDLE_CLASS, "cursor-grab text-paper-faint hover:text-paper active:cursor-grabbing")} aria-label={`Drag ${title}`} role="button" tabIndex={-1}>
      <GripVertical className="h-4 w-4" />
    </span>
  );
}

function EditButtons({ title, onEdit, onRemove }: { title: string; onEdit: () => void; onRemove: () => void }): React.ReactElement {
  return (
    <>
      <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Edit ${title}`} onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Remove ${title}`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
    </>
  );
}

interface ChartProps {
  dashboardId: string;
  /** Null for a panel added in this edit session and not saved yet. */
  panelId: string | null;
  panel: ChartPanelInput;
  view: ViewState;
  refreshSeconds: number;
  editing: boolean;
  lint: LintFinding[];
  /** The card's height in pixels (its canvas cell). */
  height: number;
  onEdit: () => void;
  onRemove: () => void;
  /** Extra controls in the header (alerts). */
  actions?: React.ReactNode;
  /** Alert thresholds to draw on the chart. */
  alertLines?: Array<{ value: number; color: string }>;
  /** Annotation events to mark on a time chart (already filtered to the sources shown). */
  annotations?: AnnotationEvent[];
  /** The range the user selected on this panel, drawn shaded. */
  selection?: TimeSpan | null;
  /** A datum was clicked: its row, and on a time chart the bucket it covers. */
  onDatum?: (row: Record<string, unknown>, bucket: TimeSpan | null) => void;
  /** A range was selected on a time chart. */
  onSelectRange?: (span: TimeSpan) => void;
  /** An annotation marker was clicked. */
  onMarker?: (event: AnnotationEvent) => void;
}

/** A fleet result as one result to draw: a `connection` column, split by it for charts. */
function fleetVisual(spec: VizSpec, result: Extract<PanelRunResult, { kind: "fleet" }>): { spec: VizSpec; data: ResultData } {
  const ok = result.connections.filter((e): e is Extract<typeof e, { ok: true }> => e.ok);
  const data = mergeFleet(ok.map((e) => ({ connectionName: e.connectionName, data: e.data })));
  if (spec.type === "table") return { spec, data };
  return { spec: { ...spec, series: "connection" }, data };
}

function FleetStats({ spec, result }: { spec: VizSpec; result: Extract<PanelRunResult, { kind: "fleet" }> }): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {result.connections.filter((e) => e.ok).map((e) => (
        <div key={e.connectionId} className="rounded-xs border border-ink-500 p-2">
          <div className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">{e.connectionName}</div>
          {e.ok && <PanelVisual spec={spec} data={e.data} height={56} />}
        </div>
      ))}
    </div>
  );
}

/**
 * The footer: how long the run took and what it read. The legend already names
 * a fleet panel's connections and the failure list names the rest, so a fleet
 * run reads like any other: its slowest connection and the total read.
 */
function runMeta(result: PanelRunResult, live = true): string | null {
  if (result.kind === "single") return `${live && result.cached ? "cached · " : ""}${result.data.elapsedMs} ms · ${formatValue(result.data.readBytes, "bytes")} read`;
  const ok = result.connections.filter((e): e is Extract<typeof e, { ok: true }> => e.ok);
  if (ok.length === 0) return null;
  const slowest = Math.max(...ok.map((e) => e.data.elapsedMs));
  const read = ok.reduce((sum, e) => sum + e.data.readBytes, 0);
  return `${live && ok.every((e) => e.cached) ? "cached · " : ""}${slowest} ms · ${formatValue(read, "bytes")} read`;
}

export function PanelCard({ dashboardId, panelId, panel, view, refreshSeconds, editing, lint, height, onEdit, onRemove, actions, alertLines, annotations = [], selection = null, onDatum, onSelectRange, onMarker }: ChartProps): React.ReactElement {
  const chartHeight = Math.max(48, height - CHART_CHROME_PX);
  // Runs on the dock's active connection (sent with every request); a fleet panel on all of them.
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const run = useQuery({
    queryKey: ["dashboards", "run", dashboardId, panelId, panel.sql, panel.fleet, view, panel.fleet ? null : activeConnectionId],
    queryFn: ({ signal }) => {
      // Disabled below while there is no stored panel to run.
      if (panelId === null) throw new Error("Save the dashboard to run this panel");
      if (!panel.fleet && activeConnectionId === null) throw new Error("Pick a connection in the dock to run this panel");
      return runPanel(dashboardId, panelId, { range: view.range, values: view.values }, signal);
    },
    enabled: panelId !== null,
    refetchInterval: refreshSeconds > 0 ? refreshSeconds * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Compare and the band run only for what they apply to; anything else says why in a chip.
  const shift = view.compare ? COMPARE_OPTIONS[view.compare] : 0;
  const notComparable = shift > 0 && panel.viz.type !== "stat" && panel.viz.type !== "table" ? compareProblem(panel) : null;
  const earlier = useQuery({
    queryKey: ["dashboards", "run", dashboardId, panelId, panel.sql, view, activeConnectionId, "shift", shift],
    queryFn: ({ signal }) => {
      if (panelId === null) throw new Error("Save the dashboard to compare this panel");
      return runPanel(dashboardId, panelId, { range: view.range, values: view.values, shiftSeconds: shift as 86_400 | 604_800 }, signal);
    },
    enabled: panelId !== null && shift > 0 && compareProblem(panel) === null,
    refetchInterval: refreshSeconds > 0 ? refreshSeconds * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const band = useQuery({
    queryKey: ["dashboards", "baseline", dashboardId, panelId, panel.sql, panel.viz.baseline, view.range, view.values, activeConnectionId],
    queryFn: ({ signal }) => {
      if (panelId === null) throw new Error("Save the dashboard to draw the expected range");
      return getBaseline(dashboardId, panelId, { range: view.range, values: view.values }, signal);
    },
    enabled: panelId !== null && panel.viz.baseline !== null && !panel.fleet,
    refetchInterval: refreshSeconds > 0 ? Math.max(refreshSeconds, 300) * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const single = run.data?.kind === "single" ? run.data : null;
  const [timeProblem, decorate] = useMemo((): [string | null, ((chart: ResolvedChart) => { rows: Array<Record<string, unknown>>; overlays: PanelOverlays }) | undefined] => {
    if (!single) return [null, undefined];
    const needed = annotations.length > 0 || earlier.data !== undefined || band.data !== undefined || onSelectRange !== undefined || onDatum !== undefined;
    if (!needed) return [null, undefined];
    let problem: string | null = null;
    const fn = (chart: ResolvedChart): { rows: Array<Record<string, unknown>>; overlays: PanelOverlays } => {
      const time = chartTime(chart.rows, chart.columns, chart.x, single.data.timezone, single.window.intervalSeconds);
      const empty: PanelOverlays = { markers: [], compare: [], band: null, selection: null };
      if (!time.ok) {
        return { rows: chart.rows, overlays: { ...empty, onPointClick: onDatum ? (_x, index) => { const row = chart.rows[index]; if (row) onDatum(row, null); } : undefined } };
      }
      let rows = chart.rows;
      let compare: PanelOverlays["compare"] = [];
      if (earlier.data?.kind === "single" && view.compare) {
        const merged = mergeCompare(rows, time, { ...earlier.data.data }, chart.x, chart.y, shift, view.compare === "1d" ? "1 day ago" : "1 week ago");
        rows = merged.rows;
        compare = merged.keys;
      }
      const banded = band.data && band.data.points.length > 0;
      if (banded && band.data) rows = mergeBand(rows, chart.x, band.data.points);
      const xAt = (fromMs: number, toMs: number): { from: string; to: string } | null => {
        const from = time.xsMs.findIndex((ms) => ms !== null && ms >= fromMs);
        let to = -1;
        time.xsMs.forEach((ms, i) => { if (ms !== null && ms < toMs) to = i; });
        return from >= 0 && to >= from ? { from: String(chart.rows[from][chart.x]), to: String(chart.rows[to][chart.x]) } : null;
      };
      const spanOf = (index: number): TimeSpan | null => {
        const ms = time.xsMs[index];
        return ms === null ? null : { fromMs: ms, toMs: ms + time.intervalMs };
      };
      return {
        rows,
        overlays: {
          markers: markersFor(annotations, chart.rows, chart.x, time).map(({ id, x, color, label }) => ({ id, x, color, label })),
          compare,
          band: banded ? { lo: BAND_LO, hi: BAND_HI } : null,
          selection: selection ? xAt(selection.fromMs, selection.toMs) : null,
          onSelect: onSelectRange ? (fromX, toX) => {
            const a = chart.rows.findIndex((r) => String(r[chart.x]) === fromX);
            const b = chart.rows.findIndex((r) => String(r[chart.x]) === toX);
            const start = spanOf(a);
            const end = spanOf(b);
            if (start && end) onSelectRange({ fromMs: start.fromMs, toMs: end.toMs });
          } : undefined,
          onPointClick: onDatum ? (_x, index) => { const row = chart.rows[index]; if (row) onDatum(row, spanOf(index)); } : undefined,
          onMarkerClick: onMarker ? (id) => { const event = annotations.find((e) => e.id === id); if (event) onMarker(event); } : undefined,
        },
      };
    };
    // Run once to learn whether the times can be read, so the header can say why overlays are missing.
    if (panel.viz.x !== null && TIME_SERIES_TYPES.has(panel.viz.type)) {
      const xType = single.data.columns.find((c) => c.name === panel.viz.x)?.type ?? "";
      const probe = chartTime(single.data.rows, [{ name: panel.viz.x, type: xType }], panel.viz.x, single.data.timezone, single.window.intervalSeconds);
      if (!probe.ok) problem = probe.reason;
    }
    return [problem, fn];
  }, [single, annotations, earlier.data, band.data, view.compare, shift, selection, onSelectRange, onDatum, onMarker, panel.viz.x, panel.viz.type]);

  const datumClick = useCallback((row: Record<string, unknown>) => onDatum?.(row, null), [onDatum]);

  const visual = useMemo(() => {
    if (!run.data) return null;
    if (run.data.kind === "single") return { spec: panel.viz, data: run.data.data };
    return fleetVisual(panel.viz, run.data);
  }, [run.data, panel.viz]);

  const failures = run.data?.kind === "fleet" ? run.data.connections.filter((e): e is Extract<typeof e, { ok: false }> => !e.ok) : [];
  const meta = run.data ? runMeta(run.data) : null;

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100" aria-label={panel.title}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-ink-500 px-3">
        {editing && <DragHandle title={panel.title} />}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-paper" title={panel.title}>{panel.title}</h3>
        {panel.fleet && <span className="flex items-center gap-1 rounded-full border border-ink-500 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim"><Zap className="h-3 w-3" aria-hidden /> Fleet</span>}
        {notComparable && <Chip icon={<GitCompare className="h-3 w-3" aria-hidden />} tone="muted" text="Compare n/a" title={notComparable} testId="compare-na" />}
        {earlier.isError && <Chip icon={<GitCompare className="h-3 w-3" aria-hidden />} tone="error" text="Compare failed" title={earlier.error.message} testId="compare-error" />}
        {band.data?.state === "learning" && <Chip icon={<Waves className="h-3 w-3" aria-hidden />} tone="muted" text="Band learning" title={band.data.reason} testId="band-learning" />}
        {band.isError && <Chip icon={<Waves className="h-3 w-3" aria-hidden />} tone="error" text="Band failed" title={band.error.message} testId="band-error" />}
        {timeProblem && (annotations.length > 0 || shift > 0 || panel.viz.baseline !== null) && <Chip icon={<AlertTriangle className="h-3 w-3" aria-hidden />} tone="muted" text="No time overlays" title={`Annotations, compare and the band need readable times: ${timeProblem}`} testId="time-problem" />}
        {lint.length > 0 && editing && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 rounded-full bg-amber-950/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-300" data-testid="lint-badge">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> {lint.length} to check
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{lint.map((f) => <p key={f.code} className="text-xs">{f.message}</p>)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {actions}
        <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Refresh ${panel.title}`} onClick={() => void run.refetch()} disabled={run.isFetching || panelId === null}>
          <RefreshCw className={cn("h-3.5 w-3.5", run.isFetching && "animate-spin")} />
        </Button>
        {editing && <EditButtons title={panel.title} onEdit={onEdit} onRemove={onRemove} />}
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3">
        {panelId === null ? (
          <PanelMessage tone="muted">Save the dashboard to run this panel</PanelMessage>
        ) : run.isError ? (
          <PanelMessage tone="error">{run.error.message}</PanelMessage>
        ) : run.isPending ? (
          <PanelMessage tone="muted">Running…</PanelMessage>
        ) : visual && run.data?.kind === "fleet" && panel.viz.type === "stat" ? (
          <FleetStats spec={panel.viz} result={run.data} />
        ) : visual && (run.data?.kind === "single" || visual.data.rows.length > 0) ? (
          <PanelVisual spec={visual.spec} data={visual.data} height={chartHeight} title={panel.title} extraLines={alertLines} decorate={run.data?.kind === "single" ? decorate : undefined} onDatumClick={onDatum && run.data?.kind === "single" ? datumClick : undefined} />
        ) : (
          <PanelMessage tone="error">No connection returned a result</PanelMessage>
        )}
        {failures.length > 0 && run.data?.kind === "fleet" && (
          <ul className="mt-2 space-y-0.5 border-t border-ink-500 pt-2" aria-label="Connections that failed">
            <li className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">{failures.length} of {run.data.connections.length} connections failed</li>
            {failures.map((f) => (
              <li key={f.connectionId} className="text-[11px] text-red-300"><span className="font-mono">{f.connectionName}</span>: {f.error}</li>
            ))}
          </ul>
        )}
        {run.data?.kind === "fleet" && run.data.omitted > 0 && (
          <p className="mt-1 text-[11px] text-amber-300">Showing the first {run.data.connections.length} connections by name; {run.data.omitted} more are not run.</p>
        )}
      </div>
      {meta && <p className="shrink-0 px-3 pb-1 text-right font-mono text-[10px] text-paper-faint" data-testid="panel-meta">{meta}</p>}
    </section>
  );
}

/** A chart panel drawn from a stored result (a snapshot): nothing runs, nothing refreshes. */
export function StaticChartCard({ panel, result, height }: { panel: ChartPanelInput; result: SnapshotResult | undefined; height: number }): React.ReactElement {
  const chartHeight = Math.max(48, height - CHART_CHROME_PX);
  const run = result?.ok ? result : null;
  const visual = useMemo(() => {
    if (!run) return null;
    if (run.kind === "single") return { spec: panel.viz, data: run.data };
    return fleetVisual(panel.viz, run);
  }, [run, panel.viz]);
  const failures = run?.kind === "fleet" ? run.connections.filter((e): e is Extract<typeof e, { ok: false }> => !e.ok) : [];
  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100" aria-label={panel.title}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-ink-500 px-3">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-paper" title={panel.title}>{panel.title}</h3>
        {panel.fleet && <span className="flex items-center gap-1 rounded-full border border-ink-500 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim"><Zap className="h-3 w-3" aria-hidden /> Fleet</span>}
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3">
        {result === undefined ? (
          <PanelMessage tone="muted">This panel was not in the snapshot</PanelMessage>
        ) : !result.ok ? (
          <PanelMessage tone="error">{result.error}</PanelMessage>
        ) : visual && result.kind === "fleet" && panel.viz.type === "stat" ? (
          <FleetStats spec={panel.viz} result={result} />
        ) : visual && (result.kind === "single" || visual.data.rows.length > 0) ? (
          <PanelVisual spec={visual.spec} data={visual.data} height={chartHeight} title={panel.title} />
        ) : (
          <PanelMessage tone="error">No connection returned a result</PanelMessage>
        )}
        {failures.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-ink-500 pt-2" aria-label="Connections that failed">
            {failures.map((f) => <li key={f.connectionId} className="text-[11px] text-red-300"><span className="font-mono">{f.connectionName}</span>: {f.error}</li>)}
          </ul>
        )}
      </div>
      {run && <p className="shrink-0 px-3 pb-1 text-right font-mono text-[10px] text-paper-faint">{runMeta(run, false)}</p>}
    </section>
  );
}

function Chip({ icon, text, title, tone, testId }: { icon: React.ReactNode; text: string; title: string; tone: "muted" | "error"; testId: string }): React.ReactElement {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]", tone === "error" ? "bg-red-950/40 text-red-300" : "border border-ink-500 text-paper-dim")}
            data-testid={testId}
            aria-label={`${text}: ${title}`}
          >
            {icon} {text}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface TextProps {
  panel: TextPanelInput;
  editing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}

export function TextPanelCard({ panel, editing, onEdit, onRemove }: TextProps): React.ReactElement {
  const label = panel.title || "Text";
  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100" aria-label={label} data-testid="text-panel">
      {(panel.title || editing) && (
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-ink-500 px-3">
          {editing && <DragHandle title={label} />}
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-paper">{panel.title}</h3>
          {editing && <EditButtons title={label} onEdit={onEdit} onRemove={onRemove} />}
        </header>
      )}
      <div className="markdown-panel min-h-0 flex-1 overflow-auto px-3 py-2 text-sm leading-relaxed text-paper-muted">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-yellow-300 underline underline-offset-2">{children}</a> }}
        >
          {panel.markdown}
        </ReactMarkdown>
      </div>
    </section>
  );
}

interface HeadingProps {
  panel: HeadingPanelInput;
  editing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}

export function HeadingPanelCard({ panel, editing, onEdit, onRemove }: HeadingProps): React.ReactElement {
  return (
    <section className={cn("flex h-full min-w-0 items-end gap-3 border-b border-ink-500 pb-1", editing && "rounded-md border border-dashed border-ink-500 px-2")} aria-label={panel.title} data-testid="heading-panel">
      {editing && <span className="self-center"><DragHandle title={panel.title} /></span>}
      <h2 className="truncate text-base font-semibold text-paper">{panel.title}</h2>
      {panel.description && <p className="min-w-0 flex-1 truncate pb-0.5 text-xs text-paper-dim">{panel.description}</p>}
      {!panel.description && <span className="flex-1" />}
      {editing && <span className="flex self-center"><EditButtons title={panel.title} onEdit={onEdit} onRemove={onRemove} /></span>}
    </section>
  );
}
