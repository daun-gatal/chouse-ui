/**
 * Data hooks for AI Governance › Assistant. Every write refreshes the registry and the
 * chat's agent picker, since one change can affect bindings, usages and
 * validation problems across the whole registry.
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import * as aiAgents from "@/api/aiAgents";
import { fetchAiModels, type AiModelOption } from "@/api/ai";

export const assistantKeys = {
  all: ["ai-agents"] as const,
  registry: () => [...assistantKeys.all, "registry"] as const,
  revisions: (entity: string, id: string) => [...assistantKeys.all, "revisions", entity, id] as const,
  models: () => [...assistantKeys.all, "models"] as const,
};

export function useAiRegistry(enabled = true): UseQueryResult<aiAgents.AiRegistry> {
  return useQuery({ queryKey: assistantKeys.registry(), queryFn: aiAgents.getAiRegistry, enabled });
}

export function useRevisions(entity: aiAgents.RegistryRevision["entity"], id: string | null): UseQueryResult<aiAgents.RegistryRevision[]> {
  return useQuery({
    queryKey: assistantKeys.revisions(entity, id ?? ""),
    queryFn: () => aiAgents.listRevisions(entity, id ?? ""),
    enabled: Boolean(id),
  });
}

export function useModelOptions(): UseQueryResult<AiModelOption[]> {
  // Needs an active ClickHouse connection; without one the list is just empty.
  return useQuery({ queryKey: assistantKeys.models(), queryFn: fetchAiModels, staleTime: 60_000, retry: false });
}

function useRefresh(): () => Promise<void> {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: assistantKeys.registry() }),
      client.invalidateQueries({ queryKey: [...assistantKeys.all, "revisions"] }),
    ]);
    // The chat bubble refreshes its agent picker on this event.
    window.dispatchEvent(new Event("ai-agents-updated"));
  };
}

function useRegistryMutation<TVariables, TResult>(fn: (variables: TVariables) => Promise<TResult>): UseMutationResult<TResult, Error, TVariables> {
  const refresh = useRefresh();
  return useMutation({ mutationFn: fn, onSuccess: refresh });
}

export interface AssistantMutations {
  saveAgent: UseMutationResult<aiAgents.AiAgent, Error, { id: string | null; input: aiAgents.AgentInput; version: number | null }>;
  deleteAgent: UseMutationResult<unknown, Error, { id: string; version: number }>;
  resetAgent: UseMutationResult<aiAgents.AiAgent, Error, string>;
  saveHarness: UseMutationResult<aiAgents.AiHarness, Error, { id: string | null; input: aiAgents.HarnessInput; version: number | null }>;
  deleteHarness: UseMutationResult<unknown, Error, { id: string; version: number }>;
  resetHarness: UseMutationResult<aiAgents.AiHarness, Error, string>;
  saveSkill: UseMutationResult<aiAgents.AiSkill, Error, { id: string | null; input: aiAgents.SkillInput; version: number | null }>;
  deleteSkill: UseMutationResult<unknown, Error, { id: string; version: number }>;
  resetSkill: UseMutationResult<aiAgents.AiSkill, Error, string>;
  bind: UseMutationResult<unknown, Error, { featureId: string; agentId: string }>;
  rollback: UseMutationResult<unknown, Error, string>;
}

export function useAssistantMutations(): AssistantMutations {
  return {
    saveAgent: useRegistryMutation(({ id, input, version }) => (id && version !== null ? aiAgents.updateAgent(id, input, version) : aiAgents.createAgent(input))),
    deleteAgent: useRegistryMutation(({ id, version }) => aiAgents.deleteAgent(id, version)),
    resetAgent: useRegistryMutation((id: string) => aiAgents.resetAgent(id)),
    saveHarness: useRegistryMutation(({ id, input, version }) => (id && version !== null ? aiAgents.updateHarness(id, input, version) : aiAgents.createHarness(input))),
    deleteHarness: useRegistryMutation(({ id, version }) => aiAgents.deleteHarness(id, version)),
    resetHarness: useRegistryMutation((id: string) => aiAgents.resetHarness(id)),
    saveSkill: useRegistryMutation(({ id, input, version }) => (id && version !== null ? aiAgents.updateSkill(id, input, version) : aiAgents.createSkill(input))),
    deleteSkill: useRegistryMutation(({ id, version }) => aiAgents.deleteSkill(id, version)),
    resetSkill: useRegistryMutation((id: string) => aiAgents.resetSkill(id)),
    bind: useRegistryMutation(({ featureId, agentId }) => aiAgents.bindFeature(featureId, agentId)),
    rollback: useRegistryMutation((revisionId: string) => aiAgents.rollbackRevision(revisionId)),
  };
}

export function usePromptPreview(): UseMutationResult<aiAgents.PromptPreview, Error, { featureId: string | null; agentId: string | null; agent: aiAgents.AgentInput }> {
  return useMutation({ mutationFn: ({ featureId, agentId, agent }) => aiAgents.previewAgent(featureId, agentId, agent) });
}

export function useAgentTest(): UseMutationResult<aiAgents.TestResult, Error, aiAgents.TestRequest> {
  return useMutation({ mutationFn: aiAgents.runAgentTest });
}
