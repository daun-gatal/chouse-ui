/**
 * Rules (ADR 0026 §7): everything that sends alerts in one list — fleet rules
 * (created and edited here, as before), and dashboard alerts, Data Health
 * promises, scheduled queries, auto-triage and remediation approvals, each
 * linking to where it is managed. Each list comes from its own feature's API,
 * so a viewer only sees what they can already see there.
 */

import React, { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteRule, getRemediationChannels, listChannels, listRules, saveRemediationChannels, type AlertRule } from "@/api/alerting";
import { listAllAlerts } from "@/api/dashboards";
import { listDataHealthPromises } from "@/api/dataHealth";
import { listScheduledQueries } from "@/api/scheduledQueries";
import { getTriageRules } from "@/api/aiTriage";
import { ALERTING_KEYS, DIALOG_SAVE_BTN } from "@/features/alerting/ChannelDialog";
import { RuleDialog } from "@/features/alerting/RuleDialog";
import { filterSources, SOURCE_KINDS, SOURCE_LABELS, toSourceRows, type SourceRow, type SourceState } from "./sources";
import { ClearFilters, ADD_BTN, BADGE, clampPage, EmptyFiltered, errMessage, FilterSelect, META, PAGE_SIZE, Pager, Panel, ROW, SearchBox, useUrlFilters } from "./shared";

const KEYS = ["q", "kind", "state", "severity", "channel"] as const;
const STATES = ["firing", "ok", "disabled", "error", "pending", "nochannel"] as const;

const STATE_BADGE: Record<SourceState, { label: string; className: string }> = {
  firing: { label: "Firing", className: "border-red-900/60 text-red-300" },
  error: { label: "Error", className: "border-amber-900/60 text-amber-400" },
  pending: { label: "Pending", className: "border-ink-500 text-paper-muted" },
  ok: { label: "OK", className: "border-emerald-900/60 text-emerald-400" },
  disabled: { label: "Off", className: "border-ink-500 text-paper-faint" },
};

export function RulesTab({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }): React.ReactElement {
  const queryClient = useQueryClient();
  const filters = useUrlFilters(KEYS, { kind: SOURCE_KINDS, state: STATES, severity: ["info", "warning", "critical"] });
  const { values } = filters;
  const [dialog, setDialog] = useState<{ open: boolean; rule: AlertRule | null }>({ open: false, rule: null });
  const [deleting, setDeleting] = useState<AlertRule | null>(null);
  const [remediationOpen, setRemediationOpen] = useState(false);

  const opt = { retry: false } as const;
  const rules = useQuery({ queryKey: ALERTING_KEYS.rules, queryFn: listRules });
  const channels = useQuery({ queryKey: ALERTING_KEYS.channels, queryFn: listChannels });
  const panelAlerts = useQuery({ queryKey: ["dashboards", "alerts", "all"], queryFn: listAllAlerts, ...opt });
  const promises = useQuery({ queryKey: ["alerting", "sources", "promises"], queryFn: () => listDataHealthPromises(), ...opt });
  const jobs = useQuery({ queryKey: ["alerting", "sources", "jobs"], queryFn: () => listScheduledQueries(), ...opt });
  const triage = useQuery({ queryKey: ["alerting", "sources", "triage"], queryFn: getTriageRules, ...opt });
  const remediation = useQuery({ queryKey: ["alerting", "settings", "remediation"], queryFn: getRemediationChannels, ...opt });

  const rows = useMemo(() => toSourceRows({
    rules: rules.data,
    panelAlerts: panelAlerts.data,
    promises: promises.data,
    jobs: jobs.data,
    triage: triage.data?.rules,
    remediation: remediation.data,
  }), [rules.data, panelAlerts.data, promises.data, jobs.data, triage.data, remediation.data]);
  const filtered = useMemo(() => filterSources(rows, { q: values.q, kind: values.kind as SourceRow["kind"] | "", state: values.state as SourceState | "nochannel" | "", severity: values.severity, channelId: values.channel }), [rows, values]);
  const page = clampPage(filters.page, filtered.length);
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const channelName = useMemo(() => new Map((channels.data ?? []).map((c) => [c.id, c.name])), [channels.data]);
  const hidden = [panelAlerts.isError && "dashboard alerts", promises.isError && "Data Health", jobs.isError && "scheduled queries", triage.isError && "auto-triage"].filter(Boolean);

  const remove = useMutation({
    mutationFn: (id: string) => deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.rules });
      toast.success("Rule deleted");
      setDeleting(null);
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const loading = rules.isLoading || panelAlerts.isLoading || promises.isLoading || jobs.isLoading || triage.isLoading;

  return (
    <Panel
      title="Everything that sends alerts"
      action={canEdit && (
        <Button size="sm" className={ADD_BTN} onClick={() => setDialog({ open: true, rule: null })}>
          <Plus className="h-3.5 w-3.5" /> Fleet rule
        </Button>
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox value={values.q} onChange={(v) => filters.set("q", v)} placeholder="Search name or dashboard" />
        <FilterSelect label="Source" value={values.kind} onChange={(v) => filters.set("kind", v)} options={SOURCE_KINDS.map((k) => ({ value: k, label: SOURCE_LABELS[k] }))} />
        <FilterSelect label="State" value={values.state} onChange={(v) => filters.set("state", v)} options={[{ value: "firing", label: "Firing" }, { value: "error", label: "Error" }, { value: "ok", label: "OK" }, { value: "disabled", label: "Off" }, { value: "pending", label: "Pending" }, { value: "nochannel", label: "No channel" }]} />
        <FilterSelect label="Severity" value={values.severity} onChange={(v) => filters.set("severity", v)} options={[{ value: "critical", label: "Critical" }, { value: "warning", label: "Warning" }, { value: "info", label: "Info" }]} />
        <FilterSelect label="Channel" value={values.channel} onChange={(v) => filters.set("channel", v)} options={(channels.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <ClearFilters active={filters.active} onClear={filters.clear} />
      </div>
      {hidden.length > 0 && <p className="mb-2 text-[11px] text-paper-faint">Not shown, for lack of permission: {hidden.join(", ")}.</p>}

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-paper-dim" /></div>
      ) : filtered.length === 0 ? (
        <EmptyFiltered message={filters.active ? "Nothing matches these filters" : "Nothing sends alerts yet"} />
      ) : (
        <ul className="space-y-2">
          {shown.map((row) => (
            <li key={row.key} className={ROW} data-testid="source-row">
              <span className={cn(BADGE, STATE_BADGE[row.state].className)}>{STATE_BADGE[row.state].label}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-paper">{row.name}</div>
                <div className={META}>
                  {SOURCE_LABELS[row.kind]}{row.where ? ` · ${row.where}` : ""}{row.severity ? ` · ${row.severity}` : ""} · {row.channelIds.length === 0 ? "no channel" : row.channelIds.map((id) => channelName.get(id) ?? "deleted channel").join(", ")}
                </div>
              </div>
              {row.kind === "fleet" && row.rule && (canEdit || canDelete) ? (
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" aria-label={`Edit ${row.name}`} onClick={() => setDialog({ open: true, rule: row.rule ?? null })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300 disabled:text-paper-faint" title={row.rule.enabled ? "Enabled — disable first" : "Delete"} disabled={row.rule.enabled} aria-label={`Delete ${row.name}`} onClick={() => setDeleting(row.rule ?? null)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ) : row.kind === "remediation" ? (
                canEdit && <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setRemediationOpen(true)}>Change channels</Button>
              ) : row.link ? (
                <Link to={row.link} className="inline-flex items-center gap-1 text-[12px] text-paper-muted hover:text-paper">
                  Open <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={filtered.length} onPage={filters.setPage} />

      <RuleDialog open={dialog.open} rule={dialog.rule} onClose={() => setDialog({ open: false, rule: null })} />
      {remediation.data && <RemediationChannelsDialog open={remediationOpen} current={remediation.data.channelIds} envSlack={remediation.data.envSlack} onClose={() => setRemediationOpen(false)} />}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rule?</AlertDialogTitle>
            <AlertDialogDescription>“{deleting?.name}” will stop evaluating and its channel links are removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)} className="bg-red-600 hover:bg-red-500">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function RemediationChannelsDialog({ open, current, envSlack, onClose }: { open: boolean; current: string[]; envSlack: boolean; onClose: () => void }): React.ReactElement {
  const queryClient = useQueryClient();
  const channels = useQuery({ queryKey: ALERTING_KEYS.channels, queryFn: listChannels });
  const [picked, setPicked] = useState<string[]>(current);
  React.useEffect(() => {
    if (open) setPicked(current);
  }, [open, current]);
  const save = useMutation({
    mutationFn: () => saveRemediationChannels(picked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerting", "settings", "remediation"] });
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.channels });
      toast.success("Remediation channels saved");
      onClose();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <DialogTitle className="text-paper">Remediation approvals</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-paper-muted">Proposed fixes are posted here, with Approve and Reject on channels that carry buttons.{envSlack ? " The Slack bot set by environment variables keeps posting too." : ""}</p>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {(channels.data ?? []).map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-[13px] text-paper">
                <Checkbox checked={picked.includes(c.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, c.id] : p.filter((id) => id !== c.id)))} aria-label={c.name} />
                {c.name}
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className={DIALOG_SAVE_BTN} disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
