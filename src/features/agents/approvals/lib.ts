/**
 * Presentation rules for AI Governance › Approvals.
 */

import { AI_ORIGIN_LABELS, AI_TIER_LABELS, type AiAction, type AiActionStatus, type AiActionTier } from "@/api/aiActions";
import type { Tone } from "@/features/observe/lib";

export const STATUS_LABEL: Record<AiActionStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  running: "Running",
  executed: "Done",
  failed: "Failed",
  rejected: "Rejected",
  expired: "Expired",
};

export const STATUS_TONE: Record<AiActionStatus, Tone> = {
  pending: "warn",
  approved: "info",
  running: "info",
  executed: "ok",
  failed: "bad",
  rejected: "muted",
  expired: "muted",
};

/** The filter choices, "Waiting" first because it is what needs someone. */
export const STATUS_FILTERS: Array<{ value: AiActionStatus | "all"; label: string }> = [
  { value: "pending", label: "Waiting" },
  { value: "all", label: "All" },
  { value: "executed", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
];

export const TIER_TONE: Record<AiActionTier, Tone> = {
  t1: "ok",
  t2: "warn",
  t3: "bad",
};

/** A tier in words, or "—" for actions recorded before tiers. */
export function tierLabel(tier: AiActionTier | null): string {
  return tier ? AI_TIER_LABELS[tier] : "—";
}

/** A pending action past its deadline reads as expired before the sweeper marks it. */
export function effectiveStatus(action: Pick<AiAction, "status" | "expiresAt">, now: number): AiActionStatus {
  return action.status === "pending" && action.expiresAt <= now ? "expired" : action.status;
}

/** Where the request came from, in words. */
export function sourceLabel(action: Pick<AiAction, "source" | "origin" | "userName" | "userId">): string {
  const who = action.userName ?? "a deleted user";
  if (action.source === "chat") return `${who}, in chat`;
  if (action.source === "held") return `${who}, over ${AI_ORIGIN_LABELS[action.origin]}`;
  return action.origin === "background" ? `Background run as ${who}` : `${who}, from ${AI_ORIGIN_LABELS[action.origin]}`;
}

/** What to say about a chat action that waits: it is answered in its chat, not here. */
export function chatHint(action: Pick<AiAction, "source" | "status" | "threadId">): string | null {
  if (action.source !== "chat" || action.status !== "pending") return null;
  return action.threadId ? "Answered in its chat" : "Answered in chat";
}
