/**
 * AI Governance › Policies (ADR 0016 §10): budget policies, each applied to
 * every agent, any number of roles, and any number of tokens. Created and
 * edited in a two-step wizard: the limits first, then who they apply to.
 */

import { useMemo, useState, type MouseEvent, type ReactElement } from "react";
import { toast } from "sonner";
import { Check, KeyRound, Plus, Search, Shield, Trash2, Users } from "lucide-react";

import type { AgentPolicy, AgentPolicyTarget, PolicyScopeOption } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useAgentMutations, useAgentPolicies, useAgentPolicyScopes } from "@/features/observe/hooks";
import { formatBytes } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, LoadingGrid, Panel, StatusPill } from "@/features/observe/ui";
import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { assignment, formToSettings, groupPolicies, policyToForm, targetKey, type PolicyForm, type PolicyGroup } from "./policyForm";

const KIND_LABEL: Record<AgentPolicyTarget["scopeKind"], string> = { default: "Default", role: "Role", pat: "Token" };
const DEFAULT_TARGET: AgentPolicyTarget = { scopeKind: "default", scopeId: "*" };
const STEPS = ["Limits", "Applies to"] as const;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** The row toggles on click; the checkbox handles its own click (and keyboard) without toggling twice. */
function stop(event: MouseEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

function limit(bytes: number | null): string {
  return bytes === null ? "no limit" : formatBytes(bytes);
}

function TargetChips({ members }: { members: AgentPolicy[] }): ReactElement {
  const shown = members.slice(0, 4);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((m) => (
        <span key={m.id} className="inline-flex max-w-[220px] items-center gap-1 rounded-xs border border-ink-500 bg-ink-200/40 px-1.5 py-0.5 text-[11px] text-paper" title={`${KIND_LABEL[m.scopeKind]} · ${m.scopeLabel ?? m.scopeId}`}>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-paper-faint">{KIND_LABEL[m.scopeKind]}</span>
          <span className="truncate">{m.scopeKind === "default" ? "Every agent" : m.scopeLabel ?? m.scopeId}</span>
        </span>
      ))}
      {members.length > shown.length && <span className="px-1 text-[11px] text-paper-muted">+{members.length - shown.length} more</span>}
    </div>
  );
}

interface TargetRow {
  target: AgentPolicyTarget;
  label: string;
  detail: string | null;
}

function TargetList({ title, icon: Icon, rows, selected, owners, onToggle, empty }: {
  title: string;
  icon: typeof Users;
  rows: TargetRow[];
  selected: Set<string>;
  /** Target key → the other policy that has it now. */
  owners: Map<string, string>;
  onToggle: (target: AgentPolicyTarget) => void;
  empty: string;
}): ReactElement {
  return (
    <section>
      <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint"><Icon className="h-3 w-3" /> {title}</p>
      {rows.length === 0 ? (
        <p className="px-2 py-1.5 text-[11px] text-paper-muted">{empty}</p>
      ) : (
        <ul className="max-h-48 divide-y divide-ink-500/50 overflow-y-auto rounded-xs border border-ink-500">
          {rows.map((row) => {
            const key = targetKey(row.target);
            const checked = selected.has(key);
            const elsewhere = owners.get(key);
            return (
              <li key={key}>
                <div className={cn("flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-ink-200/40", checked && "bg-brand/[0.05]")} onClick={() => onToggle(row.target)}>
                  <Checkbox checked={checked} onCheckedChange={() => onToggle(row.target)} onClick={stop} className="mt-0.5" aria-label={`${title}: ${row.label}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-paper">{row.label}</span>
                    {row.detail && <span className="block truncate text-[10px] text-paper-faint">{row.detail}</span>}
                  </span>
                  {elsewhere && <span className={cn("shrink-0 text-[10px]", checked ? "text-amber-500" : "text-paper-faint")} title={elsewhere}>{checked ? "moves here" : "has a policy"}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PolicyWizard({ group, groups, open, onOpenChange }: { group?: PolicyGroup; groups: PolicyGroup[]; open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const { assignPolicy } = useAgentMutations();
  const scopes = useAgentPolicyScopes(open);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<PolicyForm>(() => policyToForm(group?.settings));
  const [selected, setSelected] = useState<Set<string>>(() => new Set((group?.members ?? []).map(targetKey)));
  const [search, setSearch] = useState("");
  const [lastGroup, setLastGroup] = useState(group);
  const [lastOpen, setLastOpen] = useState(open);
  if (group !== lastGroup || open !== lastOpen) {
    setLastGroup(group);
    setLastOpen(open);
    if (open) {
      setStep(0);
      setForm(policyToForm(group?.settings));
      setSelected(new Set((group?.members ?? []).map(targetKey)));
      setSearch("");
    }
  }

  const settings = formToSettings(form);
  const owners = useMemo(() => {
    const out = new Map<string, string>();
    for (const g of groups) {
      if (g.key === group?.key) continue;
      for (const m of g.members) out.set(targetKey(m), `Has another policy (${g.settings.dailyBytes === null ? "no daily budget" : `${formatBytes(g.settings.dailyBytes)} a day`}); saving moves it here`);
    }
    return out;
  }, [groups, group?.key]);

  const needle = search.trim().toLowerCase();
  const matches = (o: PolicyScopeOption): boolean => !needle || `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(needle);
  const roleRows: TargetRow[] = (scopes.data?.roles ?? []).filter(matches).map((o) => ({ target: { scopeKind: "role", scopeId: o.id }, label: o.label, detail: o.detail }));
  const tokenRows: TargetRow[] = (scopes.data?.tokens ?? []).filter(matches).map((o) => ({ target: { scopeKind: "pat", scopeId: o.id }, label: o.label, detail: o.detail }));
  // Targets of this policy whose role or token is gone stay listed so they can be removed on purpose.
  const known = new Set([...(scopes.data?.roles ?? []).map((o) => `role:${o.id}`), ...(scopes.data?.tokens ?? []).map((o) => `pat:${o.id}`)]);
  const missingRows: TargetRow[] = scopes.data ? (group?.members ?? []).filter((m) => m.scopeKind !== "default" && !known.has(targetKey(m))).map((m) => ({ target: { scopeKind: m.scopeKind, scopeId: m.scopeId }, label: m.scopeLabel ?? m.scopeId, detail: m.scopeKind === "role" ? "Role no longer exists" : "Token revoked or deleted" })) : [];

  const toggle = (target: AgentPolicyTarget): void => {
    const key = targetKey(target);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const targets: AgentPolicyTarget[] = [...selected].map((key) => {
    const colon = key.indexOf(":");
    const kind = key.slice(0, colon);
    return { scopeKind: kind === "role" || kind === "pat" ? kind : "default", scopeId: key.slice(colon + 1) };
  });
  const plan = assignment(group, targets);

  const submit = async (): Promise<void> => {
    if ("error" in settings || "error" in plan) return;
    try {
      await assignPolicy.mutateAsync({ settings, ...plan });
      toast.success(group ? "Policy updated" : "Policy created");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the policy"));
    }
  };

  const gibField = (key: "maxGiBPerQuery" | "dailyGiB" | "partitionFilterGiB", label: string, hint: string): ReactElement => (
    <div>
      <Label htmlFor={`policy-${key}`}>{label}</Label>
      <Input id={`policy-${key}`} type="number" min={0} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder="No limit" className="mt-1 rounded-xs" />
      <p className="mt-1 text-[10px] text-paper-faint">{hint}</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-xs border-ink-500 bg-ink-100 text-paper">
        <DialogHeader>
          <DialogTitle>{group ? "Edit agent policy" : "New agent policy"}</DialogTitle>
          <DialogDescription>Most specific wins: token, then role, then the default. Queries are estimated with EXPLAIN ESTIMATE before they run.</DialogDescription>
        </DialogHeader>
        <ol className="flex items-center gap-2" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px]", i < step ? "border-brand bg-brand text-ink-50" : i === step ? "border-brand text-brand" : "border-ink-500 text-paper-faint")}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
              <span className={cn("text-[12px]", i === step ? "text-paper" : "text-paper-muted")} aria-current={i === step ? "step" : undefined}>{label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-ink-500" />}
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {gibField("maxGiBPerQuery", "Max read per query, GiB", "Larger estimates are blocked")}
            {gibField("dailyGiB", "Daily read budget, GiB", "Across all of the agent's queries")}
            {gibField("partitionFilterGiB", "Partition filter above, GiB", "Bigger tables need a partition filter")}
            <div>
              <Label>Tables with a critical incident</Label>
              <Select value={form.incidentMode} onValueChange={(v) => setForm({ ...form, incidentMode: v === "off" || v === "block" ? v : "warn" })}>
                <SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="warn">Warn (attach a notice)</SelectItem><SelectItem value="block">Block the query</SelectItem><SelectItem value="off">Ignore</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="policy-alert">Alert at × usual usage</Label>
              <Input id="policy-alert" type="number" min={1} value={form.alertMultiplier} onChange={(e) => setForm({ ...form, alertMultiplier: e.target.value })} placeholder="Off" className="mt-1 rounded-xs" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className={cn("flex cursor-pointer items-start gap-2 rounded-xs border border-ink-500 px-2 py-2 hover:bg-ink-200/40", selected.has(targetKey(DEFAULT_TARGET)) && "bg-brand/[0.05]")} onClick={() => toggle(DEFAULT_TARGET)}>
              <Checkbox checked={selected.has(targetKey(DEFAULT_TARGET))} onCheckedChange={() => toggle(DEFAULT_TARGET)} onClick={stop} className="mt-0.5" aria-label="Every agent (default)" />
              <span className="flex-1">
                <span className="block text-[12px] text-paper">Every agent (default)</span>
                <span className="block text-[10px] text-paper-faint">Agents without a role or token policy</span>
              </span>
              {owners.get(targetKey(DEFAULT_TARGET)) && <span className="text-[10px] text-paper-faint">{selected.has(targetKey(DEFAULT_TARGET)) ? "moves here" : "has a policy"}</span>}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-faint" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search roles and tokens…" className="h-8 rounded-xs pl-8 text-[12px]" aria-label="Search roles and tokens" />
            </div>
            {scopes.isLoading ? (
              <p className="text-[11px] text-paper-muted">Loading roles and tokens…</p>
            ) : scopes.isError ? (
              <p className="text-[11px] text-amber-500">Roles and tokens could not be loaded.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <TargetList title="Roles" icon={Users} rows={roleRows} selected={selected} owners={owners} onToggle={toggle} empty={needle ? "No matching roles" : "No roles"} />
                <TargetList title="Tokens" icon={KeyRound} rows={tokenRows} selected={selected} owners={owners} onToggle={toggle} empty={needle ? "No matching tokens" : "No active tokens yet"} />
              </div>
            )}
            {missingRows.length > 0 && <TargetList title="No longer available" icon={Shield} rows={missingRows} selected={selected} owners={owners} onToggle={toggle} empty="" />}
            <p className="text-[11px] text-paper-muted">{selected.size === 0 ? "Nothing selected yet." : `Applies to ${selected.size} ${selected.size === 1 ? "target" : "targets"}.`} A role or token keeps one policy, so picking one that has a policy moves it here.</p>
          </div>
        )}

        {step === 0 && "error" in settings && <p className="text-[11px] text-amber-500">{settings.error}</p>}
        {step === 1 && "error" in plan && <p className="text-[11px] text-amber-500">{plan.error}</p>}
        <DialogFooter>
          {step === 0 ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button className={DH_PRIMARY} disabled={"error" in settings} onClick={() => setStep(1)}>Next: applies to</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
              <Button className={DH_PRIMARY} disabled={"error" in settings || "error" in plan || assignPolicy.isPending} onClick={() => void submit()}>{group ? "Save policy" : "Create policy"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PoliciesPanel(): ReactElement {
  const canManage = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AGENTS_MANAGE));
  const policies = useAgentPolicies();
  const { deletePolicy } = useAgentMutations();
  const [editing, setEditing] = useState<PolicyGroup | undefined>();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<PolicyGroup | undefined>();
  const groups = useMemo(() => groupPolicies(policies.data ?? []), [policies.data]);
  if (policies.isLoading) return <LoadingGrid count={2} />;
  if (policies.isError || !policies.data) return <ErrorState title="Policies could not be loaded." error={policies.error} />;

  const remove = async (group: PolicyGroup): Promise<void> => {
    try {
      for (const m of group.members) await deletePolicy.mutateAsync(m.id);
      toast.success("Policy deleted");
      setDeleting(undefined);
    } catch (e) {
      toast.error(errorMessage(e, "Delete failed"));
    }
  };

  return (
    <Panel title="Budget policies" meta="Write and DDL tools always need a human" actions={canManage ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="mr-1 h-3 w-3" /> New policy</Button> : undefined}>
      {groups.length === 0 ? (
        <EmptyState icon={Shield} title="No policies" body="Without a policy agents run unbudgeted; incidents still attach notices." />
      ) : (
        <DataTable label="Agent policies" head={["Applies to", "Per query", "Daily", "Partition filter", "Incidents", "Alert", ""]}>
          {groups.map((g) => (
            <tr key={g.key}>
              <td className="max-w-[320px]"><TargetChips members={g.members} /></td>
              <td className="text-paper-muted">{limit(g.settings.maxBytesPerQuery)}</td>
              <td className="text-paper-muted">{limit(g.settings.dailyBytes)}</td>
              <td className="text-paper-muted">{g.settings.partitionFilterBytes === null ? "off" : `tables > ${formatBytes(g.settings.partitionFilterBytes)}`}</td>
              <td><StatusPill tone={g.settings.incidentMode === "block" ? "bad" : g.settings.incidentMode === "warn" ? "warn" : "muted"} dot={false}>{g.settings.incidentMode}</StatusPill></td>
              <td className="text-paper-muted">{g.settings.alertMultiplier === null ? "off" : `${g.settings.alertMultiplier}×`}</td>
              <td className="text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" className="h-7 rounded-xs text-[11px]" onClick={() => { setEditing(g); setOpen(true); }}>Edit</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete policy" onClick={() => setDeleting(g)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <PolicyWizard group={editing} groups={groups} open={open} onOpenChange={setOpen} />
      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100 text-paper">
          <DialogHeader>
            <DialogTitle>Delete this policy?</DialogTitle>
            <DialogDescription>
              {deleting && `It applies to ${deleting.members.length} ${deleting.members.length === 1 ? "target" : "targets"}. They fall back to a less specific policy, or run unbudgeted.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>Cancel</Button>
            <Button variant="destructive" className="rounded-xs" disabled={deletePolicy.isPending} onClick={() => deleting && void remove(deleting)}>Delete policy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
