/**
 * Data hooks for agent evals (ADR 0024 §Phase 6).
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import * as api from "@/api/aiEvals";
import type { AgentInput } from "@/api/aiAgents";
import { isRunning } from "./lib";

export const evalKeys = {
  all: ["ai-evals"] as const,
  agent: (agentId: string) => [...evalKeys.all, "agent", agentId] as const,
  run: (runId: string) => [...evalKeys.all, "run", runId] as const,
  gate: (agentId: string, draft: string) => [...evalKeys.all, "gate", agentId, draft] as const,
};

export function useAgentEvals(agentId: string | null): UseQueryResult<api.AgentEvals> {
  return useQuery({ queryKey: evalKeys.agent(agentId ?? ""), queryFn: () => api.getAgentEvals(agentId ?? ""), enabled: Boolean(agentId), staleTime: 10_000 });
}

/** A run, polled every two seconds while it is going. */
export function useEvalRun(runId: string | null): UseQueryResult<api.EvalRun> {
  const client = useQueryClient();
  return useQuery({
    queryKey: evalKeys.run(runId ?? ""),
    queryFn: async () => {
      const run = await api.getEvalRun(runId ?? "");
      if (!isRunning(run)) void client.invalidateQueries({ queryKey: [...evalKeys.all, "agent"] });
      return run;
    },
    enabled: Boolean(runId),
    refetchInterval: (query) => (isRunning(query.state.data) ? 2_000 : false),
  });
}

/** Whether the current draft may be saved; refreshed when the draft or its runs change. */
export function useEvalGate(agentId: string | null, draft: AgentInput, enabled: boolean): UseQueryResult<api.EvalGate> {
  const key = JSON.stringify(draft);
  return useQuery({
    queryKey: evalKeys.gate(agentId ?? "", key),
    queryFn: () => api.getEvalGate(agentId ?? "", draft),
    enabled: enabled && Boolean(agentId),
    staleTime: 5_000,
  });
}

export interface EvalMutations {
  create: UseMutationResult<api.EvalCase, Error, { agentId: string; input: api.EvalCaseInput; source?: "console" }>;
  update: UseMutationResult<api.EvalCase, Error, { id: string; input: api.EvalCaseInput }>;
  remove: UseMutationResult<void, Error, string>;
  fromRequest: UseMutationResult<api.EvalCase, Error, string>;
  run: UseMutationResult<api.EvalRun, Error, { agentId: string; draft?: AgentInput; modelId?: string }>;
}

export function useEvalMutations(): EvalMutations {
  const client = useQueryClient();
  const onSettled = (): Promise<void> => client.invalidateQueries({ queryKey: evalKeys.all });
  return {
    create: useMutation({ mutationFn: ({ agentId, input, source }) => api.createEvalCase(agentId, input, source), onSettled }),
    update: useMutation({ mutationFn: ({ id, input }) => api.updateEvalCase(id, input), onSettled }),
    remove: useMutation({ mutationFn: api.deleteEvalCase, onSettled }),
    fromRequest: useMutation({ mutationFn: api.createEvalCaseFromRequest, onSettled }),
    run: useMutation({ mutationFn: ({ agentId, draft, modelId }) => api.startEvalRun(agentId, draft, modelId), onSettled }),
  };
}
