/**
 * System tables that show other people's work (ADR 0033 §4). Data access
 * rules leave the `system` database open, because the Logs and Monitoring
 * pages build their SQL in the browser. These two groups are the exception:
 * a typed read of one needs the permission that the matching page asks for.
 */

import { PERMISSIONS } from "../schema/base";

/** Statement and session logs: what other people ran, and its text. */
const STATEMENT_LOGS: ReadonlySet<string> = new Set([
  "query_log",
  "query_thread_log",
  "query_views_log",
  "processes",
  "text_log",
  "session_log",
  "crash_log",
  "asynchronous_insert_log",
  "opentelemetry_span_log",
  // Not logs, but they hold the text of statements other people sent.
  "asynchronous_inserts",
  "query_cache",
  "zookeeper_log",
]);

/** Access tables: who exists in ClickHouse and what they may do. */
const ACCESS_TABLES: ReadonlySet<string> = new Set([
  "users",
  "roles",
  "grants",
  "role_grants",
  "row_policies",
  "quotas",
  "quota_usage",
  "quotas_usage",
  "settings_profiles",
  "settings_profile_elements",
  "user_directories",
  "quota_limits",
  // Any Keeper node, which with replicated access storage includes the stored users.
  "zookeeper",
]);

/**
 * The permission a read of `database.table` needs, or null when it needs none
 * beyond the data access rules. ClickHouse keeps an old log table as
 * `<name>_<n>` after an upgrade changes its columns; those count as the log.
 */
export function systemTablePermission(database: string, table: string): string | null {
  if (database.toLowerCase() !== "system") return null;
  const name = table.toLowerCase();
  const base = name.replace(/_\d+$/, "");
  if (STATEMENT_LOGS.has(name) || STATEMENT_LOGS.has(base)) return PERMISSIONS.QUERY_HISTORY_VIEW_ALL;
  if (ACCESS_TABLES.has(name)) return PERMISSIONS.CH_USERS_VIEW;
  return null;
}

/** The message a person sees when a system table needs a permission they lack. */
export function systemTableRefusal(table: string, permission: string): string {
  return `Reading system.${table} needs the permission '${permission}', because it shows other people's work. Ask an admin.`;
}
