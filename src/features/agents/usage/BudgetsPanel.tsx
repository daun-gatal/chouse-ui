/**
 * AI activity › Budgets (ADR 0024, D5): token and cost caps per feature and
 * per user. A run checks them before it starts; a used-up budget stops the
 * run or switches it to a fallback model.
 */

import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Save, Trash2, Wallet } from "lucide-react";

import { fetchAiCapabilities, fetchAiModels } from "@/api/ai";
import type { AiBudgetInput, AiBudgetStatus, BudgetScope } from "@/api/aiUsage";
import { rbacUsersApi } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { formatAgo } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, LoadingGrid, Panel, StatusPill } from "@/features/observe/ui";
import { errorMessage, Field, INPUT_CLASS, SWITCH_CLASS } from "@/features/agents/assistant/shared";
import { useAiBudgets, useDeleteAiBudget, useSaveAiBudget } from "./hooks";
import { budgetFormProblems, budgetLimitLabel, budgetScopeLabel, budgetUsedShare, featureLabel, formatTokens, formatUsd } from "./lib";

const ALL_FEATURES = "__all__";
const NO_MODEL = "__none__";

const BLANK: AiBudgetInput = {
  name: "",
  featureId: "chat",
  appliesTo: "each_user",
  userId: null,
  period: "day",
  limitTokens: 200_000,
  limitCostUsd: null,
  onExhaust: "stop",
  fallbackModelConfigId: null,
  enabled: true,
};

const SCOPE_LABEL: Record<BudgetScope, string> = {
  all: "Everyone together",
  each_user: "Each user",
  user: "One user",
};

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function BudgetEditor({ budget, onClose }: { budget: AiBudgetStatus | null; onClose: () => void }): ReactElement {
  const [draft, setDraft] = useState<AiBudgetInput>(() => (budget ? {
    name: budget.name, featureId: budget.featureId, appliesTo: budget.appliesTo, userId: budget.userId, period: budget.period,
    limitTokens: budget.limitTokens, limitCostUsd: budget.limitCostUsd, onExhaust: budget.onExhaust,
    fallbackModelConfigId: budget.fallbackModelConfigId, enabled: budget.enabled,
  } : BLANK));
  const [showProblems, setShowProblems] = useState(false);
  const save = useSaveAiBudget();
  const remove = useDeleteAiBudget();
  const features = useQuery({ queryKey: ["ai-capabilities"], queryFn: fetchAiCapabilities, staleTime: 300_000 });
  const models = useQuery({ queryKey: ["ai-models"], queryFn: fetchAiModels, staleTime: 60_000 });
  const users = useQuery({ queryKey: ["rbac-users", "budget-picker"], queryFn: () => rbacUsersApi.list({ limit: 200 }), enabled: draft.appliesTo === "user", staleTime: 60_000 });
  const featureIds = useMemo(() => ["chat", ...(features.data ?? []).map((f) => f.id).filter((id) => id !== "chat")], [features.data]);
  const problems = budgetFormProblems(draft);
  const set = <K extends keyof AiBudgetInput>(key: K, value: AiBudgetInput[K]): void => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (): Promise<void> => {
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    try {
      await save.mutateAsync({ id: budget?.id ?? null, input: { ...draft, name: draft.name.trim(), userId: draft.appliesTo === "user" ? draft.userId : null } });
      toast.success(budget ? "Budget saved" : "Budget added");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "The budget couldn't be saved"));
    }
  };

  const destroy = async (): Promise<void> => {
    if (!budget) return;
    try {
      await remove.mutateAsync(budget.id);
      toast.success("Budget deleted");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "The budget couldn't be deleted"));
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{budget ? budget.name : "New budget"}</SheetTitle>
          <SheetDescription>Checked before each AI request starts. Spend is counted from the requests in AI activity.</SheetDescription>
        </SheetHeader>
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Name" htmlFor="budget-name">
            <Input id="budget-name" className={INPUT_CLASS} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Chat, per user, per day" autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Caps" hint="One AI feature, or all of them together">
              <Select value={draft.featureId ?? ALL_FEATURES} onValueChange={(v) => set("featureId", v === ALL_FEATURES ? null : v)}>
                <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Feature"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FEATURES}>All AI features</SelectItem>
                  {featureIds.map((id) => <SelectItem key={id} value={id}>{featureLabel(id)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Applies to">
              <Select value={draft.appliesTo} onValueChange={(v) => set("appliesTo", v === "all" || v === "user" ? v : "each_user")}>
                <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Applies to"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(SCOPE_LABEL) as BudgetScope[]).map((s) => <SelectItem key={s} value={s}>{SCOPE_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          {draft.appliesTo === "user" && (
            <Field label="User">
              <Select value={draft.userId ?? ""} onValueChange={(v) => set("userId", v)}>
                <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="User"><SelectValue placeholder={users.isLoading ? "Loading users…" : "Pick a user"} /></SelectTrigger>
                <SelectContent>{(users.data?.users ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.displayName ?? u.username} <span className="text-paper-faint">{u.email}</span></SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Period" hint="Resets at 00:00 UTC">
              <Select value={draft.period} onValueChange={(v) => set("period", v === "month" ? "month" : "day")}>
                <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Period"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="day">Per day</SelectItem><SelectItem value="month">Per month</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Token limit" hint="Input + output">
              <Input type="number" min={1} className={INPUT_CLASS} value={draft.limitTokens ?? ""} onChange={(e) => set("limitTokens", numberOrNull(e.target.value))} placeholder="no token limit" aria-label="Token limit" />
            </Field>
            <Field label="Cost limit, USD" hint="Priced models only">
              <Input type="number" min={0.01} step={0.01} className={INPUT_CLASS} value={draft.limitCostUsd ?? ""} onChange={(e) => set("limitCostUsd", numberOrNull(e.target.value))} placeholder="no cost limit" aria-label="Cost limit" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="When it runs out">
              <Select value={draft.onExhaust} onValueChange={(v) => set("onExhaust", v === "fallback" ? "fallback" : "stop")}>
                <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="When it runs out"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stop">Stop AI requests</SelectItem>
                  <SelectItem value="fallback">Switch to a cheaper model</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {draft.onExhaust === "fallback" && (
              <Field label="Switch to">
                <Select value={draft.fallbackModelConfigId ?? NO_MODEL} onValueChange={(v) => set("fallbackModelConfigId", v === NO_MODEL ? null : v)}>
                  <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Fallback model"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_MODEL}>Pick a model</SelectItem>
                    {(models.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-paper">
            <Switch className={SWITCH_CLASS} checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Budget enabled" />
            Enabled
          </label>
          {showProblems && problems.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xs border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-500">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-500 pt-4">
            {budget ? (
              <Button type="button" variant="ghost" className="h-9 rounded-xs text-[11px] text-red-400 hover:text-red-300" onClick={() => void destroy()} disabled={remove.isPending}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-9 rounded-xs text-[11px]" onClick={onClose}>Cancel</Button>
              <Button type="submit" className={DH_PRIMARY} disabled={save.isPending}><Save className="h-3.5 w-3.5" /> {budget ? "Save" : "Add budget"}</Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function UsageBar({ share }: { share: number }): ReactElement {
  const pct = Math.min(100, Math.round(share * 100));
  const tone = share >= 1 ? "bg-red-400" : share >= 0.8 ? "bg-amber-500" : "bg-brand";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-ink-300" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-[11px] text-paper-muted">{pct}%</span>
    </div>
  );
}

export function BudgetsPanel(): ReactElement | null {
  const budgets = useAiBudgets();
  const [editing, setEditing] = useState<AiBudgetStatus | "new" | null>(null);

  // Users who may neither see everyone's usage nor manage budgets get a 403: show nothing.
  if (budgets.isError && budgets.error && "statusCode" in budgets.error && budgets.error.statusCode === 403) return null;
  const canManage = budgets.data?.canManage ?? false;
  const rows = budgets.data?.budgets ?? [];

  return (
    <Panel
      title="Budgets"
      meta="Token and cost caps, checked before each AI request"
      actions={canManage ? <Button className={DH_PRIMARY} onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> Add budget</Button> : undefined}
    >
      {budgets.isLoading ? <LoadingGrid count={1} /> : budgets.isError || !budgets.data ? (
        <ErrorState title="Budgets could not be loaded." error={budgets.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No budgets yet" body={canManage ? "Add one to cap what the chat, an AI feature or each user can spend in a day or a month." : "Admins can cap what AI spends per day or month."} />
      ) : (
        <DataTable label="AI budgets" head={["Budget", "Limit", "Used this period", "When used up", "Resets", ""]}>
          {rows.map((b) => {
            const share = budgetUsedShare(b);
            return (
              <tr key={b.id} className={b.enabled ? undefined : "opacity-60"}>
                <td>
                  <span className="block text-[12px] text-paper">{b.name}</span>
                  <span className="block text-[10px] text-paper-faint">{budgetScopeLabel(b)}</span>
                </td>
                <td className="whitespace-nowrap text-[12px] text-paper-muted">{budgetLimitLabel(b)}</td>
                <td>
                  <UsageBar share={share} />
                  <span className="block text-[10px] text-paper-faint">
                    {formatTokens(b.spend.tokens)} tokens · {formatUsd(b.spend.costUsd)}{b.appliesTo === "each_user" ? " (top user)" : ""}
                    {b.exhaustedUsers > 0 && ` · ${b.exhaustedUsers} user${b.exhaustedUsers === 1 ? "" : "s"} at the cap`}
                  </span>
                </td>
                <td>
                  {!b.enabled ? <StatusPill tone="muted" dot={false}>Off</StatusPill>
                    : b.onExhaust === "stop" ? <StatusPill tone={b.exhausted ? "bad" : "muted"} dot={b.exhausted}>Stop</StatusPill>
                    : <StatusPill tone={b.exhausted ? "warn" : "muted"} dot={b.exhausted}>Cheaper model</StatusPill>}
                </td>
                <td className="whitespace-nowrap text-[11px] text-paper-muted" title={new Date(b.resetsAt).toLocaleString()}>{formatAgo(b.resetsAt)}</td>
                <td className="text-right">
                  {canManage && (
                    <Button variant="ghost" className="h-7 rounded-xs px-2" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
      {editing && <BudgetEditor budget={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}
