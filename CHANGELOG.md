# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v3.12.0] - 2026-08-02

### Added
- **`service.sessionAffinity` in the Helm chart** (default off). Not required for correctness any more — multi-replica is correct without stickiness — but available for operators who want it.
- **[ADR 0010](../../docs/adr/0010-pod-local-state-and-multi-replica-correctness.md)** defining the pod-local state contract: a cache may hold state that is derivable and self-healing; nothing may hold state that is authoritative for answering a request.

### Changed
- **Unresolvable connection context now fails closed** — routes return `409 CONNECTION_CONTEXT_STALE` instead of quietly substituting a different connection; the client re-activates and retries once. Browsers holding a pre-upgrade bundle recover on reload.
- **Five near-identical hybrid auth middlewares collapsed into one** shared per-request connection context used by explorer, query, metrics, live-queries, ai-chat and upload.

### Fixed
- **AI structured output on strict providers** — schemas for the Data Health promise recommendation, both query optimizers, and the fleet scan used optional fields that OpenAI-compatible providers reject in strict structured-output mode, so that fallback strategy failed on every call before a request was even sent. Optional output fields are now nullable.
- **Schema-invalid AI responses** — when a model returns JSON that violates the output schema, Chouse AI now re-prompts once with the specific validation errors instead of failing the run outright.
- **Wrong ClickHouse cluster served behind multiple replicas** — the selected connection was held in a per-pod in-memory session map, so a request routed to a pod that had never seen the session silently answered from the user's *default* connection with a 200. This showed up as the Data Health promise editor "losing" database and table names until you reloaded a few times. Connection identity now travels with each request (`X-Connection-Id`) and is authorised against the RBAC database on every call, so any replica can serve it.
- **SAML login broken and replay protection ineffective across replicas** — the handoff codes, `InResponseTo` request ids, and the assertion replay cache were per-process Maps. SP-initiated login failed roughly (N-1)/N of the time, and the same assertion could be replayed successfully against a replica that had not seen it. All three now live in shared tables with atomic single-use claims.
- **Auth config changes applied to only one pod** — disabling password login or changing SSO providers rebuilt the cache only on the replica that served the mutation, leaving every other pod serving the old answer indefinitely (there was no TTL). A shared generation counter now propagates changes within seconds.
- **Alert storm after every rollout** — fleet breach latches were in memory, so poller-lease failover re-fired every still-breaching condition. Latches and the auto-RCA cooldown are now persisted.

## [v3.11.1] - 2026-07-30

### Changed
- **Smaller runtime image** — the frontend's runtime dependencies (~735 MB) are no longer installed into the production image. They were pulled in only because the root `package.json` made Bun treat `/app` as a workspace root; the server never loads them, since the frontend is served as the pre-built static bundle in `/app/dist`.

### Fixed
- **Container image vulnerabilities** — the published image shipped Bun's global install cache (~1 GB), which held the entire dependency tree including dev-only prebuilt binaries such as esbuild 0.18.20 and 0.19.12; scanners reported those stale binaries as part of the runtime. The cache is now dropped in the same layer it is created in. The base image's Alpine packages are also patched at build time (`apk upgrade`), picking up OpenSSL 3.5.7-r0, and GNU `wget` — which carried unfixed CVEs and was installed only for the healthcheck — is replaced by busybox's built-in `wget`.
- **Explorer sidebar clipped its own controls** — Radix's scroll area wraps its content in a shrink-to-fit `display: table` element, so a single long query in the History tab stretched the panel to the width of that query and everything past the sidebar edge was clipped: the status filter, the Clear button, and the per-row delete buttons all disappeared, and query text never truncated. The scroll area's content wrapper now uses block layout, so list rows stay at viewport width in every sidebar tab (horizontal scroll areas are unaffected).
- **Explorer sidebar tab strip overflowed** — the five sidebar tabs did not fit at the default sidebar width, pushing Queries out of view. Tab labels now collapse to icons for inactive tabs when the sidebar is narrow, and every tab carries an accessible name and tooltip.

## [v3.11.0] - 2026-07-30

### Added
- **Production Helm chart** — official Kubernetes deployment via `helm install chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui`: SQLite (single replica + PVC) and PostgreSQL/HA topologies with render-time guard rails, automatic `CHOUSE_HA` wiring, optional dedicated scheduled-queries pod, hardened security defaults, and cosign-signed chart releases published automatically alongside app releases (ADR 0008).

### Fixed
- **Security** — upgraded react-router to v8.3.0, resolving GHSA-qwww-vcr4-c8h2 (High), and bumped dompurify to 3.4.12 (GHSA-c2j3-45gr-mqc4, Low); dependency scans now report no known vulnerabilities.
- **RBAC version reporting** — servers no longer log a contradictory "current 1.47.0 / target 1.46.0" migration state; the schema version constant now matches the newest migration and is guarded by a test.

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

