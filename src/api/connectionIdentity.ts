/**
 * Connection kinds and the role ceiling (ADR 0033), super admin only. Mirrors
 * packages/server/src/rbac/routes/connectionIdentity.ts.
 *
 * A connection's kind says how its statements reach ClickHouse: `shared` (one
 * login holding every grant), `shared_ceiling` (a login with no grants, and
 * each statement names the ClickHouse role mapped to the person's CHouse role)
 * or `personal` (a login with no grants, and each statement runs as the
 * ClickHouse user linked to the person's account).
 */

import { api, ApiError } from "./client";
import type { ConnectionPrivilegeReport } from "./rbac";

export const IDENTITY_MODE_SHARED = "shared";
export const IDENTITY_MODE_CEILING = "shared_ceiling";
export const IDENTITY_MODE_PERSONAL = "personal";

export type KnownIdentityMode = typeof IDENTITY_MODE_SHARED | typeof IDENTITY_MODE_CEILING | typeof IDENTITY_MODE_PERSONAL;
export type IdentityKind = KnownIdentityMode | "unknown";

/** A ClickHouse role name the server accepts in the role map. */
export const CLICKHOUSE_ROLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export const ACCESS_CONTACT_MAX = 500;

/**
 * The kind this build knows a stored mode as. A connection saved before kinds
 * existed carries none and is a shared login; any other string is `unknown`.
 */
export function identityKind(mode: string | null | undefined): IdentityKind {
  if (mode === undefined || mode === null || mode === IDENTITY_MODE_SHARED) return IDENTITY_MODE_SHARED;
  if (mode === IDENTITY_MODE_CEILING) return IDENTITY_MODE_CEILING;
  return mode === IDENTITY_MODE_PERSONAL ? IDENTITY_MODE_PERSONAL : "unknown";
}

/** The kind in plain words. */
export function identityKindLabel(mode: string | null | undefined): string {
  const kind = identityKind(mode);
  if (kind === IDENTITY_MODE_SHARED) return "Shared login";
  if (kind === IDENTITY_MODE_CEILING) return "Role ceiling";
  return kind === IDENTITY_MODE_PERSONAL ? "Personal" : "Unknown kind";
}

export type IdentityHealth = "ok" | "failing" | null;

export interface RoleMapEntry {
  roleId: string;
  roleName: string;
  clickhouseRole: string;
}

export interface RoleMapInput {
  roleId: string;
  clickhouseRole: string;
}

export interface ConnectionIdentity {
  identityMode: string;
  username: string;
  systemRole: string | null;
  /** The ClickHouse role that lets the login run statements as linked users; null unless the kind is `personal`. */
  impersonationRole: string | null;
  accessContact: string | null;
  health: IdentityHealth;
  healthReason: string | null;
  /** Unix milliseconds. */
  checkedAt: number | null;
  serverVersion: string | null;
  roleMap: RoleMapEntry[];
}

export type KindSupportState = "available" | "unavailable" | "unknown";

/** Whether a connection's ClickHouse server can run one kind, found out by asking the server. */
export interface KindSupport {
  /** `shared`, `shared_ceiling` or `personal`. */
  kind: string;
  state: KindSupportState;
  /** One sentence: why the kind is or is not available on this server. */
  reason: string;
}

export interface ServerSupport {
  /** Null when the server did not answer. */
  serverVersion: string | null;
  kinds: KindSupport[];
}

/** The support of one kind, or null when the server's answer has none for it. */
export function kindSupport(support: ServerSupport | null | undefined, kind: string): KindSupport | null {
  return support?.kinds.find((entry) => entry.kind === kind) ?? null;
}

export interface ConnectionIdentityDetail extends ConnectionIdentity {
  /** Which kinds this connection's server can run. Absent from servers before 3.18. */
  support?: ServerSupport;
  /** SQL for the ClickHouse administrator. CHouse never runs these. */
  setupStatements: string[];
  /** The same, for a personal login. */
  personalSetupStatements: string[];
}

export interface IdentityChange {
  identityMode: string;
  username: string;
  /** May be left out only when the username is unchanged: the stored one is kept. */
  password?: string;
  systemRole?: string | null;
  /** Required when the kind is `personal`; must differ from the system role. */
  impersonationRole?: string | null;
  accessContact?: string | null;
  host?: string;
  port?: number;
  sslEnabled?: boolean;
}

export type IdentityCheckId =
  | "version"
  | "empty_login"
  | "roles"
  | "bare_reads"
  | "system_role"
  | "login_reuse"
  | "remediation_login"
  | "impersonation_role"
  | "impersonation"
  | "create_checked"
  | "format"
  | "no_nesting";

export interface IdentityCheck {
  id: IdentityCheckId;
  label: string;
  ok: boolean;
  detail: string;
}

export interface IdentityVerdict {
  ok: boolean;
  reason: string | null;
  checks: IdentityCheck[];
  serverVersion: string | null;
  /** On a personal login: the ClickHouse users the impersonation role may act as. */
  impersonationTargets?: string[];
}

export interface IdentityCheckResult {
  ok: boolean;
  verdict: IdentityVerdict;
  privileges?: ConnectionPrivilegeReport;
  reason: string | null;
  /** True when the server itself cannot run the kind: no login would pass. */
  unsupported?: boolean;
  support?: ServerSupport;
}

export interface IdentitySwitchResult {
  identity: ConnectionIdentity;
  check: IdentityCheckResult;
}

export interface IdentityRecheckResult {
  /** null when the kind has nothing to check. */
  verdict: IdentityVerdict | null;
  identity: ConnectionIdentity;
}

function base(connectionId: string): string {
  return `/rbac/connections/${encodeURIComponent(connectionId)}/identity`;
}

export function getConnectionIdentity(connectionId: string): Promise<ConnectionIdentityDetail> {
  return api.get<ConnectionIdentityDetail>(base(connectionId));
}

/** Runs the checks against the login in `change`. Saves nothing. */
export function checkConnectionIdentity(connectionId: string, change: IdentityChange): Promise<IdentityCheckResult> {
  return api.post<IdentityCheckResult>(`${base(connectionId)}/check`, change);
}

/**
 * Stores kind, login and role names in one write. When the checks fail the
 * server answers 422 `IDENTITY_CHECK_FAILED`; read the result off the thrown
 * error with `identityCheckFromError`.
 */
export function switchConnectionIdentity(connectionId: string, change: IdentityChange): Promise<IdentitySwitchResult> {
  return api.put<IdentitySwitchResult>(base(connectionId), change);
}

export function setConnectionAccessContact(connectionId: string, accessContact: string | null): Promise<ConnectionIdentity> {
  return api.put<ConnectionIdentity>(`${base(connectionId)}/contact`, { accessContact });
}

export async function getConnectionRoleMap(connectionId: string): Promise<RoleMapEntry[]> {
  const result = await api.get<{ entries: RoleMapEntry[] }>(`${base(connectionId)}/role-map`);
  return result.entries;
}

/** Replaces the whole map: a role left out is no longer mapped. */
export async function setConnectionRoleMap(connectionId: string, entries: RoleMapInput[]): Promise<RoleMapEntry[]> {
  const result = await api.put<{ entries: RoleMapEntry[] }>(`${base(connectionId)}/role-map`, { entries });
  return result.entries;
}

/** Runs the stored login's checks now and stores the outcome. */
export function recheckConnectionIdentity(connectionId: string): Promise<IdentityRecheckResult> {
  return api.post<IdentityRecheckResult>(`${base(connectionId)}/recheck`);
}

function isIdentityCheckResult(value: unknown): value is IdentityCheckResult {
  if (typeof value !== "object" || value === null) return false;
  if (!("ok" in value) || typeof value.ok !== "boolean") return false;
  if (!("verdict" in value) || typeof value.verdict !== "object" || value.verdict === null) return false;
  return "checks" in value.verdict && Array.isArray(value.verdict.checks);
}

/**
 * The checks a refused switch carries, if this error is one: `IDENTITY_CHECK_FAILED`
 * when the login did not pass, `KIND_UNSUPPORTED_ON_SERVER` when the server cannot
 * run the kind at all. The error's message is the one-line reason.
 */
export function identityCheckFromError(error: unknown): IdentityCheckResult | null {
  if (!(error instanceof ApiError) || (error.code !== "IDENTITY_CHECK_FAILED" && error.code !== "KIND_UNSUPPORTED_ON_SERVER")) return null;
  return isIdentityCheckResult(error.details) ? error.details : null;
}
