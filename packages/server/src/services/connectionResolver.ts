/**
 * Per-request ClickHouse connection resolution (ADR 0010).
 *
 * Replaces the process-local session map. The browser tells us which connection
 * it is working against on every request; we authorise that choice against the
 * RBAC database and build a service for it. Nothing about the answer depends on
 * which replica serves the request.
 *
 * This is cheap because it is not where pooling happens: `ClientManager` already
 * caches real ClickHouse clients keyed by connection config, with idle eviction.
 * Constructing a `ClickHouseService` just wraps that lookup.
 */
import { ClickHouseService } from "./clickhouse";
import { getConnectionWithPassword, getUserConnections } from "../rbac/services/connections";
import { AppError, type ConnectionConfig } from "../types";
import { logger } from "../utils/logger";

/** Facts about a connection that cost a ClickHouse round-trip to learn. */
export interface ConnectionFacts {
  isAdmin: boolean;
  permissions: string[];
  version: string;
}

export interface ResolvedConnection {
  connectionId: string;
  connectionName: string;
  config: ConnectionConfig;
  service: ClickHouseService;
}

/**
 * Thrown when the client named a connection context we cannot honour. The
 * distinct code lets the SPA re-activate its stored connection and retry once,
 * instead of the pre-ADR-0010 behaviour of silently answering from a different
 * cluster.
 */
export function connectionContextStale(message: string): AppError {
  return new AppError(message, "CONNECTION_CONTEXT_STALE", "authentication", 409);
}

/**
 * Derived facts cache. Legitimate pod-local state under ADR 0010: every entry is
 * reconstructible from ClickHouse and expires on its own. Authorisation is NOT
 * cached here — that is re-checked against the database on every request.
 */
const FACTS_TTL_MS = 60_000;
const facts = new Map<string, { value: ConnectionFacts; expiresAt: number }>();

/** Test-only: drop the derived-facts cache. */
export function resetConnectionFactsCache(): void {
  facts.clear();
}

/**
 * Forget a user's cached facts (logout, password change).
 *
 * Not a security boundary — authorisation is re-checked from the database on
 * every request, and these entries expire on their own. This just avoids
 * serving a stale admin flag to the next session on the same replica.
 */
export function dropUserConnectionFacts(rbacUserId: string): void {
  for (const key of facts.keys()) {
    if (key.endsWith(`:${rbacUserId}`)) facts.delete(key);
  }
}

export async function getConnectionFacts(
  service: ClickHouseService,
  connectionId: string,
  rbacUserId: string,
  now: number = Date.now()
): Promise<ConnectionFacts> {
  const key = `${connectionId}:${rbacUserId}`;
  const hit = facts.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const [version, adminStatus] = await Promise.all([
    service.getVersion(),
    service.checkIsAdmin(),
  ]);
  const value: ConnectionFacts = {
    isAdmin: adminStatus.isAdmin,
    permissions: adminStatus.permissions,
    version,
  };
  facts.set(key, { value, expiresAt: now + FACTS_TTL_MS });
  return value;
}

function buildConfig(connection: {
  sslEnabled?: boolean | null;
  host: string;
  port: number;
  username: string;
  password?: string | null;
  database?: string | null;
}): ConnectionConfig {
  const protocol = connection.sslEnabled ? "https" : "http";
  return {
    url: `${protocol}://${connection.host}:${connection.port}`,
    username: connection.username,
    password: connection.password || "",
    database: connection.database || undefined,
  };
}

/**
 * List the connections this user may use. Super admins see every active
 * connection; everyone else sees only what their roles grant.
 */
async function listUsableConnections(
  rbacUserId: string,
  isSuperAdmin: boolean
): Promise<Array<{ id: string; name: string; isActive: boolean; isDefault: boolean }>> {
  if (isSuperAdmin) {
    const { listConnections } = await import("../rbac/services/connections");
    // Deliberately NOT activeOnly: an inactive connection must produce a
    // "this connection is no longer active" answer, not "you have no access to
    // it". Filtering here would make the isActive check below unreachable for
    // super admins and give the two roles different errors for the same state.
    const result = await listConnections({});
    return result.connections;
  }
  return await getUserConnections(rbacUserId);
}

/**
 * Resolve an explicitly requested connection, authorising the user for it.
 *
 * Fails closed: an id the user cannot use, or that is inactive/missing, is an
 * error — never a silent downgrade to some other connection.
 */
export async function resolveRequestedConnection(
  rbacUserId: string,
  isSuperAdmin: boolean,
  connectionId: string
): Promise<ResolvedConnection> {
  const usable = await listUsableConnections(rbacUserId, isSuperAdmin);
  const match = usable.find((candidate) => candidate.id === connectionId);

  if (!match) {
    // Deliberately does not distinguish "no such connection" from "not yours" —
    // that difference would let any authenticated user probe for connection ids.
    throw AppError.forbidden("You do not have access to this ClickHouse connection.");
  }
  if (!match.isActive) {
    throw connectionContextStale("This ClickHouse connection is no longer active. Pick another connection.");
  }

  const connection = await getConnectionWithPassword(connectionId);
  if (!connection) {
    throw connectionContextStale("This ClickHouse connection no longer exists. Pick another connection.");
  }

  const config = buildConfig(connection);
  return {
    connectionId,
    connectionName: match.name,
    config,
    service: new ClickHouseService(config, { rbacUserId }),
  };
}

/**
 * Resolve the user's default connection, for clients that expressed no
 * preference at all (e.g. an API consumer holding only a JWT).
 *
 * This is the ONE surviving fallback, and it is only reachable when the request
 * carried no connection identifier — so there is no user intent for it to
 * contradict. It is logged so operators can see it happening.
 */
export async function resolveDefaultConnection(
  rbacUserId: string,
  isSuperAdmin: boolean
): Promise<ResolvedConnection> {
  const usable = await listUsableConnections(rbacUserId, isSuperAdmin);

  if (usable.length === 0) {
    throw AppError.unauthorized(
      isSuperAdmin
        ? "No ClickHouse connections are configured in the system. Please create a connection first."
        : "No ClickHouse connection configured. Please contact an administrator to grant you access to a ClickHouse connection."
    );
  }

  const chosen =
    usable.find((candidate) => candidate.isDefault && candidate.isActive) ??
    usable.find((candidate) => candidate.isActive);

  if (!chosen) {
    throw AppError.unauthorized(
      isSuperAdmin
        ? "No active ClickHouse connections found. Please activate a connection or create a new one."
        : "No active ClickHouse connection found. Please contact an administrator to activate a connection."
    );
  }

  logger.debug(
    { module: "ConnectionResolver", connectionId: chosen.id },
    "Request carried no connection id — using the user's default connection"
  );
  return await resolveRequestedConnection(rbacUserId, isSuperAdmin, chosen.id);
}
