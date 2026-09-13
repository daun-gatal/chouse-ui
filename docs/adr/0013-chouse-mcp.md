# 0013 — CHouse MCP Server: In-Process Streamable HTTP with PAT Auth

- **Status:** Proposed
- **Date:** 2026-09-12
- **Builds on:** [0011](0011-personal-access-tokens.md) (PAT machine auth), [0012](0012-chouse-cli.md) (browserless operations), [0010](0010-pod-local-state-and-multi-replica-correctness.md) (fail-closed, no silent substitution), [0008](0008-helm-chart-and-oci-distribution.md) (Helm/OCI delivery)

## Context

ADR 0011 reserved the `ch_pat_…` credential for two consumers: a CLI (now
shipped, ADR 0012) and an MCP server for agentic tools. Agents (Cursor, VS Code
Copilot, OpenCode, Claude Desktop, CI pipelines) cannot use the browser
JWT/refresh flow and need a long-lived credential passed as a `Bearer` token on
every call.

The MCP ecosystem has settled on two transports in the 2026-07-28 protocol
revision: stdio (desktop hosts launching a subprocess) and Streamable HTTP (a
single stateless POST endpoint, replacing HTTP+SSE sessions). Forces shaping
this decision:

1. **Deployment reality:** CHouse UI ships as one Bun process inside one Docker
   image, deployed via the Helm chart (ADR 0008). The Go CLI is *not* in that
   image — it ships as GitHub Release binaries. An MCP implementation in Go
   would need a second image, a second release line, and a network hop with
   token pass-through just to reach the API that already implements every
   permission check.
2. **Safety:** an LLM will eagerly pass any confirmation flag it is offered.
   The CLI's `--yes` is therefore *not* a usable safety primitive for agents;
   the write policy must be server-side configuration, not client flags, and
   destructive operations must require human approval inside the MCP host
   (elicitation).
3. **Statelessness:** protocol sessions were removed in 2026-07-28. Every
   request is self-contained, so multi-replica deployments are correct with
   zero pod-local state (ADR 0010) and connection scoping stays per-request
   (`X-Connection-Id`), matching the CLI contract.
4. **Least privilege at the network layer:** a dedicated port means the chart
   can expose MCP through its own Service and NetworkPolicy scoping — agent
   namespaces only — while the public origin (5521) is untouched, and MCP is
   unreachable when disabled, not merely unresponsive.

## Decision

### 1. In-process MCP server in `packages/server`, dedicated port

- MCP is implemented in TypeScript inside the existing server process, served
  on a **dedicated port (`MCP_PORT`, default 8752)** as a second `Bun.serve`
  listener, mounted at `/mcp`. No new image, no new workload, one authn/authz
  path.
- Disabled by default everywhere (`MCP_ENABLED=false`); enabled in development
  only as a localhost convenience. In production operators opt in explicitly.
- The chart adds a `mcp:` values block rendering `MCP_*` env vars, a
  conditional Service (`chouse-ui-mcp`) targeting the `mcp` container port, a
  NetworkPolicy port rule, and optional dedicated ingress. `helm` render fails
  if `allowWrites`/`allowDestructive` are set without `enabled`.
- The official `@modelcontextprotocol/sdk` is used with the **stateless**
  `WebStandardStreamableHTTPServerTransport` (no `sessionIdGenerator`) and the
  2026-07-28 protocol revision. Logging goes through the existing Pino
  `logger`/`requestLogger`, never stdout of a subprocess.

### 2. Auth: Streamable HTTP + PAT only (no stdio, no OAuth in v1)

- Every MCP request must carry `Authorization: Bearer ch_pat_…`; it is verified
  with the existing `verifyBearer()` choke point (ADR 0011), so tools inherit
  the **live** roles ∩ scopes, data-access policies, rate limits, and audit
  attribution (`patId`) of the UI/CLI. JWT tokens are rejected on the MCP port
  with a clear error — MCP is a machine surface.
- The PAT is supplied **per request by the client** (GitHub/GitLab MCP
  pattern); the server never holds, defaults, or accepts a shared PAT from
  configuration — no confused deputy.
- **Origin validation** (spec MUST for Streamable HTTP): `MCP_ALLOWED_ORIGINS`
  (CSV). Empty allowlist = reject any request carrying an `Origin` header
  (DNS-rebinding protection) and allow headerless calls (CI agents, curl).
- OAuth 2.1 / RFC 9728 authorization is deferred to a later phase; PAT bearer
  is the v1 machine-auth surface this ADR's predecessors reserved for exactly
  this use.

### 3. Tools are a thin, safe projection of the existing API

- Tool handlers do **not** reimplement business logic. Each tool issues an
  in-process subrequest (`app.request`) to the existing `/api/*` routes with
  the caller's PAT and connection headers, then shapes the `{success,data,error}`
  envelope into an MCP result. This reuses — verbatim — `verifyBearer`, data-access
  policies, the AST-based SQL parser (`middleware/sqlParser.ts`), per-route
  audit logs, and rate limiting. The MCP layer adds its own audit entry
  (`mcp.tool_call`) for attribution and tool-level caps.
- Tool catalog (toolsets; default = `core,explore,query,observe,ops`):
  - **core:** `whoami`, `list_connections`, `use_connection`
  - **explore:** `list_databases`, `list_tables`, `describe_table`, `sample_table`
  - **query:** `query` (SELECT-only), `explain_query`, `list_saved_queries`,
    `get_saved_query`, `run_saved_query` (write definitions refused)
  - **observe:** `metrics_overview`, `live_queries`, `fleet_snapshots`,
    `list_scheduled_jobs`, `get_scheduled_job`, `list_scheduled_runs`,
    `list_health_checks`, `get_health_check`, `health_timeline`, `list_alerts`,
    `audit_list`
  - **writes** (gated by `MCP_ALLOW_WRITES`): `create_saved_query`,
    `run_scheduled_job`, `run_health_check`, `acknowledge_incident`,
    `test_alert_channel`
  - **destructive** (gated by `MCP_ALLOW_DESTRUCTIVE` **and** elicitation):
    `kill_query`, `query_raw`, `delete_saved_query`, `delete_scheduled_job`
  - **ai** (opt-in toolset, LLM spend): `ai_optimize`, `doctor_scan`,
    `doctor_reports`, `get_doctor_report`
- Resources (`chouse://connection/{id}`, `chouse://database/{name}`,
  `chouse://table/{db}/{table}`, `chouse://saved-query/{id}`,
  `chouse://scheduled-job/{id}`, `chouse://health-check/{id}`,
  `chouse://doctor-report/{id}`) and prompts (`investigate-slow-query`,
  `diagnose-incident`, `review-schema`, `plan-schema-migration`) give agents
  context without tool proliferation.
- Connection scoping: per-tool optional `connection_id` argument or the
  request's `X-Connection-Id` header; otherwise the server default — the same
  resolution order as the CLI, never pinned server-side.

### 4. Safety, enforced server-side

- **Read-only by default:** write and destructive tools are not even registered
  unless the corresponding env flag is on. An agent cannot opt in.
- `query` accepts SELECT/WITH/SHOW/DESCRIBE/EXPLAIN only, classified by the
  existing AST parser; unknown or multi-statement input fails closed.
- **Destructive tools require elicitation** (`elicitation/create`, form mode) —
  a human approves in the MCP host; hosts without elicitation support get a
  fail-closed error pointing at the UI/CLI. `kill_query`/`query_raw` echo the
  action and target in the prompt and audit entry.
- **Result caps:** 100 rows / 200 KB payload / 2 KB per cell by default; every
  tool response passes secret redaction (`ch_pat_…`, password-like fields,
  connection secrets) before it reaches the model.
- Per-request timeout (default 60s) bounds tool calls; the `ai` toolset is
  never enabled by default because it spends LLM money.
- UI-only surface stays UI-only: PAT CRUD/rotate, password change,
  login/refresh/logout, SSO admin, AI provider/model secrets, user/role
  grants, data-access policy writes, native ClickHouse user/role writes,
  connection create/delete, audit prune/export, uploads — none are exposed as
  MCP tools regardless of flags.

### 5. Packaging and delivery

- `MCP_*` config keys flow through the existing flattening (`CHOUSE_CONFIG_PATH`
  YAML → env), so `.config.example.yaml`, Docker compose, and Helm `config:`
  all work uniformly. The chart renders `mcp:` values into pod env directly
  (pattern of `SCHEDULED_QUERIES_ENABLED`).
- Docker image gains only `ENV` defaults and an `EXPOSE 8752`; compose files
  gain a commented `8752:8752` mapping. Probes, PVC, and the web Service are
  untouched.
- Docs ship in `docs/mcp.md` with client configs for OpenCode, VS Code, Cursor,
  Claude Desktop, and curl/CI. E2E (`scripts/e2e-mcp.sh`) follows the DinD
  compose-sidecar pattern (`http://chouse-ui:8752/mcp` inside the compose
  network).

## Consequences

- Agents get browserless, safe access to schema, queries, fleet health, and
  scheduled/data-health state with one env var on the client side, inheriting
  live permissions, data-access policies, rate limits, and `patId`-attributed
  audit trails.
- The write policy is operator-controlled (`MCP_ALLOW_WRITES`,
  `MCP_ALLOW_DESTRUCTIVE`), not model-controlled; destructive actions always
  need a human in the loop, and reads are the only thing enabled by default.
- One implementation serves workstation, remote, and in-cluster agents; the
  Go CLI remains the script-facing surface and is unaffected.
- New maintenance: the MCP tool layer tracks the API surface it projects
  (contract-style tests assert the projected routes are PAT-capable), plus a
  small chart surface (`mcp:` values, Service, NetworkPolicy).

## Alternatives considered

- **Go MCP binary in `cli/`** — rejected: not in the app image, so Docker/Helm
  delivery needs a second image and release line; PAT pass-through hop adds a
  confused-deputy risk; duplicates the API client and the tool surface in two
  languages.
- **stdio transport** — rejected: not reachable in Docker/K8s, and one
  transport means one security posture to audit.
- **`/mcp` path on the public origin (5521)** — rejected: NetworkPolicy cannot
  scope a path; MCP traffic would share the origin's rate-limit budget and
  expand the public attack surface when disabled-by-default is the goal.
- **OAuth 2.1/RFC 9728 in v1** — rejected: adds a discovery + authorization
  server surface with zero v1 gain; PAT bearer was reserved for this in
  ADR 0011. Deferred to a later ADR for hosted/public MCP.
- **CLI-subprocess MCP wrapper** — rejected: TTY `--yes` prompts hang agents,
  no result caps, and the full CLI surface (50+ commands) is tool overload.
- **Full API parity as tools** — rejected: prompt-injection and confused-deputy
  surface; break-glass admin stays in the browser (same OUT list as ADR 0012).
