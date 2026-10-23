/**
 * Data hooks for AI Governance › Memories (ADR 0024 §Phase 3).
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import * as api from "@/api/aiMemories";

export const memoryKeys = {
  all: ["ai-memories"] as const,
  mine: () => [...memoryKeys.all, "mine"] as const,
  team: (connectionId: string | null, status: api.MemoryStatus | null) => [...memoryKeys.all, "team", connectionId, status] as const,
  table: (connectionId: string, database: string, table: string) => [...memoryKeys.all, "table", connectionId, database, table] as const,
  pendingCount: () => [...memoryKeys.all, "pending-count"] as const,
};

export function useMyMemories(): UseQueryResult<api.MyMemories> {
  return useQuery({ queryKey: memoryKeys.mine(), queryFn: api.getMyMemories, staleTime: 15_000 });
}

export function useTeamMemories(connectionId: string | null, status: api.MemoryStatus | null): UseQueryResult<api.TeamMemories> {
  return useQuery({
    queryKey: memoryKeys.team(connectionId, status),
    queryFn: () => api.getTeamMemories({ connectionId, status: status ?? undefined }),
    staleTime: 15_000,
  });
}

export function useTableMemories(connectionId: string | null, database: string, table: string, enabled: boolean): UseQueryResult<api.TeamMemories> {
  return useQuery({
    queryKey: memoryKeys.table(connectionId ?? "", database, table),
    queryFn: () => api.getTableMemories(connectionId ?? "", database, table),
    enabled: enabled && Boolean(connectionId),
    staleTime: 30_000,
  });
}

export function usePendingMemoryCount(enabled = true): UseQueryResult<number> {
  return useQuery({ queryKey: memoryKeys.pendingCount(), queryFn: api.getPendingMemoryCount, enabled, staleTime: 15_000, refetchInterval: 60_000 });
}

export interface MemoryMutations {
  create: UseMutationResult<api.AiMemory & { duplicate: boolean }, Error, { scope: api.MemoryScope; content: string; connectionId?: string }>;
  update: UseMutationResult<api.AiMemory, Error, { id: string; content: string }>;
  remove: UseMutationResult<void, Error, string>;
  review: UseMutationResult<api.AiMemory, Error, { id: string; approve: boolean }>;
  setEnabled: UseMutationResult<boolean, Error, boolean>;
}

export function useMemoryMutations(): MemoryMutations {
  const client = useQueryClient();
  const onSettled = (): Promise<void> => client.invalidateQueries({ queryKey: memoryKeys.all });
  return {
    create: useMutation({ mutationFn: api.createMemory, onSettled }),
    update: useMutation({ mutationFn: ({ id, content }) => api.updateMemory(id, content), onSettled }),
    remove: useMutation({ mutationFn: api.deleteMemory, onSettled }),
    review: useMutation({ mutationFn: ({ id, approve }) => api.reviewMemory(id, approve), onSettled }),
    setEnabled: useMutation({ mutationFn: api.setMemoryEnabled, onSettled }),
  };
}
