/**
 * Migration tests — runs against BOTH SQLite and PostgreSQL (Docker required).
 *
 * Coverage (MANDATORY — see CLAUDE.md):
 *   1. Fresh-install full chain applies cleanly on both dialects.
 *   2. Every migration version has an explicit per-version effect assertion
 *      (a guard test fails if a migration is added without one).
 *   3. The data migrations (legacy rules -> policies + one-role collapse + dedup
 *      + admin preservation + idempotency + legacy table drop) are verified with
 *      seeded pre-migration data.
 *
 * Run via `scripts/test-migrations.sh` (or bun test on this file with Docker up).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { closeDatabase, getDatabaseType } from "./index";
import { runMigrations, MIGRATIONS, APP_VERSION } from "./migrations";
import * as h from "./migrationTestHarness";
import { OBSERVE_TABLE_NAMES } from "./observeSchema";
import { AI_REGISTRY_TABLE_NAMES } from "./aiRegistrySchema";
import { AI_USAGE_INDEX_NAMES, AI_USAGE_TABLE_NAMES } from "./aiUsageSchema";
import { DASHBOARD_INDEX_NAMES, DASHBOARD_TABLE_NAMES } from "./dashboardsSchema";
import { AI_GUARDRAIL_TABLE_NAMES } from "./aiGuardrailsSchema";
import { DASHBOARD_V2_INDEX_NAMES, DASHBOARD_V2_TABLE_NAMES } from "./dashboardsV2Schema";
import { AI_ACTION_INDEX_NAMES, AI_ACTION_TABLE_NAMES, AI_EVAL_INDEX_NAMES, AI_EVAL_TABLE_NAMES, AI_MEMORY_INDEX_NAMES, AI_MEMORY_TABLE_NAMES, AI_RUNTIME_INDEX_NAMES, AI_RUNTIME_TABLE_NAMES, AI_TRIAGE_INDEX_NAMES, AI_TRIAGE_TABLE_NAMES } from "./aiPlatformSchema";
import { parseDashboardDocument } from "../../services/dashboards/legacy";
import { AI_ACTION_GRANT_INDEX_NAMES, AI_ACTION_GRANT_TABLE_NAMES, AI_ACTION_TIER_COLUMNS, MCP_TOKEN_POLICY_TABLE_NAMES } from "./aiAssistantSchema";

const DIALECTS: h.Dialect[] = ["sqlite", "postgres"];

const DASHBOARD_PERMISSION_NAMES = ["dashboards:view", "dashboards:edit", "dashboards:delete", "dashboards:share", "dashboards:manage"];

/** The dashboards:* permissions each system role holds after 1.61.0. */
const DASHBOARD_GRANTS: Record<string, string[]> = {
  super_admin: DASHBOARD_PERMISSION_NAMES,
  admin: DASHBOARD_PERMISSION_NAMES,
  developer: ["dashboards:view", "dashboards:edit", "dashboards:delete", "dashboards:share"],
  analyst: ["dashboards:view", "dashboards:edit", "dashboards:delete"],
  viewer: ["dashboards:view"],
  guest: [],
};

// Per-version assertions, evaluated against the final full-chain database (or, for
// the legacy data-access table, asserting it was dropped by 1.27.0).
const VERSION_CHECKS: Record<string, () => Promise<void>> = {
  "1.0.0": async () => {
    for (const t of ["rbac_users", "rbac_roles", "rbac_permissions", "rbac_user_roles", "rbac_role_permissions", "rbac_sessions", "rbac_audit_logs"]) {
      expect(await h.tableExists(t)).toBe(true);
    }
  },
  "1.1.0": async () => {
    // Created here, dropped by 1.27.0 — so it must be absent in the final state.
    expect(await h.tableExists("rbac_data_access_rules")).toBe(false);
  },
  // Created here, dropped by 1.30.0 — so it must be absent in the final state.
  "1.2.0": async () => expect(await h.tableExists("rbac_clickhouse_users_metadata")).toBe(false),
  "1.2.1": async () => expect(await h.columnExists("rbac_clickhouse_users_metadata", "auth_type")).toBe(false),
  "1.2.2": async () => expect(await h.roleExists("guest")).toBe(true),
  "1.3.0": async () => {
    expect(await h.tableExists("rbac_user_preferences")).toBe(true);
    expect(await h.tableExists("rbac_user_favorites")).toBe(true);
    expect(await h.tableExists("rbac_user_recent_items")).toBe(true);
  },
  "1.4.0": async () => expect(await h.tableExists("rbac_saved_queries")).toBe(true),
  "1.5.0": async () => expect(await h.columnExists("rbac_saved_queries", "connection_id")).toBe(true),
  "1.6.0": async () => expect(await h.columnExists("rbac_user_favorites", "connection_id")).toBe(true),
  "1.7.0": async () => {
    expect(await h.permissionExists("live_queries:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "live_queries:view")).toBe(true);
  },
  "1.8.0": async () => expect(await h.permissionExists("connections:view")).toBe(true),
  "1.9.0": async () => expect(await h.permissionExists("audit:delete")).toBe(true),
  "1.10.0": async () => expect(await h.permissionExists("query:execute:misc")).toBe(true),
  "1.10.1": async () => expect(await h.roleHasPermission("analyst", "query:execute:misc")).toBe(true),
  "1.11.0": async () => expect(await h.columnExists("rbac_audit_logs", "username_snapshot")).toBe(true),
  "1.12.0": async () => expect(await h.permissionExists("ai:optimize")).toBe(true),
  "1.13.0": async () => expect(await h.permissionExists("live_queries:kill_all")).toBe(true),
  "1.14.0": async () => {
    expect(await h.tableExists("rbac_ai_chat_threads")).toBe(true);
    expect(await h.tableExists("rbac_ai_chat_messages")).toBe(true);
    expect(await h.permissionExists("ai:chat")).toBe(true);
  },
  "1.15.0": async () => expect(await h.columnExists("rbac_ai_chat_messages", "chart_spec")).toBe(true),
  "1.16.0": async () => {
    expect(await h.tableExists("rbac_ai_providers")).toBe(true);
    expect(await h.tableExists("rbac_ai_models")).toBe(true);
  },
  "1.16.1": async () => expect(await h.permissionExists("ai_models:view")).toBe(true),
  "1.16.2": async () => expect(await h.columnExists("rbac_ai_providers", "provider_type")).toBe(true),
  "1.17.0": async () => expect(await h.columnExists("rbac_audit_logs", "browser")).toBe(true),
  "1.17.1": async () => expect(await h.columnExists("rbac_audit_logs", "timezone")).toBe(true),
  "1.18.0": async () => expect(await h.tableExists("fleet_snapshots")).toBe(true),
  // Created here, dropped by 1.55.0 (replaced by obs_leases) — absent in the final state.
  "1.19.0": async () => expect(await h.tableExists("fleet_poller_lease")).toBe(false),
  "1.20.0": async () => expect(await h.tableExists("doctor_reports")).toBe(true),
  "1.21.0": async () => expect(await h.columnExists("doctor_reports", "trigger_source")).toBe(true),
  "1.22.0": async () => {
    expect(await h.permissionExists("parts:view")).toBe(true);
    expect(await h.permissionExists("schema_advisor:view")).toBe(true);
  },
  "1.23.0": async () => expect(await h.permissionExists("logs:view")).toBe(true),
  "1.24.0": async () => expect(await h.permissionExists("doctor:run")).toBe(true),
  "1.25.0": async () => expect(await h.tableExists("rbac_user_identities")).toBe(true),
  "1.26.0": async () => {
    expect(await h.tableExists("rbac_data_access_policies")).toBe(true);
    expect(await h.tableExists("rbac_data_access_policy_rules")).toBe(true);
    expect(await h.tableExists("rbac_role_data_access_policies")).toBe(true);
    // Per-rule connection scope (no separate policy<->connection table).
    expect(await h.columnExists("rbac_data_access_policy_rules", "connection_id")).toBe(true);
    expect(await h.tableExists("rbac_data_access_policy_connections")).toBe(false);
    expect(await h.permissionExists("data_access:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "data_access:view")).toBe(true);
    expect(await h.roleHasPermission("admin", "data_access:assign")).toBe(true);
    const guest = await h.rawAll(sql`SELECT 1 AS ok FROM rbac_data_access_policies WHERE name = 'System Tables (Guest)'`);
    expect(guest.length).toBe(1);
  },
  "1.27.0": async () => {
    expect(await h.tableExists("rbac_data_access_rules")).toBe(false);
    expect(await h.indexExists("user_roles_user_unique_idx")).toBe(true);
  },
  "1.28.0": async () => {
    // Per-user connection access is gone; access is derived from role policies.
    expect(await h.tableExists("rbac_user_connections")).toBe(false);
  },
  "1.29.0": async () => {
    for (const p of ["clickhouse:roles:view", "clickhouse:roles:create", "clickhouse:roles:update", "clickhouse:roles:delete", "clickhouse:roles:assign"]) {
      expect(await h.permissionExists(p)).toBe(true);
    }
    expect(await h.roleHasPermission("super_admin", "clickhouse:roles:create")).toBe(true);
    expect(await h.roleHasPermission("admin", "clickhouse:roles:assign")).toBe(true);
  },
  "1.30.0": async () => {
    // ClickHouse is now the source of truth; the local metadata cache is gone.
    expect(await h.tableExists("rbac_clickhouse_users_metadata")).toBe(false);
  },
  "1.31.0": async () => {
    expect(await h.tableExists("rbac_clickhouse_role_state")).toBe(true);
    expect(await h.indexExists("ch_role_state_conn_role_idx")).toBe(true);
  },
  "1.32.0": async () => {
    expect(await h.tableExists("rbac_sso_settings")).toBe(true);
    expect(await h.tableExists("rbac_sso_providers")).toBe(true);
    expect(await h.permissionExists("sso:view")).toBe(true);
    expect(await h.permissionExists("sso:edit")).toBe(true);
    expect(await h.permissionExists("sso:delete")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "sso:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "sso:edit")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "sso:delete")).toBe(true);
    expect(await h.roleHasPermission("admin", "sso:view")).toBe(true);
  },
  "1.33.0": async () => {
    expect(await h.columnExists("rbac_sso_providers", "auth_params")).toBe(true);
  },
  "1.34.0": async () => {
    for (const col of [
      "saml_idp_entity_id", "saml_idp_sso_url", "saml_idp_certificate",
      "saml_sp_entity_id", "saml_nameid_format", "saml_allow_idp_initiated",
    ]) {
      expect(await h.columnExists("rbac_sso_providers", col)).toBe(true);
    }
    expect(await h.columnIsNullable("rbac_sso_providers", "client_id")).toBe(true);
    expect(await h.columnIsNullable("rbac_sso_providers", "scopes")).toBe(true);
  },
  "1.35.0": async () => {
    expect(await h.columnExists("rbac_sso_providers", "saml_trust_email_verified")).toBe(true);
  },
  "1.36.0": async () => {
    // 1.36.0 created fleet_alert_config; its data was imported into the
    // normalized alerting tables by 1.39.0 and the table was dropped by 1.39.1,
    // so at HEAD it no longer exists.
    expect(await h.tableExists("fleet_alert_config")).toBe(false);
  },
  "1.37.0": async () => {
    expect(await h.tableExists("doctor_schedule")).toBe(true);
    expect(await h.columnExists("doctor_schedule", "last_run_at")).toBe(true);
    expect(await h.columnExists("doctor_schedule", "last_run_by")).toBe(true);
    const rows = await h.rawAll(sql`SELECT id FROM doctor_schedule WHERE id = 1`);
    expect(rows.length).toBe(1);
  },
  "1.38.0": async () => {
    expect(await h.tableExists("_rbac_rate_limits")).toBe(true);
    expect(await h.columnExists("_rbac_rate_limits", "hits")).toBe(true);
    expect(await h.columnExists("_rbac_rate_limits", "reset_at_ms")).toBe(true);
    expect(await h.indexExists("idx_rbac_rate_limits_reset_at_ms")).toBe(true);
  },
  "1.39.0": async () => {
    expect(await h.tableExists("notification_channels")).toBe(true);
    expect(await h.tableExists("alert_rules")).toBe(true);
    expect(await h.tableExists("alert_rule_channels")).toBe(true);
    expect(await h.tableExists("alert_events")).toBe(true);
    expect(await h.columnExists("notification_channels", "config")).toBe(true);
    expect(await h.columnExists("alert_rules", "source_type")).toBe(true);
    expect(await h.indexExists("idx_alert_events_fired_at")).toBe(true);
    // Permissions are seeded and granted in the same migration: super_admin gets
    // view + edit + delete, admin gets view + edit (delete is super-admin only).
    expect(await h.permissionExists("alerting:view")).toBe(true);
    expect(await h.permissionExists("alerting:edit")).toBe(true);
    expect(await h.permissionExists("alerting:delete")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "alerting:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "alerting:edit")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "alerting:delete")).toBe(true);
    expect(await h.roleHasPermission("admin", "alerting:view")).toBe(true);
    expect(await h.roleHasPermission("admin", "alerting:edit")).toBe(true);
    expect(await h.roleHasPermission("admin", "alerting:delete")).toBe(false);
  },
  "1.39.1": async () => {
    // The legacy blob table is dropped once its data has been imported.
    expect(await h.tableExists("fleet_alert_config")).toBe(false);
  },
  "1.40.0": async () => {
    // Four scheduled-queries tables + their indexes.
    expect(await h.tableExists("scheduled_queries")).toBe(true);
    expect(await h.tableExists("scheduled_query_runs")).toBe(true);
    expect(await h.tableExists("scheduled_query_channels")).toBe(true);
    expect(await h.tableExists("scheduled_query_outbox")).toBe(true);
    expect(await h.columnExists("scheduled_queries", "output_mode")).toBe(true);
    expect(await h.columnExists("scheduled_queries", "last_run_at")).toBe(true);
    expect(await h.columnExists("scheduled_query_runs", "slot_at")).toBe(true);
    expect(await h.columnExists("scheduled_query_runs", "written_rows")).toBe(true);
    expect(await h.columnExists("scheduled_query_outbox", "dedup_key")).toBe(true);
    expect(await h.indexExists("sq_enabled_idx")).toBe(true);
    expect(await h.indexExists("sq_runs_status_idx")).toBe(true);
    expect(await h.indexExists("sq_outbox_dedup_idx")).toBe(true);
    // Permissions seeded and granted to super_admin + admin (write + view_all included).
    for (const p of [
      "scheduled_queries:view",
      "scheduled_queries:edit",
      "scheduled_queries:delete",
      "scheduled_queries:run",
      "scheduled_queries:write",
      "scheduled_queries:view_all",
    ]) {
      expect(await h.permissionExists(p)).toBe(true);
      expect(await h.roleHasPermission("super_admin", p)).toBe(true);
      expect(await h.roleHasPermission("admin", p)).toBe(true);
    }
  },
  "1.44.0": async () => {
    expect(await h.columnExists("scheduled_queries", "timezone")).toBe(true);
    for (const table of [
      "data_health_promises",
      "data_health_promise_checks",
      "data_health_samples",
      "data_health_incidents",
      "data_health_incident_events",
    ]) {
      expect(await h.tableExists(table)).toBe(true);
    }
    expect(await h.columnExists("data_health_promises", "scheduled_query_id")).toBe(true);
    expect(await h.columnExists("data_health_promises", "status")).toBe(true);
    expect(await h.columnExists("data_health_samples", "observed_value")).toBe(true);
    expect(await h.columnExists("data_health_incidents", "snoozed_until")).toBe(true);
    expect(await h.indexExists("dh_promises_job_idx")).toBe(true);
    expect(await h.indexExists("dh_promise_checks_promise_idx")).toBe(true);
    expect(await h.indexExists("dh_samples_check_slot_idx")).toBe(true);
    expect(await h.indexExists("dh_incidents_status_idx")).toBe(true);
    for (const permission of [
      "data_health:view",
      "data_health:edit",
      "data_health:delete",
      "data_health:run",
      "data_health:view_all",
    ]) {
      expect(await h.permissionExists(permission)).toBe(true);
      expect(await h.roleHasPermission("super_admin", permission)).toBe(true);
      expect(await h.roleHasPermission("admin", permission)).toBe(true);
    }
  },
  "1.44.1": async () => {
    for (const column of ["event_time_type", "event_time_encoding", "event_time_timezone", "event_time_format"]) {
      expect(await h.columnExists("data_health_promises", column)).toBe(true);
    }
  },
  "1.45.0": async () => {
    expect(await h.tableExists("rbac_query_history")).toBe(true);
    expect(await h.columnExists("rbac_query_history", "executed_at")).toBe(true);
    expect(await h.columnExists("rbac_query_history", "status")).toBe(true);
    expect(await h.indexExists("query_history_user_time_idx")).toBe(true);
  },
  "1.46.0": async () => {
    expect(await h.columnExists("rbac_ai_models", "params")).toBe(true);
  },
  "1.47.0": async () => {
    expect(await h.columnExists("data_health_promises", "upstream_job_id")).toBe(true);
    expect(await h.indexExists("data_health_promises_upstream_idx")).toBe(true);
  },
  "1.48.0": async () => {
    expect(await h.tableExists("rbac_saml_handoff_codes")).toBe(true);
    expect(await h.columnExists("rbac_saml_handoff_codes", "payload")).toBe(true);
    expect(await h.columnExists("rbac_saml_handoff_codes", "expires_at")).toBe(true);
    expect(await h.indexExists("saml_handoff_codes_expiry_idx")).toBe(true);
    expect(await h.tableExists("rbac_saml_assertions_seen")).toBe(true);
    expect(await h.columnExists("rbac_saml_assertions_seen", "expires_at")).toBe(true);
    expect(await h.indexExists("saml_assertions_seen_expiry_idx")).toBe(true);
    expect(await h.tableExists("rbac_saml_request_ids")).toBe(true);
    expect(await h.columnExists("rbac_saml_request_ids", "value")).toBe(true);
    expect(await h.indexExists("saml_request_ids_expiry_idx")).toBe(true);
  },
  "1.49.0": async () => {
    expect(await h.tableExists("rbac_config_generation")).toBe(true);
    expect(await h.columnExists("rbac_config_generation", "generation")).toBe(true);
    // The single contended row must be seeded, or the bump UPDATE has nothing to hit.
    const rows = await h.rawAll(sql`SELECT generation FROM rbac_config_generation WHERE id = 1`);
    expect(rows.length).toBe(1);
  },
  "1.50.0": async () => {
    expect(await h.tableExists("fleet_alert_latches")).toBe(true);
    expect(await h.columnExists("fleet_alert_latches", "armed")).toBe(true);
    expect(await h.indexExists("fleet_alert_latches_updated_idx")).toBe(true);
    expect(await h.tableExists("fleet_alerter_runtime")).toBe(true);
    const runtime = await h.rawAll(sql`SELECT last_auto_rca_at FROM fleet_alerter_runtime WHERE id = 1`);
    expect(runtime.length).toBe(1);
  },
  "1.51.0": async () => {
    // ADR 0011: backfills rbac_api_keys on upgraded installs; no-op on fresh.
    expect(await h.tableExists("rbac_api_keys")).toBe(true);
    expect(await h.columnExists("rbac_api_keys", "key_hash")).toBe(true);
    expect(await h.columnExists("rbac_api_keys", "revoked_at")).toBe(true);
    expect(await h.indexExists("api_keys_user_idx")).toBe(true);
    expect(await h.indexExists("api_keys_hash_idx")).toBe(true);
    expect(await h.indexExists("api_keys_prefix_idx")).toBe(true);
  },
  "1.52.0": async () => {
    // PAT hotfix: scopes must store a JSON array on both dialects (PostgreSQL
    // regressed to TEXT[] and rejected every insert). Functional round-trip
    // with a probe row, cleaned up afterwards.
    const userId = await insertUser(`pat-scopes-probe-${randomUUID().slice(0, 8)}`);
    const probeId = randomUUID();
    await h.rawRun(sql`INSERT INTO rbac_api_keys (id, user_id, name, key_hash, key_prefix, scopes)
      VALUES (${probeId}, ${userId}, 'probe', ${`probe-hash-${probeId}`}, 'probe', ${'["table:select"]'})`);
    try {
      const rows = await h.rawAll(sql`SELECT scopes FROM rbac_api_keys WHERE id = ${probeId}`);
      expect(rows.length).toBe(1);
      // postgres-js parses jsonb to an array, sqlite returns the raw text.
      const scopes = rows[0].scopes;
      const text = Array.isArray(scopes) ? JSON.stringify(scopes) : String(scopes);
      expect(text).toContain("table:select");
    } finally {
      await h.rawRun(sql`DELETE FROM rbac_api_keys WHERE id = ${probeId}`);
    }
  },
  "1.53.0": async () => {
    // ADR 0016 evidence store, permissions and default grants (§18: Admin keeps every DDL ability).
    for (const t of OBSERVE_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    expect(await h.indexExists("obs_lineage_edges_source_idx")).toBe(true);
    for (const p of ["observe:view", "observe:edit", "context:edit", "performance:view", "capacity:view", "cost:view", "upgrades:view", "upgrades:run", "remediation:propose", "remediation:approve", "remediation:approve_high", "schema:override", "agents:view", "agents:manage", "notebooks:edit"]) {
      expect(await h.permissionExists(p)).toBe(true);
    }
    expect(await h.roleHasPermission("admin", "schema:override")).toBe(true);
    expect(await h.roleHasPermission("developer", "remediation:propose")).toBe(true);
    expect(await h.roleHasPermission("developer", "remediation:approve")).toBe(false);
    expect(await h.roleHasPermission("analyst", "observe:view")).toBe(true);
    expect(await h.roleHasPermission("viewer", "cost:view")).toBe(false);
  },
  "1.54.0": async () => {
    // Roles that could see Data Health / Scheduled Queries see observe; doctor:run → remediation:propose.
    expect(await h.roleHasPermission("admin", "observe:view")).toBe(true);
    expect(await h.roleHasPermission("admin", "remediation:propose")).toBe(true);
  },
  "1.55.0": async () => expect(await h.tableExists("fleet_poller_lease")).toBe(false),
  "1.56.0": async () => {
    // ADR 0019 agent registry, the registry version row, per-thread chat agent and the new permissions.
    for (const t of AI_REGISTRY_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of ["ai_harnesses_slug_idx", "ai_skills_name_idx", "ai_agents_slug_idx", "ai_registry_revisions_entity_idx"]) {
      expect(await h.indexExists(i)).toBe(true);
    }
    const state = await h.rawAll(sql`SELECT version FROM ai_registry_state WHERE id = 1`);
    expect(state.length).toBe(1);
    expect(await h.columnExists("rbac_ai_chat_threads", "agent_id")).toBe(true);
    expect(await h.permissionExists("ai_agents:view")).toBe(true);
    expect(await h.permissionExists("ai_agents:manage")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "ai_agents:manage")).toBe(true);
    expect(await h.roleHasPermission("admin", "ai_agents:manage")).toBe(true);
    expect(await h.roleHasPermission("developer", "ai_agents:manage")).toBe(false);
  },
  "1.57.0": async () => {
    // Issue #380: incremental usage / tables state and per-run collector cost.
    expect(await h.tableExists("obs_query_shape_days")).toBe(true);
    expect(await h.tableExists("obs_table_write_times")).toBe(true);
    for (const c of ["read_rows", "read_bytes", "query_count"]) expect(await h.columnExists("obs_collector_status", c)).toBe(true);
  },
  "1.58.0": async () => {
    // ADR 0020: AI usage tables, model pricing and the ai_usage:view permission.
    for (const t of AI_USAGE_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of AI_USAGE_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    expect(await h.columnExists("rbac_ai_models", "pricing")).toBe(true);
    expect(await h.columnIsNullable("rbac_ai_models", "pricing")).toBe(true);
    expect(await h.columnExists("ai_usage_requests", "thread_id")).toBe(true);
    expect(await h.permissionExists("ai_usage:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "ai_usage:view")).toBe(true);
    expect(await h.roleHasPermission("admin", "ai_usage:view")).toBe(true);
    expect(await h.roleHasPermission("developer", "ai_usage:view")).toBe(false);
    expect(await h.roleHasPermission("viewer", "ai_usage:view")).toBe(false);
  },
  "1.59.0": async () => expect(await h.columnExists("ai_usage_requests", "thread_id")).toBe(true),
  "1.60.0": async () => {
    // ADR 0020: who started an AI request (UI, MCP agent or token caller).
    for (const c of ["origin", "pat_id", "client_name"]) {
      expect(await h.columnExists("ai_usage_requests", c)).toBe(true);
      expect(await h.columnIsNullable("ai_usage_requests", c)).toBe(true);
    }
    expect(await h.indexExists("ai_usage_requests_pat_idx")).toBe(true);
  },
  "1.61.0": async () => {
    // ADR 0021: dashboards tables and the dashboards:* permissions per role.
    for (const t of DASHBOARD_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of DASHBOARD_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    // Dashboards have no connection of their own, only the ones they are assigned to.
    expect(await h.columnExists("dashboards", "connection_scope")).toBe(true);
    expect(await h.columnExists("dashboards", "connection_id")).toBe(false);
    for (const p of DASHBOARD_PERMISSION_NAMES) expect(await h.permissionExists(p)).toBe(true);
    for (const [role, granted] of Object.entries(DASHBOARD_GRANTS)) {
      for (const p of DASHBOARD_PERMISSION_NAMES) expect(await h.roleHasPermission(role, p)).toBe(granted.includes(p));
    }
  },
  "1.62.0": async () => {
    // ADR 0022: guardrail and event tables; the ai_guardrails:* permissions for admins only.
    expect(AI_GUARDRAIL_TABLE_NAMES).toEqual(["ai_guardrails", "ai_guardrail_events"]);
    for (const t of AI_GUARDRAIL_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of ["ai_guardrails_slug_idx", "ai_guardrail_events_created_idx", "ai_guardrail_events_guardrail_idx", "ai_guardrail_events_request_idx"]) {
      expect(await h.indexExists(i)).toBe(true);
    }
    for (const c of ["kind", "config", "stages", "action", "mode", "scope", "position", "seed_hash", "customized"]) {
      expect(await h.columnExists("ai_guardrails", c)).toBe(true);
    }
    // Events never store matched values: only counts and where they happened.
    expect(await h.columnExists("ai_guardrail_events", "match_count")).toBe(true);
    expect(await h.columnExists("ai_guardrail_events", "matched_value")).toBe(false);
    for (const role of ["super_admin", "admin", "developer", "analyst", "viewer", "guest"]) {
      const admin = role === "super_admin" || role === "admin";
      for (const p of ["ai_guardrails:view", "ai_guardrails:manage"]) expect(await h.roleHasPermission(role, p)).toBe(admin);
    }
  },
  "1.63.0": async () => {
    // ADR 0023: the canvas columns, annotation sources and the notes, versions, snapshots and reports tables.
    expect(DASHBOARD_V2_TABLE_NAMES).toEqual(["dashboard_notes", "dashboard_versions", "dashboard_snapshots", "dashboard_reports", "dashboard_report_channels"]);
    for (const t of DASHBOARD_V2_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of DASHBOARD_V2_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    for (const c of ["kind", "x", "y", "w", "h", "markdown", "description"]) expect(await h.columnExists("dashboard_panels", c)).toBe(true);
    expect(await h.columnExists("dashboards", "annotations")).toBe(true);
  },
  "1.64.0": async () => {
    // ADR 0023: the format 1 sizes are gone once every panel has a layout.
    expect(await h.columnExists("dashboard_panels", "width")).toBe(false);
    expect(await h.columnExists("dashboard_panels", "height")).toBe(false);
    expect(await h.columnExists("dashboard_panels", "position")).toBe(true);
  },
  "1.65.0": async () => {
    // ADR 0024 phase 1: chat runs, LangGraph checkpoints, budgets; ai_budgets:manage for admins only.
    expect(AI_RUNTIME_TABLE_NAMES).toEqual(["ai_chat_runs", "ai_checkpoints", "ai_checkpoint_writes", "ai_budgets"]);
    for (const t of AI_RUNTIME_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of AI_RUNTIME_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    for (const c of ["steps", "pending", "cancel_requested", "heartbeat_at"]) expect(await h.columnExists("ai_chat_runs", c)).toBe(true);
    for (const c of ["applies_to", "limit_tokens", "limit_cost_usd", "on_exhaust", "fallback_model_config_id"]) expect(await h.columnExists("ai_budgets", c)).toBe(true);
    expect(await h.permissionExists("ai_budgets:manage")).toBe(true);
    for (const role of ["super_admin", "admin", "developer", "analyst", "viewer", "guest"]) {
      expect(await h.roleHasPermission(role, "ai_budgets:manage")).toBe(role === "super_admin" || role === "admin");
    }
  },
  "1.66.0": async () => {
    // ADR 0024 phase 2: approved actions; ai:act for the roles that change things (not analysts, viewers or guests).
    expect(AI_ACTION_TABLE_NAMES).toEqual(["ai_actions"]);
    for (const t of AI_ACTION_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of AI_ACTION_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    for (const c of ["source", "run_id", "interrupt_id", "tool", "args", "status", "decided_by", "expires_at"]) expect(await h.columnExists("ai_actions", c)).toBe(true);
    expect(await h.permissionExists("ai:act")).toBe(true);
    for (const role of ["super_admin", "admin", "developer", "analyst", "viewer", "guest"]) {
      expect(await h.roleHasPermission(role, "ai:act")).toBe(role === "super_admin" || role === "admin" || role === "developer");
    }
  },
  "1.67.0": async () => {
    // ADR 0024 phase 3: memories go with their user or connection; admins review team memories.
    expect(AI_MEMORY_TABLE_NAMES).toEqual(["ai_memories", "ai_memory_settings"]);
    for (const t of AI_MEMORY_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of AI_MEMORY_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    for (const c of ["scope", "owner_id", "connection_id", "content", "status", "flag", "proposed_by"]) expect(await h.columnExists("ai_memories", c)).toBe(true);
    expect(await h.permissionExists("ai_memories:manage")).toBe(true);
    for (const role of ["super_admin", "admin", "developer", "analyst", "viewer", "guest"]) {
      expect(await h.roleHasPermission(role, "ai_memories:manage")).toBe(role === "super_admin" || role === "admin");
    }
  },
  "1.68.0": async () => {
    // ADR 0024 phase 4: auto-triage rules (none until turned on) and one run per subject.
    expect(AI_TRIAGE_TABLE_NAMES).toEqual(["ai_triage_rules", "ai_triage_runs"]);
    for (const t of AI_TRIAGE_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of AI_TRIAGE_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    for (const c of ["enabled", "cooldown_minutes", "daily_token_budget", "channel_ids", "propose_as", "watermark"]) expect(await h.columnExists("ai_triage_rules", c)).toBe(true);
    for (const c of ["trigger", "subject_id", "status", "action_ids", "tokens", "notebook_id"]) expect(await h.columnExists("ai_triage_runs", c)).toBe(true);
    expect(await h.rowCount("ai_triage_rules")).toBe(0);
  },
  "1.69.0": async () => {
    // ADR 0024 phase 5: the analysis sandbox is a harness switch, off for every harness until turned on.
    expect(await h.columnExists("ai_harnesses", "analysis")).toBe(true);
    const on = await h.rawAll(sql`SELECT COUNT(*) AS n FROM ai_harnesses WHERE analysis <> 0`);
    expect(Number(on[0]?.n ?? 0)).toBe(0);
  },
  "1.70.0": async () => {
    // ADR 0024 phase 6: eval cases and scored runs, keyed by the draft they scored.
    expect(AI_EVAL_TABLE_NAMES).toEqual(["ai_eval_cases", "ai_eval_runs"]);
    for (const t of AI_EVAL_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of AI_EVAL_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    for (const c of ["agent_id", "kind", "feature_id", "input", "expected_tools", "rubric", "source"]) expect(await h.columnExists("ai_eval_cases", c)).toBe(true);
    for (const c of ["draft_hash", "status", "score", "results", "regressions", "tokens"]) expect(await h.columnExists("ai_eval_runs", c)).toBe(true);
  },
  "1.71.0": async () => {
    // ADR 0025: every AI write records its tier, origin and undo; T2 grants live in their own table.
    for (const c of AI_ACTION_TIER_COLUMNS) expect(await h.columnExists("ai_actions", c.name)).toBe(true);
    expect(AI_ACTION_GRANT_TABLE_NAMES).toEqual(["ai_action_grants"]);
    for (const t of AI_ACTION_GRANT_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const i of AI_ACTION_GRANT_INDEX_NAMES) expect(await h.indexExists(i)).toBe(true);
    for (const c of ["user_id", "tool", "scope", "thread_id", "expires_at"]) expect(await h.columnExists("ai_action_grants", c)).toBe(true);
  },
  "1.72.0": async () => {
    // ADR 0025: per-token MCP write policy; no token has one until its owner sets it.
    expect(MCP_TOKEN_POLICY_TABLE_NAMES).toEqual(["mcp_token_policies"]);
    for (const t of MCP_TOKEN_POLICY_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
    for (const c of ["pat_id", "toolkits", "t1", "t2", "t3", "updated_at"]) expect(await h.columnExists("mcp_token_policies", c)).toBe(true);
    expect(await h.rowCount("mcp_token_policies")).toBe(0);
  },
};

// ---------------------------------------------------------------------------
// Shared Postgres container for the whole file.
// ---------------------------------------------------------------------------
let pg: h.PostgresContainer | undefined;

beforeAll(async () => {
  pg = await h.startPostgresContainer();
}, 180_000);

afterAll(async () => {
  await closeDatabase();
  pg?.stop();
}, 30_000);

// Dialect-aware literals for seeding raw rows.
const b = (v: boolean): boolean | number => (getDatabaseType() === "sqlite" ? (v ? 1 : 0) : v);
const now = () => (getDatabaseType() === "sqlite" ? sql`unixepoch()` : sql`NOW()`);

async function roleId(name: string): Promise<string> {
  const rows = await h.rawAll(sql`SELECT id FROM rbac_roles WHERE name = ${name} LIMIT 1`);
  return String(rows[0].id);
}

async function insertUser(username: string): Promise<string> {
  const id = randomUUID();
  await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at)
    VALUES (${id}, ${`${username}@test.local`}, ${username}, 'x', ${b(true)}, ${now()}, ${now()})`);
  return id;
}

async function assignRole(userId: string, rid: string): Promise<void> {
  await h.rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${randomUUID()}, ${userId}, ${rid}, ${now()})`);
}

async function insertLegacyRule(opts: { roleId?: string; userId?: string; connectionId?: string | null; db: string; table: string; allowed?: boolean }): Promise<void> {
  await h.rawRun(sql`INSERT INTO rbac_data_access_rules
    (id, role_id, user_id, connection_id, database_pattern, table_pattern, access_type, is_allowed, priority, created_at, updated_at)
    VALUES (${randomUUID()}, ${opts.roleId ?? null}, ${opts.userId ?? null}, ${opts.connectionId ?? null}, ${opts.db}, ${opts.table}, 'read', ${b(opts.allowed ?? true)}, 0, ${now()}, ${now()})`);
}

async function insertConnection(name: string): Promise<string> {
  const id = randomUUID();
  await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections
    (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
    VALUES (${id}, ${name}, 'localhost', 8123, 'default', 'x', 'default', ${b(false)}, ${b(true)}, ${b(false)}, ${now()}, ${now()})`);
  return id;
}

async function insertGrant(userId: string, connectionId: string): Promise<void> {
  await h.rawRun(sql`INSERT INTO rbac_user_connections (id, user_id, connection_id, can_use, created_at)
    VALUES (${randomUUID()}, ${userId}, ${connectionId}, ${b(true)}, ${now()})`);
}

// The connection_ids set on a user's (single) role's policy rules.
async function userRuleConnIds(userId: string): Promise<Set<string>> {
  const rows = await h.rawAll(sql`
    SELECT pr.connection_id AS connection_id FROM rbac_user_roles ur
    JOIN rbac_role_data_access_policies rp ON rp.role_id = ur.role_id
    JOIN rbac_data_access_policy_rules pr ON pr.policy_id = rp.policy_id
    WHERE ur.user_id = ${userId}
  `);
  return new Set(rows.map((r) => String(r.connection_id)));
}

async function userRoleIds(userId: string): Promise<string[]> {
  const rows = await h.rawAll(sql`SELECT role_id FROM rbac_user_roles WHERE user_id = ${userId}`);
  return rows.map((r) => String(r.role_id));
}

// ---------------------------------------------------------------------------
// Per-dialect suites.
// ---------------------------------------------------------------------------
// APP_VERSION is what "current schema version" reports (logs, /api/rbac/status)
// and what fresh installs are stamped with — a migration added without bumping
// it makes every server log a nonsense "current > target" state.
describe("migrations · version bookkeeping", () => {
  it("APP_VERSION matches the newest migration", () => {
    expect(APP_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });
});

for (const dialect of DIALECTS) {
  describe(`migrations · fresh install [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("records every migration version", async () => {
      for (const m of MIGRATIONS) {
        expect(await h.migrationRecorded(m.version)).toBe(true);
      }
    });

    it("has a per-version check for every migration", () => {
      const missing = MIGRATIONS.map((m) => m.version).filter((v) => !VERSION_CHECKS[v]);
      expect(missing).toEqual([]);
    });

    for (const m of MIGRATIONS) {
      it(`${m.version} (${m.name}) applied its effect`, async () => {
        await VERSION_CHECKS[m.version]();
      });
    }
  });

  describe(`migrations · stepwise upgrade [${dialect}]`, () => {
    // Simulate a real upgrade: a DB that is brought forward one release at a time
    // (each app restart applies only the newly-pending migrations), then verify it
    // lands in exactly the same state as a fresh install.
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      for (const m of MIGRATIONS) {
        const result = await runMigrations({ skipSeed: true, through: m.version });
        // Each step applies exactly the one newly-pending migration.
        expect(result.migrationsApplied).toContain(m.version);
      }
    }, 60_000);

    it("records every migration version after a stepwise upgrade", async () => {
      for (const m of MIGRATIONS) {
        expect(await h.migrationRecorded(m.version)).toBe(true);
      }
    });

    it("reaches the same final state as a fresh install", async () => {
      for (const m of MIGRATIONS) {
        await VERSION_CHECKS[m.version]();
      }
    });

    it("re-running after the upgrade applies nothing (idempotent)", async () => {
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
    });
  });

  describe(`migrations · skip-version upgrade [${dialect}]`, () => {
    // A DB installed at an early version that skips several releases straight to HEAD.
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true, through: "1.2.2" }); // "installed" at an old version
      await runMigrations({ skipSeed: true }); // jump to HEAD
    }, 60_000);

    it("reaches the same final state as a fresh install", async () => {
      for (const m of MIGRATIONS) {
        await VERSION_CHECKS[m.version]();
      }
    });
  });

  describe(`migrations · legacy data-access upgrade [${dialect}]`, () => {
    let connX = "";
    let userGrant = "";
    let userGrantTwin = "";
    let userConnScoped = "";
    let userPlain = "";
    let userNullNoGrant = "";
    let userMulti = "";
    let userAdmin = "";

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      // Install at the last released version; system roles exist (seeded by 1.2.2).
      await runMigrations({ skipSeed: true, through: "1.25.0" });

      const analyst = await roleId("analyst");
      const viewer = await roleId("viewer");
      const admin = await roleId("admin");
      connX = await insertConnection("connX");

      // Role-level global (null-connection) rule on analyst, like a real install.
      await insertLegacyRule({ roleId: analyst, db: "analytics", table: "*" });

      // analyst + a direct connection grant -> null rule must be expanded onto connX.
      userGrant = await insertUser("u_grant");
      await assignRole(userGrant, analyst);
      await insertGrant(userGrant, connX);

      // Identical to u_grant -> must share the same generated role (dedup).
      userGrantTwin = await insertUser("u_grant_twin");
      await assignRole(userGrantTwin, analyst);
      await insertGrant(userGrantTwin, connX);

      // analyst + a connection-scoped user rule -> connX reachable without a grant.
      userConnScoped = await insertUser("u_connscoped");
      await assignRole(userConnScoped, analyst);
      await insertLegacyRule({ userId: userConnScoped, connectionId: connX, db: "sales", table: "*" });

      // analyst only (analyst has a null rule) but NO grant -> no reachable connection -> no access -> untouched.
      userNullNoGrant = await insertUser("u_nullnograent");
      await assignRole(userNullNoGrant, analyst);

      // analyst with nothing extra and no grant -> untouched (stays analyst).
      userPlain = await insertUser("u_plain");
      await assignRole(userPlain, analyst);

      // Multi-role, no grants/rules -> collapses to a merged role (one role rule).
      userMulti = await insertUser("u_multi");
      await assignRole(userMulti, analyst);
      await assignRole(userMulti, viewer);

      // admin + viewer -> collapses to admin only (preserves the bypass).
      userAdmin = await insertUser("u_admin");
      await assignRole(userAdmin, admin);
      await assignRole(userAdmin, viewer);

      // Apply the data-access migration + the drops (through HEAD).
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("dropped both legacy tables and added the one-role index", async () => {
      expect(await h.tableExists("rbac_data_access_rules")).toBe(false);
      expect(await h.tableExists("rbac_user_connections")).toBe(false);
      expect(await h.indexExists("user_roles_user_unique_idx")).toBe(true);
    });

    it("collapsed every user to exactly one role", async () => {
      for (const u of [userGrant, userGrantTwin, userConnScoped, userPlain, userNullNoGrant, userMulti, userAdmin]) {
        expect(await userRoleIds(u)).toHaveLength(1);
      }
    });

    it("kept the admin user on the admin role (bypass preserved)", async () => {
      expect(await userRoleIds(userAdmin)).toEqual([await roleId("admin")]);
    });

    it("left no-access single-role users untouched (still analyst)", async () => {
      const analyst = await roleId("analyst");
      expect(await userRoleIds(userPlain)).toEqual([analyst]);
      expect(await userRoleIds(userNullNoGrant)).toEqual([analyst]);
    });

    it("expanded the role's null rule onto a directly-granted connection", async () => {
      // u_grant should reach connX (a connection-scoped rule exists for it).
      expect(await userRuleConnIds(userGrant)).toContain(connX);
      // and that rule carries the analyst null rule's db pattern, scoped to connX.
      const [role] = await userRoleIds(userGrant);
      const rows = await h.rawAll(sql`
        SELECT pr.database_pattern AS db FROM rbac_role_data_access_policies rp
        JOIN rbac_data_access_policy_rules pr ON pr.policy_id = rp.policy_id
        WHERE rp.role_id = ${role} AND pr.connection_id = ${connX}
      `);
      expect(rows.map((r) => String(r.db))).toContain("analytics");
    });

    it("de-duplicated identical granted users onto the same generated role", async () => {
      const [a] = await userRoleIds(userGrant);
      const [b2] = await userRoleIds(userGrantTwin);
      expect(a).toBe(b2);
      expect(a).not.toBe(await roleId("analyst"));
    });

    it("made a connection-scoped user rule's connection reachable", async () => {
      expect(await userRuleConnIds(userConnScoped)).toContain(connX);
    });

    it("is idempotent — re-running applies nothing and adds no duplicate policies", async () => {
      const before = await h.rowCount("rbac_data_access_policies");
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
      expect(await h.rowCount("rbac_data_access_policies")).toBe(before);
    });
  });

  describe(`migrations · 1.34.0 sso provider rebuild [${dialect}]`, () => {
    // 1.34.0 rebuilds rbac_sso_providers on SQLite (CREATE __new -> INSERT…SELECT ->
    // DROP -> RENAME), which MOVES rows. Prove a pre-existing OIDC provider survives
    // the rebuild intact, the new SAML columns are NULL, and re-running is a no-op.
    const provId = randomUUID();

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      // State BEFORE the SAML migration (rbac_sso_providers exists, pre-1.34.0 shape).
      await runMigrations({ skipSeed: true, through: "1.33.0" });

      await h.rawRun(sql`INSERT INTO rbac_sso_providers
        (id, type, display_name, issuer, client_id, client_secret_encrypted, scopes, enabled, created_at, updated_at)
        VALUES (${provId}, 'oidc', 'Acme OIDC', 'https://idp.acme.test', 'acme-client', 'enc:secret', 'openid email profile', ${b(true)}, ${now()}, ${now()})`);

      // Apply the remaining migrations (1.34.0 — the rebuild).
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("kept the seeded OIDC provider's original columns intact through the rebuild", async () => {
      const rows = await h.rawAll(sql`SELECT id, type, display_name, issuer, client_id, client_secret_encrypted, scopes
        FROM rbac_sso_providers WHERE id = ${provId}`);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(String(row.id)).toBe(provId);
      expect(String(row.type)).toBe("oidc");
      expect(String(row.display_name)).toBe("Acme OIDC");
      expect(String(row.issuer)).toBe("https://idp.acme.test");
      expect(String(row.client_id)).toBe("acme-client");
      expect(String(row.client_secret_encrypted)).toBe("enc:secret");
      expect(String(row.scopes)).toBe("openid email profile");
    });

    it("left the six new SAML columns NULL on the migrated row", async () => {
      const rows = await h.rawAll(sql`SELECT
        saml_idp_entity_id, saml_idp_sso_url, saml_idp_certificate,
        saml_sp_entity_id, saml_nameid_format, saml_allow_idp_initiated
        FROM rbac_sso_providers WHERE id = ${provId}`);
      expect(rows).toHaveLength(1);
      for (const v of Object.values(rows[0])) {
        expect(v).toBeNull();
      }
    });

    it("is idempotent — re-running the rebuild leaves a single intact row", async () => {
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
      expect(await h.rowCount("rbac_sso_providers")).toBe(1);

      const rows = await h.rawAll(sql`SELECT id, type, display_name, issuer, client_id, client_secret_encrypted, scopes
        FROM rbac_sso_providers WHERE id = ${provId}`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].client_id)).toBe("acme-client");
      expect(String(rows[0].client_secret_encrypted)).toBe("enc:secret");
      expect(String(rows[0].scopes)).toBe("openid email profile");
    });
  });

  describe(`migrations · 1.39.0 alerting normalization data migration [${dialect}]`, () => {
    // 1.39.0 imports the legacy fleet_alert_config blob (id=1) into the
    // normalized tables: one fleet-default rule + its channels, with the
    // previously-plaintext secrets encrypted at rest. Prove the projection is
    // correct, secrets are encrypted (and decrypt back), and re-running is a no-op.
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      // State BEFORE alerting normalization: fleet_alert_config exists (1.36.0)
      // but the normalized tables do not yet.
      await runMigrations({ skipSeed: true, through: "1.38.0" });

      const blob = JSON.stringify({
        enabled: true,
        aiRcaOnBreach: true,
        aiRcaModelId: "model-xyz",
        rules: { memoryPercent: 90, queryMemoryGb: 8, longQueryMin: 5, partsEtaMin: 30 },
        slack: { webhookUrl: "https://hooks.slack.com/services/T/B/secret", enabled: true },
        email: {
          user: "alerts@acme.test",
          password: "smtp-secret",
          to: "oncall@acme.test",
          host: "smtp.acme.test",
          port: 587,
          secure: false,
          enabled: false,
        },
      });
      await h.rawRun(sql`UPDATE fleet_alert_config SET config = ${blob} WHERE id = 1`);

      // Apply the remaining migrations (1.39.0 — the normalization import).
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("imported the fleet-default rule with thresholds + AI-RCA settings", async () => {
      const rows = await h.rawAll(sql`SELECT name, source_type, config, severity, enabled, ai_rca_enabled, ai_rca_model_id
        FROM alert_rules WHERE id = 'fleet-default'`);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(String(row.source_type)).toBe("fleet_threshold");
      expect(Number(row.enabled)).toBe(1);
      expect(Number(row.ai_rca_enabled)).toBe(1);
      expect(String(row.ai_rca_model_id)).toBe("model-xyz");
      const cfg = JSON.parse(String(row.config));
      expect(cfg.memoryPercent).toBe(90);
      expect(cfg.queryMemoryGb).toBe(8);
      expect(cfg.longQueryMin).toBe(5);
      expect(cfg.partsEtaMin).toBe(30);
    });

    it("imported the slack + email channels and linked them to the rule", async () => {
      const links = await h.rawAll(sql`SELECT channel_id FROM alert_rule_channels WHERE rule_id = 'fleet-default' ORDER BY channel_id`);
      expect(links.map((l) => String(l.channel_id))).toEqual(["fleet-email", "fleet-slack"]);

      const slack = await h.rawAll(sql`SELECT type, enabled FROM notification_channels WHERE id = 'fleet-slack'`);
      expect(String(slack[0].type)).toBe("slack");
      expect(Number(slack[0].enabled)).toBe(1);

      const email = await h.rawAll(sql`SELECT type, enabled FROM notification_channels WHERE id = 'fleet-email'`);
      expect(String(email[0].type)).toBe("email");
      expect(Number(email[0].enabled)).toBe(0); // email.enabled: false in the blob
    });

    it("encrypted the previously-plaintext secrets at rest (and they decrypt back)", async () => {
      const { decryptSecret } = await import("../services/connections");

      const slack = await h.rawAll(sql`SELECT config FROM notification_channels WHERE id = 'fleet-slack'`);
      const slackCfg = JSON.parse(String(slack[0].config));
      expect(slackCfg.webhookUrl).not.toBe("https://hooks.slack.com/services/T/B/secret");
      expect(decryptSecret(slackCfg.webhookUrl)).toBe("https://hooks.slack.com/services/T/B/secret");

      const email = await h.rawAll(sql`SELECT config FROM notification_channels WHERE id = 'fleet-email'`);
      const emailCfg = JSON.parse(String(email[0].config));
      expect(emailCfg.password).not.toBe("smtp-secret");
      expect(decryptSecret(emailCfg.password)).toBe("smtp-secret");
      expect(emailCfg.host).toBe("smtp.acme.test");
      expect(emailCfg.port).toBe(587);
      expect(emailCfg.secure).toBe(false);
    });

    it("is idempotent — re-running imports nothing new", async () => {
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
      expect(await h.rowCount("alert_rules")).toBe(1);
      expect(await h.rowCount("notification_channels")).toBe(2);
      expect(await h.rowCount("alert_rule_channels")).toBe(2);
    });
  });

  describe(`migrations · 1.46.0 ai model runtime params [${dialect}]`, () => {
    // 1.46.0 adds a nullable params JSON column to rbac_ai_models. Prove an
    // existing model survives the upgrade with params NULL (built-in defaults),
    // that a JSON payload round-trips through the new column on this dialect,
    // and that re-running is a no-op.
    const providerId = randomUUID();
    const modelId = randomUUID();

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true, through: "1.45.0" });

      await h.rawRun(sql`INSERT INTO rbac_ai_providers
        (id, name, provider_type, is_active, created_at, updated_at)
        VALUES (${providerId}, 'Acme OpenAI', 'openai', ${b(true)}, ${now()}, ${now()})`);
      await h.rawRun(sql`INSERT INTO rbac_ai_models
        (id, provider_id, name, model_id, created_at, updated_at)
        VALUES (${modelId}, ${providerId}, 'GPT-4o', 'gpt-4o', ${now()}, ${now()})`);

      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("left the pre-existing model intact with params NULL", async () => {
      const rows = await h.rawAll(sql`SELECT name, model_id, params FROM rbac_ai_models WHERE id = ${modelId}`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].name)).toBe("GPT-4o");
      expect(String(rows[0].model_id)).toBe("gpt-4o");
      expect(rows[0].params).toBeNull();
    });

    it("round-trips a JSON params payload through the new column", async () => {
      const params = { temperature: 0.4, maxTokens: 8192, recursionLimit: 64, stopSequences: ["END"] };
      await h.rawRun(sql`UPDATE rbac_ai_models SET params = ${JSON.stringify(params)} WHERE id = ${modelId}`);

      const rows = await h.rawAll(sql`SELECT params FROM rbac_ai_models WHERE id = ${modelId}`);
      expect(rows).toHaveLength(1);
      // Postgres JSONB returns an object, SQLite TEXT returns a string.
      const stored = typeof rows[0].params === "string" ? JSON.parse(String(rows[0].params)) : rows[0].params;
      expect(stored).toEqual(params);
    });

    it("is idempotent — re-running applies nothing and keeps the row", async () => {
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
      expect(await h.rowCount("rbac_ai_models")).toBe(1);
    });
  });

  describe(`migrations · ADR 0016 data carry-over [${dialect}]`, () => {
    let customViewer = "";
    let customDoctor = "";
    let plain = "";

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true, through: "1.53.0" });
      // A held fleet poller lease, two Doctor reports and custom roles.
      await h.rawRun(sql`UPDATE fleet_poller_lease SET holder = 'pod-a', acquired_at = 100, expires_at = 9999999999 WHERE id = 1`);
      await h.rawRun(sql`INSERT INTO doctor_reports (id, created_at, created_by, model, status, summary, node_count, duration_ms, trigger_source)
        VALUES ('r1', 1000, NULL, 'm', 'warning', 'ch-eu-4 merge pressure', 3, 10, 'auto'), ('r2', 2000, NULL, 'm', 'ok', '', 1, 5, NULL)`);
      const perm = async (name: string): Promise<string> => String((await h.rawAll(sql`SELECT id FROM rbac_permissions WHERE name = ${name}`))[0].id);
      const role = async (name: string, perms: string[]): Promise<string> => {
        const id = randomUUID();
        await h.rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, is_default, priority, created_at, updated_at)
          VALUES (${id}, ${name}, ${name}, ${b(false)}, ${b(false)}, 1, ${now()}, ${now()})`);
        for (const p of perms) {
          await h.rawRun(sql`INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at) VALUES (${randomUUID()}, ${id}, ${await perm(p)}, ${now()})`);
        }
        return id;
      };
      customViewer = await role("dh-viewer", ["data_health:view"]);
      customDoctor = await role("doctor-runner", ["doctor:run"]);
      plain = await role("plain", ["metrics:view"]);
      await runMigrations({ skipSeed: true, through: "1.54.0" });
    }, 60_000);

    const has = async (rid: string, permission: string): Promise<boolean> => (await h.rawAll(sql`
      SELECT 1 FROM rbac_role_permissions rp JOIN rbac_permissions p ON p.id = rp.permission_id WHERE rp.role_id = ${rid} AND p.name = ${permission}`)).length > 0;

    it("maps permissions onto custom roles", async () => {
      expect(await has(customViewer, "observe:view")).toBe(true);
      expect(await has(customDoctor, "remediation:propose")).toBe(true);
      expect(await has(plain, "observe:view")).toBe(false);
      expect(await has(customDoctor, "observe:view")).toBe(false);
    });

    it("carries the fleet lease over to the collector lease", async () => {
      const rows = await h.rawAll(sql`SELECT holder FROM obs_leases WHERE lease_key = 'observe:fleet'`);
      expect(String(rows[0]?.holder)).toBe("pod-a");
    });

    it("converts every Doctor report into a notebook with its finding", async () => {
      const notebooks = await h.rawAll(sql`SELECT id, title, attached_ref FROM notebooks WHERE attached_kind = 'doctor_report' ORDER BY attached_ref`);
      expect(notebooks.map((n) => String(n.attached_ref))).toEqual(["r1", "r2"]);
      expect(String(notebooks[0].title)).toBe("ch-eu-4 merge pressure");
      expect(String(notebooks[1].title)).toBe("Doctor report");
      const cells = await h.rawAll(sql`SELECT content FROM notebook_cells WHERE notebook_id = 'nb-doctor-r1'`);
      expect(JSON.parse(String(cells[0].content)).trigger).toBe("auto");
    });

    it("is idempotent when re-run", async () => {
      const migration = MIGRATIONS.find((m) => m.version === "1.54.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      expect(await h.rowCount("notebooks")).toBe(2);
      expect(await h.rowCount("notebook_cells")).toBe(2);
      const grants = await h.rawAll(sql`
        SELECT COUNT(*) AS c FROM rbac_role_permissions rp JOIN rbac_permissions p ON p.id = rp.permission_id WHERE rp.role_id = ${customViewer} AND p.name = 'observe:view'`);
      expect(Number(grants[0].c)).toBe(1);
    });

    it("then drops the old lease table", async () => {
      await runMigrations({ skipSeed: true });
      expect(await h.tableExists("fleet_poller_lease")).toBe(false);
      expect(await h.tableExists("obs_leases")).toBe(true);
    });
  });

  describe(`migrations · collector load upgrade (issue #380) [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true, through: "1.56.0" });
      // Collector status written before the cost columns existed.
      await h.rawRun(sql`INSERT INTO obs_collector_status (connection_id, collector, state, last_run_at, last_ok_at, duration_ms)
        VALUES ('conn-1', 'usage', 'ok', ${Date.now()}, ${Date.now()}, 96)`);
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("keeps existing collector status, with no cost recorded yet", async () => {
      const rows = await h.rawAll(sql`SELECT state, duration_ms, read_rows, read_bytes, query_count FROM obs_collector_status WHERE connection_id = 'conn-1' AND collector = 'usage'`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].state)).toBe("ok");
      expect(Number(rows[0].duration_ms)).toBe(96);
      expect(rows[0].read_rows).toBeNull();
      expect(rows[0].read_bytes).toBeNull();
      expect(rows[0].query_count).toBeNull();
    });

    it("creates the incremental state empty — the collectors fill it", async () => {
      expect(await h.rowCount("obs_query_shape_days")).toBe(0);
      expect(await h.rowCount("obs_table_write_times")).toBe(0);
    });

    it("stores the new columns' values", async () => {
      await h.rawRun(sql`UPDATE obs_collector_status SET read_rows = ${123456789012}, read_bytes = ${3.5e10}, query_count = ${4} WHERE connection_id = 'conn-1'`);
      await h.rawRun(sql`INSERT INTO obs_query_shape_days (connection_id, database_name, table_name, fingerprint, day, runs, users, p95_ms, read_rows_sum, sample_query)
        VALUES ('conn-1', 'db', 't', '123', ${Date.now()}, 5, 2, 12.5, 1000, 'SELECT 1')`);
      const rows = await h.rawAll(sql`SELECT read_rows, read_bytes, query_count FROM obs_collector_status WHERE connection_id = 'conn-1'`);
      expect(Number(rows[0].read_rows)).toBe(123456789012);
      expect(Number(rows[0].read_bytes)).toBe(3.5e10);
      expect(Number(rows[0].query_count)).toBe(4);
    });

    it("is idempotent when re-run", async () => {
      const migration = MIGRATIONS.find((m) => m.version === "1.57.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      expect(await h.rowCount("obs_query_shape_days")).toBe(1);
      expect(await h.rowCount("obs_collector_status")).toBe(1);
    });
  });

  describe(`migrations · ADR 0019 agent registry upgrade [${dialect}]`, () => {
    let threadId = "";

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true, through: "1.55.0" });
      // An existing chat thread from before the registry existed.
      const userId = await insertUser(`chat-${randomUUID().slice(0, 8)}`);
      threadId = randomUUID();
      await h.rawRun(sql`INSERT INTO rbac_ai_chat_threads (id, user_id, title, created_at, updated_at)
        VALUES (${threadId}, ${userId}, 'old thread', ${now()}, ${now()})`);
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("keeps existing chat threads, bound to the default agent (agent_id NULL)", async () => {
      const rows = await h.rawAll(sql`SELECT title, agent_id FROM rbac_ai_chat_threads WHERE id = ${threadId}`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].title)).toBe("old thread");
      expect(rows[0].agent_id).toBeNull();
    });

    it("creates the registry empty — built-ins come from the startup seed sync", async () => {
      expect(await h.rowCount("ai_agents")).toBe(0);
      expect(await h.rowCount("ai_feature_bindings")).toBe(0);
      const state = await h.rawAll(sql`SELECT version FROM ai_registry_state WHERE id = 1`);
      expect(Number(state[0].version)).toBe(0);
    });

    it("is idempotent when re-run", async () => {
      const migration = MIGRATIONS.find((m) => m.version === "1.56.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      expect(await h.rowCount("ai_registry_state")).toBe(1);
      expect(await h.columnExists("rbac_ai_chat_threads", "agent_id")).toBe(true);
      const grants = await h.rawAll(sql`
        SELECT COUNT(*) AS c FROM rbac_role_permissions rp
        JOIN rbac_permissions p ON p.id = rp.permission_id
        JOIN rbac_roles r ON r.id = rp.role_id
        WHERE r.name = 'admin' AND p.name = 'ai_agents:manage'`);
      expect(Number(grants[0].c)).toBe(1);
    });
  });

  describe(`migrations · ADR 0020 AI usage upgrade [${dialect}]`, () => {
    // 1.58.0 adds the usage tables and a nullable pricing column on
    // rbac_ai_models. An existing model must keep its params and get no price
    // (cost shows as unknown, never 0), a price must round-trip as JSON, the
    // new tables must accept a request with NULL cost, and re-running the
    // migration must change nothing.
    const providerId = randomUUID();
    const modelId = randomUUID();
    const params = { temperature: 0.2, maxTokens: 4096 };

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ through: "1.57.0" });
      await h.rawRun(sql`INSERT INTO rbac_ai_providers
        (id, name, provider_type, is_active, created_at, updated_at)
        VALUES (${providerId}, 'Acme Anthropic', 'anthropic', ${b(true)}, ${now()}, ${now()})`);
      await h.rawRun(sql`INSERT INTO rbac_ai_models
        (id, provider_id, name, model_id, params, created_at, updated_at)
        VALUES (${modelId}, ${providerId}, 'Sonnet', 'claude-sonnet', ${JSON.stringify(params)}, ${now()}, ${now()})`);
      expect(await h.columnExists("rbac_ai_models", "pricing")).toBe(false);
      // 1.0.0 seeds roles from today's defaults, so drop the permission to look
      // like an install that predates it.
      await h.rawRun(sql`DELETE FROM rbac_role_permissions WHERE permission_id IN (SELECT id FROM rbac_permissions WHERE name = 'ai_usage:view')`);
      await h.rawRun(sql`DELETE FROM rbac_permissions WHERE name = 'ai_usage:view'`);
      expect(await h.permissionExists("ai_usage:view")).toBe(false);
      await runMigrations();
    }, 60_000);

    it("keeps the existing model and its params, with no price", async () => {
      const rows = await h.rawAll(sql`SELECT model_id, params, pricing FROM rbac_ai_models WHERE id = ${modelId}`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].model_id)).toBe("claude-sonnet");
      const stored = typeof rows[0].params === "string" ? JSON.parse(String(rows[0].params)) : rows[0].params;
      expect(stored).toEqual(params);
      expect(rows[0].pricing).toBeNull();
    });

    it("round-trips a price through the new column", async () => {
      const pricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
      await h.rawRun(sql`UPDATE rbac_ai_models SET pricing = ${JSON.stringify(pricing)} WHERE id = ${modelId}`);
      const rows = await h.rawAll(sql`SELECT pricing FROM rbac_ai_models WHERE id = ${modelId}`);
      const stored = typeof rows[0].pricing === "string" ? JSON.parse(String(rows[0].pricing)) : rows[0].pricing;
      expect(stored).toEqual(pricing);
    });

    it("grants ai_usage:view to admin on upgrade", async () => {
      expect(await h.roleHasPermission("admin", "ai_usage:view")).toBe(true);
      expect(await h.roleHasPermission("super_admin", "ai_usage:view")).toBe(true);
    });

    it("stores a request with unknown cost and large counters", async () => {
      const id = randomUUID();
      const big = 5_000_000_000_000;
      await h.rawRun(sql`INSERT INTO ai_usage_requests
        (id, started_at, feature_id, source, status, ch_read_bytes, cost_usd)
        VALUES (${id}, ${Date.now()}, 'chat', 'chat', 'ok', ${big}, ${null})`);
      const rows = await h.rawAll(sql`SELECT ch_read_bytes, cost_usd, input_tokens FROM ai_usage_requests WHERE id = ${id}`);
      expect(Number(rows[0].ch_read_bytes)).toBe(big);
      expect(rows[0].cost_usd).toBeNull();
      expect(Number(rows[0].input_tokens)).toBe(0);
    });

    it("is idempotent when re-run", async () => {
      const migration = MIGRATIONS.find((m) => m.version === "1.58.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      expect(await h.rowCount("ai_usage_requests")).toBe(1);
      const rows = await h.rawAll(sql`SELECT pricing FROM rbac_ai_models WHERE id = ${modelId}`);
      expect(rows[0].pricing).not.toBeNull();
      const grants = await h.rawAll(sql`
        SELECT COUNT(*) AS c FROM rbac_role_permissions rp
        JOIN rbac_permissions p ON p.id = rp.permission_id
        JOIN rbac_roles r ON r.id = rp.role_id
        WHERE r.name = 'admin' AND p.name = 'ai_usage:view'`);
      expect(Number(grants[0].c)).toBe(1);
      expect((await runMigrations()).migrationsApplied).toEqual([]);
    });
  });

  describe(`migrations · 1.59.0 thread_id on an earlier 1.58.0 [${dialect}]`, () => {
    // An install that ran 1.58.0 before it created thread_id: every usage write
    // failed. 1.59.0 must add the column, keep existing rows, and be a no-op
    // where 1.58.0 already created it.
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true, through: "1.58.0" });
      await h.rawRun(sql`ALTER TABLE ai_usage_requests DROP COLUMN thread_id`);
      await h.rawRun(sql`INSERT INTO ai_usage_requests (id, started_at, feature_id, source, status) VALUES ('old', ${Date.now()}, 'chat', 'chat', 'ok')`);
      expect(await h.columnExists("ai_usage_requests", "thread_id")).toBe(false);
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("adds the column and keeps existing requests", async () => {
      expect(await h.columnExists("ai_usage_requests", "thread_id")).toBe(true);
      const rows = await h.rawAll(sql`SELECT thread_id FROM ai_usage_requests WHERE id = 'old'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].thread_id).toBeNull();
      await h.rawRun(sql`INSERT INTO ai_usage_requests (id, started_at, thread_id, feature_id, source, status) VALUES ('new', ${Date.now()}, 't1', 'chat', 'chat', 'ok')`);
    });

    it("is a no-op when re-run", async () => {
      const migration = MIGRATIONS.find((m) => m.version === "1.59.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      expect(await h.rowCount("ai_usage_requests")).toBe(2);
    });
  });

  describe(`migrations · 1.60.0 AI request origin [${dialect}]`, () => {
    // Requests recorded before 1.60.0 have no origin: they keep NULL, and new
    // rows store the origin, token and client.
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true, through: "1.59.0" });
      await h.rawRun(sql`INSERT INTO ai_usage_requests (id, started_at, feature_id, source, status) VALUES ('before', ${Date.now()}, 'chat', 'chat', 'ok')`);
      expect(await h.columnExists("ai_usage_requests", "origin")).toBe(false);
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("adds the columns and keeps existing requests without an origin", async () => {
      const rows = await h.rawAll(sql`SELECT origin, pat_id, client_name FROM ai_usage_requests WHERE id = 'before'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].origin).toBeNull();
      expect(rows[0].pat_id).toBeNull();
      expect(rows[0].client_name).toBeNull();
    });

    it("stores the origin of new requests", async () => {
      await h.rawRun(sql`INSERT INTO ai_usage_requests (id, started_at, feature_id, source, status, origin, pat_id, client_name)
        VALUES ('after', ${Date.now()}, 'optimize-query', 'feature', 'ok', 'mcp', 'pat-1', 'Claude Code')`);
      const rows = await h.rawAll(sql`SELECT origin, pat_id, client_name FROM ai_usage_requests WHERE id = 'after'`);
      expect(rows[0]).toEqual({ origin: "mcp", pat_id: "pat-1", client_name: "Claude Code" });
    });

    it("is a no-op when re-run", async () => {
      const migration = MIGRATIONS.find((m) => m.version === "1.60.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      expect(await h.rowCount("ai_usage_requests")).toBe(2);
      expect((await runMigrations()).migrationsApplied).toEqual([]);
    });
  });
}

// ADR 0021 upgrade: an install from before dashboards gets the tables and the
// default grants, keeps every unrelated grant, and re-running changes nothing.
for (const dialect of DIALECTS) {
  describe(`migrations · ADR 0021 dashboards upgrade [${dialect}]`, () => {
    const grantsOf = async (role: string): Promise<string[]> => {
      const rows = await h.rawAll(sql`
        SELECT p.name AS name FROM rbac_role_permissions rp
        JOIN rbac_permissions p ON p.id = rp.permission_id
        JOIN rbac_roles r ON r.id = rp.role_id
        WHERE r.name = ${role} ORDER BY p.name`);
      return rows.map((r) => String(r.name));
    };
    let viewerBefore: string[] = [];

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ through: "1.60.0" });
      // 1.0.0 seeds roles from today's defaults, so remove the dashboards
      // permissions to look like an install that predates them.
      await h.rawRun(sql`DELETE FROM rbac_role_permissions WHERE permission_id IN (SELECT id FROM rbac_permissions WHERE name LIKE 'dashboards:%')`);
      await h.rawRun(sql`DELETE FROM rbac_permissions WHERE name LIKE 'dashboards:%'`);
      for (const t of DASHBOARD_TABLE_NAMES) expect(await h.tableExists(t)).toBe(false);
      viewerBefore = await grantsOf("viewer");
      // Through 1.62.0: the rows below are 1.61.0's format 1 shape, which 1.63.0 converts and 1.64.0 drops.
      await runMigrations({ through: "1.62.0" });
    }, 60_000);

    it("creates the tables and grants the defaults per role", async () => {
      for (const t of DASHBOARD_TABLE_NAMES) expect(await h.tableExists(t)).toBe(true);
      for (const [role, granted] of Object.entries(DASHBOARD_GRANTS)) {
        for (const p of DASHBOARD_PERMISSION_NAMES) expect(await h.roleHasPermission(role, p)).toBe(granted.includes(p));
      }
    });

    it("keeps every grant that is not a dashboards permission", async () => {
      expect(await grantsOf("viewer")).toEqual([...viewerBefore, "dashboards:view"].sort());
    });

    it("stores a dashboard with panels, a share, a pin and a panel alert", async () => {
      const at = Date.now();
      await h.rawRun(sql`INSERT INTO dashboards (id, title, owner_id, time_range, created_at, updated_at) VALUES ('d1', 'Orders', 'u1', '6h', ${at}, ${at})`);
      await h.rawRun(sql`INSERT INTO dashboard_panels (id, dashboard_id, position, title, sql, viz, width, height, created_at, updated_at)
        VALUES ('p1', 'd1', 0, 'Rows', 'SELECT 1', '{}', 6, 'm', ${at}, ${at})`);
      await h.rawRun(sql`INSERT INTO dashboard_shares (dashboard_id, role_id, can_edit, created_at) VALUES ('d1', 'r1', 1, ${at})`);
      await h.rawRun(sql`INSERT INTO dashboard_pins (user_id, dashboard_id, created_at) VALUES ('u1', 'd1', ${at})`);
      await h.rawRun(sql`INSERT INTO dashboard_alerts (id, dashboard_id, panel_id, name, owner_id, connection_id, severity, config, created_at, updated_at)
        VALUES ('a1', 'd1', 'p1', 'Too many rows', 'u1', 'c1', 'warning', '{}', ${at}, ${at})`);
      await h.rawRun(sql`INSERT INTO dashboard_alert_channels (alert_id, channel_id) VALUES ('a1', 'ch1')`);
      await h.rawRun(sql`INSERT INTO dashboard_alert_state (alert_id, state, since, last_value) VALUES ('a1', 'ok', ${at}, ${1.5})`);
      const rows = await h.rawAll(sql`SELECT description, refresh_seconds, variables, version FROM dashboards WHERE id = 'd1'`);
      expect(rows[0].description).toBe("");
      expect(Number(rows[0].refresh_seconds)).toBe(0);
      expect(rows[0].variables).toBe("[]");
      expect(Number(rows[0].version)).toBe(1);
      const panels = await h.rawAll(sql`SELECT fleet FROM dashboard_panels WHERE id = 'p1'`);
      expect(Number(panels[0].fleet)).toBe(0);
      const alert = await h.rawAll(sql`SELECT enabled FROM dashboard_alerts WHERE id = 'a1'`);
      expect(Number(alert[0].enabled)).toBe(1);
      const state = await h.rawAll(sql`SELECT breaches, last_value, last_error FROM dashboard_alert_state WHERE alert_id = 'a1'`);
      expect(Number(state[0].breaches)).toBe(0);
      expect(Number(state[0].last_value)).toBe(1.5);
      expect(state[0].last_error).toBeNull();
    });

    it("is idempotent when re-run", async () => {
      const migration = MIGRATIONS.find((m) => m.version === "1.61.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      expect(await h.rowCount("dashboards")).toBe(1);
      expect(await h.rowCount("dashboard_panels")).toBe(1);
      const grants = await h.rawAll(sql`
        SELECT COUNT(*) AS c FROM rbac_role_permissions rp
        JOIN rbac_permissions p ON p.id = rp.permission_id
        JOIN rbac_roles r ON r.id = rp.role_id
        WHERE r.name = 'admin' AND p.name = 'dashboards:manage'`);
      expect(Number(grants[0].c)).toBe(1);
      expect((await runMigrations({ through: "1.62.0" })).migrationsApplied).toEqual([]);
    });
  });

  describe(`migrations · ADR 0022 guardrails upgrade [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ through: "1.61.0" });
      // 1.0.0 seeds roles from today's defaults, so remove the guardrail
      // permissions to look like an install that predates them.
      await h.rawRun(sql`DELETE FROM rbac_role_permissions WHERE permission_id IN (SELECT id FROM rbac_permissions WHERE name LIKE 'ai_guardrails:%')`);
      await h.rawRun(sql`DELETE FROM rbac_permissions WHERE name LIKE 'ai_guardrails:%'`);
      for (const t of AI_GUARDRAIL_TABLE_NAMES) expect(await h.tableExists(t)).toBe(false);
      await runMigrations();
    }, 60_000);

    it("creates the tables empty and grants admins only", async () => {
      for (const t of AI_GUARDRAIL_TABLE_NAMES) expect(await h.rowCount(t)).toBe(0);
      expect(await h.roleHasPermission("admin", "ai_guardrails:manage")).toBe(true);
      expect(await h.roleHasPermission("developer", "ai_guardrails:view")).toBe(false);
    });

    it("is idempotent when re-run", async () => {
      const migration = MIGRATIONS.find((m) => m.version === "1.62.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      const grants = await h.rawAll(sql`
        SELECT COUNT(*) AS c FROM rbac_role_permissions rp
        JOIN rbac_permissions p ON p.id = rp.permission_id
        JOIN rbac_roles r ON r.id = rp.role_id
        WHERE r.name = 'admin' AND p.name = 'ai_guardrails:manage'`);
      expect(Number(grants[0].c)).toBe(1);
      expect((await runMigrations()).migrationsApplied).toEqual([]);
    });
  });

  // ADR 0023: every format 1 dashboard is converted in place — layout, chart
  // settings, alert configs and one history entry — exactly as a format 1 file
  // converts; unreadable rows are left as they are; re-running changes nothing.
  describe(`migrations · ADR 0023 dashboards v2 conversion [${dialect}]`, () => {
    const LINE_V1 = { version: 1, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null };
    const TABLE_V1 = { ...LINE_V1, type: "table", x: null, y: [], unit: "none" };
    const VARIABLES = [{ name: "db", label: "DB", kind: "identifier", options: { source: "static", values: ["shop"] }, default: "shop" }];
    const THRESHOLD = { column: "v", reduce: "max", op: ">", value: 5, forEvaluations: 1, everyMinutes: 5, range: "15m", values: {} };
    const SQL_A = "SELECT now() AS t, 1 AS v";
    const at = 1_800_000_000_000;
    const P1 = "11111111-1111-4111-8111-111111111111";
    const P2 = "22222222-2222-4222-8222-222222222222";
    const P3 = "33333333-3333-4333-8333-333333333333";
    const Q1 = "44444444-4444-4444-8444-444444444444";

    const snapshot = async (): Promise<unknown> => ({
      panels: await h.rawAll(sql`SELECT id, kind, viz, x, y, w, h FROM dashboard_panels ORDER BY id`),
      versions: await h.rawAll(sql`SELECT dashboard_id, version, document, source FROM dashboard_versions ORDER BY dashboard_id, version`),
      alerts: await h.rawAll(sql`SELECT id, config FROM dashboard_alerts ORDER BY id`),
    });

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ through: "1.62.0" });
      const dashboard = async (id: string, version: number): Promise<void> => {
        await h.rawRun(sql`INSERT INTO dashboards (id, title, description, owner_id, time_range, refresh_seconds, variables, version, created_at, updated_at)
          VALUES (${id}, ${`Dash ${id}`}, 'Old', 'u1', '6h', 60, ${JSON.stringify(id === "d1" ? VARIABLES : [])}, ${version}, ${at}, ${at})`);
      };
      const panel = async (id: string, dashboardId: string, position: number, viz: unknown, width: number, height: string, fleet = 0): Promise<void> => {
        await h.rawRun(sql`INSERT INTO dashboard_panels (id, dashboard_id, position, title, sql, viz, width, height, fleet, created_at, updated_at)
          VALUES (${id}, ${dashboardId}, ${position}, ${`Panel ${id}`}, ${SQL_A}, ${typeof viz === "string" ? viz : JSON.stringify(viz)}, ${width}, ${height}, ${fleet}, ${at}, ${at})`);
      };
      await dashboard("d1", 3);
      // Inserted out of order: the conversion follows `position`, not insertion.
      await panel(P3, "d1", 2, TABLE_V1, 12, "m", 1);
      await panel(P1, "d1", 0, LINE_V1, 6, "s");
      await panel(P2, "d1", 1, LINE_V1, 6, "l");
      await dashboard("d2", 1);
      await panel(Q1, "d2", 0, "{}", 6, "m");
      await dashboard("d3", 1);
      const alert = async (id: string, config: string): Promise<void> => {
        await h.rawRun(sql`INSERT INTO dashboard_alerts (id, dashboard_id, panel_id, name, owner_id, connection_id, severity, config, created_at, updated_at)
          VALUES (${id}, 'd1', ${P1}, ${`Alert ${id}`}, 'u1', 'c1', 'warning', ${config}, ${at}, ${at})`);
      };
      await alert("a1", JSON.stringify(THRESHOLD));
      await alert("a2", "not json");
      await alert("a3", JSON.stringify({ kind: "threshold", ...THRESHOLD }));
      await runMigrations({ through: "1.63.0" });
    }, 60_000);

    it("lays panels out as the old grid placed them and converts their chart settings", async () => {
      const rows = await h.rawAll(sql`SELECT id, kind, viz, x, y, w, h FROM dashboard_panels WHERE dashboard_id = 'd1' ORDER BY position`);
      expect(rows.map((r) => [r.id, r.kind, Number(r.x), Number(r.y), Number(r.w), Number(r.h)])).toEqual([
        [P1, "chart", 0, 0, 12, 12],
        [P2, "chart", 12, 0, 12, 12],
        [P3, "chart", 0, 12, 24, 9],
      ]);
      expect(JSON.parse(String(rows[0].viz))).toEqual({ ...LINE_V1, version: 2, links: [], baseline: null });
      const annotations = await h.rawAll(sql`SELECT annotations FROM dashboards WHERE id = 'd1'`);
      expect(JSON.parse(String(annotations[0].annotations))).toEqual(["ddl", "upgrades", "settings", "writers", "alerts", "incidents", "fixes", "notes"]);
    });

    it("records the converted document as the dashboard's current version, identical to converting a format 1 file", async () => {
      const versions = await h.rawAll(sql`SELECT dashboard_id, version, document, saved_by, source FROM dashboard_versions ORDER BY dashboard_id`);
      expect(versions.map((v) => [v.dashboard_id, Number(v.version), v.saved_by, v.source])).toEqual([["d1", 3, "u1", "migration"], ["d3", 1, "u1", "migration"]]);
      const file = parseDashboardDocument({
        title: "Dash d1", description: "Old", timeRange: "6h", refreshSeconds: 60, connectionScope: { kind: "any" }, variables: VARIABLES,
        panels: [
          { id: P1, title: `Panel ${P1}`, sql: SQL_A, viz: LINE_V1, width: 6, height: "s", fleet: false },
          { id: P2, title: `Panel ${P2}`, sql: SQL_A, viz: LINE_V1, width: 6, height: "l", fleet: false },
          { id: P3, title: `Panel ${P3}`, sql: SQL_A, viz: TABLE_V1, width: 12, height: "m", fleet: true },
        ],
      });
      expect(file.ok).toBe(true);
      expect(JSON.parse(String(versions[0].document))).toEqual(file.ok ? file.input : null);
      expect(JSON.parse(String(versions[1].document)).panels).toEqual([]);
    });

    it("leaves a dashboard whose stored data cannot be read as it was", async () => {
      const rows = await h.rawAll(sql`SELECT viz, w, h FROM dashboard_panels WHERE id = ${Q1}`);
      expect(rows[0].viz).toBe("{}");
      expect(Number(rows[0].w)).toBe(0);
      expect(await h.rawAll(sql`SELECT 1 FROM dashboard_versions WHERE dashboard_id = 'd2'`)).toEqual([]);
    });

    it("gives panel alerts kind threshold, leaving unreadable and converted configs alone", async () => {
      const rows = await h.rawAll(sql`SELECT id, config FROM dashboard_alerts ORDER BY id`);
      expect(JSON.parse(String(rows[0].config))).toEqual({ kind: "threshold", ...THRESHOLD });
      expect(rows[1].config).toBe("not json");
      expect(JSON.parse(String(rows[2].config))).toEqual({ kind: "threshold", ...THRESHOLD });
    });

    it("is idempotent when re-run", async () => {
      const before = await snapshot();
      const migration = MIGRATIONS.find((m) => m.version === "1.63.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      expect(await snapshot()).toEqual(before);
    });

    it("then drops the old sizes, and the store reads every converted dashboard", async () => {
      expect((await runMigrations({ through: "1.64.0" })).migrationsApplied).toEqual(["1.64.0"]);
      expect(await h.columnExists("dashboard_panels", "width")).toBe(false);
      const migration = MIGRATIONS.find((m) => m.version === "1.64.0")!;
      const { getDatabase } = await import("./index");
      await migration.up(getDatabase());
      const store = await import("../../services/dashboards/store");
      const d1 = await store.getDashboard("d1");
      expect(d1?.panels.map((p) => [p.id, p.kind, p.layout])).toEqual([
        [P1, "chart", { x: 0, y: 0, w: 12, h: 12 }],
        [P2, "chart", { x: 12, y: 0, w: 12, h: 12 }],
        [P3, "chart", { x: 0, y: 12, w: 24, h: 9 }],
      ]);
      expect((await store.getDashboard("d3"))?.panels).toEqual([]);
      // Unreadable before, unreadable after — an explicit error, never a default.
      await expect(store.getDashboard("d2")).rejects.toThrow(`Stored layout of panel ${Q1} is not a place on the canvas`);
      expect((await store.listVersions("d1")).map((v) => [v.version, v.source])).toEqual([[3, "migration"]]);
    });
  });
}

// ---------------------------------------------------------------------------
// Concurrent migration runners (Postgres only).
//
// During a rolling deploy / scale-up, several replicas boot and call
// runMigrations() against the same Postgres at once. Without the advisory lock
// they race on the version table (UNIQUE version) and on non-idempotent steps,
// crashing the loser. With the lock, exactly one runs and the rest no-op.
//
// SQLite is single-process and not a multi-replica target, so this only applies
// to Postgres.
// ---------------------------------------------------------------------------
describe("migrations · concurrent runners [postgres]", () => {
  beforeAll(async () => {
    await h.freshDatabase("postgres", pg);
  }, 60_000);

  it("serializes concurrent runMigrations without error or duplicate records", async () => {
    // Fire several runners at once against the same fresh database. The advisory
    // lock must serialize them: the winner applies the full chain, the others wait
    // and then observe everything already applied.
    const results = await Promise.all([
      runMigrations({ skipSeed: true }),
      runMigrations({ skipSeed: true }),
      runMigrations({ skipSeed: true }),
    ]);

    // Exactly one runner applied the chain; the rest applied nothing.
    const appliedChain = results.filter((r) => r.migrationsApplied.length > 0);
    expect(appliedChain).toHaveLength(1);
    expect(appliedChain[0].migrationsApplied).toEqual(MIGRATIONS.map((m) => m.version));
    for (const r of results) {
      if (r.migrationsApplied.length === 0) {
        expect(r.migrationsApplied).toEqual([]);
      }
    }

    // Every migration recorded exactly once (no duplicate-key crash, no double-apply).
    for (const m of MIGRATIONS) {
      const rows = await h.rawAll(sql`SELECT 1 FROM _rbac_migrations WHERE version = ${m.version}`);
      expect(rows).toHaveLength(1);
    }

    // Final schema matches a normal install.
    for (const m of MIGRATIONS) {
      await VERSION_CHECKS[m.version]();
    }
  }, 60_000);
});
