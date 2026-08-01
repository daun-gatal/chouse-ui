/**
 * useChReconnect
 *
 * The ClickHouse management pages talk to the active ClickHouse session
 * (X-Session-ID). That session lives in server memory, so it's lost whenever the
 * backend restarts or the session expires — after which every request fails with
 * "ClickHouse session not found. Please reconnect." (code NO_SESSION). The stored
 * session id on the client is now stale, so simply re-fetching (the refresh
 * button) keeps failing.
 *
 * This hook re-activates the last-used connection, which mints a fresh server
 * session and updates the client's X-Session-ID — the real recovery.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { activateConnection } from "@/lib/activateConnection";
import { useAuthStore } from "@/stores";
import { ApiError } from "@/api/client";
import { log } from "@/lib/log";

/** True when an error is the "no active ClickHouse session" condition. */
export function isNoSessionError(error: unknown): boolean {
  if (error instanceof ApiError && error.code === "NO_SESSION") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /no active clickhouse session|session not found|please reconnect/i.test(message);
}

export function useChReconnect() {
  const queryClient = useQueryClient();

  /** Attempt to re-establish the ClickHouse session. Returns true on success. */
  return useCallback(async (): Promise<boolean> => {
    const connectionId = useAuthStore.getState().activeConnectionId;
    if (!connectionId) return false;
    try {
      await activateConnection({ connectionId, queryClient });
      return true;
    } catch (error) {
      log.error("[CH management] auto-reconnect failed", error);
      return false;
    }
  }, [queryClient]);
}
