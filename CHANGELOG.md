# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [v2.19.0] - 2026-06-11

### Added
- **SSO login with OIDC and OAuth2** — authorization code + PKCE flow, JIT user provisioning with configurable default role, auto-link by verified email, optional IdP claim→role mapping (never demotes super_admin), SSO-enforced sign-in for linked non-admin accounts

### Removed
- **"Latest release" section from docs site** — the v2.16.0 What's New strip has been removed from the portfolio page

## [v2.18.0] - 2026-06-11

### Added

- **AI reference docs + smarter intent routing** — the agent now loads ClickHouse *reference* docs on demand (a new `load_reference` tool), separate from skills. Three references live as markdown under `packages/server/src/references/` (the single source of truth): the optimization playbook, the exact `system.*` column reference, and a new type/codec/compression guide. The previous inline `CLICKHOUSE_PLAYBOOK` / `SYSTEM_TABLE_REFERENCE` constants are now file-backed reads of those docs (no prompt change for the diagnose/optimize-log/fleet-scan capabilities). Skill frontmatter gained a `when_to_use` trigger, and the chat assistant's "decision framework" is now generated from it, so new skills auto-surface in routing. Three new chat skills let the conversational assistant diagnose errors, part/partition health, and column-schema issues (intents previously reachable only via the dedicated buttons), using the read-only core tools + references.

### Changed

- **optimize-query and optimize-log now share one result schema** — the SQL-editor "Optimize" and Query Logs "Optimize with Chouse AI" do the same job but used to return different shapes, so the shared dialog rendered them inconsistently. Both now return one unified `QueryOptimization` (originalQuery, optimizedQuery, summary, markdown explanation, root-cause, per-table findings, suggestions, and a backend-computed before→after EXPLAIN ESTIMATE). optimize-query gained root-cause + per-table findings + the EXPLAIN estimate; optimize-log gained the one-line summary + markdown explanation; the old `tips[]` consolidated into a single `suggestions[]`. Nothing is truncated — both entry points render the full analysis in the same window.
- **Unified query optimizer window** — the "Optimize with Chouse AI" action in Query Logs now opens the *same* dialog as the SQL editor's Optimize button (`OptimizeQueryDialog`) instead of a separate one. The dialog renders a union of analysis sections: the diff + explanation + tips for editor queries, and the richer root-cause / per-table / before→after EXPLAIN estimate for log queries (the analysis card was extracted into a shared `OptimizationAnalysis` component reused by the Fleet Doctor report). The model picker is unified to `/ai/models`.
- **"Tables" stat relabeled to "Tables & Views"** — the Home and Metrics cluster cards count `system.tables`, which already includes views; the label now reflects that. No data/query change.
- **Unified AI backend behind a single capability engine** — every AI feature (SQL editor optimize/debug/check, Query Logs optimize, Errors/Parts/Schema diagnose, fleet doctor scan, chat) is now described by a declarative capability in a single registry (`packages/server/src/services/ai/capabilities`) and executed by one shared engine that owns model resolution, the tool-loop agent, structured-output extraction, step collection, and error handling. This removes ~8 hand-rolled copies of the same agent loop and the duplicated JSON-extraction logic. The seven query-scoped structured capabilities are reached through a single endpoint, `POST /ai/invoke` (`{ capability, input, modelId }`); the model picker is unified to `GET /ai/models` and capability availability to `GET /ai/capabilities`. Streaming chat (`/ai-chat/stream`) and the fleet doctor scan (`/fleet/doctor/scan`) keep their dedicated routes (different auth surfaces) but now run through the same engine. The old per-feature `/query/optimize`, `/query/debug`, `/query/check-optimization`, `/query/optimize-log`, `/query/diagnose-*`, and `/query/optimize-models` routes and the `aiOptimizer`/`chouseDoctor`/`aiChat` services were removed. No user-visible behavior change; the frontend AI API functions keep the same signatures.

### Fixed

- **"Format query" uppercased case-sensitive tokens and could break queries** — the shared SQL formatter (`formatClickHouseSQL`, used by the editor's Format Document command and DDL display) ran with `keywordCase: "upper"`. `sql-formatter`'s ClickHouse dialect over-classifies some case-sensitive tokens as reserved keywords (e.g. the interval-unit alias `h`, functions like `sumIf`), so uppercasing rewrote their case and could invalidate the query — and `identifierCase`/`functionCase` couldn't rescue them because they're treated as keywords. The formatter now preserves the case of all tokens (keywords, identifiers, functions, data types) and only normalizes indentation/spacing, so it can never corrupt a case-sensitive ClickHouse query.
- **AI optimize/debug returned invalid SQL due to client-side reformatting** — the AI's optimized/fixed query was re-run through `sql-formatter` with `keywordCase: "upper"`, which uppercased case-sensitive ClickHouse function/identifier names (e.g. `toStartOfInterval` → `TOSTARTOFINTERVAL`, `argMax` → `ARGMAX`) and broke the query. The client no longer reformats AI output anywhere (SQL editor Optimize/Debug dialogs, Query Logs optimizer, Fleet Doctor heavy-query cards); the AI is now the sole formatter and is instructed to return pretty, multi-line, runnable SQL with keywords uppercased but identifier/function case preserved.
- **Configurable max result rows in Preferences** — a new *Query Settings* card in Preferences lets each user set a maximum row cap (100 – 500 000, default 10 000) or toggle to unlimited. The cap is enforced server-side via ClickHouse `max_result_rows` so no unnecessary bytes are downloaded. A yellow truncation banner appears inline in the results panel whenever the limit is hit, with a direct link to Preferences to raise it.
- **Workspace SQL editor silently truncated results** — the ClickHouse client was created with `max_result_rows: 10 000` and `max_result_bytes: 10 MB` (with `result_overflow_mode: break`), causing user queries to return a partial result set with no warning (e.g. `SELECT count()` showed 1 M rows but `SELECT *` returned only ~50 k). `executeQuery` now overrides both limits to 0 (unlimited) so user-initiated queries always return the full result; the Stop button and `AbortController` are the cancellation safety net.
- **Workspace SQL editor stuck on "Running query..."** — queries without a `LIMIT` clause caused the editor to stay in loading state indefinitely because the browser was still downloading the massive JSON response body even after ClickHouse finished executing. The fetch now carries an `AbortSignal` per tab; clicking the Stop button immediately aborts the HTTP download and clears the loading state, rather than only opening the KILL QUERY dialog. Cancellation is treated silently (no error shown) so the tab returns to idle cleanly.
- **Monitoring — AI Diagnose dialog closes mid-analysis** — unstable row keys (`key={...-${i}}`) caused components to remount during auto-refresh; keys are now derived from stable identifiers (`part_name + event_time`, error code, `query_id`).
- **Query Logs auto-refresh ignores toggle** — `useQueryLogs` had a hardcoded `refetchInterval: 30_000` that bypassed the UI toggle; removed so the toggle is respected.
- **AI Diagnose / Optimize dialogs — no cancel mechanism** — closing any AI analysis dialog (via Escape, backdrop click, or ✕) now aborts the in-flight HTTP request via `AbortController`, stopping the analysis immediately rather than letting it run in the background.
- **Workspace Explain tab — Analysis sub-tab removed** — the Analysis sub-tab and all associated dead code (`QueryAnalysisView`, `analyzeQuery` API function, server-side `/query/analyze` route, complexity/recommendation types) have been permanently deleted.

