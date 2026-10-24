/**
 * Data hooks for AI actions: AI Governance › Approvals (ADR 0024 §Phase 2) and
 * Chobi's Activity tab (ADR 0025 §6).
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "@/api/aiActions";
import { errorMessage } from "@/features/agents/assistant/shared";

export const approvalKeys = {
  all: ["ai-actions"] as const,
  list: (status: api.AiActionStatus | null) => [...approvalKeys.all, "list", status] as const,
  pendingCount: () => [...approvalKeys.all, "pending-count"] as const,
  inbox: () => [...approvalKeys.all, "inbox"] as const,
  activity: (limit: number) => [...approvalKeys.all, "activity", limit] as const,
};

export function useAiActions(status: api.AiActionStatus | null): UseQueryResult<api.AiActionList> {
  return useQuery({
    queryKey: approvalKeys.list(status),
    queryFn: () => api.listAiActions(status ?? undefined),
    staleTime: 10_000,
    // New proposals arrive from background runs; keep the queue current while it is open.
    refetchInterval: 30_000,
  });
}

export function usePendingAiActionCount(enabled = true): UseQueryResult<number> {
  return useQuery({ queryKey: approvalKeys.pendingCount(), queryFn: api.getPendingAiActionCount, enabled, staleTime: 15_000, refetchInterval: 60_000 });
}

export interface ApprovalMutations {
  approve: UseMutationResult<api.AiAction, Error, { id: string; args?: Record<string, unknown> }>;
  reject: UseMutationResult<api.AiAction, Error, { id: string; message?: string }>;
}

export function useApprovalMutations(): ApprovalMutations {
  const client = useQueryClient();
  const onSettled = (): Promise<void> => client.invalidateQueries({ queryKey: approvalKeys.all });
  return {
    approve: useMutation({ mutationFn: ({ id, args }) => api.approveAiAction(id, args), onSettled }),
    reject: useMutation({ mutationFn: ({ id, message }) => api.rejectAiAction(id, message), onSettled }),
  };
}

/** What waits for this user: their own held calls and plans, and requests they may approve. */
export function useAiInbox(enabled = true): UseQueryResult<api.AiAction[]> {
  return useQuery({ queryKey: approvalKeys.inbox(), queryFn: api.getAiActionInbox, enabled, staleTime: 10_000, refetchInterval: 30_000 });
}

/** What AI agents changed for this user, newest first. */
export function useAiActivity(limit: number, enabled = true): UseQueryResult<api.AiAction[]> {
  return useQuery({ queryKey: approvalKeys.activity(limit), queryFn: () => api.getAiActivity({ limit }), enabled, staleTime: 10_000, refetchInterval: 60_000 });
}

export interface Decide {
  approve: (action: api.AiAction, args?: Record<string, unknown>) => Promise<boolean>;
  reject: (action: api.AiAction, message?: string) => Promise<boolean>;
  undo: (action: api.AiAction) => Promise<boolean>;
  busyId: string | null;
}

/** Answers an action and says what happened: a finished action can still have failed downstream. */
export function useDecide(): Decide {
  const client = useQueryClient();
  const { approve, reject } = useApprovalMutations();
  const undo = useMutation({ mutationFn: (id: string) => api.undoAiAction(id), onSettled: () => client.invalidateQueries({ queryKey: approvalKeys.all }) });
  const [busyId, setBusyId] = useState<string | null>(null);
  const run = async (id: string, work: () => Promise<void>, failure: string): Promise<boolean> => {
    setBusyId(id);
    try {
      await work();
      return true;
    } catch (error) {
      toast.error(errorMessage(error, failure));
      return false;
    } finally {
      setBusyId(null);
    }
  };
  return {
    busyId,
    approve: (action, args) => run(action.id, async () => {
      const done = await approve.mutateAsync({ id: action.id, args });
      if (done.status === "failed") toast.error(`${done.title} failed: ${done.error ?? "unknown error"}`);
      // A held MCP call only records the decision; the agent runs it next.
      else if (done.status === "approved") toast.success(`${done.title}: confirmed — the agent continues`);
      else toast.success(`${done.title}: done`);
    }, "Could not approve the action"),
    reject: (action, message) => run(action.id, async () => {
      await reject.mutateAsync({ id: action.id, message });
      toast.success(`${action.title}: rejected`);
    }, "Could not reject the action"),
    undo: (action) => run(action.id, async () => {
      await undo.mutateAsync(action.id);
      toast.success(`${action.title}: undone`);
    }, "Could not undo the action"),
  };
}
