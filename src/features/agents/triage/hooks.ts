/**
 * Data hooks for AI Governance › Auto-triage (ADR 0024 §Phase 4).
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import * as api from "@/api/aiTriage";

export const triageKeys = {
  all: ["ai-triage"] as const,
  rules: () => [...triageKeys.all, "rules"] as const,
  runs: (filter: { trigger: api.TriageTrigger | null; offset: number }) => [...triageKeys.all, "runs", filter] as const,
  subject: (trigger: api.TriageTrigger, subjectId: string) => [...triageKeys.all, "subject", trigger, subjectId] as const,
};

export function useTriageRules(): UseQueryResult<api.TriageRules> {
  return useQuery({ queryKey: triageKeys.rules(), queryFn: api.getTriageRules, staleTime: 15_000 });
}

export const RUNS_PAGE = 25;

export function useTriageRuns(trigger: api.TriageTrigger | null, offset: number): UseQueryResult<{ runs: api.TriageRun[]; total: number }> {
  return useQuery({
    queryKey: triageKeys.runs({ trigger, offset }),
    queryFn: () => api.listTriageRuns({ ...(trigger ? { trigger } : {}), limit: RUNS_PAGE, offset }),
    staleTime: 10_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTriageRunForSubject(trigger: api.TriageTrigger, subjectId: string | null): UseQueryResult<api.TriageRun | null> {
  return useQuery({
    queryKey: triageKeys.subject(trigger, subjectId ?? ""),
    queryFn: () => api.getTriageRunForSubject(trigger, subjectId ?? ""),
    enabled: Boolean(subjectId),
    staleTime: 30_000,
    // A missing permission or an older server means no badge, not an error.
    retry: false,
  });
}

export function useSaveTriageRule(): UseMutationResult<api.TriageRule, Error, { trigger: api.TriageTrigger; input: api.TriageRuleInput }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ trigger, input }) => api.saveTriageRule(trigger, input),
    onSettled: () => client.invalidateQueries({ queryKey: triageKeys.rules() }),
  });
}
