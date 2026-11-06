# admin/components

## Overview

One folder per admin page; each exports a default page component. `clickhouse/` holds the wizards and hooks shared by `ClickHouseUsers` and `ClickHouseRoles`. No source files live directly here.

## Subdirectories & Boundaries

- AiModels: [AiModels](./AiModels/README.md) - Admin page with Deployments, Provider models and Providers tabs for CRUD of AI providers, base models (runtime params and per-1M-token pricing) and deployment configs via the `rbacAi*Api` clients in `@/api/rbac`.
- AlertingSettings: [AlertingSettings](./AlertingSettings/README.md) - Admin > Alerting page (ADR 0026) with Overview, Channels, Rules and Activity tabs whose view and filters live in the URL; Rules merges fleet rules, dashboard alerts, Data Health, scheduled queries, triage and remediation into one list.
- ClickHouseRoles: [ClickHouseRoles](./ClickHouseRoles/README.md) - Lists native ClickHouse roles and opens `ClickHouseRoleWizard` for create/edit, with enable/disable, delete and automatic reconnect when the ClickHouse session has expired.
- ClickHouseUsers: [ClickHouseUsers](./ClickHouseUsers/README.md) - Lists native ClickHouse users and opens `ClickHouseUserWizard` for create/edit, with delete, an extract-direct-grants-to-role action and automatic session reconnect.
- ConnectionManagement: [ConnectionManagement](./ConnectionManagement/README.md) - CRUD for saved ClickHouse connections with a create/edit dialog that tests the connection and shows a per-feature privilege report with GRANT statements, plus activate/deactivate, environment tags and a global collector-schedule sheet.
- CreateUser: [CreateUser](./CreateUser/README.md) - Page for creating an RBAC user with email, username, optional display name, a generated or manual password and one role; shows a generated password once after creation.
- DataAccessPolicies: [DataAccessPolicies](./DataAccessPolicies/README.md) - Admin UI to list, create, edit and delete named data access policies (allow/deny database/table pattern rules scoped per connection) through a three-step wizard.
- EditUser: [EditUser](./EditUser/README.md) - Page that loads one RBAC user by the `:userId` route param and edits profile, single role, active status, password and linked SSO identities, plus deletion, through `@/api/rbac` only.
- SsoSettings: [SsoSettings](./SsoSettings/README.md) - Admin page for global SSO settings and OIDC/OAuth2/SAML provider CRUD through a three-step wizard; config-sourced providers and settings are read-only.
- UserManagement: [UserManagement](./UserManagement/README.md) - Paginated, filterable RBAC user list in card or list layout with saved filter/layout preferences and edit, activate/deactivate and reset-password row actions.
- clickhouse: [clickhouse](./clickhouse/README.md) - Building blocks for native ClickHouse user/role management: user and role wizards, a privilege-tree picker, a database/table scope picker, a cluster dropdown and a session-reconnect hook.
