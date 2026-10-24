/** Queries behind AI Governance › AI activity (ADR 0020). */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import * as usage from "@/api/aiUsage";

const REFRESH_MS = 60_000;

export const aiUsageKeys = {
  all: ["ai-usage"] as const,
  summary: (days: number) => [...aiUsageKeys.all, "summary", days] as const,
  models: (days: number) => [...aiUsageKeys.all, "models", days] as const,
  egress: (days: number, q: string) => [...aiUsageKeys.all, "egress", days, q] as const,
  requests: (days: number, q: string, origin: usage.AiRequestOrigin | null, offset: number, limit: number) =>
    [...aiUsageKeys.all, "requests", days, q, origin, offset, limit] as const,
  request: (id: string) => [...aiUsageKeys.all, "request", id] as const,
  budgets: () => [...aiUsageKeys.all, "budgets"] as const,
};

export function useAiUsageSummary(days: number): UseQueryResult<usage.AiUsageSummary> {
  return useQuery({ queryKey: aiUsageKeys.summary(days), queryFn: () => usage.getAiUsageSummary(days), refetchInterval: REFRESH_MS });
}

export function useAiUsageByModel(days: number): UseQueryResult<usage.AiModelUsage[]> {
  return useQuery({ queryKey: aiUsageKeys.models(days), queryFn: () => usage.getAiUsageByModel(days), refetchInterval: REFRESH_MS });
}

export function useAiEgress(days: number, q: string): UseQueryResult<usage.AiEgressPage> {
  return useQuery({
    queryKey: aiUsageKeys.egress(days, q),
    queryFn: () => usage.getAiEgress(days, q),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useAiUsageRequests(
  days: number,
  q: string,
  origin: usage.AiRequestOrigin | null,
  offset: number,
  limit: number,
): UseQueryResult<usage.AiUsageRequestPage> {
  return useQuery({
    queryKey: aiUsageKeys.requests(days, q, origin, offset, limit),
    queryFn: () => usage.listAiUsageRequests({ days, q, origin: origin ?? undefined, offset, limit }),
    refetchInterval: REFRESH_MS,
    // Keep the current page on screen while the next search or page loads.
    placeholderData: keepPreviousData,
  });
}

export function useAiUsageRequest(id: string | null): UseQueryResult<usage.AiUsageRequestDetail> {
  return useQuery({ queryKey: aiUsageKeys.request(id ?? ""), queryFn: () => usage.getAiUsageRequest(id ?? ""), enabled: Boolean(id) });
}

export function useAiBudgets(): UseQueryResult<usage.AiBudgetList> {
  return useQuery({ queryKey: aiUsageKeys.budgets(), queryFn: usage.listAiBudgets, refetchInterval: REFRESH_MS, retry: false });
}

type SaveBudget = { id: string | null; input: usage.AiBudgetInput };

/** Create (id null) or update a budget, then refresh the list. */
export function useSaveAiBudget(): UseMutationResult<usage.AiBudget, Error, SaveBudget> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: SaveBudget) => (id ? usage.updateAiBudget(id, input) : usage.createAiBudget(input)),
    onSuccess: () => client.invalidateQueries({ queryKey: aiUsageKeys.budgets() }),
  });
}

export function useDeleteAiBudget(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usage.deleteAiBudget(id),
    onSuccess: () => client.invalidateQueries({ queryKey: aiUsageKeys.budgets() }),
  });
}
