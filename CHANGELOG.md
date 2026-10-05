# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v3.14.1] - 2026-10-05

### Added
- **Policies for many roles and tokens** — a budget policy is created and edited in a two-step wizard (limits, then who it applies to) and can apply to every agent, any number of roles and any number of tokens at once, picked by display name; tokens show their owner and key prefix, and revoked tokens aren't offered
- **More on each agent session** — Sessions shows the client the agent came from (Claude Code, Cursor, Codex, VS Code, the `chouse` CLI, …), the user and their roles by display name, and the policy that governs the session with its daily budget

### Changed
- **Agents is now AI Governance** — the page moved to `/ai` (old `/agents/…` links redirect) and is called AI Governance, since CHouse's own AI agents live under its Assistant tab
- **Names instead of ids on the Data page** — incidents show their connection and who acknowledged them; related incidents show their titles; root-cause chains, blast radius, lineage, pipelines and cost by consumer name the scheduled query, token or person instead of an id

### Fixed
- **Agent budgets not applied to token queries** — queries made over MCP or with a personal access token skipped budget policies, the incident block and the pause switch, were not counted on the agent's session, and were not attributed to the token in `log_comment`; they are now governed, counted and attributed
- **Policies for missing roles or tokens** — saving a policy for a role or token that doesn't exist (or a revoked token) is rejected instead of silently matching nothing
- **Dataset button on system tables** — in lineage, the Dataset button is disabled for `system` and `information_schema` tables, which have no dataset page
- **Wrong connection in the promise editor** — editing a promise on another connection showed the active connection's name; scheduled-query details no longer fall back to a raw connection id

## [v3.14.0] - 2026-10-05

### Added
- **Data › Context: Draft with Chouse AI** — fills the empty curated fields (description, grain, owner, use-instead-of, tags, deprecated) and suggests canonical metrics for one table. The model gets no tools: the server profiles only that table, read-only and capped, with summary numbers and never raw rows, and personal-looking columns get no values. Every suggestion is validated, and nothing is saved until a person clicks Save. Requires `context:edit` and `ai:optimize`; audited as `context.ai_draft`.
- **MCP managed in Agents › MCP** — turn the MCP endpoint on or off, set its allowed origins, tool call timeout and the public address agents use (the endpoint otherwise follows `PUBLIC_BASE_URL` or the address the UI is opened on, with a warning for `localhost`), and copy ready-made setup for Claude Code, Codex, Cursor, VS Code, OpenCode and curl, all from the UI. Every tool is listed with its description, access level (read, write, destructive), LLM spend, required permissions and parameters, and can be switched on or off on its own or per category; categories collapse and expand. Reads are on by default; writes, destructive and LLM-spending tools stay off until an administrator turns them on (with a confirmation). Viewing needs `agents:view`, changing needs `agents:manage`; changes apply to every replica within seconds and are audited as `agent.mcp_update`.
- **Agents see only the tools they can use** — `tools/list` now holds only tools that are on and that the token's permissions allow, and each tool's MCP annotations (read-only, destructive) follow its access level so clients prompt for the right calls.
- **Data Observability Platform (ADR 0016)** — CHouse UI now watches the data itself, not just the cluster. A new **Data** page (replacing DataOps) answers "is the data right, right now?" for every table, without scanning them: freshness and volume baselines learned from `system.parts` and `query_log`, trust states, coverage, and criticality from real read volume.
  - **Every ingestion source in one model** — materialized and refreshable views, Kafka, RabbitMQ, NATS, S3Queue, AzureQueue, MaterializedPostgreSQL/MySQL, external tables, Distributed inserts, dictionaries, async inserts, external writers and scheduled jobs share one status vocabulary (healthy, lagging, stalled, retrying, failing, stopped, inefficient, unsupported on this version). Hidden failures — a consumer replaying the same batch, a view rejecting every insert, files that failed all retries — surface as incidents.
  - **Lineage without instrumentation** — one graph from ClickHouse metadata, `INSERT … SELECT` in `query_log`, scheduled jobs, saved queries and agents, focused upstream, downstream or both, with column hints.
  - **Root cause across layers** — incidents walk deterministically from the data symptom through transform, ingestion and external sources down to the engine, with the evidence behind each step and the blast radius (tables, promises, jobs, saved queries, agents). Chouse AI can explain the chain and draft fixes; it never picks the root cause.
  - **Fixes with approval** — a closed catalog of remediation actions (kill query, pause/delay jobs, restart engine tables, reload dictionaries, refresh views, flush Distributed, optimize partitions, skip indexes, TTL and codec changes, profile settings) that run under a separate remediation credential only after approval: two approvers for high-impact actions, never the proposer, window-only changes inside the maintenance window, every run verified and, where possible, rollbackable. Approve in the UI, Slack or the CLI.
  - **Investigation notebooks** — incidents and Doctor reports share a notebook of Chouse AI findings, read-only query snapshots and notes, exportable as a Markdown postmortem.
  - **Context for people and agents** — curated table descriptions, owners, grain and canonical metrics, dbt manifest import, and plain-language watchers that compile into reviewed Data Health promises.
  - **Data Health** — new `distribution` check (median, p95, null ratio, distinct ratio, share of one value) and suggested promises that open the wizard pre-filled.
- **Monitoring › Performance, Capacity and Upgrades** — regressions of each query shape against its own baseline lined up with upgrades, DDL and setting changes; disk forecasts per node, top growth, codec savings measured on samples and cost by consumer; upgrade readiness checked against your real workload, replay on a canary, and rollout gates.
- **Agents** — every MCP and personal-access-token session with what it read, what it cost and whether the data was healthy. Budget policies (per query, per day, partition filters on large tables, warn or block on tables with incidents) are checked with `EXPLAIN ESTIMATE` before queries run, results carry health notices, and administrators can pause all agent access. New MCP tools: `get_dataset_health`, `get_lineage`, `get_table_context`, `get_metric`, `get_pipeline_status`, `list_incidents` and `propose_remediation` (a write tool, off until an administrator turns it on; there is no approve tool).
- **Schema change preflight** — DDL that would break dependent views, dictionaries, jobs, promises or saved queries is stopped with the impact and a safer plan; users with the new `schema:override` permission can confirm and run it anyway (audited).
- **New permissions** — `observe:view`, `observe:edit`, `context:edit`, `performance:view`, `capacity:view`, `cost:view`, `upgrades:view`, `upgrades:run`, `remediation:propose`, `remediation:approve`, `remediation:approve_high`, `schema:override`, `agents:view`, `agents:manage` and `notebooks:edit`, granted to the default roles by migration; no existing permission changes.
- **Helm chart: data observability settings** — optional `observability.*`, `remediation.*`, `publicBaseUrl` and `slack.*` (existing-secret support); every existing values file renders unchanged.
- **Cluster-aware scheduled query destinations** — materialize jobs can now create and write their destination across a ClickHouse cluster. A single-shard cluster gets a `Replicated*MergeTree` table on every replica; a sharded cluster gets a per-shard local table plus a `Distributed` table routed by a deterministic sharding key. The builder lists the connection's clusters, shows the generated `ON CLUSTER` DDL, and blocks saving until every precondition passes (cluster membership, database, Keeper macros, engine, sharding key). Each run re-checks the topology and fails instead of writing partial data.
- **AI agents managed in the UI (Agents › Assistant)** — every AI feature (the chat, SQL editor Optimize/Debug, the Doctor scan, Monitoring diagnoses, DataOps and observability assistants) now runs on an agent stored in the metadata database: prompt and task templates, model, tools, skills, subagents, harness and tuning are edited, versioned, rolled back and reset to built-in from the UI, with a test console that runs unsaved drafts. Built-in agents reproduce the previous behaviour exactly and keep receiving CHouse updates until you customize them. New permissions `ai_agents:view` and `ai_agents:manage` (granted to Admin and Super Admin) and audit events `ai_agent.*`, `ai_harness.*`, `ai_skill.*`, `ai_binding.update`, `ai_registry.reset`, `ai_registry.rollback` (ADR 0019).
- **CHouse Admin chat agent and agent picker** — the chat can now answer read-only questions about CHouse itself (users, roles, permissions, data access, connections, scheduled jobs, data health, alerts, incidents, Doctor reports, AI models, external agents, audit log) through tools that call the API as the chatting user. Pick *ClickHouse Data* (the default), *CHouse Admin* or *Auto*, which routes each question and combines answers that span both; the choice is saved per thread and the activity panel shows which subagent made each call.

### Changed
- **MCP is served at `/mcp` on the web port** — agents use the same address, Service, Ingress and TLS as the UI (`https://<host>/mcp`); the MCP endpoint starts off and answers `404 MCP_DISABLED` until it is turned on. The dock's MCP indicator opens Agents › MCP.
- **Helm chart 2.0.0** — MCP needs no chart values any more. Leftover `mcp:` values are ignored and the install notes warn until they are removed.
- **DataOps is now Data** — `/dataops/*` links redirect to the matching `/data/*` page; Scheduled Queries and Data Health keep working exactly as before inside it.
- **Fleet collection is always on** — the observability collector replaces the fleet poller and runs on every pod under per-connection leases. `FLEET_POLLER_ENABLED` / `fleet.poller_enabled` are accepted but ignored (a warning is logged); `FLEET_POLL_INTERVAL_SECONDS` still works and `OBSERVE_FLEET_INTERVAL` takes precedence.
- **Doctor reports** open as investigation notebooks with proposed fixes alongside the report.

### Fixed
- **Workload replay on a canary** — queries whose tables were dropped from the baseline are now **skipped** instead of counted as canary errors; tables missing only on the canary show as **Missing on canary** instead of errors; the replayed query text is shown without the client's `FORMAT` clause; and the most serious differences are listed first. The panel also says that the active connection is the baseline.
- **Agents › Pause all agent access** — the button and the paused banner use the yellow/amber accent instead of alarm red.
- **Explorer button on Data › Datasets** — opened an information tab for an empty database instead of the selected table; the command palette's table and database results had the same problem.
- **Role cards grouped every new permission under "Other"** — the cards now use the server's permission categories, so Data Observability, Performance & Capacity, Remediation and Agents permissions show in their own groups.
- **Invalid Data Health checks returned a server error** — saving or previewing a promise whose checks cannot run as defined (for example a row count without an event-time column, or two checks with the same key) failed with a 500. It now returns 400 with the reason, and the same applies to Chouse AI watcher drafts.
- **Fleet doctor "Propose fix"** — no longer crashes the page; the remediation catalog now returns required grants as a list, as the UI expects.
- **Dependency vulnerabilities** — upgraded `nodemailer` to 10.0.13 (fixes 2 high and 3 medium advisories) and refreshed transitive `ip-address` (10.7.3) and `fast-uri` (3.1.8) to clear the findings in the Artifact Hub/Trivy report for v3.13.0
- **Further dependency advisories** — upgraded `dompurify` to 3.4.16 and the ESLint-side `ajv` 6.x to 6.15.0
- **Accepted vulnerability exception** — documented a time-boxed scanner exception for `braces` 3.0.3 (GHSA-vfj7-8cjw-p6xm), which has no upstream fix; see `SECURITY.md`
- **Replace-mode staging for replicated destinations** — the staging table is now a plain local `MergeTree` with the destination's keys instead of a clone that reused the destination's Keeper path and failed with `REPLICA_ALREADY_EXISTS`. Every statement of a materialize run is also pinned to one ClickHouse session, so a non-sticky load balancer can no longer split staging and the partition swap across nodes.
- **AI skills now load** — the built-in skills (optimizer, debugger, evaluator, chat skills and the ClickHouse reference skills) were never actually offered to the model because of a mount-path bug; every agent now sees the skills its prompt refers to.
- **Bedrock models follow the same AI harness** — Bedrock deployments no longer get the planning, filesystem and general-purpose subagent tools the other providers have always had hidden.

### Removed
- **Dedicated MCP port and `MCP_*` settings** — port 8752, `MCP_ENABLED`, `MCP_HOST`, `MCP_PORT`, `MCP_ALLOW_WRITES`, `MCP_ALLOW_DESTRUCTIVE`, `MCP_TOOLSETS`, `MCP_ALLOWED_ORIGINS`, `MCP_TIMEOUT_SECONDS` (and the matching `mcp.*` YAML keys), plus the chart's `mcp.*` values, `<release>-mcp` Service and MCP Ingress. The server logs a warning naming any that are still set. After upgrading from 3.13, point agents at `/mcp` on the UI address and turn MCP on in Agents › MCP.

## [v3.13.0] - 2026-09-13

### Added
- **Personal access tokens** — self-service machine credentials (`ch_pat_…`) in Preferences for connecting external apps. Tokens inherit your live permissions with optional scope narrowing and expiry presets, work on all API routes via `Authorization: Bearer`, support one-click rotate, and are individually revocable. Creation, rotation, and revocation are recorded in the audit log.
- **MCP server status toggle** — the dock now shows whether the MCP server (ADR 0013) is enabled or disabled, with a hover tooltip explaining the state; the same status appears in the Personal access tokens settings card.
- **MCP server for AI agents (ADR 0013)** — a Model Context Protocol endpoint on a dedicated port (8752) that lets agents (Cursor, VS Code Copilot, OpenCode, Claude Desktop, CI pipelines) query ClickHouse, explore schema, monitor the fleet, and manage scheduled work without the browser. PAT-only auth (`Authorization: Bearer ch_pat_…`) verified live against RBAC on every call, so scopes, data-access policies, rate limits, and `patId`-attributed audit apply exactly as for the UI and CLI.
  - **Safe by default** — the read-only toolset registers by default (`whoami`, connections, schema explorer, SELECT-only `query` with AST classification and result caps, metrics, live queries, scheduled jobs, data health, alerting, audit). Write and destructive toolsets exist only when the operator enables `MCP_ALLOW_WRITES` / `MCP_ALLOW_DESTRUCTIVE` (chart `mcp.allowWrites` / `mcp.allowDestructive`); destructive calls are approved by a human through the client's permission prompt, configured per client in [docs/mcp.md](../../docs/mcp.md) (ADR 0014).
  - **Operator-controlled surface** — `mcp.enabled` (off by default: no port, no Service, unreachable), toolset selection, per-request timeout, and an Origin allowlist (DNS-rebinding protection; headerless clients always pass). The dedicated `<release>-mcp` Service mirrors the UI Service (ClusterIP/NodePort/LoadBalancer, annotations) and a NetworkPolicy rule scopes agent traffic separately from the public UI origin; `mcp.ingress.enabled` additionally exposes the endpoint at `https://<host>/mcp` through an Ingress that mirrors the UI ingress verbatim (className/annotations/tls — no inheritance), so agents need no non-standard port.
  - **Bounded context** — results are capped (100 rows / 200 KB / 2 KB per cell) with secret redaction before they reach the model; resources (`chouse://table/…`, …) and prompts (investigate-slow-query, diagnose-incident, review-schema, plan-schema-migration) give agents context without tool proliferation. Break-glass admin (PAT CRUD, user/role grants, SSO/AI secrets, connection writes, audit prune) stays UI-only.

### Changed
- **Dock regroup** — the sidebar and floating docks use consistent session/controls grouping with a Home-first nav order, a slimmer sidebar rail (collapsible session stack disclosing MCP, getting started, and the mode switch), and evenly sized status tiles in the floating bar.

### Fixed
- **Query row cap honored everywhere** — `POST /query/table/select` dropped the validated `maxResultRows` field, so `--limit` had no effect on the default read path. The cap is now passed through and additionally enforced server-side (truncation), since recent ClickHouse builds ignore small `max_result_rows` values.
- **Personal access tokens on PostgreSQL** — token creation failed with a 500 because `rbac_api_keys.scopes` was created as `TEXT[]` while the server maps it as JSONB. Migration `1.52.0` converts the column to JSONB (existing installs) and the snapshot now creates it correctly (fresh installs).

## [v3.12.1] - 2026-09-11

### Changed
- **CI now scans the built image** with Trivy and fails on HIGH/CRITICAL findings, matching ArtifactHub's scanner. Base images are digest-pinned and kept current by Renovate.

### Fixed
- **ON CLUSTER DDL** — `CREATE/DROP/ALTER ... ON CLUSTER` in the SQL editor no longer shows a false `JSON Parse error` on success; per-host results render as a table and plain DDL returns a clean success
- **GitHub SSO login** — GitHub now sends an RFC 9207 `iss` parameter (`https://github.com/login/oauth`) that could never match the synthetic plain-OAuth2 issuer, rejecting every login. OAuth2 callbacks now ignore `iss` unless an explicit `issuer` is configured (which validates it strictly instead).
- **SSO email auto-link** — GitHub logins using a verified `/user/emails` address now auto-link to the existing account when `auto_link_by_email` is enabled (previously failed with a duplicate-email error); email collisions without verification proof now return `409 Conflict` with an actionable message instead of a raw database error
- **Container image vulnerabilities** — the published image no longer carries known CVEs from the server runtime or the Alpine base. Bumped `hono`, `nodemailer`, and `@xmldom/xmldom`, forced patched transitive `@xmldom/xmldom` and `uuid` through overrides that the production install honours, and pinned a minimum OpenSSL (`libcrypto3`/`libssl3`) version in the base image.

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

