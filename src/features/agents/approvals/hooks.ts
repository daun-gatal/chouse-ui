/**
 * Data hooks for AI Governance › Approvals (ADR 0024 §Phase 2).
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import * as api from "@/api/aiActions";

export const approvalKeys = {
  all: ["ai-actions"] as const,
  list: (status: api.AiActionStatus | null) => [...approvalKeys.all, "list", status] as const,
  pendingCount: () => [...approvalKeys.all, "pending-count"] as const,
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
