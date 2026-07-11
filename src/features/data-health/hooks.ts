import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  overview: () => [...dhKeys.all, "overview"] as const,
  promises: () => [...dhKeys.all, "promises"] as const,
  promise: (id: string) => [...dhKeys.all, "promise", id] as const,
  timeline: (id: string) => [...dhKeys.all, "timeline", id] as const,
  incidents: () => [...dhKeys.all, "incidents"] as const,
};

export function useDataHealthOverview() {
  return useQuery({ queryKey: dhKeys.overview(), queryFn: getDataHealthOverview });
}

export function useDataHealthPromises() {
  return useQuery({ queryKey: dhKeys.promises(), queryFn: listDataHealthPromises });
}

export function useDataHealthPromise(id: string, enabled = true) {
  return useQuery({ queryKey: dhKeys.promise(id), queryFn: () => getDataHealthPromise(id), enabled: enabled && Boolean(id) });
}

export function useDataHealthTimeline(id: string, enabled = true) {
  return useQuery({ queryKey: dhKeys.timeline(id), queryFn: () => getDataHealthTimeline(id), enabled: enabled && Boolean(id) });
}

export function useDataHealthIncidents() {
  return useQuery({ queryKey: dhKeys.incidents(), queryFn: listDataHealthIncidents });
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

