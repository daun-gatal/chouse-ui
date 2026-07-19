# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v3.10.0] - 2026-07-19

### Added
- **Clear & rerun (ADR 0007)** — every run in a Scheduled Query's history and a Data Health promise's evaluation timeline gains a per-run **Rerun** action that re-executes exactly that slot over its original window; rerunning a materializing slot automatically re-verifies its linked Data Health promises over the same window. The recovery planner additionally supports range reruns — including already-succeeded slots — and Data Health promises gain a "Rerun range" action. Replays are idempotent: samples are replaced in place, and only the newest slot can change current status, incidents, or notifications — historical slots are corrected silently.

### Fixed
- **AI chat connection switching** — New threads, displayed chat state, and asynchronous history refreshes now follow the currently active ClickHouse connection.

## [v3.9.0] - 2026-07-15

### Added
- **Event-triggered Data Health** — a promise can now chain to a materializing scheduled query and evaluate right after each successful run, over exactly the window that run wrote (no cron guesswork, no evaluate-before-write races). The promise wizard gains an "After a scheduled query succeeds" cadence with an upstream job picker (auto-suggesting the producer of the chosen table), the scheduled-query flow offers "Protect output table" after creating a materializing job, and the Data Health overview's coverage gaps open the pre-linked wizard in one click. Upstream pipeline failures mark chained promises `unknown` and open an execution incident on the promise's channels, recovering automatically on the next successful run; deleting or de-materializing a job with chained promises is blocked until they are detached. (ADR 0006)

### Fixed
- **Provider-neutral AI structured output** — Scheduled Queries, Data Health, and other structured AI features now negotiate bounded native, tool-calling, and schema-guided JSON strategies without masking authentication, throttling, or timeout errors. Administrators can optionally override the strategy per model from AI settings.

## [v3.8.0] - 2026-07-15

### Added
- **Configurable AI model runtime parameters** — admins can now tune per Provider Model: sampling (temperature, top-p, top-k, frequency/presence penalties), output limits (max tokens, stop sequences, verbosity), reasoning (effort level, thinking budgets), reliability (retries, request timeout), and the agent runtime (recursion limit, run timeout), plus an advanced escape hatch for extra provider kwargs. Fields are provider-aware (OpenAI, Anthropic, Google, OpenAI-compatible) with validation on both the form and the API, and take effect on the next AI run without a restart.
- **Expanded AI providers** — Chouse AI now supports Azure OpenAI, Groq, Mistral, Cohere, Ollama, xAI (Grok), DeepSeek, Cerebras, and AWS Bedrock as first-class provider types, plus preset OpenAI-compatible endpoints for Fireworks AI, Together AI, and OpenRouter. Each provider exposes only the runtime parameters its SDK actually supports, Ollama needs no API key, and Bedrock is configured with dedicated AWS region/access-key fields (stored encrypted).
- **Explorer query history** — Track SQL editor executions with connection, status, duration, and row metadata, then search, filter, reopen, or delete history entries from Explorer.
- **Data Health Promises** — protect ClickHouse datasets with scheduled freshness, volume, per-column completeness, composite-key uniqueness, repeatable validity rules, schema, and repeatable custom-metric checks. Evaluations consistently use UTC: native `DateTime` values are compared as instants, local `Date`/`Date32` values map UTC boundaries through a required calendar timezone with day-level freshness and cadence, string timestamps require their stored-value timezone, and integer timestamps require an explicit seconds-to-nanoseconds unit. Table promises automatically add safe pruning predicates for recognized time-based ClickHouse partition keys, including local calendar/date partitions. Choosing a dataset query auto-detects its output columns, turning the event-time, completeness, and uniqueness pickers into dropdowns instead of free-text fields, matching the table-source experience. Investigate evidence — including the actual evaluated schedule window, with an explanation when a passing check has no violating rows — and manage low-noise incidents (dedicated execution-failure incidents, recovery transitions, immutable event timelines, transition-based notifications) from DataOps. Runs on both SQLite and PostgreSQL.
- **DataOps AI operator assistance** — add evidence-grounded operational briefs, intent-based Scheduled Query drafting, preflight review, failed-run and Data Health incident investigation, health-check recommendations, noise tuning, incident correlation, historical promise backtests, bounded failing-row diagnostics, coverage-gap discovery, and confirmed historical recovery planning across Scheduled Queries and Data Health.
- **Metadata-backed Explorer history** — Sync each user's bounded query execution history to the metadata database while retaining immediate local access and importing existing browser-local entries.
- **Unified onboarding** — Adds fresh-install security and connection setup, a permission-aware Getting Started hub, resumable viewport-safe contextual guides for every CHouse product area, and persistent cross-device progress. Guide targets auto-scroll only when needed, explanations and highlights appear as one settled frame without an intermediate opening window, and transient dialogs, sheets, menus, selects, popovers, and AI windows close before every transition. Async Fleet, Doctor, and Preferences controls expose stable anchors before guidance appears; delayed destination rendering keeps the best visible target instead of moving the explanation; and persistence failures remain recoverable in place. Monitoring, DataOps, and Admin steps activate and highlight their exact horizontally revealable nested tab; isolated Doctor guide routes avoid loading an unrelated report; the dock stays available during guidance; background scrolling and focus stay contained; and every chapter, including the last card, remains reachable inside a dedicated short-screen scroll region. Onboarding updates merge atomically with other workspace preferences so dock, theme, and layout saves cannot overwrite guide progress.
- **DataOps AI model picker** — choose which active AI model powers the AI features on the DataOps page (operational briefs, run diagnoses, query drafts, health-promise recommendations and tuning) from a minimal button in the page header. The selection is stored per user and falls back to the system default model automatically when cleared or when the chosen model is deactivated.

### Changed
- **Faster Chouse AI runtime** — AI capabilities now use bounded, focused DeepAgents tool loops
- **Richer AI charts** — chart results now infer and label the correct axes, normalize ClickHouse
- **Consistent AI windows** — Query Logs, Explorer, Errors, Parts, Schema Advisor, query debugging,
- **Scheduled Query job journey** — consolidate a formatted read-only query definition, delivery safeguards, runtime lineage, and run investigation into a focused job detail page, reducing Scheduled Queries navigation to Overview and Jobs.

### Fixed
- **Google provider base URL** — custom base URLs configured on Google providers are now actually passed to the Gemini client.
- **Recursion-limit errors** — LangGraph "Recursion limit reached" failures now surface a friendly message pointing at the configurable Provider Model recursion limit instead of a generic provider error.
- **AI chart rendering** — unwrap JSON-serialized LangChain tool results and recover missing or
- **DataOps active-connection scoping** — Scheduled Queries and Data Health now show only the active connection's jobs, promises, and incidents, so editing, schema browsing, test runs, and AI assistance always operate on the connection a resource was created for. Resources pinned to other connections keep running in the background and reappear when switching connections. Updates can no longer silently move a job or promise to a different connection, and the AI preflight review is refused when the session is on a different connection than the job.
- **Scheduled Query job detail connection label** — show the connection's name instead of its raw id.
- **AI structured output on OpenAI-compatible models** — forced tool-calling instead of OpenAI's strict `json_schema` response format when the resolved model is a non-native `ChatOpenAI` instance (covers `openai-compatible` providers like DeepSeek/Qwen proxies). Fixes generic failures on complex-schema capabilities when using third-party OpenAI-compatible endpoints.
- **Onboarding journey stability** — Keeps Doctor actions fixed while AI and connection controls load, prevents exit/completion races, refreshes expired sessions during progress saves, preserves concurrent progress from multiple tabs or devices, and allows the freshly seeded super administrator to finish setup after adding an active connection.

## [v3.7.1] - 2026-06-28

### Changed
- **Dependency security updates** — Bumped dependencies to clear known high-severity advisories with no breaking API changes: `drizzle-orm` (0.38 → 0.45), `hono` (4.11 → 4.12), `react-router-dom` (7.10 → 7.15+), `nodemailer` (8 → 9), `yaml` (2.8 → 2.9) and `dompurify` (3.3 → 3.4). The transitive `lodash` (via `dagre`) is pinned to a patched release through an `overrides` entry.

### Fixed
- **User management metric cards** — Active/Inactive (and Total) counts on the Admin → User management tab are now computed from backend totals over the whole filtered set instead of the current page, so they no longer change when the page size changes.
- **Query Logs RBAC user** — Query Logs now reads the RBAC actor from the dedicated `log_comment` column (falling back to the `Settings` map), so queries run through the app correctly attribute to the RBAC user instead of falling back to the bare ClickHouse user. RBAC-user resolution is also decoupled from the audit-log fetch: a failing or permission-gated audit request (e.g. right after login) no longer drops every row back to the ClickHouse user, since `log_comment`-tagged queries resolve independently. A resolved-but-deleted RBAC user no longer leaks a raw UUID into the user column.

## [v3.7.0] - 2026-06-25

### Added
- **Runtime Lineage (Scheduled Queries)** — a new **Runtime Lineage** sub-tab that shows observed-runtime data lineage for a selected job. Reads `system.query_log` (every run is tagged with its `job_id`) to graph the tables a job actually reads and writes — chaining jobs together when one job's destination table is another job's source — and reveals the columns observed flowing through each table/job when a node is selected (column level). The graph expands on demand — each card shows one level upstream/downstream and a `+` reveals the next hop in that direction — and uses the same searchable job filter as Runs.
- **Scheduled Queries (DataOps)** — a new top-level **DataOps** page with a Scheduled Queries feature (Overview / Jobs / Runs). Schedule any read-only `SELECT` on a daily/weekly/monthly preset or a custom UTC cron expression, with deterministic time windows (`{{slot_start}}`/`{{slot_end}}`/`{{prev_run_at}}`), bounded result snapshots, and an optional engine-generated, idempotent **materialize** write-back (append / replace-partition / upsert) into a destination table. Failure-based alerting notifies the linked notification channels when a run fails (and once on recovery), transition-based to avoid flapping. The Overview is a real summary of the feature (health KPIs, success rate, cadence / output-mode / last-run breakdowns, upcoming runs, top failing jobs); the Jobs list is filterable (enabled/disabled, last-run state, name search) and the Jobs and Runs lists are paginated. Includes an in-process per-job-lease scheduler that is correct under multiple replicas with no leader election, a crash-only reaper + bounded retry, and a transactional notification outbox for at-least-once delivery. Gated by new `scheduled_queries:view|edit|delete|run|write` RBAC permissions. Opt-out via `SCHEDULED_QUERIES_ENABLED=false`.

### Fixed
- **SSO no longer silently escalates privileges** (#270) — when an IdP claim resolved to more than one mapped role, the previous behaviour collapsed to the *highest-privilege* match, so a user in multiple groups could land in an unexpectedly powerful role. Role sync now fails closed: an ambiguous claim assigns no role and keeps the user's existing one, logging a warning so the misconfiguration can be fixed. Multi-group role mappings remain supported — only genuine overlap (one user resolving to several roles) is rejected.

## [v3.6.1] - 2026-06-18

### Changed
- **Notification channel type is now editable, with a webhook URL/type guard** — a channel's type can be changed while editing (the webhook URL is preserved when switching between Slack and Google Chat), so a mis-typed channel can be corrected in place instead of being deleted and recreated. Saving is blocked with a clear warning when the webhook URL's domain clearly belongs to a different provider than the selected type (a `chat.googleapis.com` URL on a Slack channel, or a `hooks.slack.com` URL on a Google Chat channel).

### Fixed
- **Alert channel "Send test" now matches real delivery** — a Google Chat webhook saved under a *Slack* channel passed "Send test" but no real breach alert ever arrived (only the in-app feed showed it). The test sent a bare `{text}` body that both providers accept, while production delivery sends provider-specific payloads (Slack Block Kit `attachments` / Google Chat `cardsV2`), which Google Chat rejects with `400` for a Slack-shaped body. The test now sends the same payload shape as real delivery, so a mismatched channel fails the test instead of giving false confidence.

## [v3.6.0] - 2026-06-17

### Added
- **Admin → Settings → Alerting** — a new single-section settings area to manage reusable **notification channels** (Slack, Google Chat, Email, Webhook) with per-type forms and a "Send test" action, **alert rules** (add / edit / delete) with thresholds, severity, AI auto-RCA and the channels they deliver to, and a **recent alerts** feed that records every breach and can be cleared by time range (older than 24h / 7d / 30d / all). Multiple fleet rules are supported — each evaluates independently and delivers its breaches to its own attached channels. Gated by new permissions: `alerting:view` and `alerting:edit` (Super Admin + Admin), and a separate `alerting:delete` for removing channels/rules and clearing alerts (Super Admin only).

### Changed
- **Alerting config is now normalized** — the fleet alert delivery config (rules/thresholds + Slack/Google Chat/email) moved out of a single JSON blob into reusable metadata tables (`notification_channels`, `alert_rules`, `alert_rule_channels`, `alert_events`). Existing settings are migrated automatically on upgrade, with secrets encrypted in the process.
- **Only one fleet rule can be enabled at a time** — enabling a second fleet-threshold rule is blocked (server-side 409 + an up-front notice in the rule editor) naming the rule that's already active. Fleet alerting is driven purely by which rule is enabled in Settings → Alerting; the fleet alerter delivers to every channel linked to the enabled rule, including the new Webhook type.
- **Alerts bell is browser-notifications only** — the bell popover (renamed "Notifications") holds just the per-device browser desktop/toast alerting (enable + thresholds + desktop-banner permission). Slack/email delivery and rule enablement live in Admin → Settings → Alerting; the old in-bell delivery editor was removed.
- **Notification channel secrets are now encrypted at rest** — Slack/Google Chat webhook URLs and SMTP passwords are stored with AES-256-GCM instead of plaintext, and are never returned to the browser.

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

