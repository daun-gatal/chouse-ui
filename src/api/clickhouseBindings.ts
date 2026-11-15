/**
 * Links between CHouse accounts and ClickHouse users (ADR 0033). Mirrors
 * packages/server/src/rbac/routes/clickhouseBindings.ts, where a link is
 * called a binding.
 *
 * On a personal connection a person's statements run as the ClickHouse user
 * their account is linked to. Anyone reads and rechecks their own links; only
 * a super admin creates, confirms and removes them.
 */

import type { KindSupport } from "./connectionIdentity";
import { api } from "./client";

export type BindingState = "pending_grant" | "active" | "suspended" | "disabled";

export const BINDING_STATES: readonly BindingState[] = ["pending_grant", "active", "suspended", "disabled"];

/** A ClickHouse user name the server accepts for a link. `default` is refused separately. */
export const CLICKHOUSE_USER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** What a person sees of their own link. */
export interface OwnBinding {
  id: string;
  connectionId: string;
  connectionName: string | null;
  /** The connection's kind: on any kind but `personal` the link is prepared, not in use. */
  connectionKind: string | null;
  clickhouseUser: string;
  defaultDatabase: string | null;
  state: BindingState;
  reason: string | null;
  /** Unix milliseconds. */
  checkedAt: number | null;
}

/** A link as a super admin sees it, with the account it belongs to. */
export interface AdminBinding extends OwnBinding {
  userId: string;
  accountName: string | null;
  accountEmail: string | null;
  /** Unix milliseconds. */
  createdAt: number | null;
}

export interface UnboundUser {
  user: string;
  /** The REVOKE that stops the connection from acting as this user. */
  revoke: string;
}

export interface BindingReadiness {
  counts: Record<BindingState, number>;
  /** Scheduled queries on the connection whose owner has no active link. */
  jobsWithoutLink: number;
}

export interface ConnectionBindings {
  bindings: AdminBinding[];
  /** GRANT statements for the ClickHouse administrator, one per waiting link. CHouse never runs them. */
  grants: string[];
  /** ClickHouse users the connection may still act as although no link uses them. */
  unbound: UnboundUser[];
  readiness: BindingReadiness;
  /** Whether this connection's server can be a personal connection at all. Absent from servers before 3.18. */
  personalSupport?: KindSupport | null;
  serverVersion?: string | null;
}

export interface CreateBindingInput {
  userId: string;
  clickhouseUser: string;
}

const BASE = "/rbac/clickhouse-bindings";

const STATE_LABELS: Record<BindingState, string> = {
  pending_grant: "Waiting for the grant",
  active: "Active",
  suspended: "Suspended",
  disabled: "Disabled",
};

/** A link's state in plain words. */
export function bindingStateLabel(state: BindingState): string {
  return STATE_LABELS[state];
}

/** "Check again" can change a waiting or an active link; a suspended or disabled one needs a super admin. */
export function canRecheckBinding(state: BindingState): boolean {
  return state === "pending_grant" || state === "active";
}

/** The signed-in person's own links, on every connection. */
export async function getMyBindings(): Promise<OwnBinding[]> {
  const result = await api.get<{ bindings: OwnBinding[] }>(`${BASE}/mine`);
  return result.bindings;
}

/** Checks one link against ClickHouse now. The owner or a super admin. */
export async function recheckBinding<T extends OwnBinding = OwnBinding>(id: string): Promise<T> {
  const result = await api.post<{ binding: T }>(`${BASE}/${encodeURIComponent(id)}/recheck`);
  return result.binding;
}

/** Super admin: a connection's links, the grant script, unbound users and readiness. */
export function getConnectionBindings(connectionId: string): Promise<ConnectionBindings> {
  return api.get<ConnectionBindings>(`${BASE}/connection/${encodeURIComponent(connectionId)}`);
}

/** Super admin: links an account to a ClickHouse user on a connection. */
export async function createBinding(connectionId: string, input: CreateBindingInput): Promise<AdminBinding> {
  const result = await api.post<{ binding: AdminBinding }>(`${BASE}/connection/${encodeURIComponent(connectionId)}`, input);
  return result.binding;
}

/** Super admin: confirms a suspended link again. */
export async function confirmBinding(id: string): Promise<AdminBinding> {
  const result = await api.post<{ binding: AdminBinding }>(`${BASE}/${encodeURIComponent(id)}/confirm`);
  return result.binding;
}

/** Super admin: removes a link. */
export async function removeBinding(id: string): Promise<void> {
  await api.delete<unknown>(`${BASE}/${encodeURIComponent(id)}`);
}
