/**
 * Dashboard settings (ADR 0021 §1, §3): title, description, default range,
 * refresh and connection, and the variables panels can use. Changes go into
 * the edit session; the dashboard is saved with Save.
 */

import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DashboardInput } from "@/api/dashboards";
import { IDENTIFIER_RE, RELATIVE_RANGE_KEYS, REFRESH_SECONDS, VARIABLE_NAME_RE, type RefreshSeconds, type RelativeRange, type Variable } from "@/lib/viz/spec";
import { BTN_ICON, BTN_OUTLINE, BTN_PRIMARY, FIELD, TEXTAREA, FIELD_LABEL } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";

import { refreshLabel } from "./ViewControls";

/** What is wrong with a variable definition (empty when it can be saved). */
export function variableProblems(variable: Variable, all: Variable[]): string[] {
  const problems: string[] = [];
  if (!VARIABLE_NAME_RE.test(variable.name)) problems.push("Name: lowercase letters, digits and _, starting with a letter");
  if (all.filter((v) => v.name === variable.name).length > 1) problems.push(`Another variable is also named ${variable.name}`);
  if (variable.label.trim() === "") problems.push("Give it a label");
  if (variable.options.source === "static") {
    if (variable.options.values.length === 0) problems.push("List at least one value");
    if (variable.kind === "identifier" && variable.options.values.some((v) => !IDENTIFIER_RE.test(v))) problems.push("Identifier values may only use letters, digits and _");
  } else if (variable.options.sql.trim() === "") {
    problems.push("Write the options query");
  }
  if (variable.kind === "identifier" && !IDENTIFIER_RE.test(variable.default)) problems.push("The default must be an identifier (letters, digits and _)");
  return problems;
}

type Settings = Omit<DashboardInput, "panels">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  connections: Array<{ id: string; name: string }>;
  onApply: (settings: Settings) => void;
}

function newVariable(existing: Variable[]): Variable {
  let n = existing.length + 1;
  while (existing.some((v) => v.name === `var${n}`)) n += 1;
  return { name: `var${n}`, label: `Variable ${n}`, kind: "string", options: { source: "static", values: [""] }, default: "" };
}

export function DashboardSettingsDialog({ open, onOpenChange, settings, connections, onApply }: Props): React.ReactElement {
  const [draft, setDraft] = useState<Settings>(settings);
  const problems = draft.variables.flatMap((v) => variableProblems(v, draft.variables).map((p) => `${v.label || v.name}: ${p}`));
  const titleMissing = draft.title.trim() === "";

  const setVariable = (i: number, next: Variable): void => setDraft({ ...draft, variables: draft.variables.map((v, j) => (j === i ? next : v)) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Dashboard settings</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Title</span>
            <Input className={FIELD} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Description</span>
            <Textarea className={TEXTAREA} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={2000} rows={2} />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Default time range</span>
              <Select value={draft.timeRange} onValueChange={(v) => setDraft({ ...draft, timeRange: v as RelativeRange })}>
                <SelectTrigger className={cn(FIELD, "w-32")} aria-label="Default time range"><SelectValue /></SelectTrigger>
                <SelectContent>{RELATIVE_RANGE_KEYS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Default refresh</span>
              <Select value={String(draft.refreshSeconds)} onValueChange={(v) => setDraft({ ...draft, refreshSeconds: Number(v) as RefreshSeconds })}>
                <SelectTrigger className={cn(FIELD, "w-28")} aria-label="Default refresh"><SelectValue /></SelectTrigger>
                <SelectContent>{REFRESH_SECONDS.map((s) => <SelectItem key={s} value={String(s)}>{refreshLabel(s)}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Default connection</span>
              <Select value={draft.connectionId ?? ""} onValueChange={(connectionId) => setDraft({ ...draft, connectionId })}>
                <SelectTrigger className={cn(FIELD, "w-48")} aria-label="Default connection"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>{connections.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className={FIELD_LABEL}>Variables — use them in panel SQL as {"{{var.name}}"}</span>
              <Button variant="outline" className={BTN_OUTLINE} disabled={draft.variables.length >= 10} onClick={() => setDraft({ ...draft, variables: [...draft.variables, newVariable(draft.variables)] })}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add variable
              </Button>
            </div>
            {draft.variables.map((v, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xs border border-ink-500 p-3" data-testid="variable-row">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Name</span>
                    <Input className={cn(FIELD, "w-32 font-mono")} value={v.name} onChange={(e) => setVariable(i, { ...v, name: e.target.value })} aria-label="Variable name" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Label</span>
                    <Input className={cn(FIELD, "w-40")} value={v.label} onChange={(e) => setVariable(i, { ...v, label: e.target.value })} aria-label="Variable label" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Kind</span>
                    <Select value={v.kind} onValueChange={(kind) => setVariable(i, { ...v, kind: kind as Variable["kind"] })}>
                      <SelectTrigger className={cn(FIELD, "w-36")} aria-label="Variable kind"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">Text value</SelectItem>
                        <SelectItem value="identifier">Database or table name</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Values from</span>
                    <Select
                      value={v.options.source}
                      onValueChange={(source) => setVariable(i, { ...v, options: source === "static" ? { source: "static", values: [v.default] } : { source: "query", sql: "" } })}
                    >
                      <SelectTrigger className={cn(FIELD, "w-32")} aria-label="Values from"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="static">A list</SelectItem>
                        <SelectItem value="query">A query</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Default</span>
                    <Input className={cn(FIELD, "w-36 font-mono")} value={v.default} onChange={(e) => setVariable(i, { ...v, default: e.target.value })} aria-label="Variable default" />
                  </label>
                  <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Remove ${v.label}`} onClick={() => setDraft({ ...draft, variables: draft.variables.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {v.options.source === "static" ? (
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Values, one per line</span>
                    <Textarea
                      className={cn(TEXTAREA, "font-mono text-xs")}
                      rows={3}
                      value={v.options.values.join("\n")}
                      onChange={(e) => setVariable(i, { ...v, options: { source: "static", values: e.target.value.split("\n") } })}
                    />
                  </label>
                ) : (
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>One-column SELECT (runs with each viewer's access)</span>
                    <Textarea
                      className={cn(TEXTAREA, "font-mono text-xs")}
                      rows={3}
                      value={v.options.sql}
                      placeholder="SELECT name FROM system.databases ORDER BY name"
                      onChange={(e) => setVariable(i, { ...v, options: { source: "query", sql: e.target.value } })}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          {problems.length > 0 && <ul className="list-disc pl-5 text-[11px] text-amber-300">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={BTN_PRIMARY} disabled={problems.length > 0 || titleMissing} onClick={() => { onApply({ ...draft, title: draft.title.trim() }); onOpenChange(false); }}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
