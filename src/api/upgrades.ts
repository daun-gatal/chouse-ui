/**
 * Upgrades API (ADR 0016 §9): rules-pack assessments, workload replay on a
 * canary and the fleet rollout tracker.
 */

import { api } from "./client";

export interface Finding {
  id: string;
  category: string;
  severity: "blocker" | "warning" | "info";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface AssessmentSummary {
  id: string;
  connectionId: string;
  currentVersion: string | null;
  targetVersion: string;
  status: string;
  verdict: string | null;
  summary: Record<string, unknown>;
  createdAt: number;
  finishedAt: number | null;
}

export interface Assessment extends AssessmentSummary {
  findings: Finding[];
}

export interface ReplaySummary {
  id: string;
  canaryConnectionId: string;
  status: string;
  total: number;
  same: number;
  differs: number;
  slower: number;
  errors: number;
  startedAt: number;
}

/** `missing`: the table/column exists only on the baseline. `skipped`: the baseline itself can no longer run the shape. */
export type ReplayOutcome = "same" | "differs" | "slower" | "missing" | "error" | "skipped";

export interface Replay extends ReplaySummary {
  connectionId: string;
  finishedAt: number | null;
  missing: number;
  skipped: number;
  results: Array<{ fingerprint: string; outcome: ReplayOutcome; baselineMs: number | null; canaryMs: number | null; error: string | null; sampleQuery: string | null }>;
}

export interface RolloutNode {
  connectionId: string;
  name: string;
  version: string | null;
  gates: { replicaLagOk: boolean | null; replicaLagSeconds: number | null; openRegressions: number; sickReplicas: number | null };
  checkedAt: number | null;
}

export function listAssessments(connectionId?: string): Promise<{ assessments: AssessmentSummary[]; replays: ReplaySummary[] }> {
  return api.get("/upgrades/assessments", { params: { connectionId } });
}

export function getAssessment(id: string): Promise<Assessment> {
  return api.get<Assessment>(`/upgrades/assessments/${encodeURIComponent(id)}`);
}

export function runAssessment(targetVersion: string, connectionId?: string): Promise<Assessment> {
  return api.post<Assessment>("/upgrades/assessments", { targetVersion }, { params: { connectionId } });
}

export function startReplay(canaryConnectionId: string, assessmentId: string | null, connectionId?: string): Promise<{ id: string }> {
  return api.post("/upgrades/replays", { canaryConnectionId, assessmentId }, { params: { connectionId } });
}

export function getReplay(id: string): Promise<Replay> {
  return api.get<Replay>(`/upgrades/replays/${encodeURIComponent(id)}`);
}

export async function getRollout(): Promise<RolloutNode[]> {
  const res = await api.get<{ nodes: RolloutNode[] }>("/upgrades/rollout");
  return res.nodes;
}
