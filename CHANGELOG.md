# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v3.5.1] - 2026-06-16

### Fixed
- **Migrations no longer race across replicas at startup (multi-replica PostgreSQL only)** — every replica runs RBAC migrations on boot, so when running **more than one replica** on PostgreSQL, a rolling deploy or scale-up could have several pods migrate the same database concurrently and the loser would crash on a duplicate version-table insert (or a non-idempotent step). `runMigrations()` now takes a PostgreSQL session-level advisory lock on a dedicated reserved connection, so exactly one replica migrates at a time and the others wait, then observe the work as already applied. Single-replica and SQLite deployments are unaffected (the lock is a no-op there).
- **Login page no longer flashes the password form when password sign-in is disabled** — on refresh the login page optimistically rendered the email/password form and then yanked it away once the auth config loaded and reported password login disabled, leaving a visible flicker before the SSO-only view settled. The sign-in-method area now waits for both the SSO provider list and the auth config to resolve (showing a brief spinner) and renders once, so the correct set of options appears in a single paint. A failed config fetch still falls back to showing the password form, so a config error can't lock everyone out.
- **Login & SSO rate limits now hold across replicas (multi-replica deployments only)** — the brute-force limiter used an in-process counter, so when running **more than one replica** the effective limit was N× the configured value: the load balancer spreads an attacker's attempts across pods and each pod counted separately, silently weakening a security control proportional to replica count. The login and SSO start/callback limiters now share a fixed-window counter in the RBAC database (atomic per-attempt upsert, expired rows swept periodically), enforcing the 10-attempts-per-15-minutes budget across all pods with no new infrastructure (no Redis). The counter now also survives pod restarts, so a deploy/crash no longer resets an attacker's budget. Single-replica deployments are functionally unchanged. The high-volume *resource* limiters (query/AI/general API) intentionally stay in-memory — per-pod throttling is fine there since capacity scales with replicas.

## [v3.5.0] - 2026-06-15

### Added
- **DDL impact simulator** — a read-only "what would this `ALTER` cost" estimator in the Cluster tab. Paste an `ALTER … UPDATE/DELETE` and it estimates rows matched, parts and bytes rewritten, projected duration (from mutation/merge history), and whether free disk can hold the transient rewrite — without executing anything.
- **Predictive "too many parts" alert** — a new fleet alert rule fires when a table is projected to hit its `parts_to_throw_insert` limit within a configurable number of minutes, turning the parts-pressure trend into an early warning before inserts start failing. Configurable in the fleet alert delivery dialog (server-side, delivered to Slack/Google Chat/email) and the in-app alerts bell, and surfaced as a "Parts limit ETA" tile on each fleet card.
- **Parts pressure monitoring** — a new Parts tab in Metrics surfaces the insert-vs-merge race behind ClickHouse's "too many parts" failure mode. For each table it shows the worst partition against `parts_to_throw_insert`, live insert/merge rates, and a projected ETA until the threshold is crossed. Also collected fleet-wide as the `parts_pressure` metric for historical trends.

### Changed
- **Mutation progress** — the Cluster → Mutations view now shows an approximate progress bar (parts done / total) and a Killed status, alongside the existing parts-remaining and failure-reason columns.
- **Fleet alert config & Doctor schedule now persist in the shared database** — alert rules/thresholds, Slack/Google Chat/email delivery settings, and the scheduled-scan config + run-state moved off local pod disk into the shared RBAC DB. This makes settings consistent across replicas, survive restarts, and immune to concurrent-write races. Existing `alert-config.json` / `doctor-schedule.json` files are imported automatically on first upgrade.

### Fixed
- **SSO role mapping now respects the one-role-per-user model** ([#261](https://github.com/daun-gatal/chouse-ui/issues/261)) — when an IdP claim matched multiple mapped groups, SSO tried to assign several roles at once, which violated the `user_id` unique constraint and made the login fail (leaving the user with no role at all). Role sync now collapses multiple matches to the single highest-privilege role (using the same `ROLE_HIERARCHY` precedence as the rest of RBAC) and writes it via an atomic upsert, so a sync can never strip a user's role mid-update. Affected users self-heal on their next login.
- **Scheduled health scans no longer double-fire under multiple replicas** — the scheduled Chouse AI scan is now gated by an atomic per-slot claim in the DB, so exactly one instance runs (and delivers) a given scheduled slot instead of every replica firing it.
- **Fleet memory tile no longer shows `0%` / `0 Bytes` on cgroup-limited nodes** ([#264](https://github.com/daun-gatal/chouse-ui/issues/264)) — containerised ClickHouse nodes that don't expose `OSMemoryTotal` were rendering a phantom `~2 GB / 0 Bytes → 0%`. The fleet `summary` metric now falls back through `OSMemoryTotal` → `CGroupMemoryTotal` (excluding the `~2^63` "no limit" sentinel) → `max_server_memory_usage` for the memory ceiling. When none is available the card shows `X used / —` and `—%` honestly instead of a misleading `0%`. `formatBytes()` was also extended to `PB`/`EB` and clamped so an out-of-range value can never render as `"8 undefined"`.

## [v3.4.0] - 2026-06-14

### Added
- **Disable password login** — A new `auth.password_login.enabled` setting (env `AUTH_PASSWORD_LOGIN_ENABLED`) lets operators turn off username/password sign-in to require SSO. Enabled by default. Fail-safe: it is ignored unless at least one usable SSO provider is configured, so a misconfiguration can never lock everyone out. The login page hides the password form and `POST /rbac/auth/login` returns `403` when disabled.
- **SSO setup guide** — New on-page SSO section on the docs site plus a full [`docs/sso.md`](docs/sso.md) reference covering OIDC / OAuth2 / SAML setup, config vs. UI precedence, role mapping, and security notes.
- **User management card & list views** — The user directory can now switch between a card grid and a dense, scannable table (status, auth method, roles, last login) for quick analysis. The chosen layout is remembered per user.

### Changed
- **PII hidden from view-only users** — Users who can view but not manage the directory no longer see email or last-login activity in either layout.

### Fixed
- **Admin page hidden despite having access** — The Admin page, its nav entry, and the default-landing redirect were gated on an incomplete permission list (only users/roles/audit), so a user holding only another admin permission (SSO, connections, ClickHouse users/roles, data access, or AI models) was bounced from `/admin` even though they had a tab to see. All access checks now derive from a single source of truth, so any one admin-tab permission reveals the page and that tab.

## [v3.3.1] - 2026-06-14

### Fixed
- **GitHub SSO (and other plain OAuth2 providers)** — userinfo is now fetched directly instead of through the OIDC-only helper, which rejected GitHub's numeric `id`/missing `sub` (`"sub" property must be a string`). GitHub accounts with a private email also now resolve their primary verified address via `/user/emails`, so just-in-time provisioning no longer fails with "did not supply an email address".
- **SSO attribute-mapping parsing** — claim/role/auth-param mappings now accept either `=` or `:` as the key/value separator, so values entered as `subject=id,...` are parsed correctly instead of silently producing an empty mapping.

## [v3.3.0] - 2026-06-14

### Added
- **SSO sign-in audit coverage** — first-time SSO sign-ins now record their outcome in the audit log: `sso.user_provision` when an account is just-in-time created, and `sso.identity_link` when an SSO identity is auto-linked to an existing user by verified email. These are written alongside the existing `auth.sso_login` entry, so JIT provisioning and account linking are no longer invisible to auditors.
- **Native ClickHouse role management** — a new "ClickHouse roles" admin tab to create and edit native ClickHouse roles (`CREATE ROLE` + `GRANT`) with a full privilege editor covering database/table/global scope, column-level grants and `WITH GRANT OPTION`. Edits are reconciled diff-based, issuing only the `GRANT`/`REVOKE` statements that changed.
- **Role assignment for ClickHouse users** — users are now created/edited by assigning native roles and default roles (plus optional direct grants), reading state directly from ClickHouse `system.*` tables.
- **Extract to role** — turn a legacy user's direct grants into a reusable role and re-point the user at it in one action.
- **Manage SSO in Admin** — a new Admin → SSO section to edit global SSO settings (enabled, base URL, default role, auto-link) and add/edit/delete OIDC and OAuth2 providers, coexisting with read-only env/YAML providers. Adding a provider runs a live test before save; deleting one force-unlinks all linked users (with a clear warning) and is fully audited. Gated by new granular permissions — `sso:view` (admin), `sso:edit`, and `sso:delete` (super admin). Client secrets are encrypted at rest and never returned.
- **SSO advanced provider options** — OIDC providers can now override individual discovered endpoints and remap non-standard ID-token claims, and any provider can send custom authorization-request parameters (e.g. `prompt`, `login_hint`, `hd`, `audience`); reserved keys are ignored. Configurable from the wizard's Advanced section and via `auth_params` in YAML/env.
- **SAML 2.0 SSO** — add SAML providers alongside OIDC/OAuth2, supporting both SP-initiated and IdP-initiated login with mandatory signed-assertion verification, InResponseTo/replay protection, browser-bound RelayState, SAML-attribute → role mapping, JIT provisioning, and IdP-metadata paste in the admin wizard. Auto-linking a SAML sign-in to an existing account by email is opt-in per provider (off by default) via a "trust IdP-asserted email" toggle. Configurable in Admin → Security → SSO or via `AUTH_SSO_PROVIDERS_<id>_SAML_*` env/YAML.
- **Enable/disable ClickHouse roles** — a reversible alternative to deleting. Disabling a role stashes its grants and revokes them in ClickHouse (the role stays defined and assigned, but grants nothing); enabling restores them exactly. Backed by a new `rbac_clickhouse_role_state` table, scoped per connection. Disabled roles are flagged in the list, and editing is locked until re-enabled.

### Changed
- **ClickHouse user management reworked** — the previous fixed `developer`/`analyst`/`viewer` model (which wrote grants directly to users and cached them locally) is replaced; ClickHouse is now the source of truth. New `clickhouse:roles:*` permissions gate the role UI and are granted automatically to roles that already manage ClickHouse users.
- **SSO provider brand icons** — enabled SSO providers now show a recognisable brand logo (Google, Microsoft, Okta, GitHub, GitLab, Apple, Slack, AWS, Auth0, …) inferred automatically from the provider, falling back to a generic glyph for unrecognised providers. Icons adapt to light/dark themes and appear on the login page, the admin SSO providers list, and each user's linked SSO identities.
- **Login page SSO** — providers render as compact labelled buttons with their brand icon; when more than three are enabled the extras collapse behind a "Show more" toggle so the password form stays in view.
- **Admin → SSO** — the Single sign-on section now has a proper titled header, and the "Global settings" / "Providers" sub-sections use distinct, meaningful icons.
- **Explorer → Create Database** — the dialog now follows the same editorial layout as Create Table / Alter Table: themed `ink/paper` window surface, an icon + mono eyebrow title, mono-uppercase field labels, and a brand-coloured primary action, instead of the previous off-style card.
- **Explorer → Import data (upload file)** — replaced the hardcoded emerald accent with the app's `brand` theme token across the dropzone, progress, step dots, buttons, and selects so the wizard matches the rest of the UI in both light and dark themes.

### Fixed
- **SAML sign-in hardening** — SP-initiated SAML logins are now bound to the browser that started the flow and the `InResponseTo` request id is enforced against a shared cache, closing a login-CSRF / assertion-injection vector. IdP-vs-SP-initiated gating and replay protection now use node-saml's signature-validated profile/assertion instead of regex over raw response bytes, so a forged `InResponseTo` can no longer bypass the IdP-initiated toggle. Replay protection fails closed when an assertion id is missing.
- **SSO account-takeover hardening** — the JIT-provisioning race handler no longer re-resolves a user by email on a unique-constraint collision; it fails closed unless a matching provider identity link exists. This prevents an unverified IdP-asserted email from being linked to a pre-existing local account, closing an account-takeover path that bypassed the verified-email auto-link gate.

### Removed
- **Legacy ClickHouse user metadata cache** — the `rbac_clickhouse_users_metadata` table is dropped; user/role/grant state is read live from ClickHouse.

## [v3.2.0] - 2026-06-13

### Changed
- **User management** — replaced hard user deletion on the user card with an Activate/Deactivate action; deactivated users keep their data but cannot sign in until an admin reactivates them.
- **Audit log coverage** — added audit entries for fleet alert-config updates, AI doctor scans/schedule changes/report deletions, and query EXPLAIN; migrated live-query kill logging to capture full client context.

### Fixed
- **SSO users** — the "Reset password" action is now hidden for SSO-linked accounts (both on the user card and the edit-user screen), since they have no local password.
- **Inactive login message** — password sign-in by an inactive account now returns a clear "account is inactive, contact an administrator" message (after password verification, to avoid user enumeration); SSO wording aligned.
- **Fleet doctor** — the "analyzing…" progress now reflects the selected investigation window instead of always showing "6h".

## [v3.1.0] - 2026-06-12

### Added
- **Role wizard** — Creating or editing a role is now a guided 3-step wizard (Details → Permissions → Data Access & Review), matching the Data Access Policies flow.
- **Data Access on role cards** — Each role card surfaces its assigned data access policies: a count badge in the stat row and named policy chips in the expanded view.
- **Roles in Identity & access** — The Preferences Identity & access card now lists the signed-in user's roles.
- **SSO identity management** — the user's **Security** tab now lists each linked SSO provider (display name, the email it was linked by, and last sign-in) and lets admins unlink an identity. Backed by new `GET`/`DELETE /rbac/users/:id/identities` endpoints (`users:view` to list, `users:update` to unlink, with super-admin targets protected), and a new `user.sso_identity_unlink` audit action. Unlinking warns that an SSO-only user will be locked out until their password is reset.

### Changed
- **Admin navigation** — The Admin header is now a two-tier nav: grouped section chips on top with the active group's sections shown below as sub-tabs.
- **Data Access section header** — Now uses the standard icon + title + count header to match the other admin sections.
- **Preferences cards** — Row-one cards are equal height; the ClickHouse node rows align the card with Identity & access. Monitoring's title and refresh controls gained breathing room from the header divider.
- **SSO logging is more diagnosable** — the server now logs the configured providers at startup (`SSO enabled — N provider(s) loaded` with id/type/display name, or `SSO disabled`), and start/callback failures now include the identity provider's own `error`, `error_description`, `code`, and `cause` instead of only the wrapped error message. No behaviour or API change; secrets are never logged.

### Fixed
- **"Other" permission label** — `data_access` permissions now display as "Data Access" instead of "Other" on role cards.
- **Inconsistent role labels** — User-list cards always show a readable role display name instead of occasionally leaking the raw role key.

## [v3.0.0] - 2026-06-12

### Added
- **Server-backed preferences** — theme and max result row limit now persist to the server (`workspacePreferences.app`) so they survive re-login and roam across devices
- **Custom row limit input** — type any value up to 100,000 directly in Preferences in addition to the quick-pick preset buttons
- **Extended row limit presets** — new options: 25k, 50k, 100k (server-side validation raised to match)
- **Data Access Policies** — database/table access is now defined as named, reusable policies managed under a new **Admin → Data Access** tab. A policy is a set of rules; each rule is scoped to a specific connection and grants/denies database/table patterns there. Policies are attached to roles many-to-many via a new `/rbac/data-access-policies` API and the new `data_access:view/create/update/delete/assign` permissions.
- **Roles carry data access** — the role form now requires at least one data access policy for custom (non-system) roles, making roles the primary access-control mechanism.
- **Policy wizard with table picker** — a 3-step wizard (Connections → Access → Details & Review): pick one or more connections (or "select all"), then for each connection independently browse its real databases and tables (auto-listed; tables lazy-loaded on expand) and tick the ones to grant — with whole-database (`*`) selection, wildcard/regex pattern rules, and allow/deny per connection — then name and review.

### Changed
- **AI Optimizer auto-enable** — removed the manual `AI_OPTIMIZER_ENABLED` env var; the optimizer now enables automatically whenever an active AI model is configured, matching the AI Chat behaviour
- **One role per user** — each user now has exactly one role (enforced in the API and by a `UNIQUE(user_id)` index on `rbac_user_roles`). A user's effective data access is the union of the rules in the policies attached to their role; deny rules still take precedence by priority.
- **Connection access comes from data access policies** — whether a user can open a connection is derived from their role's policies: a rule scoped to a connection grants access to that connection. (Super admins still see all connections.)
- **Migration** — on upgrade, each user's *effective* legacy access is snapshotted into the new model: their connection grants and connection-scoped rules determine which connections they can reach, and global (all-connection) rules are expanded onto exactly those connections — so no access is lost and none is over-granted. Users with multiple roles or per-user rules are collapsed onto a single (de-duplicated) generated role; `super_admin`/`admin` users keep their privileged role.

### Fixed
- **AI Optimizer empty query** — clicking "AI Optimize" from the hint strip no longer opens the dialog with an empty query

### Removed
- **User-level data access rules** — per-user database/table rules and their UI (the data access section in user create/edit) have been removed. Data access is granted through the role's policies only. The `/rbac/data-access/user/*` endpoints, the `bulkSetForUser` client method, and the per-rule `accessType` field are gone (access type is determined by role permissions).
- **Per-user connection access** — the "Manage Access" UI on connections and the `rbac_user_connections` table are removed; connection access is now derived from data access policies (see above).

## [v2.19.2] - 2026-06-11

### Fixed
- **Docker healthcheck** — increased timeout from 5s to 10s and start period from 10s to 15s to reduce false-positive unhealthy states on slower hosts

## [v2.19.1] - 2026-06-11

### Fixed
- **Release workflow** — tag and GitHub Release now correctly include version number and changelog notes

