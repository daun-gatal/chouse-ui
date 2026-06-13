# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [v2.17.3] - 2026-06-08

### Changed

- **Fleet inventory counts all databases** — `schema_totals` query no longer excludes `system`, `INFORMATION_SCHEMA`, and `information_schema` databases; counts now align with what ClickHouse reports on the home page and metrics views

## [v2.17.2] - 2026-06-08

UI consistency fixes across Fleet Doctor, Preferences, and Admin Roles.

### Fixed

- **Fleet inventory cards** — `formatBytes(0)` and `formatNumber(0)` returned an empty string instead of `"0 Bytes"` / `"0.00"` due to a swapped guard order; zero values now display correctly
- **Fleet Doctor model selector** — replaced native `<select>` on the Doctor page and the Scheduled Scans dialog with a styled Radix `DropdownMenu` matching the AI chat model picker exactly (radio indicators, provider subtitle, mono font, hover effects); added `modal={false}` to prevent Radix focus-trap conflict when the dropdown is inside a dialog
- **Fleet Doctor time filter** — replaced native `<select>` with a segmented button group (`1h · 6h · 24h · 3d`) consistent with the Fleet page's history range picker
- **Admin → Roles permission badges** — permission badges now show the full string (e.g. `logs:view`) instead of only the action suffix; 7 missing permission prefixes (`logs`, `parts`, `schema_advisor`, `cluster`, `errors`, `fleet`, `doctor`) added to the category map, eliminating the "Other" catch-all group

### Changed

- **Fleet poller enabled by default** — the background snapshot poller now starts automatically without requiring `FLEET_POLLER_ENABLED=true`; set `FLEET_POLLER_ENABLED=false` to opt out (e.g. in test environments)
- **Preferences Appearance card** — redesigned from a narrow single-column vertical list to a full-width `grid-cols-4` horizontal card layout with larger icons and centered alignment

## [v2.17.1] - 2026-06-07

Documentation and developer experience overhaul. No app code changes.

### Added

- **CLAUDE.md** — project-level instructions for AI agents: key commands, tech stack, code standards summary, and a condition-based rule routing table (`when to apply each rule`)
- **`.rules/DEAD_CODE.md`** — new rule file guiding agents on how to identify and safely remove unused imports, symbols, exports, and dependencies — both after making changes and during proactive scans

### Changed

- **README** condensed (~26% shorter): removed redundant overview note, replaced four environment variable tables with a short list + `.env.example` pointer, condensed the migrations section, removed the "For AI Agents" section (superseded by `CLAUDE.md`). **Built With** section rewritten to accurately reflect all dependencies (added React Router, Pino, jose, Vercel AI SDK, node-sql-parser, TanStack Table/Virtual, Recharts, uPlot, React Hook Form, Framer Motion, cmdk, DOMPurify, Radix UI; organized into Runtime/Server, Frontend, and ClickHouse sections)
- **`.rules/CODE_CHANGES.md`** condensed (~61% shorter): removed redundant code examples, kept one example per pattern, added dead-code scan and changelog update to pre-commit checklist
- **`.rules/CODE_REVIEWER.md`** condensed (~73% shorter): restructured as a checklist-focused format with cross-references to `CODE_CHANGES.md` instead of duplicating examples
- **`CONTRIBUTING.md`** updated: "Using AI Tools" section now points to `CLAUDE.md` as the primary quick reference; removed the Screenshots documentation subsection
- **GitHub Pages workflow** (`github-pages.yml`): removed the "Sync Screenshots" step

### Removed

- **`ARCHITECTURE.md`** — 673-line architecture reference removed; key patterns summarised inline in `CLAUDE.md`
- **`.rules/ARCHITECTURE.md`** — rule file for maintaining `ARCHITECTURE.md`, no longer needed
- **Screenshots** — 8 product screenshots removed from the repo (`public/screenshots/`), `docs/portfolio` screenshot gallery component (`ScreenshotGallery.tsx`), and the portfolio `sync-screenshots` build script

