/**
 * Edit one panel (ADR 0021 §12): SQL, chart settings, size and fleet, with a
 * live preview through /api/dashboards/preview and the lint findings — each
 * mechanical fix is a button the user presses, never applied for them.
 */

import React, { Suspense, lazy, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lightbulb, Loader2, Play } from "lucide-react";

import { PanelMessage, PanelVisual } from "@/components/charts/PanelVisual";
import { VizSpecEditor } from "@/components/charts/VizSpecEditor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { previewPanel, type PanelInput, type PanelRunResult } from "@/api/dashboards";
import { suggestSpec } from "@/lib/viz/autodetect";
import { mergeFleet, type ResultColumn } from "@/lib/viz/resolve";
import { PANEL_HEIGHTS, PANEL_WIDTHS, vizSpecProblems, type Variable } from "@/lib/viz/spec";

import type { ViewState } from "../urlState";

const PanelSqlEditor = lazy(() => import("./PanelSqlEditor"));

const HEIGHT_LABELS: Record<PanelInput["height"], string> = { s: "Small", m: "Medium", l: "Large" };

/** Chart types a fleet panel can draw (server: validate.ts fleetProblems). */
export function fleetProblem(panel: Pick<PanelInput, "fleet" | "viz">): string | null {
  if (!panel.fleet) return null;
  const allowed = ["bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "multi_line", "area", "stacked_area", "stat", "table"];
  if (!allowed.includes(panel.viz.type)) return `A ${panel.viz.type} chart cannot run across the fleet; use a line, area, bar, stat or table`;
  if (panel.viz.series !== null) return "A fleet panel splits by connection, so it cannot also split by series";
  if (panel.viz.type !== "table" && panel.viz.y.length !== 1) return "A fleet panel plots exactly one y column per connection";
  return null;
}

function resultColumns(result: PanelRunResult): ResultColumn[] {
  if (result.kind === "single") return result.data.columns;
  const first = result.connections.find((e) => e.ok);
  return first && first.ok ? first.data.columns : [];
}

function ApplyFix({ sql, onApply }: { sql: string; onApply: (sql: string) => void }): React.ReactElement {
  return <Button size="sm" variant="outline" className="h-6" onClick={() => onApply(sql)}>Apply fix</Button>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: PanelInput;
  variables: Variable[];
  view: ViewState;
  onSave: (panel: PanelInput) => void;
}

export function PanelEditor({ open, onOpenChange, initial, variables, view, onSave }: Props): React.ReactElement {
  const [draft, setDraft] = useState<PanelInput>(initial);
  const preview = useMutation({
    mutationFn: () => previewPanel({ sql: draft.sql, viz: draft.viz, fleet: draft.fleet, variables, values: view.values, range: view.range, connectionId: view.connectionId }),
  });
  const columns = useMemo(() => (preview.data ? resultColumns(preview.data.result) : []), [preview.data]);
  const fleet = fleetProblem(draft);
  const problems = [...vizSpecProblems(draft.viz), ...(fleet ? [fleet] : [])];
  const visual = useMemo(() => {
    const result = preview.data?.result;
    if (!result) return null;
    if (result.kind === "single") return { spec: draft.viz, data: result.data };
    const ok = result.connections.filter((e): e is Extract<typeof e, { ok: true }> => e.ok);
    const data = mergeFleet(ok.map((e) => ({ connectionName: e.connectionName, data: e.data })));
    return { spec: draft.viz.type === "table" || draft.viz.type === "stat" ? draft.viz : { ...draft.viz, series: "connection" }, data };
  }, [preview.data, draft.viz]);

  const runPreview = (): void => preview.mutate();

  const useSuggestion = (): void => {
    if (columns.length === 0 || !preview.data) return;
    const rows = preview.data.result.kind === "single" ? preview.data.result.data.rows.length : 0;
    setDraft((d) => ({ ...d, viz: suggestSpec(columns, rows) }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial.id ? "Edit panel" : "New panel"}</DialogTitle>
          <DialogDescription>
            Use {"{{from}}"}, {"{{to}}"} and {"{{interval_s}}"} for the time range{variables.length > 0 ? `, and ${variables.map((v) => `{{var.${v.name}}}`).join(", ")}` : ""}. Panels run read-only, with each viewer's own access.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-60 flex-1 flex-col gap-1">
              <span className="text-xs text-paper-dim">Title</span>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-paper-dim">Width</span>
              <Select value={String(draft.width)} onValueChange={(v) => setDraft({ ...draft, width: Number(v) as PanelInput["width"] })}>
                <SelectTrigger className="w-28" aria-label="Width"><SelectValue /></SelectTrigger>
                <SelectContent>{PANEL_WIDTHS.map((w) => <SelectItem key={w} value={String(w)}>{w} / 12</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-paper-dim">Height</span>
              <Select value={draft.height} onValueChange={(v) => setDraft({ ...draft, height: v as PanelInput["height"] })}>
                <SelectTrigger className="w-28" aria-label="Height"><SelectValue /></SelectTrigger>
                <SelectContent>{PANEL_HEIGHTS.map((h) => <SelectItem key={h} value={h}>{HEIGHT_LABELS[h]}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs text-paper-dim">
              <Switch checked={draft.fleet} onCheckedChange={(fleet) => setDraft({ ...draft, fleet })} aria-label="Run across the fleet" />
              Run on every connection
            </label>
          </div>

          <Suspense fallback={<div className="h-48 rounded-xs border border-ink-500" />}>
            <PanelSqlEditor value={draft.sql} onChange={(sql) => setDraft((d) => ({ ...d, sql }))} height={200} />
          </Suspense>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={runPreview} disabled={preview.isPending || draft.sql.trim() === ""}>
              {preview.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />} Run preview
            </Button>
            {columns.length > 0 && <Button size="sm" variant="outline" onClick={useSuggestion}>Suggest a chart</Button>}
          </div>

          {preview.data && preview.data.lint.length > 0 && (
            <ul className="space-y-2 rounded-xs border border-amber-900/40 bg-amber-950/20 p-3" aria-label="Things to check">
              {preview.data.lint.map((f) => (
                <li key={f.code} className="flex items-start gap-2 text-xs text-amber-200">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="flex-1">{f.message}</span>
                  {f.fixedSql !== undefined && <ApplyFix sql={f.fixedSql} onApply={(sql) => setDraft((d) => ({ ...d, sql }))} />}
                </li>
              ))}
            </ul>
          )}

          <VizSpecEditor spec={draft.viz} columns={columns.length > 0 ? columns : [...new Set([draft.viz.x, ...draft.viz.y, draft.viz.series].filter((c): c is string => c !== null))].map((name) => ({ name, type: "" }))} onChange={(viz) => setDraft((d) => ({ ...d, viz }))} hideProblems />

          {problems.length > 0 && (
            <ul className="list-disc pl-5 text-[11px] text-amber-300" data-testid="panel-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}

          <div className="rounded-xs border border-ink-500 bg-ink-100 p-3">
            {preview.isError ? (
              <PanelMessage tone="error">{preview.error.message}</PanelMessage>
            ) : visual && problems.length === 0 ? (
              <PanelVisual spec={visual.spec} data={visual.data} height={260} title={draft.title} />
            ) : (
              <PanelMessage tone="muted">{preview.data ? "Fix the settings above to draw the preview" : "Run a preview to see the result"}</PanelMessage>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave({ ...draft, title: draft.title.trim() })} disabled={problems.length > 0 || draft.title.trim() === "" || draft.sql.trim() === ""}>
            {initial.id ? "Update panel" : "Add panel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
