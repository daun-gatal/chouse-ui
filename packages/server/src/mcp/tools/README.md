# MCP Tools

## Overview
The CHouse MCP tool catalog. Each module registers a group of tools on a
`McpToolSink` (the live `McpServer` or the catalog collector); `server.ts` in
the parent calls the `register*Tools` functions. Tools call CHouse's own `/api`
routes through `McpApiClient` with the caller's token, so RBAC, data access
policies, and agent governance apply exactly as in the UI; the generated action
tools additionally use the AI action store and executor in
`services/ai/actions`, with an `McpApiClient`-backed `ActionApi`. `helpers.ts` provides the shared
wrapper, argument parsers, and registration types.

## Interface
- `helpers.ts`: `[helpers.ts:runApiTool]` (standard wrapper), `[helpers.ts:toolContext]`, `[helpers.ts:apiFor]` (per-call client honoring a `connection_id` argument), `textResult`, `jsonResult`, `argString`, `argNumber`, `argOptionalNumber`, `argEnum`, `argOptionalString`, `[helpers.ts:registerChouseTool]`, `[helpers.ts:registerOnServer]`, `[helpers.ts:registerChousePrompt]`, types `ChouseToolRegistration`, `McpToolSink`, `McpToolAccess` (`read | write | destructive`), `MCP_TOOL_CATEGORIES`, `ToolExtra`.
- Read tools (two modules here also register write tools, marked per line):
  - `[core.ts:registerCoreTools]` - `whoami`, `list_connections`, `use_connection`.
  - `[explore.ts:registerExploreTools]` - `list_databases`, `list_tables`, `describe_table`, `sample_table`.
  - `[query.ts:registerQueryTools]` - `query`, `explain_query`, `list_saved_queries`, `get_saved_query`, `run_saved_query`; plus `[query.ts:classifyReadSql]` / `SqlClassification`.
  - `[observe.ts:registerObserveTools]` - `metrics_overview`, `live_queries`, `fleet_snapshots`, scheduled jobs/runs, health checks, `list_alerts`, `audit_list`.
  - `[dataObservability.ts:registerDataObservabilityTools]`, `[dataObservability.ts:registerRemediationReadTools]` - dataset health, lineage, table context, metrics, pipelines, incidents, remediation actions, notebooks.
  - `[performance.ts:registerPerformanceTools]` - query regressions, shape history, capacity, upgrade assessments/status, collector status/schedule.
  - `[aiGovernance.ts:registerAiGovernanceTools]` - AI usage, data egress, requests, agents, guardrails and triggers.
  - `[dashboards.ts:registerDashboardTools]` - list/get/export/run panel/versions/annotations (read); `create_dashboard_snapshot` and `apply_dashboard` are `write`, `delete_dashboard` is `destructive`.
  - `[ai.ts:registerAiTools]` - `ai_optimize` (read, LLM-backed), `doctor_scan` (`write`, LLM-backed), `doctor_reports`, `get_doctor_report`.
- Write and destructive tools (hand-written ones are off until enabled in AI Governance › MCP; generated action tools are on by default but listed only when the token's write access allows them, see `../server.ts:buildMcpServer`):
  - `[writes.ts:registerWriteTools]` - `create_saved_query`, `run_scheduled_job`, `run_health_check`, `acknowledge_incident`, `test_alert_channel`.
  - `[destructive.ts:registerDestructiveTools]` - `kill_query`, `query_raw`, `delete_saved_query`, `delete_scheduled_job`.
  - `[dataObservability.ts:registerRemediationProposalTool]` - `propose_remediation`.
  - `[actions.ts:registerActionTools]` - tools generated from `ACTION_DEFINITIONS` (skipping names in `NOT_OVER_MCP`, currently `update_my_preferences`; T3 actions are `destructive`, the rest `write`), plus `get_action_status`, `undo_action`; helpers `[actions.ts:mayActOverMcp]`, `[actions.ts:writeAccessFor]`, `[actions.ts:actionToolListed]`, `[actions.ts:mcpActionApi]`, type `WriteAccess`.

## Invariants
- Every handler goes through `runApiTool`: missing identity fails closed, the agent pause switch is honored, API errors become tool errors, results are capped (`cappedJson`) and guarded (`guardMcpResult`), and each call is audited best-effort without failing the tool `[helpers.ts]` header, `[helpers.ts:runApiTool]`.
- The `query` tool runs only a single read statement (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN) as classified by the AST parser in `middleware/sqlParser.ts`; multi-statement or unparsable SQL fails closed `[query.ts:classifyReadSql]`.
- Default enablement is `action !== undefined || (access === "read" && !spendsLlm)`, overridable per tool via `toolOverrides` (`../settings.ts:toolEnabledByDefault`); hand-written write, destructive, and LLM-backed tools are therefore off until an administrator enables each one (ADR 0017); destructive tools rely on the client's permission prompt for human approval `[destructive.ts]`, `[writes.ts]`, `[ai.ts]` headers.
- `propose_remediation` only files a proposal; an MCP proposal is never self-approved `[dataObservability.ts]` header.
- Generated action tools are checked by tier: T1 runs (or asks per token policy) and can be undone, T2 waits for the user's confirmation in CHouse, T3 needs a second person; a generated tool never replaces an existing tool name `[actions.ts]` header, `[actions.ts:registerActionTools]`.
- A token without `ai_usage:view` sees only its owner's own AI requests `[aiGovernance.ts]` header.

## Side Effects
- HTTP subrequests to CHouse `/api/*` with the caller's token (via `McpApiClient`), which may run ClickHouse queries or mutate RBAC data depending on the tool.
- Audit entries via `auditMcpToolCall` and agent-session bookkeeping via `services/agents/store` `[helpers.ts]`.
- Action tools create, claim, perform, and undo rows in the AI action store (`services/ai/actions`) `[actions.ts]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/mcp`
