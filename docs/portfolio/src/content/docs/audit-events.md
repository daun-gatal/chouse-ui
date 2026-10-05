---
generated: AUDIT_ACTIONS in packages/server/src/rbac/schema/base.ts
---
Every action the [audit log](/docs/audit-log/) can record, by area — 124 in all. Filter the log by these names in **Admin › Audit logs**, or match them in an export.

| Area | Actions |
| --- | --- |
| Sign-in | `auth.login`, `auth.logout`, `auth.login_failed`, `auth.password_change`, `auth.sso_login`, `auth.sso_login_failed` |
| Personal access tokens | `pat.create`, `pat.revoke`, `pat.rotate` |
| MCP | `mcp.tool_call` |
| Users | `user.create`, `user.update`, `user.delete`, `user.role_assign`, `user.role_revoke`, `user.sso_identity_unlink` |
| Single sign-on | `sso.settings_update`, `sso.provider_create`, `sso.provider_update`, `sso.provider_delete`, `sso.provider_test`, `sso.user_provision`, `sso.identity_link` |
| Roles | `role.create`, `role.update`, `role.delete` |
| ClickHouse | `clickhouse.user_create`, `clickhouse.user_update`, `clickhouse.user_delete`, `clickhouse.user_extract_role`, `clickhouse.role_create`, `clickhouse.role_update`, `clickhouse.role_delete`, `clickhouse.role_disable`, `clickhouse.role_enable`, `clickhouse.query_execute`, `clickhouse.query_explain`, `clickhouse.database_create`, `clickhouse.database_drop`, `clickhouse.table_create`, `clickhouse.table_alter`, `clickhouse.table_drop` |
| Settings | `settings.update` |
| Live queries | `live_query.kill` |
| Audit log | `audit.delete` |
| AI providers | `ai_provider.create`, `ai_provider.update`, `ai_provider.delete` |
| AI provider models | `ai_model.create`, `ai_model.update`, `ai_model.delete` |
| AI deployments | `ai_config.create`, `ai_config.update`, `ai_config.delete` |
| Connections | `connection.create`, `connection.update`, `connection.delete`, `connection.connect`, `connection.grant_access`, `connection.revoke_access` |
| Data access | `data_access.create`, `data_access.update`, `data_access.delete`, `data_access.bulk_set`, `data_access.assign` |
| Saved queries | `saved_query.create`, `saved_query.update`, `saved_query.delete` |
| Fleet | `fleet.alert_config_update` |
| Doctor | `doctor.scan_run`, `doctor.schedule_update`, `doctor.report_delete` |
| Alerting | `alerting.channel_create`, `alerting.channel_update`, `alerting.channel_delete`, `alerting.channel_test`, `alerting.events_clear` |
| Scheduled queries | `scheduled_query.create`, `scheduled_query.update`, `scheduled_query.delete`, `scheduled_query.run` |
| Data health | `data_health.promise_create`, `data_health.promise_update`, `data_health.promise_delete`, `data_health.promise_run`, `data_health.incident_acknowledge`, `data_health.incident_snooze`, `data_health.incident_note` |
| Data observability | `observe.suggestion_accept`, `observe.suggestion_dismiss`, `observe.criticality_pin`, `observe.incident_acknowledge`, `observe.cost_rates_update`, `observe.codec_trial` |
| Context | `context.update`, `context.metric_upsert`, `context.metric_delete`, `context.dbt_import`, `context.ai_draft` |
| Fixes | `remediation.propose`, `remediation.approve`, `remediation.reject`, `remediation.execute`, `remediation.rollback`, `remediation.credential_update` |
| Schema preflight | `schema.override` |
| Notebooks | `notebook.cell_add` |
| Upgrades | `upgrade.assess`, `upgrade.replay` |
| Agents | `agent.policy_update`, `agent.access_pause`, `agent.mcp_update` |
| AI agents | `ai_agent.create`, `ai_agent.update`, `ai_agent.delete` |
| AI harnesses | `ai_harness.create`, `ai_harness.update`, `ai_harness.delete` |
| AI skills | `ai_skill.create`, `ai_skill.update`, `ai_skill.delete` |
| AI feature bindings | `ai_binding.update` |
| AI agent registry | `ai_registry.reset`, `ai_registry.rollback` |
