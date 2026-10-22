/**
 * Scheduled reports of a dashboard (ADR 0023 §13): a text digest with a link
 * back, sent daily or weekly to notification channels. A report runs as
 * whoever last saved it, on the connection it was saved on.
 */

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Loader2, Pencil, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { listChannels } from "@/api/alerting";
import { createReport, deleteReport, listReports, sendReport, updateReport, type DashboardDetail, type Report, type ReportInput, type ReportSchedule } from "@/api/dashboards";
import { RELATIVE_RANGE_KEYS, type RelativeRange } from "@/lib/viz/spec";
import { cn } from "@/lib/utils";
import { BTN_ICON, BTN_OUTLINE, BTN_PRIMARY, FIELD, FIELD_LABEL } from "@/components/charts/controlStyles";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function scheduleLabel(s: ReportSchedule): string {
  const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  return s.kind === "daily" ? `Daily at ${time} ${s.timezone}` : `${WEEKDAYS[s.dayOfWeek ?? 0]}s at ${time} ${s.timezone}`;
}

/** The browser's zone, or UTC when it cannot say. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const select = cn(FIELD, "h-8 rounded-xs px-2 text-xs");

function ReportForm({ initial, saving, error, onCancel, onSubmit }: { initial: ReportInput; saving: boolean; error: string | null; onCancel: () => void; onSubmit: (input: ReportInput) => void }): React.ReactElement {
  const [draft, setDraft] = useState<ReportInput>(initial);
  const channels = useQuery({ queryKey: ["alerting", "channels"], queryFn: listChannels });
  const s = draft.schedule;
  const setSchedule = (patch: Partial<ReportSchedule>): void => setDraft({ ...draft, schedule: { ...s, ...patch } });
  const invalid = draft.name.trim() === "" || draft.channelIds.length === 0 || s.timezone.trim() === "";
  return (
    <div className="flex flex-col gap-3 rounded-xs border border-ink-500 p-3 text-sm" data-testid="report-form">
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>Name</span>
        <Input className={FIELD} value={draft.name} maxLength={200} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Every</span>
          <select aria-label="Every" className={select} value={s.kind} onChange={(e) => setSchedule(e.target.value === "weekly" ? { kind: "weekly", dayOfWeek: s.dayOfWeek ?? 1 } : { kind: "daily", dayOfWeek: null })}>
            <option value="daily">Day</option>
            <option value="weekly">Week</option>
          </select>
        </label>
        {s.kind === "weekly" && (
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>On</span>
            <select aria-label="Day of the week" className={select} value={s.dayOfWeek ?? 1} onChange={(e) => setSchedule({ dayOfWeek: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>At</span>
          <Input
            type="time"
            aria-label="Time"
            className={cn(FIELD, "h-8 w-28")}
            value={`${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (Number.isInteger(h) && Number.isInteger(m)) setSchedule({ hour: h, minute: m });
            }}
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className={FIELD_LABEL}>Time zone</span>
          <Input aria-label="Time zone" className={cn(FIELD, "h-8")} value={s.timezone} onChange={(e) => setSchedule({ timezone: e.target.value.trim() })} placeholder="Europe/Berlin" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Covering the last</span>
          <select aria-label="Covering the last" className={select} value={draft.range} onChange={(e) => setDraft({ ...draft, range: RELATIVE_RANGE_KEYS.find((r) => r === e.target.value) ?? draft.range })}>
            {RELATIVE_RANGE_KEYS.map((r: RelativeRange) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-paper-dim">
          <Switch checked={draft.onlyIfAlert} onCheckedChange={(onlyIfAlert) => setDraft({ ...draft, onlyIfAlert })} aria-label="Only when an alert fired" /> Only when one of the dashboard's alerts fired
        </label>
        <label className="flex items-center gap-2 text-xs text-paper-dim">
          <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} aria-label="Enabled" /> Enabled
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>Send to</span>
        {channels.isError && <p role="alert" className="text-xs text-red-300">{channels.error.message}</p>}
        {channels.isSuccess && channels.data.length === 0 && <p className="text-xs text-paper-faint">No notification channels yet. Add one in Admin › Alerting.</p>}
        <div className="flex flex-wrap gap-3">
          {(channels.data ?? []).map((ch) => (
            <label key={ch.id} className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={draft.channelIds.includes(ch.id)}
                onCheckedChange={(c) => setDraft({ ...draft, channelIds: c === true ? [...draft.channelIds, ch.id] : draft.channelIds.filter((id) => id !== ch.id) })}
                aria-label={`Send to ${ch.name}`}
              />
              {ch.name}{ch.enabled ? "" : " (disabled)"}
            </label>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-paper-faint">Runs every chart with the variables' defaults, with the access of whoever saves it, on the connection it was first made on.</p>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" className={BTN_OUTLINE} onClick={onCancel}>Cancel</Button>
        <Button className={BTN_PRIMARY} disabled={saving || invalid} onClick={() => onSubmit({ ...draft, name: draft.name.trim() })}>{saving ? "Saving…" : "Save report"}</Button>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = { sent: "text-emerald-300", skipped: "text-paper-dim", failed: "text-red-300" };

interface Props {
  detail: DashboardDetail;
  connectionId: string | null;
  canManage: boolean;
  onClose: () => void;
}

export function ReportsDialog({ detail, connectionId, canManage, onClose }: Props): React.ReactElement {
  const id = detail.dashboard.id;
  const queryClient = useQueryClient();
  const reports = useQuery({ queryKey: ["dashboards", "reports", id], queryFn: () => listReports(id), retry: false });
  const [form, setForm] = useState<{ report: Report | null } | null>(null);
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ["dashboards", "reports", id] });

  const save = useMutation({
    mutationFn: (input: ReportInput) => (form?.report ? updateReport(id, form.report.id, input) : createReport(id, input)),
    onSuccess: async () => { setForm(null); await refresh(); toast.success("Report saved"); },
  });
  const remove = useMutation({ mutationFn: (reportId: string) => deleteReport(id, reportId), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const send = useMutation({
    mutationFn: (reportId: string) => sendReport(id, reportId),
    onSuccess: async (run) => {
      await refresh();
      if (run.status === "sent") toast.success(`Sent to ${run.deliveredTo.join(", ")}`);
      else toast.error(run.error ?? `The report was ${run.status}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const ready = reports.data?.publicBaseUrl === true;
  const initial = (report: Report | null): ReportInput => report
    ? { name: report.name, connectionId: report.connectionId, schedule: report.schedule, range: report.range, onlyIfAlert: report.onlyIfAlert, enabled: report.enabled, channelIds: report.channelIds }
    : { name: `${detail.dashboard.title} daily`, connectionId: connectionId ?? "", schedule: { kind: "daily", dayOfWeek: null, hour: 9, minute: 0, timezone: localZone() }, range: "24h", onlyIfAlert: false, enabled: true, channelIds: [] };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" aria-hidden /> Scheduled reports</DialogTitle>
          <DialogDescription>A text summary of every chart — values, ranges, top rows, errors and the alerts that fired — with a link to the dashboard at that time.</DialogDescription>
        </DialogHeader>
        {reports.isPending && <Loader2 className="h-4 w-4 animate-spin text-paper-dim" aria-label="Loading reports" />}
        {reports.isError && <p role="alert" className="text-sm text-red-300">{reports.error.message}</p>}
        {reports.data && !ready && (
          <p role="status" className="rounded-xs border border-amber-900/40 bg-amber-950/20 p-2 text-xs text-amber-200">
            Reports link back to the dashboard, so the server needs PUBLIC_BASE_URL (Helm: publicBaseUrl). Until it is set, reports cannot be saved and saved ones fail.
          </p>
        )}
        {reports.data && reports.data.reports.length === 0 && !form && <p className="text-xs text-paper-faint">No reports yet.</p>}
        <ul className="flex flex-col gap-1.5" aria-label="Reports">
          {reports.data?.reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xs border border-ink-500 px-2 py-1.5 text-xs" data-testid="report-row">
              <div className="min-w-0 flex-1">
                <p className="truncate text-paper">{r.name}{r.enabled ? "" : " (off)"}</p>
                <p className="text-[11px] text-paper-dim">
                  {scheduleLabel(r.schedule)} · last {r.range}{r.onlyIfAlert ? " · only when an alert fired" : ""} · as {r.ownerName ?? "a removed user"}
                </p>
                {r.lastStatus && (
                  <p className={cn("text-[11px]", STATUS_TONE[r.lastStatus])} title={r.lastError ?? undefined}>
                    {r.lastStatus} {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : ""}{r.lastError ? ` — ${r.lastError}` : ""}
                  </p>
                )}
              </div>
              {canManage && (
                <>
                  <Button size="icon" variant="ghost" className={cn(BTN_ICON, "h-7 w-7")} aria-label={`Send ${r.name} now`} disabled={send.isPending || !ready} onClick={() => send.mutate(r.id)}><Send className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className={cn(BTN_ICON, "h-7 w-7")} aria-label={`Edit ${r.name}`} onClick={() => { save.reset(); setForm({ report: r }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className={cn(BTN_ICON, "h-7 w-7")} aria-label={`Delete ${r.name}`} disabled={remove.isPending} onClick={() => remove.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {form && (
          <ReportForm
            key={form.report?.id ?? "new"}
            initial={initial(form.report)}
            saving={save.isPending}
            error={save.isError ? save.error.message : null}
            onCancel={() => setForm(null)}
            onSubmit={(input) => save.mutate(input)}
          />
        )}
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Close</Button>
          {canManage && !form && (
            <Button className={BTN_PRIMARY} disabled={!ready || connectionId === null} title={connectionId === null ? "Pick a connection in the dock first" : undefined} onClick={() => { save.reset(); setForm({ report: null }); }}>
              <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> New report
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
