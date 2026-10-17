/**
 * Data hooks for AI Governance › Guardrails.
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import * as api from "@/api/aiGuardrails";
import { useAiModelId } from "@/hooks/useAiModelId";

export const guardrailKeys = {
  all: ["ai-guardrails"] as const,
  catalog: () => [...guardrailKeys.all, "catalog"] as const,
  events: (days: number, guardrailId: string | null) => [...guardrailKeys.all, "events", days, guardrailId] as const,
  revisions: (id: string) => [...guardrailKeys.all, "revisions", id] as const,
};

export function useGuardrails(enabled = true): UseQueryResult<api.GuardrailCatalog> {
  return useQuery({ queryKey: guardrailKeys.catalog(), queryFn: api.getGuardrails, enabled, staleTime: 30_000 });
}

export function useGuardrailEvents(days: number, guardrailId: string | null = null): UseQueryResult<api.GuardrailEvent[]> {
  return useQuery({
    queryKey: guardrailKeys.events(days, guardrailId),
    queryFn: () => api.getGuardrailEvents({ days, limit: 100, ...(guardrailId ? { guardrailId } : {}) }),
    staleTime: 30_000,
  });
}

export function useGuardrailRevisions(id: string | null): UseQueryResult<api.GuardrailRevision[]> {
  return useQuery({ queryKey: guardrailKeys.revisions(id ?? ""), queryFn: () => api.listGuardrailRevisions(id ?? ""), enabled: Boolean(id) });
}

function useInvalidating<TVariables, TResult>(fn: (variables: TVariables) => Promise<TResult>): UseMutationResult<TResult, Error, TVariables> {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: guardrailKeys.all }) });
}

export interface GuardrailMutations {
  save: UseMutationResult<api.Guardrail, Error, { id: string | null; input: api.GuardrailInput; version: number | null }>;
  setState: UseMutationResult<api.Guardrail, Error, { id: string; state: { mode?: api.GuardrailMode; enabled?: boolean }; version: number }>;
  reorder: UseMutationResult<unknown, Error, string[]>;
  remove: UseMutationResult<unknown, Error, { id: string; version: number }>;
  reset: UseMutationResult<api.Guardrail, Error, string>;
  rollback: UseMutationResult<api.Guardrail, Error, string>;
}

export function useGuardrailMutations(): GuardrailMutations {
  return {
    save: useInvalidating(({ id, input, version }) => (id && version !== null ? api.updateGuardrail(id, input, version) : api.createGuardrail(input))),
    setState: useInvalidating(({ id, state, version }) => api.setGuardrailState(id, state, version)),
    reorder: useInvalidating((ids: string[]) => api.reorderGuardrails(ids)),
    remove: useInvalidating(({ id, version }) => api.deleteGuardrail(id, version)),
    reset: useInvalidating((id: string) => api.resetGuardrail(id)),
    rollback: useInvalidating((revisionId: string) => api.rollbackGuardrail(revisionId)),
  };
}

export function useGuardrailTest(): UseMutationResult<api.GuardrailTestResult, Error, api.GuardrailTestRequest> {
  return useMutation({ mutationFn: api.testGuardrail });
}

export function useGuardrailDraft(): UseMutationResult<api.GuardrailDraft, Error, string> {
  const modelId = useAiModelId();
  return useMutation({ mutationFn: (goal: string) => api.draftGuardrail(goal, modelId) });
}
