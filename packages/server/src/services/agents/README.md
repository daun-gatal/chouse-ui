# Agent Governance

## Overview
Governance for PAT-authenticated agent queries (CLI and MCP, ADR 0016 §10): client identity, derived sessions and tool calls, per-scope policies, the global pause switch and the budget preflight decision.

## Interface
- `[governance.ts:governAgentQuery]`, `[governance.ts:recordAgentQuery]`, `[governance.ts:agentContextFor]`, `[governance.ts:tableHealth]`, `[governance.ts:AGENT_RECORDED_HEADER]`.
- `[budget.ts:decideBudget]`, `[budget.ts:DEFAULT_AGENT_POLICY]`, `[budget.ts:healthNotices]`.
- `[clients.ts:describeAgentClient]`, `[clients.ts:initializeClientName]`, `[clients.ts:AGENT_CLIENT_HEADER]`, `[clients.ts:INTERNAL_MCP_USER_AGENT]`.
- `[store.ts:touchSession]`, `[store.ts:recordToolCall]`, `[store.ts:listSessions]`, `[store.ts:listToolCalls]`, `[store.ts:bytesUsedToday]`, `[store.ts:upsertPolicy]`, `[store.ts:deletePolicy]`, `[store.ts:effectivePolicy]`, `[store.ts:isAgentAccessPaused]`, `[store.ts:setAgentAccessPaused]`; also `[store.ts:getSession]`, `[store.ts:listPolicies]`, `[store.ts:listPolicyScopes]`, `[store.ts:withScopeLabels]`, `[store.ts:policyScopeExists]`, `[store.ts:appliedPolicy]`, `[store.ts:policyInputSchema]`, `[store.ts:SESSION_GAP_MS]`.

## Invariants
- Every PAT-authenticated query passes through `[governance.ts:governAgentQuery]`; the pause switch blocks all of them.
- `[budget.ts:decideBudget]` is pure: it is given policy, estimates, spend and health and returns allow / warn / block with reasons. `governAgentQuery` gathers those inputs itself: for `SELECT`/`WITH` statements (when not paused) it runs `EXPLAIN ESTIMATE` on the connection, and a failed estimate is logged and does not block `[governance.ts:governAgentQuery]`.
- MCP is stateless, so a session is derived from consecutive calls within `[store.ts:SESSION_GAP_MS]`.

## Side Effects
- Runs `EXPLAIN ESTIMATE` on the ClickHouse connection and reads `obs_catalog_tables`, `obs_table_baselines`, `data_health_incidents` and `obs_incidents` to size the query and report table health `[governance.ts:governAgentQuery]`, `[governance.ts:tableHealth]`.
- Writes `agent_sessions`, `agent_tool_calls`, `agent_policies` and the pause flag in `obs_settings` (`[store.ts:touchSession]`, `[store.ts:recordToolCall]`, `[store.ts:upsertPolicy]`, `[store.ts:setAgentAccessPaused]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
