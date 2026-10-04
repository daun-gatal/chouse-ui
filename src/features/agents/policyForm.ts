/**
 * Agent budget policy form ↔ API shape (ADR 0016 §10). The form edits sizes
 * in GiB; the API stores bytes. An empty field means "no limit".
 */

import type { AgentPolicy, AgentPolicyInput } from "@/api/agents";

export interface PolicyForm {
  scopeKind: AgentPolicyInput["scopeKind"];
  scopeId: string;
  maxGiBPerQuery: string;
  dailyGiB: string;
  partitionFilterGiB: string;
  incidentMode: AgentPolicyInput["incidentMode"];
  alertMultiplier: string;
}

const GIB = 1024 ** 3;

function gib(bytes: number | null): string {
  return bytes === null ? "" : String(Math.round((bytes / GIB) * 100) / 100);
}

export function policyToForm(policy?: AgentPolicy): PolicyForm {
  if (!policy) {
    return { scopeKind: "default", scopeId: "*", maxGiBPerQuery: "", dailyGiB: "", partitionFilterGiB: "", incidentMode: "warn", alertMultiplier: "" };
  }
  return {
    scopeKind: policy.scopeKind,
    scopeId: policy.scopeId,
    maxGiBPerQuery: gib(policy.maxBytesPerQuery),
    dailyGiB: gib(policy.dailyBytes),
    partitionFilterGiB: gib(policy.partitionFilterBytes),
    incidentMode: policy.incidentMode,
    alertMultiplier: policy.alertMultiplier === null ? "" : String(policy.alertMultiplier),
  };
}

function bytesOrNull(value: string, label: string): number | null | string {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return `${label} must be a positive number`;
  return Math.round(n * GIB);
}

/** API input, or the first validation problem. */
export function formToPolicy(form: PolicyForm): AgentPolicyInput | { error: string } {
  const scopeId = form.scopeKind === "default" ? "*" : form.scopeId.trim();
  if (!scopeId) return { error: form.scopeKind === "pat" ? "Pick a token id" : "Pick a role" };
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
    scopeKind: form.scopeKind,
    scopeId,
    maxBytesPerQuery: typeof maxBytesPerQuery === "number" ? maxBytesPerQuery : null,
    dailyBytes: typeof dailyBytes === "number" ? dailyBytes : null,
    partitionFilterBytes: typeof partitionFilterBytes === "number" ? partitionFilterBytes : null,
    incidentMode: form.incidentMode,
    alertMultiplier,
  };
}

/** Share of the daily budget a session has used, 0..1, or null without a budget. */
export function budgetShare(readBytes: number, dailyBytes: number | null): number | null {
  if (!dailyBytes) return null;
  return Math.min(1, readBytes / dailyBytes);
}
