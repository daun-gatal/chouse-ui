/**
 * Auto-triage API (ADR 0024 §Phase 4): when an incident, fleet alert, failed
 * scheduled run or Doctor finding appears, an AI agent investigates it on its
 * own, writes what it found to the subject's notebook, proposes actions for
 * approval and posts a short notice to the picked alerting channels.
 */

import { api } from "./client";

export const TRIAGE_TRIGGERS = ["data_health_incident", "observe_incident", "fleet_alert", "scheduled_run_failed", "doctor_report"] as const;
export type TriageTrigger = (typeof TRIAGE_TRIGGERS)[number];
export type TriageRunStatus = "running" | "completed" | "failed" | "skipped";

export interface TriageRule {
  trigger: TriageTrigger;
  label: string;
  enabled: boolean;
  /** null: the agent bound to the Auto-triage feature. */
  agentId: string | null;
  cooldownMinutes: number;
  dailyTokenBudget: number;
  channelIds: string[];
  proposeAs: string | null;
  watermark: number;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: number;
  tokensToday: number;
}

export interface TriageRules {
  canManage: boolean;
  defaultAgentId: string | null;
  rules: TriageRule[];
  channels: Array<{ id: string; name: string; type: string; enabled: boolean }>;
  agents: Array<{ id: string; name: string }>;
}

export interface TriageRuleInput {
  enabled: boolean;
  agentId: string | null;
  cooldownMinutes: number;
  dailyTokenBudget: number;
  channelIds: string[];
}

export interface TriageResult {
  summary: string;
  likelyCause: string;
  confidence: "low" | "medium" | "high";
  severity: "low" | "medium" | "high";
  findings: string[];
  nextSteps: string[];
}

export interface TriageRun {
  id: string;
  trigger: TriageTrigger;
  subjectId: string;
  subjectTitle: string;
  connectionId: string | null;
  status: TriageRunStatus;
  reason: string | null;
  summary: string | null;
  result: (TriageResult & Record<string, unknown>) | null;
  notebookId: string | null;
  actionIds: string[];
  tokens: number;
  costUsd: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export async function getTriageRules(): Promise<TriageRules> {
  return api.get<TriageRules>("/ai-triage/rules");
}

export async function saveTriageRule(trigger: TriageTrigger, input: TriageRuleInput): Promise<TriageRule> {
  return api.put<TriageRule>(`/ai-triage/rules/${trigger}`, input);
}

export async function listTriageRuns(filter: { trigger?: TriageTrigger; status?: TriageRunStatus; limit?: number; offset?: number } = {}): Promise<{ runs: TriageRun[]; total: number }> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filter)) if (value !== undefined) params[key] = String(value);
  return api.get<{ runs: TriageRun[]; total: number }>("/ai-triage/runs", { params: Object.keys(params).length > 0 ? params : undefined });
}

/** The investigation of one incident, alert, run or report, if there was one. */
export async function getTriageRunForSubject(trigger: TriageTrigger, subjectId: string): Promise<TriageRun | null> {
  return api.get<TriageRun | null>("/ai-triage/runs/for-subject", { params: { trigger, subjectId } });
}
