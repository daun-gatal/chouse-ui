# RBAC Module

## Overview
CHouse UI's role-based access control system: the metadata database (SQLite or
PostgreSQL) with versioned migrations, users/roles/permissions, JWT sessions,
personal access tokens, SSO, data access policies, encrypted ClickHouse
connections, native ClickHouse user/role management, AI model configuration,
and audit logging. `index.ts` is the module facade used by the server entry;
the root files hold the initializer, the password-login posture, and a
maintenance CLI.

## Interface
- `index.ts`
  - `[index.ts:initializeRbac]` - connect DB, run migrations, seed on first run (or when `needsSeeding()`); returns `{ version, isFirstRun, migrationsApplied, seeded }`.
  - `[index.ts:shutdownRbac]`, `[index.ts:getRbacInfo]`.
  - Re-exports: `./schema`, `./schema/base`, `./services`, `./middleware`, selected `./db` functions (`initializeDatabase`, `closeDatabase`, `getDatabaseType`, `checkDatabaseHealth`, `runMigrations`, `getMigrationStatus`, `needsUpgrade`, `getCurrentVersion`, `isFirstRun`, `APP_VERSION`), and `rbacRoutes` (default export of `./routes`).
- `authConfig.ts`: `[authConfig.ts:isPasswordLoginConfigured]`, `[authConfig.ts:resolvePasswordLoginEnabled]`, `[authConfig.ts:getPasswordLoginEnabled]`, `[authConfig.ts:refreshPasswordLoginState]`, `[authConfig.ts:resetPasswordLoginCache]`, type `PasswordLoginResolution`.
- `cli.ts`: `bun run src/rbac/cli.ts <status|migrate|seed|reset|version>` (package scripts `rbac:status`, `rbac:migrate`, `rbac:seed`, `rbac:reset`, `rbac:version` in `packages/server/package.json`).
- Subdirectories:
  - [constants/](./constants/README.md) - AI provider types, model runtime params, and pricing schema.
  - [db/](./db/README.md) - driver selection, raw SQL helpers, config-generation counter, and the forward-only migration chain.
  - [middleware/](./middleware/README.md) - `rbacAuthMiddleware` and the permission/role gate factories.
  - [routes/](./routes/README.md) - the `/api/rbac` HTTP API.
  - [schema/](./schema/README.md) - Drizzle tables for both dialects, roles, permissions, and audit action names.
  - [services/](./services/README.md) - users, sessions, JWTs, PATs, connections, data access, ClickHouse grants, seeding.
  - [sso/](./sso/README.md) - OIDC/OAuth2/SAML single sign-on and provisioning.

## Invariants
- Password login is on unless `AUTH_PASSWORD_LOGIN_ENABLED` is `false` (compared case-insensitively), and it can only actually turn off when at least one usable SSO provider exists, so admins are never locked out `[authConfig.ts:resolvePasswordLoginEnabled]`.
- The effective password-login state is cached for the hot path and must be refreshed after SSO config changes `[authConfig.ts:refreshPasswordLoginState]`.
- `initializeRbac` must succeed before routes serve; a migration or first-run seed failure is logged and rethrown, while a seed triggered by `needsSeeding()` propagates without its own log `[index.ts:initializeRbac]`.
- `cli.ts reset` refuses to run unless `CONFIRM_RESET=yes`, then drops only a hard-coded list of 8 legacy tables (`_rbac_migrations`, `rbac_audit_logs`, `rbac_refresh_tokens` (no longer in the schema), `rbac_user_roles`, `rbac_role_permissions`, `rbac_permissions`, `rbac_roles`, `rbac_users`); connections, API keys, sessions, SSO/AI and feature tables are left in place, so the reset is partial `[cli.ts:resetDatabase]`.
- Cross-cutting rules from the children: Argon2id passwords, `jose` HS256 JWTs, AES-256-GCM secrets (`services/`); token-first then DB-rechecked permission gates (`middleware/`); idempotent dual-dialect migrations with `VERSION_CHECKS` (`db/`).

## Side Effects
- Opens, migrates, and seeds the RBAC database `[index.ts:initializeRbac]`; closes it on `shutdownRbac`.
- `cli.ts` runs migrations, seeding, or destructive `DROP TABLE IF EXISTS` resets, then exits the process `[cli.ts]`.
- Subdirectories add ClickHouse DDL/grants, outbound IdP calls, audit logs, and a config-generation poller (see child READMEs).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Migrations (SQLite + PostgreSQL via Docker): `./scripts/test-migrations.sh`
- Targeted: `cd packages/server && bun test src/rbac`
