/**
 * Agent budget policy form ↔ API shape (ADR 0016 §10). The form edits sizes
 * in GiB; the API stores bytes. An empty field means "no limit".
 *
 * A policy applies to one or more targets (every agent, roles, tokens). The
 * server keeps one row per target, so a "policy" in the UI is the group of
 * rows that share the same limits.
 */

import type { AgentPolicy, AgentPolicyInput, AgentPolicySettings, AgentPolicyTarget } from "@/api/agents";

export interface PolicyForm {
  maxGiBPerQuery: string;
  dailyGiB: string;
  partitionFilterGiB: string;
  incidentMode: AgentPolicyInput["incidentMode"];
  alertMultiplier: string;
}

export interface PolicyGroup {
  /** Stable while the limits are unchanged. */
  key: string;
  settings: AgentPolicySettings;
  members: AgentPolicy[];
}

const GIB = 1024 ** 3;

function gib(bytes: number | null): string {
  return bytes === null ? "" : String(Math.round((bytes / GIB) * 100) / 100);
}

export function policyToForm(settings?: AgentPolicySettings): PolicyForm {
  if (!settings) {
    return { maxGiBPerQuery: "", dailyGiB: "", partitionFilterGiB: "", incidentMode: "warn", alertMultiplier: "" };
  }
  return {
    maxGiBPerQuery: gib(settings.maxBytesPerQuery),
    dailyGiB: gib(settings.dailyBytes),
    partitionFilterGiB: gib(settings.partitionFilterBytes),
    incidentMode: settings.incidentMode,
    alertMultiplier: settings.alertMultiplier === null ? "" : String(settings.alertMultiplier),
  };
}

function bytesOrNull(value: string, label: string): number | null | string {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return `${label} must be a positive number`;
  return Math.round(n * GIB);
}

/** API settings, or the first validation problem. */
export function formToSettings(form: PolicyForm): AgentPolicySettings | { error: string } {
  const maxBytesPerQuery = bytesOrNull(form.maxGiBPerQuery, "Max read per query");
  const dailyBytes = bytesOrNull(form.dailyGiB, "Daily read budget");
  const partitionFilterBytes = bytesOrNull(form.partitionFilterGiB, "Partition filter threshold");
  for (const v of [maxBytesPerQuery, dailyBytes, partitionFilterBytes]) if (typeof v === "string") return { error: v };
  let alertMultiplier: number | null = null;
  if (form.alertMultiplier.trim()) {
    const n = Number(form.alertMultiplier);
    if (!Number.isFinite(n) || n < 1 || n > 1000) return { error: "Alert multiplier must be between 1 and 1000" };
    alertMultiplier = n;
  }
  return {
    maxBytesPerQuery: typeof maxBytesPerQuery === "number" ? maxBytesPerQuery : null,
    dailyBytes: typeof dailyBytes === "number" ? dailyBytes : null,
    partitionFilterBytes: typeof partitionFilterBytes === "number" ? partitionFilterBytes : null,
    incidentMode: form.incidentMode,
    alertMultiplier,
  };
}

export function targetKey(target: AgentPolicyTarget): string {
  return `${target.scopeKind}:${target.scopeId}`;
}

function settingsKey(s: AgentPolicySettings): string {
  return [s.maxBytesPerQuery, s.dailyBytes, s.partitionFilterBytes, s.incidentMode, s.alertMultiplier].join("|");
}

const KIND_ORDER: Record<AgentPolicyTarget["scopeKind"], number> = { default: 0, role: 1, pat: 2 };

/** Rows with identical limits are one policy; the default-scoped group first, then by size. */
export function groupPolicies(policies: AgentPolicy[]): PolicyGroup[] {
  const groups = new Map<string, PolicyGroup>();
  for (const p of policies) {
    const settings: AgentPolicySettings = { maxBytesPerQuery: p.maxBytesPerQuery, dailyBytes: p.dailyBytes, partitionFilterBytes: p.partitionFilterBytes, incidentMode: p.incidentMode, alertMultiplier: p.alertMultiplier };
    const key = settingsKey(settings);
    const group = groups.get(key) ?? { key, settings, members: [] };
    group.members.push(p);
    groups.set(key, group);
  }
  const out = [...groups.values()];
  for (const g of out) g.members.sort((a, b) => KIND_ORDER[a.scopeKind] - KIND_ORDER[b.scopeKind] || (a.scopeLabel ?? a.scopeId).localeCompare(b.scopeLabel ?? b.scopeId));
  const hasDefault = (g: PolicyGroup): boolean => g.members.some((m) => m.scopeKind === "default");
  return out.sort((a, b) => Number(hasDefault(b)) - Number(hasDefault(a)) || b.members.length - a.members.length);
}

/** What a save sends: the chosen targets, and the group's rows that were deselected. */
export function assignment(group: PolicyGroup | undefined, targets: AgentPolicyTarget[]): { targets: AgentPolicyTarget[]; removeIds: string[] } | { error: string } {
  if (targets.length === 0) return { error: "Choose at least one role, token or every agent" };
  const chosen = new Set(targets.map(targetKey));
  return { targets, removeIds: (group?.members ?? []).filter((m) => !chosen.has(targetKey(m))).map((m) => m.id) };
}

/** Share of the daily budget a session has used, 0..1, or null without a budget. */
export function budgetShare(readBytes: number, dailyBytes: number | null): number | null {
  if (!dailyBytes) return null;
  return Math.min(1, readBytes / dailyBytes);
}
