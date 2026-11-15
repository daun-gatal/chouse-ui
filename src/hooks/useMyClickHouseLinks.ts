/**
 * The signed-in person's ClickHouse links (ADR 0033): which ClickHouse user
 * their statements run as on each personal connection. One request shared by
 * the connection selector and the Preferences card.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getMyBindings, type OwnBinding } from "@/api/clickhouseBindings";
import { useRbacStore } from "@/stores";

const STALE_MS = 60_000;

/** The account id is part of the key, so the next person to sign in never sees the previous one's links. */
export function myClickHouseLinksKey(userId: string | null | undefined): readonly [string, string | null] {
  return ["my-clickhouse-links", userId ?? null];
}

export function useMyClickHouseLinks(): UseQueryResult<OwnBinding[]> {
  const userId = useRbacStore((state) => state.user?.id);
  const isAuthenticated = useRbacStore((state) => state.isAuthenticated);
  return useQuery({
    queryKey: myClickHouseLinksKey(userId),
    queryFn: getMyBindings,
    enabled: isAuthenticated,
    staleTime: STALE_MS,
  });
}

/** The person's link on one connection, or null when they have none there. */
export function linkOnConnection(links: readonly OwnBinding[] | undefined, connectionId: string): OwnBinding | null {
  return links?.find((link) => link.connectionId === connectionId) ?? null;
}
