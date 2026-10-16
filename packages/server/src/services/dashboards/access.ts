/**
 * Who may do what with a dashboard (ADR 0021 §5). A share reveals the
 * dashboard; it never widens data access — every panel still runs under the
 * viewer's own connection and table access (runner.ts).
 *
 * Context-free so the alert evaluator can apply the same rules to a rule's
 * owner with no request in flight.
 */

import { PERMISSIONS, SYSTEM_ROLES, type Permission } from "../../rbac/schema/base";
import { getUserConnections, listConnections, type ConnectionResponse } from "../../rbac/services/connections";
import type { ShareRecord } from "./store";

export interface Viewer {
  id: string;
  roles: string[];
  permissions: string[];
}

export function isSuperAdmin(viewer: Viewer): boolean {
  return viewer.roles.includes(SYSTEM_ROLES.SUPER_ADMIN);
}

/** Admins bypass data-access rules, as everywhere else (validateQueryAccess). */
export function isAdmin(viewer: Viewer): boolean {
  return isSuperAdmin(viewer) || viewer.roles.includes(SYSTEM_ROLES.ADMIN);
}

export function has(viewer: Viewer, permission: Permission): boolean {
  return isSuperAdmin(viewer) || viewer.permissions.includes(permission);
}

export interface DashboardAccess {
  owner: boolean;
  view: boolean;
  edit: boolean;
  delete: boolean;
  share: boolean;
}

export function dashboardAccess(viewer: Viewer, dashboard: { ownerId: string }, shares: ShareRecord[]): DashboardAccess {
  const owner = dashboard.ownerId === viewer.id;
  const manage = has(viewer, PERMISSIONS.DASHBOARDS_MANAGE);
  const mine = shares.filter((s) => viewer.roles.includes(s.roleName));
  const shared = mine.length > 0;
  const sharedEdit = mine.some((s) => s.canEdit);
  return {
    owner,
    view: has(viewer, PERMISSIONS.DASHBOARDS_VIEW) && (owner || manage || shared),
    edit: has(viewer, PERMISSIONS.DASHBOARDS_EDIT) && (owner || manage || sharedEdit),
    delete: has(viewer, PERMISSIONS.DASHBOARDS_DELETE) && (owner || manage),
    share: has(viewer, PERMISSIONS.DASHBOARDS_SHARE) && (owner || manage),
  };
}

/** Active connections the viewer may run panels on (Super Admin: all of them). */
export async function viewerConnections(viewer: Viewer): Promise<ConnectionResponse[]> {
  if (isSuperAdmin(viewer)) return (await listConnections({ activeOnly: true })).connections;
  return getUserConnections(viewer.id);
}
