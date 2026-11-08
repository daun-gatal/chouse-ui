/**
 * Drop every table CHouse UI keeps in the RBAC database (`rbac:reset`).
 *
 * The list is explicit rather than "every table in the database" because a
 * PostgreSQL RBAC database may be shared with other applications. The
 * migration tests assert it matches what a fresh install creates, so a new
 * table can't be left behind by a reset.
 */
import { sql } from "drizzle-orm";
import { getDatabase, getDatabaseType, type PostgresDb, type SqliteDb } from "./index";

/** Every table a fresh install at the current schema version creates. */
export const RBAC_TABLES: readonly string[] = [
  "_rbac_migrations",
  "_rbac_rate_limits",
  "agent_policies",
  "agent_sessions",
  "agent_tool_calls",
  "ai_action_grants",
  "ai_actions",
  "ai_agents",
  "ai_budgets",
  "ai_chat_runs",
  "ai_checkpoint_writes",
  "ai_checkpoints",
  "ai_eval_cases",
  "ai_eval_runs",
  "ai_feature_bindings",
  "ai_guardrail_events",
  "ai_guardrails",
  "ai_harnesses",
  "ai_memories",
  "ai_memory_settings",
  "ai_registry_revisions",
  "ai_registry_state",
  "ai_skills",
  "ai_triage_rules",
  "ai_triage_runs",
  "ai_usage_egress",
  "ai_usage_requests",
  "ai_usage_steps",
  "alert_events",
  "alert_rule_channels",
  "alert_rules",
  "channel_messages",
  "chat_identities",
  "chat_link_codes",
  "ctx_metrics",
  "ctx_patterns",
  "ctx_table_context",
  "dashboard_alert_channels",
  "dashboard_alert_state",
  "dashboard_alerts",
  "dashboard_notes",
  "dashboard_panels",
  "dashboard_pins",
  "dashboard_report_channels",
  "dashboard_reports",
  "dashboard_shares",
  "dashboard_snapshots",
  "dashboard_versions",
  "dashboards",
  "data_health_incident_events",
  "data_health_incidents",
  "data_health_promise_checks",
  "data_health_promises",
  "data_health_samples",
  "doctor_reports",
  "doctor_schedule",
  "fleet_alert_latches",
  "fleet_alerter_runtime",
  "fleet_snapshots",
  "incident_blast_radius",
  "incident_rca",
  "mcp_token_policies",
  "notebook_cells",
  "notebooks",
  "notification_channels",
  "oauth_clients",
  "oauth_requests",
  "oauth_tokens",
  "obs_capabilities",
  "obs_capacity_forecasts",
  "obs_capacity_samples",
  "obs_catalog_columns",
  "obs_catalog_tables",
  "obs_change_events",
  "obs_codec_trials",
  "obs_collector_status",
  "obs_column_profiles",
  "obs_cost_rates",
  "obs_fingerprint_rollups",
  "obs_incidents",
  "obs_leases",
  "obs_lineage_column_edges",
  "obs_lineage_edges",
  "obs_lineage_nodes",
  "obs_pipeline_samples",
  "obs_pipelines",
  "obs_query_fingerprints",
  "obs_query_shape_days",
  "obs_regressions",
  "obs_settings",
  "obs_suggestion_dismissals",
  "obs_table_baselines",
  "obs_table_samples",
  "obs_table_write_times",
  "obs_usage_rollups",
  "obs_watermarks",
  "rbac_ai_chat_messages",
  "rbac_ai_chat_threads",
  "rbac_ai_configs",
  "rbac_ai_models",
  "rbac_ai_providers",
  "rbac_api_keys",
  "rbac_audit_logs",
  "rbac_clickhouse_connections",
  "rbac_clickhouse_role_state",
  "rbac_config_generation",
  "rbac_data_access_policies",
  "rbac_data_access_policy_rules",
  "rbac_permissions",
  "rbac_query_history",
  "rbac_resource_permissions",
  "rbac_role_data_access_policies",
  "rbac_role_permissions",
  "rbac_roles",
  "rbac_saml_assertions_seen",
  "rbac_saml_handoff_codes",
  "rbac_saml_request_ids",
  "rbac_saved_queries",
  "rbac_sessions",
  "rbac_sso_providers",
  "rbac_sso_settings",
  "rbac_user_favorites",
  "rbac_user_identities",
  "rbac_user_preferences",
  "rbac_user_recent_items",
  "rbac_user_roles",
  "rbac_users",
  "remediation_actions",
  "remediation_approvals",
  "remediation_credentials",
  "remediation_executions",
  "replay_results",
  "replay_runs",
  "scheduled_queries",
  "scheduled_query_channels",
  "scheduled_query_outbox",
  "scheduled_query_runs",
  "upgrade_assessments",
  "upgrade_findings",
];

/**
 * Tables older versions created and a later migration renamed or dropped. An
 * install that failed part-way through an upgrade can still have them.
 */
export const LEGACY_RBAC_TABLES: readonly string[] = [
  "fleet_alert_config",
  "fleet_poller_lease",
  "rbac_clickhouse_users_metadata",
  "rbac_data_access_rules",
  "rbac_refresh_tokens",
  "rbac_saved_queries_new",
  "rbac_user_connections",
  "rbac_user_favorites_new",
  "rbac_user_recent_items_new",
];

export interface ResetResult {
  dropped: string[];
  failed: Array<{ table: string; err: string }>;
}

/** Drop every CHouse UI table (and legacy leftovers) that exists. Never touches other tables. */
export async function dropRbacTables(): Promise<ResetResult> {
  const result: ResetResult = { dropped: [], failed: [] };
  const tables = [...RBAC_TABLES, ...LEGACY_RBAC_TABLES];

  if (getDatabaseType() === "sqlite") {
    const db = getDatabase() as SqliteDb;
    // Foreign keys would make the order matter; the previous setting is restored after.
    const before = db.all(sql.raw("PRAGMA foreign_keys")) as Array<{ foreign_keys?: number }>;
    const wasOn = before[0]?.foreign_keys === 1;
    db.run(sql.raw("PRAGMA foreign_keys = OFF"));
    try {
      for (const table of tables) {
        try {
          db.run(sql.raw(`DROP TABLE IF EXISTS "${table}"`));
          result.dropped.push(table);
        } catch (error) {
          result.failed.push({ table, err: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      if (wasOn) db.run(sql.raw("PRAGMA foreign_keys = ON"));
    }
    return result;
  }

  const db = getDatabase() as PostgresDb;
  for (const table of tables) {
    try {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`));
      result.dropped.push(table);
    } catch (error) {
      result.failed.push({ table, err: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
