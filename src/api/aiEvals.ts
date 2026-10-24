/**
 * Agent evals API (ADR 0024 §Phase 6): test cases an agent should pass, runs
 * that score a draft against them, and the gate that, with an eval threshold
 * set, lets only a draft that passed be saved.
 */

import { api } from "./client";
import type { AgentInput } from "./aiAgents";

export type EvalCaseKind = "chat" | "feature";

export interface EvalCaseInput {
  name: string;
  kind: EvalCaseKind;
  featureId?: string | null;
  /** Chat: `{ messages: [{ role, content }] }`. Feature: the feature's input. */
  input: Record<string, unknown>;
  /** Tools the agent should call, in this order (others may come between). */
  expectedTools: string[];
  /** What a good answer does, for the judge. */
  rubric?: string | null;
}

export interface EvalCase extends Required<Omit<EvalCaseInput, "featureId" | "rubric">> {
  id: string;
  agentId: string;
  featureId: string | null;
  rubric: string | null;
  source: "manual" | "console" | "request" | "builtin";
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EvalCaseResult {
  caseId: string;
  name: string;
  passed: boolean;
  toolsOk: boolean | null;
  missingTools: string[];
  calledTools: string[];
  judge: { pass: boolean; reason: string } | null;
  answer: string;
  error: string | null;
  durationMs: number;
}

export interface EvalRun {
  id: string;
  agentId: string;
  draftHash: string;
  status: "running" | "completed" | "failed";
  score: number | null;
  passed: number;
  total: number;
  results: EvalCaseResult[];
  regressions: Array<{ caseId: string; name: string }>;
  tokens: number;
  costUsd: number | null;
  error: string | null;
  createdBy: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface AgentEvals {
  cases: EvalCase[];
  runs: EvalRun[];
  maxCases: number;
}

export interface EvalGate {
  required: boolean;
  threshold: number | null;
  cases: number;
  run: EvalRun | null;
  passing: boolean;
}

const BASE = "/ai-evals";
const seg = encodeURIComponent;

export async function getAgentEvals(agentId: string): Promise<AgentEvals> {
  return api.get<AgentEvals>(`${BASE}/agents/${seg(agentId)}`);
}

export async function createEvalCase(agentId: string, input: EvalCaseInput, source?: "console"): Promise<EvalCase> {
  return api.post<EvalCase>(`${BASE}/agents/${seg(agentId)}/cases`, input, source ? { params: { source } } : undefined);
}

export async function updateEvalCase(id: string, input: EvalCaseInput): Promise<EvalCase> {
  return api.put<EvalCase>(`${BASE}/cases/${seg(id)}`, input);
}

export async function deleteEvalCase(id: string): Promise<void> {
  await api.delete(`${BASE}/cases/${seg(id)}`);
}

/** Save a chat request from AI activity as a test case of the agent that answered it. */
export async function createEvalCaseFromRequest(requestId: string): Promise<EvalCase> {
  return api.post<EvalCase>(`${BASE}/cases/from-request`, { requestId });
}

/** Start scoring a draft (or the saved agent); poll the run until it finishes. */
export async function startEvalRun(agentId: string, draft?: AgentInput, modelId?: string): Promise<EvalRun> {
  return api.post<EvalRun>(`${BASE}/agents/${seg(agentId)}/runs`, { ...(draft ? { agent: draft } : {}), ...(modelId ? { modelId } : {}) });
}

export async function getEvalRun(id: string): Promise<EvalRun> {
  return api.get<EvalRun>(`${BASE}/runs/${seg(id)}`);
}

export async function getEvalGate(agentId: string, draft: AgentInput): Promise<EvalGate> {
  return api.post<EvalGate>(`${BASE}/agents/${seg(agentId)}/gate`, { agent: draft });
}
