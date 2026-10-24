/**
 * AI actions API (ADR 0024 §Phase 2, ADR 0025): every write an AI agent asked
 * for or made. Chat actions are answered in their chat; queued actions
 * (background proposals and T3 calls) are approved in AI Governance ›
 * Approvals or Chobi's inbox; held MCP calls are confirmed by their own user.
 * T1 actions can be undone for 24 hours.
 */

import { api } from "./client";

export const AI_ACTION_STATUSES = ["pending", "approved", "rejected", "running", "executed", "failed", "expired"] as const;
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];

export const AI_ACTION_TIERS = ["t1", "t2", "t3"] as const;
/** t1: runs at once with undo · t2: asks once · t3: second approver. */
export type AiActionTier = (typeof AI_ACTION_TIERS)[number];

export const AI_TIER_LABELS: Record<AiActionTier, string> = {
  t1: "Undoable",
  t2: "Asks once",
  t3: "Second approver",
};

export type AiActionOrigin = "chat" | "mcp" | "cli" | "background";

export const AI_ORIGIN_LABELS: Record<AiActionOrigin, string> = {
  chat: "Chat",
  mcp: "MCP",
  cli: "CLI",
  background: "Background",
};

export const AI_TOOLKITS = ["data", "scheduling", "health", "observe", "dashboards", "access", "platform"] as const;
export type AiToolkit = (typeof AI_TOOLKITS)[number];

export const AI_TOOLKIT_LABELS: Record<AiToolkit, string> = {
  data: "Data & Query",
  scheduling: "Scheduling",
  health: "Data Health",
  observe: "Observe & Ops",
  dashboards: "Dashboards & Context",
  access: "Access",
  platform: "Platform & Audit",
};

export interface AiAction {
  id: string;
  /** chat: a paused chat run · background: the approval queue · held: an MCP call waiting for its user. */
  source: "chat" | "background" | "held";
  origin: AiActionOrigin;
  runId: string | null;
  threadId: string | null;
  userId: string;
  connectionId: string | null;
  agentPath: string | null;
  tool: string;
  /** The tool's title, e.g. "Kill a query". */
  title: string;
  toolkit: AiToolkit | null;
  /** Null for actions recorded before tiers. */
  tier: AiActionTier | null;
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
  undoneAt: number | null;
  /** Whether this viewer may approve or reject it here. */
  canDecide: boolean;
  /** Whether this viewer can undo it now. */
  undoAvailable: boolean;
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

/** How many actions wait for the viewer: the badge next to Chobi and Approvals. */
export async function getPendingAiActionCount(): Promise<number> {
  return (await api.get<{ count: number }>("/ai-actions/pending-count")).count;
}

/** What waits for the viewer's decision: their held MCP calls and queued actions they may approve. */
export async function getAiActionInbox(): Promise<AiAction[]> {
  return (await api.get<{ actions: AiAction[] }>("/ai-actions/inbox")).actions;
}

/** What the AI did for the viewer, newest first; `runId` narrows it to one chat reply, `ids` to given actions. */
export async function getAiActivity(options: { runId?: string; ids?: string[]; limit?: number } = {}): Promise<AiAction[]> {
  const params: Record<string, string> = {};
  if (options.runId) params.runId = options.runId;
  if (options.ids?.length) params.ids = options.ids.join(",");
  if (options.limit) params.limit = String(options.limit);
  return (await api.get<{ actions: AiAction[] }>("/ai-actions/activity", { params })).actions;
}

/** Approve a queued action (it runs at once, as you) or confirm a held MCP call. */
export async function approveAiAction(id: string, args?: Record<string, unknown>): Promise<AiAction> {
  return api.post<AiAction>(`/ai-actions/${id}/approve`, args ? { args } : {});
}

export async function rejectAiAction(id: string, message?: string): Promise<AiAction> {
  return api.post<AiAction>(`/ai-actions/${id}/reject`, message ? { message } : {});
}

/** Undo a T1 action; refused once the object changed since, or after 24 hours. */
export async function undoAiAction(id: string): Promise<AiAction> {
  return api.post<AiAction>(`/ai-actions/${id}/undo`, {});
}
