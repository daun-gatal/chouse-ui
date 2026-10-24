/**
 * Data hooks for Chobi (ADR 0025 §6): the briefing and the organization's
 * settings. The briefing refreshes every minute while the page is visible.
 */

import { useCallback } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { getBriefing, getChobiSettings, type Briefing, type ChobiSettings } from "@/api/chobi";

export const chobiKeys = {
  all: ["chobi"] as const,
  briefing: () => [...chobiKeys.all, "briefing"] as const,
  settings: () => [...chobiKeys.all, "settings"] as const,
};

const BRIEFING_REFRESH_MS = 60_000;

export function useBriefing(enabled: boolean): UseQueryResult<Briefing> {
  return useQuery({
    queryKey: chobiKeys.briefing(),
    queryFn: () => getBriefing(),
    enabled,
    staleTime: 25_000,
    refetchInterval: BRIEFING_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

/** Reload the briefing now, past the server's short cache. */
export function useRefreshBriefing(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    client.setQueryData(chobiKeys.briefing(), await getBriefing(true));
  }, [client]);
}

export function useChobiSettings(enabled: boolean): UseQueryResult<ChobiSettings> {
  return useQuery({ queryKey: chobiKeys.settings(), queryFn: getChobiSettings, enabled, staleTime: 60_000 });
}
