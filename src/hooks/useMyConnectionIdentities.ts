/**
 * Which ClickHouse identity the signed-in person's statements carry on each
 * connection (ADR 0033), and why they would be refused: the role-ceiling
 * entries of the connection selector read it.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getMyConnectionIdentities, type CallerIdentity } from "@/api/connectionIdentity";
import { useRbacStore } from "@/stores";

const STALE_MS = 60_000;

/** The account id is part of the key, so the next person to sign in never sees the previous one's answer. */
export function myConnectionIdentitiesKey(userId: string | null | undefined): readonly [string, string | null] {
  return ["my-connection-identities", userId ?? null];
}

export function useMyConnectionIdentities(): UseQueryResult<CallerIdentity[]> {
  const userId = useRbacStore((state) => state.user?.id);
  const isAuthenticated = useRbacStore((state) => state.isAuthenticated);
  return useQuery({
    queryKey: myConnectionIdentitiesKey(userId),
    queryFn: getMyConnectionIdentities,
    enabled: isAuthenticated,
    staleTime: STALE_MS,
  });
}

/** The person's identity on one connection, or null when the answer has none for it. */
export function identityOnConnection(identities: readonly CallerIdentity[] | undefined, connectionId: string): CallerIdentity | null {
  return identities?.find((identity) => identity.connectionId === connectionId) ?? null;
}
