/**
 * TanStack Query hooks for the Scheduled Queries feature. Mutations invalidate
 * the relevant query keys so the Jobs/Runs/Overview tabs stay consistent.
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { rbacUsersApi } from "@/api/rbac";
import {
  createScheduledQuery,
  deleteScheduledQuery,
  getOverview,
  listRuns,
  listScheduledQueries,
  runScheduledQuery,
  updateScheduledQuery,
  type ScheduledQuery,
  type ScheduledQueryInput,
  type SqStatus,
} from "@/api/scheduledQueries";

export const sqKeys = {
  all: ["scheduled-queries"] as const,
  list: () => [...sqKeys.all, "list"] as const,
  overview: (windowDays: number) => [...sqKeys.all, "overview", windowDays] as const,
  runs: (id: string, status?: SqStatus) => [...sqKeys.all, "runs", id, status ?? "all"] as const,
};

export function useScheduledQueries() {
  return useQuery({ queryKey: sqKeys.list(), queryFn: listScheduledQueries });
}

export function useScheduledQueriesOverview(windowDays = 14) {
  return useQuery({ queryKey: sqKeys.overview(windowDays), queryFn: () => getOverview(windowDays) });
}

export function useScheduledQueryRuns(id: string, status?: SqStatus, enabled = true) {
  return useQuery({
    queryKey: sqKeys.runs(id, status),
    queryFn: () => listRuns(id, { limit: 100, status }),
    enabled: enabled && Boolean(id),
  });
}

export function useCreateScheduledQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduledQueryInput) => createScheduledQuery(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sqKeys.all }),
  });
}

export function useUpdateScheduledQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ScheduledQueryInput }) => updateScheduledQuery(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sqKeys.all }),
  });
}

export function useDeleteScheduledQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteScheduledQuery(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sqKeys.all }),
  });
}

export function useRunScheduledQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runScheduledQuery(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sqKeys.all }),
  });
}

export interface OwnerOption {
  id: string;
  name: string;
}

/**
 * Owner (RBAC user) options derived from the jobs the caller can see, mapped to
 * display names. Only fetched when `enabled` (i.e. the user has view_all and so
 * can see jobs across owners). Returns the distinct owners + a name lookup.
 */
export function useJobOwners(jobs: ScheduledQuery[] | undefined, enabled: boolean) {
  const usersQuery = useQuery({
    queryKey: ["rbac-users-list"],
    queryFn: () => rbacUsersApi.list({ limit: 1000, isActive: true }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const byId = new Map<string, string>();
    for (const u of usersQuery.data?.users ?? []) {
      byId.set(u.id, u.displayName || u.username || u.email || u.id);
    }
    const nameOf = (id: string | null): string => (id ? byId.get(id) ?? `user ${id.slice(0, 8)}` : "—");
    const ownerIds = new Set<string>();
    for (const j of jobs ?? []) if (j.createdBy) ownerIds.add(j.createdBy);
    const options: OwnerOption[] = [...ownerIds]
      .map((id) => ({ id, name: nameOf(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { options, nameOf };
  }, [usersQuery.data, jobs]);
}
