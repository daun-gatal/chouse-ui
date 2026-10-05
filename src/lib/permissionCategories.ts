/**
 * Display categories for RBAC permissions.
 *
 * The server is the source of truth (`rbac_permissions.category`, seeded from
 * packages/server/src/rbac/services/seed.ts). This mirror is the fallback used
 * before that list loads and for permissions a role holds that the server no
 * longer lists; keep the names identical so both paths group the same way.
 */

export const OTHER_PERMISSION_CATEGORY = "Other";

const CATEGORY_BY_PREFIX: Record<string, string> = {
  users: "User Management",
  roles: "Role Management",
  data_access: "Data Access Policies",
  "clickhouse:users": "ClickHouse Users",
  "clickhouse:roles": "ClickHouse Roles",
  database: "Database Operations",
  table: "Table Operations",
  query: "Query Operations",
  saved_queries: "Saved Queries",
  metrics: "Metrics & Monitoring",
  logs: "Metrics & Monitoring",
  parts: "Metrics & Monitoring",
  schema_advisor: "Metrics & Monitoring",
  cluster: "Metrics & Monitoring",
  errors: "Metrics & Monitoring",
  fleet: "Fleet Monitoring",
  doctor: "Fleet Monitoring",
  settings: "Settings",
  audit: "Audit",
  live_queries: "Live Query Management",
  connections: "Connection Management",
  ai: "AI Assistant",
  ai_models: "AI Models Management",
  ai_agents: "AI Agents",
  sso: "SSO Management",
  alerting: "Alerting",
  scheduled_queries: "Scheduled Queries",
  data_health: "Data Health",
  observe: "Data Observability",
  context: "Data Observability",
  schema: "Data Observability",
  notebooks: "Data Observability",
  performance: "Performance & Capacity",
  capacity: "Performance & Capacity",
  cost: "Performance & Capacity",
  upgrades: "Performance & Capacity",
  remediation: "Remediation",
  agents: "Agents",
  mcp: "Agents",
};

/** Fallback category for a permission name, by its longest known prefix. */
export function permissionCategory(permission: string): string {
  const parts = permission.split(":");
  for (let i = parts.length - 1; i > 0; i--) {
    const category = CATEGORY_BY_PREFIX[parts.slice(0, i).join(":")];
    if (category) return category;
  }
  return OTHER_PERMISSION_CATEGORY;
}

/**
 * Group permission names by category, preferring the server's category
 * (`serverCategories`: permission name -> category) over the local mirror.
 */
export function groupPermissionsByCategory(
  permissions: readonly string[],
  serverCategories?: ReadonlyMap<string, string>,
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const permission of permissions) {
    const category = serverCategories?.get(permission) ?? permissionCategory(permission);
    (grouped[category] ??= []).push(permission);
  }
  return grouped;
}
