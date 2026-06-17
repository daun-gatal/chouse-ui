/**
 * Navigation access — single source of truth for which RBAC permissions unlock
 * each top-level area and its tabs.
 *
 * The page route guard (AdminRoute), the nav (FloatingDock), the default-landing
 * redirect (DefaultRedirect), and the in-page tab gating (Admin) all derive from
 * these constants. Keeping them in one place prevents the lists from drifting:
 * historically the Admin lists were duplicated and fell out of sync, so a user
 * holding e.g. only `sso:view` or `connections:view` was bounced from /admin even
 * though they had a tab they were allowed to see.
 *
 * Rule: having ANY one of an area's permissions reveals that area (its route, its
 * nav entry) and every tab the user individually qualifies for.
 */

import { RBAC_PERMISSIONS } from "@/stores";

export type AdminTabKey =
  | "users"
  | "roles"
  | "data-access"
  | "connections"
  | "clickhouse-users"
  | "clickhouse-roles"
  | "ai-models"
  | "sso"
  | "audit"
  | "alerting";

/**
 * Permission(s) that reveal each admin tab. A tab is visible if the user has ANY
 * of its permissions. Order here is the canonical tab order.
 */
export const ADMIN_TAB_PERMISSIONS: Record<AdminTabKey, string[]> = {
  users: [RBAC_PERMISSIONS.USERS_VIEW, RBAC_PERMISSIONS.USERS_CREATE],
  roles: [RBAC_PERMISSIONS.ROLES_VIEW],
  "data-access": [RBAC_PERMISSIONS.DATA_ACCESS_VIEW],
  connections: [RBAC_PERMISSIONS.CONNECTIONS_VIEW],
  "clickhouse-users": [RBAC_PERMISSIONS.CH_USERS_VIEW],
  "clickhouse-roles": [RBAC_PERMISSIONS.CH_ROLES_VIEW],
  "ai-models": [RBAC_PERMISSIONS.AI_MODELS_VIEW],
  sso: [RBAC_PERMISSIONS.SSO_VIEW],
  audit: [RBAC_PERMISSIONS.AUDIT_VIEW],
  alerting: [RBAC_PERMISSIONS.ALERTING_VIEW],
};

/**
 * Having ANY of these reveals the Admin page (route + nav entry). Derived from
 * the per-tab map so it can never miss a tab.
 */
export const ADMIN_ACCESS_PERMISSIONS: string[] = Array.from(
  new Set(Object.values(ADMIN_TAB_PERMISSIONS).flat())
);

/** Having ANY of these reveals the Monitoring page (route + nav entry). */
export const MONITORING_ACCESS_PERMISSIONS: string[] = [
  RBAC_PERMISSIONS.LIVE_QUERIES_VIEW,
  RBAC_PERMISSIONS.METRICS_VIEW,
  RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
  RBAC_PERMISSIONS.LOGS_VIEW,
  RBAC_PERMISSIONS.PARTS_VIEW,
  RBAC_PERMISSIONS.SCHEMA_ADVISOR_VIEW,
  RBAC_PERMISSIONS.CLUSTER_VIEW,
  RBAC_PERMISSIONS.ERRORS_VIEW,
];

/** Having ANY of these reveals the Explorer page (route + nav entry). */
export const EXPLORER_ACCESS_PERMISSIONS: string[] = [
  RBAC_PERMISSIONS.DB_VIEW,
  RBAC_PERMISSIONS.TABLE_VIEW,
];
