/**
 * Approved actions API (ADR 0024 §Phase 2): write actions an AI agent asked
 * for. Chat actions are answered in their chat; background proposals (runs
 * with nobody there) are approved or rejected here, in AI Governance › Approvals.
 */

import { api } from "./client";

export const AI_ACTION_STATUSES = ["pending", "approved", "rejected", "executed", "failed", "expired"] as const;
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];

export interface AiAction {
  id: string;
  source: "chat" | "background";
  runId: string | null;
  threadId: string | null;
  userId: string;
  connectionId: string | null;
  agentPath: string | null;
  tool: string;
  /** The tool's title, e.g. "Kill a query". */
  title: string;
  risk: "low" | "high";
  args: Record<string, unknown>;
  /** What it does, in one line. */
  description: string;
  status: AiActionStatus;
  result: unknown;
  error: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  expiresAt: number;
  createdAt: number;
  /** Whether this viewer may approve or reject it here. */
  canDecide: boolean;
  userName: string | null;
  decidedByName: string | null;
}

export interface AiActionList {
  /** Whether the viewer holds `ai:act` (sees and approves everyone's background proposals). */
  canAct: boolean;
  actions: AiAction[];
}

export async function listAiActions(status?: AiActionStatus): Promise<AiActionList> {
  return api.get<AiActionList>("/ai-actions", { params: status ? { status } : undefined });
}

/** How many actions wait for the viewer: the badge next to the chat and Approvals. */
export async function getPendingAiActionCount(): Promise<number> {
  return (await api.get<{ count: number }>("/ai-actions/pending-count")).count;
}

/** Approve a background proposal, optionally with edited arguments; it runs at once, as you. */
export async function approveAiAction(id: string, args?: Record<string, unknown>): Promise<AiAction> {
  return api.post<AiAction>(`/ai-actions/${id}/approve`, args ? { args } : {});
}

export async function rejectAiAction(id: string, message?: string): Promise<AiAction> {
  return api.post<AiAction>(`/ai-actions/${id}/reject`, message ? { message } : {});
}
