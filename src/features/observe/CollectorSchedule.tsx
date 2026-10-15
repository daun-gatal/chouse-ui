/**
 * Collection schedule (issue #380): how often each observability collector
 * runs and what it costs ClickHouse. One table for two scopes — the defaults
 * for every connection (Admin › Connections › Collection schedule) and one
 * connection's own settings (the connection's edit dialog). Reading needs
 * connections:view; changing needs connections:edit.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save } from "lucide-react";

import type { CollectorScheduleRow, CollectorScheduleSetting, CollectorScheduleView } from "@/api/observe";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCollectorSchedule, useSaveCollectorSchedule } from "./hooks";
import { formatAgo, formatBytes, formatCount, formatDuration } from "./lib";
import {
  inheritedInterval,
  inheritedPaused,
  initialDrafts,
  intervalChoices,
  runsPerDay,
  scheduleDirty,
  schedulePayload,
  type ScheduleScope,
} from "./schedule";
import { StatusPill } from "./ui";

const INHERIT = "inherit";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
const TRIGGER = "h-8 w-full rounded-xs border-ink-500 bg-ink-200 text-[11px]";
/**
 * Columns once the schedule has room (its own width, not the window's: it
 * also sits in narrow panels); below that each collector stacks as a card.
 */
const ROW_GRID = "grid grid-cols-2 gap-x-3 gap-y-2 @2xl:grid-cols-[minmax(0,1fr)_170px_150px_170px_96px]";
const CELL_LABEL = `${LABEL} mb-1 block @2xl:hidden`;

function draftInterval(row: CollectorScheduleRow, scope: ScheduleScope, draft: CollectorScheduleSetting): number {
  return draft.intervalSeconds ?? inheritedInterval(row, scope).seconds;
}

function draftPaused(row: CollectorScheduleRow, scope: ScheduleScope, draft: CollectorScheduleSetting): boolean {
  if (!row.pausable) return false;
  return draft.paused ?? inheritedPaused(row, scope);
}

/** Bytes a day at the drafted schedule: this connection's last run, or the saved projection for the defaults. */
function perDay(row: CollectorScheduleRow, scope: ScheduleScope, draft: CollectorScheduleSetting): number | null {
  if (scope === "defaults" || !row.status || row.status.readBytes === null) return row.projectedBytesPerDay;
  if (draftPaused(row, scope, draft)) return 0;
  return row.status.readBytes * runsPerDay(draftInterval(row, scope, draft));
}

function LastRun({ row }: { row: CollectorScheduleRow }): ReactElement {
  const status = row.status;
  if (!status) return <span className="text-[11px] text-paper-faint">Not run yet</span>;
  const tone = status.state === "ok" ? "ok" : status.state === "missing_privileges" ? "warn" : "bad";
  return (
    <div className="space-y-0.5 text-[11px] text-paper-muted">
      <div className="flex items-center gap-1.5">
        <StatusPill tone={tone} dot={false}>{status.state.replace("_", " ")}</StatusPill>
        <span>{formatAgo(status.lastRunAt)}</span>
      </div>
      <div className="font-mono text-[10px] text-paper-faint">
        {status.durationMs !== null ? `${formatDuration(status.durationMs / 1000)}` : "—"}
        {status.queryCount !== null && ` · ${formatCount(status.queryCount)} quer${status.queryCount === 1 ? "y" : "ies"}`}
        {status.readBytes !== null && ` · ${formatBytes(status.readBytes)} read`}
      </div>
    </div>
  );
}

function ScheduleRowView({ row, scope, draft, canEdit, onChange }: {
  row: CollectorScheduleRow;
  scope: ScheduleScope;
  draft: CollectorScheduleSetting;
  canEdit: boolean;
  onChange: (next: CollectorScheduleSetting) => void;
}): ReactElement {
  const inherited = inheritedInterval(row, scope);
  const choices = intervalChoices(row, [row.defaults.intervalSeconds, row.override?.intervalSeconds, draft.intervalSeconds]);
  const interval = draftInterval(row, scope, draft);
  const paused = draftPaused(row, scope, draft);
  const slower = !paused && interval > row.builtInSeconds;
  const day = perDay(row, scope, draft);
  const globalHere = scope === "connection" && row.global;

  return (
    <div role="row" className={`${ROW_GRID} border-t border-ink-500 py-2`}>
      <div role="cell" className="col-span-2 min-w-0 @2xl:col-span-1">
        <div className="flex items-center gap-1.5 text-[12px] text-paper">
          {row.label}
          {row.global && <StatusPill tone="muted" dot={false}>all connections</StatusPill>}
        </div>
        <p className="text-[11px] text-paper-faint">{row.description}</p>
        <p className="font-mono text-[10px] text-paper-faint">Reads {row.reads}</p>
        {(paused || slower) && <p className="mt-1 text-[11px] text-amber-500">{paused ? "Paused: its Data pages stop updating. " : ""}{row.slower}</p>}
      </div>
      <div role="cell" className="min-w-0">
        <span className={CELL_LABEL}>Runs</span>
        {globalHere ? (
          <span className="text-[11px] text-paper-muted">Every {formatDuration(row.effective.intervalSeconds)} — set in the defaults</span>
        ) : (
          <Select
            value={draft.intervalSeconds == null ? INHERIT : String(draft.intervalSeconds)}
            onValueChange={(v) => onChange({ ...draft, intervalSeconds: v === INHERIT ? null : Number(v) })}
            disabled={!canEdit}
          >
            <SelectTrigger className={TRIGGER} aria-label={`${row.label} interval`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>{scope === "defaults" ? "Built-in" : "Inherit"} · {formatDuration(inherited.seconds)}{scope === "connection" ? ` (${inherited.from})` : ""}</SelectItem>
              {choices.map((s) => <SelectItem key={s} value={String(s)}>Every {formatDuration(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      <div role="cell" className="min-w-0">
        <span className={CELL_LABEL}>State</span>
        {globalHere || !row.pausable ? (
          <span className="text-[11px] text-paper-muted">Always runs</span>
        ) : (
          <Select
            value={draft.paused == null ? INHERIT : draft.paused ? "paused" : "running"}
            onValueChange={(v) => onChange({ ...draft, paused: v === INHERIT ? null : v === "paused" })}
            disabled={!canEdit}
          >
            <SelectTrigger className={TRIGGER} aria-label={`${row.label} state`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>{scope === "defaults" ? "Running" : `Inherit · ${inheritedPaused(row, scope) ? "paused" : "running"}`}</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <div role="cell" className="min-w-0">
        <span className={CELL_LABEL}>{scope === "connection" ? "Last run" : "Connections"}</span>
        {scope === "connection" ? <LastRun row={row} /> : (
          <span className="text-[11px] text-paper-muted">
            {row.global ? "—" : row.overriddenOn > 0 ? `Own setting on ${row.overriddenOn} connection${row.overriddenOn === 1 ? "" : "s"}` : "No connection overrides"}
            {row.pausedOn > 0 && <span className="block text-amber-500">Paused on {row.pausedOn}</span>}
          </span>
        )}
      </div>
      <div role="cell" className="font-mono text-[11px] tabular-nums text-paper @2xl:text-right">
        <span className={CELL_LABEL}>Read per day</span>
        {day === null ? <span className="text-paper-faint">—</span> : `${formatBytes(day)}/day`}
      </div>
    </div>
  );
}

function ScheduleTable({ view, scope, connectionId, canEdit }: { view: CollectorScheduleView; scope: ScheduleScope; connectionId: string | null; canEdit: boolean }): ReactElement {
  const [drafts, setDrafts] = useState(() => initialDrafts(view.collectors, scope));
  const save = useSaveCollectorSchedule();
  const dirty = scheduleDirty(view.collectors, scope, drafts);

  const submit = async (): Promise<void> => {
    try {
      const saved = await save.mutateAsync({ connectionId, collectors: schedulePayload(drafts) });
      setDrafts(initialDrafts(saved.collectors, scope));
      toast.success(scope === "defaults" ? "Collection schedule saved for every connection" : "Collection schedule saved for this connection");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the collection schedule");
    }
  };

  return (
    <div className="@container space-y-2">
      <div role="table" aria-label="Collection schedule">
        <div role="row" className={`${ROW_GRID} hidden pb-1 @2xl:grid`}>
          <span role="columnheader" className={LABEL}>Collector</span>
          <span role="columnheader" className={LABEL}>Runs</span>
          <span role="columnheader" className={LABEL}>State</span>
          <span role="columnheader" className={LABEL}>{scope === "connection" ? "Last run" : "Connections"}</span>
          <span role="columnheader" className={`${LABEL} text-right`} title={scope === "connection" ? "The last run's reads at this schedule" : "Summed over active connections at the saved schedule"}>Read per day</span>
        </div>
        {view.collectors.map((row) => (
          <ScheduleRowView key={row.name} row={row} scope={scope} draft={drafts[row.name] ?? {}} canEdit={canEdit}
            onChange={(next) => setDrafts((d) => ({ ...d, [row.name]: next }))} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-paper-faint">
          {view.updatedAt ? `Changed ${formatAgo(view.updatedAt)}.` : "Every collector runs at its built-in interval."} Changes apply within seconds, on every server.
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-8 rounded-xs text-[11px]" disabled={!dirty || save.isPending} onClick={() => setDrafts(initialDrafts(view.collectors, scope))}>
              <RotateCcw className="mr-1 h-3 w-3" /> Undo changes
            </Button>
            <Button type="button" className="h-8 rounded-xs bg-brand text-[11px] text-ink-50 hover:bg-brand-soft" disabled={!dirty || save.isPending} onClick={() => void submit()}>
              {save.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />} Save schedule
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The schedule for every connection (`connectionId` null) or one connection. */
export function CollectorSchedule({ connectionId, canEdit }: { connectionId: string | null; canEdit: boolean }): ReactElement {
  const schedule = useCollectorSchedule(connectionId);
  if (schedule.isLoading) return <p className="text-[11px] text-paper-faint">Loading the collection schedule…</p>;
  if (schedule.isError || !schedule.data) return <p className="text-[11px] text-red-400">The collection schedule could not be loaded.</p>;
  // Keyed by the saved state so a save elsewhere resets the drafts.
  return <ScheduleTable key={schedule.data.updatedAt ?? 0} view={schedule.data} scope={connectionId ? "connection" : "defaults"} connectionId={connectionId} canEdit={canEdit} />;
}
