/**
 * useChReconnect
 *
 * The ClickHouse management pages act on the connection the client names
 * (X-Connection-Id). Since ADR 0010 the server holds no session for it — the
 * connection is resolved and authorised from the database on every request — so
 * a backend restart no longer invalidates anything.
 *
 * What can still fail: the stored connection id no longer resolves (the
 * connection was deleted, deactivated, or the user's access to it was revoked),
 * which the server reports as CONNECTION_CONTEXT_STALE rather than silently
 * answering from a different connection.
 *
 * This hook re-activates the last-used connection, which re-validates it and
 * refreshes the client's stored connection id — the real recovery.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { activateConnection } from "@/lib/activateConnection";
import { useAuthStore } from "@/stores";
import { ApiError } from "@/api/client";
import { log } from "@/lib/log";

/**
 * True when the request failed because its ClickHouse connection context is
 * gone: the legacy NO_SESSION, or ADR 0010's CONNECTION_CONTEXT_STALE, which the
 * API client throws once its own retry can't recover.
 */
export function isNoSessionError(error: unknown): boolean {
  if (error instanceof ApiError && (error.code === "NO_SESSION" || error.code === "CONNECTION_CONTEXT_STALE")) return true;
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
