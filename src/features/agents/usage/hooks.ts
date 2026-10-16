/** Queries behind AI Governance › AI activity (ADR 0020). */

import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";

import * as usage from "@/api/aiUsage";

const REFRESH_MS = 60_000;

export const aiUsageKeys = {
  all: ["ai-usage"] as const,
  summary: (days: number) => [...aiUsageKeys.all, "summary", days] as const,
  models: (days: number) => [...aiUsageKeys.all, "models", days] as const,
  egress: (days: number, q: string) => [...aiUsageKeys.all, "egress", days, q] as const,
  requests: (days: number, q: string, offset: number, limit: number) => [...aiUsageKeys.all, "requests", days, q, offset, limit] as const,
  request: (id: string) => [...aiUsageKeys.all, "request", id] as const,
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

export function useAiUsageRequests(days: number, q: string, offset: number, limit: number): UseQueryResult<usage.AiUsageRequestPage> {
  return useQuery({
    queryKey: aiUsageKeys.requests(days, q, offset, limit),
    queryFn: () => usage.listAiUsageRequests({ days, q, offset, limit }),
    refetchInterval: REFRESH_MS,
    // Keep the current page on screen while the next search or page loads.
    placeholderData: keepPreviousData,
  });
}

export function useAiUsageRequest(id: string | null): UseQueryResult<usage.AiUsageRequestDetail> {
  return useQuery({ queryKey: aiUsageKeys.request(id ?? ""), queryFn: () => usage.getAiUsageRequest(id ?? ""), enabled: Boolean(id) });
}
