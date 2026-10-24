/**
 * Presentation rules for AI Governance › Auto-triage.
 */

import type { TriageRunStatus, TriageTrigger } from "@/api/aiTriage";
import type { Tone } from "@/features/observe/lib";

export const TRIGGER_LABEL: Record<TriageTrigger, string> = {
  data_health_incident: "Data Health incidents",
  observe_incident: "Observe incidents",
  fleet_alert: "Fleet alerts",
  scheduled_run_failed: "Failed scheduled runs",
  doctor_report: "Doctor reports with findings",
};

export const TRIGGER_HINT: Record<TriageTrigger, string> = {
  data_health_incident: "A Data Health promise breaks: stale, missing or wrong data.",
  observe_incident: "Data Observability opens an incident on a pipeline, engine or table.",
  fleet_alert: "A fleet threshold alert fires on a node (memory, long queries, parts).",
  scheduled_run_failed: "A scheduled query run fails or errors.",
  doctor_report: "A Doctor scan reports warnings or critical findings.",
};

export const RUN_STATUS_LABEL: Record<TriageRunStatus, string> = { running: "Investigating", completed: "Investigated", failed: "Failed", skipped: "Skipped" };
export const RUN_STATUS_TONE: Record<TriageRunStatus, Tone> = { running: "info", completed: "ok", failed: "bad", skipped: "muted" };
export const LEVEL_TONE: Record<"low" | "medium" | "high", Tone> = { low: "muted", medium: "warn", high: "bad" };

/** Where the investigated subject lives in CHouse. */
export function subjectLink(trigger: TriageTrigger, subjectId: string): string {
  switch (trigger) {
    case "data_health_incident": return `/data/incidents/data_health/${encodeURIComponent(subjectId)}`;
    case "observe_incident": return `/data/incidents/observe/${encodeURIComponent(subjectId)}`;
    case "doctor_report": return `/doctor/${encodeURIComponent(subjectId)}`;
    case "scheduled_run_failed": return "/data/scheduled-queries/jobs";
    case "fleet_alert": return "/fleet";
  }
}

/** Share of the daily token budget used today, 0–1. */
export function budgetShare(tokensToday: number, dailyTokenBudget: number): number {
  if (dailyTokenBudget <= 0) return 1;
  return Math.min(1, Math.max(0, tokensToday / dailyTokenBudget));
}

/** "Every incident" or "At most once an hour per connection". */
export function cooldownLabel(minutes: number): string {
  if (minutes <= 0) return "Every time";
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "Once an hour per connection" : `Once every ${hours} hours per connection`;
  }
  return `Once every ${minutes} min per connection`;
}

/** Problems with a rule draft, in the order the form shows its fields. */
export function ruleProblems(draft: { cooldownMinutes: number; dailyTokenBudget: number }): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(draft.cooldownMinutes) || draft.cooldownMinutes < 0 || draft.cooldownMinutes > 1440) problems.push("Cooldown is 0 to 1,440 minutes.");
  if (!Number.isInteger(draft.dailyTokenBudget) || draft.dailyTokenBudget < 1000) problems.push("The daily token budget is at least 1,000 tokens.");
  return problems;
}
