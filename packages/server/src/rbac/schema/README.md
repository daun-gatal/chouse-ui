# RBAC Schema

## Overview
Drizzle ORM table definitions for the core RBAC metadata database, written
twice (SQLite in `sqlite.ts`, PostgreSQL in `postgres.ts`) with identical table
names and shapes, plus the dialect-agnostic constants in `base.ts`: system
roles, the permission catalog, default role grants, resource types, and audit
action names. Feature tables added later (AI, dashboards, observe, notify, MCP
OAuth, ...) are defined next to their migrations in [`../db/`](../db/README.md),
not here.

## Interface
- `base.ts` (re-exported by `index.ts`)
  - `[base.ts:SYSTEM_ROLES]` (`super_admin`, `admin`, `developer`, `analyst`, `viewer`, `guest`), `SystemRole`, `[base.ts:ROLE_HIERARCHY]` (100/80/60/40/20/10).
  - `[base.ts:PERMISSIONS]` / `Permission` - `resource:action` strings (for example `users:view`, `schema:override`, `dashboards:manage`).
  - `[base.ts:DEFAULT_ROLE_PERMISSIONS]` - default permission set per system role.
  - `[base.ts:OBSERVE_VIEW_PERMISSIONS]`, `[base.ts:OBSERVE_PERMISSIONS_ALL]`.
  - `[base.ts:RESOURCE_TYPES]` / `ResourceType`; `[base.ts:AUDIT_ACTIONS]` / `AuditAction` - `resource.action` strings (for example `schema.override`, `ai_agent.create`).
- `sqlite.ts` / `postgres.ts` - Drizzle tables: `users` (`rbac_users`), `roles`, `permissions`, `userRoles`, `rolePermissions`, `resourcePermissions`, `sessions`, `userIdentities`, `ssoSettings`, `ssoProviders`, `auditLogs`, `apiKeys`, `clickhouseConnections`, `dataAccessPolicies`, `dataAccessPolicyRules`, `roleDataAccessPolicies`, `clickhouseRoleState`, `userFavorites`, `userRecentItems`, `savedQueries`, `userPreferences`, `aiProviders`, `aiModels`, `aiConfigs`, `aiChatThreads`, `aiChatMessages` (all `rbac_*`), with `$inferSelect`/`$inferInsert` row types (`User`, `NewUser`, `Role`, `AuditLog`, `ClickHouseConnection`, ...) `[sqlite.ts]`, `[postgres.ts]`.
- `index.ts` - re-exports `base.ts`, re-exports common row types from `sqlite.ts` (same shape on both dialects), and defines API shapes `UserWithRoles`, `RoleWithPermissions`, `SessionWithUser`, `AuditLogWithUser`, `UserResponse`, `RoleResponse`, `PermissionResponse`, `CreateUserInput`, `UpdateUserInput`, `CreateRoleInput`, `UpdateRoleInput` `[index.ts]`.

## Invariants
- `sqlite.ts` and `postgres.ts` must define the same tables with the same table names and column shapes; `index.ts` exports row types from `sqlite.ts` only on that assumption `[index.ts]`.
- The active dialect's schema is chosen at runtime by `[../db/index.ts]`, which imports both modules.
- Schema files describe tables but do not create them: every table or column change also needs a migration in `../db/migrations.ts` with a `VERSION_CHECKS` entry and tests on both dialects (project rule in `AGENTS.md`).
- Permission strings use `:` (`PERMISSIONS`) while audit actions use `.` (`AUDIT_ACTIONS`); for example `PERMISSIONS.SCHEMA_OVERRIDE = 'schema:override'` and `AUDIT_ACTIONS.SCHEMA_OVERRIDE = 'schema.override'` `[base.ts]`.
- Role checks for `super_admin`/`admin` compare against `SYSTEM_ROLES` values; `ROLE_HIERARCHY` orders them `[base.ts]`.

## Side Effects
- None. Declarations only; no I/O at import.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Schema/migration parity on both dialects: `./scripts/test-migrations.sh` (requires Docker)
