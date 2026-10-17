/**
 * Panel threshold alerts in the dashboard (ADR 0021 §7): a bell on each panel
 * shows its alerts' state; the dialog lists them with their last value or
 * error, checks one now, and creates, edits, enables and deletes them.
 * Alerts evaluate on the server as their owner, with the variable values and
 * connection they were saved with.
 */

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, BellRing, Pencil, Play, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { listChannels } from "@/api/alerting";
import {
  checkAlert,
  createAlert,
  deleteAlert,
  listAlerts,
  updateAlert,
  type AlertInput,
  type AlertState,
  type DashboardDetail,
  type PanelAlertWithStatus,
  type PanelInput,
} from "@/api/dashboards";
import { cn } from "@/lib/utils";
import { RELATIVE_RANGE_KEYS, REDUCERS, type RelativeRange } from "@/lib/viz/spec";
import { formatValue } from "@/lib/viz/units";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";

import { dashboardKeys } from "../hooks";
import type { ViewState } from "../urlState";

export const STATE_STYLES: Record<AlertState, { label: string; className: string }> = {
  ok: { label: "OK", className: "text-emerald-300" },
  pending: { label: "Pending", className: "text-amber-300" },
  firing: { label: "Firing", className: "text-red-400" },
  no_data: { label: "No data", className: "text-paper-dim" },
  error: { label: "Error", className: "text-red-300" },
};

/** The alerts of one dashboard, shared by every panel's bell. */
export function useDashboardAlerts(dashboardId: string): ReturnType<typeof useQuery<PanelAlertWithStatus[]>> {
  const canView = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.ALERTING_VIEW));
  return useQuery({ queryKey: dashboardKeys.alerts(dashboardId), queryFn: () => listAlerts(dashboardId), enabled: canView, refetchInterval: 60_000 });
}

function worstState(alerts: PanelAlertWithStatus[]): AlertState | null {
  const order: AlertState[] = ["firing", "error", "pending", "no_data", "ok"];
  for (const state of order) if (alerts.some((a) => a.enabled && a.status?.state === state)) return state;
  return null;
}

function defaults(panel: PanelInput, view: ViewState, range: RelativeRange): AlertInput {
  return {
    name: `${panel.title} alert`,
    severity: "warning",
    connectionId: view.connectionId ?? "",
    channelIds: [],
    enabled: true,
    config: { column: panel.viz.y[0] ?? "", reduce: "last", op: ">", value: 0, forEvaluations: 1, everyMinutes: 5, range, values: view.values },
  };
}

function AlertForm({ initial, panel, onCancel, onSubmit, saving, error }: { initial: AlertInput; panel: PanelInput; onCancel: () => void; onSubmit: (input: AlertInput) => void; saving: boolean; error: string | null }): React.ReactElement {
  const [draft, setDraft] = useState<AlertInput>(initial);
  const channels = useQuery({ queryKey: ["alerting", "channels"], queryFn: listChannels });
  const setConfig = (patch: Partial<AlertInput["config"]>): void => setDraft({ ...draft, config: { ...draft.config, ...patch } });
  const invalid = draft.name.trim() === "" || draft.channelIds.length === 0 || draft.connectionId === "" || !Number.isFinite(draft.config.value) || draft.config.column === "";
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="alert-form">
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-xs text-paper-dim">Name</span>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={200} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-paper-dim">Severity</span>
          <Select value={draft.severity} onValueChange={(v) => setDraft({ ...draft, severity: v as AlertInput["severity"] })}>
            <SelectTrigger className="w-32" aria-label="Severity"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="warning">Warning</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <span className="pb-2 text-xs text-paper-dim">Alert when the</span>
        <Select value={draft.config.reduce} onValueChange={(v) => setConfig({ reduce: v as AlertInput["config"]["reduce"] })}>
          <SelectTrigger className="w-24" aria-label="Reduce"><SelectValue /></SelectTrigger>
          <SelectContent>{REDUCERS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
        <span className="pb-2 text-xs text-paper-dim">of</span>
        <Select value={draft.config.column} onValueChange={(column) => setConfig({ column })}>
          <SelectTrigger className="w-40" aria-label="Column"><SelectValue placeholder="Column" /></SelectTrigger>
          <SelectContent>{panel.viz.y.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <span className="pb-2 text-xs text-paper-dim">over the last</span>
        <Select value={draft.config.range} onValueChange={(v) => setConfig({ range: v as RelativeRange })}>
          <SelectTrigger className="w-24" aria-label="Window"><SelectValue /></SelectTrigger>
          <SelectContent>{RELATIVE_RANGE_KEYS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
        <span className="pb-2 text-xs text-paper-dim">is</span>
        <Select value={draft.config.op} onValueChange={(v) => setConfig({ op: v as AlertInput["config"]["op"] })}>
          <SelectTrigger className="w-20" aria-label="Comparison"><SelectValue /></SelectTrigger>
          <SelectContent>{[">", ">=", "<", "<="].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" className="w-28" aria-label="Threshold" value={Number.isFinite(draft.config.value) ? draft.config.value : ""} onChange={(e) => setConfig({ value: e.target.valueAsNumber })} />
        <span className="pb-2 text-xs text-paper-faint">{formatValue(draft.config.value, panel.viz.unit, panel.viz.decimals)}</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-paper-dim">Check every (minutes)</span>
          <Input type="number" min={1} max={1440} className="w-28" value={draft.config.everyMinutes} onChange={(e) => setConfig({ everyMinutes: Math.max(1, Math.min(1440, Math.round(e.target.valueAsNumber || 1))) })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-paper-dim">Fire after (checks in a row)</span>
          <Input type="number" min={1} max={60} className="w-28" value={draft.config.forEvaluations} onChange={(e) => setConfig({ forEvaluations: Math.max(1, Math.min(60, Math.round(e.target.valueAsNumber || 1))) })} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-paper-dim">
          <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} aria-label="Enabled" /> Enabled
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-paper-dim">Notify</span>
        {channels.isError && <p role="alert" className="text-xs text-red-300">{channels.error.message}</p>}
        {channels.isSuccess && channels.data.length === 0 && <p className="text-xs text-paper-faint">No notification channels yet. Add one in Admin › Alerting.</p>}
        <div className="flex flex-wrap gap-3">
          {(channels.data ?? []).map((ch) => (
            <label key={ch.id} className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={draft.channelIds.includes(ch.id)}
                onCheckedChange={(c) => setDraft({ ...draft, channelIds: c === true ? [...draft.channelIds, ch.id] : draft.channelIds.filter((id) => id !== ch.id) })}
                aria-label={`Notify ${ch.name}`}
              />
              {ch.name}{ch.enabled ? "" : " (disabled)"}
            </label>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-paper-faint">
        Runs on the current connection with the current variable values ({Object.entries(draft.config.values).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}), with your access.
      </p>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSubmit({ ...draft, name: draft.name.trim() })} disabled={saving || invalid}>{saving ? "Saving…" : "Save alert"}</Button>
      </div>
    </div>
  );
}

interface Props {
  detail: DashboardDetail;
  panelId: string;
  panel: PanelInput;
  view: ViewState;
}

export function PanelAlertsButton({ detail, panelId, panel, view }: Props): React.ReactElement | null {
  const queryClient = useQueryClient();
  const canView = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.ALERTING_VIEW));
  const canEdit = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.ALERTING_EDIT)) && detail.access.edit;
  const canDelete = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.ALERTING_DELETE)) && detail.access.edit;
  const alerts = useDashboardAlerts(detail.dashboard.id);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ alert: PanelAlertWithStatus | null } | null>(null);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const id = detail.dashboard.id;
  const mine = (alerts.data ?? []).filter((a) => a.panelId === panelId);
  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: dashboardKeys.alerts(id) });

  const save = useMutation({
    mutationFn: (input: AlertInput) => (form?.alert ? updateAlert(id, form.alert.id, input) : createAlert(id, panelId, input)),
    onSuccess: async () => { await invalidate(); setForm(null); toast.success("Alert saved"); },
  });
  const remove = useMutation({
    mutationFn: (alertId: string) => deleteAlert(id, alertId),
    onSuccess: async () => { await invalidate(); toast.success("Alert deleted"); },
    onError: (e) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (a: PanelAlertWithStatus) => updateAlert(id, a.id, { name: a.name, severity: a.severity, connectionId: a.connectionId, channelIds: a.channelIds, enabled: !a.enabled, config: a.config }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });
  const check = async (alertId: string): Promise<void> => {
    try {
      const outcome = await checkAlert(id, alertId);
      setChecks((c) => ({ ...c, [alertId]: outcome.kind === "value" ? `Now: ${formatValue(outcome.value, panel.viz.unit, panel.viz.decimals)}` : outcome.reason }));
    } catch (e) {
      setChecks((c) => ({ ...c, [alertId]: e instanceof Error ? e.message : String(e) }));
    }
  };

  if (!canView || panel.fleet) return null;
  const worst = worstState(mine);
  const Icon = worst === "firing" ? BellRing : Bell;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", worst ? STATE_STYLES[worst].className : "text-paper-faint")}
        aria-label={mine.length > 0 ? `${mine.length} alert${mine.length === 1 ? "" : "s"} on ${panel.title}${worst ? `, ${STATE_STYLES[worst].label}` : ""}` : `Alerts on ${panel.title}`}
        onClick={() => setOpen(true)}
      >
        <Icon className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Alerts on {panel.title}</DialogTitle>
            <DialogDescription>Each alert runs this panel on a schedule, as the person who saved it, and notifies its channels when it fires, resolves or can't be evaluated.</DialogDescription>
          </DialogHeader>
          {alerts.isError && <p role="alert" className="text-xs text-red-300">{alerts.error.message}</p>}
          {form ? (
            <AlertForm
              initial={form.alert ? { name: form.alert.name, severity: form.alert.severity, connectionId: form.alert.connectionId, channelIds: form.alert.channelIds, enabled: form.alert.enabled, config: form.alert.config } : defaults(panel, view, "1h")}
              panel={panel}
              onCancel={() => setForm(null)}
              onSubmit={(input) => save.mutate(input)}
              saving={save.isPending}
              error={save.isError ? save.error.message : null}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {mine.length === 0 && <p className="text-xs text-paper-faint">No alerts on this panel.</p>}
              {mine.map((a) => (
                <div key={a.id} className="flex flex-col gap-1 rounded-xs border border-ink-500 p-3" data-testid="alert-row">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-paper">{a.name}</span>
                    {a.status && <span className={cn("font-mono text-[10px] uppercase tracking-[0.12em]", STATE_STYLES[a.status.state].className)}>{a.enabled ? STATE_STYLES[a.status.state].label : "Disabled"}</span>}
                    {canEdit && <Switch checked={a.enabled} onCheckedChange={() => toggle.mutate(a)} aria-label={`${a.name} enabled`} />}
                    {canEdit && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Check ${a.name} now`} onClick={() => void check(a.id)}><Play className="h-3.5 w-3.5" /></Button>}
                    {canEdit && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${a.name}`} onClick={() => setForm({ alert: a })}><Pencil className="h-3.5 w-3.5" /></Button>}
                    {canDelete && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Delete ${a.name}`} onClick={() => remove.mutate(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </div>
                  <span className="font-mono text-[10px] text-paper-dim">
                    {a.config.reduce} of {a.config.column} over {a.config.range} {a.config.op} {formatValue(a.config.value, panel.viz.unit, panel.viz.decimals)} · every {a.config.everyMinutes} min · {a.severity}
                  </span>
                  {a.status?.lastValue !== null && a.status?.lastValue !== undefined && <span className="text-[11px] text-paper-muted">Last value {formatValue(a.status.lastValue, panel.viz.unit, panel.viz.decimals)}{a.status.lastEvalAt ? ` at ${new Date(a.status.lastEvalAt).toLocaleString()}` : ""}</span>}
                  {a.status?.lastError && <span role="alert" className="text-[11px] text-red-300">{a.status.lastError}</span>}
                  {checks[a.id] && <span className="text-[11px] text-paper-muted">{checks[a.id]}</span>}
                </div>
              ))}
            </div>
          )}
          {!form && (
            <DialogFooter>
              {canEdit && <Button size="sm" onClick={() => setForm({ alert: null })} disabled={view.connectionId === null}><Plus className="mr-1.5 h-3.5 w-3.5" /> New alert</Button>}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
