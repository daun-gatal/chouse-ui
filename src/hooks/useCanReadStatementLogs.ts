/**
 * Whether the signed-in person may read the ClickHouse tables that show other
 * people's statements (system.query_log, system.processes, system.crash_log and
 * the rest of that family).
 *
 * The server refuses a statement that reads one of them unless the caller is an
 * admin or super admin, or holds `query:history:view:all`. The store's
 * `hasPermission` only short-circuits for super admins, so the admin role is
 * checked here as well. Callers use this to skip the statement and show
 * `StatementLogsNotice` instead of sending something that will be refused.
 */

import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";

export function useCanReadStatementLogs(): boolean {
  const { isAdmin, hasPermission } = useRbacStore();
  return isAdmin() || hasPermission(RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL);
}
