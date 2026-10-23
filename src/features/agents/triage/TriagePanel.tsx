/**
 * AI Governance › Auto-triage (ADR 0024 §Phase 4): which events an AI agent
 * investigates on its own, within what limits, and what it found. The agent
 * only proposes actions; people approve them in Approvals.
 */

import { useState, type ReactElement } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ArrowUpRight, Pencil, Radar, Save } from "lucide-react";

import { TRIAGE_TRIGGERS, type TriageRule, type TriageRuleInput, type TriageRun, type TriageTrigger } from "@/api/aiTriage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { errorMessage, Field, INPUT_CLASS, SWITCH_CLASS } from "@/features/agents/assistant/shared";
import { formatTokens } from "@/features/agents/usage/lib";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { formatAgo } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, LoadingGrid, Panel, StatusPill } from "@/features/observe/ui";
import { RUNS_PAGE, useSaveTriageRule, useTriageRules, useTriageRuns } from "./hooks";
import { budgetShare, cooldownLabel, LEVEL_TONE, ruleProblems, RUN_STATUS_LABEL, RUN_STATUS_TONE, subjectLink, TRIGGER_HINT, TRIGGER_LABEL } from "./lib";

const DEFAULT_AGENT = "__default__";

function inputOf(rule: TriageRule): TriageRuleInput {
  return { enabled: rule.enabled, agentId: rule.agentId, cooldownMinutes: rule.cooldownMinutes, dailyTokenBudget: rule.dailyTokenBudget, channelIds: rule.channelIds };
}

function UsageBar({ share, label }: { share: number; label: string }): ReactElement {
  const pct = Math.round(share * 100);
  const tone = share >= 1 ? "bg-red-400" : share >= 0.8 ? "bg-amber-500" : "bg-brand";
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-300" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function RuleEditor({ rule, onClose }: { rule: TriageRule; onClose: () => void }): ReactElement {
  const rules = useTriageRules();
  const save = useSaveTriageRule();
  const [draft, setDraft] = useState<TriageRuleInput>(() => inputOf(rule));
  const [showProblems, setShowProblems] = useState(false);
  const problems = ruleProblems(draft);
  const channels = rules.data?.channels ?? [];
  const agents = rules.data?.agents ?? [];
  const defaultAgent = agents.find((a) => a.id === rules.data?.defaultAgentId)?.name ?? "Incident Triager";
  const set = <K extends keyof TriageRuleInput>(key: K, value: TriageRuleInput[K]): void => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (): Promise<void> => {
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    try {
      await save.mutateAsync({ trigger: rule.trigger, input: draft });
      toast.success(draft.enabled ? `Auto-triage is on for ${TRIGGER_LABEL[rule.trigger].toLowerCase()}` : "Saved");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the rule"));
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{TRIGGER_LABEL[rule.trigger]}</SheetTitle>
          <SheetDescription>{TRIGGER_HINT[rule.trigger]}</SheetDescription>
        </SheetHeader>
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="flex items-start gap-2">
            <Switch className={`${SWITCH_CLASS} mt-0.5`} checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Investigate automatically" />
            <span>
              <span className="block text-[12px] text-paper">Investigate automatically</span>
              <span className="block text-[11px] text-paper-faint">From the moment it is turned on; nothing that happened before is investigated.</span>
            </span>
          </label>
          <Field label="Agent" hint="Investigates with read-only system queries; it can only propose actions.">
            <Select value={draft.agentId ?? DEFAULT_AGENT} onValueChange={(v) => set("agentId", v === DEFAULT_AGENT ? null : v)}>
              <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Agent"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_AGENT}>Default ({defaultAgent})</SelectItem>
                {agents.filter((a) => a.id !== rules.data?.defaultAgentId).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cooldown, minutes" hint={cooldownLabel(draft.cooldownMinutes)}>
              <Input type="number" min={0} max={1440} className={INPUT_CLASS} value={draft.cooldownMinutes} onChange={(e) => set("cooldownMinutes", Number(e.target.value))} aria-label="Cooldown minutes" />
            </Field>
            <Field label="Daily token budget" hint="Resets at 00:00 UTC; past it, events are skipped">
              <Input type="number" min={1000} step={1000} className={INPUT_CLASS} value={draft.dailyTokenBudget} onChange={(e) => set("dailyTokenBudget", Number(e.target.value))} aria-label="Daily token budget" />
            </Field>
          </div>
          <Field label="Notify" hint={channels.length === 0 ? "No alerting channels yet: add them in Admin › Settings › Alerting." : "A short notice with the likely cause goes to these channels."}>
            <div className="space-y-1.5">
              {channels.map((ch) => (
                <label key={ch.id} className="flex items-center gap-2 text-[12px] text-paper">
                  <Checkbox
                    checked={draft.channelIds.includes(ch.id)}
                    onCheckedChange={(v) => set("channelIds", v === true ? [...draft.channelIds, ch.id] : draft.channelIds.filter((id) => id !== ch.id))}
                    aria-label={ch.name}
                  />
                  {ch.name} <span className="font-mono text-[10px] text-paper-faint">{ch.type}{ch.enabled ? "" : " · off"}</span>
                </label>
              ))}
            </div>
          </Field>
          {showProblems && problems.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xs border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-500">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <p className="text-[11px] text-paper-faint">Actions it proposes are recorded for you and wait in AI Governance › Approvals.</p>
          <div className="flex justify-end gap-2 border-t border-ink-500 pt-4">
            <Button type="button" variant="outline" className="h-9 rounded-xs text-[11px]" onClick={onClose}>Cancel</Button>
            <Button type="button" className={DH_PRIMARY} disabled={save.isPending} onClick={() => void submit()}><Save className="h-3.5 w-3.5" /> Save</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function RulesPanel(): ReactElement {
  const rules = useTriageRules();
  const save = useSaveTriageRule();
  const [editing, setEditing] = useState<TriageRule | null>(null);
  const canManage = rules.data?.canManage ?? false;
  const channelNames = new Map((rules.data?.channels ?? []).map((ch) => [ch.id, ch.name]));
  const agentNames = new Map((rules.data?.agents ?? []).map((a) => [a.id, a.name]));

  const toggle = async (rule: TriageRule, enabled: boolean): Promise<void> => {
    try {
      await save.mutateAsync({ trigger: rule.trigger, input: { ...inputOf(rule), enabled } });
      toast.success(enabled ? `On: new ${TRIGGER_LABEL[rule.trigger].toLowerCase()} are investigated from now on` : `Off for ${TRIGGER_LABEL[rule.trigger].toLowerCase()}`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not change the rule"));
    }
  };

  return (
    <Panel title="Auto-triage" meta="When something goes wrong, an AI agent investigates before anyone asks. It only proposes actions; people approve them.">
      {rules.isLoading ? <LoadingGrid count={1} /> : rules.isError || !rules.data ? (
        <ErrorState title="Auto-triage rules could not be loaded." error={rules.error} />
      ) : (
        <DataTable label="Auto-triage rules" head={["When", "On", "Agent", "How often", "Tokens today", "Notify", ""]}>
          {TRIAGE_TRIGGERS.map((trigger) => {
            const rule = rules.data.rules.find((r) => r.trigger === trigger);
            if (!rule) return null;
            const share = budgetShare(rule.tokensToday, rule.dailyTokenBudget);
            return (
              <tr key={trigger} className={rule.enabled ? undefined : "opacity-70"}>
                <td>
                  <span className="block text-[12px] text-paper">{TRIGGER_LABEL[trigger]}</span>
                  <span className="block text-[10px] text-paper-faint">{TRIGGER_HINT[trigger]}</span>
                </td>
                <td>
                  <Switch className={SWITCH_CLASS} checked={rule.enabled} disabled={!canManage || save.isPending} onCheckedChange={(v) => void toggle(rule, v)} aria-label={`Auto-triage ${TRIGGER_LABEL[trigger]}`} />
                </td>
                <td className="whitespace-nowrap text-[11px] text-paper-muted">{rule.agentId ? agentNames.get(rule.agentId) ?? "Missing agent" : "Default"}</td>
                <td className="whitespace-nowrap text-[11px] text-paper-muted">{cooldownLabel(rule.cooldownMinutes)}</td>
                <td>
                  <UsageBar share={share} label={`${TRIGGER_LABEL[trigger]} budget used`} />
                  <span className="mt-0.5 block text-[10px] text-paper-faint">{formatTokens(rule.tokensToday)} of {formatTokens(rule.dailyTokenBudget)}</span>
                </td>
                <td className="max-w-[180px] truncate text-[11px] text-paper-muted" title={rule.channelIds.map((id) => channelNames.get(id) ?? id).join(", ")}>
                  {rule.channelIds.length === 0 ? "—" : rule.channelIds.map((id) => channelNames.get(id) ?? "Deleted channel").join(", ")}
                </td>
                <td className="text-right">
                  {canManage && (
                    <Button variant="ghost" className="h-7 rounded-xs px-2" onClick={() => setEditing(rule)} aria-label={`Edit ${TRIGGER_LABEL[trigger]}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
      {editing && <RuleEditor key={editing.trigger} rule={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function RunSheet({ run, onClose }: { run: TriageRun; onClose: () => void }): ReactElement {
  const result = run.result;
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{run.subjectTitle || "Investigation"}</SheetTitle>
          <SheetDescription>{TRIGGER_LABEL[run.trigger]} · {formatAgo(run.startedAt)}{run.tokens > 0 ? ` · ${formatTokens(run.tokens)} tokens` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</StatusPill>
            {result && <StatusPill tone={LEVEL_TONE[result.severity]} dot={false}>{result.severity} severity</StatusPill>}
            {result && <StatusPill tone="muted" dot={false}>{result.confidence} confidence</StatusPill>}
          </div>
          {run.reason && <p className="text-[12px] text-paper-muted">{run.reason}</p>}
          {run.error && <p className="rounded-xs border border-red-500/30 bg-red-500/5 p-2 text-[12px] text-red-400">{run.error}</p>}
          {result && (
            <>
              <p className="text-[13px] text-paper">{result.summary}</p>
              <Field label="Likely cause"><p className="text-[12px] text-paper">{result.likelyCause}</p></Field>
              {result.findings.length > 0 && (
                <Field label="What it checked">
                  <ul className="list-disc space-y-1 pl-4 text-[12px] text-paper-muted">{result.findings.map((f) => <li key={f}>{f}</li>)}</ul>
                </Field>
              )}
              {result.nextSteps.length > 0 && (
                <Field label="Next steps">
                  <ol className="list-decimal space-y-1 pl-4 text-[12px] text-paper-muted">{result.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol>
                </Field>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2 border-t border-ink-500 pt-4">
            <Button asChild variant="outline" className="h-8 rounded-xs text-[11px]">
              <Link to={subjectLink(run.trigger, run.subjectId)}>Open {run.notebookId ? "the investigation" : "it"} <ArrowUpRight className="ml-1 h-3 w-3" /></Link>
            </Button>
            {run.actionIds.length > 0 && (
              <Button asChild className={`${DH_PRIMARY} h-8`}>
                <Link to="/ai/approvals">{run.actionIds.length} proposed action{run.actionIds.length === 1 ? "" : "s"} <ArrowUpRight className="h-3 w-3" /></Link>
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type RunFilter = TriageTrigger | "all";

function RunsPanel(): ReactElement {
  const [filter, setFilter] = useState<RunFilter>("all");
  const [offset, setOffset] = useState(0);
  const runs = useTriageRuns(filter === "all" ? null : filter, offset);
  const [open, setOpen] = useState<TriageRun | null>(null);
  const rows = runs.data?.runs ?? [];
  const total = runs.data?.total ?? 0;

  return (
    <Panel
      title="Investigations"
      meta={total > 0 ? `${total} in the last 90 days` : undefined}
      actions={
        <Select value={filter} onValueChange={(v) => { setFilter(v === "all" ? "all" : TRIAGE_TRIGGERS.find((t) => t === v) ?? "all"); setOffset(0); }}>
          <SelectTrigger className="h-8 w-52 rounded-xs text-[11px]" aria-label="Trigger"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every trigger</SelectItem>
            {TRIAGE_TRIGGERS.map((t) => <SelectItem key={t} value={t}>{TRIGGER_LABEL[t]}</SelectItem>)}
          </SelectContent>
        </Select>
      }
    >
      {runs.isLoading ? <LoadingGrid count={1} /> : runs.isError || !runs.data ? (
        <ErrorState title="Investigations could not be loaded." error={runs.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Radar} title="No investigations yet" body="Turn a trigger on above; the next incident, alert or failure it covers is investigated within a minute." />
      ) : (
        <>
          <DataTable label="Investigations" head={["What happened", "Status", "Finding", "Actions", "When"]}>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-ink-200/50" onClick={() => setOpen(r)}>
                <td className="max-w-[280px]">
                  <button type="button" className="block max-w-full truncate text-left text-[12px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); setOpen(r); }} title={r.subjectTitle}>{r.subjectTitle || r.subjectId}</button>
                  <span className="block text-[10px] text-paper-faint">{TRIGGER_LABEL[r.trigger]}</span>
                </td>
                <td>
                  <StatusPill tone={RUN_STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</StatusPill>
                  {r.result && <span className="mt-0.5 block text-[10px] text-paper-faint">{r.result.severity} severity</span>}
                </td>
                <td className="max-w-[360px]">
                  <span className="line-clamp-2 text-[11px] text-paper-muted">{r.summary ?? r.reason ?? r.error ?? "—"}</span>
                </td>
                <td className="whitespace-nowrap text-[11px] text-paper-muted">{r.actionIds.length > 0 ? `${r.actionIds.length} proposed` : "—"}</td>
                <td className="whitespace-nowrap text-[11px] text-paper-muted" title={new Date(r.startedAt).toLocaleString()}>{formatAgo(r.startedAt)}</td>
              </tr>
            ))}
          </DataTable>
          {total > RUNS_PAGE && (
            <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-paper-muted">
              <span>{offset + 1}–{Math.min(offset + RUNS_PAGE, total)} of {total}</span>
              <Button variant="outline" className="h-7 rounded-xs text-[11px]" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - RUNS_PAGE))}>Newer</Button>
              <Button variant="outline" className="h-7 rounded-xs text-[11px]" disabled={offset + RUNS_PAGE >= total} onClick={() => setOffset(offset + RUNS_PAGE)}>Older</Button>
            </div>
          )}
        </>
      )}
      {open && <RunSheet run={open} onClose={() => setOpen(null)} />}
    </Panel>
  );
}

export function TriagePanel(): ReactElement {
  return (
    <div className="space-y-4">
      <RulesPanel />
      <RunsPanel />
    </div>
  );
}
