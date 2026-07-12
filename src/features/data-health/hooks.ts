import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "@/stores";
import {
  acknowledgeDataHealthIncident,
  createDataHealthPromise,
  deleteDataHealthPromise,
  getDataHealthOverview,
  getDataHealthPromise,
  getDataHealthTimeline,
  listDataHealthIncidents,
  listDataHealthPromises,
  runDataHealthPromise,
  snoozeDataHealthIncident,
  updateDataHealthPromise,
  type DataHealthPromiseInput,
} from "@/api/dataHealth";

export const dhKeys = {
  all: ["data-health"] as const,
  overview: (connectionId?: string | null) => [...dhKeys.all, "overview", connectionId ?? "all"] as const,
  promises: (connectionId?: string | null) => [...dhKeys.all, "promises", connectionId ?? "all"] as const,
  promise: (id: string) => [...dhKeys.all, "promise", id] as const,
  timeline: (id: string) => [...dhKeys.all, "timeline", id] as const,
  incidents: (connectionId?: string | null) => [...dhKeys.all, "incidents", connectionId ?? "all"] as const,
};

/**
 * Data Health is scoped to the active connection: every tab shows one cluster's
 * promises and incidents. Promises pinned to other connections keep evaluating
 * in the background and reappear on switch.
 */
export function useDataHealthOverview() {
  const activeConnectionId = useAuthStore((state) => state.activeConnectionId);
  return useQuery({
    queryKey: dhKeys.overview(activeConnectionId),
    queryFn: () => getDataHealthOverview(activeConnectionId ?? undefined),
  });
}

export function useDataHealthPromises() {
  const activeConnectionId = useAuthStore((state) => state.activeConnectionId);
  return useQuery({
    queryKey: dhKeys.promises(activeConnectionId),
    queryFn: () => listDataHealthPromises(activeConnectionId ?? undefined),
  });
}

export function useDataHealthPromise(id: string, enabled = true) {
  return useQuery({ queryKey: dhKeys.promise(id), queryFn: () => getDataHealthPromise(id), enabled: enabled && Boolean(id) });
}

export function useDataHealthTimeline(id: string, enabled = true) {
  return useQuery({ queryKey: dhKeys.timeline(id), queryFn: () => getDataHealthTimeline(id), enabled: enabled && Boolean(id) });
}

export function useDataHealthIncidents() {
  const activeConnectionId = useAuthStore((state) => state.activeConnectionId);
  return useQuery({
    queryKey: dhKeys.incidents(activeConnectionId),
    queryFn: () => listDataHealthIncidents(activeConnectionId ?? undefined),
  });
}

function useInvalidateDataHealth(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: dhKeys.all });
  };
}

export function useCreateDataHealthPromise() {
  const invalidate = useInvalidateDataHealth();
  return useMutation({ mutationFn: createDataHealthPromise, onSuccess: invalidate });
}

export function useUpdateDataHealthPromise() {
  const invalidate = useInvalidateDataHealth();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DataHealthPromiseInput }) => updateDataHealthPromise(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteDataHealthPromise() {
  const invalidate = useInvalidateDataHealth();
  return useMutation({ mutationFn: deleteDataHealthPromise, onSuccess: invalidate });
}

export function useRunDataHealthPromise() {
  const invalidate = useInvalidateDataHealth();
  return useMutation({ mutationFn: runDataHealthPromise, onSuccess: invalidate });
}

export function useAcknowledgeIncident() {
  const invalidate = useInvalidateDataHealth();
  return useMutation({ mutationFn: acknowledgeDataHealthIncident, onSuccess: invalidate });
}

export function useSnoozeIncident() {
  const invalidate = useInvalidateDataHealth();
  return useMutation({
    mutationFn: ({ id, until }: { id: string; until: number }) => snoozeDataHealthIncident(id, until),
    onSuccess: invalidate,
  });
}

