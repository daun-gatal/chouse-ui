/**
 * Shared authorization helpers for the ADR 0016 routes.
 *
 * Every observability endpoint enforces three layers: the feature permission
 * (route middleware), access to the ClickHouse connection, and per-table data
 * access policies — evidence about a table (names, lineage, profiles, query
 * text) is only shown to users who may read that table.
 */

import type { Context } from "hono";

import { getRbacUser } from "../../rbac/middleware/rbacAuth";
import { PERMISSIONS, SYSTEM_ROLES } from "../../rbac/schema/base";
import { getUserConnections } from "../../rbac/services/connections";
import { evaluateRules, getRulesForUser } from "../../rbac/services/dataAccess";
import type { Actor } from "../../services/remediation/executor";
import { AppError } from "../../types";

export function actor(c: Context): Actor {
  const user = getRbacUser(c);
  return { id: user.sub, roles: user.roles, permissions: user.permissions };
}

export function isAdmin(c: Context): boolean {
  const user = getRbacUser(c);
  return user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN) || user.roles.includes(SYSTEM_ROLES.ADMIN);
}

export function hasPermission(c: Context, permission: string): boolean {
  const user = getRbacUser(c);
  return user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN) || user.permissions.includes(permission);
}

export function requireConnectionParam(c: Context): string {
  const id = c.req.query("connectionId") ?? c.req.header("X-Connection-Id");
  if (!id) throw AppError.badRequest("connectionId is required");
  return id;
}

export async function assertConnectionAccess(c: Context, connectionId: string): Promise<void> {
  const user = getRbacUser(c);
  if (user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN)) return;
  const connections = await getUserConnections(user.sub);
  if (!connections.some((connection) => connection.id === connectionId)) {
    throw AppError.forbidden("You do not have access to this connection");
  }
}

export type TablePredicate = (database: string | null | undefined, table: string | null | undefined) => boolean;

/** A synchronous per-table access predicate for this user and connection. */
export async function tableAccess(c: Context, connectionId: string): Promise<TablePredicate> {
  if (isAdmin(c)) return () => true;
  const rules = await getRulesForUser(getRbacUser(c).sub, connectionId);
  return (database, table) => {
    if (!database) return true;
    if (["system", "information_schema", "INFORMATION_SCHEMA"].includes(database)) return false;
    return evaluateRules(rules, database, table ?? null).allowed;
  };
}

/** Lineage node ids are `table:db.table`; non-table nodes carry no table data. */
export function nodeAllowed(allowed: TablePredicate, nodeId: string): boolean {
  if (!nodeId.startsWith("table:")) return true;
  const fq = nodeId.slice("table:".length);
  const dot = fq.indexOf(".");
  return allowed(fq.slice(0, dot), fq.slice(dot + 1));
}

/** Other people's query text is shown only to users who may see all query history. */
export function canSeeAllQueryText(c: Context): boolean {
  return isAdmin(c) || hasPermission(c, PERMISSIONS.QUERY_HISTORY_VIEW_ALL);
}

export async function scopedConnection(c: Context): Promise<{ connectionId: string; allowed: TablePredicate }> {
  const connectionId = requireConnectionParam(c);
  await assertConnectionAccess(c, connectionId);
  return { connectionId, allowed: await tableAccess(c, connectionId) };
}
