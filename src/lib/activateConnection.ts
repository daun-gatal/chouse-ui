/**
 * activateConnection — switch the app's active ClickHouse connection.
 *
 * The single "open this connection" routine. It does the full switch, not just
 * a partial one:
 *   1. connect (mint a server session for the node)
 *   2. point the API client's session at it — WITHOUT this, queries keep the
 *      previous X-Session-ID header and the connection appears unchanged
 *   3. update the auth store (UI state)
 *   4. persist the choice (localStorage + DB preference) so it survives reloads
 *   5. invalidate cached data so the workspace/monitoring shows the new node
 *   6. broadcast `clickhouse:connected` for any listeners
 *
 * Used by the ConnectionSelector dropdown AND the Fleet "open" / "investigate"
 * actions so every entry point switches identically.
 */

import type { QueryClient } from "@tanstack/react-query";

import { rbacConnectionsApi, type ConnectResult } from "@/api/rbac";
import { rbacUserPreferencesApi } from "@/api";
import { setSessionId } from "@/api/client";
import { useAuthStore } from "@/stores";
import { log } from "@/lib/log";

const SELECTED_CONNECTION_KEY = "clickhouse_selected_connection_id";

async function persistConnectionId(id: string): Promise<void> {
  try {
    localStorage.setItem(SELECTED_CONNECTION_KEY, id);
  } catch {
    /* ignore storage errors */
  }
  try {
    const prefs = await rbacUserPreferencesApi.getPreferences();
    await rbacUserPreferencesApi.updatePreferences({
      workspacePreferences: { ...prefs.workspacePreferences, lastConnectionId: id },
    });
  } catch (error) {
    log.error("[activateConnection] Failed to persist connection preference", error);
  }
}

export async function activateConnection(opts: {
  connectionId: string;
  connectionName?: string;
  queryClient: QueryClient;
}): Promise<ConnectResult> {
  const result = await rbacConnectionsApi.connect(opts.connectionId);
  if (!result?.sessionId) {
    throw new Error("Failed to open connection");
  }

  // Critical: route the API client (and thus every ClickHouse query) at the
  // new node. Updating only the auth store leaves queries on the old session.
  setSessionId(result.sessionId);

  useAuthStore.getState().setConnectionInfo({
    sessionId: result.sessionId,
    username: result.username,
    url: `${result.host}:${result.port}`,
    version: result.version,
    isAdmin: result.isAdmin,
    permissions: result.permissions,
    activeConnectionId: opts.connectionId,
    activeConnectionName: result.connectionName ?? opts.connectionName,
  });

  await persistConnectionId(opts.connectionId);

  // Blanket invalidation: every cached result belongs to the previous node, so
  // mark them all stale. Active queries refetch now; the page we navigate to
  // refetches on mount — no manual reload needed. (Not awaited so navigation
  // isn't blocked on the in-flight refetches.)
  void opts.queryClient.invalidateQueries();

  window.dispatchEvent(new CustomEvent("clickhouse:connected", { detail: result }));
  return result;
}
