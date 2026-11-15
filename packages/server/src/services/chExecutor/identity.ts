/**
 * The ClickHouse identity of a request (ADR 0033 §5, §6): which role, if any,
 * the executor names on it. On a `shared` connection there is none: the stored
 * login holds every grant. On a `shared_ceiling` connection the login holds
 * nothing itself; a person's request names the ClickHouse role mapped to their
 * CHouse role, and CHouse's own work names the system role. A request that
 * cannot be given its role is refused here and never sent.
 */

import { all, sql, str, strOrNull } from "../observe/db";
import { AppError } from "../../types";
import type { Actor } from "./types";

/** The kinds this build knows. Any other stored value makes the connection refuse. */
export const IDENTITY_MODES = ["shared", "shared_ceiling", "personal"] as const;
export type IdentityMode = (typeof IDENTITY_MODES)[number];

/** A verdict older than this counts as failing, so a stopped checker fails closed. */
export const VERDICT_MAX_AGE_MS = 15 * 60_000;

/** What the executor needs to know about a connection to give a request its identity. A snapshot of the connection row. */
export interface ConnectionIdentity {
  connectionId: string;
  mode: string;
  systemRole: string | null;
  health: string | null;
  healthReason: string | null;
  checkedAt: number | null;
  accessContact: string | null;
  /** On a `personal` connection: the role that holds the IMPERSONATE grants. */
  impersonationRole: string | null;
}

interface IdentitySource {
  impersonationRole?: string | null;
  id: string;
  identityMode?: string | null;
  systemRole?: string | null;
  identityHealth?: string | null;
  identityHealthReason?: string | null;
  identityCheckedAt?: number | null;
  accessContact?: string | null;
}

/**
 * The identity snapshot of a connection row. The column is NOT NULL with the
 * default `shared`, so a row always has a kind; an object built without one
 * (a test fixture, a login under test) is a `shared` login.
 */
export function identityOfConnection(connection: IdentitySource): ConnectionIdentity {
  return {
    connectionId: connection.id,
    mode: connection.identityMode ?? "shared",
    systemRole: connection.systemRole ?? null,
    health: connection.identityHealth ?? null,
    healthReason: connection.identityHealthReason ?? null,
    checkedAt: connection.identityCheckedAt ?? null,
    accessContact: connection.accessContact ?? null,
    impersonationRole: connection.impersonationRole ?? null,
  };
}

export function isKnownMode(mode: string): mode is IdentityMode {
  return (IDENTITY_MODES as readonly string[]).includes(mode);
}

/** A ClickHouse role name CHouse will put on a request: letters, digits and underscores. */
export function isRoleName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
}

function withContact(message: string, identity: ConnectionIdentity): string {
  return identity.accessContact ? `${message} For access, ask: ${identity.accessContact}` : message;
}

/** The connection cannot be used right now, for anyone. */
export function connectionUnavailable(message: string, identity: ConnectionIdentity): AppError {
  return new AppError(withContact(message, identity), "CONNECTION_UNAVAILABLE", "connection", 503);
}

/** This account has no usable ClickHouse identity on the connection. */
export function identityUnavailable(message: string, identity: ConnectionIdentity): AppError {
  return new AppError(withContact(message, identity), "IDENTITY_UNAVAILABLE", "permission", 403);
}

/**
 * Why a connection that is not `shared` refuses, or null when it is ready. It
 * refuses on a failing verdict, on no verdict, and on one older than
 * `VERDICT_MAX_AGE_MS`.
 */
export function healthRefusal(identity: ConnectionIdentity, now: number): AppError | null {
  if (identity.health === "failing") {
    // The stored reason can name grants, roles and other connections; it is for the super admin, in Admin › Connections.
    return connectionUnavailable("This connection is not available: its ClickHouse login failed CHouse's checks. A super admin can see why in Admin › Connections.", identity);
  }
  if (identity.health !== "ok" || identity.checkedAt === null) {
    return connectionUnavailable("This connection is not available: its ClickHouse login has not been checked yet.", identity);
  }
  if (now - identity.checkedAt > VERDICT_MAX_AGE_MS) {
    return connectionUnavailable("This connection is not available: its ClickHouse login was last checked more than 15 minutes ago.", identity);
  }
  return null;
}

/**
 * The ClickHouse role mapped to an account's CHouse role on a connection.
 * Read from the database on every request, so a removed role or mapping stops
 * on the next one. An account must hold exactly one role, and that role must
 * be mapped: with two roles the ceiling would be ambiguous.
 */
export async function mappedRole(identity: ConnectionIdentity, accountId: string): Promise<string> {
  const roles = await all(sql`
    SELECT ur.role_id AS role_id, m.clickhouse_role AS clickhouse_role
    FROM rbac_user_roles ur
    LEFT JOIN rbac_connection_role_map m ON m.role_id = ur.role_id AND m.connection_id = ${identity.connectionId}
    WHERE ur.user_id = ${accountId}`);
  if (roles.length === 0) {
    throw identityUnavailable("Your account has no role, so it has no ClickHouse role on this connection.", identity);
  }
  if (roles.length > 1) {
    throw identityUnavailable("Your account holds more than one role. This connection needs exactly one, because it decides your ClickHouse role.", identity);
  }
  const role = strOrNull(roles[0].clickhouse_role);
  if (!role || !isRoleName(role)) {
    throw identityUnavailable("Your role has no ClickHouse role on this connection yet. A super admin maps it in Admin › Connections.", identity);
  }
  return str(role);
}

/** A ClickHouse user name CHouse will write after `EXECUTE AS`: letters, digits and underscores (ADR 0033 §7.2). */
export function isBindableUserName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
}

/** The ClickHouse user an account's statements run as on a `personal` connection. */
export interface BoundUser {
  user: string;
  /** The database that user's unqualified names resolve against. */
  defaultDatabase: string | null;
}

/**
 * The active binding of an account on a personal connection. Read from the
 * database on every request, so a binding that was suspended, disabled or
 * removed stops on the next one. Anything but an active binding is a refusal
 * that says which state it is in.
 */
export async function boundUser(identity: ConnectionIdentity, accountId: string): Promise<BoundUser> {
  const rows = await all(sql`
    SELECT clickhouse_user, default_database, state FROM rbac_clickhouse_bindings
    WHERE user_id = ${accountId} AND connection_id = ${identity.connectionId}`);
  if (rows.length === 0) {
    throw identityUnavailable("Your account is not linked to a ClickHouse user on this connection. A super admin links it in Admin › Connections.", identity);
  }
  const state = str(rows[0].state);
  const user = strOrNull(rows[0].clickhouse_user);
  if (state === "pending_grant") throw identityUnavailable("Your link to a ClickHouse user on this connection is waiting for a ClickHouse administrator to allow it.", identity);
  if (state === "suspended") throw identityUnavailable("Your link to a ClickHouse user on this connection is suspended, because how your account signs in was changed. A super admin confirms it again in Admin › Connections.", identity);
  if (state !== "active") throw identityUnavailable("Your link to a ClickHouse user on this connection is disabled. A super admin replaces it in Admin › Connections.", identity);
  if (!isBindableUserName(user)) throw identityUnavailable("Your link on this connection names a ClickHouse user CHouse cannot run as.", identity);
  return { user, defaultDatabase: strOrNull(rows[0].default_database) };
}

/** What the executor puts on a request: a role to name, and on a personal connection the user to run as. */
export interface RequestIdentity {
  role?: string;
  /** Set for a person on a `personal` connection: the statement is sent as `EXECUTE AS <user> …`. */
  executeAs?: BoundUser;
}

/**
 * The identity of a request, or the refusal when it must not be sent.
 *   shared          no role
 *   shared_ceiling  a person: the role mapped to their CHouse role; CHouse's own work: the system role
 *   personal        a person: the impersonation role, and the statement runs as their bound user;
 *                   CHouse's own work: the system role
 */
export async function requestIdentity(identity: ConnectionIdentity | undefined, actor: Actor, now: number = Date.now()): Promise<RequestIdentity> {
  if (!identity || identity.mode === "shared") return {};
  if (!isKnownMode(identity.mode)) {
    throw connectionUnavailable(`This connection is not available: this version of CHouse does not know its kind (${identity.mode.slice(0, 40)}).`, identity);
  }
  const refusal = healthRefusal(identity, now);
  if (refusal) throw refusal;
  if (actor.kind === "service") {
    if (!isRoleName(identity.systemRole)) throw connectionUnavailable("This connection is not available: it has no system role.", identity);
    return { role: identity.systemRole };
  }
  if (identity.mode === "personal") {
    if (!isRoleName(identity.impersonationRole)) throw connectionUnavailable("This connection is not available: it has no impersonation role.", identity);
    return { role: identity.impersonationRole, executeAs: await boundUser(identity, actor.accountId) };
  }
  return { role: await mappedRole(identity, actor.accountId) };
}

/** The role to name on a request, or undefined for none. Throws the refusal when the request must not be sent. */
export async function requestRole(identity: ConnectionIdentity | undefined, actor: Actor, now: number = Date.now()): Promise<string | undefined> {
  return (await requestIdentity(identity, actor, now)).role;
}

/**
 * What a result cache must key on besides the statement, so an entry made
 * under one identity is never read under another (after a switch, or for a
 * person with a different role).
 */
export async function identityCacheKey(identity: ConnectionIdentity | undefined, actor: Actor): Promise<string> {
  if (!identity || identity.mode === "shared") return "shared";
  const resolved = await requestIdentity(identity, actor);
  // On a personal connection the rows depend on the person's own ClickHouse user, not on the role.
  return `${identity.mode}:${resolved.executeAs ? `user:${resolved.executeAs.user}` : resolved.role ?? ""}`;
}
