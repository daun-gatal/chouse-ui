/**
 * Shared ClickHouse connection context middleware (ADR 0010).
 *
 * Five routes (explorer, query, metrics, live-queries, ai-chat) plus upload each
 * carried a near-identical copy of a "hybrid auth" middleware that looked a
 * session id up in a process-local map and, on a miss, quietly fell back to the
 * user's *default* connection. Behind more than one replica that miss is the
 * common case, so users silently received metadata and query results from a
 * different cluster than the one their UI said they were on — with a 200 status
 * and nothing in the logs.
 *
 * This replaces all of them. Resolution order:
 *
 *   1. `X-Connection-Id` — the browser states which connection it is on. The
 *      user's access to it is re-checked against the RBAC database every time.
 *   2. A legacy `X-Session-ID` with no connection id — a pre-upgrade SPA bundle.
 *      Fails closed with 409 CONNECTION_CONTEXT_STALE so the client re-activates
 *      and retries, rather than guessing which connection it meant.
 *   3. Neither — no stated intent to contradict, so the user's default
 *      connection is used (and logged). This keeps JWT-only API consumers
 *      working.
 */
import type { Context, Next } from "hono";
import { optionalRbacMiddleware } from "./dataAccess";
import {
  connectionContextStale,
  getConnectionFacts,
  resolveDefaultConnection,
  resolveRequestedConnection,
} from "../services/connectionResolver";
import { ClickHouseService } from "../services/clickhouse";
import { AppError, type Session } from "../types";

export const CONNECTION_ID_HEADER = "X-Connection-Id";
export const CONNECTION_ID_COOKIE = "ch_connection";
export const SESSION_ID_HEADER = "X-Session-ID";
export const SESSION_ID_COOKIE = "ch_session";

export type ConnectionContextVariables = {
  sessionId?: string;
  service: ClickHouseService;
  session?: Session;
  rbacUserId?: string;
  rbacRoles?: string[];
  rbacPermissions?: string[];
  isRbacAdmin?: boolean;
  rbacConnectionId?: string;
};

export function getCookie(c: Context, name: string): string | undefined {
  const cookies = c.req.header("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

export async function connectionContextMiddleware(
  c: Context<{ Variables: ConnectionContextVariables }>,
  next: Next
): Promise<void> {
  // Callers that already populated the RBAC context (e.g. to run a permission
  // check before paying for connection resolution) skip a second JWT verify.
  if (!c.get("rbacUserId")) {
    await optionalRbacMiddleware(c, async () => { });
  }

  const rbacUserId = c.get("rbacUserId");
  if (!rbacUserId) {
    throw AppError.unauthorized(
      "RBAC authentication is required. Please login with RBAC credentials."
    );
  }
  const isSuperAdmin = c.get("rbacRoles")?.includes("super_admin") ?? false;

  const requestedConnectionId =
    c.req.header(CONNECTION_ID_HEADER) || getCookie(c, CONNECTION_ID_COOKIE);
  const legacySessionId = c.req.header(SESSION_ID_HEADER) || getCookie(c, SESSION_ID_COOKIE);

  let resolved;
  if (requestedConnectionId) {
    resolved = await resolveRequestedConnection(rbacUserId, isSuperAdmin, requestedConnectionId);
  } else if (legacySessionId) {
    throw connectionContextStale(
      "Your connection session is no longer valid on this server. Reconnecting…"
    );
  } else {
    resolved = await resolveDefaultConnection(rbacUserId, isSuperAdmin);
  }

  const factsForConnection = await getConnectionFacts(
    resolved.service,
    resolved.connectionId,
    rbacUserId
  );

  const session: Session = {
    // No server-side session exists any more; this id is per-request and exists
    // only because downstream handlers log and correlate on it.
    id: `conn_${resolved.connectionId}`,
    connectionConfig: resolved.config,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    isAdmin: factsForConnection.isAdmin,
    permissions: factsForConnection.permissions,
    version: factsForConnection.version,
    rbacConnectionId: resolved.connectionId,
    rbacUserId,
  };

  c.set("sessionId", session.id);
  c.set("service", resolved.service);
  c.set("session", session);
  c.set("rbacConnectionId", resolved.connectionId);

  await next();
}
