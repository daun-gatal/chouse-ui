/**
 * The Rules tab's one list of everything that sends alerts (ADR 0026 §7),
 * built in the browser from each feature's own list, so a viewer only sees
 * what their permissions already show them. Fleet rules are edited here;
 * everything else links to where it is managed.
 */

import type { AlertRule } from "@/api/alerting";
import type { DataHealthPromise } from "@/api/dataHealth";
import type { ScheduledQuery } from "@/api/scheduledQueries";
import type { TriageRule } from "@/api/aiTriage";

export const SOURCE_KINDS = ["fleet", "dashboard", "dataHealth", "scheduled", "triage", "remediation"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_LABELS: Record<SourceKind, string> = {
  fleet: "Fleet",
  dashboard: "Dashboard alert",
  dataHealth: "Data Health",
  scheduled: "Scheduled query",
  triage: "Auto-triage",
  remediation: "Remediation",
};

export type SourceState = "firing" | "ok" | "disabled" | "error" | "pending";

export interface SourceRow {
  key: string;
  kind: SourceKind;
  name: string;
  /** Where it lives, for the subtitle. */
  where: string | null;
  state: SourceState;
  severity: string | null;
  channelIds: string[];
  /** Where it is managed (null: here). */
  link: string | null;
  /** The fleet rule, edited in place. */
  rule?: AlertRule;
}

export interface PanelAlertLike {
  id: string;
  name: string;
  dashboardId: string;
  dashboardTitle: string | null;
  severity: string;
  enabled: boolean;
  channelIds: string[];
  status?: { state: string } | null;
}

export interface SourceInputs {
  rules?: AlertRule[];
  panelAlerts?: PanelAlertLike[];
  promises?: DataHealthPromise[];
  jobs?: ScheduledQuery[];
  triage?: TriageRule[];
  remediation?: { channelIds: string[] };
}

function promiseState(p: DataHealthPromise): SourceState {
  if (!p.enabled) return "disabled";
  if (p.status === "unhealthy" || p.status === "degraded") return "firing";
  if (p.status === "unknown") return "pending";
  return "ok";
}

function jobState(job: ScheduledQuery): SourceState {
  if (!job.enabled) return "disabled";
  return job.lastRun?.status === "error" ? "error" : "ok";
}

export function toSourceRows(inputs: SourceInputs): SourceRow[] {
  const rows: SourceRow[] = [];
  for (const r of inputs.rules ?? []) {
    rows.push({ key: `fleet:${r.id}`, kind: "fleet", name: r.name, where: null, state: r.enabled ? "ok" : "disabled", severity: r.severity, channelIds: r.channelIds, link: null, rule: r });
  }
  for (const a of inputs.panelAlerts ?? []) {
    const state: SourceState = !a.enabled ? "disabled" : a.status?.state === "firing" ? "firing" : a.status?.state === "error" ? "error" : a.status?.state === "pending" ? "pending" : "ok";
    rows.push({ key: `dashboard:${a.id}`, kind: "dashboard", name: a.name, where: a.dashboardTitle ?? "Deleted dashboard", state, severity: a.severity, channelIds: a.channelIds, link: `/dashboards/${encodeURIComponent(a.dashboardId)}` });
  }
  const promiseJobs = new Set<string>();
  for (const p of inputs.promises ?? []) {
    promiseJobs.add(p.scheduledQueryId);
    rows.push({ key: `dataHealth:${p.id}`, kind: "dataHealth", name: p.name, where: null, state: promiseState(p), severity: null, channelIds: p.channelIds ?? [], link: "/data/datasets?view=promises" });
  }
  for (const job of inputs.jobs ?? []) {
    // A Data Health promise runs as a scheduled query; it is listed once, as the promise.
    if (promiseJobs.has(job.id) || job.channelIds.length === 0) continue;
    rows.push({ key: `scheduled:${job.id}`, kind: "scheduled", name: job.name, where: null, state: jobState(job), severity: null, channelIds: job.channelIds, link: `/data/scheduled-queries/jobs?job=${encodeURIComponent(job.id)}` });
  }
  for (const t of inputs.triage ?? []) {
    rows.push({ key: `triage:${t.trigger}`, kind: "triage", name: `Triage: ${t.label}`, where: null, state: t.enabled ? "ok" : "disabled", severity: null, channelIds: t.channelIds, link: "/ai/triage" });
  }
  if (inputs.remediation) {
    rows.push({ key: "remediation", kind: "remediation", name: "Remediation approvals", where: null, state: inputs.remediation.channelIds.length > 0 ? "ok" : "disabled", severity: null, channelIds: inputs.remediation.channelIds, link: null });
  }
  return rows;
}

export interface SourceFilter {
  q: string;
  kind: SourceKind | "";
  state: SourceState | "nochannel" | "";
  severity: string;
  channelId: string;
}

export function filterSources(rows: SourceRow[], f: SourceFilter): SourceRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.name} ${r.where ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.state === "nochannel" ? r.channelIds.length > 0 : f.state && r.state !== f.state) return false;
    if (f.severity && r.severity !== f.severity) return false;
    if (f.channelId && !r.channelIds.includes(f.channelId)) return false;
    return true;
  });
}
